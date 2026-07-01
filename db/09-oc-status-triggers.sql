-- ════════════════════════════════════════════════════════════════════
--  09-oc-status-triggers.sql — Función única de transición de estado OC (P1, Opción B)
--
--  PROBLEMA (auditoría P1): el estado de purchase_orders.status se calculaba
--  con DOS expresiones CASE casi simétricas pero NO idénticas — una en el
--  trigger de pago (recalc_invoice_payment) y otra en el de entrega
--  (recalc_delivery_status) — además duplicadas en schema.sql, 02-pagos.sql,
--  03-status-auto.sql y routes/payments.js. Cualquier divergencia entre esas
--  copias produce estados inconsistentes según qué eje (pago/entrega) disparó
--  el recálculo. Eso ya había dejado al menos una OC en estado fantasma
--  (OC-0007: marcada 'recibida' con recepción 0 y pago total).
--
--  SOLUCIÓN: una sola función de transición — po_resolve_status(estado_actual,
--  pago, entrega, abierta) — que ambos triggers (y el recálculo masivo)
--  delegan. Hay una única fuente de verdad para la máquina de estados.
--
--  Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Este archivo corre
--  DESPUÉS de schema/02/03 en migrate.js, así que sobrescribe las copias viejas.
-- ════════════════════════════════════════════════════════════════════


-- ── Función única de transición ──────────────────────────────────────
-- Dada la foto de los dos ejes (pago + entrega) y si la OC está abierta,
-- devuelve el estado canónico. Reemplaza las dos CASE duplicadas.
--
-- Reglas (en orden de prioridad):
--   1. Estados terminales/fuera de máquina (rechazada, cerrada, dividida): no se tocan.
--   2. Pago total + entrega total + OC no-abierta            → cerrada
--   3. Entrega total (sin cerrar)                            → recibida
--   4. Pago total (sin entrega total), desde etapa ≥ aprobada → pagada
--   5. Venía de pagada/recibida y ya no aplica               → enviada_proveedor
--   6. En cualquier otro caso, se conserva el estado actual.
CREATE OR REPLACE FUNCTION po_resolve_status(
  p_current  VARCHAR,
  p_payment  VARCHAR,
  p_delivery VARCHAR,
  p_is_open  BOOLEAN
) RETURNS VARCHAR AS $$
DECLARE
  v_payment  VARCHAR := COALESCE(p_payment,  'pendiente');
  v_delivery VARCHAR := COALESCE(p_delivery, 'pendiente');
  v_is_open  BOOLEAN := COALESCE(p_is_open,  FALSE);
BEGIN
  IF p_current IN ('rechazada','cerrada','dividida') THEN
    RETURN p_current;
  END IF;

  IF v_payment = 'total' AND v_delivery = 'total' AND v_is_open = FALSE THEN
    RETURN 'cerrada';
  END IF;

  IF v_delivery = 'total' THEN
    RETURN 'recibida';
  END IF;

  IF v_payment = 'total' AND p_current IN ('aprobada_compras','enviada_proveedor','pagada','recibida') THEN
    RETURN 'pagada';
  END IF;

  IF p_current IN ('pagada','recibida') THEN
    RETURN 'enviada_proveedor';
  END IF;

  RETURN p_current;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ── Trigger de pago: delega en po_resolve_status ─────────────────────
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
  v_is_open BOOLEAN;
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
      pagada = (v_total_pagado >= v_invoice_total - 1)
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
    WHEN v_total_facturas > 0 AND v_total_facturas_pagadas >= v_total_facturas - 1 THEN 'total'
    ELSE 'parcial'
  END;

  SELECT status, delivery_status, COALESCE(is_open, FALSE)
    INTO v_po_status, v_delivery_status, v_is_open
  FROM purchase_orders WHERE id = v_po_id;

  UPDATE purchase_orders
  SET payment_status = v_payment_status,
      status = po_resolve_status(v_po_status, v_payment_status, v_delivery_status, v_is_open),
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


-- ── Trigger de entrega: delega en po_resolve_status ──────────────────
CREATE OR REPLACE FUNCTION recalc_delivery_status() RETURNS TRIGGER AS $$
DECLARE
  v_po_id UUID;
  v_receipt_id UUID;
  v_po_status VARCHAR;
  v_payment_status VARCHAR;
  v_total_pedido NUMERIC;
  v_total_recibido NUMERIC;
  v_delivery_status VARCHAR;
  v_is_open BOOLEAN;
BEGIN
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

  SELECT status, payment_status, COALESCE(is_open, FALSE)
    INTO v_po_status, v_payment_status, v_is_open
  FROM purchase_orders WHERE id = v_po_id;

  -- OC abierta: nunca marca entrega 'total' automáticamente (se cierra a mano).
  IF v_is_open AND v_delivery_status = 'total' THEN
    v_delivery_status := 'parcial';
  END IF;

  UPDATE purchase_orders
  SET delivery_status = v_delivery_status,
      status = po_resolve_status(v_po_status, v_payment_status, v_delivery_status, v_is_open),
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


-- ── Reparación puntual: re-resolver todas las OC con la función única ─
-- Corrige estados fantasma heredados de las CASE divergentes (p. ej. OC-0007:
-- 'recibida' con recepción 0 y pago total → 'pagada'). Solo toca las filas que
-- difieren, así que es seguro y de bajo impacto.
UPDATE purchase_orders po
SET status = po_resolve_status(po.status, po.payment_status, po.delivery_status, COALESCE(po.is_open, FALSE))
WHERE status IS DISTINCT FROM
      po_resolve_status(po.status, po.payment_status, po.delivery_status, COALESCE(po.is_open, FALSE));


SELECT 'Máquina de estados OC unificada en po_resolve_status' AS info;
