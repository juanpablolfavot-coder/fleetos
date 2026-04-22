-- ══════════════════════════════════════════════════════════════════════
-- FleetOS — Esquema de base de datos PostgreSQL  (Expreso Biletta S.A.)
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

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('dueno','gerencia','jefe_mantenimiento','mecanico','chofer',
                    'encargado_combustible','paniol','contador','auditor',
                    'compras','tesoreria'));

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
    ticket_estado           VARCHAR(20) DEFAULT 'pendiente',  -- 'pendiente'|'verificado'|'rechazado'
    ticket_obs              TEXT,
    ticket_verificado_por   UUID REFERENCES users(id),
    ticket_verificado_at    TIMESTAMPTZ,
    logged_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_image          TEXT;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_estado         VARCHAR(20) DEFAULT 'pendiente';
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_obs            TEXT;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_por UUID;
ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_fuel_logs_vehicle ON fuel_logs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fuel_logs_date    ON fuel_logs(logged_at DESC);

-- ══════════════════════════════════════════════════════════════════════
-- 4.  STOCK (pañol / depósito)
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stock_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(50) UNIQUE NOT NULL,
    name            VARCHAR(200) NOT NULL,
    category        VARCHAR(100) NOT NULL DEFAULT 'General',
    unit            VARCHAR(20) NOT NULL DEFAULT 'un',
    qty_current     NUMERIC(10,2) NOT NULL DEFAULT 0,
    qty_min         NUMERIC(10,2) NOT NULL DEFAULT 1,
    qty_reorder     NUMERIC(10,2) NOT NULL DEFAULT 2,
    unit_cost       NUMERIC(10,2) NOT NULL DEFAULT 0,
    supplier        VARCHAR(200),
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
    user_id             UUID NOT NULL REFERENCES users(id),
    requires_approval   BOOLEAN DEFAULT FALSE,
    approved_by         UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS wo_id UUID;

CREATE INDEX IF NOT EXISTS idx_stock_mov_stock ON stock_movements(stock_id);
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
    root_cause      TEXT,
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS ot_tipo  VARCHAR(20) DEFAULT 'vehiculo';
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS asset_id UUID;

CREATE INDEX IF NOT EXISTS idx_wo_vehicle ON work_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_wo_status  ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_opened  ON work_orders(opened_at DESC);

-- Repuestos consumidos en cada OT
CREATE TABLE IF NOT EXISTS work_order_parts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wo_id       UUID NOT NULL,                       -- no REFERENCES para tolerar OTs borradas
    stock_id    UUID,
    name        TEXT,
    origin      VARCHAR(20),                         -- 'stock'|'compra'
    qty         NUMERIC(10,2),
    unit        VARCHAR(20),
    unit_cost   NUMERIC(12,2) DEFAULT 0,
    subtotal    NUMERIC(14,2) GENERATED ALWAYS AS (qty * unit_cost) STORED,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wop_wo ON work_order_parts(wo_id);

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

-- Artículos de cada OC
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id               UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    stock_item_id       UUID,
    descripcion         TEXT NOT NULL,
    cantidad            NUMERIC(10,2) DEFAULT 1,
    unidad              VARCHAR(20) DEFAULT 'un',
    precio_unit         NUMERIC(14,2) DEFAULT 0,
    subtotal            NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * precio_unit) STORED,
    ingresado_stock     BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_poi_po ON purchase_order_items(po_id);

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
