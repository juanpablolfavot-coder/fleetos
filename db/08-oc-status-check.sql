-- ════════════════════════════════════════════════════════════════════
--  08-oc-status-check.sql — CHECK constraint en purchase_orders.status (P2)
--
--  La columna era VARCHAR libre sin CHECK: un typo o una migración mal escrita
--  podía dejar un estado fantasma que la base no rechazaba. Acá la blindamos a
--  nivel motor con el set canónico de estados.
--
--  Set canónico (incluye 'dividida', que es válido: estado de la OC madre cuando
--  Compras la divide por proveedor — etapa 3 del circuito multi-proveedor).
--
--  Seguro de aplicar: el diagnóstico previo confirmó 0 filas fuera del set, así
--  que el ALTER no falla sobre datos existentes. Idempotente (DO + pg_constraint).
-- ════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_po_status') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT chk_po_status CHECK (
      status IN (
        'pendiente_cotizacion','en_cotizacion','dividida','aprobada_compras',
        'enviada_proveedor','pagada','recibida','cerrada','rechazada'
      )
    );
  END IF;
END $$;
