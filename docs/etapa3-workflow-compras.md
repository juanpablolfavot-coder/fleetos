# Etapa 3 — Diseño del workflow de Compras / Pagos / Recepción

> **Estado: PROPUESTA PARA APROBAR.** Este documento NO cambia código. Es para
> validar el modelo antes de programar, porque toca lógica de dinero en producción.

---

## 1. Qué hay HOY (estado real del sistema)

El sistema ya separa, de hecho, **cuatro dimensiones** de estado en `purchase_orders`
(no es necesario inventarlas, ya existen):

| Dimensión | Columna | Valores actuales |
|---|---|---|
| Operativo | `status` | `pendiente_cotizacion` → `en_cotizacion` → `aprobada_compras` → `pagada` → `recibida` · `rechazada` |
| Recepción | `delivery_status` | `pendiente` / `parcial` / `total` |
| Factura | `invoice_status` | `pendiente` / `parcial` / `total` |
| Pago | `payment_status` | `pendiente` / `parcial` / `total` |
| (extra) | `is_open` | OC "abierta" para servicios/entregas fraccionadas |

### Transiciones operativas actuales (endpoints)
- `POST /:id/tomar-cotizacion` → `en_cotizacion` (compras)
- `POST /:id/aprobar-compras` → `aprobada_compras` (compras)
- `POST /:id/pagar` → `pagada` (tesorería)
- `POST /:id/recibir` → `recibida` + `delivery_status=total` (recepción total directa)
- `POST /:id/rechazar` → `rechazada` (terminal)
- `POST /:id/devolver` → vuelve a la etapa anterior (con motivo)
- Recepción **parcial**: vía `purchase_order_receipts` + trigger que calcula `delivery_status`
- Pago **parcial**: vía `purchase_order_payments` + trigger que calcula `payment_status`

### Cómo se mueve el estado hoy (lo importante)
- Triggers de base recalculan `payment_status` y `delivery_status` automáticamente.
- Esos triggers, además, **pisan `status`** en algunos casos (ej. si pago total + entrega total → `recibida`). Esto mezcla las 4 dimensiones dentro de `status` y es la causa de varios estados "raros".

---

## 2. Lo que pediste (flujo objetivo)

```
OC creada → pendiente de cotización → cotizada → pendiente de aprobación
→ aprobada → enviada al proveedor → recibida (parcial/total)
→ facturada (parcial/total) → pagada (parcial/total) → cerrada
```

Separando claramente: **estado operativo / pago / factura / recepción.**

---

## 3. Diagnóstico: la diferencia es chica, no es un rediseño

La separación de pago/factura/recepción **ya existe**. Las diferencias reales son:

| # | Gap | Tamaño |
|---|---|---|
| A | No hay estado **"enviada al proveedor"** de primera clase (hay columnas `fecha_envio_prov`/`enviada_por` sin estado propio) | Chico |
| B | **"cotizada"** y **"pendiente de aprobación"** están unidas (`en_cotizacion` salta directo a `aprobada_compras`) | Chico |
| C | No hay estado terminal **"cerrada"** distinto de `recibida` | Chico |
| D | Los **triggers pisan `status`** mezclando dimensiones → estados confusos | Mediano (es el más importante) |

**El cambio más valioso no es agregar estados, es el punto D:** que `status`
(operativo) deje de ser pisado por pago/recepción. Eso es lo que hoy genera
inconsistencias.

---

## 4. Modelo objetivo propuesto

### 4.1. `status` (operativo) — máquina de estados limpia

```
borrador? → pendiente_cotizacion → en_cotizacion (cotizada)
          → pendiente_aprobacion → aprobada_compras
          → enviada_proveedor → (recepción/pago avanzan en sus propias dimensiones)
          → cerrada
   rechazada  (terminal, desde cualquier etapa previa al cierre)
```

- `status` refleja **solo** dónde está la OC en el circuito de gestión.
- **Ya no lo tocan** los pagos ni las recepciones. Esos viven en sus columnas.
- `cerrada` = estado terminal explícito: se cierra cuando recepción y pago están
  `total` (o manualmente, para OC abiertas/servicios). Reemplaza el uso ambiguo de
  `recibida` como "fin".

### 4.2. Las otras 3 dimensiones (sin cambios de fondo, solo dejan de pisar `status`)
- `delivery_status`: pendiente / parcial / total
- `invoice_status`: pendiente / parcial / total
- `payment_status`: pendiente / parcial / total

### 4.3. "Cerrada"
- Automática: cuando `delivery_status=total` **y** `payment_status=total`.
- Manual: el dueño/compras puede cerrar una OC abierta (servicio fraccionado) cuando
  corresponda.

---

## 5. Plan de migración (sin romper las OC en curso)

1. **Agregar** los estados nuevos al `CHECK` de `status` (`pendiente_aprobacion`,
   `enviada_proveedor`, `cerrada`) — aditivo.
2. **Backfill** de datos existentes:
   - OC con `status='recibida'` y pago total → `cerrada`.
   - OC `aprobada_compras` ya enviadas (tienen `fecha_envio_prov`) → `enviada_proveedor`.
   - El resto se mapea 1:1 (los estados viejos siguen siendo válidos).
3. **Quitar de los triggers** el pisado de `status` (que solo manejen sus columnas).
4. Agregar endpoint/acción **"marcar enviada al proveedor"** (ya hay datos para eso).
5. Frontend: mostrar las 4 dimensiones por separado (hoy ya se muestran badges de
   pago/entrega; agregar el operativo limpio).

> Cada paso es chico y reversible. Se puede hacer en 2-3 PRs incrementales, no en uno solo.

---

## 6. Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Romper OC en curso al cambiar el `CHECK`/estados | Solo agregar estados (nunca quitar), backfill con `UPDATE` idempotente, probar en una copia primero |
| Que el frontend espere los estados viejos | Mantener los estados viejos como válidos; mapear en el front gradualmente |
| Triggers que dejan de pisar `status` cambien comportamiento visible | Hacerlo en un PR aislado, con verificación de algunos casos reales antes/después |

---

## 7. Decisiones que necesito de vos antes de codear

1. ¿`cerrada` automática (pago+entrega total) o siempre manual? (propongo: automática, con opción de cierre manual para OC abiertas)
2. ¿Querés el estado **borrador** antes de `pendiente_cotizacion`, o la OC nace ya pendiente de cotización? (hoy nace pendiente)
3. ¿"enviada al proveedor" es obligatoria en el circuito, o un dato opcional? (propongo: opcional, no bloquea recepción)
4. ¿Hacemos el cambio en 2-3 PRs chicos e incrementales (recomendado) o lo querés todo junto?

---

## 8. Recomendación

El mayor retorno con menor riesgo es **el punto D** (que los triggers dejen de pisar
`status`) + el estado `cerrada`. Eso solo ya ordena el 80% de la confusión. Los estados
`pendiente_aprobacion` y `enviada_proveedor` son refinamientos que se pueden sumar después.
