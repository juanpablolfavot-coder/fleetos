// ═══════════════════════════════════════════
//  FleetOS — Autenticación real con JWT
//  Gestión de sesión, roles, y carga inicial
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

async function _tryAutoLogin(attempt = 1) {
  const MAX_ATTEMPTS = 4;
  const errDiv = document.getElementById('login-error');
  const btn    = document.getElementById('btn-login');
  if (errDiv) errDiv.textContent = '';

  if (attempt === 1) {
    if (btn) { btn.disabled = true; btn.textContent = 'Conectando...'; }
  } else {
    if (btn) btn.textContent = `Conectando... (${attempt}/${MAX_ATTEMPTS})`;
  }

  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include'
    });

    if (!res.ok) {
      if (btn) { btn.disabled = false; btn.textContent = 'Ingresar al sistema'; }
      _showLoginForm();
      return;
    }

    const data = await res.json();
    if (!data.accessToken || !data.user) {
      if (btn) { btn.disabled = false; btn.textContent = 'Ingresar al sistema'; }
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

    const loginScreen = document.getElementById('login-screen');
    const appShell    = document.getElementById('app-shell');
    if (loginScreen) loginScreen.style.display = 'none';
    if (appShell)    appShell.style.display    = '';
    bootApp();

  } catch(e) {
    // Error de red — puede ser que Render está despertando (plan gratuito duerme)
    if (attempt < MAX_ATTEMPTS) {
      // Reintentar con backoff: 3s, 6s, 9s, 12s
      const delay = attempt * 3000;
      if (btn) btn.textContent = `Servidor iniciando, esperando ${delay/1000}s...`;
      setTimeout(() => _tryAutoLogin(attempt + 1), delay);
    } else {
      // Agotó los reintentos — mostrar login limpio
      if (btn) { btn.disabled = false; btn.textContent = 'Ingresar al sistema'; }
      if (errDiv) errDiv.textContent = '';
      _showLoginForm();
    }
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

let _authMode = 'login'; // 'login' | 'register'

function toggleAuthMode(e) {
  if (e) e.preventDefault();
  _authMode = _authMode === 'login' ? 'register' : 'login';
  const isReg = _authMode === 'register';

  const elTitle     = document.getElementById('auth-title');
  const elSub       = document.getElementById('auth-sub');
  const elLogin     = document.getElementById('login-form');
  const elRegister  = document.getElementById('register-form');
  const elToggleTxt = document.getElementById('auth-toggle-text');
  const elToggleLnk = document.getElementById('auth-toggle-link');
  const elLoginErr  = document.getElementById('login-error');
  const elRegErr    = document.getElementById('reg-error');
  const btn         = document.getElementById('btn-login');

  if (elTitle)     elTitle.textContent    = isReg ? 'Registrarse como chofer' : 'Iniciar sesión';
  if (elSub)       elSub.textContent      = isReg ? 'Tu cuenta quedará pendiente de aprobación.' : 'Ingresá con tu email y contraseña.';
  if (elLogin)     elLogin.style.display  = isReg ? 'none' : '';
  if (elRegister)  elRegister.style.display = isReg ? '' : 'none';
  if (elToggleTxt) elToggleTxt.textContent = isReg ? '¿Ya tenés cuenta?' : '¿Sos chofer y no tenés cuenta?';
  if (elToggleLnk) elToggleLnk.textContent = isReg ? 'Iniciá sesión' : 'Registrate acá';
  if (btn) {
    btn.textContent = isReg ? 'Solicitar acceso' : 'Ingresar al sistema';
    btn.onclick = isReg ? doRegister : doLogin;
  }
  if (elLoginErr) elLoginErr.textContent = '';
  if (elRegErr)   elRegErr.textContent = '';
}

async function doRegister() {
  const name     = document.getElementById('reg-name')?.value?.trim();
  const email    = document.getElementById('reg-email')?.value?.trim();
  const password = document.getElementById('reg-password')?.value;
  const vehicle  = document.getElementById('reg-vehicle')?.value?.trim();
  const errDiv   = document.getElementById('reg-error');
  const okDiv    = document.getElementById('reg-success');
  const btn      = document.getElementById('btn-login');

  if (errDiv) errDiv.textContent = '';
  if (okDiv)  okDiv.style.display = 'none';

  if (!name || !email || !password) {
    if (errDiv) errDiv.textContent = 'Completá todos los campos obligatorios';
    return;
  }
  if (password.length < 6) {
    if (errDiv) errDiv.textContent = 'La contraseña debe tener al menos 6 caracteres';
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Enviando solicitud...'; }
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, vehicle_code: vehicle || null })
    });
    const data = await res.json();
    if (!res.ok) {
      if (errDiv) errDiv.textContent = data.error || 'Error al registrarse';
      if (btn) { btn.disabled = false; btn.textContent = 'Solicitar acceso'; }
      return;
    }
    if (okDiv) {
      okDiv.textContent = '✓ Solicitud enviada. El administrador debe aprobar tu cuenta antes de que puedas ingresar.';
      okDiv.style.display = 'block';
    }
    if (btn) btn.textContent = 'Solicitud enviada';
    setTimeout(() => { toggleAuthMode(null); if (btn) btn.disabled = false; }, 4000);
  } catch(e) {
    if (errDiv) errDiv.textContent = 'Error de conexión';
    if (btn) { btn.disabled = false; btn.textContent = 'Solicitar acceso'; }
  }
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

    const loginScreen = document.getElementById('login-screen');
    const appShell    = document.getElementById('app-shell');
    if (loginScreen) loginScreen.style.display = 'none';
    if (appShell)    appShell.style.display    = '';
    bootApp();

  } catch(err) {
    console.error('[doLogin]', err);
    if (errorDiv) errorDiv.textContent = 'Error de conexión. Intentá de nuevo.';
    if (btn) { btn.disabled = false; btn.textContent = 'Ingresar al sistema'; }
  }
}

