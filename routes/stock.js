const router = require('express').Router();
const { pool, query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');

const ROLES_STOCK_ADMIN = ['dueno', 'gerencia', 'jefe_mantenimiento', 'paniol'];
const ROLES_STOCK_EGRESO = ['dueno', 'gerencia', 'jefe_mantenimiento', 'mecanico', 'paniol'];

let schemaReady = false;
async function ensureStockSchema() {
  if (schemaReady) return;
  await query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).catch(() => {});
  await query(`CREATE TABLE IF NOT EXISTS stock_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'General',
    unit VARCHAR(20) NOT NULL DEFAULT 'un',
    qty_current NUMERIC(10,2) NOT NULL DEFAULT 0,
    qty_min NUMERIC(10,2) NOT NULL DEFAULT 1,
    qty_reorder NUMERIC(10,2) NOT NULL DEFAULT 2,
    unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    supplier VARCHAR(200),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(() => {});

  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS category VARCHAR(100) NOT NULL DEFAULT 'General'`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS unit VARCHAR(20) NOT NULL DEFAULT 'un'`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS qty_current NUMERIC(10,2) NOT NULL DEFAULT 0`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS qty_min NUMERIC(10,2) NOT NULL DEFAULT 1`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS qty_reorder NUMERIC(10,2) NOT NULL DEFAULT 2`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS supplier VARCHAR(200)`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`).catch(() => {});

  await query(`CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stock_id UUID NOT NULL REFERENCES stock_items(id),
    type VARCHAR(20) NOT NULL CHECK (type IN ('Ingreso','Egreso','Ajuste','Baja')),
    qty NUMERIC(10,2) NOT NULL,
    reason TEXT,
    wo_id UUID,
    user_id UUID NOT NULL REFERENCES users(id),
    requires_approval BOOLEAN DEFAULT FALSE,
    approved_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(() => {});
  await query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reason TEXT`).catch(() => {});
  await query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS wo_id UUID`).catch(() => {});
  await query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT FALSE`).catch(() => {});
  await query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id)`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_code ON stock_items(code)`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_active ON stock_items(active)`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_mov_stock ON stock_movements(stock_id)`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_mov_date ON stock_movements(created_at DESC)`).catch(() => {});
  schemaReady = true;
}

function cleanText(value, fallback = '') {
  const v = String(value ?? '').trim();
  return v || fallback;
}
function cleanNullable(value) {
  const v = String(value ?? '').trim();
  return v || null;
}
function cleanCode(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, '-');
}
function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function positiveNumber(value, fallback = 0) {
  const n = toNumber(value, fallback);
  return n > 0 ? n : fallback;
}
function normalizeStockPayload(body = {}) {
  const code = cleanCode(body.code);
  const name = cleanText(body.name);
  const category = cleanText(body.category, 'General');
  const unit = cleanText(body.unit, 'un');
  const qty_current = Math.max(0, toNumber(body.qty_current, 0));
  const qty_min = Math.max(0, toNumber(body.qty_min, 1));
  const qty_reorder = Math.max(0, toNumber(body.qty_reorder, qty_min ? qty_min * 2 : 2));
  const unit_cost = Math.max(0, toNumber(body.unit_cost, 0));
  const supplier = cleanNullable(body.supplier);
  return { code, name, category, unit, qty_current, qty_min, qty_reorder, unit_cost, supplier };
}

router.use(async (req, res, next) => {
  try {
    await ensureStockSchema();
    next();
  } catch (err) {
    console.error('[stock schema]', err.message);
    res.status(500).json({ error: 'Error preparando depósito' });
  }
});

// GET /api/stock
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT *, (qty_current <= qty_min) AS is_critical,
              (qty_current * unit_cost) AS total_value
       FROM stock_items
       WHERE active = TRUE
       ORDER BY category, name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[stock GET]', err.message);
    res.status(500).json({ error: 'Error al obtener stock' });
  }
});

// GET /api/stock/movements — historial de movimientos
router.get('/movements', authenticate, async (req, res) => {
  try {
    const { stock_id } = req.query;
    let limit = parseInt(req.query.limit || '50', 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    if (limit > 500) limit = 500;

    let sql = `
      SELECT sm.*, si.name AS item_name, si.unit, u.name AS user_name
      FROM stock_movements sm
      JOIN stock_items si ON si.id = sm.stock_id
      LEFT JOIN users u ON u.id = sm.user_id
      WHERE 1=1
    `;
    const params = [];
    if (stock_id) { params.push(stock_id); sql += ` AND sm.stock_id = $${params.length}`; }
    params.push(limit);
    sql += ` ORDER BY sm.created_at DESC LIMIT $${params.length}`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[stock movements]', err.message);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// POST /api/stock — nuevo ítem
router.post('/', authenticate, requireRole(...ROLES_STOCK_ADMIN), async (req, res) => {
  try {
    const p = normalizeStockPayload(req.body);
    if (!p.code || !p.name) return res.status(400).json({ error: 'Código y descripción son requeridos' });

    const result = await query(
      `INSERT INTO stock_items (code, name, category, unit, qty_current, qty_min, qty_reorder, unit_cost, supplier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [p.code, p.name, p.category, p.unit, p.qty_current, p.qty_min, p.qty_reorder, p.unit_cost, p.supplier]
    );
    if (p.qty_current > 0) {
      await query(
        `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id)
         VALUES ($1,'Ingreso',$2,'Alta de ítem nuevo',$3)`,
        [result.rows[0].id, p.qty_current, req.user.id]
      );
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un artículo con ese código' });
    console.error('[stock POST]', err.message);
    res.status(500).json({ error: 'Error al crear artículo de depósito' });
  }
});

