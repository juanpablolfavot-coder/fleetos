-- ══════════════════════════════════════════════════════════════════════
-- FleetOS — Estados automáticos OC / Facturas / Pagos / Recepción
--
-- Reglas:
-- 1) La recepción de mercadería NO depende del pago.
-- 2) El pago se calcula sobre el total de factura con IVA.
-- 3) Una OC puede estar: recibida + pago pendiente.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

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
        WHEN v_po_status = 'recibida' THEN 'recibida'
        WHEN v_payment_status = 'total' AND COALESCE(v_delivery_status,'pendiente') = 'total' THEN 'recibida'
        WHEN v_payment_status = 'total' AND v_po_status IN ('aprobada_compras','pagada') THEN 'pagada'
        WHEN v_payment_status <> 'total' AND v_po_status = 'pagada' AND COALESCE(v_delivery_status,'pendiente') = 'total' THEN 'recibida'
        WHEN v_payment_status <> 'total' AND v_po_status = 'pagada' THEN 'aprobada_compras'
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
      WHEN po.status = 'recibida' THEN 'recibida'
      WHEN e.payment_status = 'total' AND COALESCE(po.delivery_status,'pendiente') = 'total' THEN 'recibida'
      WHEN e.payment_status = 'total' AND po.status IN ('aprobada_compras','pagada') THEN 'pagada'
      WHEN e.payment_status <> 'total' AND po.status = 'pagada' AND COALESCE(po.delivery_status,'pendiente') = 'total' THEN 'recibida'
      WHEN e.payment_status <> 'total' AND po.status = 'pagada' THEN 'aprobada_compras'
      ELSE po.status
    END
FROM estados e
WHERE po.id = e.po_id;

CREATE OR REPLACE FUNCTION recalc_delivery_status() RETURNS TRIGGER AS $$
DECLARE
  v_po_id UUID;
  v_receipt_id UUID;
  v_po_status VARCHAR;
  v_payment_status VARCHAR;
  v_total_pedido NUMERIC;
  v_total_recibido NUMERIC;
  v_delivery_status VARCHAR;
BEGIN
  -- NEW no existe en DELETE y OLD no existe en INSERT. Separar por operación
  -- evita errores raros de trigger en recepciones parciales/anuladas.
  IF TG_OP = 'DELETE' THEN
    v_receipt_id := OLD.receipt_id;
  ELSE
    v_receipt_id := NEW.receipt_id;
  END IF;

  SELECT po_id INTO v_po_id
  FROM purchase_order_receipts
  WHERE id = v_receipt_id;

  IF v_po_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COALESCE(SUM(poi.cantidad), 0),
    COALESCE(SUM(rec.recibida), 0)
  INTO v_total_pedido, v_total_recibido
  FROM purchase_order_items poi
  LEFT JOIN (
    SELECT po_item_id, SUM(cantidad) AS recibida
    FROM purchase_order_receipt_items
    GROUP BY po_item_id
  ) rec ON rec.po_item_id = poi.id
  WHERE poi.po_id = v_po_id;

  v_delivery_status := CASE
    WHEN v_total_recibido <= 0 THEN 'pendiente'
    WHEN v_total_pedido > 0 AND v_total_recibido >= v_total_pedido * 0.999 THEN 'total'
    ELSE 'parcial'
  END;

  SELECT status, payment_status INTO v_po_status, v_payment_status
  FROM purchase_orders WHERE id = v_po_id;

  UPDATE purchase_orders
  SET delivery_status = v_delivery_status,
      status = CASE
        WHEN v_delivery_status = 'total' AND v_po_status <> 'rechazada' THEN 'recibida'
        WHEN v_delivery_status <> 'total' AND v_po_status = 'recibida' AND COALESCE(v_payment_status,'pendiente') = 'total' THEN 'pagada'
        WHEN v_delivery_status <> 'total' AND v_po_status = 'recibida' THEN 'aprobada_compras'
        ELSE status
      END,
      recibido_at = CASE WHEN v_delivery_status = 'total' THEN COALESCE(recibido_at, NOW()) ELSE recibido_at END,
      recibido_en = CASE WHEN v_delivery_status = 'total' THEN COALESCE(recibido_en, NOW()) ELSE recibido_en END
  WHERE id = v_po_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalc_delivery ON purchase_order_receipt_items;
DROP TRIGGER IF EXISTS trg_recalc_delivery_status_ins ON purchase_order_receipt_items;
CREATE TRIGGER trg_recalc_delivery_status_ins
AFTER INSERT OR UPDATE OR DELETE ON purchase_order_receipt_items
FOR EACH ROW EXECUTE FUNCTION recalc_delivery_status();

-- Reparar OCs viejas que tienen recepción total pero no cabecera recibida.
WITH ult_recepcion AS (
  SELECT DISTINCT ON (po_id) po_id, received_by, received_at
  FROM purchase_order_receipts
  ORDER BY po_id, received_at DESC
)
UPDATE purchase_orders po
SET status = 'recibida',
    delivery_status = 'total',
    recibido_por = COALESCE(po.recibido_por, ult_recepcion.received_by),
    recibido_at = COALESCE(po.recibido_at, ult_recepcion.received_at),
    recibido_en = COALESCE(po.recibido_en, ult_recepcion.received_at)
FROM ult_recepcion
WHERE po.id = ult_recepcion.po_id
  AND COALESCE(po.status, '') NOT IN ('recibida','rechazada')
  AND COALESCE(po.delivery_status, '') = 'total';

-- Reparar facturas viejas: pago total se evalúa con IVA incluido.
UPDATE purchase_order_invoices f
SET pagada = (COALESCE(f.monto_pagado,0) >= ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0) / 100.0), 2) * 0.999)
WHERE TRUE;

COMMIT;

SELECT 'Estados OC/facturas actualizados con IVA y recepción independiente del pago' AS info;
