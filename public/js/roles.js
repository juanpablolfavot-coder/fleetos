// ═══════════════════════════════════════════
//  FleetOS — Autenticación real con JWT
// ═══════════════════════════════════════════

// Token JWT solo en memoria — la sesión se restaura con la cookie refreshToken
let _accessToken = null;

function _saveToken(token) {
  _accessToken = token;
  window._getToken = () => _accessToken;
}

function _clearToken() {
  _accessToken = null;
  window._getToken = () => null;
}

// ── LOGIN REAL ──
function initLogin() {
  // Intentar restaurar sesión automáticamente via cookie refreshToken (HttpOnly)
  _tryAutoLogin();
}

async function _tryAutoLogin() {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include'   // <-- envía la cookie automáticamente
    });

    if (!res.ok) {
      _showLoginForm();
      return;
    }

    const data = await res.json();
    if (!data.accessToken || !data.user) {
      _showLoginForm();
      return;
    }

    _saveToken(data.accessToken);
    const u = data.user;
    App.currentUser = {
      id:       u.id,
      name:     u.name,
      email:    u.email,
      role:     u.role,
      vehicle:  u.vehicle_code,
      initials: u.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase(),
      roleData: getRoleData(u.role),
    };

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-shell').style.display    = '';
    bootApp();

  } catch(e) {
    _showLoginForm();
  }
}

function _showLoginForm() {
  const btn  = document.getElementById('btn-login');
  const eml  = document.getElementById('login-email');
  const pwd  = document.getElementById('login-password');
  if (btn) btn.addEventListener('click', doLogin);
  [eml, pwd].forEach(el => {
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  });
}

async function doLogin() {
  const email    = document.getElementById('login-email')?.value?.trim();
  const password = document.getElementById('login-password')?.value;
  const errorDiv = document.getElementById('login-error');
  const btn      = document.getElementById('btn-login');

  if (!email || !password) {
    if (errorDiv) errorDiv.textContent = 'Ingresá email y contraseña';
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Ingresando...'; }
  if (errorDiv) errorDiv.textContent = '';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',   // <-- guarda la cookie refreshToken
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      if (errorDiv) errorDiv.textContent = data.error || 'Error al iniciar sesión';
      if (btn) { btn.disabled = false; btn.textContent = 'Ingresar al sistema'; }
      return;
    }

    _saveToken(data.accessToken);

    const u = data.user;
    App.currentUser = {
      id:       u.id,
      name:     u.name,
      email:    u.email,
      role:     u.role,
      vehicle:  u.vehicle_code,
      initials: u.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase(),
      roleData: getRoleData(u.role),
    };

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-shell').style.display    = '';
    bootApp();

  } catch(err) {
    if (errorDiv) errorDiv.textContent = 'Error de conexión. Intentá de nuevo.';
    if (btn) { btn.disabled = false; btn.textContent = 'Ingresar al sistema'; }
  }
}

// ── API HELPER con token ──
window.apiFetch = async function(url, options = {}) {
  const token = window._getToken ? window._getToken() : null;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    // Token expirado — volver al login
    logout();
    return null;
  }
  return res;
};

function logout() {
  _clearToken();
  App.data = {};
  document.getElementById('app-shell').style.display = 'none';
  const ls = document.getElementById('login-screen');
  ls.style.display = '';
  const emailEl = document.getElementById('login-email');
  const passEl  = document.getElementById('login-password');
  const errEl   = document.getElementById('login-error');
  if (emailEl) emailEl.value = '';
  if (passEl)  passEl.value  = '';
  if (errEl)   errEl.textContent = '';
  const btn = document.getElementById('btn-login');
  if (btn) { btn.disabled = false; btn.textContent = 'Ingresar al sistema'; }
  // Llamar al servidor para invalidar refresh token
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
}

// ── ROLES y PERMISOS ──
function getRoleData(role) {
  const roles = {
    dueno:                 { label:'Dueño / Dirección',       badge:'role-dueno',      modules:['dashboard','fleet','workorders','maintenance','fuel','tires','stock','documents','costs','users'], canEdit:['all'] },
    gerencia:              { label:'Gerencia operativa',       badge:'role-gerencia',   modules:['dashboard','fleet','workorders','maintenance','fuel','tires','stock','documents','costs','users'], canEdit:['all'] },
    jefe_mantenimiento:    { label:'Jefe de mantenimiento',    badge:'role-jefe',       modules:['dashboard','fleet','workorders','maintenance','tires','stock'], canEdit:['workorders','fleet'] },
    mecanico:              { label:'Mecánico',                 badge:'role-mecanico',   modules:['workorders','tires','stock'], canEdit:['workorders'] },
    chofer:                { label:'Chofer',                   badge:'role-chofer',     modules:['chofer_panel'], canEdit:[] },
    encargado_combustible: { label:'Encargado combustible',    badge:'role-combustible',modules:['dashboard','fuel'], canEdit:['fuel'] },
    paniol:                { label:'Pañol / Stock',            badge:'role-stock',      modules:['stock','workorders'], canEdit:['stock'] },
    contador:              { label:'Contador / Administración',badge:'role-contador',   modules:['costs','documents','contador_panel'], canEdit:[] },
    auditor:               { label:'Auditor',                  badge:'role-auditor',    modules:['dashboard','fleet','workorders','maintenance','fuel','tires','stock','documents','costs'], canEdit:[] },
  };
  return roles[role] || roles['auditor'];
}

