// ═══════════════════════════════════════════
//  FleetOS — Sistema de usuarios y roles
// ═══════════════════════════════════════════

// ── DEFINICIÓN DE ROLES ──
const ROLES = {
  dueno: {
    label: 'Dueño / Dirección',
    badge: 'role-dueno',
    icon: '◈',
    desc: 'Acceso total al sistema',
    initials: (n) => n.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase(),
    modules: ['dashboard','fleet','workorders','maintenance','fuel','tires','stock','documents','costs'],
    canCreate:   ['workorders','fuel','vehicles','stock','documents','maintenance'],
    canEdit:     ['all'],
    canApprove:  ['all'],
    canSeeCosts: true,
    canExport:   true,
  },
  gerencia: {
    label: 'Gerencia operativa',
    badge: 'role-gerencia',
    icon: '⊡',
    desc: 'Gestión completa operativa',
    modules: ['dashboard','fleet','workorders','maintenance','fuel','tires','stock','documents','costs'],
    canCreate:   ['workorders','fuel','vehicles','stock','documents','maintenance'],
    canEdit:     ['all'],
    canApprove:  ['workorders','stock'],
    canSeeCosts: true,
    canExport:   true,
  },
  jefe_mantenimiento: {
    label: 'Jefe de mantenimiento',
    badge: 'role-jefe',
    icon: '◷',
    desc: 'Taller, OT y mantenimiento',
    modules: ['dashboard','fleet','workorders','maintenance','tires','stock'],
    canCreate:   ['workorders','maintenance'],
    canEdit:     ['workorders','maintenance','fleet'],
    canApprove:  ['workorders'],
    canSeeCosts: true,
    canExport:   false,
  },
  mecanico: {
    label: 'Mecánico',
    badge: 'role-mecanico',
    icon: '○',
    desc: 'OT asignadas y stock',
    modules: ['workorders','tires','stock'],
    canCreate:   [],
    canEdit:     ['workorders'],
    canApprove:  [],
    canSeeCosts: false,
    canExport:   false,
  },
  chofer: {
    label: 'Chofer',
    badge: 'role-chofer',
    icon: '◎',
    desc: 'Reportes y cargas desde móvil',
    modules: ['chofer_panel'],
    canCreate:   ['workorders','fuel'],
    canEdit:     [],
    canApprove:  [],
    canSeeCosts: false,
    canExport:   false,
  },
  encargado_combustible: {
    label: 'Encargado combustible',
    badge: 'role-combustible',
    icon: '◈',
    desc: 'Cisternas, cargas y stock',
    modules: ['dashboard','fuel'],
    canCreate:   ['fuel'],
    canEdit:     ['fuel'],
    canApprove:  ['fuel'],
    canSeeCosts: false,
    canExport:   false,
  },
  paniol: {
    label: 'Pañol / Stock',
    badge: 'role-stock',
    icon: '▦',
    desc: 'Gestión de inventario',
    modules: ['stock','workorders'],
    canCreate:   ['stock'],
    canEdit:     ['stock'],
    canApprove:  ['stock'],
    canSeeCosts: false,
    canExport:   false,
  },
  contador: {
    label: 'Contador / Administración',
    badge: 'role-contador',
    icon: '◻',
    desc: 'Costos, reportes y KPIs',
    modules: ['costs','documents','contador_panel'],
    canCreate:   [],
    canEdit:     [],
    canApprove:  [],
    canSeeCosts: true,
    canExport:   true,
  },
  auditor: {
    label: 'Auditor',
    badge: 'role-auditor',
    icon: '◈',
    desc: 'Solo lectura — todo el sistema',
    modules: ['dashboard','fleet','workorders','maintenance','fuel','tires','stock','documents','costs'],
    canCreate:   [],
    canEdit:     [],
    canApprove:  [],
    canSeeCosts: true,
    canExport:   true,
  },
};

