-- ════════════════════════════════════════════════════════════════════
--  06-stock-catalog.sql — Modelo NUEVO de stock (catálogo + saldos + despachos)
--
--  Formaliza en una migración versionada lo que hasta ahora solo se creaba
--  desde las rutas (routes/stock.js, routes/purchase_order_receipts.js). Así
--  una base recién creada o restaurada queda igual que producción, sin depender
--  de qué ruta se cargó primero. Todo es idempotente (IF NOT EXISTS); las rutas
--  siguen teniendo su ensureSchema como red de seguridad.
--
--  Fuente de verdad del stock: stock_catalog (qué artículo) + stock_balances
--  (cuánto hay por sucursal/área) + stock_movements.catalog_id (qué pasó) +
--  stock_dispatches (traslados entre sucursales).
-- ════════════════════════════════════════════════════════════════════

-- Catálogo: definición del artículo (uno por código).
CREATE TABLE IF NOT EXISTS stock_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'General',
  unit VARCHAR(20) NOT NULL DEFAULT 'un',
  qty_min NUMERIC(10,2) NOT NULL DEFAULT 0,
  qty_reorder NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  supplier VARCHAR(200),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Saldos: cuánto hay de cada artículo por sucursal/área (clave única).
CREATE TABLE IF NOT EXISTS stock_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_id UUID NOT NULL REFERENCES stock_catalog(id) ON DELETE CASCADE,
  base_location VARCHAR(200) NOT NULL,
  area VARCHAR(100) NOT NULL,
  qty_current NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (catalog_id, base_location, area)
);

-- Movimientos: que puedan referenciar el catálogo (modelo nuevo). La tabla
-- stock_movements se crea en schema.sql (modelo viejo); acá solo se extiende.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS catalog_id UUID;
ALTER TABLE stock_movements ALTER COLUMN stock_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_mov_catalog ON stock_movements(catalog_id);

-- Despachos Central → sucursal (sale del origen, queda en tránsito, la sucursal
-- confirma la recepción y se suma al destino).
CREATE TABLE IF NOT EXISTS stock_dispatches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_id UUID NOT NULL REFERENCES stock_catalog(id),
  qty_sent NUMERIC(10,2) NOT NULL,
  from_location VARCHAR(200) NOT NULL,
  from_area VARCHAR(100) NOT NULL,
  to_location VARCHAR(200) NOT NULL,
  to_area VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'en_transito',
  notes TEXT,
  dispatched_by UUID REFERENCES users(id),
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  qty_received NUMERIC(10,2),
  receive_notes TEXT,
  received_by UUID REFERENCES users(id),
  received_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_stock_disp_status ON stock_dispatches(status);

-- Vínculos del modelo nuevo con OT y recepción de OC (hasta ahora se agregaban
-- solo desde las rutas). Las tablas base se crean en schema.sql / 01-compras.sql,
-- así que estos ALTER corren después y son seguros e idempotentes.
ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS catalog_id UUID;
ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS base_location VARCHAR(200);
ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS area VARCHAR(100);

ALTER TABLE purchase_order_receipt_items ADD COLUMN IF NOT EXISTS catalog_id UUID;
ALTER TABLE purchase_order_receipt_items ADD COLUMN IF NOT EXISTS stock_base_location VARCHAR(200);
ALTER TABLE purchase_order_receipt_items ADD COLUMN IF NOT EXISTS stock_area VARCHAR(100);
