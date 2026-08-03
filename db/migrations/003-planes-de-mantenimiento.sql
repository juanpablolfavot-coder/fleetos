-- ════════════════════════════════════════════════════════════════════
--  003 — Planes de mantenimiento preventivo
--
--  Hasta ahora FleetOS dice qué SE ROMPIÓ. Esto es para que diga qué se VA a
--  romper: "al AH327RZ le faltan 800 km para el cambio de aceite".
--
--  Los contadores ya existen y se actualizan solos:
--    - vehicles.km_current      lo actualizan el sync del GPS y cada carga de
--                               combustible con odómetro
--    - vehicles.gps_hour_meter  el horómetro que manda Powerfleet (para
--                               autoelevadoras y equipos que no miden km)
--
--  ── Por qué maintenance_schedules y no maintenance_plans ──
--  En la base de producción YA existe una tabla llamada maintenance_plans, sin
--  una sola referencia en el repositorio (la detectó npm run schema:check como
--  deriva). No se sabe qué estructura tiene ni si guarda algo.
--
--  Usar ese nombre sería peligroso: un CREATE TABLE IF NOT EXISTS sobre una
--  tabla que ya existe NO agrega las columnas nuevas — no falla, no avisa, y la
--  aplicación revienta después al consultar una columna que no está. Por eso va
--  con nombre propio. Qué hacer con maintenance_plans (mirar si tiene datos y
--  borrarla) es una decisión aparte.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS maintenance_schedules (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id    UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

    nombre        VARCHAR(200) NOT NULL,        -- "Cambio de aceite y filtros"

    -- Contra qué se mide el intervalo. 'km' y 'horas' se comparan contra el
    -- contador de la unidad; 'dias' contra el calendario (útil para cosas que
    -- vencen aunque la unidad no se mueva: matafuegos, refrigerante).
    tipo          VARCHAR(10) NOT NULL CHECK (tipo IN ('km','horas','dias')),
    intervalo     INTEGER NOT NULL CHECK (intervalo > 0),

    -- Cuánto antes avisar. En las mismas unidades que `tipo`: 1000 km, 15 días.
    -- 0 = avisar recién cuando se cumple.
    aviso_antes   INTEGER NOT NULL DEFAULT 0 CHECK (aviso_antes >= 0),

    -- Línea de base: dónde estaba el contador la última vez que se hizo. Sin
    -- esto no hay contra qué medir, y el plan se reporta como "sin base" en vez
    -- de inventar un número.
    ultimo_valor  NUMERIC(12,2),                -- km u horas del último service
    ultima_fecha  DATE,                         -- fecha del último service

    activo        BOOLEAN NOT NULL DEFAULT TRUE,
    notas         TEXT,
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- La consulta caliente es "todos los planes activos, por unidad".
CREATE INDEX IF NOT EXISTS idx_mant_vehiculo ON maintenance_schedules(vehicle_id) WHERE activo;
-- Un mismo plan no se carga dos veces para la misma unidad.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mant_vehiculo_nombre
    ON maintenance_schedules(vehicle_id, lower(nombre));