// ── USUARIOS DE DEMO ──
const DEMO_USERS = [
  { id:1, name:'Roberto Méndez',   role:'dueno',                 initials:'RM', vehicle: null },
  { id:2, name:'Laura Gómez',      role:'gerencia',              initials:'LG', vehicle: null },
  { id:3, name:'Marcelo Ibáñez',   role:'jefe_mantenimiento',    initials:'MI', vehicle: null },
  { id:4, name:'Carlos Rodríguez', role:'mecanico',              initials:'CR', vehicle: null },
  { id:5, name:'Juan Pérez',       role:'chofer',                initials:'JP', vehicle: 'INT-01' },
  { id:6, name:'Diego Flores',     role:'chofer',                initials:'DF', vehicle: 'INT-23' },
  { id:7, name:'Ana Torres',       role:'encargado_combustible', initials:'AT', vehicle: null },
  { id:8, name:'Norberto Vega',    role:'paniol',                initials:'NV', vehicle: null },
  { id:9, name:'Patricia Ruiz',    role:'contador',              initials:'PR', vehicle: null },
  { id:10,name:'Eduardo Soria',    role:'auditor',               initials:'ES', vehicle: null },
];

// ── LOGIN ──
function initLogin() {
  const screen = document.getElementById('login-screen');
  const roleGrid = document.getElementById('role-grid');
  const userSelect = document.getElementById('user-select');
  const btnLogin = document.getElementById('btn-login');
  let selectedRole = null;

  // Renderizar tarjetas de roles
  const rolesShow = ['dueno','gerencia','jefe_mantenimiento','mecanico','chofer','encargado_combustible','paniol','contador'];
  roleGrid.innerHTML = rolesShow.map(rk => {
    const r = ROLES[rk];
    return `<div class="role-card" data-role="${rk}" onclick="selectRole('${rk}')">
      <span class="rc-icon">${r.icon}</span>
      <span class="rc-name">${r.label}</span>
      <span class="rc-desc">${r.desc}</span>
    </div>`;
  }).join('');

  window.selectRole = function(roleKey) {
    selectedRole = roleKey;
    document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`.role-card[data-role="${roleKey}"]`).classList.add('selected');
    // Llenar usuarios de ese rol
    const users = DEMO_USERS.filter(u => u.role === roleKey);
    userSelect.innerHTML = users.map(u => `<option value="${u.id}">${u.name}${u.vehicle ? ' — ' + u.vehicle : ''}</option>`).join('');
    userSelect.style.display = 'block';
    document.getElementById('user-select-label').style.display = 'block';
    btnLogin.disabled = false;
  };

  btnLogin.onclick = function() {
    if (!selectedRole) return;
    const uid = parseInt(userSelect.value);
    const user = DEMO_USERS.find(u => u.id === uid);
    if (!user) return;
    App.currentUser = {
      id: user.id,
      name: user.name,
      role: user.role,
      roleData: ROLES[user.role],
      initials: user.initials,
      vehicle: user.vehicle,
    };
    screen.classList.add('hidden');
    document.getElementById('app-shell').style.display = '';
    bootApp();
  };

  // Enter key
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && selectedRole) btnLogin.click();
  });
}

// ── ARRANCAR APP SEGÚN ROL ──
function bootApp() {
  const u = App.currentUser;
  const role = u.roleData;

  // Actualizar topbar y sidebar
  document.querySelector('.user-info .user-name').textContent = u.name;
  document.querySelector('.user-info .user-role').textContent = role.label;
  document.querySelector('.user-avatar').textContent = u.initials;
  document.querySelector('.user-avatar').style.background = getRoleColor(u.role);

  // Badge de rol en topbar
  const existing = document.getElementById('role-badge-topbar');
  if (existing) existing.remove();
  const badge = document.createElement('span');
  badge.id = 'role-badge-topbar';
  badge.className = `role-badge ${role.badge}`;
  badge.textContent = role.label;
  document.querySelector('.topbar-actions').prepend(badge);

  // Botón logout
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('app-shell').style.display = 'none';
      // Reset selección
      document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
      document.getElementById('user-select').style.display = 'none';
      document.getElementById('user-select-label').style.display = 'none';
      document.getElementById('btn-login').disabled = true;
    };
  }

  // Mostrar/ocultar nav items según rol
  buildNavForRole(role);

  // Navegar a página inicial según rol
  if (u.role === 'chofer') {
    navigate('chofer_panel');
  } else if (u.role === 'contador') {
    navigate('contador_panel');
  } else {
    navigate('dashboard');
  }
}

