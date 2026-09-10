#!/usr/bin/env node
/**
 * Carga masiva de combustible (estaciones externas) — FleetOS / Expreso Biletta
 * ────────────────────────────────────────────────────────────────────────────
 * Pensado para correrse en la SHELL DE RENDER (tiene acceso a la base):
 *
 *    DRY_RUN=1 node scripts/cargar-combustible.js   → muestra qué haría, SIN tocar la base
 *    node scripts/cargar-combustible.js             → inserta las cargas
 *
 * Es IDEMPOTENTE: si una carga ya existe (misma unidad + misma fecha/hora + mismos
 * litros) la saltea, así podés re-correrlo sin duplicar.
 *
 * Para futuras cargas, editá el array CARGAS de abajo y volvé a correrlo.
 *
 * TANDA 2 (tickets recibidos el 10/09/2026): 12 cargas del 24/07 al 07/09. En el
 * mismo lote venían 4 tickets ya cargados (21/07 ×2, 24/07 Escobar y 28/07): el
 * dedup los saltea solo. Además de fecha/hora+litros, se chequea el NÚMERO de
 * ticket (queda en notes), por si el mismo ticket entró alguna vez con otra hora.
 *
 * HUECOS: entre algunas cargas hay más km de los que ese gasoil puede recorrer
 * (2.900 km con 85 L): faltan tickets en el medio. Esas cargas llevan `hueco` y
 * queda anotado en notes. No hace falta excluirlas a mano del rendimiento:
 * services/consumo.js y el panel del auditor ya descartan cualquier tramo por
 * debajo de 10 L/100 km justamente como "falta una carga en el medio". Cuando
 * aparezcan los tickets faltantes, se cargan con este mismo script y el tramo se
 * arma solo.
 *
 * UREA: un ticket puede traer gasoil y urea juntos (30/07 AF041MB). Van como dos
 * filas, con `tipo:'urea'` en la segunda, y el total se reparte en proporción al
 * neto de cada renglón del ticket.
 *
 * PRECIO: por defecto price_per_l = total / litros (TODO INCLUIDO), para que el costo
 * refleje lo realmente pagado (el "TOTAL" del ticket). Si para tu criterio contable
 * preferís el precio NETO (sin IVA, que es crédito fiscal), poné el campo `ppu` en la
 * fila y se usa ese en lugar de total/litros.
 */
const { pool } = require('../db/pool');

const DRY_RUN = !!process.env.DRY_RUN;

