# db/migrations/

Migraciones versionadas. Cada archivo se aplica **una sola vez** y queda
registrado en la tabla `schema_migrations`.

Las corre `db/migrate.js` (o sea `npm run migrate`), después del esquema base.

## Cómo agregar una

1. Creá `NNN-descripcion-corta.sql` con el número siguiente al último.
2. Escribí el DDL. Que sea idempotente igual (`IF NOT EXISTS`) no está de más,
   pero ya no es lo que garantiza que no se aplique dos veces — de eso se
   encarga el registro.
3. `npm run migrate` la aplica y la anota.

```sql
-- 001-ejemplo.sql
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ejemplo TEXT;
CREATE INDEX IF NOT EXISTS idx_vehicles_ejemplo ON vehicles(ejemplo);
```

## Reglas

- **Una migración aplicada en producción no se edita nunca más.** Si te
  equivocaste, escribí una nueva que corrija. El checksum avisa si el archivo
  cambió después de haberse aplicado, pero el aviso llega tarde: en esa base el
  cambio ya no entra.
- Cada archivo corre en **su propia transacción**. Si falla a la mitad, no queda
  aplicado a medias — pero las migraciones anteriores del mismo lote sí quedan.
- El orden es alfabético por nombre de archivo. Por eso los números van con
  ceros a la izquierda (`001`, `002`, … `010`).

## Qué NO va acá (todavía)

`db/schema.sql` y `db/01-*.sql` … `db/10-*.sql` siguen funcionando como hasta
ahora: `migrate.js` los aplica en cada corrida y son idempotentes. No se tocan.

Tampoco están acá todavía los objetos que hoy crea el DDL disperso de
`routes/` y `services/`. Para saber cuáles de esos ya se pueden mover:

```bash
npm run schema:check
```

Ver [`docs/migraciones.md`](../../docs/migraciones.md).
