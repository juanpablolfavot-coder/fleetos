-- ══════════════════════════════════════════════════════════
--  FleetOS — Esquema de base de datos PostgreSQL
--  Ejecutar: node db/migrate.js
-- ══════════════════════════════════════════════════════════

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USUARIOS Y AUTENTICACIÓN ──────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(50) NOT NULL CHECK (role IN (
    'dueno','gerencia','jefe_mantenimiento','mecanico',
    'chofer','encargado_combustible','paniol','contador','auditor'
  )),
  vehicle_code  VARCHAR(20),
  active        BOOLEAN DEFAULT TRUE,
  login_attempts INTEGER DEFAULT 0,
  locked_until  TIMESTAMP,
  last_login    TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── VEHÍCULOS Y ACTIVOS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          VARCHAR(20) UNIQUE NOT NULL,
  plate         VARCHAR(20) UNIQUE NOT NULL,
  brand         VARCHAR(50) NOT NULL,
  model         VARCHAR(80) NOT NULL,
  year          INTEGER NOT NULL,
  type          VARCHAR(30) NOT NULL CHECK (type IN ('tractor','camion','semirremolque','acoplado','cisterna','auxiliar')),
  status        VARCHAR(30) NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','warn','taller','detenida','inactiva','baja')),
  vin           VARCHAR(50),
  engine_no     VARCHAR(50),
  km_current    INTEGER DEFAULT 0,
  engine_hours  INTEGER DEFAULT 0,
  base          VARCHAR(50),
  cost_center   VARCHAR(50),
  driver_id     UUID REFERENCES users(id),
  cost_per_km   DECIMAL(10,4) DEFAULT 0.18,
  fuel_capacity INTEGER,
  urea_capacity INTEGER,
  notes         TEXT,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- Ficha técnica por vehículo
CREATE TABLE IF NOT EXISTS vehicle_specs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id      UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  engine_desc     VARCHAR(200),
  power_hp        INTEGER,
  transmission    VARCHAR(100),
  differential    VARCHAR(100),
  oil_engine      VARCHAR(100),
  oil_engine_qty  DECIMAL(6,1),
  oil_gearbox     VARCHAR(100),
  oil_gearbox_qty DECIMAL(6,1),
  oil_diff        VARCHAR(100),
  oil_diff_qty    DECIMAL(6,1),
  coolant         VARCHAR(100),
  coolant_qty     DECIMAL(6,1),
  filter_oil      VARCHAR(100),
  filter_fuel_p   VARCHAR(100),
  filter_fuel_s   VARCHAR(100),
  filter_air      VARCHAR(100),
  filter_sep      VARCHAR(100),
  filter_cabin    VARCHAR(100),
  grease_type     VARCHAR(100),
  battery_specs   VARCHAR(100),
  uses_urea       BOOLEAN DEFAULT FALSE,
  tire_size       VARCHAR(30),
  tire_pressure_s VARCHAR(20),
  tire_pressure_d VARCHAR(20),
  wheel_torque    VARCHAR(30),
  service_km      INTEGER DEFAULT 20000,
  service_hours   INTEGER DEFAULT 500,
  service_days    INTEGER DEFAULT 180,
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- ── ÓRDENES DE TRABAJO ────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_orders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          VARCHAR(20) UNIQUE NOT NULL,
  vehicle_id    UUID NOT NULL REFERENCES vehicles(id),
  type          VARCHAR(30) NOT NULL CHECK (type IN ('Correctivo','Preventivo','Predictivo')),
  status        VARCHAR(40) NOT NULL DEFAULT 'Pendiente' CHECK (status IN (
    'Pendiente','En proceso','Esperando repuesto','Esperando tercerizado',
    'Asignada','Resuelta','Cerrada','Rechazada'
  )),
  priority      VARCHAR(20) NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal','Media','Urgente')),
  description   TEXT NOT NULL,
  diagnosis     TEXT,
  root_cause    TEXT,
  mechanic_id   UUID REFERENCES users(id),
  reporter_id   UUID REFERENCES users(id),
  labor_cost    DECIMAL(12,2) DEFAULT 0,
  parts_cost    DECIMAL(12,2) DEFAULT 0,
  km_at_open    INTEGER,
  opened_at     TIMESTAMP DEFAULT NOW(),
  closed_at     TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_order_parts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wo_id       UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  stock_id    UUID REFERENCES stock_items(id),
  name        VARCHAR(200) NOT NULL,
  origin      VARCHAR(20) NOT NULL CHECK (origin IN ('stock','compra')),
  qty         DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit        VARCHAR(20) DEFAULT 'un',
  unit_cost   DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal    DECIMAL(12,2) GENERATED ALWAYS AS (qty * unit_cost) STORED,
  added_at    TIMESTAMP DEFAULT NOW()
);

