const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');

// Auto-migrate: agregar campos ot_tipo, asset_id, y crear tabla work_order_labor
(async () => {
  try {
    await query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS ot_tipo VARCHAR(20) DEFAULT 'vehiculo'`).catch(()=>{});
    await query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS asset_id UUID`).catch(()=>{});
    await query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS external_required BOOLEAN NOT NULL DEFAULT FALSE`).catch(()=>{});
    await query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS external_po_id UUID`).catch(()=>{});
    await query(`ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS po_id UUID`).catch(()=>{});
    await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS work_order_part_id UUID`).catch(()=>{});
    // Backfill: las OTs viejas sin ot_tipo se marcan como 'vehiculo'
    await query(`UPDATE work_orders SET ot_tipo = 'vehiculo' WHERE ot_tipo IS NULL`).catch(()=>{});

    // Partes de trabajo por mecánico (Opción B: trazabilidad MO)
    await query(`CREATE TABLE IF NOT EXISTS work_order_labor (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      wo_id       UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      user_id     UUID REFERENCES users(id),
      worker_name VARCHAR(200) NOT NULL,
      hours       NUMERIC(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
      rate        NUMERIC(10,2) NOT NULL DEFAULT 0,
      subtotal    NUMERIC(12,2) GENERATED ALWAYS AS (hours * rate) STORED,
      work_date   DATE NOT NULL DEFAULT CURRENT_DATE,
      notes       TEXT,
      created_by  UUID REFERENCES users(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(()=>{});
    await query(`CREATE INDEX IF NOT EXISTS idx_wol_wo ON work_order_labor(wo_id)`).catch(()=>{});
    await query(`CREATE INDEX IF NOT EXISTS idx_wol_user ON work_order_labor(user_id)`).catch(()=>{});
    await query(`CREATE INDEX IF NOT EXISTS idx_wol_date ON work_order_labor(work_date)`).catch(()=>{});

    // Índices del listado principal de OTs. El listado siempre ordena por opened_at DESC
    // y filtra muy seguido por status; el compuesto cubre ese caso. asset_id y reporter_id
    // se filtran (OTs de un activo/edificio, y "el chofer ve solo las suyas") y no tenían índice.
    await query(`CREATE INDEX IF NOT EXISTS idx_wo_status_opened ON work_orders(status, opened_at DESC)`).catch(()=>{});
    await query(`CREATE INDEX IF NOT EXISTS idx_wo_asset ON work_orders(asset_id)`).catch(()=>{});
    await query(`CREATE INDEX IF NOT EXISTS idx_wo_reporter ON work_orders(reporter_id)`).catch(()=>{});
  } catch(e) { /* silent */ }
})();

async function ensureExternalPOFields(clientOrQuery = query) {
  const q = typeof clientOrQuery.query === 'function' ? clientOrQuery.query.bind(clientOrQuery) : clientOrQuery;
  await q(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).catch(()=>{});
  await q(`CREATE SEQUENCE IF NOT EXISTS oc_seq START 1 INCREMENT 1`).catch(()=>{});

  // Por seguridad: si el módulo de compras todavía no creó estas tablas, dejamos una estructura mínima compatible.
  await q(`CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pendiente_cotizacion',
    requested_by UUID REFERENCES users(id),
    supplier_id UUID,
    sucursal VARCHAR(200),
    area VARCHAR(200),
    tipo VARCHAR(30) DEFAULT 'flota',
    vehicle_id UUID,
    ot_id UUID,
    asset_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(()=>{});
  await q(`CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL,
    cantidad NUMERIC(12,2) NOT NULL DEFAULT 1,
    unidad VARCHAR(30) DEFAULT 'un',
    precio_unit NUMERIC(14,2) NOT NULL DEFAULT 0,
    subtotal NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * precio_unit) STORED,
    stock_item_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(()=>{});

  await q(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS external_required BOOLEAN NOT NULL DEFAULT FALSE`).catch(()=>{});
  await q(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS external_po_id UUID`).catch(()=>{});
  await q(`ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS po_id UUID`).catch(()=>{});
  // Repuestos de pañol del modelo nuevo (catálogo + saldo por sucursal/área).
  await q(`ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS catalog_id UUID`).catch(()=>{});
  await q(`ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS base_location VARCHAR(200)`).catch(()=>{});
  await q(`ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS area VARCHAR(100)`).catch(()=>{});
  await q(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS ot_id UUID`).catch(()=>{});
  await q(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS asset_id UUID`).catch(()=>{});
  await q(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tipo VARCHAR(30) DEFAULT 'flota'`).catch(()=>{});
  await q(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS area VARCHAR(200)`).catch(()=>{});
  await q(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sucursal VARCHAR(200)`).catch(()=>{});
  await q(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS prioridad VARCHAR(20) DEFAULT 'Normal'`).catch(()=>{});
  await q(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS stock_item_id UUID`).catch(()=>{});
  await q(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS work_order_part_id UUID`).catch(()=>{});
  await q(`CREATE INDEX IF NOT EXISTS idx_po_ot_id ON purchase_orders(ot_id)`).catch(()=>{});
  await q(`CREATE INDEX IF NOT EXISTS idx_poi_work_order_part ON purchase_order_items(work_order_part_id)`).catch(()=>{});
  await q(`CREATE INDEX IF NOT EXISTS idx_wop_po ON work_order_parts(po_id)`).catch(()=>{});
}


async function nextOCCodeTx(client) {
  await client.query(`CREATE SEQUENCE IF NOT EXISTS oc_seq START 1 INCREMENT 1`).catch(()=>{});
  const r = await client.query("SELECT nextval('oc_seq') as num");
  return 'OC-' + String(parseInt(r.rows[0].num, 10)).padStart(4, '0');
}

// Normaliza la prioridad a los 3 niveles canónicos (Normal/Media/Urgente).
// Acepta cualquier mayúscula/minúscula y "crítica" (del form de reporte de fallas),
// que se trata como Urgente. Así la prioridad queda consistente en OT y OC.
function normPrioridad(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'urgente' || s === 'critica' || s === 'crítica') return 'Urgente';
  if (s === 'media' || s === 'medio') return 'Media';
  return 'Normal';
}

