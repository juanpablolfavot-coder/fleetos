// ════════════════════════════════════════════════════════════════════
//  Datos de la flota — fuente ÚNICA para la pantalla y para el asistente
//
//  La pantalla de Control en vivo y el asistente que contesta preguntas
//  tienen que decir lo mismo. Si cada uno armara su propia consulta, tarde
//  o temprano darían números distintos y no se sabría a cuál creerle. Por
//  eso las consultas viven acá y las usan los dos.
//
//  Todo sale de lo que el sync del GPS ya guarda cada 2 minutos: nada de
//  esto llama a Powerfleet.
// ════════════════════════════════════════════════════════════════════
const { query } = require('../db/pool');
const idle = require('./idle');

// A partir de acá una unidad no está "detenida" sino "sin reportar": el equipo
// está apagado o sin señal. El sync corre cada 2 min, 30 ya es una anomalía.
const STALE_MIN = 30;

// Orden de la lista: primero lo que se mueve, después lo que quema gasoil
// parado, después lo detenido, y al final lo que no reporta. Dentro de cada
// grupo, lo más "intenso" arriba.
const PRIORIDAD = { ruta: 0, ralenti: 1, detenida: 2, sin_reportar: 3 };

// Semirremolques y acoplados llevan equipo GPS pero no tienen motor: cuando el
// camión los arrastra reportan "en movimiento", y contarlos junto a las
// motorizadas duplica el mismo viaje.
//
// No se reusa el excluido() de idle.js a propósito: ese además saca las
// autoelevadoras, que trabajan en ralentí por diseño pero sí tienen motor.
function esArrastrado(type) {
  const t = String(type || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return t.includes('remolque') || t.includes('acoplad') || t.includes('batea') || t.includes('carreton');
}

function clasificar(row, segDesde) {
  if (segDesde === null || segDesde > STALE_MIN * 60) return 'sin_reportar';
  if (row.gps_status === 'moving') return 'ruta';
  if (row.ralenti_desde) return 'ralenti';
  return 'detenida';
}

function mapearUnidad(row) {
  const segDesde = row.seg_desde === null ? null : parseInt(row.seg_desde);
  return {
    code: row.code,
    plate: row.plate,
    base: row.base,
    tipo: row.type,
    direccion: row.gps_address || null,
    lat: row.gps_lat !== null ? parseFloat(row.gps_lat) : null,
    lng: row.gps_lng !== null ? parseFloat(row.gps_lng) : null,
    velocidad: Math.round(parseFloat(row.gps_speed) || 0),
    situacion: clasificar(row, segDesde),
    arrastrado: esArrastrado(row.type),
    // Estado crudo que manda el GPS ('parking', 'driving', ...). Se expone sin
    // interpretar: todavía no conocemos el vocabulario completo.
    estado_gps: row.gps_state || null,
    minutos_sin_reportar: segDesde === null ? null : Math.floor(segDesde / 60),
    ralenti_minutos: row.ralenti_seg ? Math.floor(parseInt(row.ralenti_seg) / 60) : null,
  };
}

const SELECT_UNIDADES = `
  SELECT v.code, v.plate, v.base, v.type,
         v.gps_address, v.gps_speed, v.gps_status, v.gps_state,
         v.gps_lat, v.gps_lng, v.gps_updated_at, v.km_current, v.gps_hour_meter,
         EXTRACT(EPOCH FROM (NOW() - v.gps_updated_at))::int AS seg_desde,
         ie.started_at AS ralenti_desde,
         EXTRACT(EPOCH FROM (NOW() - ie.started_at))::int   AS ralenti_seg
    FROM vehicles v
    LEFT JOIN LATERAL (
      SELECT started_at FROM idle_events
       WHERE vehicle_code = v.code AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1
    ) ie ON TRUE`;

// ── Foto del momento ──────────────────────────────────────────────────
async function estadoFlota() {
  const r = await query(`${SELECT_UNIDADES}
     WHERE v.active = TRUE AND v.gps_updated_at IS NOT NULL`);

  const unidades = r.rows.map(mapearUnidad);
  unidades.sort((a, b) => {
    const p = PRIORIDAD[a.situacion] - PRIORIDAD[b.situacion];
    if (p !== 0) return p;
    if (a.situacion === 'ruta')    return b.velocidad - a.velocidad;
    if (a.situacion === 'ralenti') return (b.ralenti_minutos || 0) - (a.ralenti_minutos || 0);
    return (b.minutos_sin_reportar || 0) - (a.minutos_sin_reportar || 0);
  });

  // El resumen cuenta SOLO las motorizadas: es la respuesta a "cuántos camiones
  // tengo andando". Los semis se informan por separado.
  const motorizadas = unidades.filter((u) => !u.arrastrado);
  const arrastradas = unidades.filter((u) => u.arrastrado);
  const contar = (s) => motorizadas.filter((u) => u.situacion === s).length;

  return {
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
  };
}

// ── Una unidad puntual ────────────────────────────────────────────────
// Busca por código o patente, tolerando minúsculas y separadores. Si no hay
// coincidencia exacta prueba por "termina en" — al preguntar suele decirse
// "el 327RZ" en vez de la patente entera.
async function buscarUnidad(texto) {
  const limpio = String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!limpio) return null;

  const porIgual = await query(`${SELECT_UNIDADES}
     WHERE UPPER(REGEXP_REPLACE(COALESCE(v.code,''),  '[^A-Za-z0-9]', '', 'g')) = $1
        OR UPPER(REGEXP_REPLACE(COALESCE(v.plate,''), '[^A-Za-z0-9]', '', 'g')) = $1
     LIMIT 1`, [limpio]);
  if (porIgual.rows[0]) return conExtras(porIgual.rows[0]);

  const porFinal = await query(`${SELECT_UNIDADES}
     WHERE UPPER(REGEXP_REPLACE(COALESCE(v.code,''),  '[^A-Za-z0-9]', '', 'g')) LIKE '%' || $1
        OR UPPER(REGEXP_REPLACE(COALESCE(v.plate,''), '[^A-Za-z0-9]', '', 'g')) LIKE '%' || $1
     LIMIT 2`, [limpio]);
  // Si hay más de una, no se adivina: es mejor que el asistente pida la patente
  // completa que contestar sobre la unidad equivocada.
  if (porFinal.rows.length === 1) return conExtras(porFinal.rows[0]);
  return null;
}

