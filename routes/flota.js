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

module.exports = router;
