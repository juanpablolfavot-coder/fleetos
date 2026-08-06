#!/usr/bin/env node
/**
 * Inserta las cargas de gasoil del 01-04/06/2026 que quedaron SIN TIPEAR.
 * ────────────────────────────────────────────────────────────────────────────
 * Las planillas físicas (páginas 30/05-02/06 y 02-06/06) registran ~24 cargas
 * de camiones fechadas 01-04/06. El lote que se tipeó en bloque el 05-06/06
 * solo cubrió las cargas de esos dos días, y las anteriores quedaron en papel:
 * el chequeo en base encontró apenas 1 carga (AH327AU, 70 L) para ese rango.
 * Son 23 cargas por 8.047 L (~$17,6M) de consumo real de junio.
 *
 * Criterios:
 *  · PRECIO: $2.183/L — el precio de cisterna vigente en el lote del 05-06/06
 *    (primer precio conocido de junio). Queda anotado en notes.
 *  · STOCK: NO se descuenta de la cisterna. Ese gasoil salió físicamente en
 *    junio; descontarlo hoy desajustaría el stock actual. La diferencia se
 *    reconcilia aparte con una medición física (varilla) + ajuste manual.
 *  · KM: el odómetro de cada carga es el de la planilla; las secuencias encajan
 *    entre las lecturas ya corregidas (verificado). No se toca km_current.
 *  · UREA de esos días: NO se incluye acá (menor cuantía); puede agregarse
 *    después si se quiere el detalle completo.
 *  · IDEMPOTENTE: dedup por unidad + fecha (±1 día) + litros (±2) — la carga
 *    de AH327AU del 04/06 que ya existe se saltea sola.
 *
 * Uso (Shell de Render):
 *   node scripts/cargar-junio-faltantes.js            → SIMULACIÓN (no toca nada)
 *   node scripts/cargar-junio-faltantes.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');
const PPU = 2183; // $/L — precio de cisterna del lote 05-06/06 (ver encabezado)

// { unidad, fecha (planilla), km, litros }
const CARGAS = [
  ['AH462JI','2026-06-01 10:00', 132944, 340],
  ['AD644VD','2026-06-01 10:01', 676569, 473],
  ['AD235FE','2026-06-01 10:02',1157984, 100],
  ['AH327SB','2026-06-02 10:00', 172950, 460],
  ['AH327RZ','2026-06-02 10:01', 169603, 439],
  ['AF614LB','2026-06-02 10:02', 536824, 450],
  ['AH035AO','2026-06-02 10:03',  54877, 107],
  ['AG470AG','2026-06-02 10:04', 171656,  68],
  ['AH035AN','2026-06-02 10:05',  62359, 120],
  ['AF823RB','2026-06-02 10:06', 118051,  30],
  ['AF931PD','2026-06-03 10:00', 477657, 622],
  ['AH327SG','2026-06-03 10:01', 157106, 525],
  ['AD235FE','2026-06-03 10:02',1159009, 601],
  ['AH462JI','2026-06-03 10:03', 134431, 500],
  ['AH327AU','2026-06-03 10:04',  66521, 164],
  ['AF614LB','2026-06-03 10:05', 537596, 239],
  ['AD644VD','2026-06-04 10:00', 678435, 601],
  ['AG468LQ','2026-06-04 10:01', 353288, 554],
  ['AH327SA','2026-06-04 10:02', 162231, 510],
  ['AH327RZ','2026-06-04 10:03', 171108, 509],
  ['AG470AG','2026-06-04 10:04', 172260, 142],
  ['AH327SB','2026-06-04 10:05', 174560, 493],
  ['AH327AU','2026-06-04 10:06',  66758,  70], // ya está en el sistema (71 L) → dedup la saltea
];

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);

    const t = await client.query(
      `SELECT id, location FROM tanks WHERE type='fuel' AND active IS DISTINCT FROM FALSE
        ORDER BY (location ILIKE '%R3%') DESC, capacity_l DESC NULLS LAST LIMIT 1`);
    if (!t.rows[0]) { console.log('No se encontró cisterna de gasoil activa.'); return; }
    const tank = t.rows[0];
    console.log(`Cisterna: ${tank.location} (NO se descuenta stock — carga histórica de junio)\n`);

    const u = await client.query(`SELECT id, name FROM users WHERE role IN ('dueno','gerencia') ORDER BY (role='dueno') DESC, created_at LIMIT 1`);
    const registraId = u.rows[0]?.id || null;

    await client.query('BEGIN');
    let ok = 0, skip = 0, err = 0, litrosOk = 0;
    for (const [code, fecha, km, litros] of CARGAS) {
      const v = await client.query('SELECT id, driver_name FROM vehicles WHERE code=$1 OR plate=$1', [code]);
      if (!v.rows[0]) { console.log(`   ❌ ${code}: vehículo no encontrado`); err++; continue; }
      const dup = await client.query(
        `SELECT id FROM fuel_logs
          WHERE vehicle_id=$1 AND COALESCE(LOWER(fuel_type),'') <> 'urea'
            AND ABS(liters - $2) <= 2
            AND logged_at BETWEEN $3::timestamptz - INTERVAL '1 day' AND $3::timestamptz + INTERVAL '1 day'
          LIMIT 1`, [v.rows[0].id, litros, fecha]);
      if (dup.rows[0]) { console.log(`   ↩️  ${code} ${fecha.slice(0,10)} ${litros} L: ya existe — salteada`); skip++; continue; }

      console.log(`   ✔️  ${code} ${fecha.slice(0,10)} · ${litros} L × $${PPU} · ${km.toLocaleString('es-AR')} km`);
      ok++; litrosOk += litros;
      if (!APPLY) continue;
      await client.query(
        `INSERT INTO fuel_logs (vehicle_id, driver_id, driver_name, tank_id, fuel_type, liters, price_per_l,
                                odometer_km, location, notes, ticket_image, ticket_estado, logged_at)
         VALUES ($1,$2,$3,$4,'diesel',$5,$6,$7,$8,$9,NULL,'papel',$10::timestamptz)`,
        [v.rows[0].id, registraId, v.rows[0].driver_name || null, tank.id, litros, PPU, km, tank.location,
         'Planilla cisterna 01-04/06 · carga histórica sin tipear (script, precio del lote 05-06/06, sin descuento de stock)', fecha]);
    }

    console.log(`\nResumen: ${ok} ${APPLY ? 'insertadas' : 'a insertar'} (${litrosOk.toLocaleString('es-AR')} L · $${(litrosOk*PPU).toLocaleString('es-AR')}) · ${skip} salteadas · ${err} con error.`);
    if (APPLY) { await client.query('COMMIT'); console.log('\n✅ Cargas históricas insertadas. Recordar: reconciliar stock de cisterna con varilla física + ajuste manual.\n'); }
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
