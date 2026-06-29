const router = require('express').Router();
const { pool, query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { auditChange } = require('../middleware/audit');
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
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_mov_wo ON stock_movements(wo_id)`).catch(() => {});
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
function userArea(req) {
  // El jefe de mantenimiento gestiona exclusivamente el stock del Taller,
  // sin importar el área que tenga cargada su usuario. Esto lo scopea parejo
  // en lecturas (catálogo/movimientos) y escrituras (ingresos/egresos/ajustes).
  if (req.user?.role === 'jefe_mantenimiento') return 'Taller';
  return cleanNullable(req.user?.area);
}
// Scope de saldos por sucursal + área:
//  - dueño/gerencia: ven todo.
//  - gerente_sucursal: toda su sucursal (todas las áreas).
//  - el resto con área asignada (pañolero, etc.): solo su sucursal + su área.
function applyBalanceScope(req, params, sqlParts, alias = 'b') {
  const role = req.user?.role;
  if (role === 'dueno' || role === 'gerencia') return;
  const suc = userSucursal(req);
  if (suc) { params.push(suc); sqlParts.push(` AND ${alias}.base_location = $${params.length}`); }
  if (role !== 'gerente_sucursal') {
    const ar = userArea(req);
    if (ar) { params.push(ar); sqlParts.push(` AND ${alias}.area = $${params.length}`); }
  }
}
// Fuerza la ubicación (sucursal/área) de un movimiento según el scope del usuario.
function scopedLocation(req, base_location, area) {
  const role = req.user?.role;
  let loc = base_location, ar = area;
  if (role !== 'dueno' && role !== 'gerencia') {
    const suc = userSucursal(req);
    if (suc) loc = suc;
    if (role !== 'gerente_sucursal') { const ua = userArea(req); if (ua) ar = ua; }
  }
  return { base_location: loc, area: ar };
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
// Rutas de ESCRITURA del stock VIEJO (stock_items), deshabilitadas tras el
// cutover al catálogo nuevo. Se mantienen las de LECTURA (GET / alimenta
// App.data.stock para los nombres de sucursal/área). Cierra la puerta a que
// algo mute la tabla vieja por error.
function gone410(req, res) {
  return res.status(410).json({ error: 'El stock viejo está deshabilitado. Usá Stock y Depósito (catálogo nuevo).' });
}

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
router.post('/', authenticate, requireRole(...ROLES_STOCK_ADMIN), gone410);

// PUT /api/stock/:id — editar ficha del artículo, sin tocar cantidad física
router.put('/:id', authenticate, requireRole(...ROLES_STOCK_ADMIN), validateUUID('id'), gone410);

async function getScopedItemForUpdate(client, id, req) {
  const params = [id];
  let sql = 'SELECT * FROM stock_items WHERE id = $1 AND active=TRUE';
  const suc = userSucursal(req);
  if (req.user?.role === 'gerente_sucursal' && suc) { params.push(suc); sql += ` AND base_location = $${params.length}`; }
  sql += ' FOR UPDATE';
  return client.query(sql, params);
}

// POST /api/stock/:id/ingreso — ingreso manual de stock existente
router.post('/:id/ingreso', authenticate, requireRole(...ROLES_STOCK_ADMIN), validateUUID('id'), gone410);

// POST /api/stock/:id/egreso — egreso de stock
router.post('/:id/egreso', authenticate, requireRole(...ROLES_STOCK_EGRESO), validateUUID('id'), gone410);

// POST /api/stock/:id/transfer — traslado interno entre sucursales/áreas
router.post('/:id/transfer', authenticate, requireRole(...ROLES_STOCK_ADMIN), validateUUID('id'), gone410);

// POST /api/stock/:id/baja — baja auditada por pérdida, daño, robo, vencimiento, etc.
router.post('/:id/baja', authenticate, requireRole(...ROLES_STOCK_ADMIN), sensitiveLimiter, validateUUID('id'),
  auditAction('BAJA_STOCK','stock_items'), gone410);

// POST /api/stock/:id/ajuste — ajuste de inventario
router.post('/:id/ajuste', authenticate, requireRole(...ROLES_STOCK_ADMIN), validateUUID('id'), gone410);

// ════════════════════════════════════════════════════════════════════
//  CATÁLOGO ÚNICO + SALDOS POR SUCURSAL (Fase 2)
//  Modelo nuevo: stock_catalog (artículo con código único) + stock_balances
//  (saldo por sucursal/área). Convive con el modelo viejo (stock_items) hasta
//  el cutover. Las tablas las crea la migración; acá se aseguran por las dudas.
// ════════════════════════════════════════════════════════════════════
let catalogReady = false;
async function ensureCatalogSchema() {
  if (catalogReady) return;
  await query(`CREATE TABLE IF NOT EXISTS stock_catalog (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'General',
    unit VARCHAR(20) NOT NULL DEFAULT 'un',
    qty_min NUMERIC(10,2) NOT NULL DEFAULT 0,
    qty_reorder NUMERIC(10,2) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    supplier VARCHAR(200),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(() => {});
  await query(`CREATE TABLE IF NOT EXISTS stock_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    catalog_id UUID NOT NULL REFERENCES stock_catalog(id) ON DELETE CASCADE,
    base_location VARCHAR(200) NOT NULL,
    area VARCHAR(100) NOT NULL,
    qty_current NUMERIC(10,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (catalog_id, base_location, area)
  )`).catch(() => {});
  // Movimientos: que puedan referenciar el catálogo (modelo nuevo).
  await query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS catalog_id UUID`).catch(() => {});
  await query(`ALTER TABLE stock_movements ALTER COLUMN stock_id DROP NOT NULL`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_mov_catalog ON stock_movements(catalog_id)`).catch(() => {});
  catalogReady = true;
}

