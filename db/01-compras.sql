-- ══════════════════════════════════════════════════════════════════════
-- MIGRACIÓN — Workflow compras completo (cotización → recepción → factura → pago)
-- Idempotente: se puede correr N veces sin romper nada
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────
-- 1) SUPPLIERS: condición de pago por defecto
-- ─────────────────────────────────────────────────────────
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS default_forma_pago  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS default_cc_dias     INTEGER;

-- ─────────────────────────────────────────────────────────
-- 2) PURCHASE_ORDERS: nuevos estados de delivery/invoice/payment
-- ─────────────────────────────────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS delivery_status  VARCHAR(20) DEFAULT 'pendiente',  -- pendiente|parcial|total
  ADD COLUMN IF NOT EXISTS invoice_status   VARCHAR(20) DEFAULT 'pendiente',  -- pendiente|parcial|total
  ADD COLUMN IF NOT EXISTS payment_status   VARCHAR(20) DEFAULT 'pendiente',  -- pendiente|parcial|total
  ADD COLUMN IF NOT EXISTS is_open          BOOLEAN     DEFAULT FALSE,        -- OC abierta (servicio o entrega fraccionada)
  ADD COLUMN IF NOT EXISTS destino          VARCHAR(200),                     -- a dónde va la mercadería
  ADD COLUMN IF NOT EXISTS fecha_envio_prov TIMESTAMPTZ,                      -- cuándo se mandó la OC al proveedor
  ADD COLUMN IF NOT EXISTS enviada_por      UUID REFERENCES users(id);

-- ─────────────────────────────────────────────────────────
-- 3) RECEPCIONES PARCIALES
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_receipts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id           UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    received_by     UUID REFERENCES users(id),
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    destino         VARCHAR(200),
    remito_nro      VARCHAR(100),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_por_po ON purchase_order_receipts(po_id);

-- Ítems recibidos en cada recepción (cantidad recibida contra cantidad pedida)
CREATE TABLE IF NOT EXISTS purchase_order_receipt_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    receipt_id      UUID NOT NULL REFERENCES purchase_order_receipts(id) ON DELETE CASCADE,
    po_item_id      UUID NOT NULL REFERENCES purchase_order_items(id),
    cantidad        NUMERIC(10,2) NOT NULL,
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_pori_receipt ON purchase_order_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_pori_poitem  ON purchase_order_receipt_items(po_item_id);

-- ─────────────────────────────────────────────────────────
-- 4) FACTURAS (puede haber varias por OC)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_invoices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id           UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    invoice_nro     VARCHAR(100) NOT NULL,
    invoice_fecha   DATE NOT NULL,
    invoice_monto   NUMERIC(14,2) NOT NULL,
    iva_pct         NUMERIC(5,2) DEFAULT 21,
    forma_pago      VARCHAR(30),                   -- copiado de OC (editable)
    cc_dias         INTEGER,                       -- copiado de OC (editable)
    vencimiento     DATE,                          -- calculado: fecha + cc_dias
    file_url        TEXT,                          -- PDF / imagen de la factura
    uploaded_by     UUID REFERENCES users(id),
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pagada          BOOLEAN DEFAULT FALSE,
    monto_pagado    NUMERIC(14,2) DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_poinv_po         ON purchase_order_invoices(po_id);
CREATE INDEX IF NOT EXISTS idx_poinv_vencim     ON purchase_order_invoices(vencimiento);
CREATE INDEX IF NOT EXISTS idx_poinv_pagada     ON purchase_order_invoices(pagada);

-- ─────────────────────────────────────────────────────────
-- 5) PAGOS (puede haber varios pagos por factura — pagos parciales)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_payments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id      UUID NOT NULL REFERENCES purchase_order_invoices(id) ON DELETE CASCADE,
    paid_by         UUID REFERENCES users(id),
    paid_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    monto           NUMERIC(14,2) NOT NULL,
    metodo          VARCHAR(30),                   -- transferencia|cheque|efectivo|etc
    comprobante_nro VARCHAR(100),
    file_url        TEXT,                          -- comprobante
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pop_invoice ON purchase_order_payments(invoice_id);

COMMIT;

-- ─────────────────────────────────────────────────────────
-- Verificación
-- ─────────────────────────────────────────────────────────
SELECT 'suppliers nuevas cols'   AS check, COUNT(*) FROM information_schema.columns
  WHERE table_name='suppliers' AND column_name IN ('default_forma_pago','default_cc_dias');
SELECT 'purchase_orders nuevas' AS check, COUNT(*) FROM information_schema.columns
  WHERE table_name='purchase_orders' AND column_name IN ('delivery_status','invoice_status','payment_status','is_open','destino','fecha_envio_prov','enviada_por');
SELECT 'tabla receipts'         AS check, COUNT(*) FROM information_schema.tables WHERE table_name='purchase_order_receipts';
SELECT 'tabla receipt_items'    AS check, COUNT(*) FROM information_schema.tables WHERE table_name='purchase_order_receipt_items';
SELECT 'tabla invoices'         AS check, COUNT(*) FROM information_schema.tables WHERE table_name='purchase_order_invoices';
SELECT 'tabla payments'         AS check, COUNT(*) FROM information_schema.tables WHERE table_name='purchase_order_payments';