async function createPOFromOT(client, { woId, woCode, reqUserId, vehicleId, assetId, sucursal, area, tipo, notes, items, prioridad }) {
  await ensureExternalPOFields(client);
  const cleanItems = (items || []).filter(i => String(i.descripcion || i.name || '').trim());
  if (!cleanItems.length) return null;
  const poCode = await nextOCCodeTx(client);
  // La urgencia de la OT viaja a la OC para que Compras priorice según indicó el área.
  const _prio = normPrioridad(prioridad);
  const po = await client.query(
    `INSERT INTO purchase_orders (code, status, requested_by, sucursal, area, tipo, vehicle_id, ot_id, asset_id, notes, prioridad)
     VALUES ($1,'pendiente_cotizacion',$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [poCode, reqUserId, sucursal || null, area || 'Taller', tipo || 'flota', vehicleId || null, woId, assetId || null, notes || `Solicitud generada desde ${woCode}`, _prio]
  );
  const poId = po.rows[0].id;
  for (const it of cleanItems) {
    await client.query(
      `INSERT INTO purchase_order_items (po_id, descripcion, cantidad, unidad, precio_unit, stock_item_id, work_order_part_id)
       VALUES ($1,$2,$3,$4,0,$5,$6)`,
      [poId,
       String(it.descripcion || it.name).trim(),
       parseFloat(it.cantidad || it.qty || 1) || 1,
       it.unidad || it.unit || 'un',
       it.stock_item_id || it.stock_id || null,
       it.work_order_part_id || it.part_id || null]
    );
  }
  return po.rows[0];
}

// Crea una OC separada por cada ítem externo de una OT.
// Permite comprar distintos repuestos/servicios en proveedores distintos.
async function createSeparatePOsFromOTItems(client, baseData, items) {
  const cleanItems = (items || []).filter(i => String(i.descripcion || i.name || '').trim());
  const created = [];

  for (const item of cleanItems) {
    const desc = String(item.descripcion || item.name || 'Compra externa').trim();
    const po = await createPOFromOT(client, {
      ...baseData,
      notes: `${baseData.notes || `Solicitud generada desde ${baseData.woCode}`} | Ítem externo: ${desc}`,
      items: [item]
    });

    if (po) {
      created.push(po);
      const partId = item.work_order_part_id || item.part_id || null;
      if (partId) {
        await client.query('UPDATE work_order_parts SET po_id=$1 WHERE id=$2', [po.id, partId]);
      }
    }
  }

  if (created.length) {
    // Campo legacy: conserva la primera OC para pantallas/código viejo.
    // El vínculo real múltiple queda en purchase_orders.ot_id y work_order_parts.po_id.
    await client.query(
      'UPDATE work_orders SET external_po_id=COALESCE(external_po_id,$1), external_required=TRUE WHERE id=$2',
      [created[0].id, baseData.woId]
    );
  }

  return created;
}

function _woUserSucursal(req) {
  return String(req?.user?.sucursal || '').trim();
}
function _woIsGerenteSucursal(req) {
  return req?.user?.role === 'gerente_sucursal';
}
async function _woVehicleBelongsToSucursal(client, vehicleId, sucursal) {
  if (!vehicleId || !sucursal) return false;
  const r = await client.query('SELECT id FROM vehicles WHERE id=$1 AND active=TRUE AND base=$2', [vehicleId, sucursal]);
  return !!r.rows[0];
}

// GET /api/workorders
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, vehicle_id, asset_id, ot_tipo, priority, limit = 50, offset = 0 } = req.query;
    let sql = `
      SELECT wo.*,
             v.code AS vehicle_code, v.plate, v.brand, v.model,
             a.code AS asset_code, a.name AS asset_name, a.type AS asset_type,
             m.name AS mechanic_name
      FROM work_orders wo
      LEFT JOIN vehicles v ON v.id = wo.vehicle_id
      LEFT JOIN assets a   ON a.id = wo.asset_id
      LEFT JOIN users m    ON m.id = wo.mechanic_id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.role === 'chofer') {
      params.push(req.user.id);
      sql += ` AND wo.reporter_id = $${params.length}`;
    }
    if (_woIsGerenteSucursal(req)) {
      const suc = _woUserSucursal(req);
      if (!suc) {
        sql += ' AND 1=0';
      } else {
        params.push(suc);
        sql += ` AND v.base = $${params.length}`;
      }
    }
    if (status)     { params.push(status);     sql += ` AND wo.status = $${params.length}`; }
    if (vehicle_id) { params.push(vehicle_id); sql += ` AND wo.vehicle_id = $${params.length}`; }
    if (asset_id)   { params.push(asset_id);   sql += ` AND wo.asset_id = $${params.length}`; }
    if (ot_tipo)    { params.push(ot_tipo);    sql += ` AND wo.ot_tipo = $${params.length}`; }
    if (priority)   { params.push(priority);   sql += ` AND wo.priority = $${params.length}`; }

    sql += ` ORDER BY wo.opened_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[WO GET]', err.message, err.stack?.split('\n')[1]);
    res.status(500).json({ error: 'Error al obtener órdenes de trabajo', detail: err.message });
  }
});

// GET /api/workorders/:id
router.get('/:id', authenticate, validateUUID('id'), async (req, res) => {
  try {
    const wo = await query(
      `SELECT wo.*, v.code AS vehicle_code, v.plate, v.brand, v.model,
              v.km_current, v.base, m.name AS mechanic_name
       FROM work_orders wo
       LEFT JOIN vehicles v ON v.id = wo.vehicle_id
       LEFT JOIN users m ON m.id = wo.mechanic_id
       WHERE wo.id = $1`,
      [req.params.id]
    );
    if (!wo.rows[0]) return res.status(404).json({ error: 'OT no encontrada' });

    if (req.user.role === 'chofer' && wo.rows[0].reporter_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    if (_woIsGerenteSucursal(req)) {
      const suc = _woUserSucursal(req);
      if (!suc || wo.rows[0].base !== suc) {
        return res.status(403).json({ error: 'Solo podés ver OTs de tu sucursal' });
      }
    }

    const parts = await query(
      `SELECT wop.*, si.code AS stock_code, po.code AS po_code
       FROM work_order_parts wop
       LEFT JOIN stock_items si ON si.id = wop.stock_id
       LEFT JOIN purchase_orders po ON po.id = wop.po_id
       WHERE wop.wo_id = $1 ORDER BY wop.added_at`,
      [req.params.id]
    );

    res.json({ ...wo.rows[0], parts: parts.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener OT' });
  }
});

// POST /api/workorders
router.post('/', authenticate, async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    const { vehicle_id, asset_id, ot_tipo = 'vehiculo', type, priority, description, mechanic_id, parts = [], external_required = false, external_description = '' } = req.body;

    // Validación: según ot_tipo se requiere vehicle_id o asset_id
    if (!description) {
      return res.status(400).json({ error: 'description es requerida' });
    }
    if (ot_tipo === 'vehiculo' && !vehicle_id) {
      return res.status(400).json({ error: 'Para OT de vehículo se requiere vehicle_id' });
    }
    if (ot_tipo !== 'vehiculo' && !asset_id) {
      return res.status(400).json({ error: 'Para OT no-vehicular se requiere asset_id' });
    }
    if (_woIsGerenteSucursal(req) && ot_tipo === 'vehiculo') {
      const suc = _woUserSucursal(req);
      if (!suc || !(await _woVehicleBelongsToSucursal(client, vehicle_id, suc))) {
        return res.status(403).json({ error: 'Solo podés crear OTs sobre vehículos de tu sucursal' });
      }
    }

    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ot_sequence (
        dummy INT PRIMARY KEY DEFAULT 1,
        last_val INT NOT NULL DEFAULT 0,
        CHECK (dummy = 1)
      )
    `);
    await client.query(`INSERT INTO ot_sequence (dummy, last_val) VALUES (1, 0) ON CONFLICT DO NOTHING`);
    const seq = await client.query(`UPDATE ot_sequence SET last_val = last_val + 1 RETURNING last_val`);
    const code = 'OT-' + String(seq.rows[0].last_val).padStart(5, '0');

    // km_at_open solo aplica a vehículos
    let km = 0;
    if (ot_tipo === 'vehiculo' && vehicle_id) {
      const veh = await client.query('SELECT km_current FROM vehicles WHERE id = $1', [vehicle_id]);
      km = veh.rows[0]?.km_current || 0;
    }

    const woType = req.user.role === 'chofer' ? 'Correctivo' : (type || 'Correctivo');

    const wo = await client.query(
      `INSERT INTO work_orders (code, vehicle_id, asset_id, ot_tipo, type, priority, description, mechanic_id, reporter_id, labor_cost, km_at_open, external_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11) RETURNING *`,
      [code,
       ot_tipo === 'vehiculo' ? vehicle_id : null,
       ot_tipo !== 'vehiculo' ? asset_id   : null,
       ot_tipo, woType, normPrioridad(priority), description, mechanic_id||null, req.user.id, km, !!external_required]
    );
    const woId = wo.rows[0].id;

    let partsCost = 0;
    const externalItemsForPO = [];
    const externalPartIdsForPO = [];
    for (const p of parts) {
      if (p.origin === 'stock' && p.stock_id) {
        const stock = await client.query(
          'SELECT qty_current, unit_cost, unit, name FROM stock_items WHERE id = $1 FOR UPDATE',
          [p.stock_id]
        );
        if (!stock.rows[0] || stock.rows[0].qty_current < p.qty) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: `Stock insuficiente para: ${p.name}` });
        }
        // La valorización de la OT debe salir del costo real del pañol,
        // no del valor enviado por el navegador.
        p.unit_cost = parseFloat(stock.rows[0].unit_cost) || 0;
        p.unit = p.unit || stock.rows[0].unit || 'un';
        p.name = (p.name && String(p.name).trim()) ? p.name : (stock.rows[0].name || 'Repuesto de pañol');
        await client.query('UPDATE stock_items SET qty_current = qty_current - $1 WHERE id = $2', [p.qty, p.stock_id]);
        await client.query(
          `INSERT INTO stock_movements (stock_id, type, qty, reason, wo_id, user_id) VALUES ($1,'Egreso',$2,$3,$4,$5)`,
          [p.stock_id, p.qty, `OT ${code}`, woId, req.user.id]
        );
      }
      const originClean = (p.origin === 'stock' && p.stock_id) ? 'stock' : 'externo';
      if (originClean === 'externo') {
        if (!p.name || p.name.trim().length < 3) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Los repuestos externos deben tener una descripción de al menos 3 caracteres' });
        }
      }
      const inserted = await client.query(
        `INSERT INTO work_order_parts (wo_id, stock_id, name, origin, qty, unit, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, subtotal`,
        [woId, originClean === 'stock' ? p.stock_id : null, p.name, originClean, p.qty, p.unit||'un', originClean === 'stock' ? (p.unit_cost||p.cost||0) : 0]
      );
      if (originClean === 'externo') {
        const partId = inserted.rows[0].id;
        externalPartIdsForPO.push(partId);
        externalItemsForPO.push({ descripcion: p.name, cantidad: p.qty || 1, unidad: p.unit || 'un', work_order_part_id: partId });
      }
      partsCost += parseFloat(inserted.rows[0].subtotal);
    }

    let externalPOs = [];
    if (external_required) {
      const serviceDesc = String(external_description || '').trim() || `Trabajo externo / tercerizado para ${code}`;
      const servicePart = await client.query(
        `INSERT INTO work_order_parts (wo_id, stock_id, name, origin, qty, unit, unit_cost)
         VALUES ($1,NULL,$2,'externo',1,'servicio',0) RETURNING id, subtotal`,
        [woId, `Mano de obra tercerizada: ${serviceDesc}`]
      );
      externalItemsForPO.unshift({
        descripcion: `Mano de obra tercerizada: ${serviceDesc}`,
        cantidad: 1,
        unidad: 'servicio',
        work_order_part_id: servicePart.rows[0].id
      });
      partsCost += parseFloat(servicePart.rows[0].subtotal || 0);
    }
    if (externalItemsForPO.length) {
      let sucursal = null;
      if (ot_tipo === 'vehiculo' && vehicle_id) {
        const vbase = await client.query('SELECT base FROM vehicles WHERE id=$1', [vehicle_id]);
        sucursal = vbase.rows[0]?.base || null;
      }
      externalPOs = await createSeparatePOsFromOTItems(client, {
        woId, woCode: code, reqUserId: req.user.id,
        vehicleId: ot_tipo === 'vehiculo' ? vehicle_id : null,
        assetId: ot_tipo !== 'vehiculo' ? asset_id : null,
        sucursal, area: 'Taller', tipo: ot_tipo === 'vehiculo' ? 'flota' : 'otro',
        notes: `Solicitud generada automáticamente desde ${code}. ${description || ''}`,
        prioridad: priority || 'Normal'
      }, externalItemsForPO);
    }

    await client.query('UPDATE work_orders SET parts_cost = $1 WHERE id = $2', [partsCost, woId]);
    await client.query('COMMIT');
    res.status(201).json({
      ...wo.rows[0],
      parts_cost: partsCost,
      parts,
      external_po_id: externalPOs[0]?.id || null,
      external_po_code: externalPOs[0]?.code || null,
      external_po_ids: externalPOs.map(po => po.id),
      external_po_codes: externalPOs.map(po => po.code)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error crear OT:', err.message);
    res.status(500).json({ error: 'Error al crear OT' });
  } finally {
    client.release();
  }
});