// Prefijo de código por categoría (mismo criterio que la migración Fase 1).
const CAT_PREFIJOS = { lubricantes: 'LUB', electrico: 'ELE', filtros: 'FIL', general: 'GEN', palet: 'PAL', frenos: 'FRE' };
function _stripAccents(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function categoryPrefix(cat) {
  const k = _stripAccents(cat).trim().toLowerCase();
  return CAT_PREFIJOS[k] || (_stripAccents(cat).replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'GEN');
}
async function nextCatalogCode(category) {
  const prefix = categoryPrefix(category);
  const r = await query(`SELECT code FROM stock_catalog WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`, [prefix + '-%']);
  let n = 0;
  if (r.rows[0]) { const m = /(\d+)$/.exec(r.rows[0].code); if (m) n = parseInt(m[1], 10); }
  return `${prefix}-${String(n + 1).padStart(3, '0')}`;
}

// GET /api/stock/catalog — artículos con sus saldos por sucursal/área
router.get('/catalog', authenticate, async (req, res) => {
  try {
    await ensureCatalogSchema();
    const params = [];
    const sc = [];
    applyBalanceScope(req, params, sc, 'b');
    const balanceFilter = sc.join('');
    const sql = `
      SELECT c.id, c.code, c.name, c.category, c.unit, c.qty_min, c.qty_reorder, c.unit_cost, c.supplier,
             COALESCE(SUM(b.qty_current), 0) AS total,
             (COALESCE(SUM(b.qty_current), 0) <= c.qty_min) AS is_critical,
             COALESCE(json_agg(json_build_object('base_location', b.base_location, 'area', b.area, 'qty_current', b.qty_current)
                      ORDER BY b.base_location, b.area) FILTER (WHERE b.id IS NOT NULL), '[]') AS balances
      FROM stock_catalog c
      LEFT JOIN stock_balances b ON b.catalog_id = c.id${balanceFilter}
      WHERE c.active = TRUE
      GROUP BY c.id
      ${balanceFilter ? 'HAVING COUNT(b.id) > 0' : ''}
      ORDER BY c.category, c.name`;
    res.json((await query(sql, params)).rows);
  } catch (err) { console.error('[stock catalog GET]', err.message); res.status(500).json({ error: 'Error catálogo' }); }
});

// GET /api/stock/catalog/movements?limit=10 — últimos movimientos del catálogo
// (modelo nuevo: stock_movements.catalog_id). Respeta el scope por sucursal/área.
router.get('/catalog/movements', authenticate, async (req, res) => {
  try {
    await ensureCatalogSchema();
    let limit = parseInt(req.query.limit || '10', 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 10;
    if (limit > 100) limit = 100;
    let offset = parseInt(req.query.offset || '0', 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    const params = [];
    const sc = [];
    applyBalanceScope(req, params, sc, 'sm');
    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;
    const sql = `
      SELECT sm.id, sm.type, sm.qty, sm.reason, sm.base_location, sm.area, sm.created_at,
             c.code, c.name, c.unit, u.name AS user_name
      FROM stock_movements sm
      JOIN stock_catalog c ON c.id = sm.catalog_id
      LEFT JOIN users u ON u.id = sm.user_id
      WHERE sm.catalog_id IS NOT NULL ${sc.join('')}
      ORDER BY sm.created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}`;
    res.json((await query(sql, params)).rows);
  } catch (err) { console.error('[stock catalog movements]', err.message); res.status(500).json({ error: 'Error historial' }); }
});

// POST /api/stock/catalog — crear artículo (código autogenerado por categoría)
router.post('/catalog', authenticate, requireRole(...ROLES_STOCK_ADMIN), async (req, res) => {
  try {
    await ensureCatalogSchema();
    const name = cleanText(req.body.name);
    if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const category = cleanText(req.body.category, 'General');
    const unit = cleanText(req.body.unit, 'un');
    const qty_min = Math.max(0, toNumber(req.body.qty_min, 0));
    const qty_reorder = Math.max(0, toNumber(req.body.qty_reorder, 0));
    const unit_cost = Math.max(0, toNumber(req.body.unit_cost, 0));
    const supplier = cleanNullable(req.body.supplier);
    const code = req.body.code ? cleanCode(req.body.code) : await nextCatalogCode(category);
    const r = await query(
      `INSERT INTO stock_catalog (code, name, category, unit, qty_min, qty_reorder, unit_cost, supplier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [code, name, category, unit, qty_min, qty_reorder, unit_cost, supplier]);
    const initQty = Math.max(0, toNumber(req.body.qty_current, 0));
    if (initQty > 0) {
      const scoped = scopedLocation(req, cleanText(req.body.base_location || 'Central', 'Central'), normalizeArea(req.body.area || 'Depósito'));
      const base_location = scoped.base_location;
      const area = scoped.area;
      await query(
        `INSERT INTO stock_balances (catalog_id, base_location, area, qty_current) VALUES ($1,$2,$3,$4)
         ON CONFLICT (catalog_id, base_location, area) DO UPDATE SET qty_current = stock_balances.qty_current + EXCLUDED.qty_current, updated_at = NOW()`,
        [r.rows[0].id, base_location, area, initQty]);
      await query(`INSERT INTO stock_movements (catalog_id, type, qty, reason, base_location, area, user_id) VALUES ($1,'Ingreso',$2,'Alta de artículo',$3,$4,$5)`,
        [r.rows[0].id, initQty, base_location, area, req.user.id]);
    }
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un artículo con ese código' });
    console.error('[stock catalog POST]', err.message); res.status(500).json({ error: 'Error al crear artículo' });
  }
});

// PUT /api/stock/catalog/:id — editar la ficha (el código no se cambia)
router.put('/catalog/:id', authenticate, requireRole(...ROLES_STOCK_ADMIN), validateUUID('id'), async (req, res) => {
  try {
    await ensureCatalogSchema();
    const fields = []; const params = [];
    const set = (col, val) => { params.push(val); fields.push(`${col}=$${params.length}`); };
    if (req.body.name !== undefined) set('name', cleanText(req.body.name));
    if (req.body.category !== undefined) set('category', cleanText(req.body.category, 'General'));
    if (req.body.unit !== undefined) set('unit', cleanText(req.body.unit, 'un'));
    if (req.body.qty_min !== undefined) set('qty_min', Math.max(0, toNumber(req.body.qty_min, 0)));
    if (req.body.qty_reorder !== undefined) set('qty_reorder', Math.max(0, toNumber(req.body.qty_reorder, 0)));
    if (req.body.unit_cost !== undefined) set('unit_cost', Math.max(0, toNumber(req.body.unit_cost, 0)));
    if (req.body.supplier !== undefined) set('supplier', cleanNullable(req.body.supplier));
    if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const r = await query(`UPDATE stock_catalog SET ${fields.join(',')}, updated_at=NOW() WHERE id=$${params.length} RETURNING *`, params);
    if (!r.rows[0]) return res.status(404).json({ error: 'Artículo no encontrado' });
    res.json(r.rows[0]);
  } catch (err) { console.error('[stock catalog PUT]', err.message); res.status(500).json({ error: 'Error al actualizar artículo' }); }
});

// POST /api/stock/catalog/:id/mov — movimiento (Ingreso/Egreso/Ajuste) en una ubicación
router.post('/catalog/:id/mov', authenticate, requireRole(...ROLES_STOCK_EGRESO), validateUUID('id'), async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureCatalogSchema();
    const tipo = cleanText(req.body.type);
    if (!['Ingreso', 'Egreso', 'Ajuste'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido (Ingreso/Egreso/Ajuste)' });
    const qty = Math.max(0, toNumber(req.body.qty, 0));
    if (qty <= 0 && tipo !== 'Ajuste') return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    const scoped = scopedLocation(req, cleanText(req.body.base_location || 'Central', 'Central'), normalizeArea(req.body.area || 'Depósito'));
    const base_location = scoped.base_location;
    const area = scoped.area;
    const reason = cleanNullable(req.body.reason);

    await client.query('BEGIN');
    const cat = await client.query('SELECT id FROM stock_catalog WHERE id=$1 AND active=TRUE', [req.params.id]);
    if (!cat.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Artículo no encontrado' }); }
    const bal = await client.query('SELECT qty_current FROM stock_balances WHERE catalog_id=$1 AND base_location=$2 AND area=$3 FOR UPDATE', [req.params.id, base_location, area]);
    const actual = bal.rows[0] ? parseFloat(bal.rows[0].qty_current) : 0;
    let nueva;
    if (tipo === 'Ingreso') nueva = actual + qty;
    else if (tipo === 'Egreso') {
      if (qty > actual) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Stock insuficiente en ${base_location}/${area} (hay ${actual})` }); }
      nueva = actual - qty;
    } else { nueva = Math.max(0, toNumber(req.body.qty, actual)); } // Ajuste: cantidad absoluta
    await client.query(
      `INSERT INTO stock_balances (catalog_id, base_location, area, qty_current) VALUES ($1,$2,$3,$4)
       ON CONFLICT (catalog_id, base_location, area) DO UPDATE SET qty_current=$4, updated_at=NOW()`,
      [req.params.id, base_location, area, nueva]);
    await client.query(
      `INSERT INTO stock_movements (catalog_id, type, qty, reason, base_location, area, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.params.id, tipo, tipo === 'Ajuste' ? nueva : qty, reason || `${tipo} de stock`, base_location, area, req.user.id]);
    await client.query('COMMIT');
    // Auditoría fuerte: saldo de la ubicación antes→después + tipo de movimiento.
    await auditChange(req, res, {
      action: `stock_${tipo.toLowerCase()}`, table: 'stock', recordId: req.params.id,
      oldValue: { base_location, area, qty_current: actual },
      newValue: { base_location, area, qty_current: nueva, qty: qty, reason: reason || null },
    });
    res.json({ ok: true, catalog_id: req.params.id, base_location, area, qty_current: nueva });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[stock catalog mov]', err.message); res.status(500).json({ error: 'Error en el movimiento' });
  } finally { client.release(); }
});

// ════════════════════════════════════════════════════════════════════
//  DESPACHO CENTRAL → SUCURSAL con recepción (Fase 3)
//  Espejo del despacho de combustible: Central despacha (sale el stock del
//  origen, queda "en tránsito") → la sucursal confirma la recepción (suma al
//  destino, puede ajustar la cantidad recibida).
// ════════════════════════════════════════════════════════════════════
const ROLES_DISPATCH_SEND = ['dueno', 'gerencia', 'jefe_mantenimiento'];
const ROLES_DISPATCH_RECV = ['dueno', 'gerencia', 'gerente_sucursal', 'paniol'];

let dispatchReady = false;
async function ensureDispatchSchema() {
  if (dispatchReady) return;
  await ensureCatalogSchema();
  await query(`CREATE TABLE IF NOT EXISTS stock_dispatches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    catalog_id UUID NOT NULL REFERENCES stock_catalog(id),
    qty_sent NUMERIC(10,2) NOT NULL,
    from_location VARCHAR(200) NOT NULL,
    from_area VARCHAR(100) NOT NULL,
    to_location VARCHAR(200) NOT NULL,
    to_area VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'en_transito',
    notes TEXT,
    dispatched_by UUID REFERENCES users(id),
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    qty_received NUMERIC(10,2),
    receive_notes TEXT,
    received_by UUID REFERENCES users(id),
    received_at TIMESTAMPTZ
  )`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_stock_disp_status ON stock_dispatches(status)`).catch(() => {});
  dispatchReady = true;
}

// POST /api/stock/dispatches — Central despacha a una sucursal (sale del origen)
router.post('/dispatches', authenticate, requireRole(...ROLES_DISPATCH_SEND), async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureDispatchSchema();
    const { catalog_id } = req.body;
    const qtyNum = positiveNumber(req.body.qty, 0);
    if (!catalog_id) return res.status(400).json({ error: 'Falta el artículo' });
    if (qtyNum <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
    const fromLoc = cleanText(req.body.from_location || 'Central', 'Central');
    const fromAr = normalizeArea(req.body.from_area || 'Depósito');
    const toLoc = cleanText(req.body.to_location, '');
    const toAr = normalizeArea(req.body.to_area || 'Depósito');
    if (!toLoc) return res.status(400).json({ error: 'Elegí la sucursal destino' });
    if (toLoc === fromLoc && toAr === fromAr) return res.status(400).json({ error: 'El destino debe ser distinto del origen' });

    await client.query('BEGIN');
    const cat = await client.query('SELECT name FROM stock_catalog WHERE id = $1 AND active = TRUE', [catalog_id]);
    if (!cat.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Artículo no encontrado' }); }
    const bal = await client.query('SELECT qty_current FROM stock_balances WHERE catalog_id=$1 AND base_location=$2 AND area=$3 FOR UPDATE', [catalog_id, fromLoc, fromAr]);
    const disp = bal.rows[0] ? parseFloat(bal.rows[0].qty_current) : 0;
    if (disp < qtyNum) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Stock insuficiente en ${fromLoc}/${fromAr} (hay ${disp})` }); }
    await client.query('UPDATE stock_balances SET qty_current = qty_current - $1, updated_at = NOW() WHERE catalog_id=$2 AND base_location=$3 AND area=$4', [qtyNum, catalog_id, fromLoc, fromAr]);
    await client.query(`INSERT INTO stock_movements (catalog_id, type, qty, reason, base_location, area, user_id) VALUES ($1,'Egreso',$2,$3,$4,$5,$6)`,
      [catalog_id, qtyNum, `Despacho a ${toLoc}/${toAr}`, fromLoc, fromAr, req.user.id]);
    const r = await client.query(
      `INSERT INTO stock_dispatches (catalog_id, qty_sent, from_location, from_area, to_location, to_area, notes, dispatched_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [catalog_id, qtyNum, fromLoc, fromAr, toLoc, toAr, cleanNullable(req.body.notes), req.user.id]);
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dispatch create]', err.message); res.status(500).json({ error: 'Error al despachar' });
  } finally { client.release(); }
});

