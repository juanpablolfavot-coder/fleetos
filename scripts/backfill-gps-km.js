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
 * ATENCIÓN — junio queda PARCIAL: el informe disponible arranca el 05/06, así
 * que faltan los días 1 al 4. Se guarda con su cobertura real (campos desde y
 * hasta) para que quede explícito y no se lea como un mes completo. Para
 * cerrarlo basta exportar del GPS el rango 01→04/06 y sumarlo.
 *
 * Uso (Shell de Render):
 *   node scripts/backfill-gps-km.js            → SIMULACIÓN (no toca nada)
 *   node scripts/backfill-gps-km.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const { ensureTablas } = require('../services/gps-odometro');
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

const PERIODOS = [
  { periodo: '2026-06', idx: 0, desde: '2026-06-05', hasta: '2026-06-30',
    nota: 'Informe de actividades GPS Powerfleet. PARCIAL: cobertura 05→30/06 (faltan 01→04/06).', esperado: 143633 },
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
      for (const [pat, kms] of Object.entries(KM)) {
        const km = kms[P.idx];
        const id = porPat.get(pat);
        if (!id) { faltan.push(pat); continue; }
        if (!(km > 0)) continue;                       // sin actividad ese mes: no se guarda
        suma += km; ok++;
        await client.query(
          `INSERT INTO vehicle_gps_km (vehicle_id, periodo, km, fuente, desde, hasta, notas, updated_at)
           VALUES ($1,$2,$3,'informe',$4::date,$5::date,$6,NOW())
           ON CONFLICT (vehicle_id, periodo) DO UPDATE
             SET km=EXCLUDED.km, fuente='informe', desde=EXCLUDED.desde,
                 hasta=EXCLUDED.hasta, notas=EXCLUDED.notas, updated_at=NOW()`,
          [id, P.periodo, km, P.desde, P.hasta, P.nota]);
      }
      const dif = suma - P.esperado;
      console.log(`${P.periodo}: ${ok} unidades · ${num(suma)} km` +
        `  (informe: ${num(P.esperado)} km${dif === 0 ? ' ✓ reconcilia' : ` ⚠ difiere ${num(dif)}`})`);
      console.log(`   cobertura ${P.desde} → ${P.hasta}${P.periodo === '2026-06' ? '  ⚠ PARCIAL (faltan 01→04/06)' : ''}`);
      if (faltan.length) console.log(`   ⚠ sin vehículo en FleetOS: ${faltan.join(', ')}`);
    }

    if (APPLY) { await client.query('COMMIT'); console.log('\n✅ Km del GPS cargados.\n'); }
    else { await client.query('ROLLBACK'); console.log('\n🔎 SIMULACIÓN: no se guardó nada. Si está OK, corré con --apply.\n'); }

    console.log('Notas:');
    console.log(' · Agosto en adelante se completa solo con la foto diaria del odómetro.');
    console.log(' · Para cerrar junio: exportar del GPS el rango 01→04/06 y sumar esos km.\n');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