function getRoleColor(role) {
  const map = {
    dueno:'#7c3aed', gerencia:'#2563eb', jefe_mantenimiento:'#d97706',
    mecanico:'#0891b2', chofer:'#16a34a', encargado_combustible:'#d97706',
    paniol:'#0891b2', contador:'#7c3aed', auditor:'#dc2626'
  };
  return map[role] || '#2563eb';
}

function buildNavForRole(role) {
  document.querySelectorAll('.nav-item').forEach(item => {
    const page = item.dataset.page;
    if (!page) return;
    const allowed = role.modules.includes(page) || role.modules.includes('all');
    item.style.display = allowed ? '' : 'none';
  });
  // Mostrar nav items de chofer/contador especiales
  document.querySelectorAll('.nav-item[data-page="chofer_panel"]').forEach(el => {
    el.style.display = role.modules.includes('chofer_panel') ? '' : 'none';
  });
  document.querySelectorAll('.nav-item[data-page="contador_panel"]').forEach(el => {
    el.style.display = role.modules.includes('contador_panel') ? '' : 'none';
  });
}

// ── HELPER: verificar permiso ──
function canDo(action, module) {
  const role = App.currentUser?.roleData;
  if (!role) return false;
  if (role.canCreate.includes('all') || role.canEdit.includes('all')) return true;
  if (action === 'create') return role.canCreate.includes(module);
  if (action === 'edit')   return role.canEdit.includes(module);
  if (action === 'approve')return role.canApprove.includes(module);
  return false;
}

