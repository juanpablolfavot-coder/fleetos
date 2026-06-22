// ═══════════════════════════════════════════════════════════
//  FleetOS — Pagos de facturas (rol: tesoreria/dueno/gerencia)
//
//  Endpoints:
//    GET    /api/payments/pendientes              → facturas pendientes + historial pagado si se pide filtro=todas/pagadas
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

const INVOICE_TOTAL_SQL = `ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2)`;

let _paymentEnginePromise = null;
function ensurePaymentEngine() {
  if (_paymentEnginePromise) return _paymentEnginePromise;
  _paymentEnginePromise = query(`
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS banco_origen VARCHAR(100);
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS banco_destino VARCHAR(100);
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS cbu_alias_destino VARCHAR(100);
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS cheque_nro VARCHAR(50);
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS cheque_banco VARCHAR(100);
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS cheque_fecha_cobro DATE;
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS cheque_a_nombre VARCHAR(200);
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS echeq_nro VARCHAR(50);
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS echeq_banco VARCHAR(100);
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS echeq_fecha_pago DATE;
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS echeq_clave VARCHAR(100);
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS tarjeta_aprobacion VARCHAR(50);
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS tarjeta_cuotas INTEGER;

    -- Reparación legacy: facturas que el sistema viejo marcó como pagadas solo con el neto.
    -- Se ajusta el último pago para que represente el total real pagado con IVA incluido.
    WITH pagos AS (
      SELECT invoice_id, COALESCE(SUM(monto),0) AS total_pagado
      FROM purchase_order_payments
      GROUP BY invoice_id
    ), legacy AS (
      SELECT
        f.id AS invoice_id,
        ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) AS total_con_iva,
        COALESCE(p.total_pagado,0) AS total_pagado
      FROM purchase_order_invoices f
      LEFT JOIN pagos p ON p.invoice_id = f.id
      WHERE f.pagada = TRUE
        AND COALESCE(f.iva_pct,0) > 0
        AND COALESCE(p.total_pagado,0) >= f.invoice_monto * 0.999
        AND COALESCE(p.total_pagado,0) < ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) * 0.999
        AND EXISTS (SELECT 1 FROM purchase_order_payments pp WHERE pp.invoice_id = f.id)
    ), ultimo_pago AS (
      SELECT DISTINCT ON (p.invoice_id)
        p.id,
        l.invoice_id,
        l.total_con_iva,
        l.total_pagado
      FROM purchase_order_payments p
      JOIN legacy l ON l.invoice_id = p.invoice_id
      ORDER BY p.invoice_id, p.paid_at DESC, p.created_at DESC
    )
    UPDATE purchase_order_payments p
    SET monto = ROUND(p.monto + (u.total_con_iva - u.total_pagado), 2),
        notes = TRIM(CONCAT(COALESCE(p.notes,''), ' | Ajuste automático IVA legacy: pago llevado a total con IVA'))
    FROM ultimo_pago u
    WHERE p.id = u.id;

    CREATE OR REPLACE FUNCTION recalc_invoice_payment() RETURNS TRIGGER AS $$
    DECLARE
      v_invoice_id UUID;
      v_po_id UUID;
      v_invoice_total NUMERIC;
      v_total_pagado NUMERIC;
      v_total_facturas NUMERIC;
      v_total_facturas_pagadas NUMERIC;
      v_po_status VARCHAR;
      v_delivery_status VARCHAR;
      v_payment_status VARCHAR;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        v_invoice_id := OLD.invoice_id;
      ELSE
        v_invoice_id := NEW.invoice_id;
      END IF;

      SELECT po_id, ROUND(invoice_monto * (1 + COALESCE(iva_pct,0) / 100.0), 2)
        INTO v_po_id, v_invoice_total
      FROM purchase_order_invoices
      WHERE id = v_invoice_id;

      IF v_po_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
      END IF;

      SELECT COALESCE(SUM(monto), 0) INTO v_total_pagado
      FROM purchase_order_payments
      WHERE invoice_id = v_invoice_id;

      UPDATE purchase_order_invoices
      SET monto_pagado = v_total_pagado,
          pagada = (v_total_pagado >= v_invoice_total * 0.999)
      WHERE id = v_invoice_id;

      SELECT
        COALESCE(SUM(ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2)), 0),
        COALESCE(SUM(LEAST(COALESCE(pay.total_pagado,0), ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2))), 0)
      INTO v_total_facturas, v_total_facturas_pagadas
      FROM purchase_order_invoices f
      LEFT JOIN (
        SELECT invoice_id, SUM(monto) AS total_pagado
        FROM purchase_order_payments
        GROUP BY invoice_id
      ) pay ON pay.invoice_id = f.id
      WHERE f.po_id = v_po_id;

      v_payment_status := CASE
        WHEN v_total_facturas_pagadas <= 0 THEN 'pendiente'
        WHEN v_total_facturas > 0 AND v_total_facturas_pagadas >= v_total_facturas * 0.999 THEN 'total'
        ELSE 'parcial'
      END;

      SELECT status, delivery_status INTO v_po_status, v_delivery_status
      FROM purchase_orders
      WHERE id = v_po_id;

      UPDATE purchase_orders
      SET payment_status = v_payment_status,
          status = CASE
            WHEN v_po_status = 'recibida' THEN 'recibida'
            WHEN v_payment_status = 'total' AND COALESCE(v_delivery_status,'pendiente') = 'total' THEN 'recibida'
            WHEN v_payment_status = 'total' AND v_po_status IN ('aprobada_compras','enviada_proveedor','pagada') THEN 'pagada'
            WHEN v_payment_status <> 'total' AND v_po_status = 'pagada' AND COALESCE(v_delivery_status,'pendiente') = 'total' THEN 'recibida'
            WHEN v_payment_status <> 'total' AND v_po_status = 'pagada' THEN 'enviada_proveedor'
            ELSE status
          END,
          pagado_at = CASE WHEN v_payment_status='total' THEN COALESCE(pagado_at, NOW()) ELSE NULL END,
          pagado_por = CASE WHEN v_payment_status='total' THEN COALESCE(pagado_por, (
            SELECT paid_by
            FROM purchase_order_payments
            WHERE invoice_id IN (SELECT id FROM purchase_order_invoices WHERE po_id = v_po_id)
            ORDER BY paid_at DESC
            LIMIT 1
          )) ELSE NULL END
      WHERE id = v_po_id;

      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_recalc_invoice_payment ON purchase_order_payments;
    CREATE TRIGGER trg_recalc_invoice_payment
    AFTER INSERT OR UPDATE OR DELETE ON purchase_order_payments
    FOR EACH ROW EXECUTE FUNCTION recalc_invoice_payment();

    -- Recalcular facturas existentes con pagos reales y total con IVA.
    WITH pagos AS (
      SELECT invoice_id, COALESCE(SUM(monto),0) AS total_pagado
      FROM purchase_order_payments
      GROUP BY invoice_id
    )
    UPDATE purchase_order_invoices f
    SET monto_pagado = COALESCE(p.total_pagado, 0),
        pagada = COALESCE(p.total_pagado,0) >= ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) * 0.999
    FROM pagos p
    WHERE f.id = p.invoice_id;

    UPDATE purchase_order_invoices f
    SET monto_pagado = 0,
        pagada = FALSE
    WHERE NOT EXISTS (SELECT 1 FROM purchase_order_payments p WHERE p.invoice_id = f.id);

    WITH po_totals AS (
      SELECT
        f.po_id,
        COALESCE(SUM(ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2)), 0) AS total_facturas,
        COALESCE(SUM(LEAST(COALESCE(pay.total_pagado,0), ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2))), 0) AS total_pagado
      FROM purchase_order_invoices f
      LEFT JOIN (
        SELECT invoice_id, SUM(monto) AS total_pagado
        FROM purchase_order_payments
        GROUP BY invoice_id
      ) pay ON pay.invoice_id = f.id
      GROUP BY f.po_id
    ), estados AS (
      SELECT
        po_id,
        CASE
          WHEN total_pagado <= 0 THEN 'pendiente'
          WHEN total_facturas > 0 AND total_pagado >= total_facturas * 0.999 THEN 'total'
          ELSE 'parcial'
        END AS payment_status
      FROM po_totals
    )
    UPDATE purchase_orders po
    SET payment_status = e.payment_status,
        status = CASE
          WHEN po.status = 'recibida' THEN 'recibida'
          WHEN e.payment_status = 'total' AND COALESCE(po.delivery_status,'pendiente') = 'total' THEN 'recibida'
          WHEN e.payment_status = 'total' AND po.status IN ('aprobada_compras','enviada_proveedor','pagada') THEN 'pagada'
          WHEN e.payment_status <> 'total' AND po.status = 'pagada' AND COALESCE(po.delivery_status,'pendiente') = 'total' THEN 'recibida'
          WHEN e.payment_status <> 'total' AND po.status = 'pagada' THEN 'enviada_proveedor'
          ELSE po.status
        END
    FROM estados e
    WHERE po.id = e.po_id;
  `).catch(err => {
    _paymentEnginePromise = null;
    console.error('[pagos init IVA]', err.message);
    throw err;
  });
  return _paymentEnginePromise;
}