// ── API HELPER con token ──
// ═══════════════════════════════════════════════════════════
//  apiFetch con auto-refresh de datos
//  Después de cualquier POST/PUT/DELETE/PATCH exitoso, recarga la data en segundo plano.
//  Esto elimina la necesidad de Ctrl+F5 después de cargar algo.
// ═══════════════════════════════════════════════════════════

// Variables de control del auto-refresh
window._autoRefreshEnabled = true;   // Se puede deshabilitar temporalmente si molesta
window._autoRefreshTimer   = null;   // Debounce: agrupa múltiples llamadas seguidas
window._autoRefreshSuppressPatterns = [
  // No auto-refresh para estos endpoints (son internos o no cambian data visible)
  '/api/auth/',         // login/refresh/logout
  '/api/gps/',          // sync GPS es automático
  '/api/admin/backup',  // streaming de backup
];

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

  // Auto-refresh después de acciones exitosas de modificación
  const method = (options.method || 'GET').toUpperCase();
  const isWrite = method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';
  const isSuccess = res.ok;
  const shouldSkip = window._autoRefreshSuppressPatterns.some(p => url.startsWith(p));

  if (window._autoRefreshEnabled && isWrite && isSuccess && !shouldSkip) {
    // Debounce: si hay múltiples calls seguidos (ej: recibir OC que hace varios updates),
    // se agrupan y se hace UN solo refresh al final
    if (window._autoRefreshTimer) clearTimeout(window._autoRefreshTimer);
    window._autoRefreshTimer = setTimeout(async () => {
      try {
        if (typeof loadInitialData === 'function') {
          await loadInitialData();
        }
        // Re-renderizar la pantalla actual SOLO si no hay un modal abierto
        // (si el usuario tiene un modal abierto, no queremos interrumpirlo)
        const modalOpen = document.getElementById('modal-overlay')?.classList.contains('active')
                       || document.querySelector('.modal-overlay.active');
        if (!modalOpen && typeof renderPage === 'function' && window.App && App.currentPage) {
          try { renderPage(App.currentPage); } catch(e) { /* silent */ }
        }
      } catch(e) { /* silent — el usuario verá el estado anterior */ }
      window._autoRefreshTimer = null;
    }, 300);
  }

  return res;
};

function logout() {
  _clearToken();
  App.data = {};
  if (window._keepaliveInterval) {
    clearInterval(window._keepaliveInterval);
    window._keepaliveInterval = null;
  }
  const appShell = document.getElementById('app-shell');
  if (appShell) appShell.style.display = 'none';
  const ls = document.getElementById('login-screen');
  if (ls) ls.style.display = '';
  const emailEl = document.getElementById('login-email');
  const passEl  = document.getElementById('login-password');
  const errEl   = document.getElementById('login-error');
  if (emailEl) emailEl.value = '';
  if (passEl)  passEl.value  = '';
  if (errEl)   errEl.textContent = '';
  const btn = document.getElementById('btn-login');
  if (btn) { btn.disabled = false; btn.textContent = 'Ingresar al sistema'; }
  // Llamar al servidor para invalidar refresh token
  fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
}

