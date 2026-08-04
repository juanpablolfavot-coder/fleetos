-- ════════════════════════════════════════════════════════════════════
--  005 — Dos correcciones sobre maintenance_schedules
--
--  ── A. Un plan dado de baja bloqueaba su nombre para siempre ──
--
--  El DELETE del módulo es baja LÓGICA (activo = FALSE), para no perder el
--  historial. Pero el índice único de la 003 no miraba `activo`:
--
--      UNIQUE (vehicle_id, lower(nombre))
--
--  Así que después de dar de baja "Cambio de aceite" en una unidad, volver a
--  crearlo devolvía 409 "esa unidad ya tiene un plan con ese nombre" — y el plan
--  culpable no aparecía en ninguna pantalla, porque estaba dado de baja. Sin
--  forma de recuperarlo y sin forma de rehacerlo: el nombre quedaba quemado.
--
--  El índice pasa a ser parcial. Los planes de baja siguen guardados como
--  historial, pero ya no reservan el nombre.
--
--  ── B. Faltaba la restricción que relaciona aviso_antes con intervalo ──
--
--  La 003 ya trae CHECK (intervalo > 0) y CHECK (aviso_antes >= 0). Falta la que
--  los relaciona: avisar con MÁS anticipación que el propio intervalo deja el
--  plan en estado "próximo" para siempre — el aviso nunca se apaga y se vuelve
--  ruido permanente.
--
--  routes/mantenimiento.js ya lo rechaza, pero esa validación vive solo en el
--  camino HTTP: un INSERT desde psql, un import o una migración futura la
--  esquivan. Esto lo cierra en la base, que es donde no se puede esquivar.
-- ════════════════════════════════════════════════════════════════════

-- ── A ──
DROP INDEX IF EXISTS uq_mant_vehiculo_nombre;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mant_vehiculo_nombre
    ON maintenance_schedules(vehicle_id, lower(nombre))
    WHERE activo;

-- ── B ──
-- Primero se acomodan las filas que ya violarían la restricción; si no, el
-- ALTER falla y la migración entera no entra.
--
-- El caso real que existe: la 004 importó con aviso_antes = intervalo / 10, y
-- para un intervalo de 1 eso da GREATEST(1, 0) = 1, o sea aviso_antes =
-- intervalo. Son pocas filas o ninguna, pero una sola aborta el deploy.
UPDATE maintenance_schedules
   SET aviso_antes = GREATEST(0, intervalo - 1)
 WHERE aviso_antes >= intervalo;

ALTER TABLE maintenance_schedules
  DROP CONSTRAINT IF EXISTS chk_mant_aviso_menor_intervalo;
ALTER TABLE maintenance_schedules
  ADD CONSTRAINT chk_mant_aviso_menor_intervalo CHECK (aviso_antes < intervalo);
