#!/usr/bin/env node
/**
 * Conciliación de julio 2026 contra las planillas físicas de la cisterna
 * ("Control Despacho de Combustible" llenadas a mano).
 * ────────────────────────────────────────────────────────────────────────────
 * Resultado de cruzar 124 filas de planilla contra el sistema: 122 concilian.
 * Este script aplica el único ajuste confirmado (idempotente):
 *
 *  · AD235FE 15/07: la planilla dice 1.173.598 km y al sistema se tipeó
 *    1.175.398 (transposición 3↔5). Con el valor del papel la secuencia de
 *    odómetros queda estrictamente creciente (1.172.080 → 1.173.598 →
 *    1.173.912 → 1.175.289). Se corrige esa lectura.
 *
 * NOTA: la carga de AH327SA del 27/07 (657 L gasoil + 40 L urea, planilla) se
 * decidió NO insertarla por script; si corresponde, se carga a mano por la app.
 *
 * Uso (Shell de Render):
 *   node scripts/conciliacion-julio.js            → SIMULACIÓN (no toca nada)
 *   node scripts/conciliacion-julio.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);
    await client.query('BEGIN');

    // AD235FE 15/07: odómetro 1.175.398 → 1.173.598 (valor de la planilla)
    console.log('Corrección de odómetro AD235FE 15/07:');
    const fix = await client.query(
      `UPDATE fuel_logs fl SET odometer_km = 1173598
        FROM vehicles v
        WHERE v.id = fl.vehicle_id AND (v.code='AD235FE' OR v.plate='AD235FE')
          AND fl.odometer_km = 1175398
          AND DATE(fl.logged_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = '2026-07-15'
        RETURNING fl.id`);
    console.log(fix.rowCount
      ? `   ✔️  ${fix.rowCount} lectura corregida: 1.175.398 → 1.173.598 km`
      : `   ↩️  No hay lectura de AD235FE con 1.175.398 el 15/07 — nada para corregir (¿ya se corrigió?)`);

    if (APPLY) { await client.query('COMMIT'); console.log('\n✅ Conciliación aplicada.\n'); }
    else { await client.query('ROLLBACK'); console.log('\n🔎 SIMULACIÓN: no se guardó nada. Si está OK, corré con --apply.\n'); }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
