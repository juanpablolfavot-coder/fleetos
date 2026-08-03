// ═══════════════════════════════════════════════════════════
//  FleetOS — Activos Patrimoniales (edificios, herramientas,
//  equipos, informática, instalaciones)
//  Todo lo que NO es vehículo de la flota pero se mantiene.
// ═══════════════════════════════════════════════════════════
const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID } = require('../middleware/security');

// Auto-create de la tabla (patrón del resto del proyecto)
// El CREATE TABLE de assets y sus índices que corrían acá al arrancar se
// sacaron: db/schema.sql los declara. Tardaba ~1390 ms en no crear nada.

// GET /api/assets — listar con filtros opcionales
router.get('/', authenticate, async (req, res) => {
  try {
    const { type, status } = req.query;
    let sql = `SELECT * FROM assets WHERE active = TRUE`;
    const params = [];
    if (type)   { params.push(type);   sql += ` AND type = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
    sql += ` ORDER BY code ASC`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch(err) { console.error(err && err.message); res.status(500).json({ error: 'Error del servidor' }); }
});

// GET /api/assets/:id — detalle
router.get('/:id', authenticate, validateUUID('id'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM assets WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Activo no encontrado' });
    res.json(r.rows[0]);
  } catch(err) { console.error(err && err.message); res.status(500).json({ error: 'Error del servidor' }); }
});

// POST /api/assets — crear (solo dueño, gerencia, jefe_mantenimiento)
router.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), auditAction('CREATE','assets'), async (req, res) => {
  try {
    const {
      code, name, type = 'otro', category, location,
      brand, model, serial_no, purchase_date, purchase_price,
      warranty_until, status = 'operativo', notes,
    } = req.body;

    if (!code || !name) return res.status(400).json({ error: 'Código y nombre son obligatorios' });

    // Validar que code no exista
    const exists = await query('SELECT id FROM assets WHERE code = $1 AND active = TRUE', [code.trim()]);
    if (exists.rows[0]) return res.status(409).json({ error: `Ya existe un activo con código "${code}"` });

    const r = await query(
      `INSERT INTO assets (code, name, type, category, location, brand, model, serial_no,
         purchase_date, purchase_price, warranty_until, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11::date,$12,$13) RETURNING *`,
      [code.trim(), name, type, category||null, location||null, brand||null, model||null,
       serial_no||null, purchase_date||null, purchase_price||null, warranty_until||null,
       status, notes||null]
    );
    res.locals.recordId = r.rows[0].id;
    res.status(201).json(r.rows[0]);
  } catch(err) { console.error(err && err.message); res.status(500).json({ error: 'Error del servidor' }); }
});

// PUT /api/assets/:id — actualizar
router.put('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), validateUUID('id'), auditAction('UPDATE','assets'), async (req, res) => {
  try {
    const {
      code, name, type, category, location, brand, model, serial_no,
      purchase_date, purchase_price, warranty_until, status, notes,
    } = req.body;

    const r = await query(
      `UPDATE assets SET
        code          = COALESCE($1, code),
        name          = COALESCE($2, name),
        type          = COALESCE($3, type),
        category      = COALESCE($4, category),
        location      = COALESCE($5, location),
        brand         = COALESCE($6, brand),
        model         = COALESCE($7, model),
        serial_no     = COALESCE($8, serial_no),
        purchase_date = COALESCE($9::date, purchase_date),
        purchase_price= COALESCE($10, purchase_price),
        warranty_until= COALESCE($11::date, warranty_until),
        status        = COALESCE($12, status),
        notes         = COALESCE($13, notes),
        updated_at    = NOW()
       WHERE id = $14 AND active = TRUE RETURNING *`,
      [code||null, name||null, type||null, category||null, location||null,
       brand||null, model||null, serial_no||null, purchase_date||null,
       purchase_price||null, warranty_until||null, status||null, notes||null,
       req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Activo no encontrado' });
    res.locals.recordId = r.rows[0].id;
    res.json(r.rows[0]);
  } catch(err) { console.error(err && err.message); res.status(500).json({ error: 'Error del servidor' }); }
});

// DELETE /api/assets/:id — soft delete (solo dueno)
router.delete('/:id', authenticate, requireRole('dueno','gerencia'), validateUUID('id'), auditAction('DELETE','assets'), async (req, res) => {
  try {
    const r = await query(
      'UPDATE assets SET active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Activo no encontrado' });
    res.json({ ok: true });
  } catch(err) { console.error(err && err.message); res.status(500).json({ error: 'Error del servidor' }); }
});

module.exports = router;
