#!/usr/bin/env node
/**
 * Fija el km actual (vehicles.km_current) de unidades puntuales al valor del tablero.
 * ────────────────────────────────────────────────────────────────────────────
 * PEDIDO (Agustín Biletta, 08/09/2026): la pantalla de Mantenimiento mostraba en
 * "Actual" un km muy por encima del tablero en cuatro unidades, y por eso los
 * planes figuraban pasados por decenas (o millones) de km:
 *
 *     unidad     mostraba      tablero
 *     AG468LQ    3.625.518     393.719
 *     AF614LB      652.854     576.226
 *     AF931PD      568.008     519.916
 *     AH327CF       77.753      61.723
 *
 * ORIGEN: el sync del GPS hacía km_current = GREATEST(km_current, odómetro_gps),
 * y el odómetro de Powerfleet tiene su propio origen, no es el del tablero. Con
 * ese GREATEST, bajar el km a mano duraba dos minutos: el sync lo volvía a subir.
 * Eso ya no pasa (services/km-por-gps.js: el GPS suma la DIFERENCIA entre
 * lecturas, nunca el valor absoluto). Este script se apoya en eso y por eso
 * exige que el código nuevo ya esté desplegado: si la columna gps_odometer no
 * existe, corta sin tocar nada.
 *
 * Qué hace por unidad:
 *   - deja km_current en el valor del tablero (sube o BAJA, es el punto);
 *   - deja rastro en audit_log, como hace el PATCH /api/vehicles/:id/km;
 *   - avisa si algún plan de mantenimiento por km tiene una línea de base por
 *     encima del nuevo km (sería un "último service" cargado con el km inflado,
 *     hay que revisarlo a mano: acá no se inventa).
 *
 * Uso (Shell de Render, DESPUÉS del deploy):
 *   node scripts/fijar-km-unidades.js                      → SIMULACIÓN (no toca nada)
 *   node scripts/fijar-km-unidades.js --apply              → EJECUTA las 4 de arriba
 *   node scripts/fijar-km-unidades.js AB123CD=120500 --apply
 *                                                          → otras unidades (PATENTE=KM),
 *                                                            reemplaza la lista de arriba
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');
const km = n => Number(n).toLocaleString('es-AR') + ' km';

// Valores del tablero según el mensaje de Agustín.
const PEDIDO = {
  AG468LQ: 393719,
  AF614LB: 576226,
  AF931PD: 519916,
  AH327CF: 61723,
};

// PATENTE=KM por línea de comando reemplaza la lista de arriba.
function leerArgs() {
  const pares = process.argv.slice(2).filter(a => /^[A-Za-z0-9]+=\d+$/.test(a));
  if (!pares.length) return PEDIDO;
  const out = {};
  for (const p of pares) {
    const [pat, val] = p.split('=');
    out[pat.toUpperCase()] = parseInt(val, 10);
  }
  return out;
}

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);

    // Sin la columna, el sync que está corriendo es el viejo (GREATEST) y
    // pisaría la corrección en el próximo sync. No tiene sentido seguir.
    const col = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='vehicles' AND column_name='gps_odometer'`);
    if (!col.rows[0]) {
      console.log('⛔ La columna vehicles.gps_odometer no existe: el código nuevo del sync del GPS');
      console.log('   todavía no está desplegado. Con el sync viejo, el GPS volvería a subir el km');
      console.log('   a los dos minutos. Desplegá primero y volvé a correr esto.\n');
      process.exitCode = 1;
      return;
    }

    const valores = leerArgs();
    await client.query('BEGIN');
    let hechas = 0;

    for (const [patente, kmTablero] of Object.entries(valores)) {
      if (!(kmTablero > 0)) { console.log(`   ⚠ ${patente}: km inválido (${kmTablero}) — salteada`); continue; }

      const v = await client.query(
        `SELECT id, code, plate, km_current, gps_odometer, gps_updated_at
           FROM vehicles
          WHERE UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) = $1
             OR UPPER(REGEXP_REPLACE(COALESCE(code,''), '[^A-Z0-9]', '', 'g')) = $1`,
        [patente.replace(/[^A-Za-z0-9]/g, '').toUpperCase()]);
      if (!v.rows[0]) { console.log(`   ⚠ ${patente}: no existe en FleetOS — salteada`); continue; }
      const veh = v.rows[0];
      const antes = veh.km_current == null ? null : Number(veh.km_current);

      const ult = await client.query(
        `SELECT odometer_km, logged_at FROM fuel_logs
          WHERE vehicle_id=$1 AND odometer_km>0 AND COALESCE(LOWER(fuel_type),'')<>'urea'
          ORDER BY logged_at DESC LIMIT 1`, [veh.id]);

      console.log(`   ${patente}`);
      console.log(`      km_current:      ${antes == null ? '(sin dato)' : km(antes)}  →  ${km(kmTablero)}`);
      console.log(`      odómetro GPS:    ${veh.gps_odometer == null ? '(todavía sin lectura)' : km(Math.round(veh.gps_odometer)) + ' (origen propio, no es el tablero)'}`);
      if (ult.rows[0]) console.log(`      último ticket:   ${km(ult.rows[0].odometer_km)} (${String(ult.rows[0].logged_at).slice(0, 10)})`);

      if (antes === kmTablero) { console.log(`      ↩️  ya estaba en ese valor — nada que hacer`); continue; }

      await client.query('UPDATE vehicles SET km_current=$1 WHERE id=$2', [kmTablero, veh.id]);
      await client.query(
        `INSERT INTO audit_log (user_id, user_name, action, table_name, record_id, old_value, new_value)
         VALUES (NULL, $1, 'km_update', 'vehicles', $2, $3, $4)`,
        ['script fijar-km-unidades',
         veh.id,
         JSON.stringify({ km_current: antes, origen: 'script', motivo: 'km del tablero (Agustín, 08/09/2026)' }),
         JSON.stringify({ km_current: kmTablero })]);
      hechas++;

      // Planes por km cuya línea de base quedó por encima del tablero: no se
      // corrigen solos, porque no hay forma de saber cuál era el km real del
      // último service. Se avisan.
      const planes = await client.query(
        `SELECT nombre, ultimo_valor FROM maintenance_schedules
          WHERE vehicle_id=$1 AND activo AND tipo='km' AND ultimo_valor > $2`, [veh.id, kmTablero]);
      for (const p of planes.rows)
        console.log(`      ⚠ plan "${p.nombre}": último service en ${km(p.ultimo_valor)}, mayor que el tablero — revisar a mano`);
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log(`\n✅ ${hechas} unidad(es) corregida(s). El GPS sigue sumando desde estos valores.\n`);
    } else {
      await client.query('ROLLBACK');
      console.log(`\n🔎 SIMULACIÓN: ${hechas} unidad(es) a corregir, no se guardó nada. Si está OK, corré con --apply.\n`);
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
