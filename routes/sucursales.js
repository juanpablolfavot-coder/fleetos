const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

// Solo dueño/gerencia administran sucursales
const canManage = requireRole('dueno', 'gerencia');

async function ensureSucursalSchema() {
  await query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).catch(()=>{});
  await query(`CREATE TABLE IF NOT EXISTS sucursales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre VARCHAR(200) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(()=>{});
  await query(`CREATE TABLE IF NOT EXISTS sucursal_areas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sucursal_id UUID REFERENCES sucursales(id) ON DELETE CASCADE,
    area VARCHAR(200) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE
  )`).catch(()=>{});
}

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


// POST /api/sucursales -> crear sucursal (dueño/gerencia)
router.post('/', authenticate, canManage, async (req, res) => {
  try {
    await ensureSucursalSchema();
    const nombre = String(req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre de la sucursal' });
    const dup = await query(
      `SELECT id FROM sucursales WHERE activo=true AND LOWER(TRIM(nombre))=LOWER($1)`, [nombre]
    );
    if (dup.rows[0]) return res.status(409).json({ error: 'Ya existe una sucursal con ese nombre' });
    const r = await query(`INSERT INTO sucursales (nombre) VALUES ($1) RETURNING id, nombre, activo`, [nombre]);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('POST /sucursales:', e.message || e);
    res.status(500).json({ error: 'Error al crear sucursal' });
  }
});

// PATCH /api/sucursales/:id -> renombrar y/o activar/desactivar (dueño/gerencia)
router.patch('/:id', authenticate, canManage, async (req, res) => {
  try {
    await ensureSucursalSchema();
    const sets = []; const params = [];
    if (req.body.nombre !== undefined) {
      const nombre = String(req.body.nombre || '').trim();
      if (!nombre) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
      params.push(nombre); sets.push(`nombre=$${params.length}`);
    }
    if (req.body.activo !== undefined) { params.push(!!req.body.activo); sets.push(`activo=$${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });
    params.push(req.params.id);
    const r = await query(`UPDATE sucursales SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING id, nombre, activo`, params);
    if (!r.rows[0]) return res.status(404).json({ error: 'Sucursal no encontrada' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('PATCH /sucursales:', e.message || e);
    res.status(500).json({ error: 'Error al actualizar sucursal' });
  }
});

// POST /api/sucursales/migrar -> mover todos los registros de una sucursal a otra
// y desactivar la de origen. Body: { de, a }  (nombres de sucursal)
router.post('/migrar', authenticate, canManage, async (req, res) => {
  try {
    await ensureSucursalSchema();
    const de = String(req.body.de || '').trim();
    const a  = String(req.body.a  || '').trim();
    if (!de || !a) return res.status(400).json({ error: 'Faltan las sucursales de origen y destino' });
    if (de.toLowerCase() === a.toLowerCase()) return res.status(400).json({ error: 'Origen y destino deben ser distintos' });

    // Mover todas las referencias que guardan la sucursal por nombre
    const movidos = {};
    movidos.usuarios          = (await query(`UPDATE users           SET sucursal=$1      WHERE sucursal=$2`,      [a, de])).rowCount;
    movidos.ordenes_compra    = (await query(`UPDATE purchase_orders  SET sucursal=$1      WHERE sucursal=$2`,      [a, de])).rowCount;
    movidos.items_stock       = (await query(`UPDATE stock_items      SET base_location=$1 WHERE base_location=$2`, [a, de])).rowCount;
    movidos.movimientos_stock = (await query(`UPDATE stock_movements  SET base_location=$1 WHERE base_location=$2`, [a, de])).rowCount;
    movidos.cisternas         = (await query(`UPDATE tanks            SET location=$1      WHERE location=$2`,      [a, de]).catch(()=>({rowCount:0}))).rowCount;

    // Desactivar la sucursal de origen (si existe en la tabla)
    await query(`UPDATE sucursales SET activo=false WHERE LOWER(TRIM(nombre))=LOWER($1)`, [de]);

    res.json({ ok: true, de, a, movidos });
  } catch (e) {
    console.error('POST /sucursales/migrar:', e.message || e);
    res.status(500).json({ error: 'Error al migrar la sucursal' });
  }
});

module.exports = router;

// ════════════════════════════════════════════════════════════════
//  Limpieza ÚNICA de sucursales (se ejecuta una sola vez por base).
//  Saca 'Central' y la 'Río Tercero' duplicada, migrando todos sus
//  registros a 'Río Tercero (Casa Central)'. Idempotente: usa un flag
//  en app_config para no volver a correr. No borra datos.
// ════════════════════════════════════════════════════════════════
async function runSucursalCleanupOnce() {
  try {
    await query(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value JSONB NOT NULL)`).catch(()=>{});
    const flag = await query(`SELECT 1 FROM app_config WHERE key='sucursal_cleanup_v1'`);
    if (flag.rows[0]) return; // ya se aplicó

    const CASA = 'Río Tercero (Casa Central)';
    const BAD  = ['Central', 'Río Tercero'];

    await query(`UPDATE users           SET sucursal=$1      WHERE sucursal      = ANY($2)`, [CASA, BAD]).catch(()=>{});
    await query(`UPDATE purchase_orders SET sucursal=$1      WHERE sucursal      = ANY($2)`, [CASA, BAD]).catch(()=>{});
    await query(`UPDATE stock_movements SET base_location=$1 WHERE base_location = ANY($2)`, [CASA, BAD]).catch(()=>{});
    await query(`UPDATE tanks           SET location=$1      WHERE location      = ANY($2)`, [CASA, BAD]).catch(()=>{});
    // Stock: solo los códigos que no choquen con uno ya existente en la Casa Central
    await query(`
      UPDATE stock_items s SET base_location=$1
       WHERE s.base_location = ANY($2)
         AND NOT EXISTS (
           SELECT 1 FROM stock_items d
            WHERE d.active=TRUE AND d.base_location=$1 AND d.area=s.area AND UPPER(d.code)=UPPER(s.code)
         )`, [CASA, BAD]).catch(()=>{});
    // Desactivar las sucursales que se sacan (no se borran)
    await query(`UPDATE sucursales SET activo=false WHERE nombre = ANY($1)`, [BAD]).catch(()=>{});

    await query(`INSERT INTO app_config(key,value) VALUES('sucursal_cleanup_v1','true') ON CONFLICT(key) DO NOTHING`);
    console.log('[sucursales] limpieza única aplicada: Central / Río Tercero → Río Tercero (Casa Central)');
  } catch (e) {
    console.error('[sucursales cleanup]', e.message);
  }
}
ensureSucursalSchema().then(runSucursalCleanupOnce).catch(()=>{});