// Ejecuta la reparación una vez por deploy. También se espera en endpoints críticos.
ensurePaymentEngine().catch(() => {});

async function recalcPagoFacturaYOC(client, invoiceId) {
  const inv = await client.query(`
    SELECT
      id,
      po_id,
      ROUND(invoice_monto * (1 + COALESCE(iva_pct,0) / 100.0), 2) AS invoice_total
    FROM purchase_order_invoices
    WHERE id=$1::uuid
    FOR UPDATE
  `, [invoiceId]);
  if (!inv.rows[0]) return null;

  const poId = inv.rows[0].po_id;
  const totalFactura = parseFloat(inv.rows[0].invoice_total) || 0;

  const pag = await client.query(`
    SELECT COALESCE(SUM(monto),0) AS total_pagado
    FROM purchase_order_payments
    WHERE invoice_id=$1::uuid
  `, [invoiceId]);
  const totalPagado = parseFloat(pag.rows[0]?.total_pagado || 0);

  await client.query(`
    UPDATE purchase_order_invoices
    SET monto_pagado=$2::numeric,
        pagada=($2::numeric >= $3::numeric * 0.999)
    WHERE id=$1::uuid
  `, [invoiceId, totalPagado, totalFactura]);

  const tot = await client.query(`
    SELECT
      COALESCE(SUM(ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2)),0) AS total_facturas,
      COALESCE(SUM(LEAST(COALESCE(pay.total_pagado,0), ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2))),0) AS total_pagado
    FROM purchase_order_invoices f
    LEFT JOIN (
      SELECT invoice_id, SUM(monto) AS total_pagado
      FROM purchase_order_payments
      GROUP BY invoice_id
    ) pay ON pay.invoice_id = f.id
    WHERE f.po_id=$1::uuid
  `, [poId]);

  const totalFacturas = parseFloat(tot.rows[0]?.total_facturas || 0);
  const totalPagadoOC = parseFloat(tot.rows[0]?.total_pagado || 0);
  const paymentStatus = totalPagadoOC <= 0 ? 'pendiente' : (totalFacturas > 0 && totalPagadoOC >= totalFacturas * 0.999 ? 'total' : 'parcial');

  await client.query(`
    UPDATE purchase_orders
    SET payment_status=$2::varchar,
        status = CASE
          WHEN status = 'recibida' THEN 'recibida'
          WHEN $2::varchar = 'total' AND COALESCE(delivery_status,'pendiente') = 'total' THEN 'recibida'
          WHEN $2::varchar = 'total' AND status IN ('aprobada_compras','enviada_proveedor','pagada') THEN 'pagada'
          WHEN $2::varchar <> 'total' AND status = 'pagada' AND COALESCE(delivery_status,'pendiente') = 'total' THEN 'recibida'
          WHEN $2::varchar <> 'total' AND status = 'pagada' THEN 'enviada_proveedor'
          ELSE status
        END,
        pagado_at = CASE WHEN $2::varchar='total' THEN COALESCE(pagado_at, NOW()) ELSE NULL END,
        pagado_por = CASE WHEN $2::varchar='total' THEN COALESCE(pagado_por, (
          SELECT paid_by
          FROM purchase_order_payments
          WHERE invoice_id IN (SELECT id FROM purchase_order_invoices WHERE po_id=$1::uuid)
          ORDER BY paid_at DESC
          LIMIT 1
        )) ELSE NULL END
    WHERE id=$1::uuid
  `, [poId, paymentStatus]);

  return { po_id: poId, invoice_total: totalFactura, total_pagado: totalPagado, payment_status: paymentStatus };
}

