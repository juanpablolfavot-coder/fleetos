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
const CARGAS = [
  { code:'AF041MB', fecha:'2026-06-22 06:54:27', litros:71.02,  total:150000.00, km:264450, estacion:'YPF — Operadora de Estaciones de Servicios', ticket:'06398-00028621' },
  { code:'AF041MB', fecha:'2026-06-24 15:25:26', litros:70.79,  total:149999.98, km:264983, estacion:'YPF — Operadora de Estaciones de Servicios', ticket:'06398-00028672' },
  { code:'AA508SW', fecha:'2026-06-24 13:35:46', litros:84.28,  total:200000.00, km:496899, estacion:'Echeverría e Hijos — González Catán',        ticket:'00017-00013810' },
  { code:'AE517UM', fecha:'2026-06-24 08:42:43', litros:144.58, total:300078.64, km:283543, estacion:'YPF — Operadora de Estaciones de Servicios', ticket:'08020-00036834' },
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
      const v = await pool.query('SELECT id, driver_name FROM vehicles WHERE code=$1', [c.code]);
      if (!v.rows[0]) { console.log(`❌ ${c.code}: vehículo no encontrado — salteado`); err++; continue; }
      const vehId = v.rows[0].id;

      // Precio/L: explícito si viene; si no, total / litros (todo incluido).
      const ppu = c.ppu != null ? +(+c.ppu).toFixed(2) : +(c.total / c.litros).toFixed(2);
      const totalCalc = +(c.litros * ppu).toFixed(2);

      // Dedup: misma unidad + misma fecha/hora + mismos litros.
      const dup = await pool.query(
        `SELECT id FROM fuel_logs WHERE vehicle_id=$1 AND logged_at=$2::timestamptz AND liters=$3 LIMIT 1`,
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
