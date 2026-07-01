-- ════════════════════════════════════════════════════════════════════
--  10-higiene.sql — Higiene de esquema (auditoría PR 7)
--
--  Tres frentes:
--  1) DRIFT: columnas e índices que hasta ahora existían SOLO porque las rutas
--     los crean al arrancar (ensureXxxSchema). Se formalizan acá para que una
--     base creada con schema + migraciones quede completa sin levantar la app.
--  2) UNIQUE faltantes: duplicados que la base no rechazaba (facturas repetidas
--     en una OC, cisternas duplicadas — el bug histórico de las cisternas en 0 —,
--     sucursales/áreas repetidas). Cada UNIQUE se crea SOLO si no hay duplicados
--     preexistentes; si los hay, avisa con NOTICE y no rompe la migración.
--  3) FKs faltantes: columnas *_id sin clave foránea. Mismo patrón que 07:
--     NOT VALID (no valida filas viejas) + ON DELETE SET NULL (no cambia el
--     comportamiento de ningún borrado existente).
--
--  Idempotente: IF NOT EXISTS / pg_constraint / pg_indexes en todo.
-- ════════════════════════════════════════════════════════════════════


-- ── 1) Drift: columnas creadas hasta ahora solo por el boot de las rutas ──
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS prioridad VARCHAR(20) DEFAULT 'Normal';
ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS destination_tank_id UUID REFERENCES tanks(id);
ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS destination_stock_applied BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS destination_stock_applied_at TIMESTAMPTZ;

-- Índices que solo creaba el boot.
CREATE INDEX IF NOT EXISTS idx_wo_status_opened ON work_orders(status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_wo_asset         ON work_orders(asset_id);
CREATE INDEX IF NOT EXISTS idx_wo_reporter      ON work_orders(reporter_id);
CREATE INDEX IF NOT EXISTS idx_stock_active     ON stock_items(active);


-- ── 2) UNIQUE faltantes (guardados: no rompen si ya hay duplicados) ──
DO $$ BEGIN
  -- Una OC no puede tener dos facturas con el mismo número.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_poi_invoice_nro') THEN
    IF EXISTS (
      SELECT po_id, invoice_nro FROM purchase_order_invoices
      WHERE invoice_nro IS NOT NULL AND TRIM(invoice_nro) <> ''
      GROUP BY po_id, invoice_nro HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'uq_poi_invoice_nro NO creado: hay facturas duplicadas (misma OC + mismo nro). Limpiar y re-correr la migración.';
    ELSE
      CREATE UNIQUE INDEX uq_poi_invoice_nro ON purchase_order_invoices (po_id, invoice_nro)
        WHERE invoice_nro IS NOT NULL AND TRIM(invoice_nro) <> '';
    END IF;
  END IF;

  -- No puede haber dos cisternas ACTIVAS del mismo tipo en la misma ubicación
  -- (la causa raíz del incidente "cisternas en 0": el seed viejo duplicaba).
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_tanks_type_location') THEN
    IF EXISTS (
      SELECT type, COALESCE(location,'') FROM tanks
      WHERE active IS DISTINCT FROM FALSE
      GROUP BY type, COALESCE(location,'') HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'uq_tanks_type_location NO creado: hay cisternas activas duplicadas. Desactivar las sobrantes y re-correr.';
    ELSE
      CREATE UNIQUE INDEX uq_tanks_type_location ON tanks (type, COALESCE(location,''))
        WHERE active IS DISTINCT FROM FALSE;
    END IF;
  END IF;

  -- Sucursales y áreas sin repetidos (case-insensitive), solo entre activas.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_sucursales_nombre') THEN
    IF EXISTS (
      SELECT LOWER(nombre) FROM sucursales WHERE activo
      GROUP BY LOWER(nombre) HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'uq_sucursales_nombre NO creado: hay sucursales activas con nombre repetido.';
    ELSE
      CREATE UNIQUE INDEX uq_sucursales_nombre ON sucursales (LOWER(nombre)) WHERE activo;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_sucursal_areas') THEN
    IF EXISTS (
      SELECT sucursal_id, LOWER(area) FROM sucursal_areas WHERE activo
      GROUP BY sucursal_id, LOWER(area) HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'uq_sucursal_areas NO creado: hay áreas activas repetidas dentro de una sucursal.';
    ELSE
      CREATE UNIQUE INDEX uq_sucursal_areas ON sucursal_areas (sucursal_id, LOWER(area)) WHERE activo;
    END IF;
  END IF;
END $$;


-- ── 3) FKs faltantes (NOT VALID + ON DELETE SET NULL, patrón de 07) ──
DO $$ BEGIN
  -- users.supplier_id: schema.sql la crea SIN REFERENCES y el ALTER del boot es
  -- no-op cuando la columna ya existe, así que esta FK nunca llegaba a crearse.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_supplier') THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_supplier
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_wo_asset') THEN
    ALTER TABLE work_orders ADD CONSTRAINT fk_wo_asset
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_wo_external_po') THEN
    ALTER TABLE work_orders ADD CONSTRAINT fk_wo_external_po
      FOREIGN KEY (external_po_id) REFERENCES purchase_orders(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_po_asset') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT fk_po_asset
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sm_wo') THEN
    ALTER TABLE stock_movements ADD CONSTRAINT fk_sm_wo
      FOREIGN KEY (wo_id) REFERENCES work_orders(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_fl_ticket_verif') THEN
    ALTER TABLE fuel_logs ADD CONSTRAINT fk_fl_ticket_verif
      FOREIGN KEY (ticket_verificado_por) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_poi_stock_item') THEN
    ALTER TABLE purchase_order_items ADD CONSTRAINT fk_poi_stock_item
      FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_poi_wop') THEN
    ALTER TABLE purchase_order_items ADD CONSTRAINT fk_poi_wop
      FOREIGN KEY (work_order_part_id) REFERENCES work_order_parts(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;


SELECT 'Higiene de esquema aplicada (drift formalizado, UNIQUEs y FKs)' AS info;
