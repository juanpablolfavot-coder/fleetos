#!/usr/bin/env node
/**
 * Punto de partida del odómetro al 31/07/2026, para que AGOSTO quede completo.
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA
 * El km de un mes se calcula restando dos fotas del odómetro: la del último día
 * del mes y la del último día del mes anterior. Como las fotas arrancan recién
 * ahora, no existe la del 31/07 y agosto quedaría medido solo desde el día que
 * arrancó el servicio (parcial).
 *
 * LA SOLUCIÓN
 * Calcular esa foto faltante hacia atrás:
 *
 *     odómetro al 31/07  =  odómetro de la PRIMERA foto  −  km recorridos
 *                           desde el 01/08 hasta esa primera foto
 *
 * Los km del 01/08 en adelante salen del "Información de viajes" de Powerfleet.
 * Con esa fila sembrada, agosto se consolida completo igual que cualquier otro
 * mes, sin ningún caso especial.
 *
 * PRECISIÓN — IMPORTANTE
 * El informe cargado abajo cubre 01/08 21:56 → 05/08 21:56. Si la primera foto
 * se toma después, faltan esas horas y el punto de partida queda un poco alto,
 * o sea agosto quedaría corto por lo que se haya recorrido en el hueco.
 * Para que sea EXACTO: exportar de nuevo "Información de viajes" con el rango
 * 01/08 00:00 → (fecha y hora de la primera foto) y reemplazar la tabla KM_AGO
 * con esos valores. El script avisa del hueco al correrse.
 *
 * Uso (Shell de Render, DESPUÉS de que se haya tomado la primera foto):
 *   node scripts/seed-odometro-baseline.js            → SIMULACIÓN
 *   node scripts/seed-odometro-baseline.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const { ensureTablas, consolidarMes } = require('../services/gps-odometro');
const APPLY = process.argv.includes('--apply');
const num = n => Math.round(Number(n) || 0).toLocaleString('es-AR');

// Km por unidad según "Información de viajes" de Powerfleet.
// Cobertura del informe usado: 01/08/2026 21:56 → 05/08/2026 21:56 (total 20.032 km).
const COBERTURA = { desde: '2026-08-01 21:56', hasta: '2026-08-05 21:56' };
const KM_AGO = {
  AA147OT:  110, AA508SW:  337, AD235FE: 1138, AD644VD: 1436, AE517UM:  426,
  AE919NN:  224, AF041MB:  520, AF159UC:  468, AF614LB:  617, AF823RB:  182,
  AF931PD: 1329, AG468LK:  183, AG468LQ: 1917, AG470AG:  753, AH035AN:  428,
  AH035AO:  527, AH327AU:  741, AH327CF:  361, AH327RZ: 2289, AH327SA: 1409,
  AH327SB: 2026, AH327SG:  327, AH462JI: 2284,
};
const BASELINE = '2026-07-31';   // fecha con la que se guarda la foto calculada

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);
    await ensureTablas();

    // Primera foto de cada unidad (la que sirve de referencia para restar).
    const primeras = await client.query(`
      SELECT DISTINCT ON (o.vehicle_id)
             o.vehicle_id, o.fecha, o.odometro_km,
             UPPER(COALESCE(v.plate, v.code)) AS patente
        FROM vehicle_gps_odometro o
        JOIN vehicles v ON v.id = o.vehicle_id
       ORDER BY o.vehicle_id, o.fecha ASC`);

    if (!primeras.rows.length) {
      console.log('Todavía no hay ninguna foto de odómetro guardada.');
      console.log('El servicio toma la primera al minuto de arrancar y después revisa cada hora.');
      console.log('Esperá a que corra (o mirá el log por "[GPS-ODO] Foto") y volvé a correr esto.\n');
      return;
    }

    const fechaFoto = primeras.rows[0].fecha.toISOString ? primeras.rows[0].fecha.toISOString().slice(0, 10) : String(primeras.rows[0].fecha).slice(0, 10);
    console.log(`Primera foto guardada: ${fechaFoto} · ${primeras.rows.length} unidades`);
    console.log(`Informe de viajes usado: ${COBERTURA.desde} → ${COBERTURA.hasta}`);
    if (fechaFoto > COBERTURA.hasta.slice(0, 10)) {
      console.log(`\n⚠ HUECO: la foto es del ${fechaFoto} y el informe llega al ${COBERTURA.hasta.slice(0,10)}.`);
      console.log(`  Los km de ese hueco no están contemplados y agosto quedará corto por esa diferencia.`);
      console.log(`  Para que sea exacto: exportar "Información de viajes" 01/08 00:00 → ${fechaFoto}`);
      console.log(`  y reemplazar la tabla KM_AGO de este script con esos valores.`);
    }
    console.log('');

    await client.query('BEGIN');
    let ok = 0, sinDato = [];
    for (const r of primeras.rows) {
      const km = KM_AGO[r.patente];
      if (km === undefined) { sinDato.push(r.patente); continue; }
      const odoInicial = parseFloat(r.odometro_km) - km;
      if (!(odoInicial > 0)) { console.log(`   ⚠ ${r.patente}: el cálculo da ${num(odoInicial)} — se saltea`); continue; }
      console.log(`   ${r.patente.padEnd(9)} foto ${num(r.odometro_km).padStart(9)} − ${num(km).padStart(5)} km = ${num(odoInicial).padStart(9)} al ${BASELINE}`);
      await client.query(
        `INSERT INTO vehicle_gps_odometro (vehicle_id, fecha, odometro_km)
         VALUES ($1,$2::date,$3)
         ON CONFLICT (vehicle_id, fecha) DO UPDATE SET odometro_km = EXCLUDED.odometro_km, capturado_at = NOW()`,
        [r.vehicle_id, BASELINE, odoInicial]);
      ok++;
    }
    if (sinDato.length) console.log(`\n   Sin km en el informe (no se siembran): ${sinDato.join(', ')}`);
    console.log(`\n   ${ok} punto(s) de partida ${APPLY ? 'guardados' : 'a guardar'} con fecha ${BASELINE}.`);

    if (APPLY) {
      await client.query('COMMIT');
      const c = await consolidarMes('2026-08');
      console.log(`\n✅ Listo. Agosto consolidado para ${c.unidades} unidades (se recalcula solo cada día).\n`);
    } else {
      await client.query('ROLLBACK');
      console.log('\n🔎 SIMULACIÓN: no se guardó nada. Si está OK, corré con --apply.\n');
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