-- ── STOCK Y PAÑOL ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code         VARCHAR(50) UNIQUE NOT NULL,
  name         VARCHAR(200) NOT NULL,
  category     VARCHAR(50) NOT NULL,
  unit         VARCHAR(20) NOT NULL DEFAULT 'un',
  qty_current  DECIMAL(10,2) DEFAULT 0,
  qty_min      DECIMAL(10,2) DEFAULT 1,
  qty_reorder  DECIMAL(10,2) DEFAULT 2,
  unit_cost    DECIMAL(12,2) DEFAULT 0,
  supplier     VARCHAR(100),
  active       BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_id    UUID NOT NULL REFERENCES stock_items(id),
  type        VARCHAR(30) NOT NULL CHECK (type IN ('Ingreso','Egreso','Baja','Ajuste')),
  qty         DECIMAL(10,2) NOT NULL,
  unit_cost   DECIMAL(12,2),
  reason      TEXT NOT NULL,
  wo_id       UUID REFERENCES work_orders(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  requires_approval BOOLEAN DEFAULT FALSE,
  approved_by UUID REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ── COMBUSTIBLE Y UREA ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tanks (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type         VARCHAR(20) NOT NULL CHECK (type IN ('fuel','urea')),
  capacity_l   INTEGER NOT NULL,
  current_l    DECIMAL(10,2) DEFAULT 0,
  location     VARCHAR(50),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fuel_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id    UUID NOT NULL REFERENCES vehicles(id),
  driver_id     UUID REFERENCES users(id),
  tank_id       UUID REFERENCES tanks(id),
  fuel_type     VARCHAR(20) NOT NULL DEFAULT 'diesel' CHECK (fuel_type IN ('diesel','urea','gnc')),
  liters        DECIMAL(8,2) NOT NULL,
  price_per_l   DECIMAL(10,2) NOT NULL,
  total_cost    DECIMAL(12,2) GENERATED ALWAYS AS (liters * price_per_l) STORED,
  odometer_km   INTEGER,
  engine_hours  INTEGER,
  location      VARCHAR(100),
  receipt_url   VARCHAR(500),
  status        VARCHAR(20) DEFAULT 'pendiente' CHECK (status IN ('pendiente','validado','alerta')),
  notes         TEXT,
  logged_at     TIMESTAMP DEFAULT NOW(),
  validated_by  UUID REFERENCES users(id),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ── CUBIERTAS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tires (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  serial_no    VARCHAR(50) UNIQUE NOT NULL,
  brand        VARCHAR(50),
  model        VARCHAR(80),
  size         VARCHAR(30),
  purchase_price DECIMAL(12,2),
  purchase_date  DATE,
  km_total     INTEGER DEFAULT 0,
  tread_depth  DECIMAL(4,1),
  tread_min    DECIMAL(4,1) DEFAULT 4.0,
  status       VARCHAR(20) DEFAULT 'stock' CHECK (status IN ('montada','stock','recapado','baja')),
  current_vehicle_id UUID REFERENCES vehicles(id),
  current_position   VARCHAR(20),
  notes        TEXT,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tire_movements (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tire_id     UUID NOT NULL REFERENCES tires(id),
  type        VARCHAR(30) NOT NULL,
  from_pos    VARCHAR(30),
  to_pos      VARCHAR(30),
  vehicle_id  UUID REFERENCES vehicles(id),
  km_at_move  INTEGER,
  tread_at_move DECIMAL(4,1),
  user_id     UUID NOT NULL REFERENCES users(id),
  notes       TEXT,
  moved_at    TIMESTAMP DEFAULT NOW()
);

-- ── DOCUMENTOS Y VENCIMIENTOS ─────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('vehicle','driver')),
  entity_id   UUID NOT NULL,
  doc_type    VARCHAR(50) NOT NULL,
  reference   VARCHAR(100),
  issue_date  DATE,
  expiry_date DATE NOT NULL,
  file_url    VARCHAR(500),
  status      VARCHAR(20) GENERATED ALWAYS AS (
    CASE
      WHEN expiry_date < CURRENT_DATE THEN 'vencido'
      WHEN expiry_date < CURRENT_DATE + INTERVAL '30 days' THEN 'por_vencer'
      ELSE 'vigente'
    END
  ) STORED,
  notes       TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- ── MANTENIMIENTO ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_plans (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id      UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  task_name       VARCHAR(200) NOT NULL,
  interval_type   VARCHAR(20) NOT NULL CHECK (interval_type IN ('km','hours','days')),
  interval_value  INTEGER NOT NULL,
  last_done_km    INTEGER,
  last_done_hours INTEGER,
  last_done_date  DATE,
  next_due_km     INTEGER,
  next_due_hours  INTEGER,
  next_due_date   DATE,
  alert_pct       INTEGER DEFAULT 80,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- ── AUDITORÍA ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id),
  user_name   VARCHAR(100),
  action      VARCHAR(50) NOT NULL,
  table_name  VARCHAR(50) NOT NULL,
  record_id   UUID,
  old_value   JSONB,
  new_value   JSONB,
  ip_address  INET,
  user_agent  VARCHAR(500),
  created_at  TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_log_2026 PARTITION OF audit_log
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE audit_log_2027 PARTITION OF audit_log
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

-- ── ÍNDICES PARA PERFORMANCE ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_vehicles_status     ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_code       ON vehicles(code);
CREATE INDEX IF NOT EXISTS idx_wo_vehicle          ON work_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_wo_status           ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_opened           ON work_orders(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_vehicle        ON fuel_logs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fuel_logged         ON fuel_logs(logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_code          ON stock_items(code);
CREATE INDEX IF NOT EXISTS idx_docs_expiry         ON documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_docs_entity         ON documents(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user          ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tires_vehicle       ON tires(current_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email);

-- ── FUNCIÓN DE AUDITORÍA AUTOMÁTICA ──────────────────────
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log(action, table_name, record_id, old_value, new_value)
    VALUES ('UPDATE', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log(action, table_name, record_id, old_value)
    VALUES ('DELETE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Aplicar auditoría a tablas críticas
CREATE TRIGGER audit_vehicles    AFTER UPDATE OR DELETE ON vehicles    FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_work_orders AFTER UPDATE OR DELETE ON work_orders FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_stock       AFTER UPDATE OR DELETE ON stock_items FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_fuel        AFTER UPDATE OR DELETE ON fuel_logs   FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- ── FUNCIÓN updated_at AUTOMÁTICO ─────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vehicles_updated    BEFORE UPDATE ON vehicles    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_work_orders_updated BEFORE UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_stock_updated       BEFORE UPDATE ON stock_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_tires_updated       BEFORE UPDATE ON tires       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated       BEFORE UPDATE ON users       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
