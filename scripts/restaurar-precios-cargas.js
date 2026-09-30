#!/usr/bin/env node
/**
 * Restaura el precio por litro de cargas de combustible que fueron pisadas por
 * "Corregir precios de cargas" (POST /api/fuel/reprice) SIN rango de fechas.
 * ────────────────────────────────────────────────────────────────────────────
 * Qué pasó: la corrección en bloque se aplicó a TODAS las cargas de la cisterna,
 * cuando solo había que corregir las de ayer y hoy. Las cargas viejas quedaron
 * con el precio nuevo en vez del que tenía la cisterna cuando se cargaron.
 *
 * Este script vuelve las cargas ANTERIORES a una fecha de corte a su precio
 * original. Las cargas desde esa fecha en adelante no se tocan (quedan con el
 * precio corregido). Dos formas de obtener el precio original:
 *
 *   A) --backup archivo.sql[.gz]   Lee un dump de pg_dump anterior a la
 *      corrección (el del email diario, o uno bajado con "Backup DB") y toma
 *      de ahí el price_per_l exacto de cada carga.  ← LA MÁS SEGURA.
 *
 *   B) --reconstruir   Sin backup: reconstruye qué precio tenía la cisterna en
 *      cada momento (ingresos a cisterna con precio + cambios de precio del
 *      tanque en audit_log) y le asigna a cada carga el precio vigente a su
 *      fecha. Si para alguna carga no hay dato, la deja como está y lo avisa.
 *
 * Uso (Shell de Render):
 *   node scripts/restaurar-precios-cargas.js --backup backup.sql.gz --hasta 2026-09-29
 *   node scripts/restaurar-precios-cargas.js --reconstruir --hasta 2026-09-29
 *     → SIMULACIÓN: muestra qué cambiaría, no toca nada.
 *   ... --apply   → EJECUTA.
 *
 *   --hasta YYYY-MM-DD   Fecha de corte (Argentina). Se restauran las cargas con
 *                        fecha ANTERIOR a ese día. Ej: si corregiste ayer y hoy,
 *                        poné la fecha de ayer.
 *   --tanque <uuid>      Opcional: limitar a una cisterna. Por defecto usa las
 *                        cisternas que aparecen en la auditoría de la corrección.
 */
const fs   = require('fs');
const zlib = require('zlib');
const { pool } = require('../db/pool');

const AR_TZ = 'America/Argentina/Buenos_Aires';
const args  = process.argv.slice(2);
const APPLY = args.includes('--apply');
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const BACKUP  = opt('--backup');
const RECON   = args.includes('--reconstruir');
const HASTA   = opt('--hasta');
const TANQUE  = opt('--tanque');

const money = n => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaAR = d => new Date(d).toLocaleString('es-AR', { timeZone: AR_TZ, hour12: false });

function fail(msg) { console.error('\n✗ ' + msg + '\n'); process.exit(1); }

if (!HASTA || !/^\d{4}-\d{2}-\d{2}$/.test(HASTA)) fail('Falta --hasta YYYY-MM-DD (fecha de corte; se restauran las cargas anteriores a ese día).');
if (!BACKUP && !RECON) fail('Indicá --backup <archivo.sql[.gz]> o --reconstruir.');

