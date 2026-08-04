// ═══════════════════════════════════════════════════════════
//  FleetOS — Integración GPS Powerfleet (Rusegur)
//  Basado en código Python que ya funcionaba con esta misma API
//  Auth:  POST /Fleetcore.Api/token {username, password, langId:1}
//  Fleet: GET  /Fleetcore.Api/api/fleetview/vehicles
//         → data.fleet.groups[].vehicles[] con licensePlate, odometer, hourMeter
// ═══════════════════════════════════════════════════════════

const https  = require('https');
const { query } = require('../db/pool');
const speeding = require('./speeding');
const idle = require('./idle');

const PF_HOST = 'rusegur.monitoreodeflotas.com.ar';

// Acá había usuario y contraseña de Powerfleet escritos como valor por defecto
// de estas dos variables (los valores NO se repiten acá: este repositorio es
// público y copiarlos a un comentario dejaría todo igual que antes).
//
// Esa cuenta ve la posición en tiempo real de toda la flota, y estuvo legible
// por cualquiera desde abril de 2026.
//
// Sacarlas de acá no las saca de la historia de git — siguen en los commits
// viejos, y hay que dar esa contraseña por comprometida. Lo que este cambio sí
// garantiza es que no se agreguen commits nuevos con la credencial adentro, y
// que nadie pueda volver a arrancar el servicio con la vieja "sin darse cuenta".
//
// Sin las variables el servicio NO arranca, a propósito: un GPS que no
// sincroniza se nota el mismo día, y una credencial escondida en el código no
// se nota nunca.
const PF_USER = process.env.GPS_USER;
const PF_PASS = process.env.GPS_PASSWORD;

function credencialesOk() {
  return !!(PF_USER && PF_PASS);
}

// Validación del certificado del proveedor. Estaba en `rejectUnauthorized:
// false` fijo en el código —ni siquiera miraba GPS_TLS_INSECURE, que
// .env.example venía documentando— así que la conexión aceptaba cualquier
// certificado. Por ahí van el usuario, la contraseña y la posición de las 42
// unidades: sin validar, cualquiera que se meta en el camino puede leerlas y
// modificarlas sin que se note.
//
// Ahora valida por defecto. Si el certificado del proveedor está mal y el sync
// se cae, GPS_TLS_INSECURE=true lo vuelve al comportamiento anterior —pero
// avisando en cada arranque, para que sea una decisión y no un olvido.
const TLS_INSECURE = /^(1|true|yes)$/i.test(String(process.env.GPS_TLS_INSECURE || ''));

let _token    = null;
let _tokenExp = null;
let _lastSync = null;
let _lastResult = null;
let _running  = false;
// El detalle completo de la respuesta del proveedor se loguea una sola vez por
// arranque. Ver fetchFleet() para el porqué.
let _primeraVez = true;
let _volcadoPendiente = true;   // el detalle de las unidades sale 1 vez por arranque
let _ultimoConteo = null;       // …y cuando cambia cuántas se actualizaron
let _ioConsultados = 0;