// ── ROLES y PERMISOS ──
function getRoleData(role) {
  const roles = {
    dueno:                 { label:'Dueño / Dirección',       badge:'role-dueno',      modules:['dashboard','fleet','workorders','maintenance','fuel','tires','stock','purchase_orders','suppliers','assets','documents','costs','users','encargado_panel','contador_panel','auditor_panel'], canEdit:['all'] },
    gerencia:              { label:'Gerencia operativa',       badge:'role-gerencia',   modules:['encargado_panel','dashboard','fleet','workorders','maintenance','fuel','tires','stock','purchase_orders','suppliers','assets','documents','costs','users','contador_panel','auditor_panel'], canEdit:['all'] },
    jefe_mantenimiento:    { label:'Jefe de mantenimiento',    badge:'role-jefe',       modules:['dashboard','fleet','workorders','maintenance','tires','stock','purchase_orders','suppliers','assets','encargado_panel'], canEdit:['workorders','fleet','assets'] },
    mecanico:              { label:'Mecánico',                 badge:'role-mecanico',   modules:['dashboard','encargado_panel','workorders','tires','stock'], canEdit:['workorders'] },
    chofer:                { label:'Chofer',                   badge:'role-chofer',     modules:['chofer_panel'], canEdit:[] },
    encargado_combustible: { label:'Encargado combustible',    badge:'role-combustible',modules:['encargado_panel','dashboard','fuel'], canEdit:['fuel'] },
    paniol:                { label:'Depósito',                 badge:'role-stock',      modules:['stock','workorders','suppliers'], canEdit:['stock'] },
    contador:              { label:'Administración',           badge:'role-contador',   modules:['costs','documents','contador_panel','auditor_panel','suppliers'], canEdit:[] },
    auditor:               { label:'Auditor',                  badge:'role-auditor',    modules:['auditor_panel'], canEdit:[] },
    compras:               { label:'Compras',                  badge:'role-compras',    modules:['purchase_orders','suppliers'], canEdit:['purchase_orders'] },
    tesoreria:             { label:'Tesorería',                badge:'role-tesoreria',  modules:['purchase_orders'], canEdit:['purchase_orders'] },
  };
  return roles[role] || roles['auditor'];
}

function getRoleColor(role) {
  const map = {
    dueno:                 '#7c3aed',
    gerencia:              '#2563eb',
    jefe_mantenimiento:    '#d97706',
    mecanico:              '#0891b2',
    chofer:                '#16a34a',
    encargado_combustible: '#ea580c',
    paniol:                '#059669',
    contador:              '#db2777',
    auditor:               '#dc2626',
    compras:               '#0ea5e9',
    tesoreria:             '#14b8a6'
  };
  return map[role] || '#2563eb';
}

// ── ARRANCAR APP ──
function bootApp() {
  const u    = App.currentUser;
  const role = u.roleData;

  const un = document.querySelector('.user-info .user-name'); if(un) un.textContent = u.name;
  const ur = document.querySelector('.user-info .user-role'); if(ur) ur.textContent = role.label;
  const av = document.getElementById('user-avatar');
  if (av) {
    av.textContent = u.initials;
    av.style.background = getRoleColor(u.role);
  }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.onclick = logout;

  buildNavForRole(role);

  // Keepalive: ping cada 10 min para que Render no duerma el servidor
  // Usa apiFetch para que si el token expira se haga logout automático
  if (!window._keepaliveInterval) {
    window._keepaliveInterval = setInterval(() => {
      if (window.apiFetch) {
        window.apiFetch('/api/auth/me').catch(() => {});
      }
    }, 10 * 60 * 1000);
  }

  // Cargar datos iniciales desde la API
  loadInitialData().then(() => {
    if      (u.role === 'chofer')             navigate('chofer_panel');
    // Contador ahora arranca en 'costs' (unificado con el antiguo panel contable)
    else if (u.role === 'contador')           navigate('costs');
    else if (u.role === 'auditor')            navigate('auditor_panel');
    else if (u.role === 'compras')            navigate('purchase_orders');
    else if (u.role === 'tesoreria')          navigate('purchase_orders');
    // Los roles que antes iban a 'encargado_panel' ahora van a 'dashboard'
    // (el panel unificado incluye la actividad del día al final).
    else if (u.role === 'mecanico')           navigate('dashboard');
    else if (u.role === 'jefe_mantenimiento') navigate('dashboard');
    else if (u.role === 'gerencia')           navigate('dashboard');
    else if (u.role === 'dueno')              navigate('dashboard');
    else                                      navigate('dashboard');
  });
}

