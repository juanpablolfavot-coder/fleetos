#!/usr/bin/env node
/**
 * Carga los km del GPS por unidad y por mes para junio y julio 2026.
 * ────────────────────────────────────────────────────────────────────────────
 * De acá en adelante los km del mes salen de la foto diaria del odómetro
 * (services/gps-odometro.js). Para los meses ya pasados no hay fotas diarias,
 * así que se cargan desde el "Informe de actividades" de Powerfleet — el mismo
 * que se venía usando a mano para auditar.
 *
 * FUENTE de estos números: informe de actividades Powerfleet del 05/06 al
 * 31/07/2026 (distancia por unidad y por día, agregada por mes). Los totales
 * reconcilian con el propio informe: junio 143.633 km (cobertura 05→30/06) y
 * julio 169.267 km (mes completo).
 *
 * JUNIO 01→04: ese informe arrancaba el 05/06, así que junio quedó parcial. Los
 * cuatro días que faltaban salen de un segundo informe —"Información de viajes"
 * del 01/06 00:00 al 05/06 23:37— del que se tomó SOLO lo de los días 1 a 4
 * (viaje por viaje, según la fecha de inicio de cada viaje), para no pisar el 05
 * que ya venía contado en el primero. Ese informe reconcilia perfecto: sus 27
 * unidades cierran una por una en cantidad de viajes y en km contra su propio
 * resumen, y el total da los 40.360 km que declara.
 *
 * Los dos tramos se guardan por separado abajo y se suman acá, para que se pueda
 * auditar de dónde sale cada parte. Con eso junio queda COMPLETO: 178.191 km.
 *
 * OJO — dos informes distintos: el grueso de junio viene del "Informe de
 * actividades" y los cuatro primeros días de "Información de viajes". Son dos
 * formas de medir de Powerfleet y no tienen por qué dar idéntico. Si se quiere
 * junio medido con una sola vara, hay que re-exportar el de actividades desde el
 * 01/06 y reemplazar la columna de junio entera.
 *
 * Uso (Shell de Render):
 *   node scripts/backfill-gps-km.js            → SIMULACIÓN (no toca nada)
 *   node scripts/backfill-gps-km.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const { ensureTablas, actualizarLitros } = require('../services/gps-odometro');
const APPLY = process.argv.includes('--apply');
const num = n => Math.round(Number(n) || 0).toLocaleString('es-AR');

// patente → { '2026-06': km (05→30/06), '2026-07': km (mes completo) }
const KM = {
  AA147OT: [  972,  1086], AA508SW: [ 2116,  3305], AB120EF: [   78,     0],
  AB902MF: [ 2385,  3187], AD225WO: [ 3177,  3790], AD235FE: [ 7402, 11226],
  AD644VD: [10906, 12555], AE517UM: [ 2722,  2669], AE919NN: [ 1549,  1264],
  AF041MB: [ 3009,  3260], AF159UC: [ 3701,  4287], AF614LB: [11883,  9491],
  AF823RB: [ 3124,  2181], AF931PD: [10186, 10340], AG468LK: [ 1326,  1812],
  AG468LQ: [10342, 11058], AG470AG: [ 4969,  5868], AH035AN: [ 3537,  4268],
  AH035AO: [ 3552,  4214], AH327AU: [ 4502,  5817], AH327CF: [ 2643,  3388],
  AH327RZ: [ 9828, 12249], AH327SA: [10586, 12715], AH327SB: [ 6994, 11319],
  AH327SG: [ 9904, 12487], AH462JI: [12240, 15431],
};

// Junio 01→04, del informe "Información de viajes" (01/06 00:00 → 05/06 23:37),
// contando sólo los viajes iniciados los días 1 a 4. Suma 34.614 km sobre 27
// unidades; los 5.746 km restantes del informe son del día 5, que ya viene
// contado arriba y por eso NO se toca.
const KM_JUN_1A4 = {
  AA147OT:  240, AA508SW:  696, AB120EF:    4, AB902MF:   65, AD225WO:  686,
  AD235FE: 2992, AD644VD: 2650, AE517UM:  453, AE919NN:  255, AF041MB:  749,
  AF159UC:  889, AF614LB: 1714, AF823RB:  789, AF931PD: 2625, AG468LK:  332,
  AG468LQ: 1832, AG470AG: 1181, AH035AN:  799, AH035AO:  790, AH327AU: 1077,
  AH327CF:  644, AH327RZ: 2976, AH327SA: 2858, AH327SB: 2339, AH327SG: 2064,
  AH462JI: 2859,
  // OBE019 hizo 56 km del 1 al 4, pero no figura en el informe de actividades que
  // cubre el resto de junio: cargarlo con esos 56 daría un junio incompleto para
  // esa unidad. Queda afuera hasta tener su mes entero. (En agosto sí está.)
};

const PERIODOS = [
  { periodo: '2026-06', idx: 0, extra: KM_JUN_1A4, desde: '2026-06-01', hasta: '2026-06-30',
    nota: 'GPS Powerfleet, mes completo: informe de actividades del 05 al 30/06 más "Información de viajes" para los días 01 al 04/06.',
    esperado: 143633 + 34614 - 56 },
  { periodo: '2026-07', idx: 1, desde: '2026-07-01', hasta: '2026-07-31',
    nota: 'Informe de actividades GPS Powerfleet. Mes completo.', esperado: 169267 },
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
        // El km del período es lo del informe base más, si corresponde, el tramo
        // que ese informe no cubría (hoy sólo junio 01→04). Se suma acá y no en la
        // tabla para que quede visible de dónde viene cada parte.
        const km = kms[P.idx] + ((P.extra && P.extra[pat]) || 0);
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
      if (P.extra) {
        const ex = Object.entries(P.extra).filter(([p]) => porPat.get(p)).reduce((a, [, k]) => a + k, 0);
        console.log(`   incluye ${num(ex)} km de los días 01→04/06 ("Información de viajes", viaje por viaje)`);
      }
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
    console.log(' · Agosto en adelante se completa solo con la foto diaria del odómetro.');
    console.log(' · Junio queda completo. El grueso sale del "Informe de actividades" y los días');
    console.log('   01→04 de "Información de viajes": son dos formas de medir de Powerfleet. Para');
    console.log('   junio medido con una sola vara, re-exportar actividades desde el 01/06.');
    console.log(' · OBE019 hizo 56 km del 01 al 04 pero no está en el informe del resto de junio:');
    console.log('   queda afuera del mes para no cargarlo incompleto.\n');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
