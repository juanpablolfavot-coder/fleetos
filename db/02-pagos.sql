-- ══════════════════════════════════════════════════════════════════════
-- MIGRACIÓN — Pagos con detalle por método (tesorería)
-- Idempotente
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE purchase_order_payments
  -- Banco origen (de dónde sale el dinero)
  ADD COLUMN IF NOT EXISTS banco_origen     VARCHAR(100),
  -- Datos transferencia
  ADD COLUMN IF NOT EXISTS banco_destino    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cbu_alias_destino VARCHAR(100),
  -- Datos cheque
  ADD COLUMN IF NOT EXISTS cheque_nro       VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cheque_banco     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cheque_fecha_cobro DATE,
  ADD COLUMN IF NOT EXISTS cheque_a_nombre  VARCHAR(200),
  -- Datos eCheq
  ADD COLUMN IF NOT EXISTS echeq_nro        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS echeq_banco      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS echeq_fecha_pago DATE,
  ADD COLUMN IF NOT EXISTS echeq_clave      VARCHAR(100),
  -- Datos tarjeta
  ADD COLUMN IF NOT EXISTS tarjeta_aprobacion VARCHAR(50),
  ADD COLUMN IF NOT EXISTS tarjeta_cuotas   INTEGER;

-- Trigger function: cuando se inserta o borra un pago, recalcular invoice.pagada y payment_status de la OC
CREATE OR REPLACE FUNCTION recalc_invoice_payment() RETURNS TRIGGER AS $$
DECLARE
  v_invoice_id UUID;
  v_po_id UUID;
  v_invoice_monto NUMERIC;
  v_total_pagado NUMERIC;
  v_total_oc NUMERIC;
  v_total_facturas_pagadas NUMERIC;
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

  UPDATE purchase_orders
  SET payment_status = CASE
    WHEN v_total_facturas_pagadas <= 0 THEN 'pendiente'
    WHEN v_total_oc > 0 AND v_total_facturas_pagadas >= v_total_oc * 0.999 THEN 'total'
    ELSE 'parcial'
  END
  WHERE id = v_po_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalc_invoice_payment ON purchase_order_payments;
CREATE TRIGGER trg_recalc_invoice_payment
AFTER INSERT OR UPDATE OR DELETE ON purchase_order_payments
FOR EACH ROW EXECUTE FUNCTION recalc_invoice_payment();

COMMIT;

SELECT 'pagos detallados' AS check,
       COUNT(*) FILTER (WHERE column_name IN ('banco_origen','cheque_nro','echeq_nro','tarjeta_aprobacion')) AS cols_nuevas
FROM information_schema.columns
WHERE table_name = 'purchase_order_payments';