// ─────────────────────────────────────────────────────────────
//  GET /pendientes — facturas pendientes + historial pagado
// ─────────────────────────────────────────────────────────────
router.get('/pendientes', authenticate, requireRole(...ROLES_PAGAR), async (req, res) => {
  try {
    await ensurePaymentEngine();
    const filtro = String(req.query.filtro || '').toLowerCase();
    const incluirPagadas = ['todas','todos','all','pagadas','historial'].includes(filtro);

    const r = await query(`
      WITH pagos AS (
        SELECT invoice_id, COALESCE(SUM(monto),0) AS total_pagado
        FROM purchase_order_payments
        GROUP BY invoice_id
      )
      SELECT
        f.id, f.po_id, f.invoice_nro, f.invoice_fecha, f.invoice_monto,
        f.invoice_monto AS invoice_neto,
        f.iva_pct,
        ${INVOICE_TOTAL_SQL} AS invoice_total,
        ${INVOICE_TOTAL_SQL} AS total_a_pagar,
        f.forma_pago, f.cc_dias, f.vencimiento,
        COALESCE(p.total_pagado,0) AS monto_pagado,
        COALESCE(p.total_pagado,0) AS total_pagado,
        (COALESCE(p.total_pagado,0) >= ${INVOICE_TOTAL_SQL} * 0.999) AS pagada,
        f.uploaded_at, f.notes,
        po.code AS po_code, po.proveedor, po.supplier_id,
        po.forma_pago AS oc_forma_pago, po.cc_dias AS oc_cc_dias,
        s.name AS supplier_name, s.cuit AS supplier_cuit,
        s.forma_pago AS supplier_forma_pago, s.cc_dias AS supplier_cc_dias,
        s.bank_cbu AS supplier_cbu, s.bank_alias AS supplier_alias, s.bank_name AS supplier_bank,
        GREATEST(${INVOICE_TOTAL_SQL} - COALESCE(p.total_pagado,0), 0) AS saldo,
        CASE
          WHEN COALESCE(p.total_pagado,0) >= ${INVOICE_TOTAL_SQL} * 0.999 THEN 'pagada'
          WHEN COALESCE(p.total_pagado,0) > 0 THEN 'parcial'
          ELSE 'pendiente'
        END AS estado_pago_calculado,
        CASE WHEN f.vencimiento < CURRENT_DATE AND COALESCE(p.total_pagado,0) < ${INVOICE_TOTAL_SQL} * 0.999 THEN TRUE ELSE FALSE END AS vencida,
        CASE WHEN f.vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' AND COALESCE(p.total_pagado,0) < ${INVOICE_TOTAL_SQL} * 0.999 THEN TRUE ELSE FALSE END AS por_vencer,
        CASE WHEN f.vencimiento IS NOT NULL THEN (f.vencimiento - CURRENT_DATE) ELSE NULL END AS dias_vencimiento
      FROM purchase_order_invoices f
      JOIN purchase_orders po ON po.id = f.po_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN pagos p ON p.invoice_id = f.id
      WHERE ($1::boolean = TRUE OR COALESCE(p.total_pagado,0) < ${INVOICE_TOTAL_SQL} * 0.999)
      ORDER BY
        CASE WHEN COALESCE(p.total_pagado,0) >= ${INVOICE_TOTAL_SQL} * 0.999 THEN 1 ELSE 0 END,
        f.vencimiento ASC NULLS LAST,
        f.invoice_fecha ASC,
        f.uploaded_at DESC
    `, [incluirPagadas]);
    res.json(r.rows);
  } catch (err) {
    console.error('[pagos pendientes]', err.stack || err.message);
    res.status(500).json({ error: 'Error al listar tesorería' });
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
      WHERE p.invoice_id = $1::uuid
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
    await ensurePaymentEngine();
    const b = req.body;

    if (!METODOS.includes(b.metodo)) {
      return res.status(400).json({ error: 'Método de pago inválido' });
    }
    if (!(parseFloat(b.monto) > 0)) {
      return res.status(400).json({ error: 'Monto inválido' });
    }

    await client.query('BEGIN');

    const f = await client.query(
      `SELECT
         f.id, f.invoice_monto, f.invoice_monto AS invoice_neto, f.iva_pct,
         ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) AS invoice_total,
         COALESCE((SELECT SUM(p.monto) FROM purchase_order_payments p WHERE p.invoice_id=f.id),0) AS monto_pagado,
         po.proveedor, po.status AS po_status,
         s.name AS supplier_name, s.bank_name AS supplier_bank, s.bank_cbu AS supplier_cbu, s.bank_alias AS supplier_alias
       FROM purchase_order_invoices f
       JOIN purchase_orders po ON po.id = f.po_id
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE f.id=$1::uuid AND f.po_id=$2::uuid
       FOR UPDATE OF f`,
      [req.params.fid, req.params.id]
    );
    if (!f.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    // Gate: no se puede pagar una OC que todavía no fue enviada al proveedor.
    if (['pendiente_cotizacion','en_cotizacion','aprobada_compras'].includes(f.rows[0].po_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No se puede pagar: la OC todavía no fue enviada al proveedor' });
    }

    const totalFactura = parseFloat(f.rows[0].invoice_total) || 0;
    const pagadoActual = parseFloat(f.rows[0].monto_pagado) || 0;
    const saldo = Math.max(0, +(totalFactura - pagadoActual).toFixed(2));
    if (saldo <= 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La factura ya está pagada con IVA incluido' });
    }

    const monto = parseFloat(b.monto);
    // Rechazar montos inválidos (no numéricos, NaN, cero o negativos) antes de
    // cualquier cálculo. Sin esto, un monto NaN saltea el chequeo de saldo de
    // abajo (NaN > saldo === false) y podría guardarse un pago corrupto.
    if (!Number.isFinite(monto) || monto <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El monto del pago debe ser un número mayor a cero' });
    }
    if (monto > saldo + 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `El pago supera el saldo pendiente con IVA ($${saldo.toFixed(2)})` });
    }

    const clean = (v) => (v == null ? '' : String(v).trim());
    const failPago = async (message) => {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: message });
    };
    const bancoOrigen = clean(b.banco_origen) || null;
    const bancoDestino = clean(b.banco_destino) || clean(f.rows[0].supplier_bank) || clean(f.rows[0].supplier_name) || clean(f.rows[0].proveedor) || null;
    const cbuAliasDestino = clean(b.cbu_alias_destino) || clean(f.rows[0].supplier_alias) || clean(f.rows[0].supplier_cbu) || null;

    if (b.metodo === 'transferencia') {
      if (!bancoOrigen) return failPago('Falta banco origen');
      if (!bancoDestino && !cbuAliasDestino) return failPago('Faltan datos bancarios del proveedor. Cargá banco/CBU/Alias en Proveedores o completalos manualmente.');
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
      VALUES (
        $1::uuid,$2::uuid,$3::numeric,$4::varchar,$5::varchar,$6::text,$7::text,
        $8::varchar,$9::varchar,$10::varchar,
        $11::varchar,$12::varchar,$13::date,$14::varchar,
        $15::varchar,$16::varchar,$17::date,$18::varchar,
        $19::varchar,$20::integer
      )
      RETURNING *
    `, [
      req.params.fid, req.user.id, monto, b.metodo,
      clean(b.comprobante_nro) || null,
      clean(b.file_url) || null,
      clean(b.notes) || null,
      bancoOrigen, bancoDestino, cbuAliasDestino,
      clean(b.cheque_nro) || null, clean(b.cheque_banco) || null, b.cheque_fecha_cobro || null, clean(b.cheque_a_nombre) || null,
      clean(b.echeq_nro) || null, clean(b.echeq_banco) || null, b.echeq_fecha_pago || null, clean(b.echeq_clave) || null,
      clean(b.tarjeta_aprobacion) || null, b.tarjeta_cuotas ? parseInt(b.tarjeta_cuotas) : null,
    ]);

    await recalcPagoFacturaYOC(client, req.params.fid);
    await client.query('COMMIT');

    const fact = await query(`
      SELECT
        f.pagada,
        COALESCE((SELECT SUM(p.monto) FROM purchase_order_payments p WHERE p.invoice_id=f.id),0) AS monto_pagado,
        f.invoice_monto,
        f.invoice_monto AS invoice_neto,
        f.iva_pct,
        ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) AS invoice_total,
        ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) AS total_a_pagar
      FROM purchase_order_invoices f
      WHERE f.id=$1::uuid
    `, [req.params.fid]);
    const factData = fact.rows[0];
    const total = parseFloat(factData.invoice_total) || 0;
    const pagado = parseFloat(factData.monto_pagado) || 0;
    const saldoRestante = Math.max(0, +(total - pagado).toFixed(2));

    res.status(201).json({
      ...ins.rows[0],
      factura_pagada: saldoRestante <= 0.01,
      monto_pagado_total: pagado,
      total_factura_con_iva: total,
      saldo_restante: saldoRestante,
      message: saldoRestante <= 0.01 ? 'Pago registrado. Factura cancelada totalmente con IVA incluido.' : 'Pago parcial registrado.',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[pagos POST]', err.stack || err.message);
    res.status(500).json({ error: 'Error al registrar el pago' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/facturas/:fid/pagos-multiple — pago combinado
//  Registra varios instrumentos juntos (p.ej. 2 cheques + efectivo).
//  Cada instrumento queda como un pago individual; se validan en conjunto
//  contra el saldo y se insertan en una sola transacción (todo o nada).
// ─────────────────────────────────────────────────────────────
router.post('/:id/facturas/:fid/pagos-multiple', authenticate, requireRole(...ROLES_PAGAR), async (req, res) => {
  const client = await pool.connect();
  try {
    await ensurePaymentEngine();
    const clean = (v) => (v == null ? '' : String(v).trim());
    const instrumentos = Array.isArray(req.body.instrumentos) ? req.body.instrumentos : [];
    if (!instrumentos.length) return res.status(400).json({ error: 'Agregá al menos un instrumento de pago' });

    // Validación previa de cada instrumento (antes de tocar la base)
    for (let i = 0; i < instrumentos.length; i++) {
      const it = instrumentos[i]; const n = i + 1;
      if (!METODOS.includes(it.metodo)) return res.status(400).json({ error: `Instrumento ${n}: método inválido` });
      const m = parseFloat(it.monto);
      if (!Number.isFinite(m) || m <= 0) return res.status(400).json({ error: `Instrumento ${n}: el monto debe ser un número mayor a cero` });
      if (it.metodo === 'cheque') {
        if (!clean(it.cheque_nro))         return res.status(400).json({ error: `Instrumento ${n} (cheque): falta N° de cheque` });
        if (!clean(it.cheque_banco))       return res.status(400).json({ error: `Instrumento ${n} (cheque): falta banco emisor` });
        if (!it.cheque_fecha_cobro)        return res.status(400).json({ error: `Instrumento ${n} (cheque): falta fecha de pago` });
      }
      if (it.metodo === 'echeq') {
        if (!clean(it.echeq_nro))    return res.status(400).json({ error: `Instrumento ${n} (eCheq): falta N° de eCheq` });
        if (!clean(it.echeq_banco))  return res.status(400).json({ error: `Instrumento ${n} (eCheq): falta banco emisor` });
        if (!it.echeq_fecha_pago)    return res.status(400).json({ error: `Instrumento ${n} (eCheq): falta fecha de pago` });
      }
      if (it.metodo === 'transferencia' && !clean(it.banco_origen)) {
        return res.status(400).json({ error: `Instrumento ${n} (transferencia): falta banco origen` });
      }
      if (it.metodo === 'tarjeta' && !clean(it.tarjeta_aprobacion)) {
        return res.status(400).json({ error: `Instrumento ${n} (tarjeta): falta N° de aprobación` });
      }
    }

    const totalInstrumentos = +(instrumentos.reduce((s, it) => s + parseFloat(it.monto), 0)).toFixed(2);

    await client.query('BEGIN');

    const f = await client.query(
      `SELECT
         f.id, f.invoice_monto, f.iva_pct,
         ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) AS invoice_total,
         COALESCE((SELECT SUM(p.monto) FROM purchase_order_payments p WHERE p.invoice_id=f.id),0) AS monto_pagado,
         po.proveedor, po.status AS po_status,
         s.name AS supplier_name, s.bank_name AS supplier_bank, s.bank_cbu AS supplier_cbu, s.bank_alias AS supplier_alias
       FROM purchase_order_invoices f
       JOIN purchase_orders po ON po.id = f.po_id
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE f.id=$1::uuid AND f.po_id=$2::uuid
       FOR UPDATE OF f`,
      [req.params.fid, req.params.id]
    );
    if (!f.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Factura no encontrada' }); }
    if (['pendiente_cotizacion','en_cotizacion','aprobada_compras'].includes(f.rows[0].po_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No se puede pagar: la OC todavía no fue enviada al proveedor' });
    }

    const totalFactura = parseFloat(f.rows[0].invoice_total) || 0;
    const pagadoActual = parseFloat(f.rows[0].monto_pagado) || 0;
    const saldo = Math.max(0, +(totalFactura - pagadoActual).toFixed(2));
    if (saldo <= 0.01) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'La factura ya está pagada con IVA incluido' }); }
    if (totalInstrumentos > saldo + 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `El total de los instrumentos ($${totalInstrumentos.toFixed(2)}) supera el saldo pendiente ($${saldo.toFixed(2)})` });
    }

    const notesComun = clean(req.body.notes) || null;
    const fileComun  = clean(req.body.file_url) || null;

    for (const it of instrumentos) {
      const monto = parseFloat(it.monto);
      const bancoOrigen   = clean(it.banco_origen) || null;
      const bancoDestino  = clean(it.banco_destino) || clean(f.rows[0].supplier_bank) || clean(f.rows[0].supplier_name) || clean(f.rows[0].proveedor) || null;
      const cbuAliasDest  = clean(it.cbu_alias_destino) || clean(f.rows[0].supplier_alias) || clean(f.rows[0].supplier_cbu) || null;
      await client.query(`
        INSERT INTO purchase_order_payments
          (invoice_id, paid_by, monto, metodo, comprobante_nro, file_url, notes,
           banco_origen, banco_destino, cbu_alias_destino,
           cheque_nro, cheque_banco, cheque_fecha_cobro, cheque_a_nombre,
           echeq_nro, echeq_banco, echeq_fecha_pago, echeq_clave,
           tarjeta_aprobacion, tarjeta_cuotas)
        VALUES (
          $1::uuid,$2::uuid,$3::numeric,$4::varchar,$5::varchar,$6::text,$7::text,
          $8::varchar,$9::varchar,$10::varchar,
          $11::varchar,$12::varchar,$13::date,$14::varchar,
          $15::varchar,$16::varchar,$17::date,$18::varchar,
          $19::varchar,$20::integer
        )`, [
        req.params.fid, req.user.id, monto, it.metodo,
        clean(it.comprobante_nro) || null, fileComun, notesComun,
        bancoOrigen, bancoDestino, cbuAliasDest,
        clean(it.cheque_nro) || null, clean(it.cheque_banco) || null, it.cheque_fecha_cobro || null, clean(it.cheque_a_nombre) || null,
        clean(it.echeq_nro) || null, clean(it.echeq_banco) || null, it.echeq_fecha_pago || null, clean(it.echeq_clave) || null,
        clean(it.tarjeta_aprobacion) || null, it.tarjeta_cuotas ? parseInt(it.tarjeta_cuotas) : null,
      ]);
    }

    await recalcPagoFacturaYOC(client, req.params.fid);
    await client.query('COMMIT');

    const pagado = +(pagadoActual + totalInstrumentos).toFixed(2);
    const saldoRestante = Math.max(0, +(totalFactura - pagado).toFixed(2));
    res.status(201).json({
      factura_pagada: saldoRestante <= 0.01,
      instrumentos_registrados: instrumentos.length,
      monto_pagado_total: pagado,
      total_factura_con_iva: totalFactura,
      saldo_restante: saldoRestante,
      message: saldoRestante <= 0.01
        ? `Pago combinado registrado (${instrumentos.length} instrumentos). Factura cancelada totalmente.`
        : `Pago combinado parcial registrado (${instrumentos.length} instrumentos).`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[pagos-multiple POST]', err.stack || err.message);
    res.status(500).json({ error: 'Error al registrar el pago combinado' });
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
    await ensurePaymentEngine();
    await client.query('BEGIN');
    const p = await client.query(
      'SELECT id, paid_by FROM purchase_order_payments WHERE id=$1::uuid AND invoice_id=$2::uuid FOR UPDATE',
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

    await client.query('DELETE FROM purchase_order_payments WHERE id=$1::uuid', [req.params.pid]);
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
