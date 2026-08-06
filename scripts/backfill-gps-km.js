#!/usr/bin/env node
/**
 * Carga los km del GPS por unidad y por mes para junio y julio 2026.
 * ────────────────────────────────────────────────────────────────────────────
 * De acá en adelante los km del mes salen de la foto diaria del odómetro
 * (services/gps-odometro.js). Para los meses ya pasados no hay fotas diarias, así
 * que se cargan desde un informe de Powerfleet.
 *
 * FUENTE: tres exportaciones de "Información de viajes" de Powerfleet, que juntas
 * cubren junio y julio completos sin huecos ni superposición:
 *
 *     01/06 00:00 → 05/06 23:37   40.360 km   (se usan sólo los días 01 a 04)
 *     05/06       → 30/06        138.737 km
 *     01/07       → 31/07        181.411 km
 *
 * Las tres reconcilian: en cada una, cada unidad cierra viaje por viaje en
 * cantidad de viajes y en km contra su propio resumen, y la suma de las unidades
 * da el "Distancia Total" que el informe declara. El corte entre la primera y la
 * segunda se hace por fecha de INICIO de cada viaje, así el día 05 se cuenta una
 * sola vez.
 *
 *   junio  173.351 km (27 unidades)
 *   julio  181.411 km (26 unidades)
 *
 * ─── POR QUÉ CAMBIARON LOS NÚMEROS ──────────────────────────────────────────
 * Antes esto se cargaba del "Informe de actividades" (junio 143.633 parcial 05→30,
 * julio 169.267). Los dos informes son de Powerfleet pero NO miden igual:
 *
 *     junio 05→30    actividades 143.633   viajes 138.737   −4.896  (−3,4%)
 *     julio          actividades 169.267   viajes 181.411  +12.144  (+7,2%)
 *
 * En junio la diferencia es de ±17 km en casi todas las unidades (redondeo diario)
 * con seis camiones de larga distancia bastante por debajo; en julio, en cambio,
 * el de actividades queda sistemáticamente por debajo en TODAS. Un informe que
 * cambia de comportamiento entre dos meses no sirve para comparar meses, que es
 * justamente para lo que se usa este número.
 *
 * Por eso ahora los dos meses salen de la misma fuente, medidos igual. El de
 * viajes se puede auditar hasta el último renglón (cada viaje con su hora de
 * inicio, fin y distancia) y cierra solo; el de actividades da un total por día
 * ya agregado, que no se puede verificar por dentro.
 *
 * CONSECUENCIA: julio pasa de 169.267 a 181.411 km y junio de 178.191 a 173.351.
 * O sea que julio hizo 4,6% MÁS km que junio, no menos. No cambia la conclusión
 * de fondo —los dos meses tuvieron actividad pareja y no hay faltante de gasoil—
 * pero sí mejora el rendimiento de julio, que estaba calculado con km de menos.
 *
 * De septiembre en adelante nada de esto hace falta: el mes se mide de foto de
 * odómetro de fin de mes a foto de fin de mes, sin informes de por medio.
 *
 * Uso (Shell de Render):
 *   node scripts/backfill-gps-km.js            → SIMULACIÓN (no toca nada)
 *   node scripts/backfill-gps-km.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const { ensureTablas, actualizarLitros } = require('../services/gps-odometro');
const APPLY = process.argv.includes('--apply');
const num = n => Math.round(Number(n) || 0).toLocaleString('es-AR');

// patente → [ km junio (mes completo), km julio (mes completo) ]
// Junio = días 01→04 del primer informe + el segundo informe entero (05→30).
const KM = {
  AA147OT: [ 1230,  1203], AA508SW: [ 2829,  3543], AB120EF: [   84,     0],
  AB902MF: [ 2465,  3426], AD225WO: [ 3881,  4228], AD235FE: [10376, 12294],
  AD644VD: [12695, 14018], AE517UM: [ 3192,  2869], AE919NN: [ 1821,  1476],
  AF041MB: [ 3775,  3623], AF159UC: [ 4608,  4541], AF614LB: [13568, 10180],
  AF823RB: [ 3935,  3350], AF931PD: [12483, 11961], AG468LK: [ 1675,  1951],
  AG468LQ: [11825, 12010], AG470AG: [ 6168,  6217], AH035AN: [ 4353,  4574],
  AH035AO: [ 4359,  4439], AH327AU: [ 5596,  6026], AH327CF: [ 3304,  3657],
  AH327RZ: [12104, 13006], AH327SA: [12850, 13995], AH327SB: [ 9337, 12024],
  AH327SG: [11711, 13075], AH462JI: [12669, 13087], OBE019:  [  458,   638],
};

const NOTA = 'GPS Powerfleet, informe "Información de viajes" (viaje por viaje). Mes completo.';
const PERIODOS = [
  { periodo: '2026-06', idx: 0, desde: '2026-06-01', hasta: '2026-06-30',
    nota: NOTA + ' Junio arma con dos exportaciones: días 01→04 de la del 01/06 y 05→30 de la del 05/06.',
    esperado: 173351 },
  { periodo: '2026-07', idx: 1, desde: '2026-07-01', hasta: '2026-07-31',
    nota: NOTA, esperado: 181411 },
];

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);
    await ensureTablas();

    // Mapa patente/código → vehicle_id
    const vs = await client.query('SELECT id, UPPER(COALESCE(plate,code)) AS pat, UPPER(COALESCE(code,plate)) AS cod FROM vehicles');
    const porPat = new Map();
    vs.rows.forEach(v => { porPat.set(v.pat, v.id); porPat.set(v.cod, v.id); });

    await client.query('BEGIN');
    for (const P of PERIODOS) {
      let ok = 0, faltan = [], suma = 0;
      const sinCargas = [];   // km del GPS pero sin combustible registrado en FleetOS
      for (const [pat, kms] of Object.entries(KM)) {
        const km = kms[P.idx];
        const id = porPat.get(pat);
        if (!id) { faltan.push(pat); continue; }
        if (!(km > 0)) continue;                       // sin actividad ese mes: no se guarda
        suma += km; ok++;
        // ¿Esta unidad registró combustible ese mes? Si no (hoy Córdoba y Rosario),
        // su km NO puede entrar al rendimiento: daría km sin litros.
        const lt = await client.query(
          `SELECT COALESCE(SUM(liters),0) l FROM fuel_logs
            WHERE vehicle_id=$1 AND COALESCE(LOWER(fuel_type),'') <> 'urea'
              AND TO_CHAR(logged_at AT TIME ZONE 'America/Argentina/Buenos_Aires','YYYY-MM')=$2`,
          [id, P.periodo]);
        if (!(parseFloat(lt.rows[0].l) > 0)) sinCargas.push([pat, km]);
        await client.query(
          `INSERT INTO vehicle_gps_km (vehicle_id, periodo, km, fuente, desde, hasta, notas, updated_at)
           VALUES ($1,$2,$3,'informe',$4::date,$5::date,$6,NOW())
           ON CONFLICT (vehicle_id, periodo) DO UPDATE
             SET km=EXCLUDED.km, fuente='informe', desde=EXCLUDED.desde,
                 hasta=EXCLUDED.hasta, notas=EXCLUDED.notas, updated_at=NOW()`,
          [id, P.periodo, km, P.desde, P.hasta, P.nota]);
      }
      await actualizarLitros(P.periodo);
      const conCargas = suma - sinCargas.reduce((a, [, k]) => a + k, 0);
      const dif = suma - P.esperado;
      console.log(`${P.periodo}: ${ok} unidades · ${num(suma)} km` +
        `  (informe: ${num(P.esperado)} km${dif === 0 ? ' ✓ reconcilia' : ` ⚠ difiere ${num(dif)}`})`);
      console.log(`   cobertura ${P.desde} → ${P.hasta}  ✓ mes completo`);
      if (faltan.length) console.log(`   ⚠ sin vehículo en FleetOS: ${faltan.join(', ')}`);
      if (sinCargas.length) {
        console.log(`   ⚠ ${sinCargas.length} unidad(es) con km del GPS pero SIN combustible registrado ese mes:`);
        sinCargas.forEach(([p, k]) => console.log(`        ${p.padEnd(9)} ${num(k).padStart(7)} km`));
        console.log(`     → su km se guarda igual (sirve para utilización), pero NO debe entrar al`);
        console.log(`       rendimiento: sin litros, el km/L de la flota daría falsamente bueno.`);
      }
      console.log(`   Km para rendimiento (unidades que sí registran combustible): ${num(conCargas)} km`);
    }

    if (APPLY) { await client.query('COMMIT'); console.log('\n✅ Km del GPS cargados.\n'); }
    else { await client.query('ROLLBACK'); console.log('\n🔎 SIMULACIÓN: no se guardó nada. Si está OK, corré con --apply.\n'); }

    console.log('Notas:');
    console.log(' · Junio y julio quedan completos y medidos con la MISMA vara: el informe');
    console.log('   "Información de viajes" de Powerfleet, que se audita viaje por viaje.');
    console.log(' · Reemplaza los números del "Informe de actividades" que se habían cargado antes');
    console.log('   (junio 143.633 parcial, julio 169.267). Ese informe medía distinto en cada mes,');
    console.log('   así que no servía para comparar un mes contra otro.');
    console.log(' · Agosto en adelante se completa solo con la foto diaria del odómetro.\n');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