// PUT /api/stock/:id — editar ficha del artículo, sin tocar cantidad física
router.put('/:id', authenticate, requireRole(...ROLES_STOCK_ADMIN), validateUUID('id'), async (req, res) => {
  try {
    const p = normalizeStockPayload(req.body);
    if (!p.code || !p.name) return res.status(400).json({ error: 'Código y descripción son requeridos' });

    const result = await query(
      `UPDATE stock_items
       SET code=$1, name=$2, category=$3, unit=$4, qty_min=$5, qty_reorder=$6,
           unit_cost=$7, supplier=$8, updated_at=NOW()
       WHERE id=$9 AND active=TRUE
       RETURNING *`,
      [p.code, p.name, p.category, p.unit, p.qty_min, p.qty_reorder, p.unit_cost, p.supplier, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Artículo no encontrado' });

    res.locals.recordId = req.params.id;
    res.locals.newValue = { code: p.code, name: p.name, category: p.category, unit: p.unit, qty_min: p.qty_min, qty_reorder: p.qty_reorder, unit_cost: p.unit_cost, supplier: p.supplier };
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe otro artículo con ese código' });
    console.error('[stock PUT]', err.message);
    res.status(500).json({ error: 'Error al editar artículo de depósito' });
  }
});

// POST /api/stock/:id/ingreso — ingreso manual de stock existente
router.post('/:id/ingreso', authenticate, requireRole(...ROLES_STOCK_ADMIN), validateUUID('id'), async (req, res) => {
  const client = await pool.connect();
  try {
    const qty = positiveNumber(req.body.qty, 0);
    const reason = cleanNullable(req.body.reason) || 'Ingreso manual';
    if (qty <= 0) return res.status(400).json({ error: 'Cantidad inválida' });

    await client.query('BEGIN');
    const item = await client.query('SELECT * FROM stock_items WHERE id = $1 AND active=TRUE FOR UPDATE', [req.params.id]);
    if (!item.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Artículo no encontrado' }); }

    const upd = await client.query(
      'UPDATE stock_items SET qty_current = qty_current + $1, updated_at=NOW() WHERE id = $2 RETURNING *',
      [qty, req.params.id]
    );
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id)
       VALUES ($1,'Ingreso',$2,$3,$4)`,
      [req.params.id, qty, reason, req.user.id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Ingreso registrado', item: upd.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[stock ingreso]', err.message);
    res.status(500).json({ error: 'Error al registrar ingreso' });
  } finally {
    client.release();
  }
});

// POST /api/stock/:id/egreso — egreso de stock
router.post('/:id/egreso', authenticate, requireRole(...ROLES_STOCK_EGRESO), validateUUID('id'), async (req, res) => {
  const client = await pool.connect();
  try {
    const qty = positiveNumber(req.body.qty, 0);
    const reason = cleanNullable(req.body.reason) || 'Egreso manual';
    if (qty <= 0) return res.status(400).json({ error: 'Cantidad inválida' });

    await client.query('BEGIN');
    const item = await client.query('SELECT * FROM stock_items WHERE id = $1 AND active=TRUE FOR UPDATE', [req.params.id]);
    if (!item.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Artículo no encontrado' }); }
    const actual = toNumber(item.rows[0].qty_current, 0);
    if (actual < qty) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Stock insuficiente. Disponible: ${actual} ${item.rows[0].unit}` });
    }

    await client.query('UPDATE stock_items SET qty_current = qty_current - $1, updated_at=NOW() WHERE id = $2', [qty, req.params.id]);
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id)
       VALUES ($1,'Egreso',$2,$3,$4)`,
      [req.params.id, qty, reason, req.user.id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Egreso registrado', new_qty: actual - qty });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[stock egreso]', err.message);
    res.status(500).json({ error: 'Error al registrar egreso' });
  } finally {
    client.release();
  }
});

// POST /api/stock/:id/baja — baja auditada por pérdida, daño, robo, vencimiento, etc.
router.post('/:id/baja', authenticate, requireRole(...ROLES_STOCK_ADMIN), sensitiveLimiter, validateUUID('id'),
  auditAction('BAJA_STOCK','stock_items'), async (req, res) => {
  const client = await pool.connect();
  try {
    const qty = positiveNumber(req.body.qty, 0);
    const reason = cleanNullable(req.body.reason);
    const motive = cleanText(req.body.motive, 'otro');
    if (qty <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({ error: 'El motivo debe tener al menos 10 caracteres' });
    }

    await client.query('BEGIN');
    const item = await client.query('SELECT * FROM stock_items WHERE id = $1 AND active=TRUE FOR UPDATE', [req.params.id]);
    if (!item.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Artículo no encontrado' }); }
    const actual = toNumber(item.rows[0].qty_current, 0);
    if (actual < qty) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cantidad mayor al stock disponible (${actual})` });
    }

    const fullReason = `[${motive.toUpperCase()}] ${reason}`;
    await client.query('UPDATE stock_items SET qty_current = qty_current - $1, updated_at=NOW() WHERE id = $2', [qty, req.params.id]);
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id, requires_approval, approved_by)
       VALUES ($1,'Baja',$2,$3,$4,TRUE,$4)`,
      [req.params.id, qty, fullReason, req.user.id]
    );

    await client.query('COMMIT');
    res.locals.recordId = req.params.id;
    res.locals.newValue = { qty, reason: fullReason, user: req.user.name };
    res.json({ message: 'Baja registrada y auditada', qty_removed: qty, new_qty: actual - qty });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[stock baja]', err.message);
    res.status(500).json({ error: 'Error al registrar baja' });
  } finally {
    client.release();
  }
});

// POST /api/stock/:id/ajuste — ajuste de inventario
router.post('/:id/ajuste', authenticate, requireRole(...ROLES_STOCK_ADMIN), validateUUID('id'), async (req, res) => {
  const client = await pool.connect();
  try {
    const new_qty = toNumber(req.body.new_qty, NaN);
    const reason = cleanNullable(req.body.reason) || 'Recuento físico';
    if (!Number.isFinite(new_qty) || new_qty < 0) return res.status(400).json({ error: 'Cantidad real inválida' });

    await client.query('BEGIN');
    const item = await client.query('SELECT * FROM stock_items WHERE id = $1 AND active=TRUE FOR UPDATE', [req.params.id]);
    if (!item.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Artículo no encontrado' }); }

    const actual = toNumber(item.rows[0].qty_current, 0);
    const diff = new_qty - actual;
    await client.query('UPDATE stock_items SET qty_current = $1, updated_at=NOW() WHERE id = $2', [new_qty, req.params.id]);
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id)
       VALUES ($1,'Ajuste',$2,$3,$4)`,
      [req.params.id, Math.abs(diff), `Ajuste: ${diff>=0?'+':''}${diff} · ${reason}`, req.user.id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Ajuste registrado', new_qty });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[stock ajuste]', err.message);
    res.status(500).json({ error: 'Error al ajustar inventario' });
  } finally {
    client.release();
  }
});

module.exports = router;
