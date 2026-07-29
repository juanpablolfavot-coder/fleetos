#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
//  Sondeo de la API de Powerfleet Unity — SOLO LECTURA
//
//  La guía de la API documenta ~300 endpoints, pero el proveedor licencia
//  por módulo: que algo esté en la guía no significa que esté habilitado
//  en NUESTRA cuenta. Este script prueba uno por uno los endpoints que nos
//  interesan y dice cuál contesta, cuál da 403 (sin licencia) y cuál 404.
//
//  NO escribe nada. No crea webhooks, no marca notificaciones como leídas,
//  no borra eventos. Todas las llamadas son de consulta.
//
//  Uso:
//    GPS_USER=... GPS_PASSWORD=... node scripts/diagnostico-powerfleet-api.js
//    node scripts/diagnostico-powerfleet-api.js --verbose   (vuelca respuestas completas)
//
//  No necesita base de datos: se puede correr desde cualquier lado con
//  salida a internet.
// ═══════════════════════════════════════════════════════════════════════
const https = require('https');

const PF_HOST = process.env.GPS_HOST     || 'rusegur.monitoreodeflotas.com.ar';
const PF_USER = process.env.GPS_USER;
const PF_PASS = process.env.GPS_PASSWORD;
const VERBOSE = process.argv.includes('--verbose');

let _token = null;

