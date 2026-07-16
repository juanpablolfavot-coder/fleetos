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

      console.log(`✔️  ${c.code}  ${c.fecha}  ${c.litros}L × $${ppu}/L = $${totalCalc.toLocaleString('es-AR')}  ·  ${c.km} km  ·  ${c.estacion}`);
      if (DRY_RUN) { ok++; continue; }

      await pool.query(
        `INSERT INTO fuel_logs
           (vehicle_id, driver_id, driver_name, tank_id, fuel_type, liters, price_per_l,
            odometer_km, location, notes, ticket_image, ticket_estado, logged_at)
         VALUES ($1,$2,$3,NULL,'diesel',$4,$5,$6,$7,$8,NULL,NULL,$9::timestamptz)`,
        [vehId, registraId, v.rows[0].driver_name || null, c.litros, ppu, c.km, c.estacion,
         `Ticket ${c.ticket} · carga manual (script)`, c.fecha]
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
