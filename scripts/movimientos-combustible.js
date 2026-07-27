#!/usr/bin/env node
/**
 * Movimientos de combustible (gasoil) por mes — TODAS las salidas de la cisterna.
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO LECTURA. Muestra el circuito completo del gasoil para poder auditar dónde
 * va cada litro (no solo lo que se carga a los vehículos):
 *
 *   ENTRADAS a cisterna        → fuel_tank_entries
 *   SALIDAS de cisterna:
 *     · a vehículos            → fuel_logs con tank_id (carga desde la cisterna)
 *     · despachos internos     → fuel_internal_dispatches (a otras sucursales,
 *                                bidones, tanques chicos: NO es consumo de vehículo)
 *   FUERA de cisterna:
 *     · estación externa       → fuel_logs sin tank_id (el camión carga afuera)
 *
 * Cierra con el consumo REAL de vehículos (cisterna-a-vehículo + estación) contra
 * el km del mes, que es lo que corresponde para el rendimiento (los despachos NO
 * deben entrar al km/L de la flota).
 *
 * Uso (Shell de Render):
 *   node scripts/movimientos-combustible.js                 → junio vs julio 2026
 *   node scripts/movimientos-combustible.js 2026-05 2026-06 → los meses que le pases
 */
const { pool } = require('../db/pool');

const num = n => Math.round(Number(n || 0)).toLocaleString('es-AR');
const argMeses = process.argv.slice(2).filter(a => /^\d{4}-\d{2}$/.test(a));
const MESES = argMeses.length >= 2 ? argMeses.slice(0, 2) : ['2026-06', '2026-07'];
const NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const label = ym => { const [y, m] = ym.split('-').map(Number); return `${NOMBRE[m - 1]} ${y}`; };
const lastDay = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const rango = ym => ({ desde: `${ym}-01`, hasta: `${ym}-${String(lastDay(ym)).padStart(2, '0')} 23:59:59.999999` });
const NO_UREA = `COALESCE(LOWER(type),'') <> 'urea'`;

