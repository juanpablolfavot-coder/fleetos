#!/usr/bin/env node
/**
 * SONDA de la API de Powerfleet: busca el endpoint del "Informe de actividades"
 * (km recorridos por unidad y por día), para poder traer los km del GPS sin
 * depender del Excel que hoy se descarga a mano.
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO LECTURA: hace consultas GET y POST de generación de reportes (que no
 * modifican nada). No escribe en la base ni en el proveedor.
 *
 * Por qué hace falta: el proveedor no documenta la ruta y no es consistente con
 * las mayúsculas del prefijo (/Fleetcore.Api, /Fleetcore.api, /fleetcore.api).
 * Este script prueba las rutas candidatas y muestra cuál responde y con qué
 * forma, para escribir después el importador con la ruta correcta.
 *
 * Uso (Shell de Render — ahí están las credenciales GPS_USER / GPS_PASSWORD):
 *   node scripts/probe-gps-reportes.js
 *   node scripts/probe-gps-reportes.js --desde=2026-07-01 --hasta=2026-07-31
 */
const gps = require('../services/gps-powerfleet');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] || null;
const DESDE = arg('desde') || '2026-07-01';
const HASTA = arg('hasta') || '2026-07-31';

// Rutas candidatas para GET (el prefijo lo reintenta apiRequest en sus 3 formas).
const GETS = [
  '/Fleetcore.Api/api/reports',
  '/Fleetcore.Api/api/report',
  '/Fleetcore.Api/api/reports/list',
  '/Fleetcore.Api/api/reports/types',
  '/Fleetcore.Api/api/reports/activity',
  '/Fleetcore.Api/api/report/activity',
  '/Fleetcore.Api/api/activity',
  '/Fleetcore.Api/api/activities',
  '/Fleetcore.Api/api/trips',
  '/Fleetcore.Api/api/trip',
  '/Fleetcore.Api/api/history',
  '/Fleetcore.Api/api/kpi',
  '/Fleetcore.Api/api/fleetview/activity',
  '/Fleetcore.Api/api/fleetview/reports',
  `/Fleetcore.Api/api/reports/activity?from=${DESDE}&to=${HASTA}`,
  `/Fleetcore.Api/api/activity?from=${DESDE}&to=${HASTA}`,
  `/Fleetcore.Api/api/trips?from=${DESDE}&to=${HASTA}`,
  `/Fleetcore.Api/api/reports/distance?from=${DESDE}&to=${HASTA}`,
  `/Fleetcore.Api/api/reports/mileage?from=${DESDE}&to=${HASTA}`,
];

// Rutas candidatas para POST, con cuerpos en los formatos más habituales.
const CUERPOS = [
  { fromDate: DESDE, toDate: HASTA },
  { from: DESDE, to: HASTA },
  { startDate: DESDE, endDate: HASTA },
  { dateFrom: `${DESDE}T00:00:00`, dateTo: `${HASTA}T23:59:59` },
];
const POSTS = [
  '/Fleetcore.Api/api/reports/activity',
  '/Fleetcore.Api/api/reports/generate',
  '/Fleetcore.Api/api/report/activity',
  '/Fleetcore.Api/api/reports/activitySummary',
  '/Fleetcore.Api/api/reports/vehicleActivity',
  '/Fleetcore.Api/api/activity/search',
  '/Fleetcore.Api/api/trips/search',
];

const corto = s => String(s || '').replace(/\s+/g, ' ').slice(0, 220);

function interesante(res) {
  // 404 = no existe · 401/403 = existe pero sin permiso (igual sirve saberlo)
  return res && res.status && res.status !== 404;
}

(async () => {
  console.log(`\n🛰  SONDA API Powerfleet — buscando el informe de actividades (${DESDE} → ${HASTA})\n`);

  // 0) Verificar que el login funciona y que la ruta conocida responde.
  const base = await gps.apiRequest('/Fleetcore.Api/api/fleetview/vehicles');
  console.log(`Control: /api/fleetview/vehicles → status ${base.status}${base.status === 200 ? ' ✓ (login OK)' : ' ⚠'}`);
  if (base.status === 401) { console.log('\n❌ Login fallido: revisar GPS_USER / GPS_PASSWORD.\n'); return; }

  // Un vehicleId real, por si algún endpoint lo pide.
  let vehId = null;
  try {
    const d = JSON.parse(base.body);
    const grupos = d?.data?.fleet?.groups || [];
    for (const g of grupos) for (const v of (g.vehicles || [])) { if (!vehId && (v.vehicleId || v.id)) vehId = v.vehicleId || v.id; }
  } catch (_) {}
  console.log(`Vehículo de prueba: ${vehId || '(no se pudo extraer)'}\n`);

  const hallazgos = [];

  console.log('── Probando GET ──');
  for (const p of GETS) {
    let res;
    try { res = await gps.apiRequest(p); } catch (e) { console.log(`   ${p} → error ${e.message}`); continue; }
    const marca = interesante(res) ? '◄◄' : '  ';
    console.log(`   ${marca} [${res.status}] ${p}`);
    if (interesante(res)) { console.log(`        ${corto(res.body)}`); hallazgos.push(['GET', p, res.status]); }
  }

  if (vehId) {
    console.log('\n── Probando GET por vehículo ──');
    for (const p of [
      `/Fleetcore.Api/api/vehicles/${vehId}/activity?from=${DESDE}&to=${HASTA}`,
      `/Fleetcore.Api/api/vehicle/${vehId}/trips?from=${DESDE}&to=${HASTA}`,
      `/Fleetcore.Api/api/trips/${vehId}?from=${DESDE}&to=${HASTA}`,
      `/Fleetcore.Api/api/history/${vehId}?from=${DESDE}&to=${HASTA}`,
    ]) {
      let res; try { res = await gps.apiRequest(p); } catch (e) { continue; }
      const marca = interesante(res) ? '◄◄' : '  ';
      console.log(`   ${marca} [${res.status}] ${p}`);
      if (interesante(res)) { console.log(`        ${corto(res.body)}`); hallazgos.push(['GET', p, res.status]); }
    }
  }

  console.log('\n── Probando POST (generación de reporte) ──');
  for (const p of POSTS) {
    for (const body of CUERPOS) {
      let res;
      try { res = await gps.apiRequest(p, { method: 'POST', body }); } catch (e) { continue; }
      if (!interesante(res)) continue;
      console.log(`   ◄◄ [${res.status}] POST ${p}  body=${JSON.stringify(body)}`);
      console.log(`        ${corto(res.body)}`);
      hallazgos.push(['POST', p, res.status]);
      break; // con un cuerpo que responda alcanza para identificar la ruta
    }
  }

  console.log(`\n═ RESUMEN ═`);
  if (!hallazgos.length) {
    console.log('   Ninguna ruta candidata respondió. La API del proveedor usa otro nombre.');
    console.log('   Plan B: importar el Excel del informe (ya sabemos parsearlo) una vez por mes.');
  } else {
    console.log(`   ${hallazgos.length} ruta(s) respondieron:`);
    hallazgos.forEach(([m, p, s]) => console.log(`     [${s}] ${m} ${p}`));
    console.log('\n   Pegá esta salida y con eso escribo el importador definitivo.');
  }
  console.log('');
})();
