-- ══════════════════════════════════════════════════════════
-- FleetOS — Esquema de base de datos PostgreSQL
-- Ejecutar: node db/migrate.js
-- ══════════════════════════════════════════════════════════

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USUARIOS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          VARCHAR(200) NOT NULL,
    email         VARCHAR(200) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          VARCHAR(50) NOT NULL DEFAULT 'mecanico'
                  CHECK (role IN ('dueno','gerencia','jefe_mantenimiento','mecanico','paniol','auditor')),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

-- ── VEHÍCULOS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plate         VARCHAR(20) UNIQUE NOT NULL,
    brand         VARCHAR(100),
    model         VARCHAR(100),
    year          INT,
    type          VARCHAR(50),
    status        VARCHAR(30) NOT NULL DEFAULT 'activo'
                  CHECK (status IN ('activo','en_mantenimiento','fuera_de_servicio')),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

-- ── CISTERNAS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tanks (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type          VARCHAR(20) NOT NULL CHECK (type IN ('fuel','urea')),
    capacity_l    NUMERIC(10,2) NOT NULL DEFAULT 0,
    current_l     NUMERIC(10,2) NOT NULL DEFAULT 0,
    location      VARCHAR(200),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

-- ── STOCK ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_items (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code          VARCHAR(50) UNIQUE NOT NULL,
    name          VARCHAR(200) NOT NULL,
    category      VARCHAR(100) NOT NULL DEFAULT 'General',
    unit          VARCHAR(20) NOT NULL DEFAULT 'un',
    qty_current   NUMERIC(10,2) NOT NULL DEFAULT 0,
    qty_min       NUMERIC(10,2) NOT NULL DEFAULT 1,
    qty_reorder   NUMERIC(10,2) NOT NULL DEFAULT 2,
    unit_cost     NUMERIC(10,2) NOT NULL DEFAULT 0,
    supplier      VARCHAR(200),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

CREATE TABLE IF NOT EXISTS stock_movements (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stock_id          UUID NOT NULL REFERENCES stock_items(id),
    type              VARCHAR(20) NOT NULL CHECK (type IN ('Ingreso','Egreso','Ajuste','Baja')),
    qty               NUMERIC(10,2) NOT NULL,
    reason            TEXT,
    user_id           UUID NOT NULL REFERENCES users(id),
    requires_approval BOOLEAN DEFAULT FALSE,
    approved_by       UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

-- ── ÓRDENES DE TRABAJO ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_orders (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id    UUID NOT NULL REFERENCES vehicles(id),
    assigned_to   UUID REFERENCES users(id),
    created_by    UUID REFERENCES users(id),
    title         VARCHAR(300) NOT NULL,
    description   TEXT,
    status        VARCHAR(30) NOT NULL DEFAULT 'pendiente'
                  CHECK (status IN ('pendiente','en_progreso','completada','cancelada')),
    priority      VARCHAR(20) NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('baja','normal','alta','critica')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ
  );

-- ── AUDIT LOG ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID REFERENCES users(id),
    action        VARCHAR(100) NOT NULL,
    table_name    VARCHAR(100),
    record_id     UUID,
    old_value     JSONB,
    new_value     JSONB,
    ip            VARCHAR(50),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
