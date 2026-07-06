// Endpoints de notificaciones push. La suscripción es solo para dueños
// (son quienes reciben las alertas de velocidad).
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const push = require('../services/push');

// Clave pública VAPID + si el push está configurado en el server.
router.get('/public-key', (req, res) => {
  res.json({ publicKey: push.getPublicKey(), enabled: push.pushEnabled(), limite_kmh: push.SPEED_LIMIT });
});

// Guardar la suscripción del navegador del dueño.
router.post('/subscribe', authenticate, async (req, res) => {
  if (req.user?.role !== 'dueno') return res.status(403).json({ error: 'Solo los dueños pueden activar alertas' });
  try {
    const sub = req.body?.subscription || req.body;
    await push.saveSubscription(req.user.id, sub);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Baja de una suscripción (por endpoint).
router.post('/unsubscribe', authenticate, async (req, res) => {
  try {
    await push.removeSubscription(req.body?.endpoint);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
