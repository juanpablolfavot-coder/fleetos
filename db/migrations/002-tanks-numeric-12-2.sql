-- ════════════════════════════════════════════════════════════════════
--  002 — tanks.capacity_l / current_l a NUMERIC(12,2)
--
--  db/schema.sql las declara NUMERIC(10,2), pero routes/others.js las venía
--  llevando a NUMERIC(12,2) en cada arranque. O sea que ese ALTER NO era un
--  no-op: era la única forma de que el tipo quedara bien, y una base creada
--  solo con `npm run migrate` quedaba en (10,2).
--
--  Se trae acá para poder sacarlo del arranque. El ALTER va condicionado
--  porque ALTER COLUMN ... TYPE reescribe la tabla entera aunque el tipo
--  destino sea el mismo: sin el IF, cada base ya migrada pagaría una reescritura
--  al pedo.
--
--  Por qué 12 y no 10: con (10,2) el máximo es 99.999.999,99. Alcanza de sobra
--  para litros, pero el ALTER ya estaba en el código desde antes y la base de
--  producción hace rato que está en (12,2). Esta migración deja al repositorio
--  diciendo lo mismo que la base, que es de lo que se trata todo esto.
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tanks'
       AND column_name = 'capacity_l' AND numeric_precision IS DISTINCT FROM 12
  ) THEN
    ALTER TABLE tanks ALTER COLUMN capacity_l TYPE NUMERIC(12,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tanks'
       AND column_name = 'current_l' AND numeric_precision IS DISTINCT FROM 12
  ) THEN
    ALTER TABLE tanks ALTER COLUMN current_l TYPE NUMERIC(12,2);
  END IF;
END $$;
