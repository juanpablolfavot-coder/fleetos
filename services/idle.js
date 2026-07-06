// ════════════════════════════════════════════════════════════════════
//  Ralentí (motor encendido y detenido)
//  Registra en historial —SIN notificación push— los períodos en que una
//  unidad estuvo con el motor encendido y detenida (velocidad ≈ 0) más de
//  IDLE_MIN minutos. Sirve para estadísticas de combustible desperdiciado.
//  El "motor encendido" viene del endpoint IO del GPS (ignición).
// ════════════════════════════════════════════════════════════════════
const { query } = require('../db/pool');

const IDLE_SPEED   = 3;                                                  // km/h: detenido
const IDLE_MIN_SEC = Math.max(30, (parseInt(process.env.IDLE_MIN_MINUTES || '3', 10) || 3) * 60); // umbral para contar
const STALE_MIN    = 15;                                                 // cerrar si dejó de reportar
const LITERS_PER_HOUR = parseFloat(process.env.IDLE_LITERS_PER_HOUR || '3') || 3; // consumo por defecto (unidad sin tabla)

// Consumo de ralentí por unidad (L/h), según modelo. Las que no estén acá usan el default.
const IDLE_LH_BY_CODE = {
  AB723IX: 0.6, AF823RB: 0.6,                                        // Citroën Berlingo
  AG468LK: 0.8,                                                      // Ford Transit
  AB902MF: 0.9, AE919NN: 0.9,                                        // Mercedes-Benz Sprinter
  OKQ888: 1.0,                                                       // Iveco Daily
  AF041MB: 1.8,                                                      // Mercedes-Benz Accelo 815
  AH035AN: 1.9, AH035AO: 1.9,                                        // Iveco GB 110-190
  AA147OT: 2.0, AA508SW: 2.0, AB120EF: 2.0, AD225WO: 2.0, AF159UC: 2.0, // Mercedes-Benz Accelo 1016
  AH327AU: 2.4, AH327CF: 2.4,                                        // Iveco Tector 170E28
  AE517UM: 2.8, AG470AG: 2.8,                                        // Atego 1729 / 1726
  AD235FE: 3.0, AD644VD: 3.0, AF614LB: 3.0, AF931PD: 3.0, AG468LQ: 3.0, // Iveco Stralis
  AH327RZ: 3.0, AH327SA: 3.0, AH327SB: 3.0, AH327SG: 3.0, AH462JI: 3.0,
};
function litrosPorHora(code) {
  const r = IDLE_LH_BY_CODE[String(code || '').toUpperCase()];
  return (r != null) ? r : LITERS_PER_HOUR;
}

