#!/usr/bin/env node
/**
 * Corrige 3 lecturas de odómetro de AD235FE con los valores REALES de las
 * planillas físicas de la cisterna ("Control Despacho de Combustible").
 * ────────────────────────────────────────────────────────────────────────────
 * Origen del error: hasta ~el 20/06 la app autocompletaba el odómetro con un km
 * viejo del sistema (bug ya eliminado), y el 15/07 hubo un typo de tipeo (3↔5).
 * La auditoría externa de AD235FE detectó por esto tramos imposibles
 * (+9.439, +3.318 y −1.486 km). Con estos 3 valores del papel, la serie de
 * odómetros queda estrictamente creciente y los tramos pasan a ser normales.
 *
 *   12/06: 1.152.908 → 1.160.918   (planilla)
 *   17/06: 1.154.378 → 1.162.413   (planilla)
 *   15/07: 1.175.398 → 1.173.598   (planilla)
 *
 * La lectura del 05/06 (1.152.560) queda como está: su página de planilla no
 * está disponible; se documenta que pertenece a la era del autocompletado y el
 * km real de junio lo da el GPS.
 *
 * Uso (Shell de Render):
 *   node scripts/corregir-km-ad235fe.js            → SIMULACIÓN (no toca nada)
 *   node scripts/corregir-km-ad235fe.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');
const PLATE = 'AD235FE';
const km = n => Number(n).toLocaleString('es-AR') + ' km';

const FIXES = [
  { fecha: '2026-06-12', mal: 1152908, bien: 1160918 },
  { fecha: '2026-06-17', mal: 1154378, bien: 1162413 },
  { fecha: '2026-07-15', mal: 1175398, bien: 1173598 },
];

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);

    const v = await client.query('SELECT id, km_current FROM vehicles WHERE code=$1 OR plate=$1', [PLATE]);
    if (!v.rows[0]) { console.log(`Vehículo ${PLATE} no encontrado.`); return; }
    const vehId = v.rows[0].id;

    await client.query('BEGIN');
    let hechas = 0;
    for (const f of FIXES) {
      const r = await client.query(
        `UPDATE fuel_logs SET odometer_km=$1
          WHERE vehicle_id=$2 AND odometer_km=$3
            AND DATE(logged_at AT TIME ZONE 'America/Argentina/Buenos_Aires')=$4::date
          RETURNING id`,
        [f.bien, vehId, f.mal, f.fecha]);
      if (r.rowCount) { hechas += r.rowCount; console.log(`   ✔️  ${f.fecha}: ${km(f.mal)} → ${km(f.bien)}`); }
      else console.log(`   ↩️  ${f.fecha}: no hay lectura con ${km(f.mal)} — salteada (¿ya corregida?)`);
    }

    // Verificación: la serie debe quedar estrictamente creciente.
    const serie = await client.query(
      `SELECT odometer_km FROM fuel_logs
        WHERE vehicle_id=$1 AND odometer_km>0 AND COALESCE(LOWER(fuel_type),'')<>'urea'
        ORDER BY logged_at, id`, [vehId]);
    let retrocesos = 0;
    for (let i = 1; i < serie.rows.length; i++)
      if (serie.rows[i].odometer_km < serie.rows[i - 1].odometer_km) retrocesos++;
    console.log(`\n   Serie de odómetros tras la corrección: ${serie.rows.length} lecturas · retrocesos restantes: ${retrocesos}${retrocesos === 0 ? ' ✓' : ' ⚠ revisar'}`);

    if (APPLY) { await client.query('COMMIT'); console.log(`\n✅ ${hechas} lectura(s) corregida(s).\n`); }
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
