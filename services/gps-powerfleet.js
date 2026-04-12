// ═══════════════════════════════════════════════════════════
//  FleetOS — Integración GPS Powerfleet (Rusegur)
//  Estrategia: login con cookie + streaming con timeout
// ═══════════════════════════════════════════════════════════

const https  = require('https');
const http   = require('http');
const { query } = require('../db/pool');

const PF_HOST = 'rusegur.monitoreodeflotas.com.ar';
const PF_USER = process.env.GPS_USER     || 'EBiletta';
const PF_PASS = process.env.GPS_PASSWORD || 'EBiletta26';

let _cookies     = '';   // cookies de sesión
let _lastSync    = null;
let _lastResult  = null;
let _running     = false;

// ── Hacer request HTTPS con cookies ────────────────────────
function makeRequest(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: PF_HOST,
      port: 443,
      path,
      method: opts.method || 'GET',
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': `https://${PF_HOST}`,
        'Referer': `https://${PF_HOST}/FLEET/Connect.aspx/fleet`,
        ...(_cookies ? { 'Cookie': _cookies } : {}),
        ...(opts.headers || {}),
      },
    };

    const bodyStr = opts.body ? JSON.stringify(opts.body) : null;
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    let data = '';
    const req = https.request(options, (res) => {
      // Capturar cookies
      const sc = res.headers['set-cookie'];
      if (sc) {
        const newCookies = sc.map(c => c.split(';')[0]).join('; ');
        _cookies = _cookies ? `${_cookies}; ${newCookies}` : newCookies;
      }

      // Para long-poll: leer datos con timeout
      const timer = opts.streamTimeout ? setTimeout(() => req.destroy(), opts.streamTimeout) : null;

      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (timer) clearTimeout(timer);
        resolve({ status: res.status || res.statusCode, body: data, headers: res.headers });
      });
    });

    req.on('error', (e) => {
      // 'socket hang up' o 'ECONNRESET' pueden venir de streamTimeout — eso es OK
      if (data.length > 0) {
        resolve({ status: 200, body: data, partial: true });
      } else {
        reject(e);
      }
    });

    const totalTimer = setTimeout(() => {
      req.destroy();
      if (data.length > 0) {
        resolve({ status: 200, body: data, partial: true });
      } else {
        resolve({ status: 408, body: '', timeout: true });
      }
    }, opts.timeout || 30000);

    req.on('close', () => clearTimeout(totalTimer));

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Parsear JSON posiblemente parcial/streaming ─────────────
function parseVehiclesResponse(raw) {
  if (!raw || !raw.trim()) return [];

  // Intentar JSON normal primero
  try {
    const d = JSON.parse(raw);
    return d.Vehicles || d.vehicles || d.data || d.Items || 
           (Array.isArray(d) ? d : []);
  } catch(e) {}

  // JSON parcial — buscar el array de Vehicles
  const match = raw.match(/"Vehicles"\s*:\s*(\[[\s\S]*)/);
  if (match) {
    try {
      // Intentar cerrar el JSON parcial
      let arr = match[1];
      // Encontrar el último objeto completo
      let depth = 0, lastComplete = 0;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] === '{') depth++;
        if (arr[i] === '}') { depth--; if (depth === 0) lastComplete = i; }
      }
      if (lastComplete > 0) {
        const completed = arr.slice(0, lastComplete + 1) + ']';
        return JSON.parse(completed);
      }
    } catch(e2) {}
  }

  return [];
}

// ── Login en Powerfleet ─────────────────────────────────────
async function login() {
  _cookies = '';
  console.log('[GPS] Conectando a Powerfleet...');

  try {
    // Paso 1: GET página login para obtener cookies iniciales
    const page = await makeRequest('/FLEET/Connect.aspx/', { timeout: 10000 });
    console.log('[GPS] Página login status:', page.status, '| Cookies:', _cookies.length, 'chars');

    // Paso 2: POST login
    const loginRes = await makeRequest('/fleetcore.api/api/user/login', {
      method: 'POST',
      body: { Username: PF_USER, Password: PF_PASS, RememberMe: false },
      timeout: 10000,
    });
    console.log('[GPS] Login status:', loginRes.status, '| Cookies:', _cookies.length, 'chars');
    console.log('[GPS] Login body:', loginRes.body.slice(0, 200));

    if (loginRes.status === 200 && _cookies.length > 20) {
      return true;
    }

    // Paso 3: Intentar login vía endpoint alternativo
    const login2 = await makeRequest('/fleetcore.api/api/user/authenticate', {
      method: 'POST',
      body: { Username: PF_USER, Password: PF_PASS },
      timeout: 10000,
    });
    console.log('[GPS] Login2 status:', login2.status, '| body:', login2.body.slice(0,100));

    return _cookies.length > 20;
  } catch(e) {
    console.log('[GPS] Error login:', e.message);
    return false;
  }
}

