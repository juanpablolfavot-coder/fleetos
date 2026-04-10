const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole, requireOwner, auditAction } = require('../middleware/auth');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');

// GET /api/stock
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT *, (qty_current <= qty_min) AS is_critical,
              (qty_current * unit_cost) AS total_value
       FROM stock_items WHERE active = TRUE ORDER BY category, name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener stock' });
  }
});

// GET /api/stock/movements — historial de movimientos
router.get('/movements', authenticate, async (req, res) => {
  try {
    const { stock_id, limit = 50 } = req.query;
    let sql = `
      SELECT sm.*, si.name AS item_name, si.unit, u.name AS user_name
      FROM stock_movements sm
      JOIN stock_items si ON si.id = sm.stock_id
      JOIN users u ON u.id = sm.user_id
      WHERE 1=1
    `;
    const params = [];
    if (stock_id) { params.push(stock_id); sql += ` AND sm.stock_id = $${params.length}`; }
    sql += ` ORDER BY sm.created_at DESC LIMIT $${params.length+1}`;
    params.push(parseInt(limit));
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// POST /api/stock — nuevo ítem
router.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','paniol'), async (req, res) => {
  try {
    const { code, name, category, unit, qty_current, qty_min, qty_reorder, unit_cost, supplier } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'code y name son requeridos' });
    const result = await query(
      `INSERT INTO stock_items (code,name,category,unit,qty_current,qty_min,qty_reorder,unit_cost,supplier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [code, name, category||'General', unit||'un', qty_current||0, qty_min||1, qty_reorder||2, unit_cost||0, supplier||null]
    );
    if (qty_current > 0) {
      await query(
        `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id)
         VALUES ($1,'Ingreso',$2,'Alta de ítem nuevo',$3)`,
        [result.rows[0].id, qty_current, req.user.id]
      );
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Código ya existe' });
    res.status(500).json({ error: 'Error al crear ítem' });
  }
});

// POST /api/stock/:id/egreso — egreso de stock
router.post('/:id/egreso', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','mecanico','paniol'), validateUUID('id'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    const { qty, reason } = req.body;
    if (!qty || qty <= 0) return res.status(400).json({ error: 'Cantidad inválida' });

    await client.query('BEGIN');
    const item = await client.query('SELECT * FROM stock_items WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!item.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Ítem no encontrado' }); }
    if (item.rows[0].qty_current < qty) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Stock insuficiente. Disponible: ${item.rows[0].qty_current} ${item.rows[0].unit}` });
    }

    await client.query('UPDATE stock_items SET qty_current = qty_current - $1 WHERE id = $2', [qty, req.params.id]);
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id)
       VALUES ($1,'Egreso',$2,$3,$4)`,
      [req.params.id, qty, reason||'Egreso manual', req.user.id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Egreso registrado', new_qty: item.rows[0].qty_current - qty });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al registrar egreso' });
  } finally {
    client.release();
  }
});

// POST /api/stock/:id/baja — SOLO DUEÑO O GERENCIA
router.post('/:id/baja', authenticate, requireOwner, sensitiveLimiter, validateUUID('id'),
  auditAction('BAJA_STOCK','stock_items'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    const { qty, reason, motive } = req.body;
    if (!qty || qty <= 0)  return res.status(400).json({ error: 'Cantidad inválida' });
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({ error: 'El motivo debe tener al menos 10 caracteres' });
    }

    await client.query('BEGIN');
    const item = await client.query('SELECT * FROM stock_items WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!item.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Ítem no encontrado' }); }
    if (item.rows[0].qty_current < qty) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cantidad mayor al stock disponible (${item.rows[0].qty_current})` });
    }

    await client.query('UPDATE stock_items SET qty_current = qty_current - $1 WHERE id = $2', [qty, req.params.id]);

    const fullReason = `[${(motive||'otro').toUpperCase()}] ${reason}`;
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id, requires_approval, approved_by)
       VALUES ($1,'Baja',$2,$3,$4,TRUE,$4)`,
      [req.params.id, qty, fullReason, req.user.id]
    );

    await client.query('COMMIT');
    res.locals.recordId = req.params.id;
    res.locals.newValue = { qty, reason: fullReason, user: req.user.name };
    res.json({ message: 'Baja registrada y auditada', qty_removed: qty });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al registrar baja' });
  } finally {
    client.release();
  }
});

// POST /api/stock/:id/ajuste — ajuste de inventario
router.post('/:id/ajuste', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','paniol'), validateUUID('id'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    const { new_qty, reason } = req.body;
    if (new_qty === undefined || isNaN(new_qty)) return res.status(400).json({ error: 'new_qty requerido' });

    await client.query('BEGIN');
    const item = await client.query('SELECT * FROM stock_items WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!item.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Ítem no encontrado' }); }

    const diff = new_qty - item.rows[0].qty_current;
    await client.query('UPDATE stock_items SET qty_current = $1 WHERE id = $2', [new_qty, req.params.id]);
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id)
       VALUES ($1,'Ajuste',$2,$3,$4)`,
      [req.params.id, Math.abs(diff), `Ajuste: ${diff>=0?'+':''}${diff} · ${reason||'Recuento físico'}`, req.user.id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Ajuste registrado', new_qty });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al ajustar inventario' });
  } finally {
    client.release();
  }
});

module.exports = router;
