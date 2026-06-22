-- ══════════════════════════════════════════════════════════════════════
-- FleetOS — Esquema de base de datos PostgreSQL  (Expreso Biletta SRL)
-- ──────────────────────────────────────────────────────────────────────
-- Este archivo es la fuente de verdad del esquema completo de la base.
-- Cualquier tabla o columna que el sistema use en producción debe estar
-- declarada acá. Las rutas (routes/*.js) mantienen sus CREATE TABLE /
-- ALTER TABLE IF NOT EXISTS como red de seguridad y compatibilidad con
-- bases existentes, pero este archivo es la referencia canónica.
--
-- Cómo usarlo:
--   node db/migrate.js           # aplica este archivo contra la base
--   psql $DATABASE_URL < schema  # alternativa directa con psql
--
-- Todas las sentencias usan IF NOT EXISTS y ADD COLUMN IF NOT EXISTS,
-- por lo que correr este archivo sobre una base ya viva es idempotente.
-- ══════════════════════════════════════════════════════════════════════

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ══════════════════════════════════════════════════════════════════════
-- 1.  USUARIOS Y AUTENTICACIÓN
-- ══════════════════════════════════════════════════════════════════════

-- users: cuentas del sistema. El CHECK de role se rehace dinámicamente en
-- routes/auth.js para poder agregar roles nuevos sin migración, por eso
-- acá dejamos el constraint con la lista completa actual.
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(200) NOT NULL,
    email           VARCHAR(200) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'mecanico',
    vehicle_code    VARCHAR(20),                 -- para choferes asignados a un interno
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    login_attempts  INT NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS supplier_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sucursal VARCHAR(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS area VARCHAR(100);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('dueno','gerencia','jefe_mantenimiento','mecanico','chofer',
                    'encargado_combustible','paniol','contador','auditor',
                    'compras','tesoreria','proveedores','gerente_sucursal'));

-- Índices para acelerar la autenticación y filtros por rol/sucursal.
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_sucursal_area ON users(sucursal, area);

-- refresh_tokens: tokens de sesión larga (refresh JWT)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- ══════════════════════════════════════════════════════════════════════
-- 2.  FLOTA
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vehicles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(20) UNIQUE,          -- interno (INT-01, etc.)
    plate           VARCHAR(20) UNIQUE NOT NULL,
    brand           VARCHAR(100),
    model           VARCHAR(100),
    year            INT,
    type            VARCHAR(50),
    status          VARCHAR(30) NOT NULL DEFAULT 'activo',
    driver_name     TEXT,                        -- chofer asignado (texto libre)
    km_current      INT DEFAULT 0,
    tech_spec       JSONB DEFAULT '{}'::jsonb,   -- ficha técnica extendida
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS code        VARCHAR(20);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS driver_name TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS km_current  INT DEFAULT 0;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tech_spec   JSONB DEFAULT '{}'::jsonb;

-- Columnas usadas por la app (alta/edición de vehículos, chofer asignado, sucursal/base,
-- filtros y reportes). Deben existir o se rompe flota en una base recién creada.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS base        VARCHAR(200);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS driver_id   UUID REFERENCES users(id);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vin         VARCHAR(100);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS engine_no   VARCHAR(100);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cost_center VARCHAR(100);

-- Datos de GPS (los completa el servicio Powerfleet en runtime; se declaran acá
-- para que existan desde una base recién migrada y el panel auditor no falle).
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS gps_lat        NUMERIC(10,7);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS gps_lng        NUMERIC(10,7);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS gps_speed      NUMERIC(6,1) DEFAULT 0;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS gps_status     VARCHAR(20)  DEFAULT 'unknown';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS gps_hour_meter NUMERIC(10,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS gps_updated_at TIMESTAMPTZ;

-- Normalización de tipos de vehículos para bases ya existentes.
-- Corrige el constraint viejo que no aceptaba autoelevador, semirremolque ni acoplado.
DO $$
BEGIN
  UPDATE vehicles
     SET type = CASE
       WHEN type IS NULL OR BTRIM(type) = '' THEN 'camion'
       WHEN REPLACE(LOWER(BTRIM(type)), 'ó', 'o') = 'camion' THEN 'camion'
       WHEN LOWER(BTRIM(type)) = 'tractor' THEN 'tractor'
       WHEN LOWER(BTRIM(type)) IN ('semi','semirremolque','semi remolque','semi-remolque','semi_remolque') THEN 'semirremolque'
       WHEN LOWER(BTRIM(type)) = 'acoplado' THEN 'acoplado'
       WHEN LOWER(BTRIM(type)) = 'utilitario' THEN 'utilitario'
       WHEN LOWER(BTRIM(type)) IN ('autoelevador','auto elevador','auto-elevador','auto_elevador') THEN 'autoelevador'
       WHEN REPLACE(LOWER(BTRIM(type)), 'ó', 'o') = 'furgon' THEN 'furgon'
       WHEN LOWER(BTRIM(type)) = 'moto' THEN 'moto'
       WHEN LOWER(BTRIM(type)) = 'otro' THEN 'otro'
       ELSE 'otro'
     END;

  ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_type_check;
  ALTER TABLE vehicles ADD CONSTRAINT vehicles_type_check
    CHECK (type IN ('camion','tractor','semirremolque','acoplado','utilitario','autoelevador','furgon','moto','otro'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'No se pudo normalizar vehicles_type_check: %', SQLERRM;
END $$;



-- vehicle_specs: ficha técnica extendida de cada unidad/equipo.
-- Complementa vehicles.tech_spec para datos estructurados por pantalla.
CREATE TABLE IF NOT EXISTS vehicle_specs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id          UUID UNIQUE REFERENCES vehicles(id) ON DELETE CASCADE,
    capacidad_carga     TEXT,
    tipo_combustible    TEXT,
    capacidad_tanque    NUMERIC(12,2),
    tipo_motor          TEXT,
    transmision         TEXT,
    ejes                TEXT,
    neumaticos          TEXT,
    observaciones       TEXT,
    extra               JSONB DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_specs_vehicle_id ON vehicle_specs(vehicle_id);

-- ══════════════════════════════════════════════════════════════════════
-- 3.  COMBUSTIBLE (cisternas propias)
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tanks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type            VARCHAR(20) NOT NULL CHECK (type IN ('fuel','urea')),
    capacity_l      NUMERIC(10,2) NOT NULL DEFAULT 0,
    current_l       NUMERIC(10,2) NOT NULL DEFAULT 0,
    price_per_l     NUMERIC(12,2),
    location        VARCHAR(200),
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tanks ADD COLUMN IF NOT EXISTS price_per_l NUMERIC(12,2);
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- fuel_logs: cada carga de combustible o urea
CREATE TABLE IF NOT EXISTS fuel_logs (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id              UUID REFERENCES vehicles(id),
    driver_id               UUID REFERENCES users(id),
    tank_id                 UUID REFERENCES tanks(id),
    fuel_type               VARCHAR(20),                 -- 'fuel' | 'urea'
    liters                  NUMERIC(10,2),
    price_per_l             NUMERIC(12,2),
    odometer_km             INTEGER,
    location                TEXT,
    notes                   TEXT,
    ticket_image            TEXT,                        -- data:image/… o URL
    ticket_estado           VARCHAR(20),                 -- NULL|'pendiente'|'verificado'|'observado'|'rechazado'
    ticket_obs              TEXT,
    ticket_verificado_por   UUID REFERENCES users(id),
    ticket_verificado_at    TIMESTAMPTZ,
    logged_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_image          TEXT;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_estado         VARCHAR(20);
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_obs            TEXT;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_por UUID;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_at  TIMESTAMPTZ;
ALTER TABLE fuel_logs ALTER COLUMN ticket_estado DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_fuel_logs_vehicle ON fuel_logs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fuel_logs_date    ON fuel_logs(logged_at DESC);

-- fuel_tank_entries: tickets básicos por cada ingreso a cisterna
CREATE TABLE IF NOT EXISTS fuel_tank_entries (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tank_id     UUID REFERENCES tanks(id),
    type        VARCHAR(20) NOT NULL,
    liters      NUMERIC(12,2) NOT NULL,
    price_per_l NUMERIC(12,2),
    supplier    TEXT,
    remito      TEXT,
    notes       TEXT,
    previous_l  NUMERIC(12,2),
    new_l       NUMERIC(12,2),
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_tank_entries_created ON fuel_tank_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_tank_entries_tank    ON fuel_tank_entries(tank_id);

-- fuel_internal_dispatches: remitos internos de cisterna a sucursales, bidones o tanques chicos
-- No son consumo de vehículo: solo descuentan stock de cisterna y dejan ticket/remito imprimible.
CREATE TABLE IF NOT EXISTS fuel_internal_dispatches (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tank_id             UUID REFERENCES tanks(id),
    type                VARCHAR(20) NOT NULL DEFAULT 'gasoil',
    liters              NUMERIC(12,2) NOT NULL,
    destination         TEXT NOT NULL,
    destination_detail  TEXT,
    responsible         TEXT,
    transport_vehicle   TEXT,
    remito              TEXT,
    notes               TEXT,
    previous_l          NUMERIC(12,2),
    new_l               NUMERIC(12,2),
    status              VARCHAR(20) NOT NULL DEFAULT 'despachado',
    received_by         TEXT,
    received_liters     NUMERIC(12,2),
    receive_notes       TEXT,
    received_at         TIMESTAMPTZ,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_dispatches_created ON fuel_internal_dispatches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_dispatches_tank    ON fuel_internal_dispatches(tank_id);
CREATE INDEX IF NOT EXISTS idx_fuel_dispatches_status  ON fuel_internal_dispatches(status);

-- ══════════════════════════════════════════════════════════════════════
-- 4.  STOCK (pañol / depósito)
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stock_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(50) NOT NULL,
    name            VARCHAR(200) NOT NULL,
    category        VARCHAR(100) NOT NULL DEFAULT 'General',
    unit            VARCHAR(20) NOT NULL DEFAULT 'un',
    qty_current     NUMERIC(10,2) NOT NULL DEFAULT 0,
    qty_min         NUMERIC(10,2) NOT NULL DEFAULT 1,
    qty_reorder     NUMERIC(10,2) NOT NULL DEFAULT 2,
    unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
    supplier        VARCHAR(200),
    base_location   VARCHAR(200) NOT NULL DEFAULT 'Central',
    area            VARCHAR(100) NOT NULL DEFAULT 'Depósito',
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stock_id            UUID NOT NULL REFERENCES stock_items(id),
    type                VARCHAR(20) NOT NULL CHECK (type IN ('Ingreso','Egreso','Ajuste','Baja')),
    qty                 NUMERIC(10,2) NOT NULL,
    reason              TEXT,
    wo_id               UUID,                            -- OT asociada, si es egreso a OT
    base_location       VARCHAR(200),
    area                VARCHAR(100),
    user_id             UUID NOT NULL REFERENCES users(id),
    requires_approval   BOOLEAN DEFAULT FALSE,
    approved_by         UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS wo_id UUID;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS base_location VARCHAR(200);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS area VARCHAR(100);


ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS category VARCHAR(100) NOT NULL DEFAULT 'General';
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS unit VARCHAR(20) NOT NULL DEFAULT 'un';
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS qty_current NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS qty_min NUMERIC(10,2) NOT NULL DEFAULT 1;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS qty_reorder NUMERIC(10,2) NOT NULL DEFAULT 2;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS supplier VARCHAR(200);
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS base_location VARCHAR(200) NOT NULL DEFAULT 'Central';
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS area VARCHAR(100) NOT NULL DEFAULT 'Depósito';
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_code_key;
DROP INDEX IF EXISTS idx_stock_code;
CREATE INDEX IF NOT EXISTS idx_stock_code ON stock_items(code);
CREATE INDEX IF NOT EXISTS idx_stock_base_area ON stock_items(base_location, area);
CREATE UNIQUE INDEX IF NOT EXISTS stock_items_code_base_area_uidx
    ON stock_items (UPPER(code), base_location, area)
    WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_stock_mov_stock ON stock_movements(stock_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_wo    ON stock_movements(wo_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_base_area ON stock_movements(base_location, area);
CREATE INDEX IF NOT EXISTS idx_stock_mov_date  ON stock_movements(created_at DESC);

-- ══════════════════════════════════════════════════════════════════════
-- 5.  CUBIERTAS
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tires (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    serial_no           VARCHAR(100) UNIQUE NOT NULL,
    brand               VARCHAR(100),
    model               VARCHAR(100),
    size                VARCHAR(50),
    purchase_price      NUMERIC(12,2),
    purchase_date       DATE,
    tread_depth         NUMERIC(5,2),                -- mm
    km_total            INT DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'stock', -- 'stock'|'montada'|'recapado'|'baja'
    current_vehicle_id  UUID REFERENCES vehicles(id),
    current_position    VARCHAR(20),                 -- '1-TDE', '2-TIE', etc.
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tire_movements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tire_id         UUID NOT NULL REFERENCES tires(id) ON DELETE CASCADE,
    type            VARCHAR(30) NOT NULL,            -- 'Montaje'|'Rotación'|'Desmonte'|'Recapado'|'Baja'
    from_pos        VARCHAR(20),
    to_pos          VARCHAR(20),
    vehicle_id      UUID REFERENCES vehicles(id),
    km_at_move      INT,
    tread_at_move   NUMERIC(5,2),
    user_id         UUID REFERENCES users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tire_mov_tire ON tire_movements(tire_id);

-- ══════════════════════════════════════════════════════════════════════
-- 6.  DOCUMENTACIÓN (VTV, seguros, licencias, etc.)
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS documents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type     VARCHAR(20) NOT NULL,            -- 'vehicle'|'user'|'asset'
    entity_id       UUID NOT NULL,
    doc_type        VARCHAR(100) NOT NULL,           -- 'VTV','Seguro','Licencia', etc.
    reference       VARCHAR(200),                    -- Nº de póliza, etc.
    issue_date      DATE,
    expiry_date     DATE,
    notes           TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_expiry ON documents(expiry_date);

-- ══════════════════════════════════════════════════════════════════════
-- 7.  ÓRDENES DE TRABAJO (OT)
-- ══════════════════════════════════════════════════════════════════════

-- Contador autoincremental de código de OT (OT-00001, OT-00002, etc.)
CREATE TABLE IF NOT EXISTS ot_sequence (
    dummy       INT PRIMARY KEY DEFAULT 1,
    last_val    INT NOT NULL DEFAULT 0,
    CHECK (dummy = 1)
);
INSERT INTO ot_sequence (dummy, last_val) VALUES (1, 0) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS work_orders (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(20),                     -- OT-00001
    vehicle_id      UUID REFERENCES vehicles(id),
    asset_id        UUID,                            -- OT sobre un activo (no vehículo)
    ot_tipo         VARCHAR(20) DEFAULT 'vehiculo',  -- 'vehiculo'|'asset'
    type            VARCHAR(30),                     -- 'Correctivo'|'Preventivo'|'Predictivo'
    status          VARCHAR(30),                     -- 'Pendiente'|'En proceso'|'Cerrada'|...
    priority        VARCHAR(20),                     -- 'Normal'|'Urgente'|'Crítica'
    title           VARCHAR(300),
    description     TEXT,
    mechanic_id     UUID REFERENCES users(id),
    reporter_id     UUID REFERENCES users(id),
    created_by      UUID REFERENCES users(id),
    assigned_to     UUID REFERENCES users(id),
    km_at_open      INTEGER,
    labor_cost      NUMERIC(12,2) DEFAULT 0,
    parts_cost      NUMERIC(12,2) DEFAULT 0,
    external_required BOOLEAN NOT NULL DEFAULT FALSE, -- si requiere servicio/repuesto externo, genera OC para Compras
    external_po_id  UUID,                            -- OC vinculada generada desde OT
    root_cause      TEXT,
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS ot_tipo  VARCHAR(20) DEFAULT 'vehiculo';
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS asset_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS external_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS external_po_id UUID;

CREATE INDEX IF NOT EXISTS idx_wo_vehicle ON work_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_wo_status  ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_opened  ON work_orders(opened_at DESC);

-- Repuestos consumidos en cada OT
CREATE TABLE IF NOT EXISTS work_order_parts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wo_id       UUID NOT NULL,                       -- no REFERENCES para tolerar OTs borradas
    stock_id    UUID,
    name        TEXT,
    origin      VARCHAR(20),                         -- 'stock'|'externo'
    qty         NUMERIC(10,2),
    unit        VARCHAR(20),
    unit_cost   NUMERIC(12,2) DEFAULT 0,
    subtotal    NUMERIC(14,2) GENERATED ALWAYS AS (qty * unit_cost) STORED,
    po_id       UUID,                                -- OC generada para externo, si corresponde
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS po_id UUID;
CREATE INDEX IF NOT EXISTS idx_wop_wo ON work_order_parts(wo_id);
CREATE INDEX IF NOT EXISTS idx_wop_po ON work_order_parts(po_id);
CREATE INDEX IF NOT EXISTS idx_wop_po_origin ON work_order_parts(po_id, origin);
CREATE INDEX IF NOT EXISTS idx_wop_po_origin ON work_order_parts(po_id, origin);
CREATE INDEX IF NOT EXISTS idx_wo_external_po ON work_orders(external_po_id);

-- Mano de obra cargada en cada OT
CREATE TABLE IF NOT EXISTS work_order_labor (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wo_id       UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id),
    worker_name VARCHAR(200) NOT NULL,
    hours       NUMERIC(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
    rate        NUMERIC(10,2) NOT NULL DEFAULT 0,
    subtotal    NUMERIC(12,2) GENERATED ALWAYS AS (hours * rate) STORED,
    work_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    notes       TEXT,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wol_wo   ON work_order_labor(wo_id);
CREATE INDEX IF NOT EXISTS idx_wol_user ON work_order_labor(user_id);
CREATE INDEX IF NOT EXISTS idx_wol_date ON work_order_labor(work_date);

-- ══════════════════════════════════════════════════════════════════════
-- 8.  CHECKLISTS DIARIOS (chofer antes de salir)
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS checklists (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id      UUID REFERENCES vehicles(id),
    driver_id       UUID REFERENCES users(id),
    driver_name     VARCHAR(100),
    vehicle_code    VARCHAR(20),
    km_at_check     INTEGER,
    items           JSONB DEFAULT '[]'::jsonb,       -- [{item, ok, obs}, ...]
    observations    TEXT,
    all_ok          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checklists_vehicle ON checklists(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_checklists_date    ON checklists(created_at DESC);

-- ══════════════════════════════════════════════════════════════════════
-- 9.  PROVEEDORES Y ACTIVOS
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS suppliers (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(200) NOT NULL,
    razon_social        VARCHAR(200),
    cuit                VARCHAR(20),
    iva_condition       VARCHAR(30),                 -- 'responsable_inscripto'|'monotributo'|'exento'|'consumidor_final'
    contact_person      VARCHAR(200),
    phone               VARCHAR(50),
    email               VARCHAR(200),
    website             VARCHAR(200),
    address             TEXT,
    city                VARCHAR(100),
    province            VARCHAR(100),
    postal_code         VARCHAR(20),
    rubros              TEXT[],                      -- ['repuestos','cubiertas','aceites',...]
    forma_pago          VARCHAR(30),                 -- 'contado'|'cuenta_corriente'|'cheque'|'transferencia'
    cc_dias             INT,
    moneda              VARCHAR(5) DEFAULT 'ARS',
    discount_pct        NUMERIC(5,2) DEFAULT 0,
    delivery_time_days  INT,
    rating              NUMERIC(2,1),                -- 0.0 - 5.0
    total_compras       NUMERIC(14,2) DEFAULT 0,
    bank_name           VARCHAR(100),
    bank_cbu            VARCHAR(30),
    bank_alias          VARCHAR(100),
    notes               TEXT,
    status              VARCHAR(20) DEFAULT 'activo'
                        CHECK (status IN ('activo','suspendido','blacklist')),
    blacklist_reason    TEXT,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_suppliers_cuit   ON suppliers(cuit)   WHERE active = TRUE AND cuit IS NOT NULL;


-- Compatibilidad con bases existentes: si la tabla suppliers ya existía,
-- estas columnas se agregan sin borrar datos y evitan errores 500 al editar proveedores.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS razon_social VARCHAR(200);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cuit VARCHAR(20);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS iva_condition VARCHAR(30);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_person VARCHAR(200);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email VARCHAR(200);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website VARCHAR(200);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS province VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rubros TEXT[];
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(30);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cc_dias INT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS moneda VARCHAR(5) DEFAULT 'ARS';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2) DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS delivery_time_days INT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rating NUMERIC(2,1);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS total_compras NUMERIC(14,2) DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_cbu VARCHAR(30);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_alias VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'activo';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS blacklist_reason TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- assets: activos patrimoniales no-vehículos (herramientas, edilicios, informática, etc.)
CREATE TABLE IF NOT EXISTS assets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code                VARCHAR(50) UNIQUE NOT NULL,
    name                VARCHAR(200) NOT NULL,
    type                VARCHAR(30) NOT NULL DEFAULT 'otro'
                        CHECK (type IN ('edilicio','herramienta','equipo','informatica','instalacion','otro')),
    category            VARCHAR(100),
    location            VARCHAR(200),
    brand               VARCHAR(100),
    model               VARCHAR(100),
    serial_no           VARCHAR(100),
    purchase_date       DATE,
    purchase_price      NUMERIC(12,2),
    warranty_until      DATE,
    status              VARCHAR(20) DEFAULT 'operativo'
                        CHECK (status IN ('operativo','en_reparacion','fuera_servicio','baja')),
    notes               TEXT,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_type   ON assets(type)   WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status) WHERE active = TRUE;

-- ══════════════════════════════════════════════════════════════════════
-- 10. ÓRDENES DE COMPRA (OC) — workflow de 6 estados
-- ══════════════════════════════════════════════════════════════════════
--
-- Estados:
--   pendiente_cotizacion → en_cotizacion → aprobada_compras → pagada → recibida
--                                                                   → rechazada (cualquier etapa)
--
-- Roles que crean OCs: dueno, gerencia, jefe_mantenimiento, compras, paniol, contador
-- Compras: cotiza y aprueba
-- Tesorería: paga
-- Jefe mant / paniol / contador: reciben las que crearon ellos

CREATE TABLE IF NOT EXISTS purchase_orders (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code                        VARCHAR(20) UNIQUE NOT NULL,
    status                      VARCHAR(30) DEFAULT 'pendiente_cotizacion',
    requested_by                UUID REFERENCES users(id),

    -- Categorización
    sucursal                    VARCHAR(200),
    area                        VARCHAR(200),
    tipo                        VARCHAR(30) DEFAULT 'flota',     -- 'flota'|'edilicio'|'otro'
    vehicle_id                  UUID REFERENCES vehicles(id),
    ot_id                       UUID REFERENCES work_orders(id),
    asset_id                    UUID,
    supplier_id                 UUID,

    -- Datos de la compra
    proveedor                   VARCHAR(200),
    forma_pago                  VARCHAR(30),                     -- 'contado'|'cuenta_corriente'
    cc_dias                     INTEGER,
    moneda                      VARCHAR(10),                     -- 'ARS'|'USD'
    iva_pct                     NUMERIC(5,2) DEFAULT 0,
    total_estimado              NUMERIC(14,2) DEFAULT 0,

    -- Presupuesto inicial (imagen del presupuesto del proveedor)
    presupuesto_imagen          TEXT,
    presupuesto_monto_estimado  NUMERIC(14,2),

    -- Factura (cargada en la etapa de compras)
    factura_nro                 VARCHAR(100),
    factura_fecha               DATE,
    factura_monto               NUMERIC(14,2),

    -- Trazabilidad del workflow (quién y cuándo hizo cada transición)
    cotizado_por                UUID REFERENCES users(id),
    cotizado_at                 TIMESTAMPTZ,
    aprobado_compras_por        UUID REFERENCES users(id),
    aprobado_compras_at         TIMESTAMPTZ,
    pagado_por                  UUID REFERENCES users(id),
    pagado_at                   TIMESTAMPTZ,
    recibido_por                UUID REFERENCES users(id),
    recibido_at                 TIMESTAMPTZ,
    recibido_en                 TIMESTAMPTZ,
    delivery_status             VARCHAR(20) DEFAULT 'pendiente',
    invoice_status              VARCHAR(20) DEFAULT 'pendiente',
    payment_status              VARCHAR(20) DEFAULT 'pendiente',

    -- Rechazo (estado final)
    rechazado_por               UUID REFERENCES users(id),
    rechazado_at                TIMESTAMPTZ,
    motivo_rechazo              TEXT,

    -- Devolución (volver a etapa anterior)
    motivo_devolucion           TEXT,
    devuelto_por                UUID REFERENCES users(id),
    devuelto_at                 TIMESTAMPTZ,

    notes                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_status     ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_requested  ON purchase_orders(requested_by);
CREATE INDEX IF NOT EXISTS idx_po_created_at ON purchase_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_status_created ON purchase_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_ot_id ON purchase_orders(ot_id);
CREATE INDEX IF NOT EXISTS idx_po_sucursal_created ON purchase_orders(sucursal, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_area_created ON purchase_orders(area, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_requested_created ON purchase_orders(requested_by, created_at DESC);

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'pendiente';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(20) DEFAULT 'pendiente';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pendiente';
-- is_open se define formalmente en 01-compras.sql, pero el bloque de reparación de
-- más abajo lo referencia y schema.sql corre primero: lo garantizamos acá.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS is_open BOOLEAN DEFAULT FALSE;

-- Artículos de cada OC
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id               UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    stock_item_id       UUID,
    work_order_part_id UUID,
    descripcion         TEXT NOT NULL,
    cantidad            NUMERIC(10,2) DEFAULT 1,
    unidad              VARCHAR(20) DEFAULT 'un',
    precio_unit         NUMERIC(14,2) DEFAULT 0,
    subtotal            NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * precio_unit) STORED,
    ingresado_stock     BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS work_order_part_id UUID;
CREATE INDEX IF NOT EXISTS idx_poi_po ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_poi_po_fast ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_poi_work_order_part ON purchase_order_items(work_order_part_id);
CREATE INDEX IF NOT EXISTS idx_po_payment_status_created ON purchase_orders(payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_invoice_status_created ON purchase_orders(invoice_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_delivery_status_created ON purchase_orders(delivery_status, created_at DESC);


-- Recepciones de mercadería por OC.
-- Regla: la recepción es independiente del pago. El stock entra cuando se recibe.
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

CREATE TABLE IF NOT EXISTS purchase_order_receipt_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    receipt_id      UUID NOT NULL REFERENCES purchase_order_receipts(id) ON DELETE CASCADE,
    po_item_id      UUID NOT NULL REFERENCES purchase_order_items(id),
    cantidad        NUMERIC(10,2) NOT NULL,
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_pori_receipt ON purchase_order_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_pori_poitem  ON purchase_order_receipt_items(po_item_id);

-- Facturas asociadas a OC. Puede haber más de una factura por OC.
CREATE TABLE IF NOT EXISTS purchase_order_invoices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id           UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    invoice_nro     VARCHAR(100) NOT NULL,
    invoice_fecha   DATE NOT NULL,
    invoice_monto   NUMERIC(14,2) NOT NULL,
    iva_pct         NUMERIC(5,2) DEFAULT 21,
    forma_pago      VARCHAR(30),
    cc_dias         INTEGER,
    vencimiento     DATE,
    file_url        TEXT,
    uploaded_by     UUID REFERENCES users(id),
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pagada          BOOLEAN DEFAULT FALSE,
    monto_pagado    NUMERIC(14,2) DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_poinv_po     ON purchase_order_invoices(po_id);
CREATE INDEX IF NOT EXISTS idx_poinv_vencim ON purchase_order_invoices(vencimiento);
CREATE INDEX IF NOT EXISTS idx_poinv_pagada ON purchase_order_invoices(pagada);

-- Pagos de facturas. Puede haber pagos parciales.
CREATE TABLE IF NOT EXISTS purchase_order_payments (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id            UUID NOT NULL REFERENCES purchase_order_invoices(id) ON DELETE CASCADE,
    paid_by               UUID REFERENCES users(id),
    paid_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    monto                 NUMERIC(14,2) NOT NULL,
    metodo                VARCHAR(30),
    comprobante_nro       VARCHAR(100),
    file_url              TEXT,
    notes                 TEXT,
    banco_origen          VARCHAR(100),
    banco_destino         VARCHAR(100),
    cbu_alias_destino     VARCHAR(100),
    cheque_nro            VARCHAR(50),
    cheque_banco          VARCHAR(100),
    cheque_fecha_cobro    DATE,
    cheque_a_nombre       VARCHAR(200),
    echeq_nro             VARCHAR(50),
    echeq_banco           VARCHAR(100),
    echeq_fecha_pago      DATE,
    echeq_clave           VARCHAR(100),
    tarjeta_aprobacion    VARCHAR(50),
    tarjeta_cuotas        INTEGER,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pop_invoice ON purchase_order_payments(invoice_id);

ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS banco_origen VARCHAR(100);
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS banco_destino VARCHAR(100);
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS cbu_alias_destino VARCHAR(100);
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS cheque_nro VARCHAR(50);
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS cheque_banco VARCHAR(100);
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS cheque_fecha_cobro DATE;
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS cheque_a_nombre VARCHAR(200);
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS echeq_nro VARCHAR(50);
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS echeq_banco VARCHAR(100);
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS echeq_fecha_pago DATE;
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS echeq_clave VARCHAR(100);
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS tarjeta_aprobacion VARCHAR(50);
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS tarjeta_cuotas INTEGER;

-- Reparación de datos: si existe recepción total, la OC debe figurar recibida aunque siga pendiente de pago.
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
  AND COALESCE(po.status, '') NOT IN ('recibida','rechazada','cerrada')
  AND COALESCE(po.is_open, FALSE) = FALSE
  AND COALESCE(po.delivery_status, '') = 'total';

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

-- Trigger: recalcula el estado de pago sin pisar una OC ya recibida.
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
  FROM purchase_orders
  WHERE id = v_po_id;

  UPDATE purchase_orders
  SET payment_status = v_payment_status,
      status = CASE
        WHEN v_po_status IN ('rechazada','cerrada') THEN v_po_status
        WHEN v_payment_status = 'total' AND COALESCE(v_delivery_status,'pendiente') = 'total' THEN 'cerrada'
        WHEN v_po_status = 'recibida' THEN 'recibida'
        WHEN v_payment_status = 'total' AND v_po_status IN ('aprobada_compras','enviada_proveedor','pagada') THEN 'pagada'
        WHEN v_payment_status <> 'total' AND v_po_status = 'pagada' AND COALESCE(v_delivery_status,'pendiente') = 'total' THEN 'recibida'
        WHEN v_payment_status <> 'total' AND v_po_status = 'pagada' THEN 'enviada_proveedor'
        ELSE status
      END,
      pagado_at = CASE WHEN v_payment_status='total' THEN COALESCE(pagado_at, NOW()) ELSE NULL END,
      pagado_por = CASE WHEN v_payment_status='total' THEN COALESCE(pagado_por, (
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


-- Recalcular facturas existentes con pago real + IVA incluido.
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


-- Trigger: recalcula estado de entrega. La entrega no espera pago.
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

  SELECT status, payment_status, COALESCE(is_open, FALSE)
    INTO v_po_status, v_payment_status, v_is_open
  FROM purchase_orders WHERE id = v_po_id;

  -- OC abierta: nunca marca entrega 'total' automáticamente (se cierra a mano).
  IF v_is_open AND v_delivery_status = 'total' THEN
    v_delivery_status := 'parcial';
  END IF;

  UPDATE purchase_orders
  SET delivery_status = v_delivery_status,
      status = CASE
        WHEN v_po_status IN ('rechazada','cerrada') THEN v_po_status
        WHEN v_delivery_status = 'total' AND COALESCE(v_payment_status,'pendiente') = 'total' THEN 'cerrada'
        WHEN v_delivery_status = 'total' THEN 'recibida'
        WHEN v_delivery_status <> 'total' AND v_po_status = 'recibida' AND COALESCE(v_payment_status,'pendiente') = 'total' THEN 'pagada'
        WHEN v_delivery_status <> 'total' AND v_po_status = 'recibida' THEN 'enviada_proveedor'
        ELSE status
      END,
      recibido_at = CASE WHEN v_delivery_status = 'total' THEN COALESCE(recibido_at, NOW()) ELSE recibido_at END,
      recibido_en = CASE WHEN v_delivery_status = 'total' THEN COALESCE(recibido_en, NOW()) ELSE recibido_en END
  WHERE id = v_po_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalc_delivery_status_ins ON purchase_order_receipt_items;
CREATE TRIGGER trg_recalc_delivery_status_ins
AFTER INSERT OR UPDATE OR DELETE ON purchase_order_receipt_items
FOR EACH ROW EXECUTE FUNCTION recalc_delivery_status();

-- ══════════════════════════════════════════════════════════════════════
-- 11. SUCURSALES Y ÁREAS
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sucursales (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre          VARCHAR(200) NOT NULL,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sucursal_areas (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
    area            VARCHAR(200) NOT NULL,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sucursal_areas_sucursal ON sucursal_areas(sucursal_id);

-- ══════════════════════════════════════════════════════════════════════
-- 12. CONFIGURACIÓN GLOBAL DE LA APP
-- ══════════════════════════════════════════════════════════════════════

-- Valores sueltos de configuración (bases, tipos de vehículo, labor_rate, áreas)
-- Ver routes/others.js configRouter para ver las keys usadas.
CREATE TABLE IF NOT EXISTS app_config (
    key     TEXT PRIMARY KEY,
    value   JSONB NOT NULL
);

-- ══════════════════════════════════════════════════════════════════════
-- 13. AUDITORÍA
-- ══════════════════════════════════════════════════════════════════════

-- audit_log: se crea también automáticamente desde middleware/auth.js.
-- Registra cada acción de escritura exitosa en endpoints que usen
-- auditAction(action, tableName) como middleware.
CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID,                                -- sin REFERENCES para no perder el log si se borra el usuario
    user_name   VARCHAR(200),
    action      VARCHAR(100),
    table_name  VARCHAR(100),
    record_id   UUID,
    old_value   JSONB,
    new_value   JSONB,
    ip_address  VARCHAR(50),
    user_agent  VARCHAR(200),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_table   ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- ══════════════════════════════════════════════════════════════════════
-- FIN DEL ESQUEMA
-- ══════════════════════════════════════════════════════════════════════
