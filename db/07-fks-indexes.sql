-- ════════════════════════════════════════════════════════════════════
--  07-fks-indexes.sql — Integridad e índices de las columnas nuevas
--
--  Cierra el hardening del modelo nuevo: formaliza las columnas de OC que aún
--  se agregaban desde rutas, crea índices para los joins/filtros frecuentes y
--  agrega claves foráneas.
--
--  Criterios de seguridad:
--   - FKs en modo NOT VALID: hacen cumplir la integridad a FUTURO sin re-validar
--     las filas viejas, así la migración nunca falla por datos previos.
--   - ON DELETE SET NULL: borrar un proveedor/artículo nunca bloquea ni borra en
--     cascada; solo deja el vínculo en NULL.
--   - DO + chequeo de pg_constraint: idempotente (se puede correr varias veces).
--   - Corre después de 06 (stock_catalog) y de schema/01 (suppliers, OC), así que
--     todas las tablas referenciadas ya existen.
-- ════════════════════════════════════════════════════════════════════

-- Columnas de OC que hasta ahora se agregaban solo desde las rutas.
ALTER TABLE purchase_orders      ADD COLUMN IF NOT EXISTS supplier_id UUID;
ALTER TABLE purchase_orders      ADD COLUMN IF NOT EXISTS split_parent_id UUID;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS supplier_id UUID;

-- Índices.
CREATE INDEX IF NOT EXISTS idx_po_supplier     ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_split_parent ON purchase_orders(split_parent_id);
CREATE INDEX IF NOT EXISTS idx_poi_supplier    ON purchase_order_items(supplier_id);
CREATE INDEX IF NOT EXISTS idx_wop_catalog     ON work_order_parts(catalog_id);
CREATE INDEX IF NOT EXISTS idx_pori_catalog    ON purchase_order_receipt_items(catalog_id);

-- Claves foráneas (idempotentes, NOT VALID, ON DELETE SET NULL).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_po_supplier') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT fk_po_supplier
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_po_split_parent') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT fk_po_split_parent
      FOREIGN KEY (split_parent_id) REFERENCES purchase_orders(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_poi_supplier') THEN
    ALTER TABLE purchase_order_items ADD CONSTRAINT fk_poi_supplier
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_wop_catalog') THEN
    ALTER TABLE work_order_parts ADD CONSTRAINT fk_wop_catalog
      FOREIGN KEY (catalog_id) REFERENCES stock_catalog(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pori_catalog') THEN
    ALTER TABLE purchase_order_receipt_items ADD CONSTRAINT fk_pori_catalog
      FOREIGN KEY (catalog_id) REFERENCES stock_catalog(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sm_catalog') THEN
    ALTER TABLE stock_movements ADD CONSTRAINT fk_sm_catalog
      FOREIGN KEY (catalog_id) REFERENCES stock_catalog(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