// ── HTTPS helper ────────────────────────────────────────────
function httpsReq(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = opts.body ? JSON.stringify(opts.body) : null;
    const headers = {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
      'User-Agent':   'GF360/1.0',
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    if (_token && !opts.noAuth) headers['Authorization'] = `Bearer ${_token}`;

    const options = {
      hostname: PF_HOST, port: 443,
      path, method: opts.method || 'GET',
      headers, rejectUnauthorized: !TLS_INSECURE,
    };

    let data = '';
    const req = https.request(options, res => {
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    // Timeout total: para long-poll cortamos a los 10s y usamos lo que llegó
    const timer = setTimeout(() => {
      req.destroy();
      if (data.length > 5) {
        resolve({ status: 200, body: data, partial: true });
      } else {
        resolve({ status: 408, body: '', timeout: true });
      }
    }, opts.timeout || 15000);

    req.on('error', e => {
      clearTimeout(timer);
      if (data.length > 5) resolve({ status: 200, body: data, partial: true });
      else reject(e);
    });
    req.on('close', () => clearTimeout(timer));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Login: POST /Fleetcore.Api/token ───────────────────────
// Exactamente igual al código Python que ya funcionaba:
// payload = {username, password, langId: 1}
// respuesta: {token: "eyJ...", expire: "ISO date"}
async function login() {
  if (_token && _tokenExp && Date.now() < _tokenExp) return true;
  _token = null;

  // startGPSSync ya corta antes, pero login() también se llama desde el panel de
  // estado y desde el webhook: sin esto, esos caminos mandarían usuario vacío.
  if (!credencialesOk()) {
    console.error('[GPS] ✗ Login imposible: faltan GPS_USER / GPS_PASSWORD.');
    return false;
  }

  console.log('[GPS] Login Powerfleet...');
  const res = await httpsReq('/Fleetcore.Api/token', {
    method:  'POST',
    body:    { username: PF_USER, password: PF_PASS, langId: 1 },
    noAuth:  true,
    timeout: 15000,
  }).catch(e => ({ status: 0, body: '' }));

  // El cuerpo de un login exitoso ES el token. Loguearlo lo dejaba escrito en
  // los logs de Render, que son otro lugar donde una credencial no tiene que
  // estar. En el camino de error sí conviene verlo: ahí el cuerpo es el mensaje
  // del proveedor ("Host not in allowlist", "invalid credentials") y sin eso
  // diagnosticar una caída del GPS es a ciegas.
  console.log('[GPS] Login status:', res.status, res.status === 200 ? '' : '| ' + res.body.slice(0, 150));

  if (res.status === 200) {
    try {
      const d = JSON.parse(res.body);
      const tk = d.token || d.access_token;
      if (tk) {
        _token = tk;
        // expire es ISO date, igual que en el Python
        if (d.expire) {
          _tokenExp = new Date(d.expire).getTime() - 60000;
        } else {
          _tokenExp = Date.now() + (d.expires_in || 3600) * 1000 - 60000;
        }
        console.log('[GPS] Token OK. Expira:', new Date(_tokenExp).toISOString());
        return true;
      }
    } catch(e) { console.log('[GPS] Parse error token:', e.message); }
  }

  // Fallback: probar también con /fleetcore.api/token (minúsculas)
  const res2 = await httpsReq('/fleetcore.api/token', {
    method: 'POST',
    body:   { username: PF_USER, password: PF_PASS, langId: 1 },
    noAuth: true,
    timeout: 15000,
  }).catch(e => ({ status: 0, body: '' }));

  console.log('[GPS] Login fallback status:', res2.status, res2.status === 200 ? '' : '| ' + res2.body.slice(0, 150));

  if (res2.status === 200) {
    try {
      const d = JSON.parse(res2.body);
      const tk = d.token || d.access_token;
      if (tk) {
        _token = tk;
        _tokenExp = d.expire
          ? new Date(d.expire).getTime() - 60000
          : Date.now() + 3600000 - 60000;
        console.log('[GPS] Token fallback OK');
        return true;
      }
    } catch(e) {}
  }

  return false;
}

// ── Obtener flota: GET /Fleetcore.Api/api/fleetview/vehicles
// Estructura de respuesta (del código Python):
//   data.fleet.groups[].vehicles[]
//   cada vehicle: { licensePlate, odometer, hourMeter, serialNumber, speed, ... }
async function fetchFleet() {
  // Probar con mayúsculas primero (igual que el Python) y luego minúsculas
  const paths = [
    '/Fleetcore.Api/api/fleetview/vehicles',
    '/fleetcore.api/api/fleetview/vehicles',
  ];

  for (const [i, path] of paths.entries()) {
    // El segundo path es el fallback en minúsculas. Que haga falta SÍ es un
    // evento: el proveedor devolvió algo raro por el camino normal.
    if (i > 0) console.log('[GPS] el path normal no sirvió; probando', path);
    const res = await httpsReq(path, { timeout: 12000 });

    if (res.status === 200 && res.body.length > 5) {
      try {
        const d = JSON.parse(res.body);

        // Estructura del Python: data.fleet.groups[].vehicles[]
        const groups = d?.data?.fleet?.groups || [];
        const vehicles = [];
        for (const g of groups) {
          for (const v of (g.vehicles || [])) {
            vehicles.push(v);
          }
        }
        if (vehicles.length > 0) {
          // El detalle de la respuesta (preview del JSON, keys del primer
          // vehículo) se emite SOLO la primera vez. Servía para descubrir la
          // forma de la API; repetirlo 720 veces por día entierra las líneas
          // que sí importan y las empuja fuera de la retención de logs.
          if (_primeraVez) {
            _primeraVez = false;
            console.log('[GPS] primera respuesta OK ·', path, '·', res.body.length, 'bytes');
            console.log('[GPS] campos por vehículo:', Object.keys(vehicles[0]).join(', '));
          }
          return vehicles;
        }

        // Estructura alternativa: array directo o Vehicles[]
        const alt = d.Vehicles || d.vehicles || d.data || (Array.isArray(d) ? d : []);
        if (alt.length > 0) {
          console.log('[GPS] estructura alternativa:', alt.length, 'vehículos');
          return alt;
        }

        console.log('[GPS] JSON sin vehículos por', path, '· keys:', Object.keys(d).join(', '));
      } catch(e) {
        console.log('[GPS] error parseando fleet:', e.message, '| raw:', res.body.slice(0, 200));
      }
    } else {
      // Fuera del camino feliz sí se quiere ver todo: es cuando hace falta.
      console.log('[GPS] fleet status', res.status, 'por', path,
        '| len:', res.body.length, res.partial ? '| parcial' : '',
        res.body.length ? '| ' + res.body.slice(0, 200) : '');
    }
  }
  return [];
}

// ── Obtener IO de un vehículo individual ───────────────────
// GET /Fleetcore.Api/api/io/{vehicleId}
// Respuesta: { data: { vehicle: { odometer, hourMeter, licensePlate, speed, ... } } }
async function fetchIO(vehicleId) {
  const paths = [
    `/Fleetcore.Api/api/io/${vehicleId}`,
    `/fleetcore.api/api/io/${vehicleId}`,
  ];
  for (const path of paths) {
    const res = await httpsReq(path, { timeout: 8000 });
    if (res.status === 200 && res.body.length > 5) {
      try {
        const d = JSON.parse(res.body);
        return d?.data?.vehicle || d?.vehicle || d?.data || null;
      } catch(e) {}
    }
  }
  return null;
}

// Estado de ignición (motor encendido) desde el endpoint IO. Devuelve 1, 0 o null.
// Busca la entrada "ignición" entre los inputs (igual criterio que el agente Python).
async function fetchIgnition(vehicleId) {
  const rt = process.env.PF_IO_RESOURCE_TYPE || '1';
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const paths = [
    `/Fleetcore.Api/api/io/${vehicleId}?resourceType=${rt}`,
    `/fleetcore.api/api/io/${vehicleId}?resourceType=${rt}`,
  ];
  for (const path of paths) {
    const res = await httpsReq(path, { timeout: 8000 });
    if (res.status === 200 && res.body.length > 5) {
      try {
        const d = JSON.parse(res.body);
        const inputs = d?.data?.inputs || d?.inputs || [];
        for (const item of inputs) {
          if (norm(item?.name) === 'ignicion' || norm(item?.name) === 'ignition') {
            const val = parseFloat(item?.value);
            if (!Number.isNaN(val)) return val >= 1 ? 1 : 0;
            const st = norm(item?.status);
            if (['encendida', 'encendido', 'activo', 'activa', 'on'].includes(st)) return 1;
            if (['apagada', 'apagado', 'inactivo', 'inactiva', 'off'].includes(st)) return 0;
            return 0;
          }
        }
      } catch(e) {}
    }
  }
  return null;
}

// ── Llamada autenticada genérica a la API ──────────────────
// Hace el login si hace falta y reintenta con las otras capitalizaciones del
// prefijo cuando la ruta da 404 (el proveedor no es consistente: /Fleetcore.Api,
// /Fleetcore.api y /fleetcore.api conviven según el endpoint).
// La usa el alta/baja de webhooks, para no repetir credenciales ni ciclo de token.
const _PREFIJO = /^\/[Ff]leet[Cc]ore\.[Aa]pi\//;
async function apiRequest(path, opts = {}) {
  if (!(await login())) return { status: 401, body: '', error: 'login fallido' };
  let res = await httpsReq(path, opts);
  if (res.status !== 404 || !_PREFIJO.test(path)) return res;
  for (const c of ['Fleetcore.Api', 'Fleetcore.api', 'fleetcore.api']) {
    const alt = path.replace(_PREFIJO, `/${c}/`);
    if (alt === path) continue;
    res = await httpsReq(alt, opts);
    if (res.status !== 404) return res;
  }
  return res;
}

// El token es un JWT: su payload trae el id de cuenta, que el alta de webhook
// pide y no está en ningún otro lado. Si no se puede leer, devuelve null y el
// script lo pide por parámetro.
function accountIdDelToken() {
  try {
    if (!_token) return null;
    const p = JSON.parse(Buffer.from(_token.split('.')[1], 'base64').toString('utf8'));
    for (const k of Object.keys(p)) {
      if (/^account_?id$/i.test(k)) return p[k];
    }
    return p.nameid || p.sub || null;
  } catch (_) { return null; }
}

// ── Asegurar columnas GPS en vehicles ──────────────────────
// Una sola vez por arranque, no en cada sync: son sentencias idempotentes, pero
// repetirlas cada 2 minutos es trabajo de base al pedo y toma locks sobre
// vehicles justo cuando el sync va a escribir sus 42 unidades.
let _colsReady = false;
async function ensureColumns() {
  if (_colsReady) return;
  try {
    await query(`ALTER TABLE vehicles
      ADD COLUMN IF NOT EXISTS gps_lat         NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS gps_lng         NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS gps_speed       NUMERIC(6,1) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS gps_status      VARCHAR(20)  DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS gps_hour_meter  NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS gps_updated_at  TIMESTAMPTZ,
      -- La respuesta de fleetview/vehicles ya trae la dirección de calle y el
      -- estado nativo de la unidad; se venían descartando. gps_status se sigue
      -- calculando como antes (speed > 2) para no cambiar nada de lo que ya
      -- consume el frontend: gps_state guarda el valor tal cual lo manda el GPS.
      ADD COLUMN IF NOT EXISTS gps_address     TEXT,
      ADD COLUMN IF NOT EXISTS gps_state       VARCHAR(30),
      -- Id interno de la unidad en Powerfleet. El sync ya lo tenía y lo tiraba.
      -- Hace falta para el webhook: si el aviso identifica la unidad por id y no
      -- por patente, sin esto no hay forma de saber de quién habla.
      ADD COLUMN IF NOT EXISTS gps_vehicle_id  VARCHAR(60)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_vehicles_gps_id ON vehicles(gps_vehicle_id) WHERE gps_vehicle_id IS NOT NULL`).catch(() => {});
    _colsReady = true;
  } catch(e) { /* ya existen */ }
}

// ── Sync principal ──────────────────────────────────────────
async function syncGPSData() {
  if (_running) return;
  _running = true;

  try {
    console.log('[GPS] === Inicio sync ===');
    _ioConsultados = 0;

    if (!(await login())) {
      _lastResult = { ok: false, error: 'Login fallido' };
      return;
    }

    const fleet = await fetchFleet();

    if (fleet.length === 0) {
      _lastResult = { ok: true, received: 0, updated: 0, note: 'Sin lista de vehículos de la API' };
      console.log('[GPS] Sin vehículos — verificar respuesta arriba');
      return;
    }

    await ensureColumns();

    let updated = 0;
    const log = [];

    const idleCandidates = [];
    for (const v of fleet) {
      // Campo licensePlate (del Python que ya funcionaba)
      const plate     = (v.licensePlate || v.Plate || v.PlateNo || v.plate || '').toString().trim();
      const vehicleId = v.vehicleId || v.VehicleId || v.id || v.Id || v.AssetId;
      let   km        = parseFloat(v.odometer || v.Odometer || v.OdometerKm || 0) || 0;
      let   hourMeter = parseFloat(v.hourMeter || v.HourMeter || v.hours || 0) || 0;
      const speed     = parseFloat(v.speed || v.Speed || v.CurrentSpeed || 0) || 0;
      const lat       = parseFloat(v.latitude  || v.Latitude  || v.lat  || 0) || null;
      const lng       = parseFloat(v.longitude || v.Longitude || v.lng  || 0) || null;
      // Dirección de calle y estado nativo ('parking', 'driving', ...): vienen en
      // la misma respuesta y hasta ahora se usaban solo para el ralentí.
      const address   = (v.address || v.Address || '').toString().trim() || null;
      const vState    = (v.vState  || v.VState  || '').toString().trim() || null;

      // Si la lista no trae km/horas y tenemos vehicleId, consultar /api/io/{vehicleId}
      if (vehicleId && (km === 0 || hourMeter === 0)) {
        const io = await fetchIO(vehicleId);
        if (io) {
          km        = parseFloat(io.odometer || io.Odometer || km) || km;
          hourMeter = parseFloat(io.hourMeter || io.HourMeter || hourMeter) || hourMeter;
          // Antes se logueaba una línea por unidad y por sync. Es información
          // de descubrimiento, no un evento: si el IO falla, fetchIO ya avisa.
          _ioConsultados++;
        }
      }

      const searchPlate = plate || '';
      if (!searchPlate) continue;
      // Ignorar si la patente es solo un número (ID interno del GPS, no una patente real)
      if (/^\d+$/.test(searchPlate)) {
        console.log('[GPS] Ignorando ID numérico:', searchPlate, '(no es patente)');
        continue;
      }

      const status = speed > 2 ? 'moving' : 'stopped';

      const r = await query(`
        UPDATE vehicles
        SET
          km_current     = CASE WHEN $1 > 0 THEN GREATEST(km_current, $1) ELSE km_current END,
          gps_lat        = COALESCE(NULLIF($3::text,'0')::numeric, gps_lat),
          gps_lng        = COALESCE(NULLIF($4::text,'0')::numeric, gps_lng),
          gps_speed      = $5,
          gps_status     = $6,
          gps_hour_meter = CASE WHEN $2 > 0 THEN $2 ELSE gps_hour_meter END,
          gps_address    = COALESCE($8, gps_address),
          gps_state      = COALESCE($9, gps_state),
          gps_vehicle_id = COALESCE($10, gps_vehicle_id),
          gps_updated_at = NOW()
        WHERE UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) =
              UPPER(REGEXP_REPLACE($7,    '[^A-Z0-9]', '', 'g'))
        RETURNING id, code, plate, base, type, km_current
      `, [km, hourMeter, lat, lng, speed, status, searchPlate, address, vState,
          vehicleId != null ? String(vehicleId) : null]);

      if (r.rows.length > 0) {
        updated++;
        log.push(`${r.rows[0].code}(${km}km/${Math.round(hourMeter)}h)`);
        // Eventos de exceso de velocidad (abre/actualiza/cierra + push). Fire-and-forget.
        speeding.processVehicle(r.rows[0], speed).catch(() => {});
        // Ralentí: si está detenido, es candidato (hay que ver la ignición vía IO,
        // se resuelve en paralelo al final). Si se mueve, cierra cualquier ralentí abierto.
        if (speed <= idle.IDLE_SPEED) {
          idleCandidates.push({ row: r.rows[0], speed, vehicleId, address });
        } else {
          idle.processVehicle(r.rows[0], speed, null).catch(() => {});
        }
      } else {
        // Vehículo no existe — crear con datos del GPS
        const cleanPlate = searchPlate.replace(/[^A-Z0-9]/gi,'').toUpperCase();
        const code = cleanPlate; // Usar patente como código provisional
        try {
          await query(
            `INSERT INTO vehicles (code, plate, brand, model, year, type, status, km_current, gps_status, gps_updated_at, active)
             VALUES ($1, $2, '—', '—', 2020, 'camion', 'ok', $3, $4, NOW(), TRUE)
             ON CONFLICT (plate) DO NOTHING`,
            [code, searchPlate, km||0, status]
          );
          log.push(`[NUEVO] ${searchPlate}(${km}km)`);
        } catch(e) { /* ignorar si ya existe */ }
      }
    }

    // Ralentí: resolver la ignición de las unidades detenidas (en paralelo) y registrar.
    await Promise.all(idleCandidates.map(async (c) => {
      const engineOn = c.vehicleId ? await fetchIgnition(c.vehicleId).catch(() => null) : null;
      await idle.processVehicle(c.row, c.speed, engineOn, c.address).catch(() => {});
    }));

    // Cerrar eventos de unidades que dejaron de reportar.
    speeding.closeStale().catch(() => {});
    idle.closeStale().catch(() => {});

    _lastSync   = new Date();
    _lastResult = {
      ok:       true,
      received: fleet.length,
      updated,
      sample:   fleet[0] ? {
        licensePlate: fleet[0].licensePlate,
        odometer:     fleet[0].odometer,
        hourMeter:    fleet[0].hourMeter,
      } : null,
    };
    // Una línea por sync. El volcado de las 42 unidades con patente, km y horas
    // era ~1.400 caracteres repetidos 720 veces por día: enterraba las líneas
    // que sí importan y las empujaba fuera de la retención de logs de Render.
    // Sale igual la primera vez (para poder confirmar que el mapeo de patentes
    // quedó bien) y cuando el conteo de unidades CAMBIA, que es lo que
    // significa que se sumó o desapareció un equipo.
    console.log(`[GPS] Sync OK: ${updated}/${fleet.length} actualizados` +
      (_ioConsultados ? ` (${_ioConsultados} por /api/io)` : ''));
    const cambioElConteo = _ultimoConteo !== null && _ultimoConteo !== updated;
    if (log.length && (_volcadoPendiente || cambioElConteo)) {
      if (cambioElConteo) console.log(`[GPS] el conteo cambió: ${_ultimoConteo} → ${updated}`);
      console.log('[GPS]', log.join(', '));
      _volcadoPendiente = false;
    }
    _ultimoConteo = updated;

  } catch(e) {
    console.log('[GPS] Error sync:', e.message);
    _lastResult = { ok: false, error: e.message };
  } finally {
    _running = false;
  }
}

// Intervalo del sync, configurable por entorno (GPS_SYNC_MINUTES). Piso de 1 min
// para no exigir de más a la API de Powerfleet. Menos minutos = alertas de
// velocidad más a tiempo, pero más consultas al proveedor.
let _intervalMin = 2;
function startGPSSync(intervalMin) {
  // Falla fuerte y temprano. Antes, sin variables, el servicio arrancaba igual
  // usando las credenciales del código; ahora avisa con todas las letras en vez
  // de intentar loguearse 720 veces por día contra una API con el usuario vacío.
  if (!credencialesOk()) {
    console.error('[GPS] ✗ NO ARRANCA: faltan GPS_USER / GPS_PASSWORD en el Environment.');
    console.error('[GPS]   Sin eso no hay posiciones, ni odómetro, ni horómetro, ni avisos');
    console.error('[GPS]   de velocidad o ralentí. Cargalas en Render → Environment.');
    return;
  }
  if (TLS_INSECURE) {
    console.warn('[GPS] ⚠ GPS_TLS_INSECURE=true: no se valida el certificado del proveedor.');
    console.warn('[GPS]   Por esta conexión viajan la contraseña y la posición de la flota.');
    console.warn('[GPS]   Es una salida de emergencia, no una configuración para dejar puesta.');
  }
  _intervalMin = Math.max(1, parseInt(intervalMin != null ? intervalMin : process.env.GPS_SYNC_MINUTES || '2', 10) || 2);
  console.log(`[GPS] Servicio iniciado. Sync cada ${_intervalMin} min`);
  setTimeout(syncGPSData, 15000);
  setInterval(syncGPSData, _intervalMin * 60 * 1000);
}

function getGPSStatus() {
  return {
    provider:   'Powerfleet Unity (Rusegur)',
    lastSync:   _lastSync,
    lastResult: _lastResult,
    hasToken:   !!_token,
    tokenExpIn: _tokenExp ? Math.round((_tokenExp - Date.now()) / 1000) + 's' : null,
    running:    _running,
    interval:   _intervalMin + ' min',
  };
}

module.exports = { startGPSSync, syncGPSData, getGPSStatus, apiRequest, login, accountIdDelToken };
