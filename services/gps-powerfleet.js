// ═══════════════════════════════════════════════════════════
//  FleetOS — Integración GPS Powerfleet (Rusegur)
//  Actualiza km y posición de vehículos desde la API de Powerfleet
// ═══════════════════════════════════════════════════════════

const https  = require('https');
const { query } = require('../db/pool');

const PF_BASE = 'rusegur.monitoreodeflotas.com.ar';
const PF_USER = process.env.GPS_USER     || 'EBiletta';
const PF_PASS = process.env.GPS_PASSWORD || 'EBiletta26';

let _sessionCookies = null;
let _lastSync       = null;
let _lastResult     = null;
let _syncRunning    = false;

// ── Request HTTPS con cookies de sesión ─────────────────────
function pfRequest(path, method = 'GET', body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: PF_BASE,
      path,
      method,
      rejectUnauthorized: false,
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'User-Agent':    'Mozilla/5.0 (FleetOS GPS Sync)',
        ...(_sessionCookies ? { Cookie: _sessionCookies } : {}),
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...extraHeaders,
      },
    };

    const req = https.request(opts, (res) => {
      // Acumular cookies
      const sc = res.headers['set-cookie'];
      if (sc && sc.length) {
        const newCookies = sc.map(c => c.split(';')[0]).join('; ');
        _sessionCookies = _sessionCookies
          ? _sessionCookies + '; ' + newCookies
          : newCookies;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
        catch(e) { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
      });
    });

    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout GPS')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Login en Powerfleet ──────────────────────────────────────
async function pfLogin() {
  try {
    console.log('[GPS] Iniciando sesión en Powerfleet...');

    // Obtener cookies iniciales
    await pfRequest('/FLEET/Connect.aspx/', 'GET').catch(() => {});

    // Login vía API interna
    const r1 = await pfRequest('/fleetcore.api/api/user/login', 'POST',
      { Username: PF_USER, Password: PF_PASS, RememberMe: false });

    if (r1.status === 200) {
      console.log('[GPS] Login OK');
      return true;
    }

    // Fallback: login vía web form
    const r2 = await pfRequest('/FLEET/Connect.aspx/Login', 'POST',
      { user: PF_USER, password: PF_PASS });

    if (r2.status === 200 || r2.status === 302) {
      console.log('[GPS] Login alternativo OK');
      return true;
    }

    console.log('[GPS] Login fallido. Status:', r1.status);
    return false;
  } catch(e) {
    console.log('[GPS] Error login:', e.message);
    return false;
  }
}

// ── Obtener vehículos desde Powerfleet ──────────────────────
async function pfGetVehicles() {
  const r = await pfRequest(
    '/fleetcore.api/api/fleetview/vehicles?isUpdate=0&vehicles=0&alertCount=1&si=1&lastEventIdReceived=0'
  );
  if (r.status !== 200) return null;
  return r.body.Vehicles || r.body.vehicles || r.body.data || [];
}

// ── Asegurar columnas GPS en la tabla vehicles ───────────────
async function ensureGPSColumns() {
  try {
    await query(`
      ALTER TABLE vehicles
        ADD COLUMN IF NOT EXISTS gps_lat        NUMERIC(10,7),
        ADD COLUMN IF NOT EXISTS gps_lng        NUMERIC(10,7),
        ADD COLUMN IF NOT EXISTS gps_speed      NUMERIC(6,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS gps_status     VARCHAR(20)  DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS gps_updated_at TIMESTAMPTZ;
    `);
  } catch(e) {
    // Columnas ya existen — OK
  }
}

// ── Sync principal ───────────────────────────────────────────
async function syncGPSData() {
  if (_syncRunning) return;
  _syncRunning = true;

  try {
    console.log('[GPS] Sincronizando con Powerfleet...');

    if (!_sessionCookies) {
      if (!(await pfLogin())) {
        _lastResult = { ok: false, error: 'Login fallido' };
        return;
      }
    }

    let vehicles = await pfGetVehicles();

    if (!vehicles) {
      // Sesión expirada — reintentar
      _sessionCookies = null;
      if (!(await pfLogin())) {
        _lastResult = { ok: false, error: 'Login fallido en reintento' };
        return;
      }
      vehicles = await pfGetVehicles();
    }

    if (!vehicles || vehicles.length === 0) {
      console.log('[GPS] Sin vehículos recibidos');
      _lastResult = { ok: true, received: 0, updated: 0 };
      return;
    }

    await ensureGPSColumns();

    let updated = 0;
    const details = [];

    for (const v of vehicles) {
      // Normalizar campos de Powerfleet (distintas versiones usan distintos nombres)
      const plate  = (v.Plate || v.PlateNo || v.LicensePlate || v.plate || '').trim();
      const km     = parseFloat(v.Odometer || v.OdometerKm || v.TotalDistance || v.km || 0) || 0;
      const speed  = parseFloat(v.Speed || v.CurrentSpeed || v.speed || 0) || 0;
      const lat    = parseFloat(v.Latitude  || v.lat  || 0) || null;
      const lng    = parseFloat(v.Longitude || v.lng  || 0) || null;
      const status = speed > 3 ? 'moving' : 'stopped';

      if (!plate) continue;

      // Actualizar vehículo por patente (normalizada sin espacios ni guiones)
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
        details.push({ plate, km, speed, status, code: r.rows[0].code });
      }
    }

    _lastSync   = new Date();
    _lastResult = { ok: true, received: vehicles.length, updated, details };
    console.log(`[GPS] Sync OK: ${updated}/${vehicles.length} vehículos actualizados`);
    if (details.length) console.log('[GPS] Actualizados:', details.map(d => `${d.code}(${d.km}km)`).join(', '));

  } catch(e) {
    console.log('[GPS] Error sync:', e.message);
    _lastResult = { ok: false, error: e.message };
  } finally {
    _syncRunning = false;
  }
}

// ── Arrancar el sync periódico ───────────────────────────────
function startGPSSync(intervalMinutes = 5) {
  console.log(`[GPS] Servicio iniciado. Intervalo: ${intervalMinutes} min`);
  setTimeout(syncGPSData, 15000);                              // primer sync a los 15 seg
  setInterval(syncGPSData, intervalMinutes * 60 * 1000);       // luego cada N minutos
}

// ── Status para el endpoint de API ──────────────────────────
function getGPSStatus() {
  return {
    provider:   'Powerfleet Unity (Rusegur)',
    lastSync:   _lastSync,
    lastResult: _lastResult,
    hasSession: !!_sessionCookies,
    running:    _syncRunning,
    interval:   '5 min',
  };
}

module.exports = { startGPSSync, syncGPSData, getGPSStatus };