// ── HTTPS helper (mismo patrón que services/gps-powerfleet.js) ─────────
function req(path, { method = 'GET', body = null, noAuth = false, timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'GF360/1.0' };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    if (_token && !noAuth) headers['Authorization'] = `Bearer ${_token}`;

    let data = '';
    const r = https.request(
      { hostname: PF_HOST, port: 443, path, method, headers, rejectUnauthorized: false },
      (res) => {
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
    const timer = setTimeout(() => { r.destroy(); resolve({ status: 408, body: '', timeout: true }); }, timeout);
    r.on('error', (e) => { clearTimeout(timer); resolve({ status: 0, body: '', error: e.message }); });
    r.on('close', () => clearTimeout(timer));
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

// ── Login (prueba ambas capitalizaciones, igual que el servicio) ───────
async function login() {
  for (const p of ['/Fleetcore.Api/token', '/fleetcore.api/token']) {
    const res = await req(p, { method: 'POST', body: { username: PF_USER, password: PF_PASS, langId: 1 }, noAuth: true });
    if (res.status === 200) {
      try {
        const d = JSON.parse(res.body);
        const tk = d.token || d.access_token;
        if (tk) { _token = tk; return { ok: true, path: p, expira: d.expire || null }; }
      } catch (_) { /* seguir probando */ }
    }
  }
  return { ok: false };
}

// ── Endpoints a sondear ───────────────────────────────────────────────
// 'extraer' recibe el JSON parseado y devuelve una línea corta con lo que
// importa de ese endpoint (nombres de campos y conteos, no datos crudos).
const SONDAS = [
  {
    sec: '14.1', nombre: 'Fleet view resources', path: '/Fleetcore.Api/api/fleetview',
    porque: '¿trae engineOn y driver en la lista? Nos ahorraría una llamada por unidad',
    extraer: (d) => {
      const arr = Array.isArray(d.data) ? d.data : (d.data?.fleet?.groups?.[0]?.vehicles || []);
      const v = arr[0];
      if (!v) return 'respondió pero sin unidades';
      const campos = Object.keys(v);
      return `${arr.length} unidades · engineOn:${'engineOn' in v ? 'SÍ' : 'no'}`
        + ` · driver:${'driver' in v ? 'SÍ' : 'no'} · address:${'address' in v || 'Address' in v ? 'SÍ' : 'no'}`
        + `\n      campos: ${campos.join(', ')}`;
    },
  },
  {
    sec: '14.2', nombre: 'Fleet view vehicles (el que ya usamos)', path: '/Fleetcore.Api/api/fleetview/vehicles',
    porque: 'control: si este falla, el problema es de credenciales, no de licencias',
    extraer: (d) => {
      const g = d.data?.fleet?.groups || [];
      const vs = g.flatMap((x) => x.vehicles || []);
      const v = vs[0];
      return `${vs.length} unidades en ${g.length} grupo(s)`
        + (v ? `\n      campos: ${Object.keys(v).join(', ')}` : '');
    },
  },
  {
    sec: '14.11', nombre: 'Get nearest vehicles', path: null,  // se arma con coordenadas reales
    porque: 'herramienta para "¿qué unidad tengo más cerca de tal lugar?"',
    extraer: (d) => {
      const vs = (d.data?.vehicleGroupItems || []).flatMap((g) => g.vehicles || []);
      const v = vs[0];
      return `${vs.length} unidades en 50 km`
        + (v ? ` · drivingDistance:${'drivingDistance' in v ? 'SÍ' : 'no'} · driverName:${'driverName' in v ? 'SÍ' : 'no'}` : '');
    },
  },
  {
    sec: '13.1', nombre: 'Alert families', path: '/Fleetcore.Api/api/Alert/family',
    porque: 'qué tipos de alerta maneja la plataforma',
    extraer: (d) => (d.data || []).map((f) => `${f.id}:${f.description}`).join(' | ') || 'lista vacía',
  },
  {
    sec: '13.2', nombre: 'Alert subfamilies', path: '/Fleetcore.Api/api/Alert/subfamily',
    porque: 'el catálogo fino de alertas que YA detecta la plataforma',
    extraer: (d) => {
      const a = d.data || [];
      return `${a.length} subfamilias · ejemplos: ` + a.slice(0, 6).map((s) => s.description || s.label).join(', ');
    },
  },
  {
    sec: '21.1', nombre: 'Get Notification', path: '/Fleetcore.Api/api/Notification',
    porque: 'el feed de eventos de la plataforma (con maxId para consulta incremental)',
    extraer: (d) => {
      const ev = d.data?.events || [];
      const tipos = [...new Set(ev.map((e) => e.eventName))].slice(0, 8);
      return `maxId:${d.data?.maxId ?? '—'} · ${ev.length} eventos`
        + (tipos.length ? `\n      tipos vistos: ${tipos.join(', ')}` : '');
    },
  },
  {
    sec: '21.5', nombre: 'Notification history', path: '/Fleetcore.Api/api/Notification/history',
    porque: 'historial de eventos (trae lat/lng, sirve para el feed)',
    extraer: (d) => {
      const a = d.data || [];
      return `${a.length} eventos` + (a[0] ? ` · campos: ${Object.keys(a[0]).join(', ')}` : '');
    },
  },
  {
    sec: '21.4', nombre: 'Notification dashboard', path: '/Fleetcore.Api/api/Notification/dasboard',
    porque: 'conteos por severidad y códigos de falla del motor (DTC)',
    extraer: (d) => {
      const e = d.data?.events?.header?.all;
      const dtc = d.data?.dtc?.header?.all;
      return `eventos:${e ?? '—'} · recordatorios:${d.data?.reminders?.header?.all ?? '—'} · DTC:${dtc ?? '—'}`;
    },
  },
  {
    sec: '30.1', nombre: 'Webhooks (listar)', path: '/Fleetcore.api/api/webhooks',
    porque: 'si responde, podemos recibir alertas en tiempo real en vez de consultar cada 2 min',
    extraer: (d) => {
      const a = d.data || [];
      return a.length ? `${a.length} webhook(s) ya registrados: ` + a.map((w) => `${w.name}(tipo ${w.webhookType})`).join(', ')
                      : 'ninguno registrado todavía (pero el endpoint responde)';
    },
  },
  {
    sec: '30.4', nombre: 'Webhook types', path: '/Fleetcore.api/api/webhooks/types',
    porque: 'qué eventos se pueden recibir por webhook EN ESTA CUENTA',
    extraer: (d) => (d.data || []).map((t) => `${t.webhookType}:${t.name}`).join(' | ') || 'lista vacía',
  },
  {
    sec: '25.1', nombre: 'Route (viajes del día)', path: '/Fleetcore.api/api/route', metodo: 'POST',
    porque: 'km reales del GPS por viaje — la fuente para cruzar contra los tickets de carga',
    cuerpo: () => {
      const hoy = new Date();
      const ayer = new Date(hoy.getTime() - 24 * 3600 * 1000);
      const fmt = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return { StartDate: fmt(ayer), EndDate: fmt(hoy), getLast: 1 };
    },
    extraer: (d) => {
      const t = d.data?.trips || [];
      return `${d.data?.tripsCount ?? t.length} viajes · distancia total:${d.data?.distance ?? '—'}`
        + (t[0] ? `\n      campos de viaje: ${Object.keys(t[0]).join(', ')}` : '');
    },
  },
];

// ── Clasificación de la respuesta ─────────────────────────────────────
function clasificar(res) {
  if (res.timeout)       return { icono: '⏱', estado: 'TIMEOUT', detalle: 'no respondió a tiempo' };
  if (res.status === 0)  return { icono: '💥', estado: 'ERROR RED', detalle: res.error || '' };
  if (res.status === 401) return { icono: '🔑', estado: 'NO AUTORIZADO', detalle: 'el token no sirve para este endpoint' };
  if (res.status === 403) return { icono: '🔒', estado: 'SIN LICENCIA', detalle: 'módulo no habilitado en la cuenta' };
  if (res.status === 404) return { icono: '❌', estado: 'NO EXISTE', detalle: 'ruta no encontrada' };
  if (res.status !== 200) return { icono: '⚠', estado: `HTTP ${res.status}`, detalle: res.body.slice(0, 120) };
  try {
    const d = JSON.parse(res.body);
    if (d.isSucceded === false) {
      return { icono: '⚠', estado: 'RESPONDE CON ERROR', detalle: JSON.stringify(d.error || {}).slice(0, 120), json: d };
    }
    return { icono: '✅', estado: 'DISPONIBLE', json: d };
  } catch (_) {
    return { icono: '⚠', estado: 'RESPUESTA NO-JSON', detalle: res.body.slice(0, 120) };
  }
}

// La guía mezcla tres capitalizaciones del prefijo: 'Fleetcore.Api',
// 'Fleetcore.api' y 'fleetcore.api'. Un 404 casi siempre es eso y no que el
// endpoint no exista, así que se prueban todas antes de darlo por muerto.
const CAPITALIZACIONES = ['Fleetcore.Api', 'Fleetcore.api', 'fleetcore.api'];
const PREFIJO = /^\/[Ff]leet[Cc]ore\.[Aa]pi\//;

async function probarConFallback(path, opts) {
  const intentos = [path];
  if (PREFIJO.test(path)) {
    for (const c of CAPITALIZACIONES) {
      const alt = path.replace(PREFIJO, `/${c}/`);
      if (!intentos.includes(alt)) intentos.push(alt);
    }
  }
  let ultimo = null;
  for (const p of intentos) {
    const res = await req(p, opts);
    if (res.status !== 404) return { res, path: p, usoFallback: p !== path };
    ultimo = res;
  }
  return { res: ultimo, path };
}

// ── Main ──────────────────────────────────────────────────────────────
(async () => {
  console.log('═'.repeat(72));
  console.log('  SONDEO API POWERFLEET — solo lectura');
  console.log('  Host:', PF_HOST);
  console.log('═'.repeat(72));

  if (!PF_USER || !PF_PASS) {
    console.log('\n❌ Faltan credenciales. Corré:');
    console.log('   GPS_USER=usuario GPS_PASSWORD=clave node scripts/diagnostico-powerfleet-api.js\n');
    process.exit(1);
  }

  process.stdout.write('\nLogin... ');
  const auth = await login();
  if (!auth.ok) {
    console.log('❌ falló. Revisá GPS_USER / GPS_PASSWORD.\n');
    process.exit(1);
  }
  console.log(`✅ OK (${auth.path})${auth.expira ? ` · token vence ${auth.expira}` : ''}\n`);

  // Coordenadas reales para el sondeo de "unidad más cercana": se toman de
  // la primera unidad de la flota, así la prueba es representativa.
  let coords = null;
  const resumen = [];

  for (const s of SONDAS) {
    let path = s.path;
    if (s.sec === '14.11') {
      if (!coords) {
        console.log(`${'⏭'} 14.11  ${s.nombre}`);
        console.log('      omitido: no se pudieron obtener coordenadas de ninguna unidad\n');
        resumen.push({ sec: s.sec, nombre: s.nombre, icono: '⏭', estado: 'OMITIDO' });
        continue;
      }
      path = `/Fleetcore.Api/api/fleetview/getnearestvehicles?Lat=${coords.lat}&Lng=${coords.lng}`;
    }

    const opts = s.metodo === 'POST' ? { method: 'POST', body: s.cuerpo ? s.cuerpo() : {} } : {};
    const { res, path: usada, usoFallback } = await probarConFallback(path, opts);
    const c = clasificar(res);

    console.log(`${c.icono} ${s.sec}  ${s.nombre}`);
    console.log(`      para qué: ${s.porque}`);
    console.log(`      ${c.estado}${c.detalle ? ' — ' + c.detalle : ''}`);
    if (usoFallback) console.log(`      (funcionó con la otra capitalización: ${usada})`);

    if (c.json) {
      try {
        const linea = s.extraer(c.json);
        if (linea) console.log(`      ${linea}`);
      } catch (e) { console.log(`      (no se pudo resumir: ${e.message})`); }

      // Guardar coordenadas de la primera unidad para el sondeo 14.11
      if (!coords && (s.sec === '14.1' || s.sec === '14.2')) {
        const arr = Array.isArray(c.json.data) ? c.json.data
          : (c.json.data?.fleet?.groups || []).flatMap((g) => g.vehicles || []);
        const v = arr.find((x) => Number(x.lat) && Number(x.lng));
        if (v) coords = { lat: Number(v.lat), lng: Number(v.lng) };
      }

      if (VERBOSE) console.log('      ── respuesta completa ──\n' + JSON.stringify(c.json, null, 2).split('\n').map((l) => '      ' + l).join('\n'));
    }
    console.log('');
    resumen.push({ sec: s.sec, nombre: s.nombre, icono: c.icono, estado: c.estado });
  }

  console.log('═'.repeat(72));
  console.log('  RESUMEN');
  console.log('═'.repeat(72));
  for (const r of resumen) console.log(`  ${r.icono}  ${r.sec.padEnd(6)} ${r.nombre.padEnd(42)} ${r.estado}`);
  const ok = resumen.filter((r) => r.icono === '✅').length;
  console.log('─'.repeat(72));
  console.log(`  ${ok} de ${resumen.length} endpoints disponibles`);
  console.log('═'.repeat(72));
  console.log('\nCopiá y pegá esta salida para decidir qué se puede construir.\n');
})();
