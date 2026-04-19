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
(async () => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS assets (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      code          VARCHAR(50) UNIQUE NOT NULL,
      name          VARCHAR(200) NOT NULL,
      type          VARCHAR(30) NOT NULL DEFAULT 'otro'
                    CHECK (type IN ('edilicio','herramienta','equipo','informatica','instalacion','otro')),
      category      VARCHAR(100),
      location      VARCHAR(200),
      brand         VARCHAR(100),
      model         VARCHAR(100),
      serial_no     VARCHAR(100),
      purchase_date DATE,
      purchase_price NUMERIC(12,2),
      warranty_until DATE,
      status        VARCHAR(20) DEFAULT 'operativo'
                    CHECK (status IN ('operativo','en_reparacion','fuera_servicio','baja')),
      notes         TEXT,
      active        BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    // Índices útiles
    await query(`CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type) WHERE active=TRUE`);
    await query(`CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status) WHERE active=TRUE`);
  } catch(e) { console.error('[assets] init:', e.message); }
})();

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
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/assets/:id — detalle
router.get('/:id', authenticate, validateUUID('id'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM assets WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Activo no encontrado' });
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
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
  } catch(err) { res.status(500).json({ error: err.message }); }
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
  } catch(err) { res.status(500).json({ error: err.message }); }
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
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