// ── PANEL DEL CHOFER ──
function renderChoferPanel() {
  const u           = App.currentUser;
  const vehicleCode = u.vehicle || 'INT-01';
  const vehicle     = App.data.vehicles.find(v=>v.code===vehicleCode) || App.data.vehicles[0];
  const myOT        = App.data.workOrders.filter(o=>o.vehicle===vehicleCode);
  const openOT      = myOT.filter(o=>o.status!=='Cerrada');
  const alerts      = App.data.documents.filter(d=>d.vehicle===vehicleCode && d.status!=='ok');
  const lastFuel    = App.data.fuelLogs.find(f=>f.vehicle===vehicleCode);
  const stLabel     = {ok:'Operativo',warn:'Con alerta',taller:'En taller',detenida:'Detenida'};
  const stBadge     = {ok:'badge-ok',warn:'badge-warn',taller:'badge-info',detenida:'badge-danger'};

  document.getElementById('page-chofer_panel').innerHTML = `
    <div class="chofer-view">

      <!-- Cabecera de la unidad -->
      <div class="chofer-header" style="margin-bottom:14px">
        <div class="chofer-unit">${vehicle.code}</div>
        <div class="chofer-plate">${vehicle.plate} · ${vehicle.brand} ${vehicle.model}</div>
        <div style="margin-top:8px;display:flex;align-items:center;gap:10px;justify-content:center">
          <span class="badge ${stBadge[vehicle.status]||'badge-gray'}">${stLabel[vehicle.status]||vehicle.status}</span>
          ${lastFuel?`<span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${vehicle.km.toLocaleString()} km</span>`:''}
        </div>
      </div>

      <!-- Alerta documental si aplica -->
      ${alerts.length?`<div class="alert-row danger" style="margin-bottom:12px;border-radius:var(--radius)">
        <span style="flex-shrink:0">⚠</span>
        <span class="alert-text"><b>${alerts[0].type}</b> vence el ${alerts[0].expiry} — Avisá a administración</span>
      </div>`:''}

      <!-- 4 botones de acción -->
      <div class="chofer-btn-grid" style="margin-bottom:14px">
        <div class="chofer-btn danger" onclick="openChoferNovedadModal('${vehicleCode}')">
          <span class="cb-icon">⚠</span>
          <span class="cb-label">Reportar novedad</span>
        </div>
        <div class="chofer-btn info" onclick="openFuelLoadModal()">
          <span class="cb-icon">⛽</span>
          <span class="cb-label">Cargar combustible</span>
        </div>
        <div class="chofer-btn ok" onclick="openChecklistModal('${vehicleCode}')">
          <span class="cb-icon">✓</span>
          <span class="cb-label">Checklist salida</span>
        </div>
        <div class="chofer-btn" style="border-color:rgba(6,182,212,.3);background:rgba(6,182,212,.06)" onclick="openUreaModal()">
          <span class="cb-icon" style="font-size:22px">◎</span>
          <span class="cb-label" style="color:var(--info)">Cargar urea</span>
        </div>
      </div>

      <!-- Mis novedades — solo las del chofer, vista simple -->
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div class="card-title" style="margin:0">Mis novedades</div>
          <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${myOT.length} total · ${openOT.length} abiertas</span>
        </div>

        ${openOT.length ? openOT.map(o=>`
          <div style="background:var(--bg3);border-radius:var(--radius);padding:12px;margin-bottom:8px;border:1px solid var(--border);border-left:3px solid ${o.priority==='Urgente'?'var(--danger)':o.status==='En proceso'?'var(--accent)':'var(--border2)'}">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <span style="font-family:var(--mono);font-size:12px;color:var(--text3)">${o.id}</span>
              <span class="badge ${o.status==='En proceso'?'badge-info':o.status==='Esperando repuesto'?'badge-warn':o.status==='Cerrada'?'badge-ok':'badge-gray'}">${o.status}</span>
            </div>
            <div style="font-size:13px;color:var(--text);font-weight:500;margin-bottom:4px">${o.desc}</div>
            <div style="font-size:11px;color:var(--text3)">
              ${o.mechanic!=='—'?`<span style="margin-right:10px">Mecánico: ${o.mechanic}</span>`:''}
              <span>${o.opened.split(' ')[0]}</span>
            </div>
            ${o.causa_raiz && o.causa_raiz!=='—' ? `
              <div style="margin-top:8px;background:var(--ok-bg);border-radius:var(--radius);padding:8px 10px;font-size:12px;color:var(--ok)">
                Resolución: ${o.causa_raiz}
              </div>` : ''}
          </div>
        `).join('') : '<div style="color:var(--text3);font-size:13px;padding:8px 0">No tenés novedades abiertas en este momento.</div>'}

        ${myOT.filter(o=>o.status==='Cerrada').slice(0,2).map(o=>`
          <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 12px;margin-bottom:6px;border:1px solid var(--border);opacity:.6">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:12px;color:var(--text2)">${o.desc}</span>
              <span class="badge badge-ok">Resuelta</span>
            </div>
            <div style="font-size:11px;color:var(--text3);margin-top:3px">${o.opened.split(' ')[0]}</div>
          </div>
        `).join('')}
      </div>

      <!-- Último combustible -->
      <div class="card">
        <div class="card-title">Última carga de combustible</div>
        ${lastFuel
          ? `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:4px">
              <div style="text-align:center">
                <div style="font-size:20px;font-weight:700;font-family:var(--mono);color:var(--text)">${lastFuel.liters}</div>
                <div style="font-size:11px;color:var(--text3)">litros</div>
              </div>
              <div style="text-align:center">
                <div style="font-size:20px;font-weight:700;font-family:var(--mono);color:var(--text)">${lastFuel.km.toLocaleString()}</div>
                <div style="font-size:11px;color:var(--text3)">km</div>
              </div>
              <div style="text-align:center">
                <div style="font-size:14px;font-weight:500;color:var(--text)">${lastFuel.date.split(' ')[0]}</div>
                <div style="font-size:11px;color:var(--text3)">${lastFuel.place}</div>
              </div>
            </div>`
          : '<div style="color:var(--text3);font-size:13px">Sin registros de combustible</div>'
        }
      </div>

    </div>
  `;
}

