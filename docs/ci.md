# CI de FleetOS

Cada Pull Request corre la suite entera antes de que se pueda mergear.
Definición: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Qué verifica

| Paso | Qué agarra |
|------|-----------|
| `./validate.sh` | Un error de sintaxis en `app.js` o `roles.js`. Milisegundos. |
| `npm run build` | Que el bundle compile. **Importante**: `server.js` lo arma al arrancar y si falla cae a servir los `<script>` sueltos *en silencio* — en producción no te enterás. |
| `node db/migrate.js` | Que `schema.sql` + las 10 migraciones numeradas se apliquen limpias **sobre una base vacía**, no solo sobre la que ya venía andando. |
| `npm test` | Las 20 pruebas: backup, permisos por rol, flujos de plata y el smoke de 27 pantallas. |

## Lo que cambia respecto de correr los tests a mano

Fuera de CI, `npm test` da verde con **3 pruebas salteadas**: las de
`po_flow.integration.test.js`, que necesitan una base de Postgres y se saltean
solas si no la encuentran (`TEST_DATABASE_URL`).

Esas 3 son justamente las que verifican los flujos que mueven dinero:

- recepción parcial → `delivery=parcial`; completar → `recibida`
- pago parcial → `parcial`; pago total con entrega total → `cerrada`, sin duplicar el monto
- una factura no queda pagada hasta cubrir el total **con IVA**

En CI hay Postgres, así que **nada se saltea**: 20 de 20.

## Correr la suite completa en tu máquina

Con Docker, una base descartable:

```bash
docker run --rm -d --name fleetos-test \
  -e POSTGRES_USER=fleetos -e POSTGRES_PASSWORD=fleetos -e POSTGRES_DB=fleetos_test \
  -p 5433:5432 postgres:16-alpine

export DATABASE_URL="postgresql://fleetos:fleetos@localhost:5433/fleetos_test"
export TEST_DATABASE_URL="$DATABASE_URL"
export JWT_SECRET="cualquier-cosa-larga-para-desarrollo" BCRYPT_ROUNDS=4

node db/migrate.js   # una sola vez
npm test

docker rm -f fleetos-test   # al terminar
```

Sin esas variables `npm test` igual pasa — pero con los 3 tests de plata salteados.

## Playwright

El smoke de UI necesita Chromium. **No está en `package.json` a propósito**:
agregarlo dispararía la descarga de navegadores en cada deploy de Render, que no
los usa. CI lo instala al vuelo con `--no-save` (sin tocar el lockfile).

En tu máquina, una sola vez:

```bash
npm i -g playwright && npx playwright install chromium
npm run test:ui
```

## Variables del job

Las de `ci.yml` (`JWT_SECRET`, `ADMIN_PASSWORD`) son valores de juguete escritos
en claro: existen para que el código arranque y la base se destruye cuando
termina el job. **No hay ningún secreto real en el workflow** y no hace falta
cargar nada en la configuración de GitHub.
