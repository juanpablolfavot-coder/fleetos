-- 007: Tiempos de respuesta por área.
--
-- Para medir cuánto tarda cada etapa hacía falta guardar dos momentos que
-- hasta ahora no quedaban en ningún lado:
--   * work_orders.started_at: la primera vez que la OT pasa a "En proceso"
--     (antes solo había opened_at y closed_at, así que no se podía separar
--     "cuánto esperó asignación" de "cuánto tardó el trabajo").
--   * purchase_orders.closed_at: cuándo Compras cerró la OC (el status pasaba
--     a 'cerrada' sin fecha).
ALTER TABLE work_orders     ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS closed_at  TIMESTAMPTZ;
