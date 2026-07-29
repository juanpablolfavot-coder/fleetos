// ════════════════════════════════════════════════════════════════════
//  Control en vivo de la flota — SOLO DUEÑOS
//
//  Devuelve la foto del momento: dónde está cada unidad, a qué velocidad,
//  desde hace cuánto no reporta y cuáles están en ralentí. Todo sale de lo
//  que el sync del GPS ya guarda en la tabla vehicles cada 2 minutos: este
//  endpoint no llama a Powerfleet.
// ════════════════════════════════════════════════════════════════════
const router = require('express').Router();
const { query } = require('../db/pool');
const idle = require('../services/idle');
const { authenticate, requireRole } = require('../middleware/auth');

// A partir de acá una unidad no está "detenida" sino "sin reportar": el equipo
// está apagado o sin señal. El sync corre cada 2 min, 30 ya es una anomalía.
const STALE_MIN = 30;

// Orden de la lista: primero lo que se mueve, después lo que quema gasoil
// parado, después lo detenido, y al final lo que no reporta. Dentro de cada
// grupo, lo más "intenso" arriba (más rápido / más tiempo en ralentí).
const PRIORIDAD = { ruta: 0, ralenti: 1, detenida: 2, sin_reportar: 3 };

// Semirremolques y acoplados llevan equipo GPS pero no tienen motor: cuando el
// camión los arrastra reportan "en movimiento", y contarlos junto a las unidades
// motorizadas duplica el mismo viaje. Van aparte, y el resumen cuenta solo las
// que tienen motor.
//
// No se reusa el excluido() de idle.js a propósito: ese además saca las
// autoelevadoras, que trabajan en ralentí por diseño. Una autoelevadora sí tiene
// motor y acá corresponde que aparezca con el resto.
function esArrastrado(type) {
  const t = String(type || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return t.includes('remolque') || t.includes('acoplad') || t.includes('batea') || t.includes('carreton');
}

function clasificar(r, segDesde) {
  if (segDesde === null || segDesde > STALE_MIN * 60) return 'sin_reportar';
  if (r.gps_status === 'moving') return 'ruta';
  if (r.ralenti_desde) return 'ralenti';
  return 'detenida';
}

router.get('/ahora', authenticate, requireRole('dueno'), async (req, res) => {
  try {
    const r = await query(`
      SELECT v.code, v.plate, v.base, v.type,
             v.gps_address, v.gps_speed, v.gps_status, v.gps_state,
             v.gps_lat, v.gps_lng, v.gps_updated_at,
             EXTRACT(EPOCH FROM (NOW() - v.gps_updated_at))::int AS seg_desde,
             ie.started_at AS ralenti_desde,
             EXTRACT(EPOCH FROM (NOW() - ie.started_at))::int   AS ralenti_seg
        FROM vehicles v
        LEFT JOIN LATERAL (
          SELECT started_at FROM idle_events
           WHERE vehicle_code = v.code AND ended_at IS NULL
           ORDER BY started_at DESC LIMIT 1
        ) ie ON TRUE
       WHERE v.active = TRUE AND v.gps_updated_at IS NOT NULL`);

    const unidades = r.rows.map((row) => {
      const segDesde = row.seg_desde === null ? null : parseInt(row.seg_desde);
      const situacion = clasificar(row, segDesde);
      return {
        code: row.code,
        plate: row.plate,
        base: row.base,
        tipo: row.type,
        direccion: row.gps_address || null,
        lat: row.gps_lat !== null ? parseFloat(row.gps_lat) : null,
        lng: row.gps_lng !== null ? parseFloat(row.gps_lng) : null,
        velocidad: Math.round(parseFloat(row.gps_speed) || 0),
        situacion,
        arrastrado: esArrastrado(row.type),
        // Estado crudo que manda el GPS ('parking', 'driving', ...). Se expone
        // sin interpretar: todavía no conocemos el vocabulario completo.
        estado_gps: row.gps_state || null,
        minutos_sin_reportar: segDesde === null ? null : Math.floor(segDesde / 60),
        ralenti_minutos: row.ralenti_seg ? Math.floor(parseInt(row.ralenti_seg) / 60) : null,
      };
    });

    unidades.sort((a, b) => {
      const p = PRIORIDAD[a.situacion] - PRIORIDAD[b.situacion];
      if (p !== 0) return p;
      if (a.situacion === 'ruta')    return b.velocidad - a.velocidad;
      if (a.situacion === 'ralenti') return (b.ralenti_minutos || 0) - (a.ralenti_minutos || 0);
      return (b.minutos_sin_reportar || 0) - (a.minutos_sin_reportar || 0);
    });

    // El resumen cuenta SOLO las motorizadas: es la respuesta a "cuántos
    // camiones tengo andando". Los semis se informan por separado.
    const motorizadas = unidades.filter((u) => !u.arrastrado);
    const arrastradas = unidades.filter((u) => u.arrastrado);
    const contar = (s) => motorizadas.filter((u) => u.situacion === s).length;

    res.json({
      actualizado: new Date().toISOString(),
      resumen: {
        total:         motorizadas.length,
        en_ruta:       contar('ruta'),
        en_ralenti:    contar('ralenti'),
        detenidas:     contar('detenida'),
        sin_reportar:  contar('sin_reportar'),
        arrastrados:   arrastradas.length,
        total_con_gps: unidades.length,
      },
      unidades: motorizadas,
      arrastrados: arrastradas,
    });
  } catch (err) {
    console.error('flota/ahora:', err.message);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── Lo que pasó: excesos y ralentí en una sola línea de tiempo ────────
//
// Reemplaza el reporte por horas que llegaba por WhatsApp: en vez de que caiga
// un mensaje cada tanto, está siempre acá y se mira cuando hace falta.
//
// Los excesos y el ralentí viven en tablas distintas porque son cosas
// distintas, pero para el dueño son el mismo relato: "qué hizo la flota hoy".
// Por eso se mezclan y se ordenan por hora, del más reciente al más viejo.
const HORAS_DEFAULT = 24;
const HORAS_MAX = 168;   // una semana: más que eso ya no es un feed, es un reporte

// Misma expresión de duración que usa idle.js: un evento sin cerrar se mide
// hasta ahora, no se descarta.
const DUR = `COALESCE(duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(ended_at,NOW())-started_at))::int))`;

router.get('/eventos', authenticate, requireRole('dueno'), async (req, res) => {
  try {
    const horas = Math.min(HORAS_MAX, Math.max(1, parseInt(req.query.horas) || HORAS_DEFAULT));
    const desde = new Date(Date.now() - horas * 3600 * 1000);

    const [exc, ral] = await Promise.all([
      query(`SELECT vehicle_code, vehicle_plate, base, started_at, ended_at,
                    max_speed, limit_kmh, ${DUR} AS dur, (ended_at IS NULL) AS en_curso
               FROM speeding_events
              WHERE started_at >= $1
              ORDER BY started_at DESC`, [desde]),
      query(`SELECT vehicle_code, base, location, started_at, ended_at,
                    ${DUR} AS dur, (ended_at IS NULL) AS en_curso
               FROM idle_events
              WHERE started_at >= $1 AND ${DUR} >= $2
              ORDER BY started_at DESC`, [desde, idle.IDLE_MIN_SEC]),
    ]);

    const excesos = exc.rows.map((r) => ({
      tipo: 'exceso',
      code: r.vehicle_code,
      base: r.base,
      cuando: r.started_at,
      duracion_min: Math.round((parseInt(r.dur) || 0) / 60),
      en_curso: r.en_curso,
      velocidad_max: Math.round(parseFloat(r.max_speed) || 0),
      limite: r.limit_kmh,
    }));

    const ralentis = ral.rows.map((r) => {
      const seg = parseInt(r.dur) || 0;
      return {
        tipo: 'ralenti',
        code: r.vehicle_code,
        base: r.base,
        lugar: r.location || null,
        cuando: r.started_at,
        duracion_min: Math.round(seg / 60),
        en_curso: r.en_curso,
        litros: (seg / 3600) * idle.litrosPorHora(r.vehicle_code),
      };
    });

    const eventos = [...excesos, ...ralentis]
      .sort((a, b) => new Date(b.cuando) - new Date(a.cuando));

    res.json({
      horas,
      desde: desde.toISOString(),
      resumen: {
        excesos:          excesos.length,
        velocidad_max:    excesos.reduce((m, e) => Math.max(m, e.velocidad_max), 0),
        ralenti_eventos:  ralentis.length,
        ralenti_minutos:  ralentis.reduce((a, r) => a + r.duracion_min, 0),
        ralenti_litros:   ralentis.reduce((a, r) => a + r.litros, 0),
      },
      eventos,
    });
  } catch (err) {
    console.error('flota/eventos:', err.message);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