// Modal de novedad simplificado para el chofer — solo comunicación, sin datos técnicos
function openChoferNovedadModal(vehicleCode) {
  const vehicle = App.data.vehicles.find(v=>v.code===vehicleCode);
  openModal(`Reportar novedad — ${vehicleCode}`, `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 12px;margin-bottom:14px;font-size:13px;color:var(--text2)">
      ${vehicle?.brand} ${vehicle?.model} · ${vehicle?.plate}
    </div>

    <div class="form-group">
      <label class="form-label">¿Qué pasó? Describí con tus palabras</label>
      <textarea class="form-textarea" id="cn-desc" placeholder="Ej: Siento un ruido extraño en la rueda trasera derecha cuando freno... / Perdió líquido debajo del motor... / La luz de aceite encendió..." style="min-height:100px"></textarea>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">¿Qué parte del vehículo?</label>
        <select class="form-select" id="cn-type">
          <option value="">— Seleccioná —</option>
          <option>Motor / aceite / agua</option>
          <option>Frenos</option>
          <option>Cubiertas / ruedas</option>
          <option>Luces / eléctrico</option>
          <option>Suspensión / dirección</option>
          <option>Caja / transmisión</option>
          <option>Carrocería / golpe</option>
          <option>Semirremolque / acoplado</option>
          <option>Combustible / pérdida</option>
          <option>Otro</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">¿Puede seguir trabajando?</label>
        <select class="form-select" id="cn-canwork">
          <option value="si">Sí, puede seguir</option>
          <option value="con_cuidado">Sí, pero con cuidado</option>
          <option value="no">No — unidad detenida</option>
        </select>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">¿Dónde estás ahora?</label>
        <input class="form-input" id="cn-location" placeholder="Ruta, ciudad, base, km de ruta...">
      </div>
      <div class="form-group">
        <label class="form-label">Odómetro actual (km)</label>
        <input class="form-input" type="number" id="cn-km" placeholder="${vehicle?.km||''}">
      </div>
    </div>

    <div style="background:var(--info-bg);border:1px solid rgba(6,182,212,.25);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--info)">
      Tu reporte va directo al jefe de mantenimiento. Vas a ver la respuesta en "Mis novedades".
    </div>
  `, [
    { label:'Enviar novedad', cls:'btn-primary',   fn: () => saveChoferNovedad(vehicleCode) },
    { label:'Cancelar',       cls:'btn-secondary', fn: closeModal },
  ]);
}

function saveChoferNovedad(vehicleCode) {
  const desc     = document.getElementById('cn-desc').value.trim();
  const type     = document.getElementById('cn-type').value;
  const canWork  = document.getElementById('cn-canwork').value;
  const location = document.getElementById('cn-location').value;
  const km       = parseInt(document.getElementById('cn-km').value) || 0;

  if (!desc) { showToast('warn','Describí qué pasó antes de enviar'); return; }

  const newId   = 'OT-0' + (285 + App.data.workOrders.length);
  const priori  = canWork==='no' ? 'Urgente' : canWork==='con_cuidado' ? 'Media' : 'Normal';
  const fullDesc= `[Chofer: ${App.currentUser.name}] ${desc}${type?' — '+type:''}${location?' · Ubicación: '+location:''}${canWork==='no'?' ⚠ UNIDAD DETENIDA':''}`;

  App.data.workOrders.unshift({
    id:         newId,
    vehicle:    vehicleCode,
    plate:      App.data.vehicles.find(v=>v.code===vehicleCode)?.plate || '—',
    type:       'Correctivo',
    status:     canWork==='no' ? 'En proceso' : 'Pendiente',
    priority:   priori,
    desc:       fullDesc,
    mechanic:   '—',
    opened:     new Date().toISOString().slice(0,16).replace('T',' '),
    parts:      [], parts_cost:0, labor_cost:0,
  });

  closeModal();
  renderChoferPanel();
  showToast('ok', `Novedad enviada — ${priori==='Urgente'?'marcada como URGENTE':'el equipo fue notificado'}`);
}