// No aplican: remolcados (sin motor) ni autoelevadoras (trabajan detenidas en ralentí).
function excluido(type) {
  const t = String(type || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return t.includes('remolque') || t.includes('acoplad') || t.includes('autoelev');
}

let _ready = false;
async function ensureSchema() {
  if (_ready) return;
  await query(`CREATE TABLE IF NOT EXISTS idle_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_code  VARCHAR(30),
    vehicle_plate VARCHAR(30),
    base          VARCHAR(100),
    location      TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at      TIMESTAMPTZ,
    duration_seconds INTEGER
  )`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_idle_open ON idle_events(vehicle_code) WHERE ended_at IS NULL`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_idle_started ON idle_events(started_at DESC)`).catch(() => {});
  _ready = true;
}

// engineOn: 1 (encendido), 0 (apagado), o null (desconocido → no se puede afirmar ralentí).
async function processVehicle(v, speed, engineOn, location) {
  const code = v && (v.code || v.plate);
  if (!code || excluido(v.type)) return;
  await ensureSchema();
  const s = Math.round(parseFloat(speed) || 0);
  const enRalenti = engineOn === 1 && s <= IDLE_SPEED;

  const openRes = await query(
    'SELECT id, started_at FROM idle_events WHERE vehicle_code=$1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1', [code]);
  const open = openRes.rows[0];

  if (enRalenti) {
    if (open) {
      await query('UPDATE idle_events SET updated_at=NOW() WHERE id=$1', [open.id]);
    } else {
      await query('INSERT INTO idle_events (vehicle_code, vehicle_plate, base, location) VALUES ($1,$2,$3,$4)',
        [code, v.plate || null, v.base || null, location || null]);
    }
  } else if (open) {
    // Dejó el ralentí: cerrar. Si no llegó al umbral, se descarta (fue una parada corta).
    await query(
      `UPDATE idle_events SET ended_at=NOW(), duration_seconds=GREATEST(0, EXTRACT(EPOCH FROM (NOW()-started_at))::int)
       WHERE id=$1`, [open.id]);
    await query(`DELETE FROM idle_events WHERE id=$1 AND duration_seconds < $2`, [open.id, IDLE_MIN_SEC]).catch(() => {});
  }
}

async function closeStale() {
  await ensureSchema();
  await query(
    `UPDATE idle_events
        SET ended_at=updated_at, duration_seconds=GREATEST(0, EXTRACT(EPOCH FROM (updated_at-started_at))::int)
      WHERE ended_at IS NULL AND updated_at < NOW() - INTERVAL '${STALE_MIN} minutes'`).catch(() => {});
  await query(`DELETE FROM idle_events WHERE ended_at IS NOT NULL AND duration_seconds < $1`, [IDLE_MIN_SEC]).catch(() => {});
}

// Historial + estadísticas de un mes (default: mes actual). Sólo eventos que llegaron al umbral.
async function stats({ mes } = {}) {
  await ensureSchema();
  const now = new Date();
  const yr = mes ? parseInt(mes.split('-')[0]) : now.getFullYear();
  const mo = mes ? parseInt(mes.split('-')[1]) : now.getMonth() + 1;
  const desde = `${yr}-${String(mo).padStart(2, '0')}-01`;
  const lastDay = new Date(yr, mo, 0).getDate();
  const hasta = `${yr}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')} 23:59:59`;

  // Duración efectiva: la registrada, o la corrida hasta ahora si sigue abierto.
  const DUR = `COALESCE(duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(ended_at,NOW())-started_at))::int))`;
  const cond = `started_at BETWEEN $1 AND $2 AND ${DUR} >= $3`;
  const params = [desde, hasta, IDLE_MIN_SEC];

  const [eventos, porUnidad, precio] = await Promise.all([
    query(`SELECT vehicle_code, base, started_at, ended_at, ${DUR} AS duration_seconds, (ended_at IS NULL) AS en_curso
             FROM idle_events WHERE ${cond} ORDER BY started_at DESC LIMIT 300`, params),
    query(`SELECT vehicle_code, MAX(base) AS base, COUNT(*) AS episodios, SUM(${DUR}) AS total_seconds
             FROM idle_events WHERE ${cond} GROUP BY vehicle_code ORDER BY total_seconds DESC`, params),
    query(`SELECT AVG(price_per_l) AS p FROM fuel_logs
             WHERE price_per_l > 0 AND logged_at >= (CURRENT_DATE - INTERVAL '60 days')`).catch(() => ({ rows: [{}] })),
  ]);

  const precioL = parseFloat(precio.rows[0]?.p) || 0;
  const porUnidadOut = porUnidad.rows.map(r => {
    const seg = parseInt(r.total_seconds) || 0;
    const lh = litrosPorHora(r.vehicle_code);
    const litros = (seg / 3600) * lh;
    return {
      vehicle_code: r.vehicle_code, base: r.base,
      episodios: parseInt(r.episodios) || 0,
      total_seconds: seg,
      litros_por_hora: lh,
      litros_estimados: litros,
    };
  });
  const totalSeg = porUnidadOut.reduce((a, u) => a + u.total_seconds, 0);
  const litros = porUnidadOut.reduce((a, u) => a + u.litros_estimados, 0);

  return {
    periodo: { anio: yr, mes: mo },
    litros_por_hora: LITERS_PER_HOUR,      // default para unidades sin tabla
    umbral_min: Math.round(IDLE_MIN_SEC / 60),
    resumen: {
      total_seconds: totalSeg,
      episodios: porUnidadOut.reduce((a, u) => a + u.episodios, 0),
      unidades: porUnidadOut.length,
      litros_estimados: litros,
      costo_estimado: litros * precioL,
      precio_litro: precioL,
    },
    por_unidad: porUnidadOut,
    eventos: eventos.rows,
  };
}

module.exports = { ensureSchema, processVehicle, closeStale, stats, IDLE_SPEED };
