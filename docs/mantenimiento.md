# Mantenimiento preventivo

Qué se **va** a romper, no qué se rompió.

El sistema ya sabía registrar la orden de trabajo después del problema. Esto mira
los contadores que se actualizan solos —el odómetro que trae el GPS, el
horómetro de las autoelevadoras, el calendario— y avisa antes:

```
AH327RZ · Cambio de aceite: faltan 800 km
AD235FE · VTV: venció hace 3 días
```

## Lo que había antes

La pantalla de Mantenimiento venía funcionando, con la configuración guardada
adentro del JSONB `vehicles.tech_spec`:

```json
{ "maint_task_name": "Cambio aceite + filtros",
  "maint_interval_km": 15000,
  "maint_last_km": 180000 }
```

Andaba, con tres límites:

- **Un solo plan por unidad.** Un camión tiene aceite cada 15.000, correa cada
  60.000 y matafuegos una vez por año. Entraba uno.
- **Solo kilómetros.** Las autoelevadoras se miden en horas de motor y hay cosas
  que se miden por fecha. Ambas quedaban afuera.
- **Nadie avisaba.** El cálculo pasaba en el navegador, así que solo existía
  mientras alguien tuviera la pantalla abierta.

Nada de eso se perdió: la **migración 004** importa lo que ya estaba cargado a la
tabla nueva. Es idempotente (índice único `(vehicle_id, lower(nombre))` +
`ON CONFLICT DO NOTHING`) y solo toca unidades que **tienen** intervalo cargado
— las que nunca se configuraron no se inventan.

| tech_spec | maintenance_schedules |
|---|---|
| `maint_task_name` | `nombre` (default `Cambio aceite + filtros`) |
| `maint_interval_km` | `intervalo` |
| `maint_last_km` | `ultimo_valor` (`0` → `NULL`, o sea "sin base") |
| — | `tipo`: `horas` si el vehículo es autoelevador/montacargas, si no `km` |
| — | `aviso_antes`: 10 % del intervalo, mínimo 1 |

## Dónde se calcula

En el **servidor**, `services/mantenimiento.js`. La pantalla solo dibuja lo que
le llega de `GET /api/mantenimiento/planes`.

Es a propósito: el aviso que llega al celular y lo que se ve en la pantalla
salen del mismo cálculo, así que no pueden dar distinto. Es el mismo criterio
que usa `services/flota-datos.js` para que el asistente y la pantalla de flota no
se contradigan.

## Los cuatro estados

| Estado | Qué significa |
|---|---|
| `vencido` | ya se pasó |
| `proximo` | entró en la ventana de `aviso_antes` |
| `ok` | todavía falta |
| `sin_base` | nunca se registró el último service — **no se estima** |

`sin_base` es una decisión, no un hueco. Sin línea de base no hay contra qué
medir, y es preferible decir "no sé" a inventar un número sobre un motor. Esos
planes aparecen en la pantalla pidiendo el dato, y no disparan aviso.

## De dónde salen los contadores

| Tipo | Columna | Quién la actualiza |
|---|---|---|
| `km` | `vehicles.km_current` | sync del GPS y cada carga de combustible con odómetro |
| `horas` | `vehicles.gps_hour_meter` | horómetro de Powerfleet (autoelevadoras) |
| `dias` | — | el calendario |

## No genera órdenes de trabajo solo

Avisa; abrir la OT sigue siendo decisión de una persona. Si las generara solo,
aparecerían órdenes que nadie cargó moviendo los KPI de mantenimiento, el conteo
del panel auditor y los costos del mes. Primero hay que poder confiar en los
números.

La pantalla tiene un botón **"Crear OTs de los pasados"** para hacerlo en lote
cuando se quiere — con confirmación, y por decisión de quien aprieta.

## El botón que se usa todos los días

**"✓ Ya se hizo"** mueve la línea de base al contador actual de la unidad. Sin
eso el plan queda pasado para siempre y el aviso se vuelve ruido que se deja de
leer.

## El aviso

Sale por push a `dueno`, `gerencia` y `jefe_mantenimiento`. Contra el ruido:

- se manda cuando **cambia** el conjunto de planes vencidos/próximos;
- si no cambia nada, un recordatorio cada `MANTENIMIENTO_RECORDAR_DIAS`;
- solo dentro de la ventana horaria, con tope arriba **y** abajo;
- si no se pudo entregar a nadie, **no** se anota como avisado — si no, el aviso
  quedaría tapado hasta el próximo recordatorio justo cuando alguien se suscribe.

| Variable | Default | Qué hace |
|---|---|---|
| `MANTENIMIENTO_OFF` | — | `1` desactiva el aviso |
| `MANTENIMIENTO_HORA` | `8` | inicio de la ventana |
| `MANTENIMIENTO_HORA_HASTA` | `20` | fin de la ventana |
| `MANTENIMIENTO_RECORDAR_DIAS` | `7` | recordatorio si no cambió nada |
| `MANTENIMIENTO_ROLES` | `dueno,gerencia,jefe_mantenimiento` | a quiénes avisar |

Acá sí va `jefe_mantenimiento`, a diferencia de los avisos de vencimiento de
documentación: el aviso lleva a la pantalla de Mantenimiento, que ese rol **sí**
tiene. Mandarle un aviso a una pantalla que no puede abrir sería peor que no
mandárselo.

## API

| Método | Ruta | Quién |
|---|---|---|
| `GET` | `/api/mantenimiento/planes` | cualquiera que entre a la pantalla |
| `POST` | `/api/mantenimiento/planes` | `dueno`, `gerencia`, `jefe_mantenimiento` |
| `PUT` | `/api/mantenimiento/planes/:id` | ídem |
| `POST` | `/api/mantenimiento/planes/:id/realizado` | ídem |
| `DELETE` | `/api/mantenimiento/planes/:id` | ídem — baja **lógica**, no borra historial |

`GET` acepta `?vehicle_id=<uuid>`.

Una validación que vale la pena nombrar: `aviso_antes` tiene que ser **menor**
que `intervalo`. Avisar con más anticipación que el propio intervalo deja el plan
en estado `proximo` para siempre — el aviso nunca se apaga.

## `tech_spec` después de la migración

La migración **copia**, no borra. Los campos `maint_*` siguen ahí, ignorados por
la pantalla nueva. Se dejan a propósito: si algo salió mal en la importación, el
original está intacto. Limpiarlos es una migración futura, cuando la tabla nueva
lleve tiempo andando.
