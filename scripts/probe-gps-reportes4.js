#!/usr/bin/env node
/**
 * SONDA v4 — /api/route con unidad ACTIVA y distintos formatos de fecha.
 * ────────────────────────────────────────────────────────────────────────────
 * Lo que dejó la v3:
 *   · /api/route acepta el parámetro `vehicleId`: con él el pedido llega al
 *     data warehouse ("Could not execute statement on remote server 'DWHSERVER'"),
 *     mientras que con `id` o sin vehículo responde "Vehicle Not Found".
 *   · La prueba se hizo con AB723IX, cuyo último mensaje es del 13/02/2026:
 *     una unidad INACTIVA hace medio año. Es muy probable que el DWH no tenga
 *     su recorrido de julio y por eso falle la consulta.
 *
 * Esta sonda repite el intento con una unidad ACTIVA (último mensaje reciente),
 * empezando por rangos cortos y cercanos —lo más fácil de responder para el
 * DWH— y recién después el mes entero. Prueba además varios formatos de fecha
 * y nombres de parámetro.
 *
 * SOLO LECTURA: no escribe en la base ni en el proveedor.
 *
 * Uso (Shell de Render):
 *   node scripts/probe-gps-reportes4.js
 */
const gps = require('../services/gps-powerfleet');

const corto = (s, n = 900) => String(s || '').replace(/\s+/g, ' ').slice(0, n);
const dias = n => { const d = new Date(Date.now() - n * 86400000); return d.toISOString().slice(0, 10); };
const AYER = dias(1), HACE3 = dias(3), HACE7 = dias(7);

(async () => {
  console.log('\n🛰  SONDA v4 — /api/route sobre una unidad ACTIVA\n');

  const base = await gps.apiRequest('/Fleetcore.Api/api/fleetview/vehicles');
  if (base.status === 401) { console.log('❌ Login fallido.\n'); return; }

  // Elegir unidades ACTIVAS: las que reportaron en los últimos 2 días.
  const activas = [];
  try {
    const d = JSON.parse(base.body);
    for (const g of (d?.data?.fleet?.groups || [])) for (const v of (g.vehicles || [])) {
      const id = v.vehicleId || v.id;
      const last = v.lastMessage || v.lastLocation;
      if (id && last && (Date.now() - new Date(last).getTime()) < 3 * 86400000) {
        activas.push({ id, patente: v.licensePlate, last });
      }
    }
  } catch (_) {}
  if (!activas.length) { console.log('No se encontraron unidades activas en la lista.\n'); return; }
  const V = activas[0];
  console.log(`Unidades activas: ${activas.length} · probando con ${V.patente} (id ${V.id}, último mensaje ${V.last})\n`);

  // Combinaciones: primero rangos CORTOS y CERCANOS (lo más liviano para el DWH).
  const casos = [];
  const rangos = [
    ['ayer (1 día)', AYER, AYER],
    ['últimos 3 días', HACE3, AYER],
    ['últimos 7 días', HACE7, AYER],
    ['julio completo', '2026-07-01', '2026-07-31'],
  ];
  const formatos = [
    ['ISO simple',        (d, fin) => d],
    ['ISO con hora',      (d, fin) => `${d}T${fin ? '23:59:59' : '00:00:00'}`],
    ['ISO con zona -03',  (d, fin) => `${d}T${fin ? '23:59:59' : '00:00:00'}-03:00`],
    ['ISO UTC (Z)',       (d, fin) => `${d}T${fin ? '23:59:59' : '00:00:00'}Z`],
    ['dd/MM/yyyy',        (d) => d.split('-').reverse().join('/')],
  ];
  const nombres = [['fromDate','toDate'], ['from','to'], ['dateFrom','dateTo'], ['startDate','endDate']];

  for (const [etiqueta, ini, fin] of rangos) {
    for (const [fmtNom, fmt] of formatos) {
      for (const [nIni, nFin] of nombres) {
        casos.push({
          desc: `${etiqueta} · ${fmtNom} · ${nIni}/${nFin}`,
          body: { vehicleId: V.id, [nIni]: fmt(ini, false), [nFin]: fmt(fin, true) },
        });
      }
    }
  }

  console.log(`Probando ${casos.length} combinaciones (corta apenas una devuelva datos)...\n`);
  const probados = new Set();   // mensajes de error ya mostrados, para no repetir
  let exito = null;
  for (const c of casos) {
    let r;
    try { r = await gps.apiRequest('/Fleetcore.Api/api/route', { method: 'POST', body: c.body, timeout: 30000 }); }
    catch (e) { continue; }
    let ok = false, msg = '';
    try { const d = JSON.parse(r.body); ok = d?.isSucceded === true; msg = d?.error?.message || ''; } catch (_) {}
    if (ok) { exito = { c, r }; console.log(`   ✅ [${r.status}] ${c.desc}`); break; }
    // Solo mostramos los errores DISTINTOS, para no llenar la pantalla.
    const clave = msg.slice(0, 40);
    if (!probados.has(clave)) { probados.add(clave); console.log(`   ✗ ${c.desc} → ${msg || r.status}`); }
  }

  if (exito) {
    console.log(`\n═══ ¡FUNCIONÓ! ═══`);
    console.log(`Cuerpo: ${JSON.stringify(exito.c.body)}`);
    console.log(`\nRespuesta (primeros 900 caracteres):\n${corto(exito.r.body)}`);
    console.log(`\n→ Pegame esto y escribo el importador de km por unidad y período.\n`);
  } else {
    console.log(`\n═ RESULTADO ═`);
    console.log('   Ninguna combinación devolvió datos: el data warehouse del proveedor no responde');
    console.log('   a esta consulta (puede ser un problema de su lado o requerir permisos extra).');
    console.log('\n   → Vamos por el plan del ODÓMETRO, que ya sabemos que funciona:');
    console.log('     foto diaria del odómetro GPS de cada unidad; km del mes = fin de mes − fin del mes');
    console.log('     anterior. Exacto y automático de acá en adelante; junio y julio se cargan una vez');
    console.log('     desde el Excel que ya sabemos leer.\n');
  }
})();
