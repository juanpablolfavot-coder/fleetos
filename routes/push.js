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

// Disparar el resumen de flota AHORA (solo dueño). Sirve para probar sin
// esperar a que llegue la hora: saltea la ventana horaria y el intervalo.
router.post('/resumen-ahora', authenticate, async (req, res) => {
  if (req.user?.role !== 'dueno') return res.status(403).json({ error: 'Solo los dueños' });
  try {
    const r = await require('../services/resumen-flota').generarYEnviarResumen({ force: true });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Diagnóstico: por qué no llega nada ────────────────────────────────
// Junta en una sola respuesta lo que hay que mirar cuando el dueño dice que
// no le llegan las alertas: si el server tiene claves, cuántos dispositivos
// están anotados (los suyos y los de todos los dueños), si el GPS está
// sondeando y cuándo fue el último exceso registrado.
router.get('/estado', authenticate, async (req, res) => {
  if (req.user?.role !== 'dueno') return res.status(403).json({ error: 'Solo los dueños' });
  try {
    const [estadoPush, excesos] = await Promise.all([
      push.estado(req.user.id),
      require('../services/speeding').listEvents({ limit: 5 }),
    ]);
    const gps = require('../services/gps-powerfleet').getGPSStatus();
    res.json({
      push: estadoPush,
      gps: { ultimo_sync: gps.lastSync, ultimo_resultado: gps.lastResult, intervalo: gps.interval },
      webhook_configurado: require('../services/webhook-powerfleet').configurado(),
      ultimos_excesos: excesos,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manda una notificación de prueba a los dispositivos de ESTE usuario.
// Contesta cuántos la recibieron y, si ninguno, por qué: es la forma de saber
// en un toque si el canal funciona sin esperar a que un camión se pase.
router.post('/probar', authenticate, async (req, res) => {
  if (req.user?.role !== 'dueno') return res.status(403).json({ error: 'Solo los dueños' });
  try {
    const r = await push.enviarAUsuario(req.user.id, {
      title: '🔔 Prueba de FleetOS',
      body: 'Si ves esto, las alertas de velocidad llegan a este dispositivo.',
      tag: 'fleetos-prueba',
      url: '/',
    });
    let mensaje;
    if (!r.enabled)            mensaje = 'El servidor no tiene las claves de notificación (VAPID) cargadas.';
    else if (!r.dispositivos)  mensaje = 'Este usuario no tiene ningún dispositivo con las alertas activadas.';
    else if (!r.sent)          mensaje = `No se pudo enviar a ${r.dispositivos} dispositivo(s): ${r.errores[0]}`;
    else                       mensaje = `Enviada a ${r.sent} de ${r.dispositivos} dispositivo(s).`;
    res.json({ ok: r.sent > 0, ...r, mensaje });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Baja de una suscripción (por endpoint).
router.post('/unsubscribe', authenticate, async (req, res) => {
  try {
    await push.removeSubscription(req.body?.endpoint);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
