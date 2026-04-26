// ═══════════════════════════════════════════════════════════
//  FleetOS — Facturas de OCs (rol: proveedores)
//  
//  Endpoints:
//    GET    /api/purchase-orders/mis-ocs              → OCs visibles para el proveedor logueado
//    GET    /api/purchase-orders/:id/facturas         → listar facturas de una OC
//    POST   /api/purchase-orders/:id/facturas         → cargar nueva factura
//    DELETE /api/purchase-orders/:id/facturas/:fid    → anular (creador o dueno/gerencia)
//
//  Lógica:
//    - El usuario con rol 'proveedores' tiene un supplier_id en users.
//    - Ve solo OCs donde purchase_orders.supplier_id = users.supplier_id
//    - Estados visibles: aprobada_compras en adelante (cuando ya se le mandó)
//    - Carga factura → side effect: invoice_status de la OC = parcial|total
//    - Si suma de facturas >= total OC → invoice_status = 'total'
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router  = express.Router({ mergeParams: true });
const { pool, query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const ROLES_VER_FACTURAS  = ['dueno','gerencia','compras','tesoreria','contador','proveedores'];
const ROLES_CARGAR_FAC    = ['dueno','gerencia','compras','contador','proveedores'];

// ─────────────────────────────────────────────────────────────
//  Helper: recalcular invoice_status de la OC
// ─────────────────────────────────────────────────────────────
async function recalcInvoiceStatus(client, poId) {
  const r = await client.query(`
    SELECT
      po.total_estimado AS total_oc,
      po.factura_monto AS factura_legacy,
      COALESCE(SUM(f.invoice_monto), 0) AS total_facturado
    FROM purchase_orders po
    LEFT JOIN purchase_order_invoices f ON f.po_id = po.id
    WHERE po.id = $1
    GROUP BY po.id, po.total_estimado, po.factura_monto
  `, [poId]);

  if (!r.rows[0]) return 'pendiente';

  const totalOC   = parseFloat(r.rows[0].total_oc) || 0;
  const facturado = parseFloat(r.rows[0].total_facturado) || 0;

  let status;
  if (facturado <= 0) status = 'pendiente';
  else if (totalOC > 0 && facturado >= totalOC * 0.999) status = 'total';
  else status = 'parcial';

  await client.query(`UPDATE purchase_orders SET invoice_status = $1 WHERE id = $2`, [status, poId]);
  return status;
}

// ─────────────────────────────────────────────────────────────
//  GET /mis-ocs — OCs del proveedor logueado
// ─────────────────────────────────────────────────────────────
router.get('/mis-ocs', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'proveedores') {
      return res.status(403).json({ error: 'Solo usuarios con rol Proveedores' });
    }

    // El rol "Proveedores" es personal interno que carga facturas de TODOS los proveedores
    // No se filtra por supplier_id del usuario
    const r = await query(`
      SELECT
        po.id, po.code, po.proveedor, po.status, po.created_at,
        po.total_estimado, po.factura_monto,
        po.delivery_status, po.invoice_status, po.payment_status,
        po.forma_pago, po.cc_dias,
        s.name AS supplier_name,
        COALESCE(SUM(f.invoice_monto), 0) AS total_facturado,
        COUNT(f.id) AS cant_facturas
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN purchase_order_invoices f ON f.po_id = po.id
      WHERE po.status IN ('aprobada_compras','pagada','recibida')
      GROUP BY po.id, s.name
      ORDER BY po.created_at DESC
    `);

    res.json(r.rows);
  } catch (err) {
    console.error('[mis-ocs]', err.message);
    res.status(500).json({ error: 'Error al listar OCs' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /:id/facturas — listar facturas de una OC
// ─────────────────────────────────────────────────────────────
router.get('/:id/facturas', authenticate, requireRole(...ROLES_VER_FACTURAS), async (req, res) => {
  try {
    // El rol proveedores es personal interno: ve todas las OCs.

    const r = await query(`
      SELECT
        f.id, f.po_id, f.invoice_nro, f.invoice_fecha, f.invoice_monto,
        f.iva_pct, f.forma_pago, f.cc_dias, f.vencimiento, f.file_url,
        f.uploaded_at, f.uploaded_by, f.pagada, f.monto_pagado, f.notes,
        u.name AS uploaded_by_name,
        COALESCE(SUM(p.monto), 0) AS total_pagado
      FROM purchase_order_invoices f
      LEFT JOIN users u ON u.id = f.uploaded_by
      LEFT JOIN purchase_order_payments p ON p.invoice_id = f.id
      WHERE f.po_id = $1
      GROUP BY f.id, u.name
      ORDER BY f.invoice_fecha DESC, f.uploaded_at DESC
    `, [req.params.id]);

    res.json(r.rows);
  } catch (err) {
    console.error('[facturas GET]', err.message);
    res.status(500).json({ error: 'Error al listar facturas' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/facturas — cargar factura
// ─────────────────────────────────────────────────────────────
router.post('/:id/facturas', authenticate, requireRole(...ROLES_CARGAR_FAC), async (req, res) => {
  const client = await pool.connect();
  try {
    const { invoice_nro, invoice_fecha, invoice_monto, iva_pct, forma_pago, cc_dias, file_url, notes } = req.body;

    if (!invoice_nro || !invoice_nro.trim()) return res.status(400).json({ error: 'Falta el N° de factura' });
    if (!invoice_fecha)                       return res.status(400).json({ error: 'Falta la fecha de factura' });
    if (!(parseFloat(invoice_monto) > 0))     return res.status(400).json({ error: 'Monto inválido' });

    await client.query('BEGIN');

    const poRow = await client.query(
      `SELECT id, status, supplier_id, forma_pago AS oc_forma_pago, cc_dias AS oc_cc_dias FROM purchase_orders WHERE id=$1 FOR UPDATE`,
      [req.params.id]
    );
    if (!poRow.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }
    if (!['aprobada_compras','pagada','recibida'].includes(poRow.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `No se puede facturar una OC en estado ${poRow.rows[0].status}` });
    }

    // Si es proveedor, validar que sea su OC
    if (req.user.role === 'proveedores') {
      const u = await client.query('SELECT supplier_id FROM users WHERE id=$1', [req.user.id]);
      if (poRow.rows[0].supplier_id !== u.rows[0]?.supplier_id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Esta OC no pertenece a tu proveedor' });
      }
    }

    // Validar duplicado
    const dup = await client.query(
      `SELECT id FROM purchase_order_invoices WHERE po_id=$1 AND invoice_nro=$2`,
      [req.params.id, invoice_nro.trim()]
    );
    if (dup.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Ya existe una factura ${invoice_nro} para esta OC` });
    }

    // Calcular vencimiento: fecha + cc_dias
    const fp = forma_pago || poRow.rows[0].oc_forma_pago || null;
    const cc = parseInt(cc_dias ?? poRow.rows[0].oc_cc_dias) || 0;
    let vencimiento = null;
    if (cc > 0) {
      const f = new Date(invoice_fecha);
      f.setDate(f.getDate() + cc);
      vencimiento = f.toISOString().slice(0,10);
    } else {
      vencimiento = invoice_fecha;
    }

    const ins = await client.query(`
      INSERT INTO purchase_order_invoices
        (po_id, invoice_nro, invoice_fecha, invoice_monto, iva_pct,
         forma_pago, cc_dias, vencimiento, file_url, uploaded_by, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      req.params.id, invoice_nro.trim(), invoice_fecha, parseFloat(invoice_monto),
      parseFloat(iva_pct ?? 21), fp, cc, vencimiento, (file_url || '').trim() || null,
      req.user.id, (notes || '').trim() || null
    ]);

    const newStatus = await recalcInvoiceStatus(client, req.params.id);

    await client.query('COMMIT');

    res.status(201).json({
      ...ins.rows[0],
      invoice_status: newStatus,
      message: newStatus === 'total' ? 'Factura registrada. OC totalmente facturada.' : 'Factura registrada.'
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[facturas POST]', err.message);
    res.status(500).json({ error: 'Error al cargar factura' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  DELETE /:id/facturas/:fid — anular factura
// ─────────────────────────────────────────────────────────────
router.delete('/:id/facturas/:fid', authenticate, requireRole(...ROLES_CARGAR_FAC), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const f = await client.query(
      `SELECT id, uploaded_by FROM purchase_order_invoices WHERE id=$1 AND po_id=$2 FOR UPDATE`,
      [req.params.fid, req.params.id]
    );
    if (!f.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    // Si tiene pagos, no se puede anular
    const pagos = await client.query('SELECT COUNT(*) AS n FROM purchase_order_payments WHERE invoice_id=$1', [req.params.fid]);
    if (parseInt(pagos.rows[0].n) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No se puede anular: la factura ya tiene pagos registrados' });
    }

    // Solo creador o dueno/gerencia
    if (!['dueno','gerencia'].includes(req.user.role) && f.rows[0].uploaded_by !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Solo podés anular facturas que vos cargaste' });
    }

    await client.query(`DELETE FROM purchase_order_invoices WHERE id=$1`, [req.params.fid]);
    await recalcInvoiceStatus(client, req.params.id);

    await client.query('COMMIT');
    res.json({ ok: true, message: 'Factura anulada' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[facturas DELETE]', err.message);
    res.status(500).json({ error: 'Error al anular factura' });
  } finally {
    client.release();
  }
});

module.exports = router;