// ── MAPPERS: API → Frontend ──
// Separados en funciones para poder reutilizar y testear individualmente

function _mapTire(t) {
  // vehicle: string artificial que usa el frontend para filtrar
  // - Código de vehículo si está montada (ej: "INT-23")
  // - 'STOCK' si está en stock
  // - 'RECAPADO' si está en recapado
  // - 'BAJA' si está dada de baja
  const vehicle = t.status === 'stock'    ? 'STOCK'
                : t.status === 'baja'     ? 'BAJA'
                : t.status === 'recapado' ? 'RECAPADO'
                : (t.vehicle_code || 'STOCK');

  // condition: estado de desgaste basado en profundidad
  const tread = parseFloat(t.tread_depth) || 0;
  const condition = tread >= 4 ? 'ok' : tread >= 2 ? 'warn' : 'danger';

  return {
    id:              t.id,
    serial:          t.serial_no,
    brand:           t.brand,
    model:           t.model,
    size:            t.size,
    vehicle:         vehicle,
    pos:             t.current_position || null,
    position:        t.current_position || '—',
    physical_status: t.status,         // montada/stock/recapado/baja (DB real)
    condition:       condition,        // ok/warn/danger (por desgaste)
    status:          condition,        // compat: código viejo espera ok/warn/danger
    tread:           tread,
    km:              parseFloat(t.km_total) || 0,
    price:           parseFloat(t.purchase_price) || 0,
    notes:           t.notes || '',
    _raw:            t
  };
}

function _mapTireMovement(m) {
  // Formato esperado por renderTireHistory en app.js:
  // { date, serial, fromPos, toPos, type, vehicle, km, user, obs }
  const d = m.created_at ? new Date(m.created_at) : null;
  const dateStr = d
    ? d.toISOString().slice(0,16).replace('T',' ')
    : '—';
  return {
    id:      m.id,
    date:    dateStr,
    serial:  m.serial_no || '[eliminada]',
    fromPos: m.from_pos || '—',
    toPos:   m.to_pos   || '—',
    type:    m.type     || 'Movimiento',
    vehicle: m.vehicle_code || '—',
    km:      parseFloat(m.km_at_move) || 0,
    user:    m.user_name || '—',
    obs:     m.notes || '',
    _raw:    m,
  };
}

function _mapVehicle(v) {
  return {
    id:          v.id,
    code:        v.code,
    plate:       v.plate,
    brand:       v.brand,
    model:       v.model,
    year:        v.year,
    type:        v.type,
    status:      v.status || 'ok',
    km:          v.km_current || 0,
    base:        v.base || 'Central',
    driver:      v.driver_name || v.driver_name_joined || '—',
    cost_km:     parseFloat(v.cost_km) || 0,
    vin:         v.vin,
    engine_no:   v.engine_no,
    cost_center: v.cost_center,
    driver_id:   v.driver_id,
    gps_lat:     parseFloat(v.gps_lat)    || null,
    gps_lng:     parseFloat(v.gps_lng)    || null,
    gps_speed:   parseFloat(v.gps_speed)  || 0,
    gps_status:  v.gps_status || 'unknown',
    gps_updated: v.gps_updated_at || null,
    tech_spec:   v.tech_spec || {},
  };
}

function _mapWorkOrder(o) {
  return {
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
    closed_at:  o.closed_at || null,
    _id:        o.id,
    _uuid:      o.id,
  };
}

function _mapFuelLog(f) {
  return {
    id:           f.id,
    vehicle:      f.vehicle_code || '—',
    plate:        f.plate || '—',
    driver:       f.driver_name || '—',
    fuel_type:    f.fuel_type || 'diesel',
    liters:       parseFloat(f.liters) || 0,
    km:           f.odometer_km || 0,
    ppu:          parseFloat(f.price_per_l) || 0,
    total:        parseFloat(f.liters || 0) * parseFloat(f.price_per_l || 0),
    date:         f.logged_at ? f.logged_at.slice(0,16).replace('T',' ') : '—',
    place:        f.location || 'Cisterna',
    status:       'OK',
    ticket_image: f.ticket_image || null,
  };
}