async function datos(client, ym) {
  const { desde, hasta } = rango(ym);
  const [entradas, veh, ext, desp, despDest, kmR] = await Promise.all([
    // Entradas a cisterna (gasoil)
    client.query(`SELECT COALESCE(SUM(liters),0) l, COUNT(*) n FROM fuel_tank_entries
                  WHERE created_at BETWEEN $1 AND $2 AND ${NO_UREA}`, [desde, hasta]),
    // Salidas a vehículos DESDE la cisterna (fuel_logs con tank)
    client.query(`SELECT COALESCE(SUM(liters),0) l, COUNT(*) n FROM fuel_logs
                  WHERE logged_at BETWEEN $1 AND $2 AND tank_id IS NOT NULL
                    AND COALESCE(LOWER(fuel_type),'') <> 'urea'`, [desde, hasta]),
    // Cargas en estación externa (fuel_logs sin tank) — no sale de cisterna
    client.query(`SELECT COALESCE(SUM(liters),0) l, COUNT(*) n FROM fuel_logs
                  WHERE logged_at BETWEEN $1 AND $2 AND tank_id IS NULL
                    AND COALESCE(LOWER(fuel_type),'') <> 'urea'`, [desde, hasta]),
    // Despachos internos (a sucursales, bidones, tanques chicos)
    client.query(`SELECT COALESCE(SUM(liters),0) l, COUNT(*) n,
                         COALESCE(SUM(received_liters),0) recibidos,
                         COUNT(*) FILTER (WHERE LOWER(COALESCE(status,''))='despachado') pendientes
                  FROM fuel_internal_dispatches
                  WHERE created_at BETWEEN $1 AND $2 AND ${NO_UREA}`, [desde, hasta]),
    // Despachos por destino
    client.query(`SELECT destination, COALESCE(SUM(liters),0) l, COUNT(*) n
                  FROM fuel_internal_dispatches
                  WHERE created_at BETWEEN $1 AND $2 AND ${NO_UREA}
                  GROUP BY destination ORDER BY l DESC`, [desde, hasta]),
    // Km del mes (misma fórmula que el reporte, excluye autoelevadores)
    client.query(`SELECT COALESCE(SUM(km_veh),0) km FROM (
                    SELECT fl.vehicle_id, MAX(fl.odometer_km)-MIN(fl.odometer_km) km_veh
                    FROM fuel_logs fl JOIN vehicles v ON v.id=fl.vehicle_id
                    WHERE fl.logged_at BETWEEN $1 AND $2 AND fl.odometer_km>0
                      AND COALESCE(LOWER(fl.fuel_type),'')<>'urea'
                      AND COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%'
                    GROUP BY fl.vehicle_id HAVING COUNT(*)>=2) t`, [desde, hasta]),
  ]);
  return {
    entradas: entradas.rows[0], veh: veh.rows[0], ext: ext.rows[0],
    desp: desp.rows[0], despDest: despDest.rows, km: Number(kmR.rows[0].km),
  };
}

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n⛽ MOVIMIENTOS DE COMBUSTIBLE (gasoil) — ${MESES.map(label).join(' vs ')}  (solo lectura)\n`);
    const D = {};
    for (const ym of MESES) D[ym] = await datos(client, ym);
    const [A, B] = MESES;
    const col = (fn) => `${num(fn(D[A])).padStart(12)}   ${num(fn(D[B])).padStart(12)}`;

    console.log(`   ${''.padEnd(40)} ${label(A).padStart(12)}   ${label(B).padStart(12)}`);
    console.log(`   ${'─'.repeat(68)}`);
    console.log(`   ENTRADAS a cisterna (L)                  ${col(d => d.entradas.l)}`);
    console.log(`   ${'─'.repeat(68)}`);
    console.log(`   SALIDAS de cisterna:`);
    console.log(`     · a vehículos (L)                      ${col(d => d.veh.l)}`);
    console.log(`     · despachos internos (L)               ${col(d => d.desp.l)}`);
    console.log(`     = total salidas cisterna (L)           ${col(d => Number(d.veh.l) + Number(d.desp.l))}`);
    console.log(`   ${'─'.repeat(68)}`);
    console.log(`   FUERA de cisterna:`);
    console.log(`     · estación externa (L)                 ${col(d => d.ext.l)}`);
    console.log(`   ${'─'.repeat(68)}`);
    console.log(`   Variación teórica de stock cisterna (L)  ${col(d => Number(d.entradas.l) - Number(d.veh.l) - Number(d.desp.l))}`);
    console.log(`     (entradas − vehículos − despachos)`);

    // Despachos internos: detalle por destino (mes B)
    console.log(`\n   ── Despachos internos por destino — ${label(B)} ──`);
    if (!D[B].despDest.length) console.log('     (sin despachos en el mes)');
    D[B].despDest.forEach(r => console.log(`     ${String(r.destination || '(sin destino)').padEnd(34)} ${num(r.l).padStart(10)} L  (${r.n})`));
    if (Number(D[B].desp.pendientes) > 0)
      console.log(`     ⚠ ${D[B].desp.pendientes} despacho(s) sin confirmar recepción (status 'despachado').`);

    // Cierre: consumo real de vehículos vs km
    console.log(`\n   ── Consumo de VEHÍCULOS (cisterna + estación) vs km ──`);
    for (const ym of MESES) {
      const d = D[ym];
      const litrosVeh = Number(d.veh.l) + Number(d.ext.l);
      const rend = litrosVeh > 0 ? d.km / litrosVeh : 0;
      console.log(`     ${label(ym).padEnd(14)} ${num(litrosVeh).padStart(10)} L  ·  ${num(d.km).padStart(10)} km  ·  ${rend.toFixed(2)} km/L`);
    }
    console.log(`\n   Nota: los DESPACHOS internos NO son consumo de vehículo → NO entran al km/L.`);
    console.log(`   Si en un mes suben mucho los despachos, es gasoil que salió de la cisterna pero`);
    console.log(`   no generó km de flota (correcto). El km/L de arriba ya los excluye.\n`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
