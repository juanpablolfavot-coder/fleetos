-- ══════════════════════════════════════════════════════════════════════
-- MIGRACIÓN — Auto-actualizar status de OC según facturas pagadas
-- 
-- Cuando todas las facturas de una OC están pagadas (payment_status='total')
-- y la OC está en aprobada_compras, pasarla automáticamente a 'pagada'.
-- 
-- Cuando todas las recepciones están completas (delivery_status='total')
-- y la OC está en 'pagada', pasarla a 'recibida'.
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- Reemplazar la función de recálculo para que también mueva OC.status
CREATE OR REPLACE FUNCTION recalc_invoice_payment() RETURNS TRIGGER AS $$
DECLARE
  v_invoice_id UUID;
  v_po_id UUID;
  v_invoice_monto NUMERIC;
  v_total_pagado NUMERIC;
  v_total_oc NUMERIC;
  v_total_facturas_pagadas NUMERIC;
  v_po_status VARCHAR;
  v_payment_status VARCHAR;
  v_delivery_status VARCHAR;
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT po_id, invoice_monto INTO v_po_id, v_invoice_monto
  FROM purchase_order_invoices WHERE id = v_invoice_id;

  SELECT COALESCE(SUM(monto), 0) INTO v_total_pagado
  FROM purchase_order_payments WHERE invoice_id = v_invoice_id;

  UPDATE purchase_order_invoices
  SET monto_pagado = v_total_pagado,
      pagada       = (v_total_pagado >= v_invoice_monto * 0.999)
  WHERE id = v_invoice_id;

  -- Recalcular payment_status de la OC
  SELECT
    COALESCE(SUM(invoice_monto), 0),
    COALESCE(SUM(LEAST(monto_pagado, invoice_monto)), 0)
  INTO v_total_oc, v_total_facturas_pagadas
  FROM purchase_order_invoices WHERE po_id = v_po_id;

  v_payment_status := CASE
    WHEN v_total_facturas_pagadas <= 0 THEN 'pendiente'
    WHEN v_total_oc > 0 AND v_total_facturas_pagadas >= v_total_oc * 0.999 THEN 'total'
    ELSE 'parcial'
  END;

  -- Auto-mover status de la OC
  SELECT status, delivery_status INTO v_po_status, v_delivery_status
  FROM purchase_orders WHERE id = v_po_id;

  -- Si todas las facturas están pagadas y la OC sigue en aprobada_compras → mover a 'pagada'
  IF v_payment_status = 'total' AND v_po_status = 'aprobada_compras' THEN
    UPDATE purchase_orders
    SET payment_status = v_payment_status,
        status = 'pagada',
        pagado_at = NOW(),
        pagado_por = (SELECT paid_by FROM purchase_order_payments WHERE invoice_id IN
                      (SELECT id FROM purchase_order_invoices WHERE po_id = v_po_id)
                      ORDER BY paid_at DESC LIMIT 1)
    WHERE id = v_po_id;
  -- Si la OC ya está en 'pagada' y delivery está total → mover a 'recibida'
  ELSIF v_payment_status = 'total' AND v_po_status = 'pagada' AND v_delivery_status = 'total' THEN
    UPDATE purchase_orders
    SET payment_status = v_payment_status,
        status = 'recibida',
        recibido_at = NOW()
    WHERE id = v_po_id;
  ELSE
    UPDATE purchase_orders SET payment_status = v_payment_status WHERE id = v_po_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger para el delivery_status también
CREATE OR REPLACE FUNCTION recalc_delivery_status() RETURNS TRIGGER AS $$
DECLARE
  v_po_id UUID;
  v_po_status VARCHAR;
  v_payment_status VARCHAR;
  v_total_pedido NUMERIC;
  v_total_recibido NUMERIC;
  v_delivery_status VARCHAR;
BEGIN
  v_po_id := (SELECT po_id FROM purchase_order_receipts WHERE id = COALESCE(NEW.receipt_id, OLD.receipt_id));
  IF v_po_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT
    COALESCE(SUM(poi.cantidad), 0),
    COALESCE(SUM(pori.cantidad), 0)
  INTO v_total_pedido, v_total_recibido
  FROM purchase_order_items poi
  LEFT JOIN purchase_order_receipt_items pori ON pori.po_item_id = poi.id
  WHERE poi.po_id = v_po_id;

  v_delivery_status := CASE
    WHEN v_total_recibido <= 0 THEN 'pendiente'
    WHEN v_total_pedido > 0 AND v_total_recibido >= v_total_pedido * 0.999 THEN 'total'
    ELSE 'parcial'
  END;

  SELECT status, payment_status INTO v_po_status, v_payment_status
  FROM purchase_orders WHERE id = v_po_id;

  -- Si delivery total + payment total + status pagada → mover a recibida
  IF v_delivery_status = 'total' AND v_payment_status = 'total' AND v_po_status = 'pagada' THEN
    UPDATE purchase_orders
    SET delivery_status = v_delivery_status,
        status = 'recibida',
        recibido_at = NOW()
    WHERE id = v_po_id;
  ELSE
    UPDATE purchase_orders SET delivery_status = v_delivery_status WHERE id = v_po_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalc_delivery ON purchase_order_receipt_items;
CREATE TRIGGER trg_recalc_delivery
AFTER INSERT OR UPDATE OR DELETE ON purchase_order_receipt_items
FOR EACH ROW EXECUTE FUNCTION recalc_delivery_status();

-- Forzar recálculo en OCs que ya tienen facturas pagadas pero status='aprobada_compras'
UPDATE purchase_orders po
SET status = 'pagada',
    payment_status = 'total',
    pagado_at = COALESCE(po.pagado_at, NOW())
WHERE po.status = 'aprobada_compras'
  AND EXISTS (
    SELECT 1 FROM purchase_order_invoices f
    WHERE f.po_id = po.id
    GROUP BY f.po_id
    HAVING SUM(f.invoice_monto) > 0
       AND COALESCE(SUM(LEAST(f.monto_pagado, f.invoice_monto)), 0) >= SUM(f.invoice_monto) * 0.999
  );

COMMIT;

-- Verificación: OCs que cambiaron de estado
SELECT 'OCs ya en pagada/recibida con flujo nuevo' AS info, COUNT(*) AS total
FROM purchase_orders po
WHERE po.payment_status = 'total' AND po.status IN ('pagada','recibida');
