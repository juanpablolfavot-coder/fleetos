// ═══════════════════════════════════════════════════════════
//  FleetOS — Integración GPS Powerfleet (Rusegur)
//  Auth: POST /token → Bearer
//  Vehículos: GET /api/fleetview/vehicles → IDs
//  Datos: GET /api/io/{vehicleId} → odometer + hourMeter
// ═══════════════════════════════════════════════════════════

const https  = require('https');
const { query } = require('../db/pool');

const PF_HOST = 'rusegur.monitoreodeflotas.com.ar';
const PF_BASE = '/fleetcore.api';
const PF_USER = process.env.GPS_USER     || 'EBiletta';
const PF_PASS = process.env.GPS_PASSWORD || 'EBiletta26';

let _token    = null;
let _tokenExp = null;
let _lastSync = null;
let _lastResult = null;
let _running  = false;

// ── Request HTTPS ───────────────────────────────────────────
function req(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = opts.body || null;
    const headers = {
      'Accept':     'application/json',
      'User-Agent': 'FleetOS/1.0',
      ...(opts.headers || {}),
    };
    if (bodyStr) {
      headers['Content-Type']   = opts.contentType || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    if (_token && !opts.noAuth) headers['Authorization'] = `Bearer ${_token}`;

    const options = {
      hostname: PF_HOST, port: 443,
      path: PF_BASE + path,
      method: opts.method || 'GET',
      headers, rejectUnauthorized: false,
    };

    let data = '';
    const request = https.request(options, res => {
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    const timer = setTimeout(() => {
      request.destroy();
      resolve({ status: 408, body: data || '', timeout: true });
    }, opts.timeout || 10000);

    request.on('error', e => {
      clearTimeout(timer);
      data.length > 5 ? resolve({ status: 200, body: data, partial: true }) : reject(e);
    });
    request.on('close', () => clearTimeout(timer));

    if (bodyStr) request.write(bodyStr);
    request.end();
  });
}

// ── Login → Bearer token ────────────────────────────────────
async function login() {
  if (_token && _tokenExp && Date.now() < _tokenExp) return true;

  _token = null;
  console.log('[GPS] Login Powerfleet...');

  // Según la documentación: POST /token con JSON body
  const res = await req('/token', {
    method:  'POST',
    body:    JSON.stringify({ username: PF_USER, password: PF_PASS, langId: 1 }),
    noAuth:  true,
    timeout: 12000,
  }).catch(e => ({ status: 0, body: '' }));

  console.log('[GPS] Token status:', res.status, '| body:', res.body.slice(0, 150));

  if (res.status === 200) {
    try {
      const d = JSON.parse(res.body);
      const tk = d.token || d.access_token || d.accessToken;
      if (tk) {
        _token    = tk;
        // Calcular expiración desde el campo "expire" (ISO) o expires_in (seg)
        if (d.expire) {
          _tokenExp = new Date(d.expire).getTime() - 60000;
        } else {
          _tokenExp = Date.now() + (d.expires_in || 3600) * 1000 - 60000;
        }
        console.log('[GPS] Token OK. Expira:', new Date(_tokenExp).toISOString());
        return true;
      }
    } catch(e) { console.log('[GPS] Parse error:', e.message); }
  }

  return false;
}

// ── Obtener lista de vehículos (IDs y patentes) ─────────────
async function getVehicleList() {
  console.log('[GPS] Obteniendo lista de vehículos...');

  // fleetview/vehicles con timeout corto — solo quiero los IDs
  // si hace long-poll, vamos a AEMP que es estático
  const res = await req('/api/fleetview/vehicles', { timeout: 8000 });

  console.log('[GPS] Fleet status:', res.status, '| len:', res.body.length, '| timeout:', !!res.timeout);
  if (res.body.length > 10) console.log('[GPS] Fleet preview:', res.body.slice(0,200));

  if (res.status === 200 && res.body.length > 5) {
    try {
      const d = JSON.parse(res.body);
      const arr = d.Vehicles || d.vehicles || d.data || (Array.isArray(d) ? d : []);
      if (arr.length > 0) {
        console.log('[GPS] Fleet:', arr.length, 'vehículos. Keys:', Object.keys(arr[0]).join(',').slice(0,80));
        return arr;
      }
    } catch(e) {}
  }

  return [];
}

// ── Obtener datos IO de un vehículo (odómetro + horómetro) ──
async function getVehicleIO(vehicleId) {
  const res = await req(`/api/io/${vehicleId}`, { timeout: 8000 });
  if (res.status !== 200 || !res.body) return null;
  try {
    const d = JSON.parse(res.body);
    return d.data?.vehicle || d.vehicle || d.data || d;
  } catch(e) { return null; }
}

// ── Asegurar columnas GPS ───────────────────────────────────
async function ensureColumns() {
  try {
    await query(`ALTER TABLE vehicles
      ADD COLUMN IF NOT EXISTS gps_lat         NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS gps_lng         NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS gps_speed       NUMERIC(6,1) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS gps_status      VARCHAR(20)  DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS gps_hour_meter  NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS gps_updated_at  TIMESTAMPTZ`);
  } catch(e) {}
}

// ── Sync principal ──────────────────────────────────────────
async function syncGPSData() {
  if (_running) return;
  _running = true;

  try {
    console.log('[GPS] === Sync inicio ===');

    if (!(await login())) {
      _lastResult = { ok: false, error: 'Login fallido' };
      return;
    }

    // Obtener lista de vehículos
    const fleetList = await getVehicleList();

    if (fleetList.length === 0) {
      // Sin lista de vehículos — no podemos hacer nada
      _lastResult = { ok: true, received: 0, updated: 0, note: 'Sin lista de vehículos de la API' };
      console.log('[GPS] Sin vehículos en la lista — verificar API');
      return;
    }

    await ensureColumns();

    let updated = 0;
    const log = [];

    for (const v of fleetList) {
      // Datos básicos de la lista
      const vehicleId = v.VehicleId || v.vehicleId || v.Id || v.id || v.AssetId;
      const plate     = (v.Plate || v.PlateNo || v.LicensePlate || v.plate || v.Description || '').toString().trim();
      const speed     = parseFloat(v.Speed || v.CurrentSpeed || 0) || 0;
      const lat       = parseFloat(v.Latitude  || v.lat  || 0) || null;
      const lng       = parseFloat(v.Longitude || v.lng  || 0) || null;

      if (!plate && !vehicleId) continue;

      // Obtener odómetro y horómetro del endpoint /api/io/{vehicleId}
      let km = parseFloat(v.Odometer || v.odometer || v.OdometerKm || 0) || 0;
      let hourMeter = 0;

      if (vehicleId && km === 0) {
        // Si la lista no trae el odómetro, consultar el endpoint IO
        const io = await getVehicleIO(vehicleId);
        if (io) {
          km        = parseFloat(io.odometer || io.Odometer || 0) || 0;
          hourMeter = parseFloat(io.hourMeter || io.HourMeter || io.hours || 0) || 0;
          if (!plate && io.licensePlate) plate = io.licensePlate;
          console.log(`[GPS] IO ${vehicleId}: plate=${io.licensePlate} km=${km} h=${hourMeter}`);
        }
      }

      const status = speed > 2 ? 'moving' : 'stopped';
      const searchPlate = plate || (vehicleId?.toString() || '');

      if (!searchPlate) continue;

      const r = await query(`
        UPDATE vehicles
        SET
          km_current       = CASE WHEN $1 > 0 THEN GREATEST(km_current, $1) ELSE km_current END,
          gps_lat          = COALESCE(NULLIF($2::text,'0')::numeric, gps_lat),
          gps_lng          = COALESCE(NULLIF($3::text,'0')::numeric, gps_lng),
          gps_speed        = $4,
          gps_status       = $5,
          gps_hour_meter   = CASE WHEN $6 > 0 THEN $6 ELSE gps_hour_meter END,
          gps_updated_at   = NOW()
        WHERE UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) =
              UPPER(REGEXP_REPLACE($7,    '[^A-Z0-9]', '', 'g'))
        RETURNING id, code, plate, km_current
      `, [km, lat, lng, speed, status, hourMeter, searchPlate]);

      if (r.rows.length > 0) {
        updated++;
        log.push(`${r.rows[0].code}(${km}km)`);
      }
    }

    _lastSync   = new Date();
    _lastResult = {
      ok:       true,
      received: fleetList.length,
      updated,
      keys:     Object.keys(fleetList[0] || {}).join(',').slice(0,100),
    };
    console.log(`[GPS] Sync OK: ${updated}/${fleetList.length} actualizados`);
    if (log.length) console.log('[GPS]', log.join(', '));

  } catch(e) {
    console.log('[GPS] Error:', e.message);
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