// ── Obtener vehículos con streaming ────────────────────────
async function fetchVehicles() {
  // El endpoint usa long-poll — leer con timeout de 10s
  // isUpdate=0 pide todos los vehículos, no solo cambios
  const paths = [
    '/fleetcore.api/api/fleetview/vehicles?isUpdate=0&vehicles=0&alertCount=1&si=1&lastEventIdReceived=0',
    '/fleetcore.api/api/fleetview/vehicles?alertCount=0&si=1',
    '/fleetcore.api/api/fleetview/assets',
  ];

  for (const path of paths) {
    try {
      console.log('[GPS] Probando:', path);
      const res = await makeRequest(path, {
        timeout:       12000,  // 12 segundos máximo
        streamTimeout: 10000,  // cortar stream a los 10s
      });

      console.log(`[GPS] Status: ${res.status} | Len: ${res.body.length} | Partial: ${!!res.partial} | Timeout: ${!!res.timeout}`);

      if (res.body.length > 10) {
        console.log('[GPS] Body preview:', res.body.slice(0, 300));
        const vehicles = parseVehiclesResponse(res.body);
        if (vehicles.length > 0) {
          console.log(`[GPS] ${vehicles.length} vehículos encontrados via ${path}`);
          return vehicles;
        }
      }
    } catch(e) {
      console.log(`[GPS] Error en ${path}:`, e.message);
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

// ── Sync principal ─────────────────────────────────────────
async function syncGPSData() {
  if (_running) return;
  _running = true;

  try {
    console.log('[GPS] === Inicio sync ===');

    // Login si no tenemos cookies
    if (!_cookies || _cookies.length < 20) {
      const ok = await login();
      if (!ok) {
        _lastResult = { ok: false, error: 'Login fallido', cookies: _cookies.length };
        return;
      }
    }

    // Obtener vehículos
    let vehicles = await fetchVehicles();

    // Re-login si falló
    if (vehicles.length === 0) {
      console.log('[GPS] 0 vehículos — re-login...');
      _cookies = '';
      const ok = await login();
      if (ok) vehicles = await fetchVehicles();
    }

    if (vehicles.length === 0) {
      console.log('[GPS] Sin vehículos recibidos');
      _lastResult = { ok: true, received: 0, updated: 0, note: 'API no devolvió vehículos' };
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
          gps_lat        = COALESCE($2, gps_lat),
          gps_lng        = COALESCE($3, gps_lng),
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
    _lastResult = { ok: true, received: vehicles.length, updated, keys: Object.keys(vehicles[0] || {}).join(',') };
    console.log(`[GPS] Sync OK: ${updated}/${vehicles.length} actualizados`);
    if (log.length) console.log('[GPS]', log.join(', '));

  } catch(e) {
    console.log('[GPS] Error sync:', e.message);
    _lastResult = { ok: false, error: e.message };
  } finally {
    _running = false;
  }
}

// ── Arrancar el sync periódico ─────────────────────────────
function startGPSSync(intervalMin = 5) {
  console.log(`[GPS] Servicio GPS iniciado. Sync cada ${intervalMin} min`);
  setTimeout(syncGPSData, 12000);   // primer sync 12s después de arrancar
  setInterval(syncGPSData, intervalMin * 60 * 1000);
}

function getGPSStatus() {
  return {
    provider:   'Powerfleet Unity (Rusegur)',
    lastSync:   _lastSync,
    lastResult: _lastResult,
    hasSession: _cookies.length > 20,
    running:    _running,
    interval:   '5 min',
    cookiesLen: _cookies.length,
  };
}

module.exports = { startGPSSync, syncGPSData, getGPSStatus };
