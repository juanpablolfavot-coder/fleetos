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


// GET /api/sucursales/:sucursal/areas -> áreas de una sucursal por nombre
router.get('/:sucursal/areas', authenticate, async (req, res) => {
  try {
    const nombre = String(req.params.sucursal || '').trim();
    if (!nombre) return res.json(['Administración','Depósito','Taller','Mantenimiento','Flota']);

    const r = await query(
      `SELECT COALESCE(json_agg(sa.area ORDER BY sa.area), '[]'::json) AS areas
         FROM sucursales s
         LEFT JOIN sucursal_areas sa ON sa.sucursal_id = s.id AND sa.activo = true
        WHERE s.activo = true
          AND LOWER(translate(s.nombre,'áéíóúÁÉÍÓÚñÑ','aeiouAEIOUnN')) = LOWER(translate($1,'áéíóúÁÉÍÓÚñÑ','aeiouAEIOUnN'))`,
      [nombre]
    );
    let areas = r.rows[0]?.areas || [];
    if (!Array.isArray(areas)) areas = [];
    if (!areas.length) areas = ['Administración','Depósito','Taller','Mantenimiento','Flota'];
    res.json(areas);
  } catch (e) {
    console.error('GET /sucursales/:sucursal/areas error:', e.message || e);
    res.status(500).json({ error: 'Error al listar áreas de sucursal' });
  }
});


module.exports = router;