function conExtras(row) {
  return Object.assign(mapearUnidad(row), {
    km: row.km_current !== null ? parseInt(row.km_current) : null,
    horas_motor: row.gps_hour_meter !== null ? Math.round(parseFloat(row.gps_hour_meter)) : null,
    activa: true,
  });
}

// ── Lo que pasó: excesos y ralentí ────────────────────────────────────
const HORAS_DEFAULT = 24;
const HORAS_MAX = 168;   // una semana: más que eso ya no es un feed, es un reporte

// Misma expresión de duración que usa idle.js: un evento sin cerrar se mide
// hasta ahora, no se descarta.
const DUR = `COALESCE(duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(ended_at,NOW())-started_at))::int))`;

async function eventos({ horas } = {}) {
  const h = Math.min(HORAS_MAX, Math.max(1, parseInt(horas) || HORAS_DEFAULT));
  const desde = new Date(Date.now() - h * 3600 * 1000);

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

  return {
    horas: h,
    desde: desde.toISOString(),
    resumen: {
      excesos:         excesos.length,
      velocidad_max:   excesos.reduce((m, e) => Math.max(m, e.velocidad_max), 0),
      ralenti_eventos: ralentis.length,
      ralenti_minutos: ralentis.reduce((a, r) => a + r.duracion_min, 0),
      ralenti_litros:  ralentis.reduce((a, r) => a + r.litros, 0),
    },
    eventos: [...excesos, ...ralentis].sort((a, b) => new Date(b.cuando) - new Date(a.cuando)),
  };
}

module.exports = { estadoFlota, buscarUnidad, eventos, esArrastrado, STALE_MIN, HORAS_MAX };