function _mapStockItem(s) {
  return {
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
  };
}

// Movimientos del pañol — formato esperado por renderStock (app.js:3137)
// Backend devuelve: sm.*, si.item_name, si.unit, u.user_name
// Render espera:    { date, name, type, qty, unit, motivo, user }
function _mapStockMovement(m) {
  const d = m.created_at ? new Date(m.created_at) : null;
  const dateStr = d
    ? d.toISOString().slice(0,16).replace('T',' ')
    : '—';
  return {
    id:     m.id,
    date:   dateStr,
    name:   m.item_name || '[ítem eliminado]',
    type:   m.type || 'Movimiento',
    qty:    parseFloat(m.qty) || 0,
    unit:   m.unit || 'un',
    motivo: m.reason || '—',
    user:   m.user_name || '—',
  };
}

function _mapDocument(d) {
  const days = Math.ceil((new Date(d.expiry_date) - new Date()) / 86400000);
  const isUser = d.entity_type === 'user';

  // Etiqueta visible según el tipo de entidad
  let displayName, displaySub;
  if (isUser) {
    // Es un chofer/usuario
    displayName = d.user_name || '[Chofer eliminado]';
    displaySub  = d.user_vehicle_code || (d.user_role === 'chofer' ? 'Chofer' : (d.user_role || '—'));
  } else {
    // Es un vehículo (comportamiento histórico)
    displayName = d.vehicle_code || d.entity_label || '[Vehículo eliminado]';
    displaySub  = d.vehicle_plate || '—';
  }

  return {
    id:          d.id,
    entity_type: d.entity_type || 'vehicle',
    entity_id:   d.entity_id,
    // Campos compatibles con el render existente
    vehicle:     displayName,
    plate:       displaySub,
    // Info adicional para mostrar "chofer" vs "vehículo" en la UI
    isUser:      isUser,
    displayName: displayName,
    type:        d.doc_type,
    expiry:      d.expiry_date ? d.expiry_date.slice(0,10) : '',
    status:      days < 0 ? 'danger' : days < 30 ? 'warn' : 'ok',
    ref:         d.reference || '—',
  };
}