// GET /api/stock/dispatches?status=en_transito — listar despachos
router.get('/dispatches', authenticate, async (req, res) => {
  try {
    await ensureDispatchSchema();
    const params = []; const parts = [];
    const suc = userSucursal(req);
    if (req.user?.role === 'gerente_sucursal' && suc) { params.push(suc); parts.push(` AND (d.to_location=$${params.length} OR d.from_location=$${params.length})`); }
    if (req.query.status) { params.push(req.query.status); parts.push(` AND d.status=$${params.length}`); }
    const sql = `SELECT d.*, c.code, c.name, c.unit,
        du.name AS dispatched_by_name, ru.name AS received_by_name
       FROM stock_dispatches d
       JOIN stock_catalog c ON c.id = d.catalog_id
       LEFT JOIN users du ON du.id = d.dispatched_by
       LEFT JOIN users ru ON ru.id = d.received_by
       WHERE 1=1 ${parts.join('')}
       ORDER BY d.dispatched_at DESC LIMIT 100`;
    res.json((await query(sql, params)).rows);
  } catch (err) { console.error('[dispatch list]', err.message); res.status(500).json({ error: 'Error despachos' }); }
});

// POST /api/stock/dispatches/:id/recibir — la sucursal confirma la recepción
router.post('/dispatches/:id/recibir', authenticate, requireRole(...ROLES_DISPATCH_RECV), validateUUID('id'), async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureDispatchSchema();
    await client.query('BEGIN');
    const d = await client.query('SELECT * FROM stock_dispatches WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!d.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Despacho no encontrado' }); }
    const disp = d.rows[0];
    if (disp.status !== 'en_transito') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'El despacho no está en tránsito' }); }
    const suc = userSucursal(req);
    if (req.user?.role === 'gerente_sucursal' && suc && disp.to_location !== suc) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Solo podés recibir despachos de tu sucursal' }); }
    const qtyRecv = req.body.qty_received != null ? Math.max(0, toNumber(req.body.qty_received, parseFloat(disp.qty_sent))) : parseFloat(disp.qty_sent);
    await client.query(`INSERT INTO stock_balances (catalog_id, base_location, area, qty_current) VALUES ($1,$2,$3,$4)
       ON CONFLICT (catalog_id, base_location, area) DO UPDATE SET qty_current = stock_balances.qty_current + EXCLUDED.qty_current, updated_at = NOW()`,
      [disp.catalog_id, disp.to_location, disp.to_area, qtyRecv]);
    await client.query(`INSERT INTO stock_movements (catalog_id, type, qty, reason, base_location, area, user_id) VALUES ($1,'Ingreso',$2,$3,$4,$5,$6)`,
      [disp.catalog_id, qtyRecv, `Recepción de despacho desde ${disp.from_location}/${disp.from_area}`, disp.to_location, disp.to_area, req.user.id]);
    await client.query(`UPDATE stock_dispatches SET status='recibido', qty_received=$1, receive_notes=$2, received_by=$3, received_at=NOW() WHERE id=$4`,
      [qtyRecv, cleanNullable(req.body.receive_notes), req.user.id, req.params.id]);
    await client.query('COMMIT');
    res.json({ ok: true, qty_received: qtyRecv });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dispatch recv]', err.message); res.status(500).json({ error: 'Error al recibir' });
  } finally { client.release(); }
});