// ── A) Precios originales desde un dump de pg_dump (formato plano) ─────────
function preciosDesdeBackup(path) {
  if (!fs.existsSync(path)) fail('No existe el archivo ' + path);
  let raw = fs.readFileSync(path);
  if (path.endsWith('.gz')) raw = zlib.gunzipSync(raw);
  const text = raw.toString('utf8');
  // Sección: COPY public.fuel_logs (col1, col2, ...) FROM stdin;  ...filas...  \.
  const m = text.match(/COPY (?:public\.)?fuel_logs \(([^)]+)\) FROM stdin;\n([\s\S]*?)\n\\\.\n/);
  if (!m) fail('El dump no tiene la sección COPY de fuel_logs. ¿Es un backup de esta base en formato plano?');
  const cols = m[1].split(',').map(c => c.trim().replace(/"/g, ''));
  const iId = cols.indexOf('id'), iPpu = cols.indexOf('price_per_l'), iLog = cols.indexOf('logged_at');
  if (iId < 0 || iPpu < 0) fail('El COPY de fuel_logs no tiene columnas id/price_per_l.');
  const map = new Map();
  for (const line of m[2].split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    const ppu = f[iPpu];
    map.set(f[iId], { ppu: ppu === '\\N' ? null : parseFloat(ppu), logged_at: iLog >= 0 ? f[iLog] : null });
  }
  console.log(`📦 Backup leído: ${map.size} cargas en fuel_logs.`);
  return map;
}

// ── B) Reconstrucción: precio vigente de la cisterna en cada momento ────────
async function timelinePrecios(client, tankId) {
  // Eventos que cambian el precio del tanque, en orden cronológico:
  //  * ingresos a cisterna con precio (fuel_tank_entries.price_per_l)
  //  * PATCH /api/fuel/tanks/:id con price_per_l (audit_log global)
  //  * POST /api/fuel/tank-entries con price_per_l (audit_log global, sin record_id)
  const ev = [];
  const te = await client.query(`SELECT created_at AS at, price_per_l AS ppu FROM fuel_tank_entries WHERE tank_id=$1 AND price_per_l IS NOT NULL`, [tankId]);
  te.rows.forEach(r => ev.push({ at: new Date(r.at), ppu: parseFloat(r.ppu), src: 'ingreso a cisterna' }));
  const pa = await client.query(`
    SELECT created_at AS at, new_value->>'price_per_l' AS ppu
      FROM audit_log
     WHERE table_name='fuel' AND action='PATCH' AND record_id=$1
       AND new_value ? 'price_per_l' AND (new_value->>'price_per_l') ~ '^[0-9.]+$'`, [tankId]);
  pa.rows.forEach(r => ev.push({ at: new Date(r.at), ppu: parseFloat(r.ppu), src: 'editar cisterna' }));
  const po = await client.query(`
    SELECT created_at AS at, new_value->>'price_per_l' AS ppu
      FROM audit_log
     WHERE table_name='fuel' AND action='POST' AND new_value->>'tank_id'=$1
       AND new_value ? 'price_per_l' AND (new_value->>'price_per_l') ~ '^[0-9.]+$'`, [tankId]);
  po.rows.forEach(r => ev.push({ at: new Date(r.at), ppu: parseFloat(r.ppu), src: 'ingreso (auditoría)' }));
  ev.sort((a, b) => a.at - b.at);
  // Quitar repetidos consecutivos (mismo precio, misma fuente en segundos).
  return ev.filter(e => Number.isFinite(e.ppu) && e.ppu > 0);
}
function precioVigente(timeline, when) {
  let cur = null;
  for (const e of timeline) { if (e.at <= when) cur = e; else break; }
  return cur;
}

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}`);
    console.log(`   Corte: se restauran cargas ANTERIORES al ${HASTA} (hora Argentina)\n`);

    // Qué corrección(es) se aplicaron: auditoría de /api/fuel/reprice
    const rep = await client.query(`
      SELECT created_at, record_id AS tank_id, old_value, new_value, user_name
        FROM audit_log WHERE action='fuel_reprice' ORDER BY created_at DESC LIMIT 10`);
    if (!rep.rows.length) console.log('⚠ No hay registros de "fuel_reprice" en auditoría. Se usará --tanque si lo indicaste.');
    rep.rows.forEach(r => console.log(`• Corrección ${fechaAR(r.created_at)} por ${r.user_name}: cisterna ${r.old_value?.tank || r.tank_id} → ${money(r.new_value?.price_per_l)} (${r.new_value?.cargas_actualizadas} cargas, desde ${r.old_value?.from || 'inicio'} hasta ${r.old_value?.to || 'hoy'})`));

    const tankIds = TANQUE ? [TANQUE] : [...new Set(rep.rows.map(r => r.tank_id).filter(Boolean))];
    if (!tankIds.length) fail('No sé qué cisterna corregir: pasá --tanque <uuid>.');

    // Cargas candidatas: de esas cisternas, anteriores al corte.
    const cargas = await client.query(`
      SELECT fl.id, fl.tank_id, fl.liters, fl.price_per_l, fl.logged_at, v.code AS unidad, t.location AS cisterna
        FROM fuel_logs fl
        JOIN vehicles v ON v.id = fl.vehicle_id
        LEFT JOIN tanks t ON t.id = fl.tank_id
       WHERE fl.tank_id = ANY($1::uuid[])
         AND (fl.logged_at AT TIME ZONE '${AR_TZ}')::date < $2::date
       ORDER BY fl.logged_at`, [tankIds, HASTA]);
    console.log(`\n${cargas.rows.length} cargas anteriores al corte en ${tankIds.length} cisterna(s).\n`);

    let origen;
    const timelines = {};
    if (BACKUP) origen = preciosDesdeBackup(BACKUP);
    else {
      for (const id of tankIds) {
        timelines[id] = await timelinePrecios(client, id);
        console.log(`Historial de precio cisterna ${id}: ${timelines[id].length} cambios`);
        timelines[id].forEach(e => console.log(`   ${fechaAR(e.at)}  ${money(e.ppu)}  (${e.src})`));
      }
      console.log('');
    }

    const cambios = []; const sinDato = [];
    for (const c of cargas.rows) {
      let nuevo = null, fuente = '';
      if (BACKUP) {
        const b = origen.get(c.id);
        if (!b) { sinDato.push({ c, why: 'no está en el backup (¿backup anterior a la carga?)' }); continue; }
        nuevo = b.ppu; fuente = 'backup';
      } else {
        const e = precioVigente(timelines[c.tank_id] || [], new Date(c.logged_at));
        if (!e) { sinDato.push({ c, why: 'sin precio de cisterna conocido a esa fecha' }); continue; }
        nuevo = e.ppu; fuente = e.src;
      }
      const actual = c.price_per_l === null ? null : parseFloat(c.price_per_l);
      if (nuevo === actual || (nuevo === null && actual === null)) continue;
      cambios.push({ c, nuevo, fuente });
    }

    console.log(`Cambios a aplicar: ${cambios.length}   ·   Sin dato (no se tocan): ${sinDato.length}\n`);
    cambios.slice(0, 60).forEach(({ c, nuevo, fuente }) =>
      console.log(`  ${fechaAR(c.logged_at)}  ${String(c.unidad).padEnd(9)} ${String(Math.round(c.liters)).padStart(5)} L   ${money(c.price_per_l)} → ${money(nuevo)}   [${fuente}]`));
    if (cambios.length > 60) console.log(`  ... y ${cambios.length - 60} más`);
    if (sinDato.length) {
      console.log('\n⚠ Sin dato para restaurar (revisar a mano):');
      sinDato.slice(0, 30).forEach(({ c, why }) => console.log(`  ${fechaAR(c.logged_at)}  ${c.unidad}  ${Math.round(c.liters)} L  hoy ${money(c.price_per_l)} — ${why}`));
    }

    if (!APPLY) { console.log('\n(simulación: no se modificó nada)\n'); return; }
    if (!cambios.length) { console.log('\nNada que aplicar.\n'); return; }

    await client.query('BEGIN');
    for (const { c, nuevo } of cambios) {
      await client.query('UPDATE fuel_logs SET price_per_l=$1 WHERE id=$2', [nuevo, c.id]);
    }
    await client.query(`
      INSERT INTO audit_log (user_name, action, table_name, old_value, new_value)
      VALUES ('script restaurar-precios-cargas', 'fuel_restore_prices', 'fuel', $1, $2)`,
      [JSON.stringify({ hasta: HASTA, fuente: BACKUP ? 'backup' : 'reconstruccion' }),
       JSON.stringify({ cargas: cambios.map(({ c, nuevo }) => ({ id: c.id, de: c.price_per_l, a: nuevo })) })]);
    await client.query('COMMIT');
    console.log(`\n✅ ${cambios.length} cargas restauradas.\n`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n✗ Error:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
