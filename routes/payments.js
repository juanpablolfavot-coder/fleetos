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


async function recalcPagoFacturaYOC(client, invoiceId) {
  const inv = await client.query(`
    SELECT
      id,
      po_id,
      ROUND(invoice_monto * (1 + COALESCE(iva_pct,0) / 100.0), 2) AS invoice_total
    FROM purchase_order_invoices
    WHERE id=$1
    FOR UPDATE
  `, [invoiceId]);
  if (!inv.rows[0]) return null;

  const poId = inv.rows[0].po_id;
  const totalFactura = parseFloat(inv.rows[0].invoice_total) || 0;

  const pag = await client.query(`
    SELECT COALESCE(SUM(monto),0) AS total_pagado
    FROM purchase_order_payments
    WHERE invoice_id=$1
  `, [invoiceId]);
  const totalPagado = parseFloat(pag.rows[0]?.total_pagado || 0);

  await client.query(`
    UPDATE purchase_order_invoices
    SET monto_pagado=$2,
        pagada=($2 >= $3 * 0.999)
    WHERE id=$1
  `, [invoiceId, totalPagado, totalFactura]);

  const tot = await client.query(`
    SELECT
      COALESCE(SUM(ROUND(invoice_monto * (1 + COALESCE(iva_pct,0) / 100.0), 2)),0) AS total_facturas,
      COALESCE(SUM(LEAST(COALESCE(monto_pagado,0), ROUND(invoice_monto * (1 + COALESCE(iva_pct,0) / 100.0), 2))),0) AS total_pagado
    FROM purchase_order_invoices
    WHERE po_id=$1
  `, [poId]);

  const totalFacturas = parseFloat(tot.rows[0]?.total_facturas || 0);
  const totalPagadoOC = parseFloat(tot.rows[0]?.total_pagado || 0);
  const paymentStatus = totalPagadoOC <= 0 ? 'pendiente' : (totalFacturas > 0 && totalPagadoOC >= totalFacturas * 0.999 ? 'total' : 'parcial');

  await client.query(`
    UPDATE purchase_orders
    SET payment_status=$2,
        status = CASE
          WHEN status = 'recibida' THEN 'recibida'
          WHEN $2 = 'total' AND COALESCE(delivery_status,'pendiente') = 'total' THEN 'recibida'
          WHEN $2 = 'total' AND status = 'aprobada_compras' THEN 'pagada'
          ELSE status
        END,
        pagado_at = CASE WHEN $2='total' THEN COALESCE(pagado_at, NOW()) ELSE pagado_at END,
        pagado_por = CASE WHEN $2='total' THEN COALESCE(pagado_por, (
          SELECT paid_by
          FROM purchase_order_payments
          WHERE invoice_id IN (SELECT id FROM purchase_order_invoices WHERE po_id=$1)
          ORDER BY paid_at DESC
          LIMIT 1
        )) ELSE pagado_por END
    WHERE id=$1
  `, [poId, paymentStatus]);

  return { po_id: poId, invoice_total: totalFactura, total_pagado: totalPagado, payment_status: paymentStatus };
}

