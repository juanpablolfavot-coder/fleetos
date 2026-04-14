const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');

// GET /api/workorders
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, vehicle_id, priority, limit = 50, offset = 0 } = req.query;
    let sql = `
      SELECT wo.*,
             v.code AS vehicle_code, v.plate, v.brand, v.model,
             m.name AS mechanic_name
      FROM work_orders wo
      JOIN vehicles v ON v.id = wo.vehicle_id
      LEFT JOIN users m ON m.id = wo.mechanic_id
      WHERE 1=1
    `;
    const params = [];

    // Los choferes solo ven sus propias novedades
    if (req.user.role === 'chofer') {
      params.push(req.user.id);
      sql += ` AND wo.reporter_id = $${params.length}`;
    }
    if (status)     { params.push(status);     sql += ` AND wo.status = $${params.length}`; }
    if (vehicle_id) { params.push(vehicle_id); sql += ` AND wo.vehicle_id = $${params.length}`; }
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
       JOIN vehicles v ON v.id = wo.vehicle_id
       LEFT JOIN users m ON m.id = wo.mechanic_id
       WHERE wo.id = $1`,
      [req.params.id]
    );
    if (!wo.rows[0]) return res.status(404).json({ error: 'OT no encontrada' });

    // Choferes solo ven sus propias OT
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
    const { vehicle_id, type, priority, description, mechanic_id, parts = [], labor_cost = 0 } = req.body;
    if (!vehicle_id || !description) {
      return res.status(400).json({ error: 'vehicle_id y description son requeridos' });
    }

    await client.query('BEGIN');

    // Generar código único OT
    const count = await client.query('SELECT COUNT(*) FROM work_orders');
    const code  = 'OT-' + String(parseInt(count.rows[0].count) + 1).padStart(5, '0');

    // Obtener km actuales del vehículo
    const veh = await client.query('SELECT km_current FROM vehicles WHERE id = $1', [vehicle_id]);
    const km  = veh.rows[0]?.km_current || 0;

    // Choferes solo pueden crear Correctivo
    const woType = req.user.role === 'chofer' ? 'Correctivo' : (type || 'Correctivo');

    const wo = await client.query(
      `INSERT INTO work_orders (code, vehicle_id, type, priority, description, mechanic_id, reporter_id, labor_cost, km_at_open)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [code, vehicle_id, woType, priority||'Normal', description, mechanic_id||null, req.user.id, labor_cost, km]
    );
    const woId = wo.rows[0].id;

    // Agregar repuestos y descontar stock
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
        // Descontar stock
        await client.query(
          'UPDATE stock_items SET qty_current = qty_current - $1 WHERE id = $2',
          [p.qty, p.stock_id]
        );
        // Registrar movimiento
        await client.query(
          `INSERT INTO stock_movements (stock_id, type, qty, reason, wo_id, user_id)
           VALUES ($1, 'Egreso', $2, $3, $4, $5)`,
          [p.stock_id, p.qty, `OT ${code}`, woId, req.user.id]
        );
      }
      const inserted = await client.query(
        `INSERT INTO work_order_parts (wo_id, stock_id, name, origin, qty, unit, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING subtotal`,
        [woId, p.stock_id||null, p.name, p.origin, p.qty, p.unit||'un', p.unit_cost||p.cost||0]
      );
      partsCost += parseFloat(inserted.rows[0].subtotal);
    }

    // Actualizar parts_cost
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
    const { status, mechanic_id, description, labor_cost, priority } = req.body;
    const result = await query(
      `UPDATE work_orders SET status=$1, mechanic_id=$2, description=$3, labor_cost=$4, priority=$5
       WHERE id = $6 RETURNING *`,
      [status, mechanic_id||null, description, labor_cost||0, priority, req.params.id]
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
    await client.query('BEGIN');

    const wo = await client.query('SELECT * FROM work_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!wo.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'OT no encontrada' }); }
    if (wo.rows[0].status === 'Cerrada') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'OT ya está cerrada' }); }

    // Agregar repuestos del cierre y descontar stock
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
          `INSERT INTO stock_movements (stock_id, type, qty, reason, wo_id, user_id)
           VALUES ($1,'Egreso',$2,$3,$4,$5)`,
          [p.stock_id, p.qty, `Cierre ${wo.rows[0].code}`, req.params.id, req.user.id]
        );
      }
      const ins = await client.query(
        `INSERT INTO work_order_parts (wo_id, stock_id, name, origin, qty, unit, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING subtotal`,
        [req.params.id, p.stock_id||null, p.name, p.origin, p.qty, p.unit||'un', p.unit_cost||0]
      );
      extraCost += parseFloat(ins.rows[0].subtotal);
    }

    const result = await client.query(
      `UPDATE work_orders SET 
         status='Cerrada', root_cause=$1, labor_cost=$2,
         parts_cost = parts_cost + $3, closed_at = NOW()
       WHERE id=$4 RETURNING *`,
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

module.exports = router;