function getRoleColor(role) {
  const map = { dueno:'#7c3aed', gerencia:'#2563eb', jefe_mantenimiento:'#d97706', mecanico:'#0891b2', chofer:'#16a34a', encargado_combustible:'#d97706', paniol:'#0891b2', contador:'#7c3aed', auditor:'#dc2626' };
  return map[role] || '#2563eb';
}

// ── ARRANCAR APP ──
function bootApp() {
  const u    = App.currentUser;
  const role = u.roleData;

  const un = document.querySelector('.user-info .user-name'); if(un) un.textContent = u.name;
  const ur = document.querySelector('.user-info .user-role'); if(ur) ur.textContent = role.label;
  const av = document.getElementById('user-avatar'); if(av) { av.textContent = u.initials; av.style.background = getRoleColor(u.role); }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.onclick = logout;

  buildNavForRole(role);

  // Cargar datos iniciales desde la API
  loadInitialData().then(() => {
    if (u.role === 'chofer') navigate('chofer_panel');
    else if (u.role === 'contador') navigate('contador_panel');
    else navigate('dashboard');
  });
}

// ── CARGAR DATOS DESDE LA API ──
async function loadInitialData() {
  try {
    showToast('info', 'Cargando datos...');

    const [vehiclesRes, workordersRes, fuelRes, stockRes, docsRes, configRes] = await Promise.all([
      apiFetch('/api/vehicles'),
      apiFetch('/api/workorders?limit=100'),
      apiFetch('/api/fuel?limit=100'),
      apiFetch('/api/stock'),
      apiFetch('/api/documents'),
      apiFetch('/api/config'),
    ]);

    if (vehiclesRes?.ok)    App.data.vehicles    = await vehiclesRes.json();
    if (workordersRes?.ok)  App.data.workOrders  = await workordersRes.json();
    if (fuelRes?.ok)        App.data.fuelLogs    = await fuelRes.json();
    if (stockRes?.ok)       App.data.stock       = await stockRes.json();
    if (docsRes?.ok)        App.data.documents   = await docsRes.json();
    if (configRes?.ok) {
      const cfg = await configRes.json();
      App.config = App.config || {};
      App.config.bases        = cfg.bases        || ['Central','Norte','Sur'];
      App.config.vehicle_types = cfg.vehicle_types || ['tractor','camion','semirremolque','acoplado','utilitario','autoelevador'];
    }

    // Inicializar arrays si alguna API falló
    if (!App.data.vehicles)   App.data.vehicles   = [];
    if (!App.data.workOrders) App.data.workOrders = [];
    if (!App.data.fuelLogs)   App.data.fuelLogs   = [];
    if (!App.data.stock)      App.data.stock      = [];
    if (!App.data.documents)  App.data.documents  = [];
    if (!App.data.tires)      App.data.tires      = [];
    if (!App.data.tireHistory) App.data.tireHistory = [];
    if (!App.data.stockHistory) App.data.stockHistory = [];
    if (!App.config)          App.config = { bases: ['Central','Norte','Sur'], vehicle_types: ['tractor','camion','semirremolque','acoplado','utilitario','autoelevador'] };

    // Normalizar campos de la API al formato que usa el frontend
    App.data.vehicles = App.data.vehicles.map(v => ({
      id:       v.id,
      code:     v.code,
      plate:    v.plate,
      brand:    v.brand,
      model:    v.model,
      year:     v.year,
      type:     v.type,
      status:   v.status || 'ok',
      km:       v.km_current || 0,
      base:     v.base || 'Central',
      driver:   v.driver_name || v.driver_name_joined || '—',
      cost_km:  parseFloat(v.cost_km) || 0,
      vin:      v.vin,
      engine_no:v.engine_no,
      cost_center: v.cost_center,
      driver_id:  v.driver_id,
      gps_lat:    parseFloat(v.gps_lat)    || null,
      gps_lng:    parseFloat(v.gps_lng)    || null,
      gps_speed:  parseFloat(v.gps_speed)  || 0,
      gps_status: v.gps_status || 'unknown',
      gps_updated: v.gps_updated_at || null,
      tech_spec:  v.tech_spec || {},
    }));

    App.data.workOrders = App.data.workOrders.map(o => ({
      id:         o.code || o.id,
      vehicle:    o.vehicle_code || '—',
      plate:      o.plate || '—',
      type:       o.type || 'Correctivo',
      status:     o.status || 'Pendiente',
      priority:   o.priority || 'Normal',
      desc:       o.description || '—',
      mechanic:   o.mechanic_name || '—',
      opened:     o.opened_at ? o.opened_at.slice(0,16).replace('T',' ') : '—',
      closed:     o.closed_at ? o.closed_at.slice(0,16).replace('T',' ') : null,
      causa_raiz: o.root_cause || '',
      parts:      [],
      parts_cost: parseFloat(o.parts_cost) || 0,
      labor_cost: parseFloat(o.labor_cost) || 0,
      _id:        o.id,
    }));

    App.data.fuelLogs = App.data.fuelLogs.map(f => ({
      id:      f.id,
      vehicle: f.vehicle_code || '—',
      plate:   f.plate || '—',
      driver:  f.driver_name || '—',
      liters:  parseFloat(f.liters) || 0,
      km:      f.odometer_km || 0,
      ppu:     parseFloat(f.price_per_l) || 0,
      total:   parseFloat(f.liters || 0) * parseFloat(f.price_per_l || 0),
      date:    f.logged_at ? f.logged_at.slice(0,16).replace('T',' ') : '—',
      place:   f.location || 'Cisterna',
      status:  'OK',
    }));

    App.data.stock = App.data.stock.map(s => ({
      id:       s.id,
      code:     s.code,
      name:     s.name,
      cat:      s.category || 'General',
      unit:     s.unit || 'un',
      qty:      parseFloat(s.qty_current) || 0,
      min:      parseFloat(s.qty_min) || 1,
      reorder:  parseFloat(s.qty_reorder) || 2,
      cost:     parseFloat(s.unit_cost) || 0,
      supplier: s.supplier || '—',
    }));

    App.data.documents = App.data.documents.map(d => {
      const days = Math.ceil((new Date(d.expiry_date) - new Date()) / 86400000);
      return {
        id:      d.id,
        vehicle: d.entity_id,
        type:    d.doc_type,
        expiry:  d.expiry_date?.slice(0,10),
        status:  days < 0 ? 'danger' : days < 30 ? 'warn' : 'ok',
        ref:     d.reference || '—',
        plate:   '—',
      };
    });

    showToast('ok', `${App.data.vehicles.length} vehículos · ${App.data.workOrders.length} OTs cargadas`);

    // Actualizar contador de unidades en el sidebar
    const logoSub = document.querySelector('.logo-sub');
    if (logoSub) logoSub.textContent = `v2.0 · ${App.data.vehicles.length} unidades`;
    const logoSubApp = document.getElementById('sidebar-fleet-count');
    if (logoSubApp) logoSubApp.textContent = `${App.data.vehicles.length} unidades`;

  } catch(err) {
    console.error('Error cargando datos:', err);
    showToast('warn', 'Error cargando datos de la API');
    // Inicializar vacíos para que la app no crashee
    App.data.vehicles   = App.data.vehicles   || [];
    App.data.workOrders = App.data.workOrders || [];
    App.data.fuelLogs   = App.data.fuelLogs   || [];
    App.data.stock      = App.data.stock      || [];
    App.data.documents  = App.data.documents  || [];
    App.data.tires      = [];
    App.data.tireHistory= [];
    App.data.stockHistory=[];
  }
}