// ── Cargas a registrar ──────────────────────────────────────────────────────
// fecha: hora local Argentina (la del ticket).  total: lo que se pagó (con impuestos).
// Nota: la unidad escrita a mano como "AA5C85W" en los tickets es la patente
// AA508SW ya cargada en el sistema (los km dan en serie: 496.899 → 498.030 →
// 498.675 → 499.342). Se registra como AA508SW.
const CARGAS = [
  { code:'AF041MB', fecha:'2026-07-02 07:04:14', litros:70.922,  total:150000.03, km:265915, estacion:'YPF — Operadora de Estaciones de Servicios', ticket:'06-025001' },
  { code:'AE517UM', fecha:'2026-07-02 14:37:37', litros:140.5811, total:300000.07, km:284552, estacion:'ACA — Norbayres, José León Suárez (BA)',   ticket:'00003-00002394' },
  { code:'AF041MB', fecha:'2026-07-06 13:42:51', litros:71.4626,  total:150000.00, km:266336, estacion:'YPF — Operadora de Estaciones de Servicios', ticket:'06398-00028889' },
  { code:'AA508SW', fecha:'2026-07-06 07:43:51', litros:85.2878,  total:199999.89, km:498030, estacion:'YPF Infinia — Malvinas Argentinas (BA)',    ticket:'06922-00061372' },
  { code:'AE517UM', fecha:'2026-07-08 14:41:21', litros:86.2813,  total:200000.07, km:285112, estacion:'NAFPUR XXI — CABA',                          ticket:'00022-00079959' },
  { code:'AF041MB', fecha:'2026-07-08 14:50:42', litros:69.606,   total:149933.00, km:266838, estacion:'GULF — Zayco, Gral. Pacheco/Tigre (BA)',    ticket:'0007-00027208' },
  { code:'AA508SW', fecha:'2026-07-10 06:53:40', litros:86.2813,  total:200000.05, km:498675, estacion:'YPF — Operadora de Estaciones de Servicios', ticket:'06394-00034777' },
  { code:'AF041MB', fecha:'2026-07-14 15:08:12', litros:84.8536,  total:199999.94, km:267268, estacion:'BUZANCY — Bella Vista (BA)',                ticket:'00016-00033673' },
  { code:'AA508SW', fecha:'2026-07-15 06:50:14', litros:86.2813,  total:200000.05, km:499342, estacion:'YPF — Operadora de Estaciones de Servicios', ticket:'06394-00034853' },
  { code:'AE517UM', fecha:'2026-07-13 15:38:15', litros:127.1219, total:271151.01, km:285381, estacion:'ACA — Norbayres, José León Suárez (BA)',   ticket:'00004-00022225' },
  { code:'AE517UM', fecha:'2026-07-15 11:16:00', litros:13.1048,  total:28018.06,  km:285618, estacion:'ACA — Norbayres, José León Suárez (BA)',   ticket:'00004-00022267' },
  // Tickets del 21/07 — YPF Operadora, Leones (CBA). El nombre entre paréntesis es
  // el anotado a mano en el ticket (va en notes; el chofer del sistema no se pisa).
  { code:'AA508SW', fecha:'2026-07-21 12:31:07', litros:81.4664,  total:200000.01, km:499862, estacion:'YPF — Operadora de Estaciones de Servicios, Leones (CBA)', ticket:'00012-00050237', nota:'pagado con Mercado Pago · anotado en ticket: Sebastián' },
  { code:'AE517UM', fecha:'2026-07-21 09:01:05', litros:129.4219, total:300000.00, km:285976, estacion:'YPF — Operadora de Estaciones de Servicios, Leones (CBA)', ticket:'0006-00025431',  nota:'pagado en efectivo · anotado en ticket: Abel' },
  { code:'AF041MB', fecha:'2026-07-20 07:53:06', litros:81.4664,  total:200000.01, km:267868, estacion:'YPF — Operadora de Estaciones de Servicios, Leones (CBA)', ticket:'07894-00059157', nota:'pagado con Visa Electrón' },
  { code:'AF041MB', fecha:'2026-07-24 11:03:01', litros:80.939,   total:210900.75, km:268428, estacion:'YPF — Mi Destino SRL, Escobar (BA)',                        ticket:'00013-00025899', nota:'contado · anotado en ticket: Jorge/Gino' },
  { code:'AA508SW', fecha:'2026-07-28 14:14:09', litros:86.2813,  total:210172.94, km:500579, estacion:'YPF — Operadora de Estaciones de Servicios',                ticket:'06394-00035090', nota:'pagado con Mercado Pago (anotado: transferencia + efectivo)' },
  { code:'AA508SW', fecha:'2026-08-03 07:38:30', litros:86.2813,  total:200000.06, km:501198, estacion:'YPF — Red Petrol SA, Av. Cnel. Roca (CABA)',                ticket:'00027-00052727', nota:'pagado con Mercado Pago' },
  { code:'AE517UM', fecha:'2026-08-03 08:28:00', litros:122.6994, total:300000.00, km:287388, estacion:'La Fuente Combustibles SRL, Río Tercero (CBA)',            ticket:'00004-00015699', nota:'pagado en efectivo' },

  // ── Tanda 2 · tickets recibidos el 10/09/2026 ─────────────────────────────
  // AE517UM (Muñoz Ariel). Km en serie: 285.976 (21/07) → 289.931 (04/09).
  { code:'AE517UM', fecha:'2026-07-24 07:03:36', litros:100.85,   total:199999.97, km:286418, estacion:'NAFPUR XXI — CABA',                                          ticket:'00022-00080265', nota:'pagado en efectivo' },
  { code:'AE517UM', fecha:'2026-07-29 11:42:22', litros:85.507,   total:200000.87, km:286900, estacion:'Super Servicios S.A. — El Talar de Pacheco (BA)',            ticket:'00059-00018672', nota:'pagado con Mercado Pago' },
  { code:'AE517UM', fecha:'2026-08-21 15:06:17', litros:85.3971,  total:200000.02, km:288765, estacion:'NAFPUR XXI — CABA',                                          ticket:'00022-00080918', nota:'pagado con Mercado Pago', hueco:'1.377 km desde la carga del 03/08 (287.388) con una sola carga: faltan tickets entre el 03/08 y el 21/08' },
  { code:'AE517UM', fecha:'2026-08-27 07:21:06', litros:85.3971,  total:200000.02, km:289173, estacion:'NAFPUR XXI — CABA',                                          ticket:'00022-00081032', nota:'pagado con Mercado Pago' },
  { code:'AE517UM', fecha:'2026-08-31 09:43:20', litros:120.048,  total:299999.95, km:289463, estacion:'YPF — Operadora de Estaciones de Servicios (CABA)',           ticket:'07768-00018242', nota:'pagado en efectivo' },
  { code:'AE517UM', fecha:'2026-09-04 10:48:00', litros:126.1034, total:299999.99, km:289931, estacion:'BUZANCY — Bella Vista (BA)',                                  ticket:'00016-00034563', nota:'pagado en efectivo' },
  // AF041MB (Sabathier Jorge). Km en serie: 268.428 (24/07) → 274.641 (04/09).
  // El ticket del 30/07 trae 72,4763 L de gasoil y 10 L de urea (AdBlue) en el
  // mismo comprobante (total 209.712,23): se reparte por el neto de cada renglón.
  { code:'AF041MB', fecha:'2026-07-30 06:40:37', litros:72.4763,  total:172687.80, km:268970, estacion:'YPF — Operadora de Estaciones de Servicios',                  ticket:'06400-00025598', nota:'pagado con transferencia + efectivo · ticket con 10 L de urea aparte' },
  { code:'AF041MB', fecha:'2026-07-30 06:40:37', litros:10,       total:37024.43,  km:268970, estacion:'YPF — Operadora de Estaciones de Servicios',                  ticket:'06400-00025598', nota:'urea (Azul32) del mismo ticket que el gasoil', tipo:'urea' },
  { code:'AF041MB', fecha:'2026-08-25 15:16:43', litros:85.3971,  total:200000.01, km:271937, estacion:'YPF — Red Petrol SA, Av. Cnel. Roca (CABA)',                 ticket:'00029-00028625', nota:'pagado con Visa', hueco:'2.967 km desde la carga del 30/07 (268.970) con una sola carga: faltan tickets entre el 30/07 y el 25/08' },
  { code:'AF041MB', fecha:'2026-09-04 13:31:07', litros:86.9565,  total:199999.95, km:274641, estacion:'ARGUMAL SA — Lanús Oeste (BA)',                              ticket:'00009-00006066', nota:'pagado en efectivo', hueco:'2.704 km desde la carga del 25/08 (271.937) con una sola carga: faltan tickets entre el 25/08 y el 04/09' },
  // AA508SW (Suárez Sebastián). Km en serie: 501.198 (03/08) → 504.828 (07/09).
  { code:'AA508SW', fecha:'2026-08-26 11:31:00', litros:91.8695,  total:199999.90, km:503594, estacion:'Petal Servicios Petroleros — Calchaquí 851 (BA)',            ticket:'0201-00002336',  nota:'pagado con Mercado Pago', hueco:'2.396 km desde la carga del 03/08 (501.198) con una sola carga: faltan tickets entre el 03/08 y el 26/08' },
  { code:'AA508SW', fecha:'2026-08-31 11:26:26', litros:85.3971,  total:200000.01, km:504149, estacion:'YPF — Red Petrol SA, Av. Cnel. Roca (CABA)',                 ticket:'00025-00026728', nota:'pagado con Mercado Pago / efectivo' },
  { code:'AA508SW', fecha:'2026-09-07 11:44:12', litros:80.032,   total:199999.97, km:504828, estacion:'Garín Combustibles S.A. — Panamericana km 40,8, Garín (BA)', ticket:'00020-00018684', nota:'pagado con Mercado Pago' },
];

