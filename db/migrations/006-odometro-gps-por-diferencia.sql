-- ════════════════════════════════════════════════════════════════════
--  006 — El GPS mueve km_current por diferencia, no por valor absoluto
--
--  El sync del GPS hacía km_current = GREATEST(km_current, odómetro_gps). Eso
--  supone que el odómetro de Powerfleet es el del tablero, y no lo es: cada
--  equipo tiene su propio origen. En varias unidades quedó muy por encima
--  (AG468LQ marcaba 3.625.518 km con 393.719 en el tablero) y corregirlo a
--  mano duraba hasta el sync siguiente, porque GREATEST lo volvía a subir.
--
--  Desde ahora se guarda la última lectura contada del odómetro del GPS y
--  km_current avanza sólo lo que creció entre una lectura y la siguiente
--  (services/km-por-gps.js). El tablero lo fija una persona o un ticket de
--  combustible; el GPS lo mueve desde ahí.
--
--  Las dos columnas arrancan en NULL: en el primer sync cada unidad se ancla
--  sin tocar su km. services/gps-powerfleet.js también las agrega al arrancar,
--  por si el deploy no corre migraciones (ver docs/migraciones.md).
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE vehicles
    ADD COLUMN IF NOT EXISTS gps_odometer    NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS gps_odometer_at TIMESTAMPTZ;
