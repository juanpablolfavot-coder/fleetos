#!/usr/bin/env node
/**
 * Limpieza de odómetros de JUNIO 2026 con los valores REALES de las planillas
 * físicas de la cisterna ("Control Despacho de Combustible").
 * ────────────────────────────────────────────────────────────────────────────
 * Origen del error: hasta ~el 20/06 la app autocompletaba el odómetro con un km
 * viejo del sistema (bug ya eliminado). Por eso las lecturas del 8 al 18/06 de
 * casi toda la flota quedaron corridas contra el papel (hasta ~8.000 km), lo que
 * inflaba el km del histórico (~355k por tramos vs ~313k reales del GPS) y
 * generaba tramos "irreales" de arranque.
 *
 * Este script corrige las 39 lecturas con corrimiento GRANDE (>500 km) cuyo
 * valor real está confirmado en planilla (conciliación papel↔sistema, 122/124
 * filas coincidentes). Las diferencias chicas (<500 km, ruido de lectura de
 * letra) NO se tocan. AD235FE no está acá: ya se corrigió con su script propio.
 *
 * NOTA AF159UC: sus lecturas del 10-17/06 estaban INFLADAS (el papel da menos);
 * al corregirlas, la serie queda sana desde el 08/06, pero las dos cargas del
 * 05/06 (sin página de planilla) quedan altas → puede quedar 1 retroceso en ese
 * borde, documentado. El resto de las unidades queda estrictamente creciente.
 *
 * Uso (Shell de Render):
 *   node scripts/corregir-km-junio-planillas.js            → SIMULACIÓN (no toca nada)
 *   node scripts/corregir-km-junio-planillas.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');
const km = n => Number(n).toLocaleString('es-AR');

// { unidad, fecha (día AR), mal (sistema), bien (planilla) }
const FIXES = [
  ['AH035AO','2026-06-08',  54708,  55472], ['AH035AO','2026-06-11',  55234,  56053], ['AH035AO','2026-06-12',  55487,  56464],
  ['AF823RB','2026-06-08', 118355, 119401], ['AF823RB','2026-06-10', 118810, 119854], ['AF823RB','2026-06-17', 119382, 120456],
  ['AH462JI','2026-06-09', 134868, 137420], ['AH462JI','2026-06-13', 137023, 139617],
  ['AH327SB','2026-06-09', 172463, 175571],
  ['AB120EF','2026-06-09', 536578, 544534],
  ['AF931PD','2026-06-09', 473449, 481174], ['AF931PD','2026-06-12', 474949, 482704],
  ['AD644VD','2026-06-09', 677421, 681308], ['AD644VD','2026-06-12', 679210, 683147],
  ['AH327RZ','2026-06-09', 169866, 172764], ['AH327RZ','2026-06-11', 171344, 174270], ['AH327RZ','2026-06-13', 172098, 175037], ['AH327RZ','2026-06-18', 173729, 176700],
  ['AH327AU','2026-06-09',  66658,  67370], ['AH327AU','2026-06-11',  67265,  67993], ['AH327AU','2026-06-16',  67706,  68437],
  ['AG470AG','2026-06-09', 170561, 173114], ['AG470AG','2026-06-11', 171102, 173666], ['AG470AG','2026-06-16', 171670, 174246],
  ['AF159UC','2026-06-10', 214776, 212975], ['AF159UC','2026-06-11', 215027, 213838], ['AF159UC','2026-06-17', 215674, 214083],
  ['AF614LB','2026-06-10', 531976, 539527], ['AF614LB','2026-06-12', 533424, 541088], ['AF614LB','2026-06-13', 533606, 541274], ['AF614LB','2026-06-17', 535199, 542307],
  ['AH035AN','2026-06-10',  62702,  63563], ['AH035AN','2026-06-16',  63146,  64016], ['AH035AN','2026-06-17',  63561,  64939],
  ['AA147OT','2026-06-10', 366067, 367011],
  ['AG468LQ','2026-06-11', 349415, 355910], ['AG468LQ','2026-06-16', 351004, 357652],
  ['AH327SA','2026-06-13', 163581, 167039], ['AH327SA','2026-06-17', 165001, 168684],
];

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);
    await client.query('BEGIN');

    let hechas = 0, salteadas = 0;
    const porUnidad = new Map();
    for (const [code, fecha, mal, bien] of FIXES) {
      const r = await client.query(
        `UPDATE fuel_logs fl SET odometer_km=$1
           FROM vehicles v
          WHERE v.id = fl.vehicle_id AND (v.code=$2 OR v.plate=$2)
            AND fl.odometer_km=$3
            AND DATE(fl.logged_at AT TIME ZONE 'America/Argentina/Buenos_Aires')=$4::date
          RETURNING fl.id`,
        [bien, code, mal, fecha]);
      if (r.rowCount) {
        hechas += r.rowCount;
        porUnidad.set(code, (porUnidad.get(code) || 0) + r.rowCount);
        console.log(`   ✔️  ${code} ${fecha}: ${km(mal)} → ${km(bien)}`);
      } else { salteadas++; console.log(`   ↩️  ${code} ${fecha}: no hay lectura con ${km(mal)} — salteada (¿ya corregida?)`); }
    }

    // Verificación por unidad: la serie de odómetros debe quedar (casi) creciente.
    console.log(`\n=== VERIFICACIÓN (retrocesos de odómetro por unidad, 05/06→hoy) ===`);
    const unidades = [...new Set(FIXES.map(f => f[0]))];
    for (const code of unidades) {
      const s = await client.query(
        `SELECT fl.odometer_km FROM fuel_logs fl JOIN vehicles v ON v.id=fl.vehicle_id
          WHERE (v.code=$1 OR v.plate=$1) AND fl.odometer_km>0
            AND COALESCE(LOWER(fl.fuel_type),'')<>'urea' AND fl.logged_at >= '2026-06-05'
          ORDER BY fl.logged_at, fl.id`, [code]);
      let retro = 0;
      for (let i = 1; i < s.rows.length; i++)
        if (s.rows[i].odometer_km < s.rows[i - 1].odometer_km) retro++;
      console.log(`   ${code.padEnd(10)} lecturas: ${String(s.rows.length).padStart(3)} · retrocesos: ${retro}${retro === 0 ? ' ✓' : (code === 'AF159UC' ? ' (borde 05/06 sin planilla — esperado)' : ' ⚠ revisar')}`);
    }

    if (APPLY) { await client.query('COMMIT'); console.log(`\n✅ ${hechas} lectura(s) corregida(s) · ${salteadas} salteada(s).\n`); }
    else { await client.query('ROLLBACK'); console.log(`\n🔎 SIMULACIÓN: ${hechas} a corregir · ${salteadas} salteada(s). No se guardó nada — si está OK, corré con --apply.\n`); }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