// ── CARGAR DATOS DESDE LA API ──
async function loadInitialData() {
  try {
    showToast('ok', 'Cargando datos...');

    // /api/users solo lo puede consumir dueño/gerencia (requireRole en el backend).
    // Para otros roles devolvemos un response "vacío" en vez de disparar un 403 que ensucia la consola.
    const canLoadUsers = ['dueno','gerencia'].includes(App.currentUser?.role);
    const usersFetch   = canLoadUsers ? apiFetch('/api/users') : Promise.resolve({ ok: false, json: async () => [] });

    const [vehiclesRes, workordersRes, fuelRes, stockRes, docsRes, configRes, tanksRes, usersRes, tiresRes, tireHistoryRes, suppliersRes, assetsRes, stockHistRes] = await Promise.all([
      apiFetch('/api/vehicles'),
      apiFetch('/api/workorders?limit=100'),
      apiFetch('/api/fuel?limit=100'),
      apiFetch('/api/stock'),
      apiFetch('/api/documents'),
      apiFetch('/api/config'),
      apiFetch('/api/fuel/tanks'),
      usersFetch,
      apiFetch('/api/tires'),
      apiFetch('/api/tires/history'),
      apiFetch('/api/suppliers'),
      apiFetch('/api/assets'),
      apiFetch('/api/stock/movements?limit=50'),
    ]);

    if (vehiclesRes?.ok)    App.data.vehicles    = await vehiclesRes.json();
    else App.data.vehicles = App.data.vehicles || [];

    if (usersRes?.ok)       App.data.users       = await usersRes.json();
    else App.data.users = App.data.users || [];

    if (tiresRes?.ok) {
      const rawTires = await tiresRes.json();
      App.data.tires = rawTires.map(_mapTire);
    } else {
      App.data.tires = App.data.tires || [];
    }
    if (tireHistoryRes?.ok) {
      const rawHist = await tireHistoryRes.json();
      App.data.tireHistory = rawHist.map(_mapTireMovement);
    } else {
      App.data.tireHistory = App.data.tireHistory || [];
    }
    if (workordersRes?.ok)  App.data.workOrders  = await workordersRes.json();
    else App.data.workOrders = App.data.workOrders || [];

    if (fuelRes?.ok)        App.data.fuelLogs    = await fuelRes.json();
    else App.data.fuelLogs = App.data.fuelLogs || [];

    if (stockRes?.ok)       App.data.stock       = await stockRes.json();
    else App.data.stock = App.data.stock || [];

    if (docsRes?.ok)        App.data.documents   = await docsRes.json();
    else App.data.documents = App.data.documents || [];

    if (tanksRes?.ok)       App.data.tanks       = await tanksRes.json();
    else App.data.tanks = App.data.tanks || [];

    if (suppliersRes?.ok)   App.data.suppliers   = await suppliersRes.json();
    else App.data.suppliers = App.data.suppliers || [];

    if (assetsRes?.ok)      App.data.assets      = await assetsRes.json();
    else App.data.assets = App.data.assets || [];

    // Historial de movimientos del pañol (Ingreso/Egreso/Ajuste/Baja)
    if (stockHistRes?.ok) {
      const rawHist = await stockHistRes.json();
      App.data.stockHistory = rawHist.map(_mapStockMovement);
    } else {
      App.data.stockHistory = App.data.stockHistory || [];
    }

    // Alias usado por algunos renders
    App.data.fuel = App.data.fuelLogs;
    App.data.purchaseOrders = App.data.purchaseOrders || [];
    if (configRes?.ok) {
      const cfg = await configRes.json();
      App.config = App.config || {};
      App.config.bases         = cfg.bases         || ['Central','Norte','Sur'];
      App.config.vehicle_types = cfg.vehicle_types || ['tractor','camion','semirremolque','acoplado','utilitario','autoelevador'];
      App.config.labor_rate    = parseFloat(cfg.labor_rate) || 0;
      App.config.areas         = cfg.areas         || {};
    }

    // Inicializar arrays si alguna API falló
    if (!App.data.vehicles)    App.data.vehicles    = [];
    if (!App.data.workOrders)  App.data.workOrders  = [];
    if (!App.data.fuelLogs)    App.data.fuelLogs    = [];
    if (!App.data.stock)       App.data.stock       = [];
    if (!App.data.documents)   App.data.documents   = [];
    if (!App.data.users)       App.data.users       = [];
    if (!App.data.suppliers)   App.data.suppliers   = [];
    if (!App.data.assets)      App.data.assets      = [];
    if (!App.data.tires || !App.data.tires.length) App.data.tires = [];
    if (!App.data.tireHistory) App.data.tireHistory = [];
    if (!App.data.stockHistory) App.data.stockHistory = [];
    if (!App.config) App.config = { bases: ['Central','Norte','Sur'], vehicle_types: ['tractor','camion','semirremolque','acoplado','utilitario','autoelevador'], labor_rate: 0 };
    if (App.config.labor_rate === undefined) App.config.labor_rate = 0;

    // Normalizar campos de la API al formato que usa el frontend
    App.data.vehicles   = App.data.vehicles.map(_mapVehicle);
    App.data.workOrders = App.data.workOrders.map(_mapWorkOrder);
    App.data.fuelLogs   = App.data.fuelLogs.map(_mapFuelLog);
    App.data.stock      = App.data.stock.map(_mapStockItem);
    App.data.documents  = App.data.documents.map(_mapDocument);

    showToast('ok', `${App.data.vehicles.length} vehículos · ${App.data.workOrders.length} OTs cargadas`);

    // Actualizar contador de unidades en el sidebar
    const logoSub = document.querySelector('.logo-sub');
    if (logoSub) logoSub.textContent = `v2.0 · ${App.data.vehicles.length} unidades`;
    const logoSubApp = document.getElementById('sidebar-fleet-count');
    if (logoSubApp) logoSubApp.textContent = `${App.data.vehicles.length} unidades`;

  } catch(err) {
    console.error('[loadInitialData]', err.message || err, err.stack);
    showToast('warn', 'Error cargando datos de la API');
    // Inicializar vacíos para que la app no crashee
    App.data.vehicles    = App.data.vehicles    || [];
    App.data.workOrders  = App.data.workOrders  || [];
    App.data.fuelLogs    = App.data.fuelLogs    || [];
    App.data.stock       = App.data.stock       || [];
    App.data.documents   = App.data.documents   || [];
    App.data.tires       = App.data.tires       || [];
    App.data.tireHistory = App.data.tireHistory || [];
    App.data.stockHistory = App.data.stockHistory || [];
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
