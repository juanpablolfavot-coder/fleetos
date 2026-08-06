#!/usr/bin/env node
/**
 * SONDA v5 — /api/route sobre una unidad activa (detectada por el DETALLE).
 * ────────────────────────────────────────────────────────────────────────────
 * Por qué falló la v4: buscó la fecha del último mensaje en la LISTA de
 * vehículos, y ese dato no está ahí — solo aparece en el DETALLE de cada unidad
 * (/api/fleetview/vehicles/{id}). Como ninguna traía lastMessage, no encontró
 * "activas" y cortó antes de probar nada.
 *
 * Esta versión consulta el detalle unidad por unidad hasta encontrar las que
 * reportaron hace poco, y recién ahí prueba /api/route. Se le puede indicar una
 * patente concreta con --patente=AF041MB.
 *
 * SOLO LECTURA: no escribe en la base ni en el proveedor.
 *
 * Uso (Shell de Render):
 *   node scripts/probe-gps-reportes5.js
 *   node scripts/probe-gps-reportes5.js --patente=AF041MB
 */
const gps = require('../services/gps-powerfleet');

const corto = (s, n = 1000) => String(s || '').replace(/\s+/g, ' ').slice(0, n);
const dias = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const AYER = dias(1), HACE3 = dias(3), HACE7 = dias(7);
const PAT = (process.argv.find(a => a.startsWith('--patente=')) || '').split('=')[1] || null;

(async () => {
  console.log('\n🛰  SONDA v5 — /api/route sobre unidad activa (detalle)\n');

  const base = await gps.apiRequest('/Fleetcore.Api/api/fleetview/vehicles');
  if (base.status === 401) { console.log('❌ Login fallido.\n'); return; }

  const lista = [];
  try {
    const d = JSON.parse(base.body);
    for (const g of (d?.data?.fleet?.groups || []))
      for (const v of (g.vehicles || [])) {
        const id = v.vehicleId || v.id;
        if (id) lista.push({ id, patente: v.licensePlate || '' });
      }
  } catch (_) {}
  console.log(`Flota: ${lista.length} unidades`);
  if (!lista.length) { console.log('No se pudo leer la lista.\n'); return; }

  // Buscar una unidad ACTIVA consultando el detalle (ahí sí viene lastMessage).
  const candidatas = PAT
    ? lista.filter(v => (v.patente || '').toUpperCase().includes(PAT.toUpperCase()))
    : lista;
  if (!candidatas.length) { console.log(`No hay ninguna unidad con patente ~ "${PAT}".\n`); return; }

  console.log(`Buscando una unidad activa (consultando el detalle)...`);
  let V = null;
  for (const v of candidatas.slice(0, 20)) {
    let r; try { r = await gps.apiRequest(`/Fleetcore.Api/api/fleetview/vehicles/${v.id}`, { timeout: 12000 }); } catch (e) { continue; }
    let last = null, odo = null;
    try { const d = JSON.parse(r.body); last = d?.data?.vehicle?.lastMessage; odo = d?.data?.vehicle?.odometer; } catch (_) {}
    const dias = last ? Math.round((Date.now() - new Date(last).getTime()) / 86400000) : null;
    if (last && dias <= 3) {
      V = { ...v, last, odo };
      console.log(`   ✓ ${v.patente} (id ${v.id}) — último mensaje hace ${dias} día(s), odómetro ${Number(odo || 0).toLocaleString('es-AR')}`);
      break;
    }
    console.log(`   · ${v.patente} (id ${v.id}) — ${last ? `hace ${dias} días` : 'sin dato'}`);
  }
  if (!V) { console.log('\nNinguna de las consultadas reportó en los últimos 3 días.\n'); return; }

  // ── Probar /api/route con esa unidad ─────────────────────────────────────
  const casos = [];
  const rangos = [['ayer', AYER, AYER], ['3 días', HACE3, AYER], ['7 días', HACE7, AYER], ['julio', '2026-07-01', '2026-07-31']];
  const formatos = [
    ['ISO',        (d, f) => d],
    ['ISO+hora',   (d, f) => `${d}T${f ? '23:59:59' : '00:00:00'}`],
    ['ISO-03:00',  (d, f) => `${d}T${f ? '23:59:59' : '00:00:00'}-03:00`],
    ['UTC Z',      (d, f) => `${d}T${f ? '23:59:59' : '00:00:00'}Z`],
    ['dd/MM/yyyy', (d) => d.split('-').reverse().join('/')],
  ];
  const nombres = [['fromDate','toDate'], ['from','to'], ['dateFrom','dateTo'], ['startDate','endDate']];
  for (const [et, ini, fin] of rangos)
    for (const [fn, fmt] of formatos)
      for (const [a, b] of nombres)
        casos.push({ desc: `${et} · ${fn} · ${a}/${b}`, body: { vehicleId: V.id, [a]: fmt(ini, false), [b]: fmt(fin, true) } });

  console.log(`\nProbando ${casos.length} combinaciones sobre ${V.patente}...\n`);
  const vistos = new Set();
  let exito = null;
  for (const c of casos) {
    let r;
    try { r = await gps.apiRequest('/Fleetcore.Api/api/route', { method: 'POST', body: c.body, timeout: 30000 }); }
    catch (e) { continue; }
    let ok = false, msg = '';
    try { const d = JSON.parse(r.body); ok = d?.isSucceded === true; msg = d?.error?.message || ''; } catch (_) {}
    if (ok) { exito = { c, r }; console.log(`   ✅ [${r.status}] ${c.desc}`); break; }
    const k = msg.slice(0, 40);
    if (!vistos.has(k)) { vistos.add(k); console.log(`   ✗ ${c.desc} → ${msg || r.status}`); }
  }

  if (exito) {
    console.log(`\n═══ ¡FUNCIONÓ! ═══`);
    console.log(`Cuerpo que anduvo: ${JSON.stringify(exito.c.body)}`);
    console.log(`\nRespuesta:\n${corto(exito.r.body)}`);
    console.log(`\n→ Pegame esto y escribo el importador de km por unidad y período.\n`);
  } else {
    console.log(`\n═ RESULTADO ═`);
    console.log('   /api/route existe pero su data warehouse no devuelve datos para ninguna combinación.');
    console.log('   Es un problema del lado del proveedor (o requiere un permiso que la cuenta no tiene).');
    console.log('\n   → Seguimos con el plan del ODÓMETRO, ya confirmado: las 42 unidades reportan');
    console.log('     odómetro real y actualizado. Foto diaria + km del mes por diferencia.\n');
  }
})();
