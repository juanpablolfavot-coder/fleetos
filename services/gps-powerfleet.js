// ═══════════════════════════════════════════════════════════
//  FleetOS — Integración GPS Powerfleet (Rusegur)
//  Basado en código Python que ya funcionaba con esta misma API
//  Auth:  POST /Fleetcore.Api/token {username, password, langId:1}
//  Fleet: GET  /Fleetcore.Api/api/fleetview/vehicles
//         → data.fleet.groups[].vehicles[] con licensePlate, odometer, hourMeter
// ═══════════════════════════════════════════════════════════

const https  = require('https');
const { query } = require('../db/pool');

const PF_HOST = 'rusegur.monitoreodeflotas.com.ar';
const PF_USER = process.env.GPS_USER     || 'EBiletta';
const PF_PASS = process.env.GPS_PASSWORD || 'EBiletta26';

let _token    = null;
let _tokenExp = null;
let _lastSync = null;
let _lastResult = null;
let _running  = false;

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
      headers, rejectUnauthorized: false,
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

  console.log('[GPS] Login Powerfleet...');
  const res = await httpsReq('/Fleetcore.Api/token', {
    method:  'POST',
    body:    { username: PF_USER, password: PF_PASS, langId: 1 },
    noAuth:  true,
    timeout: 15000,
  }).catch(e => ({ status: 0, body: '' }));

  console.log('[GPS] Login status:', res.status, '| body:', res.body.slice(0, 150));

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

  console.log('[GPS] Login fallback status:', res2.status, '| body:', res2.body.slice(0,100));

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

  for (const path of paths) {
    console.log('[GPS] GET', path);
    const res = await httpsReq(path, { timeout: 12000 });

    console.log('[GPS] Fleet status:', res.status, '| len:', res.body.length, '| partial:', !!res.partial);
    if (res.body.length > 0) console.log('[GPS] Fleet preview:', res.body.slice(0, 300));

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
          console.log('[GPS] Vehículos encontrados:', vehicles.length);
          console.log('[GPS] Keys 1er vehículo:', Object.keys(vehicles[0]).join(', '));
          return vehicles;
        }

        // Estructura alternativa: array directo o Vehicles[]
        const alt = d.Vehicles || d.vehicles || d.data || (Array.isArray(d) ? d : []);
        if (alt.length > 0) {
          console.log('[GPS] Vehículos (alt):', alt.length);
          return alt;
        }

        console.log('[GPS] JSON recibido pero sin vehículos. Keys:', Object.keys(d).join(', '));
      } catch(e) {
        console.log('[GPS] Error parseando fleet:', e.message, '| raw:', res.body.slice(0,100));
      }
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

// ── Asegurar columnas GPS en vehicles ──────────────────────
async function ensureColumns() {
  try {
    await query(`ALTER TABLE vehicles
      ADD COLUMN IF NOT EXISTS gps_lat         NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS gps_lng         NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS gps_speed       NUMERIC(6,1) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS gps_status      VARCHAR(20)  DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS gps_hour_meter  NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS gps_updated_at  TIMESTAMPTZ`);
  } catch(e) { /* ya existen */ }
}

// ── Sync principal ──────────────────────────────────────────
async function syncGPSData() {
  if (_running) return;
  _running = true;

  try {
    console.log('[GPS] === Inicio sync ===');

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

    for (const v of fleet) {
      // Campo licensePlate (del Python que ya funcionaba)
      const plate     = (v.licensePlate || v.Plate || v.PlateNo || v.plate || '').toString().trim();
      const vehicleId = v.vehicleId || v.VehicleId || v.id || v.Id || v.AssetId;
      let   km        = parseFloat(v.odometer || v.Odometer || v.OdometerKm || 0) || 0;
      let   hourMeter = parseFloat(v.hourMeter || v.HourMeter || v.hours || 0) || 0;
      const speed     = parseFloat(v.speed || v.Speed || v.CurrentSpeed || 0) || 0;
      const lat       = parseFloat(v.latitude  || v.Latitude  || v.lat  || 0) || null;
      const lng       = parseFloat(v.longitude || v.Longitude || v.lng  || 0) || null;

      // Si la lista no trae km/horas y tenemos vehicleId, consultar /api/io/{vehicleId}
      if (vehicleId && (km === 0 || hourMeter === 0)) {
        const io = await fetchIO(vehicleId);
        if (io) {
          km        = parseFloat(io.odometer || io.Odometer || km) || km;
          hourMeter = parseFloat(io.hourMeter || io.HourMeter || hourMeter) || hourMeter;
          console.log(`[GPS] IO ${vehicleId}: km=${km} h=${hourMeter}`);
        }
      }

      const searchPlate = plate || '';
      if (!searchPlate) continue;

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
          gps_updated_at = NOW()
        WHERE UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) =
              UPPER(REGEXP_REPLACE($7,    '[^A-Z0-9]', '', 'g'))
        RETURNING id, code, plate, km_current
      `, [km, hourMeter, lat, lng, speed, status, searchPlate]);

      if (r.rows.length > 0) {
        updated++;
        log.push(`${r.rows[0].code}(${km}km/${Math.round(hourMeter)}h)`);
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
    console.log(`[GPS] Sync OK: ${updated}/${fleet.length} actualizados`);
    if (log.length) console.log('[GPS]', log.join(', '));

  } catch(e) {
    console.log('[GPS] Error sync:', e.message);
    _lastResult = { ok: false, error: e.message };
  } finally {
    _running = false;
  }
}

function startGPSSync(intervalMin = 5) {
  console.log(`[GPS] Servicio iniciado. Sync cada ${intervalMin} min`);
  setTimeout(syncGPSData, 15000);
  setInterval(syncGPSData, intervalMin * 60 * 1000);
}

function getGPSStatus() {
  return {
    provider:   'Powerfleet Unity (Rusegur)',
    lastSync:   _lastSync,
    lastResult: _lastResult,
    hasToken:   !!_token,
    tokenExpIn: _tokenExp ? Math.round((_tokenExp - Date.now()) / 1000) + 's' : null,
    running:    _running,
    interval:   '5 min',
  };
}

module.exports = { startGPSSync, syncGPSData, getGPSStatus };
