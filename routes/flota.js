// ════════════════════════════════════════════════════════════════════
//  Control en vivo de la flota — SOLO DUEÑOS
//
//  Capa fina sobre services/flota-datos.js: las consultas viven ahí porque
//  las comparte con el asistente, y así la pantalla y las respuestas del
//  asistente no pueden dar números distintos.
//
//  Ninguno de estos endpoints llama a Powerfleet: todo sale de lo que el
//  sync del GPS ya guarda cada 2 minutos.
// ════════════════════════════════════════════════════════════════════
const router = require('express').Router();
const datos = require('../services/flota-datos');
const asistente = require('../services/asistente-flota');
const { authenticate, requireRole } = require('../middleware/auth');

// ── Dónde está cada unidad, ahora ─────────────────────────────────────
router.get('/ahora', authenticate, requireRole('dueno'), async (req, res) => {
  try {
    res.json(await datos.estadoFlota());
  } catch (err) {
    console.error('flota/ahora:', err.message);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── Lo que pasó: excesos y ralentí en una línea de tiempo ─────────────
router.get('/eventos', authenticate, requireRole('dueno'), async (req, res) => {
  try {
    res.json(await datos.eventos({ horas: req.query.horas }));
  } catch (err) {
    console.error('flota/eventos:', err.message);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── Preguntar en criollo ──────────────────────────────────────────────
// El modelo tiene herramientas para consultar la flota, así que decide solo
// qué mirar según lo que le preguntes.
router.post('/preguntar', authenticate, requireRole('dueno'), async (req, res) => {
  try {
    const r = await asistente.preguntar(req.body?.pregunta, req.body?.historial);
    res.json(r);
  } catch (err) {
    // Falta de configuración y pregunta vacía son situaciones del usuario, no
    // fallas del servidor: se distinguen para poder decir qué hacer.
    if (err.code === 'SIN_API_KEY')   return res.status(503).json({ error: err.message });
    if (err.code === 'SIN_PREGUNTA')  return res.status(400).json({ error: err.message });
    if (err.code === 'RECHAZADA')     return res.status(422).json({ error: err.message });
    console.error('flota/preguntar:', err.message);
    res.status(500).json({ error: 'El asistente no pudo responder. Probá de nuevo en un momento.' });
  }
});

module.exports = router;
