// ════════════════════════════════════════════════════════════════════
//  Notificaciones push (Web Push / VAPID)
//  Se usa para avisar a los DUEÑOS cuando una unidad supera el límite de
//  velocidad, aunque no tengan la app abierta. Requiere en el entorno:
//    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   (generadas con web-push)
//    VAPID_SUBJECT (opcional, mailto: o url)
//    SPEED_ALERT_KMH (opcional, default 80)
//  Si no están las claves, todo queda deshabilitado silenciosamente.
// ════════════════════════════════════════════════════════════════════
const webpush = require('web-push');
const { query } = require('../db/pool');

const PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT     || 'mailto:info@expresobiletta.com';
const SPEED_LIMIT = parseInt(process.env.SPEED_ALERT_KMH || '80', 10) || 80;

let _configured = false;
function pushEnabled() {
  if (!PUBLIC || !PRIVATE) return false;
  if (!_configured) { webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE); _configured = true; }
  return true;
}
function getPublicKey() { return PUBLIC; }

let _schemaReady = false;
async function ensurePushSchema() {
  if (_schemaReady) return;
  await query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(() => {});
  _schemaReady = true;
}

async function saveSubscription(userId, sub) {
  await ensurePushSchema();
  const endpoint = sub && sub.endpoint;
  const keys = (sub && sub.keys) || {};
  if (!endpoint || !keys.p256dh || !keys.auth) throw new Error('Suscripción inválida');
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth`,
    [userId, endpoint, keys.p256dh, keys.auth]);
}

async function removeSubscription(endpoint) {
  await ensurePushSchema();
  if (endpoint) await query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]);
}

// Envía una notificación a todos los dueños activos con suscripción.
async function notifyDuenos(payload) {
  if (!pushEnabled()) return 0;
  await ensurePushSchema();
  const subs = await query(
    `SELECT s.endpoint, s.p256dh, s.auth
       FROM push_subscriptions s JOIN users u ON u.id = s.user_id
      WHERE u.role = 'dueno' AND u.active = TRUE`);
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(subs.rows.map(async (row) => {
    const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    try { await webpush.sendNotification(sub, body); sent++; }
    catch (e) {
      // 404/410 = suscripción muerta (navegador desinstalado / permiso revocado): limpiarla.
      if (e.statusCode === 404 || e.statusCode === 410) {
        await query('DELETE FROM push_subscriptions WHERE endpoint=$1', [row.endpoint]).catch(() => {});
      } else {
        console.error('[push] envío falló:', e.statusCode || e.message);
      }
    }
  }));
  return sent;
}

// Anti-spam: por unidad, no repetir el aviso dentro de la ventana de enfriamiento
// (en memoria, por proceso — alcanza para no bombardear cada 5 min de sync GPS).
const _lastAlert = new Map();
const COOLDOWN_MS = 15 * 60 * 1000;

// Llamar por cada unidad en cada sync del GPS. Sólo dispara si supera el límite.
async function maybeAlertSpeeding(vehicle, speed) {
  if (!pushEnabled()) return;
  const kmh = Math.round(parseFloat(speed) || 0);
  if (kmh <= SPEED_LIMIT) return;
  const key = vehicle.code || vehicle.plate || 'unidad';
  const now = Date.now();
  if (now - (_lastAlert.get(key) || 0) < COOLDOWN_MS) return;
  _lastAlert.set(key, now);
  try {
    await notifyDuenos({
      title: '⚠ Exceso de velocidad',
      body: `${key} circulando a ${kmh} km/h (límite ${SPEED_LIMIT})`,
      tag: `speed-${key}`,
      url: '/',
    });
  } catch (e) { console.error('[push] alerta velocidad:', e.message); }
}

module.exports = {
  pushEnabled, getPublicKey, ensurePushSchema,
  saveSubscription, removeSubscription, notifyDuenos, maybeAlertSpeeding,
  SPEED_LIMIT,
};
