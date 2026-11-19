-- Unidad operativa elegida por el chofer para el viaje actual.
-- Se mantiene users.vehicle_code como unidad habitual / respaldo para no romper
-- cuentas existentes. Las nuevas columnas apuntan a los vehículos reales y
-- permiten seleccionar por separado la unidad motriz y el remolcado.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS current_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS current_trailer_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_current_vehicle ON users(current_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_users_current_trailer ON users(current_trailer_id);
