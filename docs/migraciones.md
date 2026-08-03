# Migraciones de esquema

## El problema

Hoy el esquema de FleetOS se define en dos lugares:

| Dónde | Qué | Cuándo corre |
|---|---|---|
| `db/schema.sql` + `db/01-*.sql` … `db/10-*.sql` | El esquema base y sus migraciones | En cada `npm run migrate` |
| `routes/`, `services/`, `middleware/` | ~270 sentencias `ALTER TABLE … ADD COLUMN IF NOT EXISTS` y `CREATE TABLE IF NOT EXISTS` | En **cada arranque** del server (y algunas, la primera vez que corre la función que las necesita) |

El segundo grupo existe por una buena razón: sin registro de qué migración se
aplicó, la única forma de garantizar que una base vieja tenga las columnas
nuevas es re-intentarlas siempre. El costo es que cada deploy ejecuta cientos de
sentencias DDL, y que 7 de ellas corren **dentro de la transacción de cada carga
de combustible** (`routes/others.js:753-762`), que es el endpoint que más usan
los choferes.

## El plan

**Parte A (hecha).** Poner la infraestructura, sin sacar nada:

- `db/migrations/` + `schema_migrations` — migraciones versionadas, cada una se
  aplica una sola vez. De acá en adelante todo cambio de esquema va acá.
- `npm run schema:check` — compara el esquema real de una base contra lo que
  declara el repo y dice si ya se puede sacar el DDL de arranque. **Solo lee.**

Lo de antes queda intacto: `migrate.js` sigue aplicando `schema.sql` y los 10
archivos numerados en cada corrida, y el DDL de arranque sigue donde está.

**Parte B — paso 1 (hecho).** `db/migrations/001-tablas-y-columnas-de-servicios.sql`
trae al repositorio los 14 objetos que hasta ahora creaban los servicios por su
cuenta: 4 tablas, 3 columnas y 7 índices que no declaraba ningún `db/*.sql`.

Antes, una base creada con `npm run migrate` quedaba **incompleta** y funcionaba
de casualidad, porque el server terminaba de armar el esquema mientras
trabajaba. Ahora `schema:check` sobre una base recién migrada da ① vacío.

La migración es aditiva y todo va con `IF NOT EXISTS`: sobre una base que ya los
tiene —producción— no hace absolutamente nada (verificado: 38 tablas y 503
columnas antes y después).

**Parte B — paso 2 (bloqueado).** Sacar el DDL de `routes/` y `services/`.

Falta resolver una cosa antes, y no es de código: **el deploy de Render no corre
ninguna migración.** Hoy eso no se nota, porque el DDL de arranque va aplicando
los cambios de esquema solo. Si lo sacamos sin poner un paso de migración en el
deploy, la próxima migración que agreguemos nunca llega a producción — y falla
en silencio, que es el peor modo.

## Configurar el Pre-Deploy Command

En el dashboard de Render, en el **servicio web** (no en el Cron Job del backup):

> **Settings → Build & Deploy → Pre-Deploy Command**

```
npm run migrate:deploy
```

Eso es todo. Usa el `DATABASE_URL` que el servicio ya tiene en su entorno.

### Por qué `migrate:deploy` y no `migrate`

| | `npm run migrate` | `npm run migrate:deploy` |
|---|---|---|
| Qué aplica | `schema.sql` + los 10 numerados + las versionadas | solo las versionadas pendientes |
| Sobre una base al día | ~1100 ms | ~100 ms |
| Transacción | **una sola** sobre ~2280 líneas de SQL | una por migración pendiente |

`migrate` es idempotente y funciona, pero en cada deploy tomaría locks sobre el
esquema entero durante un segundo para no cambiar nada (abre `BEGIN` en
`db/migrate.js:12` y no cierra hasta la 70). `migrate:deploy` toca solo lo que
falta.

`npm run migrate` sigue siendo el comando para una base **nueva** o para correr
a mano.

### Qué pasa cuando algo falla

`migrate:deploy` sale con código 1, y **Render aborta el deploy**: la versión
anterior sigue sirviendo. Es lo que se quiere — código que necesita una columna
que no se pudo crear no debería llegar a producción.

```
[migrate:deploy] ✗ migración 002-x.sql falló (no se aplicó nada de ese archivo): syntax error…
[migrate:deploy] El deploy se aborta a propósito: la versión anterior sigue sirviendo.
```

Cada migración corre en su propia transacción, así que una que falla no queda
aplicada a medias.

### Si el plan no tiene Pre-Deploy Command

Es una función de los planes pagos de Render. Si no aparece el campo, la
alternativa es seguir corriendo `npm run migrate` a mano desde el Shell después
de cada deploy que traiga una migración — que es lo que se hace hoy, con el
riesgo de olvidarse. Ese olvido es justo lo que dejó 4 tablas fuera del
repositorio durante meses.

