#!/usr/bin/env node
/**
 * Conciliación de julio 2026 contra las planillas físicas de la cisterna
 * ("Control Despacho de Combustible" llenadas a mano).
 * ────────────────────────────────────────────────────────────────────────────
 * Resultado de cruzar 124 filas de planilla contra el sistema: 122 concilian.
 * Este script aplica los 2 ajustes que surgieron (todo idempotente):
 *
 *  1) AD235FE 15/07: la planilla dice 1.173.598 km y al sistema se tipeó
 *     1.175.398 (transposición 3↔5). Con el valor del papel la secuencia de
 *     odómetros queda estrictamente creciente. Se corrige esa lectura.
 *
 *  2) AH327SA 27/07: la planilla registra 657 L de gasoil + 40 L de urea
 *     (odómetro 185.313) que no estaban en el sistema al 27/07 10:34. Se
 *     insertan replicando la semántica de la app: precio del tanque, descuento
 *     de stock de la cisterna (con lock y control de stock suficiente) y
 *     actualización de km_current si sube. Si alguien las tipeó después, el
 *     dedup (misma unidad + misma fecha + mismos litros) las saltea.
 *
 * Uso (Shell de Render):
 *   node scripts/conciliacion-julio.js            → SIMULACIÓN (no toca nada)
 *   node scripts/conciliacion-julio.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');
const num = n => Number(n).toLocaleString('es-AR');

async function insertarCarga(client, { plate, fecha, litros, fuelType, tankType, km, nota }) {
  const v = await client.query('SELECT id, driver_name, km_current FROM vehicles WHERE code=$1 OR plate=$1', [plate]);
  if (!v.rows[0]) { console.log(`   ❌ ${plate}: vehículo no encontrado`); return; }
  const veh = v.rows[0];

  // Dedup por unidad + fecha (día) + litros: si ya la tipearon, no duplicar.
  const dup = await client.query(
    `SELECT id FROM fuel_logs WHERE vehicle_id=$1 AND DATE(logged_at AT TIME ZONE 'America/Argentina/Buenos_Aires')=$2::date
       AND ROUND(liters)=ROUND($3::numeric) AND COALESCE(LOWER(fuel_type),'')=$4 LIMIT 1`,
    [veh.id, fecha.slice(0, 10), litros, fuelType]);
  if (dup.rows[0]) { console.log(`   ↩️  ${plate} ${fecha.slice(0,10)} ${litros} L (${fuelType}): ya existe — salteada`); return; }

  // Cisterna correspondiente (con lock, como la app) + control de stock.
  const t = await client.query(
    `SELECT id, location, current_l, price_per_l FROM tanks
      WHERE type=$1 AND active IS DISTINCT FROM FALSE ORDER BY current_l DESC LIMIT 1 FOR UPDATE`, [tankType]);
  if (!t.rows[0]) { console.log(`   ❌ ${plate}: no hay cisterna activa de tipo '${tankType}'`); return; }
  const tank = t.rows[0];
  const stock = parseFloat(tank.current_l) || 0;
  if (stock < litros) {
    console.log(`   ⚠️  ${plate} ${litros} L (${fuelType}): stock insuficiente en ${tank.location} (${num(Math.round(stock))} L) — NO se inserta. Revisar stock antes.`);
    return;
  }
  const ppu = parseFloat(tank.price_per_l) || null;

  console.log(`   ✔️  ${plate} ${fecha} · ${litros} L ${fuelType} × $${ppu ?? 's/precio'} · ${num(km)} km · ${tank.location} (stock ${num(Math.round(stock))} → ${num(Math.round(stock - litros))} L)`);

  // Quien registra: un dueño/gerencia (igual que cargar-combustible.js).
  const u = await client.query(`SELECT id FROM users WHERE role IN ('dueno','gerencia') ORDER BY (role='dueno') DESC, created_at LIMIT 1`);
  await client.query('UPDATE tanks SET current_l = current_l - $1, updated_at = NOW() WHERE id = $2', [litros, tank.id]);
  await client.query(
    `INSERT INTO fuel_logs (vehicle_id, driver_id, driver_name, tank_id, fuel_type, liters, price_per_l,
                            odometer_km, location, notes, ticket_image, ticket_estado, logged_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NULL,$11::timestamptz)`,
    [veh.id, u.rows[0]?.id || null, veh.driver_name || null, tank.id, fuelType, litros, ppu, km,
     tank.location, nota, fecha]);
  await client.query('UPDATE vehicles SET km_current=$1 WHERE id=$2 AND COALESCE(km_current,0)<$1', [km, veh.id]);
}

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);
    await client.query('BEGIN');

    // ── 1) AD235FE 15/07: odómetro 1.175.398 → 1.173.598 (valor de la planilla) ──
    console.log('1) Corrección de odómetro AD235FE 15/07:');
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

    // ── 2) AH327SA 27/07: gasoil 657 L + urea 40 L (planilla, odo 185.313) ──
    console.log('\n2) Carga de AH327SA del 27/07 (planilla: 657 L gasoil + 40 L urea · 185.313 km):');
    const NOTA = 'Planilla cisterna 27/07 · conciliación julio (script)';
    await insertarCarga(client, { plate:'AH327SA', fecha:'2026-07-27 11:00:00', litros:657, fuelType:'diesel', tankType:'fuel', km:185313, nota:NOTA });
    await insertarCarga(client, { plate:'AH327SA', fecha:'2026-07-27 11:01:00', litros:40,  fuelType:'urea',   tankType:'urea', km:185313, nota:NOTA });

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
