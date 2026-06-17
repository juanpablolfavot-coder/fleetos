const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

async function ensureSchema() {
  await query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  // Defensa para bases viejas: si el deploy llegó antes que el schema completo,
  // evitamos 500 en pantallas que solo necesitan listar sucursales/áreas.
  await query(`
    CREATE TABLE IF NOT EXISTS sucursales (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      nombre VARCHAR(200) NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS sucursal_areas (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      sucursal_id UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
      area VARCHAR(200) NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_sucursal_areas_sucursal ON sucursal_areas(sucursal_id)`);
}

function uniqueAreas(rows) {
  const seen = new Set();
  return rows
    .map(r => String(r.area || '').trim())
    .filter(Boolean)
    .filter(a => {
      const k = a.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// GET /api/sucursales -> lista sucursales con sus áreas
router.get('/', authenticate, async (req, res) => {
  try {
    await ensureSchema();
    const r = await query(
      `SELECT s.id, s.nombre, s.activo,
              COALESCE(
                (SELECT json_agg(sa.area ORDER BY sa.area)
                   FROM sucursal_areas sa
                  WHERE sa.sucursal_id = s.id AND sa.activo = true),
                '[]'::json
              ) AS areas
         FROM sucursales s
        WHERE s.activo = true
        ORDER BY s.nombre`
    );
    res.json(r.rows);
  } catch (e) {
    console.error('GET /sucursales error:', e);
    res.status(500).json({ error: 'Error al listar sucursales' });
  }
});

// GET /api/sucursales/:sucursal/areas
// Lo usa el modal de "Nueva solicitud de compra" del gerente de sucursal.
// Antes no existía y por eso aparecía 404 al abrir/seleccionar sucursal.
router.get('/:sucursal/areas', authenticate, async (req, res) => {
  try {
    await ensureSchema();
    const sucursalParam = decodeURIComponent(String(req.params.sucursal || '')).trim();
    if (!sucursalParam) return res.json([]);

    const r = await query(
      `SELECT sa.area
         FROM sucursales s
         JOIN sucursal_areas sa ON sa.sucursal_id = s.id
        WHERE s.activo = true
          AND sa.activo = true
          AND (
                s.id::text = $1
             OR LOWER(TRIM(s.nombre)) = LOWER(TRIM($1))
          )
        ORDER BY sa.area`,
      [sucursalParam]
    );

    const areas = uniqueAreas(r.rows);

    // Si la sucursal existe pero todavía no tiene áreas cargadas,
    // devolvemos una lista base para que el gerente pueda enviar la solicitud
    // sin romper la pantalla.
    if (!areas.length) {
      return res.json(['Administración', 'Depósito', 'Taller', 'Mantenimiento', 'Flota']);
    }

    res.json(areas);
  } catch (e) {
    console.error('GET /sucursales/:sucursal/areas error:', e);
    // No conviene bloquear la OC por esto; devolvemos áreas base.
    res.json(['Administración', 'Depósito', 'Taller', 'Mantenimiento', 'Flota']);
  }
});

module.exports = router;