// PUT /api/workorders/:id — editar OT
router.put('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','mecanico'), validateUUID('id'), async (req, res) => {
  try {
    const { status, mechanic_id, description, parts_cost, priority } = req.body;
    const check = await query('SELECT status FROM work_orders WHERE id=$1', [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'OT no encontrada' });
    if (check.rows[0].status === 'Cerrada' && req.user.role !== 'dueno') {
      return res.status(409).json({ error: 'No se puede editar una OT cerrada. Solo el dueño puede modificarla.' });
    }
    const newPartsCost = (parts_cost !== undefined && parts_cost !== null && parts_cost !== '') ? parseFloat(parts_cost) : null;
    const result = await query(
      `UPDATE work_orders SET status=$1, mechanic_id=$2, description=$3, labor_cost=0, priority=$4,
         parts_cost = COALESCE($6, parts_cost)
       WHERE id = $5 RETURNING *, parts_cost AS total_cost`,
      [status, mechanic_id||null, description, normPrioridad(priority), req.params.id, newPartsCost]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'OT no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar OT' });
  }
});

// POST /api/workorders/:id/close — cerrar OT
router.post('/:id/close', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','mecanico'), validateUUID('id'), auditAction('CLOSE','work_orders'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    const { root_cause, close_parts = [] } = req.body;
    await client.query('BEGIN');

    const wo = await client.query('SELECT * FROM work_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!wo.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'OT no encontrada' }); }
    if (String(wo.rows[0].status || '').toLowerCase().includes('cerrad')) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'OT ya está cerrada' }); }

    let extraCost = 0;
    const externalItemsForPO = [];
    const externalPartIds = [];
    for (const p of close_parts) {
      const qtyNum = parseFloat(p.qty) || 1;
      const originClean = (p.origin === 'stock' && p.stock_id) ? 'stock' : 'externo';
      const nameClean = String(p.name || 'Repuesto / servicio externo').trim();
      let finalCost = originClean === 'stock' ? (parseFloat(p.unit_cost) || 0) : 0;

      if (originClean === 'stock') {
        const stock = await client.query('SELECT qty_current, unit_cost, unit, name FROM stock_items WHERE id = $1 FOR UPDATE', [p.stock_id]);
        if (!stock.rows[0] || parseFloat(stock.rows[0].qty_current) < qtyNum) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: `Stock insuficiente: ${nameClean}` });
        }
        if (!finalCost) finalCost = parseFloat(stock.rows[0].unit_cost) || 0;
        await client.query('UPDATE stock_items SET qty_current = qty_current - $1 WHERE id = $2', [qtyNum, p.stock_id]);
        await client.query(
          `INSERT INTO stock_movements (stock_id, type, qty, reason, wo_id, user_id) VALUES ($1,'Egreso',$2,$3,$4,$5)`,
          [p.stock_id, qtyNum, `Cierre ${wo.rows[0].code}`, req.params.id, req.user.id]
        );
      }

      const ins = await client.query(
        `INSERT INTO work_order_parts (wo_id, stock_id, name, origin, qty, unit, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, subtotal`,
        [req.params.id, originClean === 'stock' ? p.stock_id : null, nameClean, originClean, qtyNum, p.unit||'un', finalCost]
      );
      if (originClean !== 'stock') {
        const partId = ins.rows[0].id;
        externalPartIds.push(partId);
        externalItemsForPO.push({ descripcion: nameClean, cantidad: qtyNum, unidad: p.unit || 'un', work_order_part_id: partId });
      }
      extraCost += parseFloat(ins.rows[0].subtotal);
    }

    let externalPOs = [];
    if (externalItemsForPO.length) {
      let sucursal = null;
      if (wo.rows[0].vehicle_id) {
        const vbase = await client.query('SELECT base FROM vehicles WHERE id=$1', [wo.rows[0].vehicle_id]);
        sucursal = vbase.rows[0]?.base || null;
      }
      externalPOs = await createSeparatePOsFromOTItems(client, {
        woId: req.params.id, woCode: wo.rows[0].code, reqUserId: req.user.id,
        vehicleId: wo.rows[0].vehicle_id, assetId: wo.rows[0].asset_id,
        sucursal, area: 'Taller', tipo: wo.rows[0].vehicle_id ? 'flota' : 'otro',
        notes: `Solicitud generada automáticamente al cerrar ${wo.rows[0].code}`,
        prioridad: wo.rows[0].priority || 'Normal'
      }, externalItemsForPO);
    }

    const result = await client.query(
      `UPDATE work_orders SET
         status='Cerrada', root_cause=$1, labor_cost=0,
         parts_cost = parts_cost + $2, closed_at = NOW()
       WHERE id=$3 RETURNING *, parts_cost AS total_cost`,
      [root_cause||'—', extraCost, req.params.id]
    );

    await client.query('COMMIT');
    res.locals.recordId = req.params.id;
    res.json({
      ...result.rows[0],
      external_po_id: externalPOs[0]?.id || null,
      external_po_code: externalPOs[0]?.code || null,
      external_po_ids: externalPOs.map(po => po.id),
      external_po_codes: externalPOs.map(po => po.code)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al cerrar OT' });
  } finally {
    client.release();
  }
});