## `npm run schema:check`

```bash
DATABASE_URL="postgresql://..." npm run schema:check
```

Hace `SELECT` sobre los catálogos de PostgreSQL (`information_schema`,
`pg_indexes`) y compara contra lo que declaran los archivos del repo. **No crea,
no altera y no borra nada**: es seguro correrlo contra producción.

El reporte tiene tres secciones:

1. **BLOQUEANTE** — lo que el DDL de arranque agrega y esa base todavía no
   tiene. Mientras haya algo acá, ese DDL sigue haciendo falta: sacarlo rompería
   esa base. Cada ítem tiene que pasar a ser una migración versionada primero.
2. **Declarado en `db/*.sql` y ausente** — señal de que a esa base le faltó
   correr alguna migración numerada.
3. **En la base y declarado en ningún lado** — deriva: columnas agregadas a mano
   que no se recrearían si mañana se levanta la base desde el repo.

Y cierra con un veredicto: se puede sacar el DDL de arranque, o no y por qué.

Opciones: `--json` (salida procesable) y `--strict` (termina con código 1 si hay
bloqueantes, para usarlo como gate en CI más adelante).

### Correrlo contra producción

Desde el Shell de Render, **sin prefijo**: el servicio ya tiene `DATABASE_URL`
en su entorno, y ahí `NODE_ENV=production` hace que el script use SSL con el
mismo criterio que `db/pool.js`.

```bash
npm run schema:check
```

### Resultado sobre la base de producción (3 de agosto de 2026)

```
Base: 39 tablas · 542 columnas · 153 índices

① BLOQUEANTE: ✓ nada — la base ya tiene todo lo que el DDL de arranque agregaría.
```

Es decir: **para esa base, las ~270 sentencias del arranque son todas no-op.**

Las otras dos secciones sí trajeron cosas, ninguna urgente:

**② Declarado en `db/schema.sql` y ausente en producción (5).** `work_orders.title`,
`created_by`, `assigned_to`, `completed_at` y `sucursal_areas.created_at`.
Ninguna se usa en el código: son declaraciones muertas del esquema. Producción
funciona sin ellas desde siempre.

**③ En producción y declarado en ningún lado (16).** Tampoco las usa el código,
así que una base creada desde el repo funciona igual. Se explican solas:

| Qué | Por qué está |
|---|---|
| `aprobado_por`, `aprobado_en`, `pagado_en`, `rechazado_en`, `rechazo_motivo` | nombres viejos de un rename — hoy son `aprobado_compras_por`, `aprobado_compras_at`, `pagado_at`, `rechazado_at`, `motivo_rechazo` |
| `work_orders_backup_renumeracion` | tabla de respaldo de una corrección puntual |
| `maintenance_plans` | tabla sin una sola referencia en el repo |
| `vehicles.fuel_capacity`, `urea_capacity`, `engine_hours`, `cost_per_km`, `notes`, `tires.notes`, `documents.file_url`, `fuel_logs.created_at`, `work_orders.diagnosis` | columnas que quedaron de versiones anteriores |

Antes de borrar cualquiera de estas hay que mirar si tienen datos —
`maintenance_plans` y `work_orders_backup_renumeracion` en particular.

Como referencia, sobre una base recién creada con `npm run migrate` el veredicto
da **11 objetos bloqueantes** — 4 tablas y 7 índices que ningún `db/*.sql`
declara:

| Objeto | Lo crea | Cuándo |
|---|---|---|
| `idle_events` (+2 índices) | `services/idle.js` | primera vez que el GPS detecta ralentí |
| `speeding_events` (+2 índices) | `services/speeding.js` | primer exceso de velocidad |
| `push_subscriptions` | `services/push.js` | primera suscripción a notificaciones |
| `gps_webhook_events` (+1 índice) | `services/webhook-powerfleet.js` | primer aviso del webhook |
| `uq_stock_balances_loc` | `routes/stock.js` | al arrancar |
| `idx_vehicles_gps_id` | `services/gps-powerfleet.js` | al arrancar |

Esas cuatro tablas no se crean al arrancar sino **la primera vez que la función
que las usa corre de verdad**. En una base de producción con GPS andando lo más
probable es que ya existan — pero eso hay que confirmarlo, no asumirlo.

## Agregar una migración

Ver [`db/migrations/README.md`](../db/migrations/README.md). Resumen:

1. `db/migrations/NNN-descripcion.sql` con el número siguiente al último.
2. `npm run migrate`.

Reglas: cada archivo corre en su propia transacción, y **una migración ya
aplicada en producción no se edita nunca más** — se escribe una nueva. Si alguien
la edita igual, el runner avisa al arrancar, pero para esa base el cambio ya no
entra.
