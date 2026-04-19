const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');

// Auto-migrate: agregar campos ot_tipo, asset_id, y crear tabla work_order_labor
(async () => {
  try {
    await query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS ot_tipo VARCHAR(20) DEFAULT 'vehiculo'`).catch(()=>{});
    await query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS asset_id UUID`).catch(()=>{});
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
  } catch(e) { /* silent */ }
})();

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

    const parts = await query(
      `SELECT wop.*, si.code AS stock_code
       FROM work_order_parts wop
       LEFT JOIN stock_items si ON si.id = wop.stock_id
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
    const { vehicle_id, asset_id, ot_tipo = 'vehiculo', type, priority, description, mechanic_id, parts = [], labor_cost = 0 } = req.body;

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
      `INSERT INTO work_orders (code, vehicle_id, asset_id, ot_tipo, type, priority, description, mechanic_id, reporter_id, labor_cost, km_at_open)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [code,
       ot_tipo === 'vehiculo' ? vehicle_id : null,
       ot_tipo !== 'vehiculo' ? asset_id   : null,
       ot_tipo, woType, priority||'Normal', description, mechanic_id||null, req.user.id, labor_cost, km]
    );
    const woId = wo.rows[0].id;

    let partsCost = 0;
    for (const p of parts) {
      if (p.origin === 'stock' && p.stock_id) {
        const stock = await client.query(
          'SELECT qty_current, unit_cost FROM stock_items WHERE id = $1 FOR UPDATE',
          [p.stock_id]
        );
        if (!stock.rows[0] || stock.rows[0].qty_current < p.qty) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: `Stock insuficiente para: ${p.name}` });
        }
        await client.query('UPDATE stock_items SET qty_current = qty_current - $1 WHERE id = $2', [p.qty, p.stock_id]);
        await client.query(
          `INSERT INTO stock_movements (stock_id, type, qty, reason, wo_id, user_id) VALUES ($1,'Egreso',$2,$3,$4,$5)`,
          [p.stock_id, p.qty, `OT ${code}`, woId, req.user.id]
        );
      }
      if (p.origin === 'externo' || !p.stock_id) {
        if (!p.name || p.name.trim().length < 3) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Los repuestos externos deben tener una descripción de al menos 3 caracteres' });
        }
        if ((p.unit_cost||p.cost||0) > 10000000) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Precio unitario fuera de rango para: ${p.name}. Máximo $10.000.000 por unidad.` });
        }
      }
      const inserted = await client.query(
        `INSERT INTO work_order_parts (wo_id, stock_id, name, origin, qty, unit, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING subtotal`,
        [woId, p.stock_id||null, p.name, p.origin, p.qty, p.unit||'un', p.unit_cost||p.cost||0]
      );
      partsCost += parseFloat(inserted.rows[0].subtotal);
    }

    await client.query('UPDATE work_orders SET parts_cost = $1 WHERE id = $2', [partsCost, woId]);
    await client.query('COMMIT');
    res.status(201).json({ ...wo.rows[0], parts_cost: partsCost, parts });
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
    const { status, mechanic_id, description, labor_cost, parts_cost, priority } = req.body;
    const check = await query('SELECT status FROM work_orders WHERE id=$1', [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'OT no encontrada' });
    if (check.rows[0].status === 'Cerrada' && req.user.role !== 'dueno') {
      return res.status(409).json({ error: 'No se puede editar una OT cerrada. Solo el dueño puede modificarla.' });
    }
    const newPartsCost = (parts_cost !== undefined && parts_cost !== null && parts_cost !== '') ? parseFloat(parts_cost) : null;
    const result = await query(
      `UPDATE work_orders SET status=$1, mechanic_id=$2, description=$3, labor_cost=$4, priority=$5,
         parts_cost = COALESCE($7, parts_cost)
       WHERE id = $6 RETURNING *, (labor_cost + parts_cost) AS total_cost`,
      [status, mechanic_id||null, description, parseFloat(labor_cost)||0, priority, req.params.id, newPartsCost]
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
    const { root_cause, labor_cost, close_parts = [] } = req.body;
    if (labor_cost > 0 && req.user.role === 'mecanico') {
      return res.status(403).json({ error: 'El mecánico no puede cargar el costo de mano de obra.' });
    }
    await client.query('BEGIN');

    const wo = await client.query('SELECT * FROM work_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!wo.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'OT no encontrada' }); }
    if (wo.rows[0].status === 'Cerrada') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'OT ya está cerrada' }); }

    let extraCost = 0;
    for (const p of close_parts) {
      if (p.origin === 'stock' && p.stock_id) {
        const stock = await client.query('SELECT qty_current FROM stock_items WHERE id = $1 FOR UPDATE', [p.stock_id]);
        if (!stock.rows[0] || stock.rows[0].qty_current < p.qty) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: `Stock insuficiente: ${p.name}` });
        }
        await client.query('UPDATE stock_items SET qty_current = qty_current - $1 WHERE id = $2', [p.qty, p.stock_id]);
        await client.query(
          `INSERT INTO stock_movements (stock_id, type, qty, reason, wo_id, user_id) VALUES ($1,'Egreso',$2,$3,$4,$5)`,
          [p.stock_id, p.qty, `Cierre ${wo.rows[0].code}`, req.params.id, req.user.id]
        );
      }
      const ins = await client.query(
        `INSERT INTO work_order_parts (wo_id, stock_id, name, origin, qty, unit, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING subtotal`,
        [req.params.id, p.stock_id||null, p.name, p.origin, p.qty, p.unit||'un', p.unit_cost||0]
      );
      extraCost += parseFloat(ins.rows[0].subtotal);
    }

    const result = await client.query(
      `UPDATE work_orders SET
         status='Cerrada', root_cause=$1, labor_cost=$2,
         parts_cost = parts_cost + $3, closed_at = NOW()
       WHERE id=$4 RETURNING *, (labor_cost + parts_cost) AS total_cost`,
      [root_cause||'—', labor_cost||wo.rows[0].labor_cost, extraCost, req.params.id]
    );

    await client.query('COMMIT');
    res.locals.recordId = req.params.id;
    res.json(result.rows[0]);
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
    res.status(500).json({ error: err.message });
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
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/workorders/:id/labor — Agregar parte de trabajo
router.post('/:id/labor',
  authenticate,
  requireRole('dueno','gerencia','jefe_mantenimiento','mecanico'),
  validateUUID('id'),
  async (req, res) => {
    const client = await require('../db/pool').pool.connect();
    try {
      const { user_id, worker_name, hours, rate, work_date, notes } = req.body;

      // Validaciones básicas
      const name = (worker_name || '').trim();
      if (!name) return res.status(400).json({ error: 'worker_name es obligatorio' });
      const hoursNum = parseFloat(hours);
      if (!hoursNum || hoursNum <= 0 || hoursNum > 24) {
        return res.status(400).json({ error: 'hours debe ser un número entre 0.01 y 24' });
      }
      const rateNum = parseFloat(rate) || 0;
      if (rateNum < 0) return res.status(400).json({ error: 'rate no puede ser negativo' });

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
      if (wo.rows[0].status === 'Cerrada') {
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
         SET labor_cost = COALESCE((SELECT SUM(subtotal) FROM work_order_labor WHERE wo_id = $1), 0)
         WHERE id = $1`,
        [req.params.id]
      );

      await client.query('COMMIT');
      res.status(201).json(ins.rows[0]);
    } catch(err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
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
      if (wo.rows[0].status === 'Cerrada') {
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
         SET labor_cost = COALESCE((SELECT SUM(subtotal) FROM work_order_labor WHERE wo_id = $1), 0)
         WHERE id = $1`,
        [req.params.id]
      );

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch(err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
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
      `SELECT wop.*, si.code AS stock_code, si.name AS stock_name_ref
       FROM work_order_parts wop
       LEFT JOIN stock_items si ON si.id = wop.stock_id
       WHERE wop.wo_id = $1
       ORDER BY wop.created_at ASC`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/workorders/:id/parts — AGREGAR repuesto a OT existente
router.post('/:id/parts',
  authenticate,
  requireRole('dueno','gerencia','jefe_mantenimiento','mecanico','paniol'),
  validateUUID('id'),
  async (req, res) => {
    const client = await require('../db/pool').pool.connect();
    try {
      const { name, origin, stock_id, qty, unit, unit_cost } = req.body;

      // Validaciones básicas
      const nameClean = (name || '').trim();
      if (!nameClean || nameClean.length < 2) {
        return res.status(400).json({ error: 'El nombre del repuesto debe tener al menos 2 caracteres' });
      }
      const qtyNum = parseFloat(qty);
      if (!qtyNum || qtyNum <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
      const originClean = (origin === 'stock' && stock_id) ? 'stock' : 'externo';
      const unitCostNum = parseFloat(unit_cost) || 0;

      if (originClean === 'externo' && unitCostNum > 10000000) {
        return res.status(400).json({ error: `Precio unitario fuera de rango. Máximo $10.000.000 por unidad.` });
      }

      await client.query('BEGIN');

      // Verificar OT existe y no está cerrada
      const wo = await client.query(
        'SELECT id, code, status, parts_cost FROM work_orders WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!wo.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'OT no encontrada' });
      }
      if (wo.rows[0].status === 'Cerrada') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No se pueden agregar repuestos a una OT cerrada' });
      }

      const otCode = wo.rows[0].code;
      let finalUnitCost = unitCostNum;
      let finalStockId = null;

      // Si es del pañol → descontar con FOR UPDATE + registrar movimiento
      if (originClean === 'stock') {
        const stock = await client.query(
          'SELECT qty_current, unit_cost FROM stock_items WHERE id = $1 FOR UPDATE',
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

        // Usar el precio del stock si no se envió uno explícito
        if (!unitCostNum || unitCostNum === 0) {
          finalUnitCost = parseFloat(stock.rows[0].unit_cost) || 0;
        }
        finalStockId = stock_id;
      }

      // Insertar el repuesto en work_order_parts
      const ins = await client.query(
        `INSERT INTO work_order_parts (wo_id, stock_id, name, origin, qty, unit, unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.params.id, finalStockId, nameClean, originClean,
         qtyNum, (unit || 'un'), finalUnitCost]
      );

      // Recalcular parts_cost de la OT = SUMA de todos los repuestos
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
      res.status(500).json({ error: err.message });
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
      if (wo.rows[0].status === 'Cerrada') {
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
      res.status(500).json({ error: err.message });
    } finally { client.release(); }
  }
);

module.exports = router;
