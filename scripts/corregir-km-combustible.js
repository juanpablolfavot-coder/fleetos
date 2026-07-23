#!/usr/bin/env node
/**
 * Corrige el odómetro mal cargado en las cargas de combustible de la unidad AG468LQ.
 * ────────────────────────────────────────────────────────────────────────────
 * Quien cargó los tickets se equivocó al tipear los km: puso 311.452 km cuando el
 * valor real era 371.452 km. Afecta a 2 cargas del 2026-07-17 (Gasoil 568 L y
 * Urea 32 L), ambas con odometer_km = 311452.
 *
 * El script cambia odometer_km 311452 → 371452 SOLO en esas cargas (unidad AG468LQ)
 * y, si corresponde, sube km_current del vehículo (nunca lo baja: solo lo actualiza
 * si el actual quedó por debajo del valor corregido).
 *
 * Uso (Shell de Render):
 *   node scripts/corregir-km-combustible.js            → SIMULACIÓN (no toca nada)
 *   node scripts/corregir-km-combustible.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');

const PLATE     = 'AG468LQ';
const WRONG_KM  = 311452;
const RIGHT_KM  = 371452;
const km = n => Number(n).toLocaleString('es-AR') + ' km';

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);

    const v = await client.query('SELECT id, code, plate, km_current FROM vehicles WHERE code=$1 OR plate=$1', [PLATE]);
    if (!v.rows[0]) { console.log(`Vehículo ${PLATE} no encontrado.`); return; }
    const veh = v.rows[0];
    console.log(`Vehículo: ${veh.plate || veh.code}  ·  km_current actual: ${veh.km_current == null ? '(sin dato)' : km(veh.km_current)}\n`);

    // Cargas afectadas: mismas del ticket, con el km mal tipeado.
    const logs = await client.query(
      `SELECT id, logged_at, fuel_type, liters, odometer_km
         FROM fuel_logs
        WHERE vehicle_id=$1 AND odometer_km=$2
        ORDER BY logged_at`,
      [veh.id, WRONG_KM]
    );

    if (!logs.rows.length) {
      console.log(`No hay cargas de ${PLATE} con odómetro ${km(WRONG_KM)}. Nada para corregir (¿ya se corrigió?).`);
      return;
    }

    console.log(`=== CARGAS A CORREGIR (${logs.rows.length}) ===`);
    logs.rows.forEach(r => {
      const f = new Date(r.logged_at).toLocaleString('es-AR');
      console.log(`   ${f}  ·  ${r.fuel_type}  ·  ${r.liters} L  ·  ${km(r.odometer_km)}  →  ${km(RIGHT_KM)}`);
    });

    await client.query('BEGIN');

    const upd = await client.query(
      'UPDATE fuel_logs SET odometer_km=$1 WHERE vehicle_id=$2 AND odometer_km=$3',
      [RIGHT_KM, veh.id, WRONG_KM]
    );

    // Subir el odómetro del vehículo solo si quedó por debajo del valor real (nunca bajarlo).
    const updVeh = await client.query(
      'UPDATE vehicles SET km_current=$1 WHERE id=$2 AND COALESCE(km_current,0)<$1',
      [RIGHT_KM, veh.id]
    );

    console.log(`\n   ${upd.rowCount} carga(s) corregida(s).`);
    console.log(updVeh.rowCount
      ? `   km_current del vehículo actualizado a ${km(RIGHT_KM)}.`
      : `   km_current del vehículo sin cambios (ya era ≥ ${km(RIGHT_KM)}).`);

    if (APPLY) { await client.query('COMMIT'); console.log('\n✅ Corrección aplicada.\n'); }
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
