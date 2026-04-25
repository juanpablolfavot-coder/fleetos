// ═══════════════════════════════════════════════════════════
//  FleetOS — Pagos de facturas (rol: tesoreria/dueno/gerencia)
//
//  Endpoints:
//    GET    /api/payments/pendientes              → todas las facturas pendientes/parciales (panel global)
//    GET    /api/purchase-orders/:id/facturas/:fid/pagos     → pagos de una factura
//    POST   /api/purchase-orders/:id/facturas/:fid/pagos     → registrar pago
//    DELETE /api/purchase-orders/:id/facturas/:fid/pagos/:pid → anular pago
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router  = express.Router({ mergeParams: true });
const { pool, query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const ROLES_PAGAR = ['dueno','gerencia','tesoreria'];

const METODOS = ['efectivo','transferencia','cheque','echeq','tarjeta','otro'];

// ─────────────────────────────────────────────────────────────
//  GET /pendientes — todas las facturas pendientes de pago
// ─────────────────────────────────────────────────────────────
router.get('/pendientes', authenticate, requireRole(...ROLES_PAGAR), async (req, res) => {
  try {
    const r = await query(`
      SELECT
        f.id, f.po_id, f.invoice_nro, f.invoice_fecha, f.invoice_monto,
        f.iva_pct, f.forma_pago, f.cc_dias, f.vencimiento, f.pagada, f.monto_pagado,
        f.uploaded_at, f.notes,
        po.code AS po_code, po.proveedor, po.supplier_id,
        s.name AS supplier_name, s.cuit AS supplier_cuit,
        s.bank_cbu AS supplier_cbu, s.bank_alias AS supplier_alias, s.bank_name AS supplier_bank,
        (f.invoice_monto - COALESCE(f.monto_pagado, 0)) AS saldo,
        CASE WHEN f.vencimiento < CURRENT_DATE AND NOT f.pagada THEN TRUE ELSE FALSE END AS vencida,
        CASE WHEN f.vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' AND NOT f.pagada THEN TRUE ELSE FALSE END AS por_vencer
      FROM purchase_order_invoices f
      JOIN purchase_orders po ON po.id = f.po_id
      LEFT JOIN suppliers s    ON s.id = po.supplier_id
      WHERE NOT f.pagada
      ORDER BY f.vencimiento ASC NULLS LAST, f.invoice_fecha ASC
    `);
    res.json(r.rows);
  } catch (err) {
    console.error('[pagos pendientes]', err.message);
    res.status(500).json({ error: 'Error al listar pendientes' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /:id/facturas/:fid/pagos
// ─────────────────────────────────────────────────────────────
router.get('/:id/facturas/:fid/pagos', authenticate, requireRole(...ROLES_PAGAR, 'compras','contador','proveedores'), async (req, res) => {
  try {
    const r = await query(`
      SELECT
        p.id, p.invoice_id, p.paid_by, p.paid_at, p.monto, p.metodo, p.comprobante_nro, p.notes, p.file_url,
        p.banco_origen, p.banco_destino, p.cbu_alias_destino,
        p.cheque_nro, p.cheque_banco, p.cheque_fecha_cobro, p.cheque_a_nombre,
        p.echeq_nro, p.echeq_banco, p.echeq_fecha_pago, p.echeq_clave,
        p.tarjeta_aprobacion, p.tarjeta_cuotas,
        u.name AS paid_by_name
      FROM purchase_order_payments p
      LEFT JOIN users u ON u.id = p.paid_by
      WHERE p.invoice_id = $1
      ORDER BY p.paid_at DESC
    `, [req.params.fid]);
    res.json(r.rows);
  } catch (err) {
    console.error('[pagos GET]', err.message);
    res.status(500).json({ error: 'Error al listar pagos' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/facturas/:fid/pagos — registrar pago
// ─────────────────────────────────────────────────────────────
router.post('/:id/facturas/:fid/pagos', authenticate, requireRole(...ROLES_PAGAR), async (req, res) => {
  const client = await pool.connect();
  try {
    const b = req.body;

    if (!METODOS.includes(b.metodo)) {
      return res.status(400).json({ error: 'Método de pago inválido' });
    }
    if (!(parseFloat(b.monto) > 0)) {
      return res.status(400).json({ error: 'Monto inválido' });
    }

    await client.query('BEGIN');

    // Validar que existe la factura
    const f = await client.query(
      `SELECT id, invoice_monto, COALESCE(monto_pagado,0) AS monto_pagado, pagada
       FROM purchase_order_invoices WHERE id=$1 AND po_id=$2 FOR UPDATE`,
      [req.params.fid, req.params.id]
    );
    if (!f.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    if (f.rows[0].pagada) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La factura ya está pagada' });
    }

    const saldo = parseFloat(f.rows[0].invoice_monto) - parseFloat(f.rows[0].monto_pagado);
    const monto = parseFloat(b.monto);
    if (monto > saldo + 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `El pago supera el saldo pendiente ($${saldo.toFixed(2)})` });
    }

    // Validaciones específicas por método
    if (b.metodo === 'transferencia') {
      if (!b.banco_origen)  return res.status(400).json({ error: 'Falta banco origen' });
      if (!b.banco_destino) return res.status(400).json({ error: 'Falta banco destino' });
    }
    if (b.metodo === 'cheque') {
      if (!b.cheque_nro)         return res.status(400).json({ error: 'Falta N° de cheque' });
      if (!b.cheque_banco)       return res.status(400).json({ error: 'Falta banco emisor del cheque' });
      if (!b.cheque_fecha_cobro) return res.status(400).json({ error: 'Falta fecha de cobro' });
    }
    if (b.metodo === 'echeq') {
      if (!b.echeq_nro)        return res.status(400).json({ error: 'Falta N° de eCheq' });
      if (!b.echeq_banco)      return res.status(400).json({ error: 'Falta banco emisor del eCheq' });
      if (!b.echeq_fecha_pago) return res.status(400).json({ error: 'Falta fecha de pago' });
    }
    if (b.metodo === 'tarjeta') {
      if (!b.tarjeta_aprobacion) return res.status(400).json({ error: 'Falta N° de aprobación' });
    }

    const ins = await client.query(`
      INSERT INTO purchase_order_payments
        (invoice_id, paid_by, monto, metodo, comprobante_nro, file_url, notes,
         banco_origen, banco_destino, cbu_alias_destino,
         cheque_nro, cheque_banco, cheque_fecha_cobro, cheque_a_nombre,
         echeq_nro, echeq_banco, echeq_fecha_pago, echeq_clave,
         tarjeta_aprobacion, tarjeta_cuotas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *
    `, [
      req.params.fid, req.user.id, monto, b.metodo,
      (b.comprobante_nro || '').trim() || null,
      (b.file_url || '').trim() || null,
      (b.notes || '').trim() || null,
      b.banco_origen || null, b.banco_destino || null, b.cbu_alias_destino || null,
      b.cheque_nro || null, b.cheque_banco || null, b.cheque_fecha_cobro || null, b.cheque_a_nombre || null,
      b.echeq_nro || null, b.echeq_banco || null, b.echeq_fecha_pago || null, b.echeq_clave || null,
      b.tarjeta_aprobacion || null, b.tarjeta_cuotas ? parseInt(b.tarjeta_cuotas) : null,
    ]);

    // El trigger DB recalcula invoice.pagada y po.payment_status
    await client.query('COMMIT');

    // Releer estado actualizado
    const fact = await query('SELECT pagada, monto_pagado, invoice_monto FROM purchase_order_invoices WHERE id=$1', [req.params.fid]);
    const fact_data = fact.rows[0];

    res.status(201).json({
      ...ins.rows[0],
      factura_pagada: fact_data.pagada,
      monto_pagado_total: fact_data.monto_pagado,
      saldo_restante: parseFloat(fact_data.invoice_monto) - parseFloat(fact_data.monto_pagado),
      message: fact_data.pagada ? 'Pago registrado. Factura cancelada totalmente.' : 'Pago parcial registrado.',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[pagos POST]', err.message);
    res.status(500).json({ error: 'Error al registrar pago' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  DELETE /:id/facturas/:fid/pagos/:pid — anular pago
// ─────────────────────────────────────────────────────────────
router.delete('/:id/facturas/:fid/pagos/:pid', authenticate, requireRole(...ROLES_PAGAR), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(
      'SELECT id, paid_by FROM purchase_order_payments WHERE id=$1 AND invoice_id=$2 FOR UPDATE',
      [req.params.pid, req.params.fid]
    );
    if (!p.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    if (!['dueno','gerencia'].includes(req.user.role) && p.rows[0].paid_by !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Solo podés anular pagos que vos cargaste' });
    }

    await client.query('DELETE FROM purchase_order_payments WHERE id=$1', [req.params.pid]);
    // El trigger recalcula
    await client.query('COMMIT');
    res.json({ ok: true, message: 'Pago anulado' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[pagos DELETE]', err.message);
    res.status(500).json({ error: 'Error al anular pago' });
  } finally {
    client.release();
  }
});

module.exports = router;
