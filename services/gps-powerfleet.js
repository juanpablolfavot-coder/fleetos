// ═══════════════════════════════════════════════════════════
//  FleetOS — Integración GPS Powerfleet (Rusegur)
//  Auth: POST /token (OAuth2 Bearer)
//  Data: Fleet API /api/fleetview/vehicles
// ═══════════════════════════════════════════════════════════

const https  = require('https');
const { query } = require('../db/pool');

const PF_HOST = 'rusegur.monitoreodeflotas.com.ar';
const PF_BASE = '/fleetcore.api';
const PF_USER = process.env.GPS_USER     || 'EBiletta';
const PF_PASS = process.env.GPS_PASSWORD || 'EBiletta26';

let _token      = null;   // Bearer token
let _tokenExp   = null;   // expiración del token
let _lastSync   = null;
let _lastResult = null;
let _running    = false;

// ── Request HTTPS genérico ──────────────────────────────────
function httpsRequest(path, opts = {}) {
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
    if (_token) headers['Authorization'] = `Bearer ${_token}`;

    const reqOpts = {
      hostname:           PF_HOST,
      port:               443,
      path:               PF_BASE + path,
      method:             opts.method || 'GET',
      headers,
      rejectUnauthorized: false,
    };

    let data = '';
    const req = https.request(reqOpts, res => {
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    const timer = setTimeout(() => {
      req.destroy();
      if (data.length > 10) resolve({ status: 200, body: data, partial: true });
      else resolve({ status: 408, body: '', timeout: true });
    }, opts.timeout || 15000);

    req.on('error', e => {
      clearTimeout(timer);
      if (data.length > 10) resolve({ status: 200, body: data, partial: true });
      else reject(e);
    });
    req.on('close', () => clearTimeout(timer));

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Obtener Bearer token (OAuth2 password grant) ────────────
async function getToken() {
  // Si el token es válido, reutilizarlo
  if (_token && _tokenExp && Date.now() < _tokenExp) return true;

  console.log('[GPS] Obteniendo token Bearer...');
  console.log('[GPS] URL token: https://'+PF_HOST+PF_BASE+'/token');

  // OAuth2 password grant — formato application/x-www-form-urlencoded
  const body = `grant_type=password&username=${encodeURIComponent(PF_USER)}&password=${encodeURIComponent(PF_PASS)}`;

  // Guardar y limpiar token actual para que no se incluya en el request de login
  const savedToken = _token;
  _token = null;

  const res = await httpsRequest('/token', {
    method:      'POST',
    body,
    contentType: 'application/x-www-form-urlencoded',
    timeout:     12000,
  }).catch(e => ({ status: 0, body: '', error: e.message }));

  console.log('[GPS] Token status:', res.status, '| body:', res.body.slice(0, 200));

  if (res.status === 200) {
    try {
      const d = JSON.parse(res.body);
      _token    = d.access_token;
      _tokenExp = Date.now() + ((d.expires_in || 3600) * 1000) - 60000; // 1 min antes
      console.log('[GPS] Token OK. Expira en:', d.expires_in, 'seg');
      return true;
    } catch(e) {
      console.log('[GPS] Error parseando token:', e.message);
    }
  }

  // Fallback: intentar con JSON body
  _token = null;
  const res2 = await httpsRequest('/token', {
    method:  'POST',
    body:    JSON.stringify({ grant_type: 'password', username: PF_USER, password: PF_PASS }),
    timeout: 12000,
  }).catch(e => ({ status: 0, body: '' }));

  console.log('[GPS] Token JSON status:', res2.status, '| body:', res2.body.slice(0,150));

  if (res2.status === 200) {
    try {
      const d = JSON.parse(res2.body);
      const tk = d.access_token || d.token || d.accessToken || d.bearer;
      console.log('[GPS] Token keys:', Object.keys(d).join(', '));
      if (tk) {
        _token    = tk;
        _tokenExp = Date.now() + ((d.expires_in || d.expiresIn || 3600) * 1000) - 60000;
        console.log('[GPS] Token OK! Primeros 30 chars:', tk.slice(0,30));
        return true;
      }
    } catch(e) {}
  }

  return false;
}

// ── Obtener vehículos desde Fleet API ──────────────────────
async function fetchVehicles() {
  // Según la documentación:
  // GET /api/fleetview/vehicles — vista de flota en tiempo real
  // Intentar primero sin long-poll usando parámetros mínimos

  const endpoints = [
    // Sin isUpdate — debería devolver todos los vehículos de una vez
    '/api/fleetview/vehicles',
    // Con parámetros específicos
    '/api/fleetview/vehicles?isUpdate=0&vehicles=0&alertCount=0&si=1',
    // Assets list (no posición en tiempo real)
    '/api/fleetview/assets',
    // Route history para odómetro
    '/api/routehistory/vehicles',
  ];

  for (const ep of endpoints) {
    try {
      console.log('[GPS] GET', ep);
      const res = await httpsRequest(ep, { timeout: 12000 });

      console.log('[GPS] Status:', res.status, '| Len:', res.body.length, '| Partial:', !!res.partial);
      if (res.body.length > 5) console.log('[GPS] Preview:', res.body.slice(0,300));

      if (res.status === 200 && res.body.length > 5) {
        try {
          const d = JSON.parse(res.body);
          const arr = d.Vehicles || d.vehicles || d.Assets || d.assets || 
                      d.data || d.Data || (Array.isArray(d) ? d : []);
          if (arr.length > 0) {
            console.log(`[GPS] ${arr.length} vehículos via ${ep}`);
            console.log('[GPS] Keys del primer vehículo:', Object.keys(arr[0]).join(', '));
            return arr;
          }
        } catch(e) {
          // JSON parcial o no es JSON — ignorar
        }
      }
    } catch(e) {
      console.log('[GPS] Error en', ep, ':', e.message);
    }
  }

  return [];
}

// ── Asegurar columnas GPS en vehicles ──────────────────────
async function ensureColumns() {
  try {
    await query(`ALTER TABLE vehicles
      ADD COLUMN IF NOT EXISTS gps_lat        NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS gps_lng        NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS gps_speed      NUMERIC(6,1) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS gps_status     VARCHAR(20)  DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS gps_updated_at TIMESTAMPTZ`);
  } catch(e) { /* ya existen */ }
}

// ── Sync principal ──────────────────────────────────────────
async function syncGPSData() {
  if (_running) return;
  _running = true;

  try {
    console.log('[GPS] === Inicio sync ===');

    // Obtener token
    const ok = await getToken();
    if (!ok) {
      _lastResult = { ok: false, error: 'No se pudo obtener token Bearer' };
      console.log('[GPS] Sin token — abortando sync');
      return;
    }

    // Obtener vehículos
    const vehicles = await fetchVehicles();

    if (vehicles.length === 0) {
      _lastResult = { ok: true, received: 0, updated: 0, note: 'API sin datos de vehículos' };
      return;
    }

    await ensureColumns();

    let updated = 0;
    const log = [];

    for (const v of vehicles) {
      const plate  = (v.Plate || v.PlateNo || v.LicensePlate || v.plate || '').toString().trim();
      const km     = parseFloat(v.Odometer || v.OdometerKm || v.TotalDistance || v.odometer || v.km || 0) || 0;
      const speed  = parseFloat(v.Speed || v.CurrentSpeed || v.speed || 0) || 0;
      const lat    = parseFloat(v.Latitude  || v.lat  || 0) || null;
      const lng    = parseFloat(v.Longitude || v.lng  || 0) || null;
      const status = speed > 2 ? 'moving' : 'stopped';

      if (!plate) continue;

      const r = await query(`
        UPDATE vehicles
        SET
          km_current     = CASE WHEN $1 > 0 THEN GREATEST(km_current, $1) ELSE km_current END,
          gps_lat        = COALESCE(NULLIF($2::text,'0')::numeric, gps_lat),
          gps_lng        = COALESCE(NULLIF($3::text,'0')::numeric, gps_lng),
          gps_speed      = $4,
          gps_status     = $5,
          gps_updated_at = NOW()
        WHERE UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) =
              UPPER(REGEXP_REPLACE($6,    '[^A-Z0-9]', '', 'g'))
        RETURNING id, code, plate, km_current
      `, [km, lat, lng, speed, status, plate]);

      if (r.rows.length > 0) {
        updated++;
        log.push(`${r.rows[0].code}(${km}km/${Math.round(speed)}kmh)`);
      }
    }

    _lastSync   = new Date();
    _lastResult = {
      ok:       true,
      received: vehicles.length,
      updated,
      keys:     Object.keys(vehicles[0] || {}).join(',').slice(0, 100),
    };
    console.log(`[GPS] Sync OK: ${updated}/${vehicles.length} actualizados`);
    if (log.length) console.log('[GPS]', log.join(', '));

  } catch(e) {
    console.log('[GPS] Error sync:', e.message);
    _lastResult = { ok: false, error: e.message };
  } finally {
    _running = false;
  }
}

// ── Arrancar el sync periódico ──────────────────────────────
function startGPSSync(intervalMin = 5) {
  console.log(`[GPS] Servicio GPS iniciado. Sync cada ${intervalMin} min`);
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