function buildNavForRole(role) {
  document.querySelectorAll('.nav-item').forEach(item => {
    const page = item.dataset.page;
    if (!page) return;
    const allowed = role.modules.includes(page) || role.modules.includes('all');
    item.style.display = allowed ? '' : 'none';
  });
}

// ── PANEL CHOFER (simplificado para login real) ──
function renderChoferPanel() {
  const u = App.currentUser;
  const root = document.getElementById('page-chofer_panel');
  if (!root) return;
  root.innerHTML = `
    <div style="max-width:480px;margin:0 auto">
      <div class="card" style="text-align:center;padding:24px;margin-bottom:16px">
        <div style="font-size:28px;font-weight:700;color:var(--accent);font-family:monospace">${u.vehicle || 'Sin unidad'}</div>
        <div style="font-size:13px;color:var(--text3);margin-top:4px">${u.name}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="card" style="cursor:pointer;text-align:center;padding:20px" onclick="navigate('workorders')">
          <div style="font-size:24px">⚠</div>
          <div style="font-size:12px;font-weight:600;margin-top:6px">Reportar novedad</div>
        </div>
        <div class="card" style="cursor:pointer;text-align:center;padding:20px" onclick="navigate('fuel')">
          <div style="font-size:24px">⛽</div>
          <div style="font-size:12px;font-weight:600;margin-top:6px">Cargar combustible</div>
        </div>
      </div>
    </div>`;
}

// ── PANEL CONTADOR ──
function renderContadorPanel() {
  navigate('costs');
}

