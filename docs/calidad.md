# Qué revisa el CI, y qué no

Tres capas, de más barata a más cara. Todas corren en cada PR.

| Paso | Qué encuentra | Tarda |
|---|---|---|
| `./validate.sh` | errores de sintaxis en el frontend | milisegundos |
| `npm run lint` | bugs que los tests no ven | ~2 s |
| `npm run build` | que el bundle de producción compile | ~1 s |
| `node db/migrate.js` | que el esquema se aplique desde cero | ~2 s |
| `npm test` | que el sistema haga lo que se espera | ~50 s |

## El linter

Está por una razón concreta: **los tests no ven esta familia de errores.**

Un test dice si el código hace lo que se espera. No dice nada de un `==` donde iba `===`, de una clave repetida en un objeto, de un `case` duplicado, de código después de un `return`, ni de una variable que nunca se declaró. Eso se encuentra leyendo, y una máquina lee mejor y más barato que una persona.

El caso que lo justificó: durante meses, `middleware/security.js` tuvo un regex que convertía `"monto=15000"` en `"m15000"` en cada request. Ningún test lo agarró porque no había test del middleware, y ninguna persona lo vio porque el daño era invisible. Un linter no habría encontrado *ese* bug puntual, pero sí encuentra la familia a la que pertenece: reglas escritas de memoria que nadie volvió a mirar.

### Dos niveles, a propósito

**Errores — frenan el PR.** Hoy pasan todas con cero:

```
eqeqeq · no-undef · no-unreachable · no-dupe-keys · no-dupe-else-if
no-duplicate-case · no-self-compare · no-async-promise-executor · no-empty
```

**Avisos — se ven, no frenan.** Son 70 preexistentes:

```
no-unused-vars · no-useless-assignment · no-useless-escape · preserve-caught-error
```

Por qué no se arreglaron de una: son variables muertas y escapes de más, o sea cero valor para quien usa el sistema, y arreglar 70 declaraciones repartidas en 15 archivos —la mayoría sin cobertura de tests— es una oportunidad de romper algo a cambio de nada. Se limpian cuando alguien toca ese archivo por otra razón, que es cuando el riesgo es menor.

**Un linter que arranca en rojo no lo corre nadie.** Se vuelve ruido de fondo y se lleva puestas también a las reglas que sí sirven. Por eso las de bugs están en verde desde el día uno y frenan de verdad.

### Nada de estilo

No hay reglas de comillas, punto y coma ni indentación. Un linter que grita por formato se apaga a la semana. Si algún día se quiere formato uniforme, eso es un formateador (Prettier), que es otra herramienta y otra decisión.

### Los globals del frontend

`public/js/app.js` y los módulos `.mjs` se hablan por el objeto global (`escapeHtml`, `showToast`, `apiFetch`…). Eso funciona porque `app.js` carga primero, y **no es un error**: es el estado real de una migración a módulos que está al ~42%.

Esos nombres están declarados en `eslint.config.js` para que `no-undef` siga sirviendo para lo que importa —un nombre mal escrito— en vez de tapar 210 avisos. **A medida que un módulo pasa a `need()` del puente (`dom.mjs`), su nombre sale de esa lista.** Cuando la lista quede vacía, la migración terminó.

## Dónde se escapa, y dónde se escapó tarde

La defensa contra XSS de este sistema es **escapar al renderizar**: `escapeHtml()`
en `public/js/timezone.js`, con más de 420 usos. No hay saneo de entrada que
valga —se probó, rompía datos y era esquivable (ver `middleware/security.js`)—.

Eso funciona **siempre que no falte ningún punto de render**. Y faltó uno:

```js
// auditor.mjs — la respuesta de la IA, sin escapar
chat.innerHTML += `<div ...>${respuesta.replace(/\n/g,'<br>')}</div>`;
```

El camino era indirecto pero real: alguien carga una etiqueta en la observación
de un ticket → esa descripción entra en el prompt que se le manda al modelo → el
modelo la repite en su respuesta → se ejecuta en el navegador de quien abrió el
panel, que son **dueño y gerencia**, los dos roles con más permisos.

Dos cosas que vale la pena registrar:

1. **Que el texto venga de un modelo no lo hace confiable.** Es texto de
   terceros que pasó por un intermediario; se trata igual que cualquier otro.
2. **Una búsqueda por nombres de campo no encuentra esto.** Al revisar si sacar
   el saneo de entrada abría algo, se buscó `notas|description|observaciones|…`
   y este render quedó afuera porque la variable se llama `respuesta`. El orden
   correcto es al revés: buscar los `innerHTML` y ver cuáles interpolan algo,
   no buscar los datos y ver dónde caen.

`test/smoke.ui.cjs` ahora ejercita ese render **en el navegador de verdad**, con
un payload real, y verifica tres cosas: que no se ejecute, que no quede una
etiqueta viva en el DOM, y que el salto de línea siga siendo un `<br>`. Fallaba
contra el código anterior.

## Lo que el CI todavía no cubre

Vale tenerlo escrito, porque un CI verde da confianza y conviene saber sobre qué.

- **La mayoría de los 120 endpoints no tiene test.** De 18 archivos de rutas, 3 son importados por algún test. Lo que sí está cubierto es lo que mueve plata (el flujo de recepción y pago de OC) y lo que avisa (vencimientos, mantenimiento, consumo).
- **`schema:check` no compara constraints, tipos de columna ni cuerpos de función.** Dos problemas reales se le escaparon por eso: el `tanks NUMERIC(10,2)→(12,2)` y las funciones de `routes/payments.js` que difieren de `db/09`. Ver `docs/migraciones.md`.
- **No hay tests de la UI más allá del smoke**, que verifica que las 28 pantallas dibujen sin explotar, no que lo que dibujan esté bien.
- **No hay medición de cobertura.** Se sabe qué está testeado leyendo los tests, no un número.

## Correrlo a mano

```bash
npm run lint          # solo el linter
npm test              # la suite (necesita Postgres para no saltear nada)
npm run test:ui       # el smoke de las 28 pantallas
./validate.sh         # sintaxis del frontend
```

Sin `TEST_DATABASE_URL`, `npm test` pasa igual pero **saltea** los tests que necesitan base — entre ellos los de recepción y pago. El CI siempre los corre.