function openChecklistModal(vehicleCode) {
  const items = ['Estado visual de cubiertas','Luces delanteras y traseras','Pérdidas visibles de aceite o líquidos','Nivel de aceite motor','Presión de aire frenos','Golpes o daños en carrocería','Cinturón de seguridad','Documentación a bordo'];
  const checkHTML = items.map((item,i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px;color:var(--text)">${item}</span>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-ok"   id="ck-ok-${i}"   onclick="setCheck(${i},'ok')">✓ OK</button>
        <button class="btn btn-sm btn-secondary" id="ck-obs-${i}" onclick="setCheck(${i},'obs')">⚠ Obs</button>
        <button class="btn btn-sm btn-danger"    id="ck-fail-${i}" onclick="setCheck(${i},'fail')">✗ Falla</button>
      </div>
    </div>
  `).join('');
  openModal(`Checklist de salida — ${vehicleCode}`, `
    <div style="margin-bottom:12px;font-size:12px;color:var(--text3)">Revisión previa a la salida. Marcá el estado de cada ítem.</div>
    ${checkHTML}
    <div class="form-group" style="margin-top:16px">
      <label class="form-label">Observaciones generales</label>
      <textarea class="form-textarea" placeholder="Anotá cualquier detalle adicional..." id="ck-obs-general"></textarea>
    </div>
  `, [
    { label: 'Confirmar y salir', cls:'btn-primary', fn: () => { closeModal(); showToast('ok', `Checklist de salida completado para ${vehicleCode}`); } },
    { label: 'Cancelar', cls:'btn-secondary', fn: closeModal }
  ]);
}
window.setCheck = function(i, val) {
  const colors = { ok:'btn-ok', obs:'btn-secondary', fail:'btn-danger' };
  ['ok','obs','fail'].forEach(v => {
    const btn = document.getElementById(`ck-${v}-${i}`);
    if (btn) btn.style.opacity = v === val ? '1' : '0.4';
  });
};

function openUreaModal() {
  openModal('Registrar carga de urea / AdBlue', `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Unidad</label><input class="form-input" placeholder="INT-XX" id="ur-veh" value="${App.currentUser.vehicle||''}"></div>
      <div class="form-group"><label class="form-label">Litros cargados</label><input class="form-input" type="number" placeholder="20" id="ur-liters"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Odómetro (km)</label><input class="form-input" type="number" placeholder="284500" id="ur-km"></div>
      <div class="form-group"><label class="form-label">Lugar</label><select class="form-select" id="ur-place"><option>Cisterna central</option><option>Estación externa</option></select></div>
    </div>
    <div style="background:var(--info-bg);border:1px solid rgba(6,182,212,.3);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--info);margin-top:4px">
      Relación normal urea/combustible: 3–5%. El sistema verificará el consumo automáticamente.
    </div>
  `, [
    { label:'Registrar carga urea', cls:'btn-primary', fn: () => { closeModal(); showToast('ok','Carga de urea registrada'); } },
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal }
  ]);
}

// ── PANEL DEL CONTADOR ──
function renderContadorPanel() {
  const totalCost = App.data.vehicles.reduce((a,b) => a + b.cost_km * b.km * 0.04, 0);
  const avgKm = (App.data.vehicles.reduce((a,b)=>a+b.cost_km,0)/App.data.vehicles.length).toFixed(3);
  const stockVal = App.data.stock.reduce((a,b)=>a+b.qty*b.cost,0);
  const detenidas = App.data.vehicles.filter(v=>v.status==='taller'||v.status==='detenida').length;

  document.getElementById('page-contador_panel').innerHTML = `
    <div class="export-bar">
      <button class="btn btn-secondary" onclick="showToast('ok','Exportando reporte mensual en Excel...')">↓ Exportar Excel</button>
      <button class="btn btn-secondary" onclick="showToast('ok','Generando PDF de costos...')">↓ Exportar PDF</button>
      <button class="btn btn-secondary" onclick="showToast('info','Enviando resumen por email...')">✉ Enviar por email</button>
    </div>

    <div class="contador-kpis">
      <div class="kpi-card info">
        <div class="kpi-label">Costo total estimado mes</div>
        <div class="kpi-value white">$${Math.round(totalCost/1000)}K</div>
        <div class="kpi-trend">todas las unidades</div>
      </div>
      <div class="kpi-card ok">
        <div class="kpi-label">Costo/km promedio</div>
        <div class="kpi-value ok">$${avgKm}</div>
        <div class="kpi-trend">flota completa</div>
      </div>
      <div class="kpi-card ${detenidas>0?'warn':'ok'}">
        <div class="kpi-label">Inmovilización taller</div>
        <div class="kpi-value ${detenidas>0?'warn':'ok'}">${detenidas}</div>
        <div class="kpi-trend">unidades paradas hoy</div>
      </div>
    </div>

    <div class="two-col" style="margin-bottom:20px">
      <div class="card">
        <div class="card-title">Costos por rubro — mes actual</div>
        <div style="position:relative;height:200px"><canvas id="cnt-chart1" role="img" aria-label="Costos por rubro"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">Top 5 unidades más costosas</div>
        ${[...App.data.vehicles].sort((a,b)=>b.cost_km-a.cost_km).slice(0,5).map((v,i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
            <span style="width:20px;color:var(--text3);font-family:var(--mono);font-size:11px">${i+1}</span>
            <span style="flex:1;font-weight:500">${v.code}</span>
            <span style="font-family:var(--mono);font-size:13px;color:var(--${v.cost_km>0.25?'danger':v.cost_km>0.20?'warn':'ok'})">$${v.cost_km.toFixed(3)}/km</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="section-header">
        <div><div class="section-title">Stock valorizado</div></div>
        <span class="kpi-value ok" style="font-size:18px">$${Math.round(stockVal/1000)}K</span>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>Categoría</th><th>Ítems</th><th>Valorización</th><th>Estado</th></tr></thead>
        <tbody>${['Filtros','Lubricantes','Mecánico','Frenos','Eléctrico','Tornillería'].map(cat => {
          const items = App.data.stock.filter(s=>s.cat===cat);
          const val = items.reduce((a,b)=>a+b.qty*b.cost,0);
          const crit = items.filter(s=>s.qty<=s.min).length;
          return `<tr>
            <td class="td-main">${cat}</td>
            <td class="td-mono">${items.length}</td>
            <td class="td-mono">$${val.toLocaleString()}</td>
            <td>${crit>0?`<span class="badge badge-warn">${crit} bajo mínimo</span>`:'<span class="badge badge-ok">Normal</span>'}</td>
          </tr>`;
        }).join('')}</tbody></table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Vencimientos documentales — resumen</div>
      <div class="table-wrap">
        <table><thead><tr><th>Vehículo</th><th>Documento</th><th>Vencimiento</th><th>Estado</th></tr></thead>
        <tbody>${App.data.documents.filter(d=>d.status!=='ok').map(d => {
          const days = Math.ceil((new Date(d.expiry)-new Date())/86400000);
          return `<tr>
            <td class="td-main">${d.vehicle}</td>
            <td>${d.type}</td>
            <td class="td-mono">${d.expiry}</td>
            <td><span class="badge ${d.status==='danger'?'badge-danger':'badge-warn'}">${days<0?'Vencido hace '+Math.abs(days)+'d':'Vence en '+days+'d'}</span></td>
          </tr>`;
        }).join('')}</tbody></table>
      </div>
    </div>
  `;

  setTimeout(() => {
    const ctx = document.getElementById('cnt-chart1');
    if (!ctx) return;
    new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Combustible','Neumáticos','Mant. prev.','Correctivos','Fijos'],
        datasets: [{ data:[38,21,18,13,10], backgroundColor:['#3b82f6','#f59e0b','#22c55e','#ef4444','#a78bfa'], borderWidth:0, hoverOffset:4 }]
      },
      options: { responsive:true, maintainAspectRatio:false, cutout:'58%', plugins:{legend:{display:false}} }
    });
  }, 100);
}