// ─────────────────────────────────────────────────────────────
//  GET /pendientes — todas las facturas pendientes de pago
// ─────────────────────────────────────────────────────────────
router.get('/pendientes', authenticate, requireRole(...ROLES_PAGAR), async (req, res) => {
  try {
    const r = await query(`
      SELECT
        f.id, f.po_id, f.invoice_nro, f.invoice_fecha, f.invoice_monto,
        f.iva_pct, f.invoice_monto AS invoice_neto, ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) AS invoice_total, ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) AS total_a_pagar,
        f.forma_pago, f.cc_dias, f.vencimiento, f.pagada, f.monto_pagado,
        f.uploaded_at, f.notes,
        po.code AS po_code, po.proveedor, po.supplier_id,
        s.name AS supplier_name, s.cuit AS supplier_cuit,
        s.bank_cbu AS supplier_cbu, s.bank_alias AS supplier_alias, s.bank_name AS supplier_bank,
        (ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) - COALESCE(f.monto_pagado, 0)) AS saldo,
        CASE WHEN f.vencimiento < CURRENT_DATE AND NOT f.pagada THEN TRUE ELSE FALSE END AS vencida,
        CASE WHEN f.vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' AND NOT f.pagada THEN TRUE ELSE FALSE END AS por_vencer
      FROM purchase_order_invoices f
      JOIN purchase_orders po ON po.id = f.po_id
      LEFT JOIN suppliers s    ON s.id = po.supplier_id
      WHERE COALESCE(f.monto_pagado,0) < ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) * 0.999
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

    // Validar que existe la factura y traer datos bancarios del proveedor
    const f = await client.query(
      `SELECT
         f.id, f.invoice_monto, f.invoice_monto AS invoice_neto, f.iva_pct,
         ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) AS invoice_total,
         COALESCE(f.monto_pagado,0) AS monto_pagado, f.pagada,
         po.proveedor,
         s.name AS supplier_name, s.bank_name AS supplier_bank, s.bank_cbu AS supplier_cbu, s.bank_alias AS supplier_alias
       FROM purchase_order_invoices f
       JOIN purchase_orders po ON po.id = f.po_id
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE f.id=$1 AND f.po_id=$2
       FOR UPDATE OF f`,
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

    const saldo = parseFloat(f.rows[0].invoice_total) - parseFloat(f.rows[0].monto_pagado);
    const monto = parseFloat(b.monto);
    if (monto > saldo + 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `El pago supera el saldo pendiente ($${saldo.toFixed(2)})` });
    }

    const clean = (v) => (v == null ? '' : String(v).trim());
    const failPago = async (message) => {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: message });
    };
    const bancoOrigen = clean(b.banco_origen) || null;
    const bancoDestino = clean(b.banco_destino) || clean(f.rows[0].supplier_bank) || clean(f.rows[0].supplier_name) || clean(f.rows[0].proveedor) || null;
    const cbuAliasDestino = clean(b.cbu_alias_destino) || clean(f.rows[0].supplier_alias) || clean(f.rows[0].supplier_cbu) || null;

    // Validaciones específicas por método
    if (b.metodo === 'transferencia') {
      if (!bancoOrigen) {
        return failPago('Falta banco origen');
      }
      if (!bancoDestino && !cbuAliasDestino) {
        return failPago('Faltan datos bancarios del proveedor. Cargá banco/CBU/Alias en Proveedores o completalos manualmente.');
      }
    }
    if (b.metodo === 'cheque') {
      if (!b.cheque_nro)         return failPago('Falta N° de cheque');
      if (!b.cheque_banco)       return failPago('Falta banco emisor del cheque');
      if (!b.cheque_fecha_cobro) return failPago('Falta fecha de pago del cheque');
    }
    if (b.metodo === 'echeq') {
      if (!b.echeq_nro)        return failPago('Falta N° de eCheq');
      if (!b.echeq_banco)      return failPago('Falta banco emisor del eCheq');
      if (!b.echeq_fecha_pago) return failPago('Falta fecha de pago');
    }
    if (b.metodo === 'tarjeta') {
      if (!b.tarjeta_aprobacion) return failPago('Falta N° de aprobación');
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
      bancoOrigen, bancoDestino, cbuAliasDestino,
      b.cheque_nro || null, b.cheque_banco || null, b.cheque_fecha_cobro || null, b.cheque_a_nombre || null,
      b.echeq_nro || null, b.echeq_banco || null, b.echeq_fecha_pago || null, b.echeq_clave || null,
      b.tarjeta_aprobacion || null, b.tarjeta_cuotas ? parseInt(b.tarjeta_cuotas) : null,
    ]);

    // Recalcular con IVA incluido como respaldo.
    // La base ya tiene trigger de recálculo; este bloque no debe impedir guardar el pago
    // si el trigger ya actualizó factura/OC correctamente.
    try {
      await client.query('SAVEPOINT recalc_pago');
      await recalcPagoFacturaYOC(client, req.params.fid);
      await client.query('RELEASE SAVEPOINT recalc_pago');
    } catch (recalcErr) {
      await client.query('ROLLBACK TO SAVEPOINT recalc_pago').catch(() => {});
      console.warn('[pagos POST recalc respaldo]', recalcErr.message);
    }

    await client.query('COMMIT');

    // Releer estado actualizado
    const fact = await query('SELECT pagada, monto_pagado, invoice_monto, invoice_monto AS invoice_neto, iva_pct, ROUND(invoice_monto * (1 + COALESCE(iva_pct,0) / 100.0), 2) AS invoice_total, ROUND(invoice_monto * (1 + COALESCE(iva_pct,0) / 100.0), 2) AS total_a_pagar FROM purchase_order_invoices WHERE id=$1', [req.params.fid]);
    const fact_data = fact.rows[0];

    res.status(201).json({
      ...ins.rows[0],
      factura_pagada: fact_data.pagada,
      monto_pagado_total: fact_data.monto_pagado,
      saldo_restante: parseFloat(fact_data.invoice_total) - parseFloat(fact_data.monto_pagado),
      message: fact_data.pagada ? 'Pago registrado. Factura cancelada totalmente.' : 'Pago parcial registrado.',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[pagos POST]', err.stack || err.message);
    res.status(500).json({ error: `Error al registrar pago: ${err.message}` });
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
    await recalcPagoFacturaYOC(client, req.params.fid);
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
