-- ════════════════════════════════════════════════════════════════════
--  001 — Lo que hasta ahora creaban los servicios por su cuenta.
--
--  Estas 4 tablas, 3 columnas y 7 índices no los declaraba NINGÚN archivo
--  de db/. Existían solo porque services/idle.js, speeding.js, push.js,
--  webhook-powerfleet.js y gps-powerfleet.js los crean al vuelo — algunos al
--  arrancar, otros recién la primera vez que la función que los usa corre de
--  verdad (el primer ralentí detectado, el primer exceso, la primera
--  suscripción a notificaciones, el primer aviso del webhook).
--
--  Consecuencia: una base creada desde el repo con `npm run migrate` quedaba
--  INCOMPLETA. Funcionaba de casualidad, porque el server terminaba de armar
--  el esquema mientras trabajaba. `npm run schema:check` sobre una base recién
--  migrada reportaba exactamente estos 14 objetos como faltantes.
--
--  Esta migración los trae al repositorio. Es puramente aditiva y todo va con
--  IF NOT EXISTS: sobre la base de producción —que ya los tiene— no hace nada.
--
--  El DDL es copia fiel del de los servicios, para que aplicarla no cambie
--  ninguna forma. Sacarlo de ahí es el paso siguiente, no este.
-- ════════════════════════════════════════════════════════════════════

-- ── Ralentí (services/idle.js) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS idle_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_code  VARCHAR(30),
    vehicle_plate VARCHAR(30),
    base          VARCHAR(100),
    location      TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at      TIMESTAMPTZ,
    duration_seconds INTEGER
);
-- Parcial: la consulta caliente es "¿esta unidad tiene un ralentí abierto?".
CREATE INDEX IF NOT EXISTS idx_idle_open    ON idle_events(vehicle_code) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_idle_started ON idle_events(started_at DESC);

-- ── Excesos de velocidad (services/speeding.js) ──────────────────────
CREATE TABLE IF NOT EXISTS speeding_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_code  VARCHAR(30),
    vehicle_plate VARCHAR(30),
    base          VARCHAR(100),
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at      TIMESTAMPTZ,
    max_speed     NUMERIC(6,1) NOT NULL DEFAULT 0,
    -- Contra qué límite se midió ESTE exceso: los utilitarios livianos tienen
    -- el suyo (90, y las Berlingo 110), así que no se puede asumir 80.
    limit_kmh     INTEGER NOT NULL DEFAULT 80,
    duration_seconds INTEGER
);
CREATE INDEX IF NOT EXISTS idx_speeding_open    ON speeding_events(vehicle_code) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_speeding_started ON speeding_events(started_at DESC);

-- ── Notificaciones push / VAPID (services/push.js) ───────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT UNIQUE NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Avisos del webhook de Powerfleet (services/webhook-powerfleet.js) ─
CREATE TABLE IF NOT EXISTS gps_webhook_events (
    id           BIGSERIAL PRIMARY KEY,
    recibido_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tipo         INTEGER,
    patente      VARCHAR(30),
    velocidad    NUMERIC(6,1),
    ocurrido_at  TIMESTAMPTZ,
    procesado    BOOLEAN NOT NULL DEFAULT FALSE,
    resultado    TEXT,
    payload      JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_recibido ON gps_webhook_events(recibido_at DESC);

-- ── Datos del GPS sobre la unidad (services/gps-powerfleet.js) ───────
-- gps_address y gps_state vienen en la respuesta de Powerfleet y se venían
-- descartando. gps_vehicle_id es el id interno de la unidad en el proveedor:
-- hace falta para el webhook, porque si el aviso identifica la unidad por id
-- y no por patente, sin esto no hay forma de saber de quién habla.
ALTER TABLE vehicles
    ADD COLUMN IF NOT EXISTS gps_address    TEXT,
    ADD COLUMN IF NOT EXISTS gps_state      VARCHAR(30),
    ADD COLUMN IF NOT EXISTS gps_vehicle_id VARCHAR(60);
CREATE INDEX IF NOT EXISTS idx_vehicles_gps_id ON vehicles(gps_vehicle_id) WHERE gps_vehicle_id IS NOT NULL;

-- ── Saldos de stock por ubicación (routes/stock.js) ──────────────────
-- Único: un saldo por artículo + base + área. Es lo que sostiene el UPSERT
-- de movimientos de stock.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_balances_loc
    ON stock_balances (catalog_id, base_location, area);
