#!/usr/bin/env node
/**
 * SONDA v3 de la API de Powerfleet — sobre las dos pistas concretas de la v2.
 * ────────────────────────────────────────────────────────────────────────────
 * Lo que encontró la v2:
 *   · /api/route respondió 405 (Method Not Allowed) → la ruta EXISTE pero no
 *     acepta GET: hay que llamarla por POST. Es la candidata natural al
 *     histórico de recorridos (km por unidad y por período).
 *   · /api/fleetview/vehicles/{id} devuelve el detalle con "odometer" real
 *     (la lista general no lo trae), lo que abre un camino alternativo.
 *
 * Esta sonda:
 *   1) Llama /api/route por POST con los formatos de cuerpo más habituales.
 *   2) Busca OTRAS rutas ocultas: hace POST con cuerpo vacío a los módulos
 *      candidatos. 404 = no existe · 400/405/500 = EXISTE (y el mensaje suele
 *      decir qué espera) · 200 = anduvo.
 *   3) Lee el odómetro por unidad del endpoint de detalle, para evaluar el
 *      plan alternativo: guardar una foto diaria del odómetro del GPS y sacar
 *      los km del mes por diferencia (exacto, sin depender de las cargas).
 *
 * SOLO LECTURA: no escribe en la base ni en el proveedor.
 *
 * Uso (Shell de Render):
 *   node scripts/probe-gps-reportes3.js
 */
const gps = require('../services/gps-powerfleet');

const corto = (s, n = 500) => String(s || '').replace(/\s+/g, ' ').slice(0, n);
const DESDE = '2026-07-01', HASTA = '2026-07-31';

(async () => {
  console.log('\n🛰  SONDA v3 — /api/route por POST + odómetro por unidad\n');

  const base = await gps.apiRequest('/Fleetcore.Api/api/fleetview/vehicles');
  if (base.status === 401) { console.log('❌ Login fallido.\n'); return; }
  console.log(`Control: /api/fleetview/vehicles → ${base.status} ✓`);

  // Un par de vehículos reales para las pruebas.
  const vehiculos = [];
  try {
    const d = JSON.parse(base.body);
    for (const g of (d?.data?.fleet?.groups || []))
      for (const v of (g.vehicles || [])) vehiculos.push({ id: v.vehicleId || v.id, patente: v.licensePlate, unitId: v.unitId });
  } catch (_) {}
  const v0 = vehiculos[0] || {};
  console.log(`Flota: ${vehiculos.length} unidades · prueba con ${v0.patente} (id ${v0.id}, unitId ${v0.unitId})\n`);

  // ── 1) /api/route por POST ───────────────────────────────────────────────
  console.log('── 1) POST /api/route con distintos formatos de cuerpo ──');
  const CUERPOS = [
    { vehicleId: v0.id, fromDate: DESDE, toDate: HASTA },
    { vehicleId: v0.id, from: `${DESDE}T00:00:00`, to: `${HASTA}T23:59:59` },
    { id: v0.id, startDate: DESDE, endDate: HASTA },
    { vehicleIds: [v0.id], fromDate: DESDE, toDate: HASTA },
    { unitId: v0.unitId, fromDate: DESDE, toDate: HASTA },
    { vehicleId: Number(v0.id), dateFrom: `${DESDE}T00:00:00`, dateTo: `${HASTA}T23:59:59` },
    { vehicleId: v0.id, fromDate: `${DESDE}T00:00:00-03:00`, toDate: `${HASTA}T23:59:59-03:00`, langId: 1 },
    {},
  ];
  for (const body of CUERPOS) {
    let r; try { r = await gps.apiRequest('/Fleetcore.Api/api/route', { method: 'POST', body, timeout: 25000 }); } catch (e) { continue; }
    console.log(`   [${r.status}] body=${JSON.stringify(body).slice(0,110)}`);
    if (r.body) console.log(`        ${corto(r.body)}`);
    if (r.status === 200 && r.body && r.body.length > 40) { console.log('\n   ✅ ¡Esta combinación funcionó! (ver forma de la respuesta arriba)\n'); break; }
  }

  // ── 2) Descubrir otras rutas por POST ────────────────────────────────────
  console.log('\n── 2) Buscando otras rutas: POST con cuerpo vacío (404=no existe · otro=existe) ──');
  const CANDIDATOS = ['route','routes','trip','trips','activity','activities','report','reports',
    'history','summary','distance','mileage','kpi','statistics','stats','events','positions',
    'utilization','idle','driving','vehicleactivity','activityreport','dailysummary'];
  const existen = [];
  for (const m of CANDIDATOS) {
    let r; try { r = await gps.apiRequest(`/Fleetcore.Api/api/${m}`, { method: 'POST', body: {}, timeout: 12000 }); } catch (e) { continue; }
    if (r.status === 404) continue;
    existen.push([r.status, `/api/${m}`]);
    console.log(`   ◄◄ [${r.status}] POST /api/${m}   ${corto(r.body, 200)}`);
  }
  if (!existen.length) console.log('   (ninguna otra ruta respondió)');

  // ── 3) Odómetro por unidad (plan alternativo) ────────────────────────────
  console.log('\n── 3) Odómetro del GPS por unidad (detalle) — plan alternativo ──');
  let conOdo = 0, sinOdo = 0;
  for (const v of vehiculos.slice(0, 8)) {
    let r; try { r = await gps.apiRequest(`/Fleetcore.Api/api/fleetview/vehicles/${v.id}`, { timeout: 12000 }); } catch (e) { continue; }
    let odo = null, last = null;
    try { const d = JSON.parse(r.body); odo = d?.data?.vehicle?.odometer; last = d?.data?.vehicle?.lastMessage; } catch (_) {}
    if (odo > 0) conOdo++; else sinOdo++;
    console.log(`   ${String(v.patente || v.id).padEnd(10)} odómetro GPS: ${odo != null ? Number(odo).toLocaleString('es-AR') : '—'}   último mensaje: ${last || '—'}`);
  }
  console.log(`   → ${conOdo} con odómetro / ${sinOdo} sin odómetro (de la muestra)`);

  console.log(`\n═ QUÉ SIGUE ═`);
  console.log('   · Si /api/route devolvió 200 con datos → escribo el importador de km por unidad y período.');
  console.log('   · Si el odómetro del GPS viene bien en el detalle → alternativa: foto diaria del odómetro;');
  console.log('     km del mes = odómetro fin de mes − fin del mes anterior (exacto, sin depender de cargas).');
  console.log('     Esa vía sirve de acá en adelante; para junio/julio se usa el Excel que ya sabemos leer.\n');
})();