async function main() {
  console.log(DRY_RUN ? '🔎 DRY RUN — no se inserta nada\n' : '⛽ Insertando cargas de combustible\n');

  // Usuario que queda como "cargado por" (driver_id): un dueño/gerencia.
  const u = await pool.query(
    `SELECT id, name FROM users WHERE role IN ('dueno','gerencia') ORDER BY (role='dueno') DESC, created_at LIMIT 1`
  );
  const registraId = u.rows[0]?.id || null;
  console.log(`Registrado por: ${u.rows[0]?.name || '(sin usuario dueño/gerencia)'}\n`);

  let ok = 0, skip = 0, err = 0;

  for (const c of CARGAS) {
    try {
      const v = await pool.query('SELECT id, driver_name FROM vehicles WHERE code=$1 OR plate=$1', [c.code]);
      if (!v.rows[0]) { console.log(`❌ ${c.code}: vehículo no encontrado — salteado`); err++; continue; }
      const vehId = v.rows[0].id;

      // Precio/L: explícito si viene; si no, total / litros (todo incluido).
      const ppu = c.ppu != null ? +(+c.ppu).toFixed(2) : +(c.total / c.litros).toFixed(2);
      const totalCalc = +(c.litros * ppu).toFixed(2);

      // Dedup: misma unidad + misma fecha/hora + mismos litros.
      // liters se guarda como NUMERIC(10,2), por eso se redondea a 2 decimales en
      // ambos lados: si no, 13.1048 (fila) nunca igualaría a 13.10 (guardado) y el
      // re-run duplicaría la carga.
      const dup = await pool.query(
        `SELECT id FROM fuel_logs WHERE vehicle_id=$1 AND logged_at=$2::timestamptz AND ROUND(liters,2)=ROUND($3::numeric,2) LIMIT 1`,
        [vehId, c.fecha, c.litros]
      );
      if (dup.rows[0]) { console.log(`↩️  ${c.code} ${c.fecha} ${c.litros}L: ya existe — salteado`); skip++; continue; }
      // Segundo dedup: el número de ticket ya cargado para esa unidad y ese tipo,
      // por si el mismo ticket entró alguna vez con otra hora o litros redondeados.
      const dupTicket = await pool.query(
        `SELECT id, logged_at FROM fuel_logs
          WHERE vehicle_id=$1 AND COALESCE(LOWER(fuel_type),'diesel')=$3 AND notes LIKE $2 LIMIT 1`,
        [vehId, `Ticket ${c.ticket} ·%`, (c.tipo || 'diesel').toLowerCase()]
      );
      if (dupTicket.rows[0]) { console.log(`↩️  ${c.code} ticket ${c.ticket}: ya cargado el ${String(dupTicket.rows[0].logged_at).slice(0, 16)} — salteado`); skip++; continue; }

      console.log(`✔️  ${c.code}  ${c.fecha}  ${c.litros}L${c.tipo === 'urea' ? ' UREA' : ''} × $${ppu}/L = $${totalCalc.toLocaleString('es-AR')}  ·  ${c.km} km  ·  ${c.estacion}`);
      if (c.hueco) console.log(`    ⚠ hueco: ${c.hueco}`);
      if (DRY_RUN) { ok++; continue; }

      // ticket_estado='papel': no hay foto porque la carga se tipeó desde el ticket
      // físico, cuyo número queda en notes. El respaldo existe, sólo que en papel.
      // Sin esta marca, el panel del auditor las cuenta como cargas sin respaldo.
      await pool.query(
        `INSERT INTO fuel_logs
           (vehicle_id, driver_id, driver_name, tank_id, fuel_type, liters, price_per_l,
            odometer_km, location, notes, ticket_image, ticket_estado, logged_at)
         VALUES ($1,$2,$3,NULL,$10,$4,$5,$6,$7,$8,NULL,'papel',$9::timestamptz)`,
        [vehId, registraId, v.rows[0].driver_name || null, c.litros, ppu, c.km, c.estacion,
         `Ticket ${c.ticket} · carga manual (script)${c.nota ? ' · ' + c.nota : ''}${c.hueco ? ' · ⚠ TRAMO INCOMPLETO: ' + c.hueco : ''}`,
         c.fecha, c.tipo || 'diesel']
      );
      // Actualizar el odómetro del vehículo si avanzó.
      await pool.query('UPDATE vehicles SET km_current=$1 WHERE id=$2 AND COALESCE(km_current,0)<$1', [c.km, vehId]);
      ok++;
    } catch (e) {
      console.log(`❌ ${c.code} ${c.fecha}: ${e.message}`);
      err++;
    }
  }

  console.log(`\nResumen: ${ok} ${DRY_RUN ? 'a insertar' : 'insertadas'} · ${skip} salteadas (ya existían) · ${err} con error.`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
