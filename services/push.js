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

// ── Envío ─────────────────────────────────────────────────────────────
// Un mismo usuario puede tener varios dispositivos: le llega a todos.
// Devuelve cuántas salieron y POR QUÉ no salieron las demás. Antes esto sólo
// devolvía un número y el que lo llamaba lo ignoraba: si el push estaba
// desactivado, o no había ningún dispositivo suscripto, o el servicio de push
// rechazaba las claves, el exceso quedaba anotado como "notificado" igual y
// nadie se enteraba de que la alerta nunca salió.
async function _enviar(rows, payload) {
  const body = JSON.stringify(payload);
  let sent = 0;
  const errores = [];
  await Promise.all(rows.map(async (row) => {
    const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    try { await webpush.sendNotification(sub, body); sent++; }
    catch (e) {
      const st = e.statusCode;
      if (st === 404 || st === 410) {
        // Suscripción muerta (navegador desinstalado / permiso revocado): limpiarla.
        await query('DELETE FROM push_subscriptions WHERE endpoint=$1', [row.endpoint]).catch(() => {});
        errores.push('suscripción vencida: ese dispositivo tiene que volver a activar las alertas');
      } else if (st === 401 || st === 403) {
        // El servicio de push (Google/Apple) no reconoce nuestra firma: las
        // claves VAPID del server no son las que tenía el navegador cuando se
        // suscribió. Pasa si se regeneraron las claves en el Environment. La
        // suscripción no sirve más hasta que el dispositivo vuelva a activar
        // las alertas (la app lo detecta sola al abrirse).
        errores.push(`el servicio de push rechazó las claves VAPID (HTTP ${st}): hay que volver a activar las alertas en ese dispositivo`);
        console.error(`[push] HTTP ${st} al enviar: las claves VAPID del server no coinciden con las de la suscripción`);
      } else {
        errores.push(`HTTP ${st || '?'}: ${e.message || 'error de envío'}`);
        console.error('[push] envío falló:', st || e.message);
      }
    }
  }));
  return { sent, errores };
}

let _avisoDesactivado = false;
function _resultadoDesactivado() {
  if (!_avisoDesactivado) {
    _avisoDesactivado = true;
    console.warn('[push] DESACTIVADO: faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en el Environment — no sale ninguna notificación');
  }
  return { enabled: false, dispositivos: 0, sent: 0, errores: [] };
}

// Envía a todos los usuarios activos de los roles indicados. Devuelve el detalle.
async function enviarARoles(roles, payload) {
  if (!pushEnabled()) return _resultadoDesactivado();
  const lista = (Array.isArray(roles) ? roles : [roles]).filter(Boolean);
  if (!lista.length) return { enabled: true, dispositivos: 0, sent: 0, errores: [] };
  await ensurePushSchema();
  const subs = await query(
    `SELECT s.endpoint, s.p256dh, s.auth
       FROM push_subscriptions s JOIN users u ON u.id = s.user_id
      WHERE u.role = ANY($1) AND u.active = TRUE`, [lista]);
  const r = await _enviar(subs.rows, payload);
  return { enabled: true, dispositivos: subs.rows.length, ...r };
}

// Envía sólo a los dispositivos de UN usuario (la prueba desde la app).
async function enviarAUsuario(userId, payload) {
  if (!pushEnabled()) return _resultadoDesactivado();
  await ensurePushSchema();
  const subs = await query(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=$1', [userId]);
  const r = await _enviar(subs.rows, payload);
  return { enabled: true, dispositivos: subs.rows.length, ...r };
}

// Una frase que dice si la alerta salió y, si no, por qué. Es lo que queda en
// el log del server y en el resultado del webhook, para poder mirar después
// "el exceso se registró, ¿y la notificación?".
function describirEnvio(r) {
  if (!r || !r.enabled) return 'SIN notificación: push desactivado (faltan las claves VAPID en el Environment)';
  if (!r.dispositivos) return 'SIN notificación: ningún dispositivo de dueño tiene las alertas activadas';
  const n = r.dispositivos;
  if (!r.sent) return `SIN notificación: falló el envío a ${n} dispositivo${n === 1 ? '' : 's'} — ${r.errores[0] || 'sin detalle'}`;
  if (r.sent < n) return `notificación a ${r.sent} de ${n} dispositivos (${r.errores[0] || 'sin detalle'})`;
  return `notificación a ${n} dispositivo${n === 1 ? '' : 's'}`;
}

// Compatibilidad: quienes ya usaban esto reciben el número de envíos.
async function notifyRoles(roles, payload) {
  return (await enviarARoles(roles, payload)).sent;
}

// Atajo histórico: las alertas de velocidad y el resumen de flota van solo a los
// dueños. Se mantiene para no tocar a quienes ya lo usan.
function notifyDuenos(payload) {
  return notifyRoles(['dueno'], payload);
}

// ── Estado para el diagnóstico (lo mira el dueño desde la app) ─────────
// Contesta las tres preguntas que hay que hacerse cuando "no llega nada":
// ¿el server tiene claves?, ¿este dispositivo está anotado?, ¿algún dueño lo está?
async function estado(userId) {
  const habilitado = pushEnabled();
  if (!habilitado) return { habilitado, dispositivos_mios: 0, dispositivos_duenos: 0, duenos_activos: 0 };
  await ensurePushSchema();
  const r = await query(
    `SELECT COUNT(*) FILTER (WHERE s.user_id = $1)::int AS dispositivos_mios,
            COUNT(*) FILTER (WHERE u.role = 'dueno' AND u.active = TRUE)::int AS dispositivos_duenos
       FROM push_subscriptions s JOIN users u ON u.id = s.user_id`, [userId]);
  const d = await query(`SELECT COUNT(*)::int AS n FROM users WHERE role='dueno' AND active=TRUE`);
  return { habilitado, ...r.rows[0], duenos_activos: d.rows[0].n };
}

module.exports = {
  pushEnabled, getPublicKey, ensurePushSchema,
  saveSubscription, removeSubscription, notifyDuenos, notifyRoles,
  enviarARoles, enviarAUsuario, describirEnvio, estado,
  SPEED_LIMIT,
};
