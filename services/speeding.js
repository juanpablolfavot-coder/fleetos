// ════════════════════════════════════════════════════════════════════
//  Eventos de exceso de velocidad
//  Abre un evento cuando una unidad CRUZA el límite, lo mantiene mientras
//  sigue excedida, y lo cierra cuando baja (con histéresis para no "parpadear"
//  alrededor del límite). Manda UNA notificación push por evento (al abrirlo).
//  Guarda historial con duración y velocidad máxima.
// ════════════════════════════════════════════════════════════════════
const { query } = require('../db/pool');
const push = require('./push');

const HYST = 5;        // km/h por debajo del límite para dar por cerrado el evento
const STALE_MIN = 15;  // cerrar eventos abiertos sin actualización hace N min (unidad sin reporte)

// Remolcados (semirremolque / acoplado): no tienen motor propio. El GPS reporta la
// velocidad del camión que los arrastra, así que NO deben disparar alerta de exceso.
function esRemolcado(type) {
  const t = String(type || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return t.includes('remolque') || t.includes('acoplad');
}

let _ready = false;
async function ensureSchema() {
  if (_ready) return;
  await query(`CREATE TABLE IF NOT EXISTS speeding_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_code  VARCHAR(30),
    vehicle_plate VARCHAR(30),
    base          VARCHAR(100),
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at      TIMESTAMPTZ,
    max_speed     NUMERIC(6,1) NOT NULL DEFAULT 0,
    limit_kmh     INTEGER NOT NULL DEFAULT 80,
    duration_seconds INTEGER
  )`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_speeding_open ON speeding_events(vehicle_code) WHERE ended_at IS NULL`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_speeding_started ON speeding_events(started_at DESC)`).catch(() => {});
  _ready = true;
}

// Procesa una lectura de una unidad. Abre/actualiza/cierra el evento según la velocidad.
async function processVehicle(v, speed) {
  const LIMIT = push.SPEED_LIMIT || 80;
  const s = Math.round(parseFloat(speed) || 0);
  const code = v && (v.code || v.plate);
  if (!code) return;
  // Los semirremolques / acoplados no generan alerta (velocidad del camión que los tira).
  if (esRemolcado(v.type)) return;
  await ensureSchema();

  const openRes = await query(
    'SELECT id FROM speeding_events WHERE vehicle_code=$1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1', [code]);
  const open = openRes.rows[0];

  if (s > LIMIT) {
    if (open) {
      await query('UPDATE speeding_events SET max_speed=GREATEST(max_speed,$1), updated_at=NOW() WHERE id=$2', [s, open.id]);
    } else {
      await query(
        `INSERT INTO speeding_events (vehicle_code, vehicle_plate, base, max_speed, limit_kmh) VALUES ($1,$2,$3,$4,$5)`,
        [code, v.plate || null, v.base || null, s, LIMIT]);
      // Una notificación por evento (al abrirlo).
      await push.notifyDuenos({
        title: '⚠ Exceso de velocidad',
        body: `${code} a ${s} km/h${v.base ? ' — ' + v.base : ''} (límite ${LIMIT})`,
        tag: `speed-${code}`,
        url: '/',
      }).catch(() => {});
    }
  } else if (open && s <= LIMIT - HYST) {
    // Bajó claramente: cerrar el evento y calcular la duración.
    await query(
      `UPDATE speeding_events SET ended_at=NOW(),
         duration_seconds=GREATEST(0, EXTRACT(EPOCH FROM (NOW()-started_at))::int)
       WHERE id=$1`, [open.id]);
  } else if (open) {
    // Banda de histéresis (entre límite-5 y límite): mantener vivo el evento.
    await query('UPDATE speeding_events SET updated_at=NOW() WHERE id=$1', [open.id]);
  }
}

// Cierra eventos que quedaron abiertos porque la unidad dejó de reportar.
async function closeStale() {
  await ensureSchema();
  await query(
    `UPDATE speeding_events
        SET ended_at=updated_at, duration_seconds=GREATEST(0, EXTRACT(EPOCH FROM (updated_at-started_at))::int)
      WHERE ended_at IS NULL AND updated_at < NOW() - INTERVAL '${STALE_MIN} minutes'`).catch(() => {});
}

// Lista para el historial (panel de auditoría).
async function listEvents({ desde, hasta, limit = 200 } = {}) {
  await ensureSchema();
  const params = []; const parts = [];
  if (desde) { params.push(desde); parts.push(`started_at >= $${params.length}`); }
  if (hasta) { params.push(hasta + ' 23:59:59'); parts.push(`started_at <= $${params.length}`); }
  const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';
  params.push(Math.min(Math.max(parseInt(limit) || 200, 1), 1000));
  const r = await query(
    `SELECT id, vehicle_code, vehicle_plate, base, started_at, ended_at, max_speed, limit_kmh,
        COALESCE(duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(ended_at,NOW())-started_at))::int)) AS duration_seconds,
        (ended_at IS NULL) AS en_curso
       FROM speeding_events ${where}
      ORDER BY started_at DESC LIMIT $${params.length}`, params);
  return r.rows;
}

module.exports = { ensureSchema, processVehicle, closeStale, listEvents };
