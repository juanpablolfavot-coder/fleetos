// ═══════════════════════════════════════════════════════════
//  FleetOS — Auditoría global de mutaciones
//
//  Registra en audit_log TODA acción que modifica datos (POST/PUT/PATCH/DELETE)
//  sobre la API, sin necesidad de instrumentar endpoint por endpoint. Cubre
//  combustible, stock, pagos, compras, proveedores, usuarios, OT, GPS, etc.
//
//  - No corre en GET (no son mutaciones) ni si la respuesta fue error (>=400).
//  - No audita /api/auth (passwords/tokens).
//  - No pisa la auditoría detallada: si un endpoint ya marcó res.locals._audited
//    (vía auditAction), este logger se saltea para no duplicar.
//  - El cuerpo se guarda REDACTADO: se omiten claves sensibles/pesadas
//    (passwords, tokens, imágenes base64, archivos) y se truncan los strings largos.
//  - Nunca rompe el request: cualquier error de logging se traga.
// ═══════════════════════════════════════════════════════════

const { query } = require('../db/pool');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Claves que NO se deben guardar (secretos o datos pesados como imágenes base64).
const REDACT_KEY_RE = /pass|token|secret|hash|image|imagen|file_url|presupuesto|ticket_image|foto|adjunto|base64/i;

function redactBody(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  for (const k of Object.keys(body)) {
    if (REDACT_KEY_RE.test(k)) { out[k] = '[omitido]'; continue; }
    const v = body[k];
    if (v == null) { out[k] = v; }
    else if (typeof v === 'string') { out[k] = v.length > 200 ? v.slice(0, 200) + '…' : v; }
    else if (Array.isArray(v)) { out[k] = `[array(${v.length})]`; }
    else if (typeof v === 'object') { out[k] = '[obj]'; }
    else { out[k] = v; }
  }
  return out;
}

const auditMutations = (req, res, next) => {
  const method = req.method;
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') {
    return next();
  }

  res.on('finish', () => {
    try {
      if (res.statusCode >= 400) return;                 // solo acciones exitosas
      if (res.locals && res.locals._audited) return;     // ya lo registró auditAction (detallado)
      // El middleware está montado en '/api/', así que req.path viene SIN el prefijo
      // (/auth/login en vez de /api/auth/login). Usamos originalUrl para tener la ruta real.
      const fullPath = (req.originalUrl || req.url || '').split('?')[0];
      if (/^\/api\/auth\//.test(fullPath)) return;       // no auditar login/refresh/password

      const seg = fullPath.split('/').filter(Boolean);   // ['api','stock','<id>','egreso']
      const tabla = (seg[1] || 'api').slice(0, 100);
      const recordId = seg.find(s => UUID_RE.test(s)) || null;

      let newValue = null;
      try { newValue = JSON.stringify(redactBody(req.body)); } catch (_) { newValue = null; }

      query(
        `INSERT INTO audit_log (user_id, user_name, action, table_name, record_id, new_value, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          req.user?.id || null,
          req.user?.name || null,
          method,
          tabla,
          recordId,
          newValue,
          req.ip,
          (req.headers['user-agent'] || '').substring(0, 200),
        ]
      ).catch(e => console.error('[audit global]', e.message));
    } catch (e) {
      console.error('[audit global]', e.message);
    }
  });

  next();
};

// ───────────────────────────────────────────────────────────
//  Auditoría FUERTE para mutaciones sensibles (km, stock, pagos, OC).
//  A diferencia del logger global (que guarda el cuerpo del request como
//  new_value), esto registra el VALOR ANTERIOR y el posterior reales —para
//  poder reconstruir de qué a qué cambió y detectar manipulaciones—.
//  Marca res.locals._audited para que el logger global no duplique.
// ───────────────────────────────────────────────────────────
async function auditChange(req, res, { action, table, recordId = null, oldValue = null, newValue = null, markAudited = true }) {
  try {
    // markAudited=false: para eventos SECUNDARIOS (p.ej. el bump de km dentro de
    // una carga de combustible) — así el logger global sigue registrando la
    // acción principal (la carga) además de este detalle.
    if (markAudited && res && res.locals) res.locals._audited = true;
    await query(
      `INSERT INTO audit_log (user_id, user_name, action, table_name, record_id, old_value, new_value, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        req.user?.id || null,
        req.user?.name || null,
        String(action).slice(0, 50),
        String(table).slice(0, 100),
        recordId,
        oldValue != null ? JSON.stringify(oldValue) : null,
        newValue != null ? JSON.stringify(newValue) : null,
        req.ip,
        (req.headers['user-agent'] || '').substring(0, 200),
      ]
    );
  } catch (e) {
    console.error('[auditChange]', e.message);
  }
}

module.exports = { auditMutations, redactBody, auditChange };
