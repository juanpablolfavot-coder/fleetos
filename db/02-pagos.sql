-- ══════════════════════════════════════════════════════════════════════
-- MIGRACIÓN — Pagos Tesorería con IVA incluido + detalle por método
-- Idempotente
-- ══════════════════════════════════════════════════════════════════════


ALTER TABLE purchase_order_payments
  ADD COLUMN IF NOT EXISTS banco_origen VARCHAR(100),
  ADD COLUMN IF NOT EXISTS banco_destino VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cbu_alias_destino VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cheque_nro VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cheque_banco VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cheque_fecha_cobro DATE,
  ADD COLUMN IF NOT EXISTS cheque_a_nombre VARCHAR(200),
  ADD COLUMN IF NOT EXISTS echeq_nro VARCHAR(50),
  ADD COLUMN IF NOT EXISTS echeq_banco VARCHAR(100),
  ADD COLUMN IF NOT EXISTS echeq_fecha_pago DATE,
  ADD COLUMN IF NOT EXISTS echeq_clave VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tarjeta_aprobacion VARCHAR(50),
  ADD COLUMN IF NOT EXISTS tarjeta_cuotas INTEGER;

-- Reparación legacy: facturas que estaban marcadas pagadas por la lógica vieja
-- pero cuyo pago cubría solo el neto. Se ajusta el último pago para cubrir total con IVA.
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
  FROM purchase_orders WHERE id = v_po_id;

  UPDATE purchase_orders
  SET payment_status = v_payment_status,
      status = CASE
        WHEN v_po_status IN ('rechazada','cerrada') THEN v_po_status
        WHEN v_payment_status = 'total' AND COALESCE(v_delivery_status,'pendiente') = 'total' THEN 'cerrada'
        WHEN v_po_status = 'recibida' THEN 'recibida'
        WHEN v_payment_status = 'total' AND v_po_status IN ('aprobada_compras','enviada_proveedor','pagada') THEN 'pagada'
        WHEN v_payment_status <> 'total' AND v_po_status = 'pagada' AND COALESCE(v_delivery_status,'pendiente') = 'total' THEN 'recibida'
        WHEN v_payment_status <> 'total' AND v_po_status = 'pagada' THEN 'enviada_proveedor'
        ELSE v_po_status
      END,
      pagado_at = CASE WHEN v_payment_status = 'total' THEN COALESCE(pagado_at, NOW()) ELSE NULL END,
      pagado_por = CASE WHEN v_payment_status = 'total' THEN COALESCE(pagado_por, (
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

-- Recalcular datos existentes con pago real + IVA incluido.
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
      WHEN po.status IN ('rechazada','cerrada') THEN po.status
      WHEN e.payment_status = 'total' AND COALESCE(po.delivery_status,'pendiente') = 'total' AND COALESCE(po.is_open,FALSE) = FALSE THEN 'cerrada'
      WHEN po.status = 'recibida' THEN 'recibida'
      WHEN e.payment_status = 'total' AND po.status IN ('aprobada_compras','enviada_proveedor','pagada') THEN 'pagada'
      WHEN e.payment_status <> 'total' AND po.status = 'pagada' AND COALESCE(po.delivery_status,'pendiente') = 'total' THEN 'recibida'
      WHEN e.payment_status <> 'total' AND po.status = 'pagada' THEN 'enviada_proveedor'
      ELSE po.status
    END
FROM estados e
WHERE po.id = e.po_id;


SELECT 'pagos tesoreria con IVA incluido' AS check,
       COUNT(*) FILTER (WHERE column_name IN ('banco_origen','cheque_nro','echeq_nro','tarjeta_aprobacion')) AS cols_nuevas
FROM information_schema.columns
WHERE table_name = 'purchase_order_payments';
