#!/usr/bin/env node
/**
 * SONDA v2 de la API de Powerfleet — segunda vuelta, más inteligente.
 * ────────────────────────────────────────────────────────────────────────────
 * La v1 probó ~30 rutas "adivinadas" y todas dieron 404. En vez de seguir
 * adivinando, esta versión:
 *
 *   1) Le pide a la API su PROPIA documentación (Swagger / OpenAPI / Help de
 *      ASP.NET). Si responde, salen TODAS las rutas reales de una y no hay que
 *      adivinar nunca más.
 *   2) Barre el patrón que SÍ funciona: /api/{módulo}/{recurso}. Sabemos que
 *      andan /api/fleetview/vehicles y /api/io/{id}, así que prueba otros
 *      recursos dentro de fleetview y otros módulos plausibles.
 *   3) Muestra el cuerpo de un 404 real: el mensaje de error suele decir qué
 *      espera el servidor y ayuda a orientar la búsqueda.
 *
 * SOLO LECTURA: no escribe en la base ni en el proveedor.
 *
 * Uso (Shell de Render):
 *   node scripts/probe-gps-reportes2.js
 */
const gps = require('../services/gps-powerfleet');

const corto = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').slice(0, n);
const vale = r => r && r.status && r.status !== 404;
const hallazgos = [];

async function probar(path, opts, etiqueta) {
  let res;
  try { res = await gps.apiRequest(path, opts); } catch (e) { return null; }
  if (vale(res)) {
    console.log(`   ◄◄ [${res.status}] ${etiqueta || path}`);
    console.log(`        ${corto(res.body)}`);
    hallazgos.push([res.status, etiqueta || path]);
  }
  return res;
}

(async () => {
  console.log('\n🛰  SONDA v2 API Powerfleet — documentación + barrido de módulos\n');

  const base = await gps.apiRequest('/Fleetcore.Api/api/fleetview/vehicles');
  console.log(`Control: /api/fleetview/vehicles → status ${base.status}${base.status === 200 ? ' ✓' : ' ⚠'}`);
  if (base.status === 401) { console.log('\n❌ Login fallido.\n'); return; }

  // Cómo se ve un 404 del proveedor (el mensaje suele ser informativo).
  const r404 = await gps.apiRequest('/Fleetcore.Api/api/ruta-que-no-existe-xyz');
  console.log(`\nFormato del 404 del proveedor: ${corto(r404.body, 300) || '(cuerpo vacío)'}\n`);

  // ── 1) Documentación de la API ──────────────────────────────────────────
  console.log('── 1) Buscando la documentación de la API (Swagger/OpenAPI/Help) ──');
  for (const p of [
    '/swagger/v1/swagger.json', '/swagger/docs/v1', '/swagger.json', '/swagger',
    '/Fleetcore.Api/swagger/v1/swagger.json', '/Fleetcore.Api/swagger/docs/v1',
    '/Fleetcore.Api/swagger.json', '/Fleetcore.Api/swagger', '/Fleetcore.Api/help',
    '/Fleetcore.Api/api/help', '/Fleetcore.Api/openapi.json', '/Fleetcore.Api/api/metadata',
    '/Fleetcore.Api/api', '/Fleetcore.Api/',
  ]) await probar(p, {}, p);
  if (!hallazgos.length) console.log('   (sin documentación pública)');

  // ── 2) Barrido de módulos y recursos ────────────────────────────────────
  console.log('\n── 2) Barrido /api/{módulo}/{recurso} ──');
  // Otros recursos dentro del módulo que sabemos que existe.
  const RECURSOS_FLEETVIEW = ['activity','activities','trips','trip','history','distance','mileage',
    'summary','report','reports','kpi','events','positions','stats','statistics','odometer','daily'];
  for (const r of RECURSOS_FLEETVIEW) await probar(`/Fleetcore.Api/api/fleetview/${r}`, {}, `/api/fleetview/${r}`);

  // Otros módulos, al mismo nivel que fleetview e io.
  const MODULOS = ['reportview','reporting','reportsview','analytics','dashboard','statistics','stats',
    'summary','mileage','odometer','distance','travel','route','routes','journey','journeys',
    'events','positions','tracking','track','locations','activityreport','vehicleactivity',
    'dailyactivity','driverbehavior','utilization','idle','fuel'];
  for (const m of MODULOS) await probar(`/Fleetcore.Api/api/${m}`, {}, `/api/${m}`);

  // El módulo io funciona con id: probar otros verbos con id.
  let vehId = null;
  try {
    const d = JSON.parse(base.body);
    for (const g of (d?.data?.fleet?.groups || [])) for (const v of (g.vehicles || [])) { if (!vehId) vehId = v.vehicleId || v.id; }
  } catch (_) {}
  if (vehId) {
    console.log(`\n── 3) Rutas con vehicleId (${vehId}) ──`);
    for (const p of [
      `/Fleetcore.Api/api/fleetview/vehicles/${vehId}`,
      `/Fleetcore.Api/api/fleetview/vehicle/${vehId}/activity`,
      `/Fleetcore.Api/api/fleetview/vehicles/${vehId}/history`,
      `/Fleetcore.Api/api/io/${vehId}/history`,
    ]) await probar(p, {}, p.replace('/Fleetcore.Api',''));
  }

  console.log(`\n═ RESUMEN ═`);
  if (!hallazgos.length) {
    console.log('   Nada nuevo respondió: la API pública del proveedor no expone el informe.');
    console.log('   → Camino más rápido y seguro: ver en el navegador qué llama la web de Powerfleet');
    console.log('     al generar el "Informe de actividades" (F12 → pestaña Red → generar el informe →');
    console.log('     mirar la petición que sale). Con esa URL escribo el importador directo.');
    console.log('   → Plan B (funciona ya): importar el Excel del informe una vez por mes.');
  } else {
    console.log(`   ${hallazgos.length} respuesta(s) útiles:`);
    hallazgos.forEach(([s, p]) => console.log(`     [${s}] ${p}`));
  }
  console.log('');
})();