// POST /api/stock/dispatches/:id/cancelar — anula un despacho en tránsito (devuelve al origen)
router.post('/dispatches/:id/cancelar', authenticate, requireRole(...ROLES_DISPATCH_SEND), validateUUID('id'), async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureDispatchSchema();
    await client.query('BEGIN');
    const d = await client.query('SELECT * FROM stock_dispatches WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!d.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Despacho no encontrado' }); }
    const disp = d.rows[0];
    if (disp.status !== 'en_transito') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Solo se cancela un despacho en tránsito' }); }
    await client.query(`INSERT INTO stock_balances (catalog_id, base_location, area, qty_current) VALUES ($1,$2,$3,$4)
       ON CONFLICT (catalog_id, base_location, area) DO UPDATE SET qty_current = stock_balances.qty_current + EXCLUDED.qty_current, updated_at = NOW()`,
      [disp.catalog_id, disp.from_location, disp.from_area, disp.qty_sent]);
    await client.query(`INSERT INTO stock_movements (catalog_id, type, qty, reason, base_location, area, user_id) VALUES ($1,'Ingreso',$2,$3,$4,$5,$6)`,
      [disp.catalog_id, disp.qty_sent, `Cancelación de despacho a ${disp.to_location}/${disp.to_area}`, disp.from_location, disp.from_area, req.user.id]);
    await client.query(`UPDATE stock_dispatches SET status='cancelado' WHERE id=$1`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dispatch cancel]', err.message); res.status(500).json({ error: 'Error al cancelar' });
  } finally { client.release(); }
});

module.exports = router;
