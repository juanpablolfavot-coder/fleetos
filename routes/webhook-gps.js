// ════════════════════════════════════════════════════════════════════
//  Receptor del webhook de Powerfleet
//
//  Este es el ÚNICO endpoint de FleetOS que atiende sin sesión: lo llama una
//  máquina del proveedor, que no tiene usuario ni token nuestro. La puerta es
//  el secreto que va en la propia URL (GPS_WEBHOOK_SECRET), el mismo que se
//  registra del lado de Powerfleet.
//
//  Se monta ANTES del rate limit, de hpp/sanitize y de la auditoría (ver
//  server.js): sanitize le tocaría el payload que justamente queremos guardar
//  tal cual llegó, la auditoría escribiría una fila de audit_log por alerta, y
//  el rate limit podría descartar avisos en una ráfaga (y un aviso descartado
//  es una notificación que nunca sale).
// ════════════════════════════════════════════════════════════════════
const router = require('express').Router();
const webhook = require('../services/webhook-powerfleet');
const { authenticate, requireRole } = require('../middleware/auth');

// ── Diagnóstico: qué llegó realmente ──────────────────────────────────
// Va primero para que no lo tape la ruta con parámetro de abajo.
// Es lo que permite ver el formato del payload sin entrar al servidor.
router.get('/ultimos', authenticate, requireRole('dueno'), async (req, res) => {
  try {
    res.json(await webhook.ultimos(req.query.limite));
  } catch (err) {
    console.error('webhook/ultimos:', err.message);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── El aviso del proveedor ────────────────────────────────────────────
// Contesta 200 salvo que el secreto no coincida. Es a propósito: si le
// devolvemos un error a Powerfleet por un payload que no supimos leer, puede
// reintentar en loop o dar de baja la suscripción por su cuenta. El aviso ya
// quedó guardado crudo, que es lo que importa.
router.post('/:secreto', async (req, res) => {
  if (!webhook.configurado()) {
    return res.status(503).json({ error: 'Webhook no configurado' });
  }
  if (!webhook.secretoOk(req.params.secreto)) {
    console.warn('[webhook] rechazado: secreto inválido desde', req.ip);
    return res.status(403).json({ error: 'No autorizado' });
  }
  try {
    const r = await webhook.procesar(req.body);
    console.log(`[webhook] #${r.id} ${r.resultado}`);
    res.json({ ok: true });
  } catch (err) {
    // Ni siquiera se pudo guardar (base caída, payload gigante): se registra
    // acá y se contesta 200 igual, para no arrastrar la suscripción.
    console.error('[webhook] error procesando:', err.message);
    res.json({ ok: true });
  }
});

// Algunos proveedores validan la URL con un GET antes de activar la
// suscripción. Contestar 200 evita que el alta falle por eso.
router.get('/:secreto', (req, res) => {
  if (!webhook.secretoOk(req.params.secreto)) return res.status(403).json({ error: 'No autorizado' });
  res.json({ ok: true, servicio: 'FleetOS webhook GPS' });
});

module.exports = router;
