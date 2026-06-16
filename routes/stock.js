const router = require('express').Router();
const { pool, query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');

// Depósito por sucursal y área.
// Administración, Depósito y Taller pueden tener su propio pañol/stock.
const ROLES_STOCK_ADMIN = ['dueno', 'gerencia', 'jefe_mantenimiento', 'paniol', 'contador', 'gerente_sucursal'];
const ROLES_STOCK_EGRESO = ['dueno', 'gerencia', 'jefe_mantenimiento', 'mecanico', 'paniol', 'contador', 'gerente_sucursal'];
const STOCK_AREAS = ['Administración', 'Depósito', 'Taller'];

let schemaReady = false;
async function ensureStockSchema() {
  if (schemaReady) return;
  await query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).catch(() => {});
  await query(`CREATE TABLE IF NOT EXISTS stock_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'General',
    unit VARCHAR(20) NOT NULL DEFAULT 'un',
    qty_current NUMERIC(10,2) NOT NULL DEFAULT 0,
    qty_min NUMERIC(10,2) NOT NULL DEFAULT 1,
    qty_reorder NUMERIC(10,2) NOT NULL DEFAULT 2,
    unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    supplier VARCHAR(200),
    base_location VARCHAR(200) NOT NULL DEFAULT 'Central',
    area VARCHAR(100) NOT NULL DEFAULT 'Depósito',
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
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS base_location VARCHAR(200) NOT NULL DEFAULT 'Central'`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS area VARCHAR(100) NOT NULL DEFAULT 'Depósito'`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`).catch(() => {});
  await query(`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`).catch(() => {});

  // Base vieja: el código era único global. Ahora debe poder repetirse por sucursal/área.
  await query(`ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_code_key`).catch(() => {});
  await query(`DROP INDEX IF EXISTS idx_stock_code`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_code ON stock_items(code)`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_base_area ON stock_items(base_location, area)`).catch(() => {});
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS stock_items_code_base_area_uidx
               ON stock_items (UPPER(code), base_location, area)
               WHERE active = TRUE`).catch(() => {});

  await query(`CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stock_id UUID NOT NULL REFERENCES stock_items(id),
    type VARCHAR(20) NOT NULL CHECK (type IN ('Ingreso','Egreso','Ajuste','Baja')),
    qty NUMERIC(10,2) NOT NULL,
    reason TEXT,
    wo_id UUID,
    base_location VARCHAR(200),
    area VARCHAR(100),
    user_id UUID NOT NULL REFERENCES users(id),
    requires_approval BOOLEAN DEFAULT FALSE,
    approved_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(() => {});
  await query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reason TEXT`).catch(() => {});
  await query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS wo_id UUID`).catch(() => {});
  await query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS base_location VARCHAR(200)`).catch(() => {});
  await query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS area VARCHAR(100)`).catch(() => {});
  await query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT FALSE`).catch(() => {});
  await query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id)`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_active ON stock_items(active)`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_mov_stock ON stock_movements(stock_id)`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_mov_base_area ON stock_movements(base_location, area)`).catch(() => {});
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
function normalizeArea(value) {
  const v = cleanText(value, 'Depósito');
  const found = STOCK_AREAS.find(a => a.toLowerCase() === v.toLowerCase());
  return found || v;
}
function userSucursal(req) {
  return cleanNullable(req.user?.sucursal || req.user?.base || req.user?.branch);
}
function applyStockScope(req, params, sqlParts, tableAlias = '') {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const suc = userSucursal(req);
  if (req.user?.role === 'gerente_sucursal' && suc) {
    params.push(suc);
    sqlParts.push(` AND ${prefix}base_location = $${params.length}`);
  }
}
function normalizeStockPayload(body = {}, req = null) {
  const code = cleanCode(body.code);
  const name = cleanText(body.name);
  const category = cleanText(body.category, 'General');
  const unit = cleanText(body.unit, 'un');
  const qty_current = Math.max(0, toNumber(body.qty_current, 0));
  const qty_min = Math.max(0, toNumber(body.qty_min, 1));
  const qty_reorder = Math.max(0, toNumber(body.qty_reorder, qty_min ? qty_min * 2 : 2));
  const unit_cost = Math.max(0, toNumber(body.unit_cost, 0));
  const supplier = cleanNullable(body.supplier);
  let base_location = cleanText(body.base_location || body.sucursal || body.base, 'Central');
  const forcedSucursal = req ? userSucursal(req) : null;
  if (req?.user?.role === 'gerente_sucursal' && forcedSucursal) base_location = forcedSucursal;
  const area = normalizeArea(body.area || body.stock_area || 'Depósito');
  return { code, name, category, unit, qty_current, qty_min, qty_reorder, unit_cost, supplier, base_location, area };
}

router.use(async (req, res, next) => {
  try {
    await ensureStockSchema();
    next();
  } catch (err) {
    console.error('[stock schema]', err.message);
    res.status(500).json({ error: 'Error preparando stock y depósito' });
  }
});

// GET /api/stock?sucursal=...&area=...
router.get('/', authenticate, async (req, res) => {
  try {
    let sql = `SELECT *, (qty_current <= qty_min) AS is_critical,
              (qty_current * unit_cost) AS total_value
       FROM stock_items
       WHERE active = TRUE`;
    const params = [];
    const parts = [];
    applyStockScope(req, params, parts, 'stock_items');
    if (req.query.sucursal && req.query.sucursal !== 'all') { params.push(req.query.sucursal); parts.push(` AND base_location = $${params.length}`); }
    if (req.query.area && req.query.area !== 'all') { params.push(req.query.area); parts.push(` AND area = $${params.length}`); }
    sql += parts.join('') + ` ORDER BY base_location, area, category, name`;
    const result = await query(sql, params);
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
      SELECT sm.*, si.name AS item_name, si.unit, u.name AS user_name,
             COALESCE(sm.base_location, si.base_location) AS base_location,
             COALESCE(sm.area, si.area) AS area
      FROM stock_movements sm
      JOIN stock_items si ON si.id = sm.stock_id
      LEFT JOIN users u ON u.id = sm.user_id
      WHERE 1=1
    `;
    const params = [];
    if (stock_id) { params.push(stock_id); sql += ` AND sm.stock_id = $${params.length}`; }
    const suc = userSucursal(req);
    if (req.user?.role === 'gerente_sucursal' && suc) { params.push(suc); sql += ` AND COALESCE(sm.base_location, si.base_location) = $${params.length}`; }
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
    const p = normalizeStockPayload(req.body, req);
    if (!p.code || !p.name) return res.status(400).json({ error: 'Código y descripción son requeridos' });

    const result = await query(
      `INSERT INTO stock_items (code, name, category, unit, qty_current, qty_min, qty_reorder, unit_cost, supplier, base_location, area)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [p.code, p.name, p.category, p.unit, p.qty_current, p.qty_min, p.qty_reorder, p.unit_cost, p.supplier, p.base_location, p.area]
    );
    if (p.qty_current > 0) {
      await query(
        `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id, base_location, area)
         VALUES ($1,'Ingreso',$2,'Alta de ítem nuevo',$3,$4,$5)`,
        [result.rows[0].id, p.qty_current, req.user.id, p.base_location, p.area]
      );
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe ese código en la misma sucursal y área' });
    console.error('[stock POST]', err.message);
    res.status(500).json({ error: 'Error al crear artículo de stock' });
  }
});

// PUT /api/stock/:id — editar ficha del artículo, sin tocar cantidad física
router.put('/:id', authenticate, requireRole(...ROLES_STOCK_ADMIN), validateUUID('id'), async (req, res) => {
  try {
    const p = normalizeStockPayload(req.body, req);
    if (!p.code || !p.name) return res.status(400).json({ error: 'Código y descripción son requeridos' });

    let where = 'WHERE id=$11 AND active=TRUE';
    const params = [p.code, p.name, p.category, p.unit, p.qty_min, p.qty_reorder, p.unit_cost, p.supplier, p.base_location, p.area, req.params.id];
    const suc = userSucursal(req);
    if (req.user?.role === 'gerente_sucursal' && suc) { params.push(suc); where += ` AND base_location = $${params.length}`; }

    const result = await query(
      `UPDATE stock_items
       SET code=$1, name=$2, category=$3, unit=$4, qty_min=$5, qty_reorder=$6,
           unit_cost=$7, supplier=$8, base_location=$9, area=$10, updated_at=NOW()
       ${where}
       RETURNING *`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Artículo no encontrado' });

    res.locals.recordId = req.params.id;
    res.locals.newValue = { code: p.code, name: p.name, category: p.category, unit: p.unit, qty_min: p.qty_min, qty_reorder: p.qty_reorder, unit_cost: p.unit_cost, supplier: p.supplier, base_location: p.base_location, area: p.area };
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe ese código en la misma sucursal y área' });
    console.error('[stock PUT]', err.message);
    res.status(500).json({ error: 'Error al editar artículo de stock' });
  }
});

async function getScopedItemForUpdate(client, id, req) {
  const params = [id];
  let sql = 'SELECT * FROM stock_items WHERE id = $1 AND active=TRUE';
  const suc = userSucursal(req);
  if (req.user?.role === 'gerente_sucursal' && suc) { params.push(suc); sql += ` AND base_location = $${params.length}`; }
  sql += ' FOR UPDATE';
  return client.query(sql, params);
}

// POST /api/stock/:id/ingreso — ingreso manual de stock existente
router.post('/:id/ingreso', authenticate, requireRole(...ROLES_STOCK_ADMIN), validateUUID('id'), async (req, res) => {
  const client = await pool.connect();
  try {
    const qty = positiveNumber(req.body.qty, 0);
    const reason = cleanNullable(req.body.reason) || 'Ingreso manual';
    if (qty <= 0) return res.status(400).json({ error: 'Cantidad inválida' });

    await client.query('BEGIN');
    const item = await getScopedItemForUpdate(client, req.params.id, req);
    if (!item.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Artículo no encontrado' }); }

    const upd = await client.query(
      'UPDATE stock_items SET qty_current = qty_current + $1, updated_at=NOW() WHERE id = $2 RETURNING *',
      [qty, req.params.id]
    );
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id, base_location, area)
       VALUES ($1,'Ingreso',$2,$3,$4,$5,$6)`,
      [req.params.id, qty, reason, req.user.id, item.rows[0].base_location, item.rows[0].area]
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
    const item = await getScopedItemForUpdate(client, req.params.id, req);
    if (!item.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Artículo no encontrado' }); }
    const actual = toNumber(item.rows[0].qty_current, 0);
    if (actual < qty) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Stock insuficiente. Disponible: ${actual} ${item.rows[0].unit}` });
    }

    await client.query('UPDATE stock_items SET qty_current = qty_current - $1, updated_at=NOW() WHERE id = $2', [qty, req.params.id]);
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id, base_location, area)
       VALUES ($1,'Egreso',$2,$3,$4,$5,$6)`,
      [req.params.id, qty, reason, req.user.id, item.rows[0].base_location, item.rows[0].area]
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

// POST /api/stock/:id/transfer — traslado interno entre sucursales/áreas
router.post('/:id/transfer', authenticate, requireRole(...ROLES_STOCK_ADMIN), validateUUID('id'), async (req, res) => {
  const client = await pool.connect();
  try {
    const qty = positiveNumber(req.body.qty, 0);
    const destSucursal = cleanText(req.body.dest_sucursal || req.body.destination_sucursal || req.body.base_location, 'Central');
    const destArea = normalizeArea(req.body.dest_area || req.body.destination_area || req.body.area || 'Depósito');
    const responsible = cleanNullable(req.body.responsible);
    const reason = cleanNullable(req.body.reason) || 'Traslado interno de stock';
    if (qty <= 0) return res.status(400).json({ error: 'Cantidad inválida' });

    await client.query('BEGIN');
    const src = await getScopedItemForUpdate(client, req.params.id, req);
    if (!src.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Artículo origen no encontrado' }); }
    const item = src.rows[0];
    const actual = toNumber(item.qty_current, 0);
    if (actual < qty) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Stock insuficiente. Disponible: ${actual} ${item.unit}` });
    }
    if (item.base_location === destSucursal && item.area === destArea) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El destino debe ser distinto al origen' });
    }

    await client.query('UPDATE stock_items SET qty_current = qty_current - $1, updated_at=NOW() WHERE id=$2', [qty, item.id]);

    const dst = await client.query(
      `SELECT * FROM stock_items
       WHERE UPPER(code)=UPPER($1) AND base_location=$2 AND area=$3 AND active=TRUE
       FOR UPDATE`,
      [item.code, destSucursal, destArea]
    );

    let destItem;
    if (dst.rows[0]) {
      const upd = await client.query(
        `UPDATE stock_items SET qty_current = qty_current + $1, updated_at=NOW()
         WHERE id=$2 RETURNING *`,
        [qty, dst.rows[0].id]
      );
      destItem = upd.rows[0];
    } else {
      const ins = await client.query(
        `INSERT INTO stock_items (code, name, category, unit, qty_current, qty_min, qty_reorder, unit_cost, supplier, base_location, area)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [item.code, item.name, item.category, item.unit, qty, item.qty_min, item.qty_reorder, item.unit_cost, item.supplier, destSucursal, destArea]
      );
      destItem = ins.rows[0];
    }

    const extra = responsible ? ` · Responsable: ${responsible}` : '';
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id, base_location, area)
       VALUES ($1,'Egreso',$2,$3,$4,$5,$6)`,
      [item.id, qty, `Traslado a ${destSucursal} / ${destArea}. ${reason}${extra}`, req.user.id, item.base_location, item.area]
    );
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id, base_location, area)
       VALUES ($1,'Ingreso',$2,$3,$4,$5,$6)`,
      [destItem.id, qty, `Traslado desde ${item.base_location} / ${item.area}. ${reason}${extra}`, req.user.id, destSucursal, destArea]
    );

    await client.query('COMMIT');
    res.json({ message: 'Traslado interno registrado', source_id: item.id, destination_id: destItem.id, qty, destination: { sucursal: destSucursal, area: destArea } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe ese artículo en el destino y no se pudo actualizar' });
    console.error('[stock transfer]', err.message);
    res.status(500).json({ error: 'Error al registrar traslado interno' });
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
    const item = await getScopedItemForUpdate(client, req.params.id, req);
    if (!item.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Artículo no encontrado' }); }
    const actual = toNumber(item.rows[0].qty_current, 0);
    if (actual < qty) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cantidad mayor al stock disponible (${actual})` });
    }

    const fullReason = `[${motive.toUpperCase()}] ${reason}`;
    await client.query('UPDATE stock_items SET qty_current = qty_current - $1, updated_at=NOW() WHERE id = $2', [qty, req.params.id]);
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id, requires_approval, approved_by, base_location, area)
       VALUES ($1,'Baja',$2,$3,$4,TRUE,$4,$5,$6)`,
      [req.params.id, qty, fullReason, req.user.id, item.rows[0].base_location, item.rows[0].area]
    );

    await client.query('COMMIT');
    res.locals.recordId = req.params.id;
    res.locals.newValue = { qty, reason: fullReason, user: req.user.name, base_location: item.rows[0].base_location, area: item.rows[0].area };
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
    const item = await getScopedItemForUpdate(client, req.params.id, req);
    if (!item.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Artículo no encontrado' }); }

    const actual = toNumber(item.rows[0].qty_current, 0);
    const diff = new_qty - actual;
    await client.query('UPDATE stock_items SET qty_current = $1, updated_at=NOW() WHERE id = $2', [new_qty, req.params.id]);
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id, base_location, area)
       VALUES ($1,'Ajuste',$2,$3,$4,$5,$6)`,
      [req.params.id, Math.abs(diff), `Ajuste: ${diff>=0?'+':''}${diff} · ${reason}`, req.user.id, item.rows[0].base_location, item.rows[0].area]
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