// DELETE /api/workorders/preventivas-hoy
router.delete('/preventivas-hoy', authenticate, requireRole('dueno'), async (req, res) => {
  try {
    const r = await query(
      `DELETE FROM work_orders
       WHERE type = 'Preventivo'
       AND DATE(opened_at) = CURRENT_DATE
       AND status != 'Cerrada'
       RETURNING code`
    );
    res.json({ deleted: r.rowCount, codes: r.rows.map(x=>x.code) });
  } catch(err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ═══════════════════════════════════════════════════════════
//  PARTES DE TRABAJO (OPCIÓN B — trazabilidad MO)
//  Cada OT puede tener múltiples "partes": quién trabajó, horas, tarifa
//  El costo MO se consolida desde los partes (no se ingresa a mano)
// ═══════════════════════════════════════════════════════════

// GET /api/workorders/:id/labor — Listar partes de trabajo de una OT
router.get('/:id/labor', authenticate, validateUUID('id'), async (req, res) => {
  try {
    const r = await query(
      `SELECT wol.*, u.name AS user_name_ref, cb.name AS created_by_name
       FROM work_order_labor wol
       LEFT JOIN users u ON u.id = wol.user_id
       LEFT JOIN users cb ON cb.id = wol.created_by
       WHERE wol.wo_id = $1
       ORDER BY wol.work_date ASC, wol.created_at ASC`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch(err) { console.error(err && err.message); res.status(500).json({ error: 'Error del servidor' }); }
});

// POST /api/workorders/:id/labor — Agregar parte de trabajo
router.post('/:id/labor',
  authenticate,
  requireRole('dueno','gerencia','jefe_mantenimiento','mecanico'),
  validateUUID('id'),
  async (req, res) => {
    const client = await require('../db/pool').pool.connect();
    try {
      const { user_id, worker_name, hours, work_date, notes } = req.body;

      // Validaciones básicas
      const name = (worker_name || '').trim();
      if (!name) return res.status(400).json({ error: 'worker_name es obligatorio' });
      const hoursNum = parseFloat(hours);
      if (!hoursNum || hoursNum <= 0 || hoursNum > 24) {
        return res.status(400).json({ error: 'hours debe ser un número entre 0.01 y 24' });
      }
      const rateNum = 0;

      await client.query('BEGIN');

      // Verificar que la OT existe y no está cerrada
      const wo = await client.query(
        'SELECT id, status, labor_cost FROM work_orders WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!wo.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'OT no encontrada' });
      }
      if (String(wo.rows[0].status || '').toLowerCase().includes('cerrad')) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No se pueden agregar partes a una OT cerrada' });
      }

      // Insertar el parte
      const ins = await client.query(
        `INSERT INTO work_order_labor (wo_id, user_id, worker_name, hours, rate, work_date, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, $8)
         RETURNING *`,
        [req.params.id, user_id || null, name, hoursNum, rateNum,
         work_date || null, (notes || null), req.user.id]
      );

      // Recalcular labor_cost de la OT = SUMA de todos los partes
      await client.query(
        `UPDATE work_orders
         SET labor_cost = 0
         WHERE id = $1`,
        [req.params.id]
      );

      await client.query('COMMIT');
      res.status(201).json(ins.rows[0]);
    } catch(err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Error del servidor' });
    } finally { client.release(); }
  }
);

// DELETE /api/workorders/:id/labor/:laborId — Eliminar parte
router.delete('/:id/labor/:laborId',
  authenticate,
  requireRole('dueno','gerencia','jefe_mantenimiento'),
  validateUUID('id'),
  validateUUID('laborId'),
  async (req, res) => {
    const client = await require('../db/pool').pool.connect();
    try {
      await client.query('BEGIN');

      // Verificar OT no cerrada
      const wo = await client.query(
        'SELECT status FROM work_orders WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!wo.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'OT no encontrada' });
      }
      if (String(wo.rows[0].status || '').toLowerCase().includes('cerrad')) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No se pueden eliminar partes de una OT cerrada' });
      }

      // Eliminar
      const del = await client.query(
        'DELETE FROM work_order_labor WHERE id = $1 AND wo_id = $2 RETURNING id',
        [req.params.laborId, req.params.id]
      );
      if (!del.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Parte de trabajo no encontrado' });
      }

      // Recalcular labor_cost de la OT
      await client.query(
        `UPDATE work_orders
         SET labor_cost = 0
         WHERE id = $1`,
        [req.params.id]
      );

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch(err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Error del servidor' });
    } finally { client.release(); }
  }
);

// ═══════════════════════════════════════════════════════════
//  REPUESTOS EN OT EXISTENTE (agregar/eliminar después de crear)
//  Replica la lógica de creación: valida stock con FOR UPDATE, descuenta,
//  registra movimiento, y recalcula parts_cost de la OT.
// ═══════════════════════════════════════════════════════════

// GET /api/workorders/:id/parts — listar repuestos de una OT
router.get('/:id/parts', authenticate, validateUUID('id'), async (req, res) => {
  try {
    const r = await query(
      `SELECT wop.*, COALESCE(si.code, sc.code) AS stock_code,
              COALESCE(si.name, sc.name) AS stock_name_ref, po.code AS po_code
       FROM work_order_parts wop
       LEFT JOIN stock_items si ON si.id = wop.stock_id
       LEFT JOIN stock_catalog sc ON sc.id = wop.catalog_id
       LEFT JOIN purchase_orders po ON po.id = wop.po_id
       WHERE wop.wo_id = $1
       ORDER BY wop.added_at ASC`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch(err) { console.error('[GET /parts]', err.message); res.status(500).json({ error: 'Error del servidor' }); }
});

// POST /api/workorders/:id/parts — AGREGAR repuesto a OT existente
router.post('/:id/parts',
  authenticate,
  requireRole('dueno','gerencia','jefe_mantenimiento','mecanico','paniol'),
  validateUUID('id'),
  async (req, res) => {
    const client = await require('../db/pool').pool.connect();
    try {
      const { name, origin, stock_id, catalog_id, base_location, area, qty, unit, unit_cost } = req.body;

      // Validaciones básicas
      const nameClean = (name || '').trim();
      if (!nameClean || nameClean.length < 2) {
        return res.status(400).json({ error: 'El nombre del repuesto debe tener al menos 2 caracteres' });
      }
      const qtyNum = parseFloat(qty);
      if (!qtyNum || qtyNum <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
      const originClean = (origin === 'stock' && (stock_id || catalog_id)) ? 'stock' : 'externo';
      const unitCostNum = originClean === 'stock' ? (parseFloat(unit_cost) || 0) : 0;

      await client.query('BEGIN');

      // Verificar OT existe y no está cerrada
      const wo = await client.query(
        'SELECT id, code, status, parts_cost, vehicle_id, asset_id, ot_tipo FROM work_orders WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!wo.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'OT no encontrada' });
      }
      if (String(wo.rows[0].status || '').toLowerCase().includes('cerrad')) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No se pueden agregar repuestos a una OT cerrada' });
      }

      const otCode = wo.rows[0].code;
      let finalUnitCost = unitCostNum;
      let finalStockId = null;
      let finalCatalogId = null, finalLoc = null, finalArea = null;

      // Si es del pañol → descontar y registrar movimiento.
      if (originClean === 'stock' && catalog_id) {
        // Modelo nuevo: descontar del saldo del catálogo en la ubicación elegida.
        const loc = (base_location || 'Central');
        const ar = (area || 'Depósito');
        const cat = await client.query('SELECT name, unit_cost FROM stock_catalog WHERE id = $1', [catalog_id]);
        if (!cat.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Artículo no encontrado' }); }
        const bal = await client.query(
          'SELECT qty_current FROM stock_balances WHERE catalog_id = $1 AND base_location = $2 AND area = $3 FOR UPDATE',
          [catalog_id, loc, ar]);
        const disp = bal.rows[0] ? parseFloat(bal.rows[0].qty_current) : 0;
        if (disp < qtyNum) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Stock insuficiente en ${loc}/${ar}. Disponible: ${disp}` }); }
        await client.query(
          'UPDATE stock_balances SET qty_current = qty_current - $1, updated_at = NOW() WHERE catalog_id = $2 AND base_location = $3 AND area = $4',
          [qtyNum, catalog_id, loc, ar]);
        await client.query(
          `INSERT INTO stock_movements (catalog_id, type, qty, reason, wo_id, base_location, area, user_id)
           VALUES ($1, 'Egreso', $2, $3, $4, $5, $6, $7)`,
          [catalog_id, qtyNum, `OT ${otCode}`, req.params.id, loc, ar, req.user.id]);
        finalUnitCost = parseFloat(cat.rows[0].unit_cost) || 0;
        finalCatalogId = catalog_id; finalLoc = loc; finalArea = ar;
      } else if (originClean === 'stock') {
        // Modelo viejo (compat): descontar de stock_items.
        const stock = await client.query(
          'SELECT qty_current, unit_cost, unit, name FROM stock_items WHERE id = $1 FOR UPDATE',
          [stock_id]
        );
        if (!stock.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Ítem de stock no encontrado' });
        }
        if (parseFloat(stock.rows[0].qty_current) < qtyNum) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: `Stock insuficiente. Disponible: ${stock.rows[0].qty_current}` });
        }
        await client.query(
          'UPDATE stock_items SET qty_current = qty_current - $1 WHERE id = $2',
          [qtyNum, stock_id]
        );
        await client.query(
          `INSERT INTO stock_movements (stock_id, type, qty, reason, wo_id, user_id)
           VALUES ($1, 'Egreso', $2, $3, $4, $5)`,
          [stock_id, qtyNum, `OT ${otCode} (agregado después de crear)`, req.params.id, req.user.id]
        );
        finalUnitCost = parseFloat(stock.rows[0].unit_cost) || 0;
        finalStockId = stock_id;
      }

      // Insertar el repuesto en work_order_parts
      const ins = await client.query(
        `INSERT INTO work_order_parts (wo_id, stock_id, catalog_id, base_location, area, name, origin, qty, unit, unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [req.params.id, finalStockId, finalCatalogId, finalLoc, finalArea, nameClean, originClean,
         qtyNum, (unit || 'un'), finalUnitCost]
      );

      if (originClean === 'externo') {
        let sucursal = null;
        if (wo.rows[0].vehicle_id) {
          const vbase = await client.query('SELECT base FROM vehicles WHERE id=$1', [wo.rows[0].vehicle_id]);
          sucursal = vbase.rows[0]?.base || null;
        }
        const externalPOs = await createSeparatePOsFromOTItems(client, {
          woId: req.params.id, woCode: otCode, reqUserId: req.user.id,
          vehicleId: wo.rows[0].vehicle_id, assetId: wo.rows[0].asset_id,
          sucursal, area: 'Taller', tipo: wo.rows[0].vehicle_id ? 'flota' : 'otro',
          notes: `Solicitud generada automáticamente desde ${otCode} por externo: ${nameClean}`
        }, [{ descripcion: nameClean, cantidad: qtyNum, unidad: unit || 'un', work_order_part_id: ins.rows[0].id }]);
        const externalPO = externalPOs[0] || null;
      }

      // Recalcular parts_cost de la OT = SUMA de todos los repuestos valorizados desde pañol
      await client.query(
        `UPDATE work_orders
         SET parts_cost = COALESCE((SELECT SUM(subtotal) FROM work_order_parts WHERE wo_id = $1), 0)
         WHERE id = $1`,
        [req.params.id]
      );

      await client.query('COMMIT');
      res.status(201).json(ins.rows[0]);
    } catch(err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Error del servidor' });
    } finally { client.release(); }
  }
);

// DELETE /api/workorders/:id/parts/:partId — ELIMINAR repuesto y revertir stock
router.delete('/:id/parts/:partId',
  authenticate,
  requireRole('dueno','gerencia','jefe_mantenimiento'),
  validateUUID('id'),
  validateUUID('partId'),
  async (req, res) => {
    const client = await require('../db/pool').pool.connect();
    try {
      await client.query('BEGIN');

      // Verificar OT no cerrada
      const wo = await client.query(
        'SELECT code, status FROM work_orders WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!wo.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'OT no encontrada' });
      }
      if (String(wo.rows[0].status || '').toLowerCase().includes('cerrad')) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No se pueden eliminar repuestos de una OT cerrada' });
      }

      // Traer el repuesto (para saber si hay que devolver stock)
      const part = await client.query(
        'SELECT * FROM work_order_parts WHERE id = $1 AND wo_id = $2',
        [req.params.partId, req.params.id]
      );
      if (!part.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Repuesto no encontrado' });
      }

      const p = part.rows[0];

      // Si es del pañol → devolver al stock con FOR UPDATE
      if (p.origin === 'stock' && p.stock_id) {
        const stock = await client.query(
          'SELECT qty_current FROM stock_items WHERE id = $1 FOR UPDATE',
          [p.stock_id]
        );
        if (stock.rows[0]) {
          await client.query(
            'UPDATE stock_items SET qty_current = qty_current + $1 WHERE id = $2',
            [p.qty, p.stock_id]
          );
          await client.query(
            `INSERT INTO stock_movements (stock_id, type, qty, reason, wo_id, user_id)
             VALUES ($1, 'Ingreso', $2, $3, $4, $5)`,
            [p.stock_id, p.qty,
             `Reverso por eliminación de repuesto en OT ${wo.rows[0].code}`,
             req.params.id, req.user.id]
          );
        }
      } else if (p.origin === 'stock' && p.catalog_id) {
        // Modelo nuevo: devolver al saldo del catálogo en su ubicación.
        const loc = p.base_location || 'Central';
        const ar = p.area || 'Depósito';
        await client.query(
          `INSERT INTO stock_balances (catalog_id, base_location, area, qty_current) VALUES ($1,$2,$3,$4)
           ON CONFLICT (catalog_id, base_location, area) DO UPDATE SET qty_current = stock_balances.qty_current + EXCLUDED.qty_current, updated_at = NOW()`,
          [p.catalog_id, loc, ar, p.qty]);
        await client.query(
          `INSERT INTO stock_movements (catalog_id, type, qty, reason, wo_id, base_location, area, user_id)
           VALUES ($1,'Ingreso',$2,$3,$4,$5,$6,$7)`,
          [p.catalog_id, p.qty, `Reverso por eliminación de repuesto en OT ${wo.rows[0].code}`, req.params.id, loc, ar, req.user.id]);
      }

      // Eliminar el repuesto
      await client.query('DELETE FROM work_order_parts WHERE id = $1', [req.params.partId]);

      // Recalcular parts_cost de la OT
      await client.query(
        `UPDATE work_orders
         SET parts_cost = COALESCE((SELECT SUM(subtotal) FROM work_order_parts WHERE wo_id = $1), 0)
         WHERE id = $1`,
        [req.params.id]
      );

      await client.query('COMMIT');
      res.json({ ok: true, restored_to_stock: p.origin === 'stock' });
    } catch(err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Error del servidor' });
    } finally { client.release(); }
  }
);

module.exports = router;
