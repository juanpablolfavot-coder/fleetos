const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// GET /api/sucursales -> lista sucursales con sus areas
router.get('/', authenticate, async (req, res) => {
  try {
    const r = await query(
      "SELECT s.id, s.nombre, s.activo, " +
      "  COALESCE(" +
      "    (SELECT json_agg(sa.area ORDER BY sa.area) " +
      "       FROM sucursal_areas sa " +
      "      WHERE sa.sucursal_id = s.id AND sa.activo = true), " +
      "    '[]'::json" +
      "  ) AS areas " +
      "FROM sucursales s " +
      "WHERE s.activo = true " +
      "ORDER BY s.nombre"
    );
    res.json(r.rows);
  } catch (e) {
    console.error('GET /sucursales error:', e);
    res.status(500).json({ error: 'Error al listar sucursales' });
  }
});

module.exports = router;
