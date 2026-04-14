// ═══════════════════════════════════════════
//  FleetOS — Motor de datos y lógica central
// ═══════════════════════════════════════════

// ── ESTADO GLOBAL ──
const App = {
  currentPage: 'dashboard',
  currentUser: null,
  data: {}
};
// Helper para verificar rol del usuario actual
function userHasRole(...roles) {
  const role = App.currentUser?.role;
  return roles.includes(role);
}




// usuarios cargados desde la API


window.FleetRoles = {
  dueno:         { code:'dueno',         label:'Dueño / Dirección', modules:['all'] },
  gerencia:      { code:'gerencia',      label:'Gerencia',          modules:['dashboard','fleet','workorders','maintenance','fuel','tires','stock','documents','costs','encargado_panel','contador_panel'] },
  mantenimiento: { code:'mantenimiento', label:'Mantenimiento',     modules:['dashboard','fleet','workorders','maintenance','fuel','tires','stock','documents'] },
  mecanico:      { code:'mecanico',      label:'Mecánico',          modules:['dashboard','fleet','workorders','maintenance','stock','fuel','tires'] },
  contador:      { code:'contador',      label:'Contador',          modules:['dashboard','costs','documents','contador_panel'] },
  chofer:        { code:'chofer',        label:'Chofer',            modules:['dashboard','fuel','documents','chofer_panel'] }
};

// ── DATOS ── (cargados desde la API por roles.js)
App.data.vehicles    = App.data.vehicles    || [];
App.data.workOrders  = App.data.workOrders  || [];
App.data.fuelLogs    = App.data.fuelLogs    || [];
App.data.tires       = App.data.tires       || [];
App.data.stock       = App.data.stock       || [];
App.data.documents   = App.data.documents   || [];
App.data.tireHistory = App.data.tireHistory || [];
App.data.stockHistory= App.data.stockHistory|| [];

// ── NAVEGACIÓN ──
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (nav) nav.classList.add('active');
  App.currentPage = page;
  document.querySelector('.topbar-title').textContent = getPageTitle(page);
  document.querySelector('.topbar-sub').textContent = getPageSub(page);
  renderPage(page);
}

function getPageTitle(p) {
  const t = { dashboard:'Panel general', fleet:'Flota y vehículos', workorders:'Órdenes de trabajo', fuel:'Combustible y urea', tires:'Cubiertas y neumáticos', stock:'Stock y pañol', documents:'Documentación', costs:'Costos operativos', maintenance:'Mantenimiento', chofer_panel:'Mi panel', encargado_panel:'Operativo del día', contador_panel:'Panel contable' };
  return t[p] || 'FleetOS';
}
function getPageSub(p) {
  const s = { dashboard:`Vista ejecutiva · Flota ${(App.data.vehicles||[]).length} unidades`, fleet:'Administración y ficha técnica de activos', workorders:'Gestión de intervenciones técnicas', fuel:'Control de cisternas y consumo', tires:'Mapa por eje · trazabilidad', stock:'Repuestos · insumos · alertas', documents:'Vencimientos y cumplimiento', costs:'Análisis financiero por unidad', maintenance:'Preventivo · predictivo · correctivo', chofer_panel:'Novedades y cargas', encargado_panel:'Checklists · novedades · combustible', contador_panel:'Costos · reportes · KPIs' };
  return s[p] || '';
}

function renderPage(page) {
  const fns = { dashboard: renderDashboard, fleet: renderFleet, workorders: renderWorkOrders, fuel: renderFuel, tires: renderTires, stock: renderStock, documents: renderDocuments, costs: renderCosts, maintenance: renderMaintenance, chofer_panel: renderChoferPanel, encargado_panel: renderEncargadoPanel, contador_panel: renderContadorPanel, users: renderUsers, config: renderConfig };
  if (fns[page]) fns[page]();
}

// ── DASHBOARD ──
function renderDashboard() {
  const v = App.data.vehicles;
  const ok = v.filter(x=>x.status==='ok').length;
  const taller = v.filter(x=>x.status==='taller').length;
  const detenida = v.filter(x=>x.status==='detenida').length;
  const warn = v.filter(x=>x.status==='warn').length;
  const doRate = ((ok+warn)/v.length*100).toFixed(1);
  const alerts = App.data.documents.filter(d=>d.status!=='ok').length;

  document.getElementById('page-dashboard').innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card ${ok>=40?'ok':'warn'}">
        <div class="kpi-label">Unidades operativas</div>
        <div class="kpi-value ${ok>=40?'ok':'warn'}">${ok}</div>
        <div class="kpi-trend">de ${App.data.vehicles.length} en flota</div>
      </div>
      <div class="kpi-card ${taller+detenida===0?'ok':'warn'}">
        <div class="kpi-label">En taller / detenidas</div>
        <div class="kpi-value ${taller+detenida===0?'ok':'danger'}">${taller+detenida}</div>
        <div class="kpi-trend">${taller} en taller · ${detenida} detenida</div>
      </div>
      <div class="kpi-card ${parseFloat(doRate)>=92?'ok':'warn'}">
        <div class="kpi-label">Disponibilidad operativa</div>
        <div class="kpi-value ${parseFloat(doRate)>=92?'ok':'warn'}">${doRate}%</div>
        <div class="kpi-trend ${parseFloat(doRate)>=92?'up':'down'}">Meta: 92% · ${parseFloat(doRate)>=92?'Cumplida':'Debajo del objetivo'}</div>
      </div>
      <div class="kpi-card ${alerts===0?'ok':'danger'}">
        <div class="kpi-label">Alertas documentales</div>
        <div class="kpi-value ${alerts===0?'ok':'danger'}">${alerts}</div>
        <div class="kpi-trend">documentos a vencer pronto</div>
      </div>
    </div>

    <div class="two-col" style="margin-bottom:20px">
      <div class="card">
        <div class="card-title">Estado de la flota — ${(App.data.vehicles||[]).length} unidades</div>
        <div class="fleet-grid" id="fleet-grid-mini"></div>
        <div style="display:flex;gap:12px;font-size:11px;color:var(--text3);font-family:var(--mono)">
          <span>● Verde: operativo</span><span>● Naranja: alerta</span><span>● Rojo: taller/detenida</span>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Alertas activas</div>
        <div id="dash-alerts"></div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="section-header">
          <div><div class="section-title">Órdenes de trabajo abiertas</div></div>
          <button class="btn btn-secondary btn-sm" onclick="navigate('workorders')">Ver todas</button>
        </div>
        <div id="dash-ot"></div>
      </div>
      <div class="card">
        <div class="section-header">
          <div><div class="section-title">Últimas cargas de combustible</div></div>
          <button class="btn btn-secondary btn-sm" onclick="navigate('fuel')">Ver todas</button>
        </div>
        <div id="dash-fuel"></div>
      </div>
    </div>
  `;

  // Fleet grid
  const grid = document.getElementById('fleet-grid-mini');
  v.forEach(vc => {
    const cls = {ok:'ok',warn:'warn',taller:'danger',detenida:'danger'}[vc.status]||'ok';
    const el = document.createElement('div');
    el.className = `fleet-unit ${cls}`;
    el.textContent = vc.code;
    el.title = `${vc.code} — ${vc.brand} ${vc.model} — ${vc.status.toUpperCase()}`;
    el.addEventListener('click', () => { navigate('fleet'); setTimeout(()=>filterVehicle(vc.code),100); });
    grid.appendChild(el);
  });

  // Alerts
  const alertsEl = document.getElementById('dash-alerts');
  const dangerDocs = App.data.documents.filter(d=>d.status==='danger');
  const warnDocs = App.data.documents.filter(d=>d.status==='warn');
  const detainedVehicles = App.data.vehicles.filter(v=>v.status==='detenida');

  // Alertas de mantenimiento — calcular basado en km e intervalos configurados
  const maintAlerts = (App.data.vehicles||[]).map(v => {
    const km = v.km || 0;
    const ts = v.tech_spec || {};
    const interval = parseInt(ts.maint_interval_km) || 15000;
    const pct = km % interval / interval * 100;
    return { code: v.code, pct: Math.round(pct), km, interval, nextKm: Math.ceil(km/interval)*interval };
  }).filter(m => m.pct >= 80).sort((a,b) => b.pct - a.pct);

  let html = '';
  detainedVehicles.forEach(v => {
    html += `<div class="alert-row danger"><span>⚠</span><span class="alert-text"><b>${v.code}</b> — Unidad detenida en base.</span></div>`;
  });
  dangerDocs.forEach(d => {
    html += `<div class="alert-row danger"><span>⚠</span><span class="alert-text"><b>${d.vehicle}</b> — ${d.type} vencido (${d.expiry})</span></div>`;
  });
  // Mantenimiento vencido (>= 95%)
  maintAlerts.filter(m=>m.pct>=95).forEach(m => {
    html += `<div class="alert-row danger"><span>🔧</span><span class="alert-text"><b>${m.code}</b> — Mantenimiento VENCIDO — ${m.km.toLocaleString()} / ${m.nextKm.toLocaleString()} km</span></div>`;
  });
  // Mantenimiento próximo (80-94%)
  maintAlerts.filter(m=>m.pct>=80&&m.pct<95).slice(0,3).forEach(m => {
    html += `<div class="alert-row warn"><span>🔧</span><span class="alert-text"><b>${m.code}</b> — Mantenimiento próximo (${m.pct}%) — faltan ${(m.nextKm-m.km).toLocaleString()} km</span></div>`;
  });
  warnDocs.slice(0,2).forEach(d => {
    const days = Math.ceil((new Date(d.expiry)-new Date())/86400000);
    html += `<div class="alert-row warn"><span>!</span><span class="alert-text"><b>${d.vehicle}</b> — ${d.type} vence en ${days} días</span></div>`;
  });
  if (!html) html = '<div class="alert-row ok"><span>✓</span><span class="alert-text">Sin alertas críticas activas</span></div>';
  alertsEl.innerHTML = html;

  // OT
  const otEl = document.getElementById('dash-ot');
  const openOT = App.data.workOrders.filter(o=>o.status!=='Cerrada').slice(0,5);
  otEl.innerHTML = `<table><thead><tr><th>OT</th><th>Vehículo</th><th>Estado</th><th>Prioridad</th></tr></thead><tbody>
    ${openOT.map(o=>`<tr>
      <td class="td-mono">${o.id}</td>
      <td class="td-main">${o.vehicle}</td>
      <td><span class="badge ${o.status==='En proceso'?'badge-info':o.status==='Esperando repuesto'?'badge-warn':'badge-gray'}">${o.status}</span></td>
      <td><span class="badge ${o.priority==='Urgente'?'badge-danger':o.priority==='Media'?'badge-warn':'badge-gray'}">${o.priority}</span></td>
    </tr>`).join('')}
  </tbody></table>`;

  // Fuel
  const fuelEl = document.getElementById('dash-fuel');
  fuelEl.innerHTML = `<table><thead><tr><th>Unidad</th><th>Litros</th><th>Rendimiento</th><th>Estado</th></tr></thead><tbody>
    ${App.data.fuelLogs.slice(0,5).map(f=>`<tr>
      <td class="td-main">${f.vehicle}</td>
      <td class="td-mono">${f.liters} L</td>
      <td class="td-mono">2.${Math.floor(Math.random()*3)+6} km/L</td>
      <td><span class="badge ${f.status==='OK'?'badge-ok':'badge-warn'}">${f.status}</span></td>
    </tr>`).join('')}
  </tbody></table>`;
}

// ── FLOTA ──
let vehicleFilter = '';
function filterVehicle(code) { vehicleFilter = code; renderFleet(); }

function renderFleet() {
  const page = document.getElementById('page-fleet');
  page.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Flota registrada</div>
        <div class="section-sub">${App.data.vehicles.length} unidades · tractores, camiones, semirremolques</div>
      </div>
      <div style="display:flex;gap:8px">
        <input type="text" class="form-input" placeholder="Buscar por código, patente, marca..." id="fleet-search" style="width:280px" value="${vehicleFilter}" oninput="filterFleetTable(this.value)">
        <button class="btn btn-primary" onclick="openNewVehicleModal()">+ Nueva unidad</button>
        <button class="btn btn-secondary" onclick="syncGPSNow(this)" id="btn-gps-sync" style="margin-left:8px">
          <span>⚡ Sync GPS</span>
        </button>
        <span id="gps-sync-status" style="font-size:12px;color:var(--text3);margin-left:8px"></span>
      </div>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table id="fleet-table">
          <thead><tr>
            <th>Código</th><th>Patente</th><th>Marca / Modelo</th><th>Tipo</th>
            <th>Año</th><th>Km actuales</th><th>Base</th><th>Chofer</th>
            <th>Costo/km</th><th>Estado</th><th>GPS</th><th></th>
          </tr></thead>
          <tbody id="fleet-tbody"></tbody>
        </table>
      </div>
    </div>
  `;
  renderFleetTable(App.data.vehicles);
  if (vehicleFilter) { filterFleetTable(vehicleFilter); vehicleFilter = ''; }
}

function renderFleetTable(data) {
  const tbody = document.getElementById('fleet-tbody');
  if (!tbody) return;
  tbody.innerHTML = data.map(v => {
    const st = {ok:'badge-ok',warn:'badge-warn',taller:'badge-info',detenida:'badge-danger'}[v.status]||'badge-gray';
    const stLbl = {ok:'Operativo',warn:'Con alerta',taller:'En taller',detenida:'Detenida'}[v.status]||v.status;
    const d = getCostDetail(v.code);
    const ckReal = d ? d.costKmReal : 0;
    const cpkm_color = ckReal>0.25?'danger':ckReal>0.20?'warn':'ok';
    return `<tr>
      <td class="td-mono td-main">${v.code}</td>
      <td class="td-mono">${v.plate}</td>
      <td class="td-main">${v.brand} ${v.model}</td>
      <td><span class="tag" style="background:var(--bg4);color:var(--text2)">${v.type}</span></td>
      <td class="td-mono">${v.year}</td>
      <td class="td-mono">${v.km.toLocaleString()} ${v.type==='autoelevador'?'hs':'km'}</td>
      <td>${v.base}</td>
      <td>${v.driver}</td>
      <td class="td-mono" style="color:var(--${cpkm_color})">${ckReal>0?'$'+ckReal.toFixed(3):'—'}</td>
      <td><span class="badge ${st}">${stLbl}</span></td>
      <td>
        ${v.gps_updated ? `<span style="font-size:11px;color:var(--${v.gps_status==='moving'?'ok':'text3'})" title="Actualizado: ${v.gps_updated ? new Date(v.gps_updated).toLocaleString('es-AR') : '-'}">
          ${v.gps_status==='moving'?'● '+Math.round(v.gps_speed||0)+' km/h':'◌ Det'}
        </span>` : '<span style="font-size:11px;color:var(--text3)">— Sin GPS</span>'}
      </td>
      <td><button class="btn btn-secondary btn-sm" onclick="openVehicleDetail('${v.id}')">Ver ficha</button></td>
    </tr>`;
  }).join('');
}

function filterFleetTable(q) {
  const filtered = App.data.vehicles.filter(v =>
    v.code.toLowerCase().includes(q.toLowerCase()) ||
    v.plate.toLowerCase().includes(q.toLowerCase()) ||
    v.brand.toLowerCase().includes(q.toLowerCase()) ||
    v.model.toLowerCase().includes(q.toLowerCase()) ||
    v.driver.toLowerCase().includes(q.toLowerCase())
  );
  renderFleetTable(filtered);
}

// Ficha técnica completa por defecto por marca/modelo
function getTechSpec(brand, model, type) {
  const specs = {
    'Mercedes-Benz': {
      engine: 'Mercedes-Benz OM 471 · 6 cil. en línea · 12.8 L · Euro VI',
      power: '460–510 HP / 2.200–2.500 Nm',
      transmission: 'Mercedes PowerShift 3 · 12 vel. automatizada',
      differential: 'Mercedes-Benz HY-1350 · bloqueo neumático',
      oil_engine: '15W-40 API CK-4 / ACEA E9 · 38 litros con filtro',
      oil_gearbox: 'Mercedes-Benz MB 236.21 · 9 litros',
      oil_diff: '85W-140 GL-5 · 14 litros',
      coolant: 'MB 325.6 orgánico azul · 40 litros · concentración 50%',
      filter_oil: 'A 0001802509 / MANN W 950/26',
      filter_fuel_p: 'A 0000905351 / MANN WK 12 001',
      filter_fuel_s: 'A 0000901951 / MANN WK 12 002',
      filter_air: 'A 0000945704 / MANN C 30 850/3',
      filter_sep: 'A 0000902151 / separador agua MANN',
      filter_cabin: 'A 0008300018 / MANN CU 5291',
      grease: 'Grasa cálcica EP2 · 28 puntos de engrase',
      battery: '2 × 12V 180Ah · 1100 CCA (Bosch S5 A08)',
      urea: 'Sí — AdBlue SCR · tanque 75 L',
      service_km: 'Cada 30.000 km o 500 hs (lo primero)',
      service_engage: 'Cada 60.000 km: frenos, suspensión, crucetas',
      service_major: 'Cada 120.000 km: caja, diferencial, correas',
      tire_size: '295/80 R22.5',
      tire_pressure_steer: '8.5 bar',
      tire_pressure_drive: '9.0 bar',
      wheel_torque: '600 Nm / M22×1.5',
      fuel_cap: '600 L (2 tanques × 300 L)',
    },
    'Scania': {
      engine: 'Scania DC13 · 6 cil. en línea · 12.7 L · Euro VI',
      power: '450–500 HP / 2.350 Nm',
      transmission: 'Scania Opticruise G25 · 12 vel. automatizada',
      differential: 'Scania AD1608 · bloqueo neumático',
      oil_engine: '10W-40 Scania LDF-4 / ACEA E9 · 35 litros con filtro',
      oil_gearbox: 'Scania Gear Oil STO 2 · 8.5 litros',
      oil_diff: '80W-90 GL-5 Scania STO 1 · 12 litros',
      coolant: 'Scania coolant OAT naranja · 38 litros · 50%',
      filter_oil: '1 457 429 740 / MANN W 11 102/4',
      filter_fuel_p: '1 457 434 465 / MANN WK 8158',
      filter_fuel_s: '1 457 434 464 / MANN WK 8157',
      filter_air: '1 457 433 078 / MANN C 27 1325',
      filter_sep: '1 335 966 / separador agua Scania OEM',
      filter_cabin: '1 457 433 549 / MANN CU 3172',
      grease: 'Grasa litio EP2 · 24 puntos de engrase',
      battery: '2 × 12V 170Ah · 1000 CCA (Scania / Varta)',
      urea: 'Sí — AdBlue SCR · tanque 65 L',
      service_km: 'Cada 30.000 km o 450 hs (lo primero)',
      service_engage: 'Cada 60.000 km: frenos, muelles, bujes',
      service_major: 'Cada 120.000 km: caja, diferencial',
      tire_size: '295/80 R22.5',
      tire_pressure_steer: '8.5 bar',
      tire_pressure_drive: '9.0 bar',
      wheel_torque: '580 Nm / M22×1.5',
      fuel_cap: '600 L (2 tanques)',
    },
    'Volvo': {
      engine: 'Volvo D13K · 6 cil. en línea · 12.8 L · Euro VI',
      power: '460–540 HP / 2.500 Nm',
      transmission: 'Volvo I-Shift · 12 vel. automatizada',
      differential: 'Volvo RS1370A · bloqueo neumático',
      oil_engine: '10W-40 Volvo VDS-5 / ACEA E9 · 36 litros',
      oil_gearbox: 'Volvo 97307 · 8 litros',
      oil_diff: '80W-140 GL-5 Volvo 97319 · 12 litros',
      coolant: 'Volvo coolant VCS2 verde · 40 litros · 50%',
      filter_oil: '21707132 / MANN W 10 002',
      filter_fuel_p: '21380488 / MANN WK 9022 x',
      filter_fuel_s: '21380491 / MANN WK 9023',
      filter_air: '21834266 / MANN C 30 1400',
      filter_sep: '21996353 / separador agua Volvo OEM',
      filter_cabin: '21834269 / MANN CU 4224',
      grease: 'Grasa litio-calcio EP2 · 26 puntos de engrase',
      battery: '2 × 12V 175Ah · 1050 CCA (Volvo / Exide)',
      urea: 'Sí — AdBlue SCR · tanque 70 L',
      service_km: 'Cada 30.000 km o 500 hs (lo primero)',
      service_engage: 'Cada 60.000 km: frenos, amortiguadores',
      service_major: 'Cada 120.000 km: caja, diferencial, distribución',
      tire_size: '315/70 R22.5',
      tire_pressure_steer: '9.0 bar',
      tire_pressure_drive: '9.0 bar',
      wheel_torque: '600 Nm / M22×1.5',
      fuel_cap: '700 L (2 tanques)',
    },
    'DAF': {
      engine: 'PACCAR MX-13 · 6 cil. en línea · 12.9 L · Euro VI',
      power: '480–530 HP / 2.500 Nm',
      transmission: 'ZF TraXon 12TX2620 · 12 vel. automatizada',
      differential: 'DAF RT-440-EC · bloqueo neumático',
      oil_engine: '5W-30 PACCAR Premium · 37 litros con filtro',
      oil_gearbox: 'ZF Lifeguard Hybrid 8 · 9.5 litros',
      oil_diff: '80W-90 GL-5 · 10 litros',
      coolant: 'DAF OAT coolant azul · 38 litros · 50%',
      filter_oil: '1703803 / MANN W 13 145/1',
      filter_fuel_p: '1829771 / MANN WK 950/21',
      filter_fuel_s: '1829776 / MANN WK 950/22',
      filter_air: '1703821 / MANN C 30 1400',
      filter_sep: '1829777 / separador agua DAF OEM',
      filter_cabin: '1703866 / MANN CU 4224',
      grease: 'Grasa EP2 multipropósito · 22 puntos de engrase',
      battery: '2 × 12V 180Ah · 1100 CCA',
      urea: 'Sí — AdBlue SCR · tanque 60 L',
      service_km: 'Cada 30.000 km o 500 hs',
      service_engage: 'Cada 60.000 km: frenos, dirección',
      service_major: 'Cada 120.000 km: caja, diferencial',
      tire_size: '315/70 R22.5',
      tire_pressure_steer: '8.5 bar',
      tire_pressure_drive: '9.0 bar',
      wheel_torque: '600 Nm',
      fuel_cap: '600 L',
    },
    'Iveco': {
      engine: 'Cursor 13 / FPT · 6 cil. en línea · 12.9 L · Euro VI',
      power: '460–570 HP / 2.100–2.300 Nm',
      transmission: 'ZF AS-Tronic 12 vel. / Hi-Tronix 12 vel.',
      differential: 'Iveco RT-440 · bloqueo neumático',
      oil_engine: '10W-40 ACEA E9 · 34 litros con filtro',
      oil_gearbox: 'ZF Lifeguard 8 · 9 litros',
      oil_diff: '80W-90 GL-5 · 11 litros',
      coolant: 'PARAFLU UP orgánico · 36 litros · 50%',
      filter_oil: '2992662 / MANN W 11 102/11',
      filter_fuel_p: '2992241 / MANN WK 9022',
      filter_fuel_s: '2992240 / MANN WK 9023',
      filter_air: '2998940 / MANN CF 2100',
      filter_sep: '2993471 / separador agua Iveco OEM',
      filter_cabin: '2999127 / MANN CU 3172',
      grease: 'Grasa litio EP2 · 20 puntos de engrase',
      battery: '2 × 12V 170Ah · 1000 CCA',
      urea: 'Sí — AdBlue SCR · tanque 55 L',
      service_km: 'Cada 25.000 km o 500 hs',
      service_engage: 'Cada 50.000 km: frenos, suspensión',
      service_major: 'Cada 100.000 km: caja, diferencial',
      tire_size: '315/70 R22.5',
      tire_pressure_steer: '8.5 bar',
      tire_pressure_drive: '9.0 bar',
      wheel_torque: '560 Nm',
      fuel_cap: '500 L',
    },
    'Volkswagen': {
      engine: 'MAN D2676 / Cummins ISM · 6 cil. en línea · Euro V/VI',
      power: '280–520 HP',
      transmission: 'ZF 16S 2535 / MAN TipMatic',
      differential: 'Meritor RS246 · bloqueo neumático',
      oil_engine: '15W-40 API CH-4 / ACEA E7 · 30 litros',
      oil_gearbox: 'ZF Lifeguard 8 · 8.5 litros',
      oil_diff: '85W-140 GL-5 · 12 litros',
      coolant: 'VW TL 774 D / G12++ · 32 litros · 50%',
      filter_oil: '059 115 561 B / MANN W 719/30',
      filter_fuel_p: '7H0 127 177 / MANN WK 842/2',
      filter_fuel_s: '7H0 127 401 / MANN WK 11 001',
      filter_air: '7M0 129 620 / MANN C 27 1500',
      filter_sep: '7H0 127 177 A / separador OEM',
      filter_cabin: '7M3 819 631 / MANN CU 2131',
      grease: 'Grasa litio multipropósito EP2 · 22 puntos',
      battery: '2 × 12V 150Ah · 900 CCA',
      urea: 'Sí — AdBlue SCR · tanque 40 L',
      service_km: 'Cada 20.000 km o 400 hs',
      service_engage: 'Cada 40.000 km: frenos, bujes',
      service_major: 'Cada 80.000 km: caja, diferencial',
      tire_size: '295/80 R22.5',
      tire_pressure_steer: '8.0 bar',
      tire_pressure_drive: '8.5 bar',
      wheel_torque: '550 Nm',
      fuel_cap: '300–400 L',
    },
    'Ford': {
      engine: 'Cummins ISC / ISM · 6 cil. en línea',
      power: '230–340 HP',
      transmission: 'Eaton Fuller 9 vel. / ZF 9S 1310',
      differential: 'Meritor RS232 / Dana Spicer',
      oil_engine: '15W-40 API CH-4 · 20–28 litros',
      oil_gearbox: 'Eaton PS-386 / ZF Lifeguard 5 · 7 litros',
      oil_diff: '85W-140 GL-5 · 10 litros',
      coolant: 'Fleetcool EG OAT · 28 litros · 50%',
      filter_oil: 'LF3970 / MANN W 719/30',
      filter_fuel_p: 'FS19765 / MANN WK 723/2',
      filter_fuel_s: 'FS19624 / MANN WK 11 001',
      filter_air: 'AF25557 / MANN C 27 1200',
      filter_sep: 'FS19624 / separador agua Fleetguard',
      filter_cabin: 'MANN CU 1835',
      grease: 'Grasa multipropósito EP2 · 18 puntos',
      battery: '2 × 12V 150Ah · 900 CCA',
      urea: 'No',
      service_km: 'Cada 15.000 km o 300 hs',
      service_engage: 'Cada 30.000 km: frenos, suspensión',
      service_major: 'Cada 60.000 km: caja, diferencial',
      tire_size: '275/70 R22.5',
      tire_pressure_steer: '7.5 bar',
      tire_pressure_drive: '8.0 bar',
      wheel_torque: '500 Nm',
      fuel_cap: '200–300 L',
    },
  };
  // Buscar case-insensitive
  const brandKey = Object.keys(specs).find(k => k.toLowerCase() === (brand||'').toLowerCase());
  if (brandKey) return specs[brandKey];
  // Fallback genérico vacío para marcas no registradas
  return {
    engine: 'No registrado — completar desde "Editar datos generales"',
    power: 'No registrado',
    transmission: 'No registrado',
    differential: 'No registrado',
    oil_engine: 'No registrado',
    oil_gearbox: 'No registrado',
    oil_diff: 'No registrado',
    coolant: 'No registrado',
    filter_oil: 'No registrado',
    filter_fuel_p: 'No registrado',
    filter_fuel_s: 'No registrado',
    filter_air: 'No registrado',
    filter_sep: 'No registrado',
    filter_cabin: 'No registrado',
    grease: 'No registrado',
    battery: 'No registrado',
    urea: 'No registrado',
    service_km: 'No registrado',
    service_engage: 'No registrado',
    service_major: 'No registrado',
    tire_size: 'No registrado',
    tire_pressure_steer: '—',
    tire_pressure_drive: '—',
    wheel_torque: 'No registrado',
    fuel_cap: 'No registrado',
  };
}

function openVehicleDetail(id) {
  const v = App.data.vehicles.find(x=>x.id===id);
  if (!v) return;
  // Guardar el id para que los tabs lo puedan referenciar
  App._fichaVehicleId = id;
  showVehicleFicha(id, 'general');
}

function showVehicleFicha(id, tab) {
  const v    = App.data.vehicles.find(x=>x.id===id);
  if (!v) return;
  App._fichaVehicleId = id;
  const spec = getTechSpec(v.brand, v.model, v.type);
  const vOT  = App.data.workOrders.filter(o=>o.vehicle===v.code);
  const vDocs= App.data.documents.filter(d=>d.vehicle===v.code);
  const vFuel= App.data.fuelLogs.filter(f=>f.vehicle===v.code);
  const vTires= App.data.tires.filter(t=>t.vehicle===v.code);
  const stLabel = {ok:'Operativo',warn:'Con alerta',taller:'En taller',detenida:'Detenida'};
  const stBadge = {ok:'badge-ok',warn:'badge-warn',taller:'badge-info',detenida:'badge-danger'};

  const tabs = [
    {id:'general',  label:'General'},
    {id:'tecnica',  label:'Ficha técnica'},
    {id:'fluidos',  label:'Fluidos y filtros'},
    {id:'service',  label:'Servicios'},
    {id:'ot',       label:`OT (${vOT.length})`},
    {id:'docs',     label:`Docs (${vDocs.length})`},
    {id:'fuel',     label:'Combustible'},
  ];

  const tabBar = `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:12px">
    ${tabs.map(t=>`<button onclick="showVehicleFicha('${id}','${t.id}')"
      style="padding:6px 14px;font-size:12px;border-radius:var(--radius);border:1px solid ${t.id===tab?'var(--accent)':'var(--border)'};
      background:${t.id===tab?'rgba(59,130,246,.15)':'transparent'};
      color:${t.id===tab?'var(--accent)':'var(--text2)'};cursor:pointer;font-family:var(--font)">
      ${t.label}
    </button>`).join('')}
  </div>`;

  // ── Cabecera común ──
  const header = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div style="background:var(--bg3);border-radius:var(--radius-lg);padding:14px 18px;text-align:center;border:1px solid var(--border)">
        <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--accent)">${v.code}</div>
        <div style="font-size:11px;color:var(--text3);font-family:var(--mono)">${v.plate}</div>
      </div>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:600;color:var(--text)">${v.brand} ${v.model} · ${v.year}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:3px">${v.type} · Base ${v.base} · ${v.driver}</div>
        <div style="margin-top:8px"><span class="badge ${stBadge[v.status]||'badge-gray'}">${stLabel[v.status]||v.status}</span></div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--text)">${v.km.toLocaleString()}</div>
        <div style="font-size:11px;color:var(--text3)">km actuales</div>
        <div style="font-size:13px;font-family:var(--mono);color:var(--text3);margin-top:4px">${(()=>{const _d=getCostDetail(v.id||v.code);return _d&&_d.costKmReal>0?'$'+_d.costKmReal.toFixed(3)+'/km':'Sin datos costo/km';})()}</div>
      </div>
    </div>`;

  // ── Contenido por tab ──
  let content = '';

  if (tab === 'general') {
    content = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        ${[
          ['Marca',        v.brand],
          ['Modelo',       v.model],
          ['Año',          v.year],
          ['Tipo',         v.type],
          ['VIN / Chasis', v.vin||'No registrado'],
          ['Nro. motor',   v.engine_no||'No registrado'],
          ['Base operativa', v.base],
          ['Centro de costo', v.cost_center||'Sin asignar'],
          ['Chofer habitual', v.driver],
          ['Km actuales',  v.km.toLocaleString()+(v.type==='autoelevador'?' hs':' km')],
          ['Costo/km',     (()=>{const _d=getCostDetail(v.id||v.code);return _d&&_d.costKmReal>0?'$'+_d.costKmReal.toFixed(3)+' (mes actual)':'Sin datos suficientes';})()],
          ['Combustible',  spec.fuel_cap],
        ].map(([l,val])=>`
          <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 12px;border:1px solid var(--border)">
            <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${l}</div>
            <div style="font-size:13px;font-weight:500;color:var(--text)">${val}</div>
          </div>`).join('')}
      </div>
      <div style="margin-top:4px">
        <button class="btn btn-secondary btn-sm" onclick="openEditVehicleModal('${id}')">✎ Editar datos generales</button>
      </div>`;
  }

  if (tab === 'tecnica') {
    // Mezclar: datos del fabricante como base + datos guardados del vehículo encima
    const saved = v.tech_spec || {};
    const merged = Object.assign({}, spec, saved);
    const fields = [
      { key:'engine',              label:'Motor' },
      { key:'power',               label:'Potencia / Torque' },
      { key:'transmission',        label:'Transmisión / Caja' },
      { key:'differential',        label:'Diferencial' },
      { key:'urea',                label:'Usa urea / AdBlue' },
      { key:'fuel_cap',            label:'Capacidad combustible' },
      { key:'tire_size',           label:'Medida cubiertas' },
      { key:'tire_pressure_steer', label:'Presión dirección' },
      { key:'tire_pressure_drive', label:'Presión tracción' },
      { key:'wheel_torque',        label:'Torque de ruedas' },
      { key:'battery',             label:'Baterías' },
      { key:'grease',              label:'Puntos de engrase' },
    ];
    const hasCustom = Object.keys(saved).length > 0;
    content = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:12px;color:var(--text3)">${hasCustom ? '✏️ Ficha con datos personalizados guardados.' : 'Datos del fabricante. Podés editarlos para este vehículo.'}</div>
        <button class="btn btn-secondary btn-sm" onclick="openEditTechSpecModal('${id}')">✏️ Editar ficha técnica</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${fields.map(f => {
          const isCustom = saved[f.key] !== undefined;
          return `
          <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 12px;border:1px solid ${isCustom ? 'rgba(59,130,246,.4)' : 'var(--border)'}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
              <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.4px">${f.label}</div>
              ${isCustom ? '<span style="font-size:9px;color:var(--accent);font-family:var(--mono)">EDITADO</span>' : ''}
            </div>
            <div style="font-size:12px;font-weight:500;color:var(--text);line-height:1.4">${merged[f.key] || '—'}</div>
          </div>`;
        }).join('')}
      </div>`;
  }

  if (tab === 'fluidos') {
    const rows = [
      ['Aceite de motor',        spec.oil_engine,      'ok'],
      ['Aceite de caja',         spec.oil_gearbox,     'ok'],
      ['Aceite de diferencial',  spec.oil_diff,        'ok'],
      ['Líquido refrigerante',   spec.coolant,         'info'],
      ['Filtro de aceite',       spec.filter_oil,      'warn'],
      ['Filtro combustible (P)', spec.filter_fuel_p,   'warn'],
      ['Filtro combustible (S)', spec.filter_fuel_s,   'warn'],
      ['Filtro de aire',         spec.filter_air,      'warn'],
      ['Separador de agua',      spec.filter_sep,      'warn'],
      ['Filtro de cabina',       spec.filter_cabin,    'gray'],
      ['Grasa / engrase',        spec.grease,          'gray'],
    ];
    content = `
      <div style="margin-bottom:14px;font-size:12px;color:var(--text3)">Fluidos, lubricantes y filtros homologados para esta unidad.</div>
      <table>
        <thead><tr><th>Componente</th><th>Especificación / Código</th><th></th></tr></thead>
        <tbody>${rows.map(([comp, val, color])=>`
          <tr>
            <td style="font-weight:500;color:var(--text);padding:9px 12px">${comp}</td>
            <td style="color:var(--text2);font-size:12px;padding:9px 12px;font-family:var(--mono)">${val}</td>
            <td style="padding:9px 8px"><span class="badge badge-${color==='gray'?'gray':color==='info'?'info':color==='ok'?'ok':'warn'}">${color==='ok'?'Aceite':color==='info'?'Refrigerante':'Filtro'}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  if (tab === 'service') {
    content = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:20px">
        <div style="background:var(--ok-bg);border:1px solid rgba(34,197,94,.25);border-radius:var(--radius-lg);padding:14px">
          <div style="font-size:10px;color:var(--ok);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Service básico</div>
          <div style="font-size:13px;font-weight:600;color:var(--ok)">${spec.service_km}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">Aceite + filtros</div>
        </div>
        <div style="background:var(--warn-bg);border:1px solid rgba(245,158,11,.25);border-radius:var(--radius-lg);padding:14px">
          <div style="font-size:10px;color:var(--warn);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Service intermedio</div>
          <div style="font-size:13px;font-weight:600;color:var(--warn)">${spec.service_engage}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">Frenos, suspensión, engrase</div>
        </div>
        <div style="background:var(--danger-bg);border:1px solid rgba(239,68,68,.25);border-radius:var(--radius-lg);padding:14px">
          <div style="font-size:10px;color:var(--danger);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Service mayor</div>
          <div style="font-size:13px;font-weight:600;color:var(--danger)">${spec.service_major}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">Caja, diferencial, distribución</div>
        </div>
      </div>
      <div style="font-size:12px;font-weight:500;color:var(--text2);margin-bottom:10px">Plan de mantenimiento preventivo activo</div>
      ${App.data.workOrders.filter(o=>o.vehicle===v.code&&o.type==='Preventivo').length > 0
        ? `<table><thead><tr><th>OT</th><th>Tarea</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>
            ${App.data.workOrders.filter(o=>o.vehicle===v.code&&o.type==='Preventivo').slice(0,6).map(o=>`
              <tr>
                <td class="td-mono">${o.id}</td>
                <td style="color:var(--text2)">${o.desc}</td>
                <td><span class="badge ${o.status==='Cerrada'?'badge-ok':'badge-info'}">${o.status}</span></td>
                <td class="td-mono" style="font-size:11px">${o.opened.split(' ')[0]}</td>
              </tr>`).join('')}
          </tbody></table>`
        : `<div style="color:var(--text3);font-size:13px;padding:16px 0">Sin órdenes de mantenimiento preventivo registradas para esta unidad.</div>`}`;
  }

  if (tab === 'ot') {
    content = vOT.length
      ? `<table><thead><tr><th>ID</th><th>Tipo</th><th>Descripción</th><th>Mecánico</th><th>Estado</th><th>Costo</th><th>Fecha</th><th></th></tr></thead>
          <tbody>${vOT.map(o=>`<tr>
            <td class="td-mono td-main">${o.id}</td>
            <td><span class="badge ${o.type==='Preventivo'?'badge-ok':'badge-danger'}">${o.type}</span></td>
            <td style="max-width:200px;color:var(--text2)">${o.desc}</td>
            <td>${o.mechanic}</td>
            <td><span class="badge ${o.status==='Cerrada'?'badge-ok':o.status==='En proceso'?'badge-info':'badge-warn'}">${o.status}</span></td>
            <td class="td-mono">${(o.parts_cost+o.labor_cost)>0?'$'+((o.parts_cost+o.labor_cost)/1000).toFixed(0)+'K':'—'}</td>
            <td class="td-mono" style="font-size:11px">${o.opened.split(' ')[0]}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="printOT('${o.id}')">🖨</button></td>
          </tr>`).join('')}</tbody></table>`
      : `<div style="color:var(--text3);font-size:13px;padding:24px 0;text-align:center">Sin órdenes de trabajo registradas para esta unidad.</div>`;
  }

  if (tab === 'docs') {
    content = vDocs.length
      ? `<table><thead><tr><th>Tipo</th><th>Vencimiento</th><th>Días restantes</th><th>Referencia</th><th>Estado</th></tr></thead>
          <tbody>${vDocs.map(d=>{
            const days = Math.ceil((new Date(d.expiry)-new Date())/86400000);
            return `<tr>
              <td class="td-main">${d.type}</td>
              <td class="td-mono">${d.expiry}</td>
              <td class="td-mono" style="color:var(--${d.status==='danger'?'danger':d.status==='warn'?'warn':'ok'})">${days<0?'Vencido hace '+Math.abs(days)+'d':days+'d'}</td>
              <td style="color:var(--text3);font-size:12px">${d.ref||'—'}</td>
              <td><span class="badge ${d.status==='ok'?'badge-ok':d.status==='warn'?'badge-warn':'badge-danger'}">${d.status==='ok'?'Vigente':d.status==='warn'?'Por vencer':'Vencido'}</span></td>
            </tr>`;}).join('')}</tbody></table>`
      : `<div style="color:var(--text3);font-size:13px;padding:24px 0;text-align:center">Sin documentos registrados para esta unidad.</div>`;
  }

  if (tab === 'fuel') {
    content = vFuel.length
      ? `<div style="margin-bottom:12px;font-size:12px;color:var(--text3)">Últimas ${vFuel.length} cargas registradas para esta unidad.</div>
         <table><thead><tr><th>Fecha</th><th>Litros</th><th>Odómetro</th><th>Precio/L</th><th>Total</th><th>Lugar</th></tr></thead>
          <tbody>${vFuel.map(f=>`<tr>
            <td class="td-mono" style="font-size:11px">${f.date}</td>
            <td class="td-mono">${f.liters} L</td>
            <td class="td-mono">${f.km.toLocaleString()} km</td>
            <td class="td-mono">$${f.ppu.toLocaleString()}</td>
            <td class="td-mono">$${f.total.toLocaleString()}</td>
            <td style="color:var(--text3)">${f.place}</td>
          </tr>`).join('')}</tbody></table>`
      : `<div style="color:var(--text3);font-size:13px;padding:24px 0;text-align:center">Sin cargas de combustible registradas para esta unidad.</div>`;
  }

  openModal(`${v.code} — ${v.brand} ${v.model}`, header + tabBar + `<div id="ficha-tab-content">${content}</div>`, [
    { label:'Nueva OT',   cls:'btn-primary',   fn: () => { closeModal(); openNewOTModal(v.code); } },
    { label:'Editar',     cls:'btn-secondary', fn: () => openEditVehicleModal(id) },
    { label:'Cerrar',     cls:'btn-secondary', fn: closeModal },
  ]);
}

// ── EDITAR datos generales del vehículo ──
function openEditVehicleModal(id) {
  const v = App.data.vehicles.find(x=>x.id===id);
  if (!v) return;
  openModal('Editar unidad — ' + v.code, `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Código interno</label><input class="form-input" id="ev-code" value="${v.code}"></div>
      <div class="form-group"><label class="form-label">Patente</label><input class="form-input" id="ev-plate" value="${v.plate}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Marca</label><input class="form-input" id="ev-brand" value="${v.brand}"></div>
      <div class="form-group"><label class="form-label">Modelo</label><input class="form-input" id="ev-model" value="${v.model}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Año</label><input class="form-input" type="number" id="ev-year" value="${v.year}"></div>
      <div class="form-group"><label class="form-label">Tipo</label>
        <select class="form-select" id="ev-type">
          ${(App.config?.vehicle_types||['tractor','camion','semirremolque','acoplado','utilitario','autoelevador']).map(t=>`<option ${t===v.type?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Base operativa</label>
        <select class="form-select" id="ev-base">
          ${(App.config?.bases||['Central','Norte','Sur']).map(b=>`<option ${b===v.base?'selected':''}>${b}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Chofer habitual</label><input class="form-input" id="ev-driver" value="${v.driver}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">${v.type==='autoelevador'?'Horas actuales':'Km actuales'}</label><input class="form-input" type="number" id="ev-km" value="${v.km}"></div>
      <div class="form-group"><label class="form-label">Estado</label>
        <select class="form-select" id="ev-status">
          ${['ok','warn','taller','detenida'].map(s=>`<option ${s===v.status?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">VIN / Chasis</label><input class="form-input" id="ev-vin" value="${v.vin||''}"></div>
      <div class="form-group"><label class="form-label">Número de motor</label><input class="form-input" id="ev-engine" value="${v.engine_no||''}"></div>
    </div>
    <div class="form-group"><label class="form-label">Centro de costo</label><input class="form-input" id="ev-cc" value="${v.cost_center||''}"></div>
  `, [
    { label:'Guardar cambios', cls:'btn-primary',   fn: () => saveEditVehicle(id) },
    { label:'Cancelar',        cls:'btn-secondary', fn: () => showVehicleFicha(id, 'general') },
  ]);
}

async function saveEditVehicle(id) {
  const code   = (document.getElementById('ev-code')?.value   || '').trim();
  const plate  = (document.getElementById('ev-plate')?.value  || '').trim();
  const brand  = (document.getElementById('ev-brand')?.value  || '').trim();
  const model  = (document.getElementById('ev-model')?.value  || '').trim();
  const year   = parseInt(document.getElementById('ev-year')?.value)  || new Date().getFullYear();
  const type   = document.getElementById('ev-type')?.value;
  const base   = (document.getElementById('ev-base')?.value   || '').trim();
  const km     = parseInt(document.getElementById('ev-km')?.value)    || 0;
  const status = document.getElementById('ev-status')?.value  || 'ok';
  const driver = (document.getElementById('ev-driver')?.value || '').trim();
  const vin    = (document.getElementById('ev-vin')?.value    || '').trim();
  const engine = (document.getElementById('ev-engine')?.value || '').trim();
  const cc     = (document.getElementById('ev-cc')?.value     || '').trim();

  if (!code || !plate) { showToast('error','Código y patente son obligatorios'); return; }

  const res = await apiFetch(`/api/vehicles/${id}`, {
    method:'PUT',
    body: JSON.stringify({ code, plate, brand, model, year, type, base, km_current: km,
                           status, driver, vin, engine_no: engine, cost_center: cc })
  });
  if (!res.ok) { const e=await res.json(); showToast('error',e.error||'Error al guardar'); return; }

  const updated = await res.json();
  // Actualizar directamente en App.data sin recargar todo
  const idx = App.data.vehicles.findIndex(v=>v.id===id);
  if (idx>=0) {
    App.data.vehicles[idx] = Object.assign(App.data.vehicles[idx], {
      code, plate, brand, model, year, type, base, status,
      km: km,
      driver: updated.driver_name || driver || '—',
      vin, engine_no: engine, cost_center: cc
    });
  }
  closeModal();
  showToast('ok',`Unidad ${code} actualizada`);
  renderFleet();
  // Refrescar datos en background
  loadInitialData().then(()=>renderFleet());
}

async function saveNewOT() {
  const vehicle_id= document.getElementById('ot-vehicle')?.value || '';
  const title     = (document.getElementById('ot-title')?.value || document.getElementById('ot-type')?.value || 'Nueva OT').trim();
  const priority  = document.getElementById('ot-priority')?.value || 'media';
  const assigned  = (document.getElementById('ot-assigned')?.value || '').trim();
  const due_date  = document.getElementById('ot-due')?.value || null;
  const notes     = (document.getElementById('ot-notes')?.value || '').trim();

  // Partes/repuestos del formulario
  const parts = typeof _otParts !== 'undefined' ? _otParts : [];
  const labor_cost = parseInt(document.getElementById('ot-labor')?.value) || 0;

  if (!vehicle_id) { showToast('error','Seleccioná una unidad'); return; }
  if (!title)      { showToast('error','Ingresá un título para la OT'); return; }

  const res = await apiFetch('/api/workorders', {
    method: 'POST',
    body: JSON.stringify({ vehicle_id, title, priority, assigned_to: assigned, due_date, notes, parts, labor_cost })
  });
  if (!res.ok) { const e=await res.json(); showToast('error', e.error||'Error al crear OT'); return; }

  closeModal(); showToast('ok','OT creada correctamente');
  renderWorkOrders(); loadInitialData().then(()=>renderWorkOrders());
}


function openEditOTModal(id) {
  const ot = App.data.workOrders.find(o=>o.id===id);
  if (!ot) return;
  const statusOpts = ['En proceso','Pendiente','Esperando repuesto','Esperando tercerizado','Asignada'];
  const prioOpts   = ['Normal','Media','Urgente'];
  const typeOpts   = ['Correctivo','Preventivo','Predictivo'];

  openModal(`Editar OT — ${id}`, `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--text3);font-family:var(--mono)">
      Abierta: ${ot.opened} &nbsp;·&nbsp; Vehículo: ${ot.vehicle}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Vehículo (código)</label>
        <input class="form-input" id="eo-vehicle" value="${ot.vehicle}">
      </div>
      <div class="form-group">
        <label class="form-label">Tipo de trabajo</label>
        <select class="form-select" id="eo-type">
          ${typeOpts.map(t=>`<option ${t===ot.type?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Prioridad</label>
        <select class="form-select" id="eo-priority">
          ${prioOpts.map(p=>`<option ${p===ot.priority?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Estado actual</label>
        <select class="form-select" id="eo-status">
          ${statusOpts.map(s=>`<option ${s===ot.status?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Mecánico asignado</label>
      <input class="form-input" id="eo-mech" value="${ot.mechanic||''}">
    </div>
    <div class="form-group">
      <label class="form-label">Descripción / diagnóstico</label>
      <textarea class="form-textarea" id="eo-desc">${ot.desc||''}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Costo repuestos ($)</label>
        <input class="form-input" type="number" id="eo-parts" value="${ot.parts_cost||0}">
      </div>
      <div class="form-group">
        <label class="form-label">Costo mano de obra ($)</label>
        <input class="form-input" type="number" id="eo-labor" value="${ot.labor_cost||0}">
      </div>
    </div>
    ${(ot.parts||[]).length>0?`
      <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--text3)">
        Esta OT tiene ${ot.parts.length} repuesto/s cargado/s. Para modificarlos cerrá y creá una nueva OT.
      </div>`:''
    }
  `, [
    { label:'Guardar cambios', cls:'btn-primary',   fn: () => saveEditOT(id) },
    { label:'Cancelar',        cls:'btn-secondary', fn: closeModal }
  ]);
}

function saveEditOT(id) {
  const ot = App.data.workOrders.find(o=>o.id===id);
  if (!ot) return;
  ot.vehicle    = document.getElementById('eo-vehicle').value  || ot.vehicle;
  ot.type       = document.getElementById('eo-type').value;
  ot.priority   = document.getElementById('eo-priority').value;
  ot.status     = document.getElementById('eo-status').value;
  ot.mechanic   = document.getElementById('eo-mech').value     || ot.mechanic;
  ot.desc       = document.getElementById('eo-desc').value     || ot.desc;
  ot.parts_cost = parseInt(document.getElementById('eo-parts').value) || ot.parts_cost;
  ot.labor_cost = parseInt(document.getElementById('eo-labor').value) || ot.labor_cost;
  closeModal();
  renderWorkOrders();
  showToast('ok', `${id} actualizada correctamente`);
}

// ── CERRAR OT con confirmación ──
function openCloseOTModal(id) {
  const ot = App.data.workOrders.find(o=>o.id===id);
  if (!ot) return;
  if (!ot.closeParts) ot.closeParts = [];

  const stockOpts = App.data.stock.map(s=>
    `<option value="${s.id}" data-cost="${s.cost}" data-name="${s.name}" data-unit="${s.unit}">${s.name} — Stock: ${s.qty} ${s.unit} — $${s.cost.toLocaleString()}</option>`
  ).join('');

  const existingPartsHTML = (ot.parts||[]).length > 0
    ? `<div style="font-size:11px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Repuestos cargados al crear la OT</div>
       <table style="width:100%;font-size:12px;margin-bottom:12px">
        <thead><tr>
          <th style="text-align:left;padding:4px 6px;color:var(--text3)">Repuesto</th>
          <th style="text-align:center;padding:4px 6px;color:var(--text3)">Cant.</th>
          <th style="text-align:left;padding:4px 6px;color:var(--text3)">Origen</th>
          <th style="text-align:right;padding:4px 6px;color:var(--text3)">Subtotal</th>
        </tr></thead>
        <tbody>${(ot.parts||[]).map(p=>`<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:5px 6px;color:var(--text)">${p.name}</td>
          <td style="padding:5px 6px;text-align:center;font-family:var(--mono)">${p.qty||1} ${p.unit||''}</td>
          <td style="padding:5px 6px"><span class="badge ${p.origin==='stock'?'badge-info':'badge-purple'}">${p.origin==='stock'?'Pañol':'Compra'}</span></td>
          <td style="padding:5px 6px;text-align:right;font-family:var(--mono)">$${((p.cost||0)*(p.qty||1)).toLocaleString()}</td>
        </tr>`).join('')}</tbody>
       </table>`
    : '';

  openModal(`Cerrar OT — ${id}`, `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:12px;margin-bottom:14px;font-size:13px">
      <div style="color:var(--text2);margin-bottom:3px;font-family:var(--mono);font-size:11px">${ot.vehicle} · ${ot.type} · ${ot.priority}</div>
      <div style="color:var(--text);font-weight:500">${ot.desc}</div>
    </div>

    ${existingPartsHTML}

    <div style="background:var(--bg3);border-radius:var(--radius);padding:12px;border:1px solid var(--border);margin-bottom:14px">
      <div style="font-size:11px;color:var(--text2);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">
        Agregar repuestos usados al cerrar
      </div>
      <div id="cl-parts-list" style="margin-bottom:8px"></div>
      <div class="form-row" style="margin-bottom:6px">
        <div class="form-group" style="margin:0">
          <label class="form-label">Origen</label>
          <select class="form-select" id="cl-origin" onchange="onClosePartOriginChange()">
            <option value="stock">Del stock / pañol</option>
            <option value="compra">Compra externa</option>
          </select>
        </div>
        <div class="form-group" style="margin:0" id="cl-stock-grp">
          <label class="form-label">Ítem del stock</label>
          <select class="form-select" id="cl-stock-id" onchange="onCloseStockSelect()">
            <option value="">— Seleccioná —</option>
            ${stockOpts}
          </select>
        </div>
        <div class="form-group" style="margin:0;display:none" id="cl-name-grp">
          <label class="form-label">Nombre del repuesto</label>
          <input class="form-input" id="cl-part-name" placeholder="Repuesto comprado externamente">
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:flex-end">
        <div class="form-group" style="margin:0;width:80px">
          <label class="form-label">Cant.</label>
          <input class="form-input" type="number" value="1" min="1" id="cl-qty" oninput="previewClosePartTotal()">
        </div>
        <div class="form-group" style="margin:0;flex:1">
          <label class="form-label">Costo unit. ($)</label>
          <input class="form-input" type="number" id="cl-unit-cost" placeholder="0" oninput="previewClosePartTotal()"><div id="cl-preview-total" style="font-size:11px;color:var(--accent);font-family:var(--mono);margin-top:3px;height:14px"></div>
        </div>
        <button class="btn btn-secondary" style="height:38px;padding:0 14px;flex-shrink:0" onclick="addCloseOTPart('${id}')">+ Agregar</button>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Causa raíz / diagnóstico final</label>
      <textarea class="form-textarea" placeholder="Describí qué se encontró y cómo se resolvió..." id="cl-causa"></textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Costo mano de obra ($)</label>
        <input class="form-input" type="number" id="cl-labor" value="${ot.labor_cost||0}">
      </div>
      <div class="form-group">
        <label class="form-label">Total repuestos (acumulado)</label>
        <input class="form-input" id="cl-parts-total" readonly style="background:var(--bg4);color:var(--text3)" value="$${((ot.parts||[]).reduce((a,b)=>a+(b.cost||0)*(b.qty||1),0)).toLocaleString()}">
      </div>
    </div>
    <div style="background:var(--ok-bg);border:1px solid rgba(34,197,94,.25);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--ok)">
      Al cerrar: se descuentan del stock los repuestos marcados como "Pañol", se actualiza el historial técnico de ${ot.vehicle} y los costos del período.
    </div>
  `, [
    { label:'Confirmar cierre', cls:'btn-primary',   fn: () => closeOTConfirmed(id) },
    { label:'Cancelar',         cls:'btn-secondary', fn: closeModal }
  ]);
  renderCloseOTPartsList(id);
}

function onClosePartOriginChange() {
  const origin = document.getElementById('cl-origin')?.value;
  const sG = document.getElementById('cl-stock-grp');
  const nG = document.getElementById('cl-name-grp');
  if (!sG || !nG) return;
  if (origin === 'stock') { sG.style.display=''; nG.style.display='none'; }
  else { sG.style.display='none'; nG.style.display=''; document.getElementById('cl-unit-cost').value=''; }
}

function onCloseStockSelect() {
  const sel = document.getElementById('cl-stock-id');
  const opt = sel?.options[sel.selectedIndex];
  if (opt?.value) document.getElementById('cl-unit-cost').value = opt.dataset.cost||'';
}

function addCloseOTPart(otId) {
  const ot     = App.data.workOrders.find(o=>o.id===otId);
  if (!ot) return;
  if (!ot.closeParts) ot.closeParts = [];
  const origin  = document.getElementById('cl-origin').value;
  const qty     = parseInt(document.getElementById('cl-qty').value) || 1;
  const cost    = parseFloat(document.getElementById('cl-unit-cost').value) || 0;

  if (origin === 'stock') {
    const sel     = document.getElementById('cl-stock-id');
    const stockId = parseInt(sel?.value);
    if (!stockId) { showToast('warn','Seleccioná un ítem del stock'); return; }
    const item    = App.data.stock.find(s=>s.id===stockId);
    if (!item)    return;
    if (item.qty < qty) { showToast('warn',`Stock insuficiente. Disponible: ${item.qty} ${item.unit}`); return; }
    ot.closeParts.push({ name:item.name, origin:'stock', stockId:item.id, qty, cost:cost||item.cost, unit:item.unit });
    sel.value = '';
  } else {
    const name = document.getElementById('cl-part-name')?.value.trim();
    if (!name) { showToast('warn','Escribí el nombre del repuesto'); return; }
    ot.closeParts.push({ name, origin:'compra', stockId:null, qty, cost });
    document.getElementById('cl-part-name').value = '';
  }
  document.getElementById('cl-qty').value = '1';
  document.getElementById('cl-unit-cost').value = '';
  renderCloseOTPartsList(otId);
}

function renderCloseOTPartsList(otId) {
  const ot   = App.data.workOrders.find(o=>o.id===otId);
  if (!ot) return;
  const list = document.getElementById('cl-parts-list');
  const totalEl = document.getElementById('cl-parts-total');
  if (!list) return;
  const parts = ot.closeParts || [];
  if (!parts.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--text3)">Sin repuestos agregados en el cierre aún.</div>';
  } else {
    list.innerHTML = `<table style="width:100%;font-size:12px;margin-bottom:4px">
      <tbody>${parts.map((p,i)=>`<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:5px 6px;color:var(--text)">${p.name}</td>
        <td style="padding:5px 6px;text-align:center;font-family:var(--mono)">${p.qty||1}</td>
        <td style="padding:5px 6px"><span class="badge ${p.origin==='stock'?'badge-info':'badge-purple'}">${p.origin==='stock'?'Pañol':'Compra'}</span></td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono)">$${((p.cost||0)*(p.qty||1)).toLocaleString()}</td>
        <td style="padding:5px 4px;text-align:center">
          <button onclick="removeCloseOTPart('${otId}',${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;line-height:1">✕</button>
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
  // Actualizar total acumulado
  const existing = (ot.parts||[]).reduce((a,b)=>a+(b.cost||0)*(b.qty||1),0);
  const closing  = parts.reduce((a,b)=>a+(b.cost||0)*(b.qty||1),0);
  if (totalEl) totalEl.value = '$' + (existing+closing).toLocaleString();
}

function removeCloseOTPart(otId, i) {
  const ot = App.data.workOrders.find(o=>o.id===otId);
  if (ot?.closeParts) { ot.closeParts.splice(i,1); renderCloseOTPartsList(otId); }
}

function closeOTConfirmed(id) {
  const ot = App.data.workOrders.find(o=>o.id===id);
  if (!ot) return;

  // Descontar del stock los repuestos del cierre
  let descuentos = 0;
  (ot.closeParts||[]).filter(p=>p.origin==='stock'&&p.stockId).forEach(p=>{
    const item = App.data.stock.find(s=>s.id===p.stockId);
    if (item && item.qty >= (p.qty||1)) {
      item.qty -= (p.qty||1);
      descuentos++;
    }
  });

  // Combinar partes
  if ((ot.closeParts||[]).length > 0) {
    ot.parts      = [...(ot.parts||[]), ...ot.closeParts];
    const closing = ot.closeParts.reduce((a,b)=>a+(b.cost||0)*(b.qty||1),0);
    ot.parts_cost = (ot.parts_cost||0) + closing;
  }

  ot.status     = 'Cerrada';
  ot.labor_cost = parseInt(document.getElementById('cl-labor').value)||ot.labor_cost||0;
  ot.causa_raiz = document.getElementById('cl-causa').value || '—';
  ot.closed     = new Date().toISOString().slice(0,16).replace('T',' ');
  delete ot.closeParts;

  closeModal();
  renderWorkOrders();
  showToast('ok', `${id} cerrada${descuentos>0?' · '+descuentos+' ítems descontados del stock':''}`);
}

function closeOT(id) { openCloseOTModal(id); }

// ── IMPRIMIR OT ──
function printOT(id) {
  const ot = App.data.workOrders.find(o=>o.id===id);
  if (!ot) return;
  const v = App.data.vehicles.find(x=>x.code===ot.vehicle);

  // Combinar repuestos del alta + del cierre (closeParts si la OT aún no cerró)
  const allParts = [].concat(ot.parts||[], ot.closeParts||[]);

  // Calcular total correcto: qty × costo unitario
  const partsTotal = allParts.reduce(function(a,p){ return a + (p.cost||0)*(p.qty||1); }, 0);
  const totalCost  = partsTotal + (ot.labor_cost||0);

  // Generar filas de repuestos
  let partsRows = '';
  if (allParts.length > 0) {
    allParts.forEach(function(p) {
      const subtotal = (p.cost||0) * (p.qty||1);
      const origen   = p.origin==='stock' ? 'Pañol / stock' : 'Compra externa';
      partsRows += '<tr>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">' + p.name + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">' + (p.qty||1) + ' ' + (p.unit||'un') + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">' + origen + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">$' + (p.cost||0).toLocaleString() + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">$' + subtotal.toLocaleString() + '</td>'
        + '</tr>';
    });
  } else {
    partsRows = '<tr><td colspan="5" style="padding:10px;color:#9ca3af;text-align:center">Sin repuestos registrados</td></tr>';
  }


  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8">
    <title>Orden de Trabajo ${ot.id}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; padding: 32px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 2px solid #111; }
      .logo { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
      .logo span { color: #2563eb; }
      .logo-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
      .ot-id { font-size: 24px; font-weight: 700; font-family: monospace; color: #111; text-align: right; }
      .ot-date { font-size: 11px; color: #6b7280; text-align: right; margin-top: 4px; }
      .status-bar { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; margin-top: 4px; }
      .status-cerrada { background: #dcfce7; color: #166534; }
      .status-proceso  { background: #dbeafe; color: #1e40af; }
      .status-other    { background: #f3f4f6; color: #374151; }
      .section { margin-bottom: 22px; }
      .section-title { font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .8px; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
      .field { margin-bottom: 10px; }
      .field-label { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 2px; }
      .field-value { font-size: 13px; font-weight: 500; color: #111; }
      .desc-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; font-size: 13px; line-height: 1.6; color: #374151; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      thead tr { background: #f9fafb; }
      th { text-align: left; padding: 8px; border-bottom: 2px solid #e5e7eb; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #6b7280; }
      .total-row { background: #f9fafb; }
      .total-row td { padding: 8px; font-weight: 700; border-top: 2px solid #111; }
      .firma-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 32px; margin-top: 40px; }
      .firma-box { border-top: 1px solid #111; padding-top: 8px; font-size: 11px; color: #6b7280; text-align: center; }
      .badge-stock   { background: #dbeafe; color: #1e40af; padding: 2px 7px; border-radius: 10px; font-size: 10px; }
      .badge-compra  { background: #ede9fe; color: #5b21b6; padding: 2px 7px; border-radius: 10px; font-size: 10px; }
      .badge-urgente { background: #fee2e2; color: #991b1b; padding: 2px 7px; border-radius: 10px; font-size: 10px; }
      .badge-normal  { background: #f3f4f6; color: #374151; padding: 2px 7px; border-radius: 10px; font-size: 10px; }
      .badge-prev    { background: #dcfce7; color: #166534; padding: 2px 7px; border-radius: 10px; font-size: 10px; }
      .badge-corr    { background: #fee2e2; color: #991b1b; padding: 2px 7px; border-radius: 10px; font-size: 10px; }
      @media print {
        body { padding: 16px; }
        @page { margin: 12mm; }
      }
    </style>
  </head><body>

    <div class="header">
      <div>
        <div class="logo">Fleet<span>OS</span></div>
        <div class="logo-sub">Sistema de gestión de flota pesada</div>
      </div>
      <div style="text-align:right">
        <div class="ot-id">${ot.id}</div>
        <div class="ot-date">Apertura: ${ot.opened}</div>
        ${ot.closed ? `<div class="ot-date">Cierre: ${ot.closed}</div>` : ''}
        <div style="margin-top:6px">
          <span class="status-${ot.status==='Cerrada'?'cerrada':ot.status==='En proceso'?'proceso':'other'}">${ot.status}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Datos del vehículo</div>
      <div class="grid-3">
        <div class="field"><div class="field-label">Código interno</div><div class="field-value">${ot.vehicle}</div></div>
        <div class="field"><div class="field-label">Patente</div><div class="field-value">${v?v.plate:ot.plate||'—'}</div></div>
        <div class="field"><div class="field-label">Marca / Modelo</div><div class="field-value">${v?v.brand+' '+v.model:'—'}</div></div>
        <div class="field"><div class="field-label">Km al momento</div><div class="field-value">${v?v.km.toLocaleString()+' km':'—'}</div></div>
        <div class="field"><div class="field-label">Base operativa</div><div class="field-value">${v?v.base:'—'}</div></div>
        <div class="field"><div class="field-label">Chofer habitual</div><div class="field-value">${v?v.driver:'—'}</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Datos de la orden</div>
      <div class="grid-3" style="margin-bottom:12px">
        <div class="field"><div class="field-label">Tipo de trabajo</div><div class="field-value"><span class="${ot.type==='Preventivo'?'badge-prev':'badge-corr'}">${ot.type}</span></div></div>
        <div class="field"><div class="field-label">Prioridad</div><div class="field-value"><span class="${ot.priority==='Urgente'?'badge-urgente':'badge-normal'}">${ot.priority}</span></div></div>
        <div class="field"><div class="field-label">Mecánico asignado</div><div class="field-value">${ot.mechanic}</div></div>
      </div>
      <div class="field"><div class="field-label">Descripción / diagnóstico</div></div>
      <div class="desc-box">${ot.desc}</div>
      ${ot.causa_raiz && ot.causa_raiz !== '—' ? `
        <div class="field" style="margin-top:12px"><div class="field-label">Causa raíz / resolución</div></div>
        <div class="desc-box">${ot.causa_raiz}</div>
      ` : ''}
    </div>

    <div class="section">
      <div class="section-title">Repuestos e insumos utilizados</div>
      <table>
        <thead><tr>
          <th>Repuesto / insumo</th>
          <th style="text-align:center">Cant.</th>
          <th style="text-align:center">Origen</th>
          <th style="text-align:right">Precio unit.</th>
          <th style="text-align:right">Subtotal</th>
        </tr></thead>
        <tbody>${partsRows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="4">Subtotal repuestos</td>
            <td style="text-align:right">$${partsTotal.toLocaleString()}</td>
          </tr>
          <tr class="total-row">
            <td colspan="4">Mano de obra</td>
            <td style="text-align:right">$${(ot.labor_cost||0).toLocaleString()}</td>
          </tr>
          <tr class="total-row" style="font-size:14px">
            <td colspan="4" style="font-size:14px">TOTAL ORDEN DE TRABAJO</td>
            <td style="text-align:right;font-size:14px">$${totalCost.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="firma-row">
      <div class="firma-box">Mecánico responsable<br><br><br></div>
      <div class="firma-box">Jefe de mantenimiento<br><br><br></div>
      <div class="firma-box">Conformidad / recepción<br><br><br></div>
    </div>

    <div style="margin-top:32px;font-size:10px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;padding-top:10px">
      FleetOS · Orden de Trabajo ${ot.id} · Generado el ${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}
    </div>

    <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  win.document.close();
}

// ── COMBUSTIBLE ──
function renderFuel() {
  // ── Cisternas desde API ──
  const tanks = App.data.tanks || [];
  const gasoilTank = tanks.find(t => t.type === 'fuel' || t.type === 'gasoil') || { current_l:0, capacity_l:47000 };
  const ureaTank   = tanks.find(t => t.type === 'urea')                         || { current_l:0, capacity_l:2000 };
  const tankLevel  = parseFloat(gasoilTank.current_l) || 0;
  const tankCap    = parseFloat(gasoilTank.capacity_l) || 47000;
  const ureaLevel  = parseFloat(ureaTank.current_l) || 0;
  const ureaCap    = parseFloat(ureaTank.capacity_l) || 2000;
  const gasoilPct  = tankCap > 0 ? Math.round(tankLevel/tankCap*100) : 0;
  const ureaPct    = ureaCap > 0 ? Math.round(ureaLevel/ureaCap*100) : 0;
  const gasoilClass = gasoilPct < 20 ? 'warn' : 'info';
  const ureaClass   = ureaPct   < 20 ? 'warn' : 'info';

  // ── Litros cargados HOY ──
  const today = new Date().toISOString().slice(0,10);
  const logsHoy = App.data.fuelLogs.filter(f => f.date && f.date.startsWith(today));
  const litrosHoy = logsHoy.reduce((a,b) => a + (b.liters||0), 0);

  // ── Rendimiento promedio real ──
  // Necesita logs con km y litros. Calcular km/litro por vehiculo en últimos 30 días
  const logsConKm = App.data.fuelLogs.filter(f => f.km > 0 && f.liters > 0);
  let rendimiento = '—';
  let rendTrend = 'sin datos suficientes aún';
  if (logsConKm.length >= 2) {
    // Agrupar por vehículo y calcular diferencia de km entre cargas
    const byVehicle = {};
    logsConKm.forEach(f => {
      if (!byVehicle[f.vehicle]) byVehicle[f.vehicle] = [];
      byVehicle[f.vehicle].push(f);
    });
    let totalRend = 0, count = 0;
    Object.values(byVehicle).forEach(logs => {
      const sorted = logs.sort((a,b) => a.km - b.km);
      for (let i = 1; i < sorted.length; i++) {
        const kmDiff = sorted[i].km - sorted[i-1].km;
        const lts = sorted[i].liters;
        if (kmDiff > 0 && kmDiff < 5000 && lts > 0) {
          totalRend += kmDiff / lts;
          count++;
        }
      }
    });
    if (count > 0) {
      rendimiento = (totalRend/count).toFixed(1);
      rendTrend = `km/litro · basado en ${count} cargas`;
    }
  }
  document.getElementById('page-fuel').innerHTML = `
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card ${gasoilClass}"><div class="kpi-label">Stock cisterna gasoil</div><div class="kpi-value ${gasoilClass}">${tankLevel.toLocaleString()} L</div><div class="kpi-trend">${gasoilPct}% de capacidad (${tankCap.toLocaleString()} L)${gasoilPct<20?' · ⚠ Solicitar reposición':''}</div></div>
      <div class="kpi-card ${ureaClass}"><div class="kpi-label">Stock cisterna urea</div><div class="kpi-value ${ureaClass}">${ureaLevel.toLocaleString()} L</div><div class="kpi-trend">${ureaPct}% de capacidad (${ureaCap.toLocaleString()} L)${ureaPct<20?' · ⚠ Solicitar reposición':''}</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Litros cargados hoy</div><div class="kpi-value ok">${litrosHoy.toLocaleString()}</div><div class="kpi-trend">en ${logsHoy.length} cargas · ${App.data.fuelLogs.length} total historial</div></div>
      <div class="kpi-card ${rendimiento==='—'?'':'ok'}"><div class="kpi-label">Rendimiento promedio</div><div class="kpi-value ${rendimiento==='—'?'white':'ok'}">${rendimiento}</div><div class="kpi-trend">${rendTrend}</div></div>
    </div>
    <div class="two-col" style="margin-bottom:20px">
      <div class="card">
        <div class="card-title">Nivel de cisternas</div>
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px"><span>Gasoil</span><span class="td-mono">${tankLevel.toLocaleString()} / ${tankCap.toLocaleString()} L</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${gasoilPct}%;background:${gasoilPct<20?'var(--warn)':'var(--ok)'}"></div></div>
        </div>
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px"><span ${ureaPct<20?'style="color:var(--warn)"':''}>Urea / AdBlue</span><span class="td-mono" ${ureaPct<20?'style="color:var(--warn)"':''}>${ureaLevel.toLocaleString()} / ${ureaCap.toLocaleString()} L ${ureaPct<20?'⚠':''}</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${ureaPct}%;background:${ureaPct<20?'var(--warn)':'var(--ok)'}"></div></div>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px"><button class="btn btn-primary" onclick="openFuelEntryModal()">+ Registrar ingreso a cisterna</button><button class="btn btn-secondary" onclick="openEditTankCapacityModal()">⚙ Editar capacidad</button></div>
      </div>
      <div class="card">
        <div class="card-title">Consumo por unidad (últimos 30 días)</div>
        <div style="position:relative;height:180px"><canvas id="fuelChart" role="img" aria-label="Consumo de combustible por unidad"></canvas></div>
      </div>
    </div>
    <div class="section-header">
      <div><div class="section-title">Registro de cargas</div></div>
      <button class="btn btn-primary" onclick="openFuelLoadModal()">+ Registrar carga</button>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table><thead><tr><th>Fecha</th><th>Unidad</th><th>Chofer</th><th>Tipo</th><th>Litros</th><th>Odómetro</th><th>Precio/L</th><th>Total</th><th>Lugar</th><th>Estado</th><th>Ticket</th></tr></thead>
        <tbody>${App.data.fuelLogs.map(f=>`<tr>
          <td class="td-mono" style="font-size:11px">${f.date}</td>
          <td class="td-main">${f.vehicle}</td>
          <td>${f.driver}</td>
          <td><span class="badge ${f.fuel_type==='urea'?'badge-info':'badge-ok'}" style="font-size:10px">${f.fuel_type==='urea'?'🔵 Urea':'🟡 Gasoil'}</span></td>
          <td class="td-mono">${f.liters} L</td>
          <td class="td-mono">${f.km > 0 ? f.km.toLocaleString()+' km' : '—'}</td>
          <td class="td-mono">$${f.ppu.toLocaleString()}</td>
          <td class="td-mono">$${f.total.toLocaleString()}</td>
          <td>${f.place}</td>
          <td><span class="badge ${f.status==='OK'?'badge-ok':'badge-warn'}">${f.status}</span></td>
          <td>${f.ticket_image ? `<button class="btn btn-secondary btn-sm" onclick="viewTicket('${f.id}')">📄 Ver</button>` : '<span style="color:var(--text3);font-size:11px">—</span>'}</td>
        </tr>`).join('')}</tbody></table>
      </div>
    </div>
  `;
  setTimeout(() => {
    const ctx = document.getElementById('fuelChart');
    if (!ctx) return;
    // Agrupar litros por vehículo (últimos 30 días)
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const recent = App.data.fuelLogs.filter(f => f.fuel_type !== 'urea' && new Date(f.date) >= cutoff);
    const byVeh = {};
    recent.forEach(f => { byVeh[f.vehicle] = (byVeh[f.vehicle] || 0) + f.liters; });
    const sorted = Object.entries(byVeh).sort((a,b) => b[1]-a[1]).slice(0,15);
    new Chart(ctx, {
      type:'bar',
      data:{ labels: sorted.map(e=>e[0]), datasets:[{ label:'Litros 30 días', data: sorted.map(e=>Math.round(e[1])), backgroundColor:'rgba(59,130,246,.7)', borderRadius:4, borderColor:'transparent' }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}, tooltip:{ callbacks:{ label: ctx => ctx.parsed.y.toLocaleString()+' L' } }}, scales:{ x:{ticks:{color:'#9ba3be',font:{size:11}}}, y:{ticks:{color:'#9ba3be',font:{size:11}, callback: v => v.toLocaleString()+' L'}} } }
    });
  }, 100);
}

function openFuelLoadModal() {
  const vehicleOpts = (App.data.vehicles||[]).map(v=>`<option value="${v.code}">${v.code} — ${v.plate}</option>`).join('');
  openModal('Registrar carga de combustible / urea', `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Unidad</label>
        <select class="form-select" id="fl-vehicle">
          <option value="">— Seleccioná unidad —</option>
          ${vehicleOpts}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Tipo de carga</label>
        <select class="form-select" id="fl-type" onchange="updateFuelPlaceOpts()">
          <option value="diesel">🟡 Gasoil / Diesel</option>
          <option value="urea">🔵 Urea / AdBlue</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Chofer</label><input class="form-input" placeholder="Nombre del chofer" id="fl-driver"></div>
      <div class="form-group"><label class="form-label">Lugar de carga</label>
        <select class="form-select" id="fl-place" onchange="updateFuelPlaceNote()">
          <option value="Cisterna R3">Cisterna R3 (descuenta stock)</option>
          <option value="Estación de servicio">Estación de servicio</option>
          <option value="Bidón / Sucursal">Bidón / Sucursal</option>
          <option value="Otra">Otra</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Litros cargados</label><input class="form-input" type="number" placeholder="400" id="fl-liters"></div>
      <div class="form-group"><label class="form-label" style="color:var(--text3)">🛰 Km tomados del GPS automáticamente</label><input class="form-input" disabled placeholder="Se toma del GPS al guardar" style="opacity:.5"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Precio por litro ($)</label><input class="form-input" type="number" placeholder="1250" id="fl-ppu" value="1250"></div>
    </div>
    <div id="fl-place-note" style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--warn);margin-top:4px">
      ⚠ Los litros se descontarán del stock de cisterna al confirmar.
    </div>
    <div class="form-group" style="margin-top:10px">
      <label class="form-label">📷 Foto del ticket <span style="color:var(--text3);font-weight:400">(opcional pero recomendado)</span></label>
      <div id="ticket-upload-area" style="border:2px dashed var(--border2);border-radius:var(--radius);padding:16px;text-align:center;cursor:pointer;transition:.2s;background:var(--bg3)" onclick="document.getElementById('fl-ticket-input').click()">
        <div id="ticket-preview-area">
          <div style="font-size:28px;margin-bottom:6px">📄</div>
          <div style="font-size:13px;color:var(--text3)">Tocá para subir foto del ticket</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">JPG, PNG hasta 5MB</div>
        </div>
        <input type="file" id="fl-ticket-input" accept="image/*" capture="environment" style="display:none" onchange="previewTicket(this)">
      </div>
    </div>
  `, [
    { label:'Registrar carga', cls:'btn-primary', fn: saveFuelLoad },
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal }
  ]);
}

function updateFuelPlaceOpts() {
  const tipo = document.getElementById('fl-type')?.value;
  const placeEl = document.getElementById('fl-place');
  if (!placeEl) return;
  if (tipo === 'urea') {
    placeEl.innerHTML = `
      <option value="Cisterna urea R3">Cisterna urea R3 (descuenta stock)</option>
      <option value="Bidón / Sucursal">Bidón / Sucursal</option>
      <option value="Proveedor externo">Proveedor externo</option>
    `;
  } else {
    placeEl.innerHTML = `
      <option value="Cisterna R3">Cisterna R3 (descuenta stock)</option>
      <option value="Estación de servicio">Estación de servicio</option>
      <option value="Bidón / Sucursal">Bidón / Sucursal</option>
      <option value="Otra">Otra</option>
    `;
  }
  updateFuelPlaceNote();
}

function updateFuelPlaceNote() {
  const place = document.getElementById('fl-place')?.value || '';
  const noteEl = document.getElementById('fl-place-note');
  if (!noteEl) return;
  const descuenta = place.includes('Cisterna');
  if (descuenta) {
    noteEl.style.background = 'rgba(245,158,11,.1)';
    noteEl.style.borderColor = 'rgba(245,158,11,.3)';
    noteEl.style.color = 'var(--warn)';
    noteEl.textContent = '⚠ Los litros se descontarán del stock de cisterna al confirmar.';
  } else {
    noteEl.style.background = 'rgba(99,102,241,.1)';
    noteEl.style.borderColor = 'rgba(99,102,241,.3)';
    noteEl.style.color = 'var(--info, #60a5fa)';
    noteEl.textContent = '📦 Carga externa — no descuenta del stock de cisterna. Solo registra el consumo y costo.';
  }
}

function previewTicket(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { showToast('error','La imagen es muy grande (máx 5MB)'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    window._ticketImage = e.target.result; // base64
    const area = document.getElementById('ticket-preview-area');
    if (area) area.innerHTML = `
      <img src="${e.target.result}" style="max-height:120px;max-width:100%;border-radius:6px;object-fit:contain">
      <div style="font-size:11px;color:var(--ok);margin-top:6px">✓ Ticket cargado — ${(file.size/1024).toFixed(0)} KB</div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px">Tocá para cambiar</div>
    `;
  };
  reader.readAsDataURL(file);
}

async function saveFuelLoad() {
  const vehicle_id = document.getElementById('fl-vehicle')?.value || '';
  const liters     = parseFloat(document.getElementById('fl-liters')?.value) || 0;
  const ppu        = parseFloat(document.getElementById('fl-ppu')?.value)    || 0;
  const km         = parseInt(document.getElementById('fl-km')?.value)       || 0;
  const driver     = (document.getElementById('fl-driver')?.value || '').trim();
  const type       = document.getElementById('fl-type')?.value || 'diesel';
  const place      = document.getElementById('fl-place')?.value || '';
  const ticketImg  = window._ticketImage || null;

  if (!vehicle_id) { showToast('error','Seleccioná una unidad'); return; }
  if (liters <= 0) { showToast('error','Ingresá los litros cargados'); return; }

  // Solo descontar de cisterna si el lugar es cisterna
  const esCisterna = place.includes('Cisterna');
  let tank_id = null;
  if (esCisterna) {
    // Buscar la cisterna correspondiente según el tipo
    const tanks = App.data.tanks || [];
    const tank = type === 'urea'
      ? tanks.find(t => t.type === 'urea')
      : tanks.find(t => t.type === 'fuel' || t.type === 'gasoil');
    tank_id = tank?.id || null;
  }

  window._ticketImage = null;

  const res = await apiFetch('/api/fuel', {
    method: 'POST',
    body: JSON.stringify({
      vehicle_id, liters, price_per_l: ppu,
      driver, fuel_type: type,
      location: place, tank_id, ticket_image: ticketImg
    })
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error || 'Error al registrar carga'); return; }

  const msg = esCisterna
    ? `Carga registrada — ${liters}L descontados de cisterna`
    : `Carga registrada — ${place}${ticketImg ? ' · con ticket 📄' : ''}`;
  closeModal(); showToast('ok', msg);
  loadInitialData().then(() => renderFuel());
}


function viewTicket(fuelLogId) {
  const log = App.data.fuelLogs.find(f => f.id === fuelLogId);
  if (!log?.ticket_image) { showToast('warn','No hay ticket guardado para esta carga'); return; }
  openModal(`📄 Ticket — ${log.vehicle} (${log.date})`, `
    <div style="text-align:center">
      <img src="${log.ticket_image}" style="max-width:100%;max-height:65vh;border-radius:8px;object-fit:contain;box-shadow:0 4px 20px rgba(0,0,0,.4)">
      <div style="margin-top:10px;font-size:12px;color:var(--text3)">${log.liters} L · ${log.place} · $${log.total.toLocaleString()}</div>
    </div>
    <div style="text-align:center;margin-top:12px">
      <a href="${log.ticket_image}" download="ticket-${log.vehicle}-${log.date?.replace(/[: ]/g,'-')}.jpg" class="btn btn-secondary btn-sm">⬇ Descargar</a>
    </div>
  `, [{ label:'Cerrar', cls:'btn-secondary', fn: closeModal }]);
}

function openFuelEntryModal() {
  const tanks = App.data.tanks || [];
  const gasoilTank = tanks.find(t => t.type === 'fuel' || t.type === 'gasoil');
  const ureaTank   = tanks.find(t => t.type === 'urea');
  const gasoilNivel = gasoilTank ? `${Math.round(gasoilTank.current_l).toLocaleString()} / ${Math.round(gasoilTank.capacity_l).toLocaleString()} L` : 'Sin datos';
  const ureaNivel   = ureaTank   ? `${Math.round(ureaTank.current_l).toLocaleString()} / ${Math.round(ureaTank.capacity_l).toLocaleString()} L` : 'Sin datos';
  openModal('Ingreso a cisterna', `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Tipo</label>
        <select class="form-select" id="fe-type" onchange="document.getElementById('fe-nivel-actual').textContent=this.value==='Gasoil'?'${gasoilNivel}':'${ureaNivel}'">
          <option value="gasoil">Gasoil</option>
          <option value="urea">Urea / AdBlue</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Litros a ingresar</label><input class="form-input" type="number" placeholder="5000" id="fe-liters" min="1"></div>
    </div>
    <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--text3);margin-bottom:10px">
      Nivel actual: <strong id="fe-nivel-actual">${gasoilNivel}</strong>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Proveedor</label><input class="form-input" placeholder="Nombre del proveedor" id="fe-supplier"></div>
      <div class="form-group"><label class="form-label">Precio por litro ($)</label><input class="form-input" type="number" placeholder="1200" id="fe-ppu"></div>
    </div>
    <div class="form-group"><label class="form-label">Número de remito</label><input class="form-input" placeholder="REM-00001" id="fe-remito"></div>
  `, [
    { label:'Confirmar ingreso', cls:'btn-primary', fn: saveFuelEntry },
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal }
  ]);
}

async function saveFuelEntry() {
  const type   = document.getElementById('fe-type')?.value || 'gasoil';
  const liters = parseFloat(document.getElementById('fe-liters')?.value) || 0;
  if (liters <= 0) { showToast('error', 'Ingresá la cantidad de litros'); return; }

  const tanks = App.data.tanks || [];
  const tank  = type === 'urea'
    ? tanks.find(t => t.type === 'urea')
    : tanks.find(t => t.type === 'fuel' || t.type === 'gasoil');

  if (!tank) { showToast('error', 'No se encontró la cisterna en el sistema'); return; }

  const capacidad  = parseFloat(tank.capacity_l) || 47000;
  const nivelActual = parseFloat(tank.current_l) || 0;
  const nuevoNivel  = nivelActual + liters;

  if (nuevoNivel > capacidad) {
    showToast('error', `Excede la capacidad (${capacidad.toLocaleString()} L). Nivel actual: ${Math.round(nivelActual).toLocaleString()} L`);
    return;
  }

  const res = await apiFetch(`/api/fuel/tanks/${tank.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ current_l: nuevoNivel })
  });

  if (!res.ok) { showToast('error', 'Error al registrar ingreso'); return; }

  // Actualizar en memoria
  tank.current_l = nuevoNivel;
  closeModal();
  showToast('ok', `✅ ${liters.toLocaleString()} L de ${type} ingresados a cisterna — nuevo nivel: ${Math.round(nuevoNivel).toLocaleString()} L`);
  renderFuel();
}


async function openEditTankCapacityModal() {
  const tanks = App.data.tanks || [];
  const gasoilTank = tanks.find(t => t.type === 'fuel' || t.type === 'gasoil');
  const ureaTank   = tanks.find(t => t.type === 'urea');
  openModal('⚙ Editar capacidad de cisternas', `
    <div class='form-group' style='margin-bottom:12px'>
      <label class='form-label'>Capacidad cisterna gasoil (L)</label>
      <input class='form-input' type='number' id='tc-gasoil' value='${gasoilTank ? gasoilTank.capacity_l : 47000}'>
    </div>
    <div class='form-group'>
      <label class='form-label'>Capacidad cisterna urea (L)</label>
      <input class='form-input' type='number' id='tc-urea' value='${ureaTank ? ureaTank.capacity_l : 2000}'>
    </div>
  `, [
    { label:'Guardar', cls:'btn-primary', fn: async () => {
      const gasoilCap = parseInt(document.getElementById('tc-gasoil').value);
      const ureaCap   = parseInt(document.getElementById('tc-urea').value);
      if (gasoilTank) await apiFetch(`/api/fuel/tanks/${gasoilTank.id}`, { method:'PATCH', body: JSON.stringify({ capacity_l: gasoilCap }) });
      if (ureaTank)   await apiFetch(`/api/fuel/tanks/${ureaTank.id}`,   { method:'PATCH', body: JSON.stringify({ capacity_l: ureaCap }) });
      // Recargar tanks
      const r = await apiFetch('/api/fuel/tanks');
      if (r.ok) App.data.tanks = await r.json();
      closeModal();
      navigate('fuel');
      showToast('ok', 'Capacidad de cisternas actualizada');
    }},
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal }
  ]);
}

const AXLE_CONFIGS = {
  tractor: [
    { name:'Eje 1 — Dirección', positions:['1-DI','1-DD'],                       dual:false },
    { name:'Eje 2 — Tracción',  positions:['2-TIE','2-TII','2-TDE','2-TDD'],     dual:true  },
    { name:'Eje 3 — Tracción',  positions:['3-TIE','3-TII','3-TDE','3-TDD'],     dual:true  },
  ],
  camion: [
    { name:'Eje 1 — Dirección', positions:['1-DI','1-DD'],                       dual:false },
    { name:'Eje 2 — Tracción',  positions:['2-TIE','2-TII','2-TDE','2-TDD'],     dual:true  },
  ],
  semirremolque: [
    { name:'Eje 1 — Portante',  positions:['S1-IE','S1-II','S1-DE','S1-DD'],     dual:true  },
    { name:'Eje 2 — Portante',  positions:['S2-IE','S2-II','S2-DE','S2-DD'],     dual:true  },
    { name:'Eje 3 — Portante',  positions:['S3-IE','S3-II','S3-DE','S3-DD'],     dual:true  },
  ],
};

let _dragSerial  = null;
let _dragFromPos = null;

// ─────────────────────────────────────────
function renderTires() {
  const mounted  = App.data.tires.filter(t=>t.vehicle!=='STOCK'&&t.vehicle!=='RECAP'&&t.vehicle!=='BAJA');
  const inStock  = App.data.tires.filter(t=>t.vehicle==='STOCK');
  const crit     = mounted.filter(t=>t.status==='danger').length;
  const warn     = mounted.filter(t=>t.status==='warn').length;

  const vehicleOpts = App.data.vehicles
    .filter(v=>['tractor','camion','semirremolque'].includes(v.type))
    .slice(0,12);

  document.getElementById('page-tires').innerHTML = `
    <div class="kpi-row" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
      <div class="kpi-card ok">
        <div class="kpi-label">Cubiertas montadas</div>
        <div class="kpi-value ok">${mounted.length}</div>
        <div class="kpi-trend">en servicio activo</div>
      </div>
      <div class="kpi-card ${warn>0?'warn':'ok'}">
        <div class="kpi-label">Requieren revisión</div>
        <div class="kpi-value ${warn>0?'warn':'ok'}">${warn}</div>
        <div class="kpi-trend">desgaste próximo al límite</div>
      </div>
      <div class="kpi-card ${crit>0?'danger':'ok'}">
        <div class="kpi-label">Críticas</div>
        <div class="kpi-value ${crit>0?'danger':'ok'}">${crit}</div>
        <div class="kpi-trend">acción urgente requerida</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-label">En stock disponible</div>
        <div class="kpi-value white">${inStock.length}</div>
        <div class="kpi-trend">listas para montar</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1.3fr;gap:16px;margin-bottom:16px">

      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
          <div class="card-title" style="margin:0">Mapa por eje — drag & drop</div>
          <select class="form-select" id="tire-vehicle-sel"
            style="width:auto;padding:5px 10px;font-size:12px"
            onchange="refreshTireMap()">
            ${vehicleOpts.map(v=>`<option value="${v.code}">${v.code} · ${v.brand.split('-')[0]} · ${v.type}</option>`).join('')}
          </select>
        </div>
        <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:10px;line-height:1.5">
          Arrastrá cubierta → posición para rotar · Clic en cubierta → ver detalle y acciones · Posición vacía → montar desde stock
        </div>
        <div id="tire-map-dnd"></div>
        <div style="display:flex;gap:12px;margin-top:10px;font-size:11px;font-family:var(--mono);flex-wrap:wrap">
          <span style="color:var(--ok)">● OK</span>
          <span style="color:var(--warn)">● Revisar</span>
          <span style="color:var(--danger)">● Crítica</span>
          <span style="color:#3b82f6">◌ Vacío (clic para montar)</span>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div class="card-title" style="margin:0">Cubiertas de la unidad seleccionada</div>
          <button class="btn btn-primary btn-sm" onclick="openMountTireModal()">+ Montar cubierta</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Serie</th><th>Posición</th><th>Marca</th><th>Km</th><th>Dibujo</th><th>Estado</th><th></th></tr></thead>
            <tbody id="tire-table-body"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">Stock de cubiertas disponibles para montar</div>
        <button class="btn btn-secondary btn-sm" onclick="openNewTireToStockModal()">+ Agregar al stock</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Serie</th><th>Marca / Modelo</th><th>Medida</th><th>Km acum.</th><th>Dibujo</th><th>Tipo</th><th>Precio compra</th><th></th></tr></thead>
          <tbody>${App.data.tires.filter(t=>t.vehicle==='STOCK').map(t=>`<tr>
            <td class="td-mono td-main">${t.serial}</td>
            <td>${t.brand}</td>
            <td class="td-mono">${t.size}</td>
            <td class="td-mono">${t.km.toLocaleString()} km</td>
            <td class="td-mono" style="color:var(--ok)">${t.depth}/${t.maxDepth}mm</td>
            <td><span class="badge ${t.km===0?'badge-ok':'badge-purple'}">${t.km===0?'Nueva':'Usada/Recapada'}</span></td>
            <td class="td-mono">$${t.purchase.toLocaleString()}</td>
            <td><button class="btn btn-primary btn-sm" onclick="openMountFromStockModal('${t.serial}')">Montar</button></td>
          </tr>`).join('')||'<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:16px">Sin cubiertas en stock</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">Historial de movimientos</div>
        <div style="display:flex;gap:8px">
          <select class="form-select" id="hist-filter"
            style="width:auto;padding:5px 10px;font-size:12px"
            onchange="renderTireHistory()">
            <option value="">Todas las cubiertas</option>
            ${App.data.tires.map(t=>`<option value="${t.serial}">${t.serial}</option>`).join('')}
          </select>
          <button class="btn btn-secondary btn-sm" onclick="openManualMoveModal()">+ Registrar movimiento</button>
        </div>
      </div>
      <div id="tire-history-table"></div>
    </div>
  `;

  refreshTireMap();
  renderTireHistory();
}

// ─────────────────────────────────────────
function getSelectedVehicle() {
  const sel = document.getElementById('tire-vehicle-sel');
  return sel ? sel.value : (App.data.tires.find(t=>t.vehicle!=='STOCK'&&t.vehicle!=='RECAP'&&t.vehicle!=='BAJA')?.vehicle || 'INT-12');
}

function refreshTireMap() {
  const code    = getSelectedVehicle();
  const vehicle = App.data.vehicles.find(v=>v.code===code);
  const config  = AXLE_CONFIGS[vehicle?.type] || AXLE_CONFIGS['tractor'];
  renderTireMapDnD(code, config);
  renderTireTableBody(code);
}

// ─────────────────────────────────────────
function renderTireMapDnD(vehicleCode, config) {
  const map = document.getElementById('tire-map-dnd');
  if (!map) return;

  map.innerHTML = config.map(axle => {
    const leftPos  = axle.dual ? axle.positions.slice(0,2) : [axle.positions[0]];
    const rightPos = axle.dual ? axle.positions.slice(2,4) : [axle.positions[1]];

    const slot = (pos) => {
      const t = App.data.tires.find(x=>x.vehicle===vehicleCode && x.pos===pos);
      if (t) {
        const c = t.status==='danger'?'var(--danger)':t.status==='warn'?'var(--warn)':'var(--ok)';
        const bg= t.status==='danger'?'var(--danger-bg)':t.status==='warn'?'var(--warn-bg)':'var(--ok-bg)';
        const bc= t.status==='danger'?'rgba(239,68,68,.5)':t.status==='warn'?'rgba(245,158,11,.5)':'rgba(34,197,94,.4)';
        return `<div class="tire-dnd-slot occupied"
          data-pos="${pos}" data-serial="${t.serial}" data-vehicle="${vehicleCode}"
          draggable="true"
          ondragstart="onTireDragStart(event,'${t.serial}','${pos}')"
          ondragover="onTireDragOver(event)"
          ondragleave="onTireDragLeave(event)"
          ondrop="onTireDrop(event,'${pos}','${vehicleCode}')"
          onclick="openTireDetail('${t.serial}')"
          style="background:${bg};border-color:${bc};cursor:grab"
          title="${t.serial} · ${t.brand} · Clic: detalle · Arrastrar: cambiar posición">
          <span style="font-size:13px;font-weight:700;font-family:var(--mono);color:${c}">${t.depth}mm</span>
          <span style="font-size:8px;font-family:var(--mono);color:${c};text-align:center;line-height:1.3;word-break:break-all">${t.serial}</span>
          <span style="font-size:9px;font-family:var(--mono);background:rgba(0,0,0,.2);padding:1px 4px;border-radius:3px;color:${c}">${pos}</span>
        </div>`;
      } else {
        return `<div class="tire-dnd-slot empty"
          data-pos="${pos}" data-vehicle="${vehicleCode}"
          ondragover="onTireDragOver(event)"
          ondragleave="onTireDragLeave(event)"
          ondrop="onTireDrop(event,'${pos}','${vehicleCode}')"
          onclick="openMountFromStockModal('',\'${vehicleCode}\',\'${pos}\')"
          title="Posición vacía — clic o soltá una cubierta aquí">
          <span style="font-size:20px;color:var(--text3);line-height:1">+</span>
          <span style="font-size:9px;font-family:var(--mono);color:var(--text3)">${pos}</span>
          <span style="font-size:9px;color:var(--text3)">vacío</span>
        </div>`;
      }
    };

    return `<div style="background:var(--bg3);border-radius:var(--radius);padding:12px 14px;border:1px solid var(--border);margin-bottom:8px">
      <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">${axle.name}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:10px">
        <div style="display:flex;gap:6px">${leftPos.map(slot).join('')}</div>
        <div style="width:44px;height:3px;background:var(--border2);border-radius:2px;flex-shrink:0"></div>
        <div style="display:flex;gap:6px">${rightPos.map(slot).join('')}</div>
      </div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────
// DRAG & DROP
function onTireDragStart(event, serial, pos) {
  _dragSerial  = serial;
  _dragFromPos = pos;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', serial);
  // pequeño delay para que el estilo se aplique después del snapshot del drag
  setTimeout(() => {
    const el = document.querySelector(`[data-serial="${serial}"]`);
    if (el) el.style.opacity = '0.35';
  }, 0);
}

function onTireDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('drag-over');
}

function onTireDragLeave(event) {
  event.currentTarget.classList.remove('drag-over');
}

function onTireDrop(event, toPos, vehicleCode) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  // restaurar opacidad
  document.querySelectorAll('.tire-slot').forEach(el => el.style.opacity = '');

  if (!_dragSerial) return;
  if (_dragFromPos === toPos) { _dragSerial = null; _dragFromPos = null; return; }

  const draggedTire = App.data.tires.find(t=>t.serial===_dragSerial);
  if (!draggedTire) return;

  const targetTire  = App.data.tires.find(t=>t.vehicle===vehicleCode && t.pos===toPos);
  const vehicle     = App.data.vehicles.find(v=>v.code===vehicleCode);
  const km          = vehicle?.km || 0;
  const now         = new Date().toISOString().split('T')[0];
  const user        = App.currentUser?.name || 'Sistema';

  if (targetTire) {
    // Permuta: intercambio de posiciones
    const fromPos       = draggedTire.pos;
    draggedTire.pos     = toPos;
    targetTire.pos      = fromPos;
    draggedTire.vehicle = vehicleCode;
    App.data.tireHistory.unshift({ date:now, serial:draggedTire.serial, fromPos, toPos,         vehicle:vehicleCode, km, type:'Rotación (permuta)', user, obs:`Permuta con ${targetTire.serial}` });
    App.data.tireHistory.unshift({ date:now, serial:targetTire.serial,  fromPos:toPos, toPos:fromPos, vehicle:vehicleCode, km, type:'Rotación (permuta)', user, obs:`Permuta con ${draggedTire.serial}` });
    showToast('ok', `Permuta: ${draggedTire.serial} ↔ ${targetTire.serial}`);
  } else {
    // Mover a posición vacía
    const fromPos       = draggedTire.pos;
    const oldVehicle    = draggedTire.vehicle;
    draggedTire.pos     = toPos;
    draggedTire.vehicle = vehicleCode;
    App.data.tireHistory.unshift({ date:now, serial:draggedTire.serial, fromPos, toPos, vehicle:vehicleCode, km, type:'Rotación', user, obs:`Movimiento vía drag & drop${oldVehicle!==vehicleCode?' desde unidad '+oldVehicle:''}` });
    showToast('ok', `${draggedTire.serial}: ${fromPos} → ${toPos}`);
  }

  _dragSerial = null; _dragFromPos = null;
  refreshTireMap();
  renderTireHistory();
}

// ─────────────────────────────────────────
function renderTireTableBody(vehicleCode) {
  const tbody = document.getElementById('tire-table-body');
  if (!tbody) return;
  const code  = vehicleCode || getSelectedVehicle();
  const tires = App.data.tires.filter(t=>t.vehicle===code);
  if (!tires.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:16px">Sin cubiertas montadas en esta unidad. Usá "+ Montar cubierta" para agregar.</td></tr>`;
    return;
  }
  tbody.innerHTML = tires.map(t=>`<tr>
    <td class="td-mono td-main" style="cursor:pointer;text-decoration:underline" onclick="openTireDetail('${t.serial}')">${t.serial}</td>
    <td class="td-mono">${t.pos}</td>
    <td style="font-size:12px">${t.brand.split(' ')[0]} ${t.brand.split(' ')[1]||''}</td>
    <td class="td-mono">${t.km.toLocaleString()}</td>
    <td class="td-mono" style="color:var(--${t.status==='danger'?'danger':t.status==='warn'?'warn':'ok'})">${t.depth}/${t.maxDepth}mm</td>
    <td><span class="badge ${t.status==='ok'?'badge-ok':t.status==='warn'?'badge-warn':'badge-danger'}">${t.status==='ok'?'OK':t.status==='warn'?'Revisar':'Crítica'}</span></td>
    <td><button class="btn btn-secondary btn-sm" onclick="openTireDetail('${t.serial}')">Ver</button></td>
  </tr>`).join('');
}

// ─────────────────────────────────────────
function renderTireHistory() {
  const filterVal = document.getElementById('hist-filter')?.value || '';
  const hist = filterVal
    ? App.data.tireHistory.filter(h=>h.serial===filterVal)
    : App.data.tireHistory;
  const el = document.getElementById('tire-history-table');
  if (!el) return;
  if (!hist.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:12px 0;text-align:center">Sin movimientos registrados.</div>';
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Fecha</th><th>Cubierta</th><th>Desde</th><th>Hacia</th><th>Tipo</th><th>Unidad</th><th>Km</th><th>Operario</th><th>Observación</th></tr></thead>
    <tbody>${hist.map(h=>`<tr>
      <td class="td-mono" style="font-size:11px">${h.date}</td>
      <td class="td-mono td-main" style="cursor:pointer;text-decoration:underline" onclick="openTireDetail('${h.serial}')">${h.serial}</td>
      <td class="td-mono" style="color:var(--text3)">${h.fromPos}</td>
      <td class="td-mono" style="color:var(--accent)">→ ${h.toPos}</td>
      <td><span class="badge ${h.type.includes('Rotación')?'badge-info':h.type==='Montaje'?'badge-ok':h.type.includes('Baja')?'badge-danger':'badge-gray'}">${h.type}</span></td>
      <td class="td-mono">${h.vehicle}</td>
      <td class="td-mono">${h.km.toLocaleString()}</td>
      <td style="font-size:12px">${h.user}</td>
      <td style="font-size:11px;color:var(--text3);max-width:160px">${h.obs}</td>
    </tr>`).join('')}
    </tbody></table></div>`;
}

// ─────────────────────────────────────────
// MONTAR desde stock (posición vacía o botón)
function openMountFromStockModal(serial='', vehicleCode='', pos='') {
  const code    = vehicleCode || getSelectedVehicle();
  const vehicle = App.data.vehicles.find(v=>v.code===code);
  const config  = AXLE_CONFIGS[vehicle?.type] || AXLE_CONFIGS['tractor'];
  const allPos  = config.flatMap(a=>a.positions);
  const occupied= App.data.tires.filter(t=>t.vehicle===code).map(t=>t.pos);
  const freePos = allPos.filter(p=>!occupied.includes(p));
  const stock   = App.data.tires.filter(t=>t.vehicle==='STOCK');

  openModal(`Montar cubierta en ${code}`, `
    <div style="font-size:12px;color:var(--text3);margin-bottom:14px">
      Seleccioná qué cubierta del stock montás y en qué posición.
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Cubierta a montar</label>
        <select class="form-select" id="ms-serial">
          ${stock.length
            ? stock.map(t=>`<option value="${t.serial}" ${t.serial===serial?'selected':''}>${t.serial} · ${t.brand} · ${t.km===0?'Nueva':'Usada '+t.km.toLocaleString()+'km'} · ${t.depth}mm dibujo</option>`).join('')
            : '<option value="">— Sin cubiertas en stock —</option>'
          }
        </select>
        ${!stock.length?`<div style="font-size:11px;color:var(--warn);margin-top:4px">No hay cubiertas en stock. Agregá una primero con "+ Agregar al stock".</div>`:''}
      </div>
      <div class="form-group">
        <label class="form-label">Posición de montaje</label>
        <select class="form-select" id="ms-pos">
          ${freePos.length
            ? freePos.map(p=>`<option value="${p}" ${p===pos?'selected':''}>${p} — libre</option>`).join('')
            : '<option value="">— Sin posiciones libres —</option>'
          }
          ${allPos.filter(p=>occupied.includes(p)).map(p=>`<option value="${p}" style="color:var(--warn)">${p} — OCUPADA (reemplazará)</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Km del vehículo al montar</label>
        <input class="form-input" type="number" id="ms-km" value="${vehicle?.km||0}">
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de montaje</label>
        <input class="form-input" type="date" id="ms-date" value="${new Date().toISOString().split('T')[0]}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Observaciones</label>
      <input class="form-input" id="ms-obs" placeholder="Motivo del montaje, estado de la cubierta...">
    </div>
  `, [
    { label:'Confirmar montaje', cls:'btn-primary',   fn: () => saveMountTire(code) },
    { label:'Cancelar',          cls:'btn-secondary', fn: closeModal },
  ]);
}

// Alias para el botón "+ Montar cubierta"
function openMountTireModal() { openMountFromStockModal('', getSelectedVehicle(), ''); }

function saveMountTire(vehicleCode) {
  const serial = document.getElementById('ms-serial').value;
  const pos    = document.getElementById('ms-pos').value;
  const km     = parseInt(document.getElementById('ms-km').value) || 0;
  const date   = document.getElementById('ms-date').value;
  const obs    = document.getElementById('ms-obs').value || 'Montaje desde stock';
  const user   = App.currentUser?.name || 'Sistema';

  if (!serial) { showToast('warn','Seleccioná una cubierta del stock'); return; }
  if (!pos)    { showToast('warn','Seleccioná la posición de montaje');  return; }

  const tire = App.data.tires.find(t=>t.serial===serial);
  if (!tire)   { showToast('warn','Cubierta no encontrada');             return; }

  // Si hay cubierta ocupando esa posición, desmontar primero
  const existing = App.data.tires.find(t=>t.vehicle===vehicleCode && t.pos===pos);
  if (existing) {
    existing.vehicle = 'STOCK';
    existing.pos     = 'Stock';
    App.data.tireHistory.unshift({ date, serial:existing.serial, fromPos:pos, toPos:'Stock', vehicle:vehicleCode, km, type:'Desmontaje', user, obs:'Desmontada para dar lugar a '+serial });
    showToast('warn', `${existing.serial} desmontada y enviada al stock`);
  }

  tire.vehicle = vehicleCode;
  tire.pos     = pos;
  App.data.tireHistory.unshift({ date, serial, fromPos:'Stock', toPos:pos, vehicle:vehicleCode, km, type:'Montaje', user, obs });

  closeModal();
  refreshTireMap();
  renderTireHistory();
  showToast('ok', `${serial} montada en ${vehicleCode} posición ${pos}`);
}

// ─────────────────────────────────────────
// AGREGAR cubierta nueva al stock
function openNewTireToStockModal() {
  openModal('Agregar cubierta al stock', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Número de serie</label>
        <input class="form-input" id="ns-serial" placeholder="Ej: BT-1234">
      </div>
      <div class="form-group">
        <label class="form-label">Tipo</label>
        <select class="form-select" id="ns-tipo">
          <option value="nueva">Nueva</option>
          <option value="usada">Usada</option>
          <option value="recapada">Recapada</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Marca / Modelo</label>
        <input class="form-input" id="ns-brand" placeholder="Ej: Bridgestone R168">
      </div>
      <div class="form-group">
        <label class="form-label">Medida</label>
        <input class="form-input" id="ns-size" placeholder="295/80R22.5" value="295/80R22.5">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Profundidad de dibujo (mm)</label>
        <input class="form-input" type="number" id="ns-depth" placeholder="16">
      </div>
      <div class="form-group">
        <label class="form-label">Km acumulados previos</label>
        <input class="form-input" type="number" id="ns-km" placeholder="0" value="0">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Precio de compra ($)</label>
        <input class="form-input" type="number" id="ns-price" placeholder="180000">
      </div>
      <div class="form-group">
        <label class="form-label">Proveedor</label>
        <input class="form-input" id="ns-supplier" placeholder="Nombre del proveedor">
      </div>
    </div>
  `, [
    { label:'Agregar al stock', cls:'btn-primary',   fn: saveNewTireToStock },
    { label:'Cancelar',         cls:'btn-secondary', fn: closeModal },
  ]);
}

function saveNewTireToStock() {
  const serial = document.getElementById('ns-serial').value.trim();
  const brand  = document.getElementById('ns-brand').value.trim();
  const depth  = parseInt(document.getElementById('ns-depth').value) || 16;
  const km     = parseInt(document.getElementById('ns-km').value)    || 0;
  const price  = parseInt(document.getElementById('ns-price').value) || 180000;

  if (!serial) { showToast('warn','El número de serie es obligatorio'); return; }
  if (!brand)  { showToast('warn','La marca es obligatoria');           return; }
  if (App.data.tires.find(t=>t.serial===serial)) { showToast('warn','Ya existe una cubierta con ese número de serie'); return; }

  const maxD = depth;
  App.data.tires.push({
    serial, pos:'Stock', vehicle:'STOCK',
    brand,
    size:  document.getElementById('ns-size').value  || '295/80R22.5',
    km, depth, maxDepth:maxD,
    status:'ok', purchase:price,
  });

  App.data.tireHistory.unshift({
    date:    new Date().toISOString().split('T')[0],
    serial,  fromPos:'Proveedor', toPos:'Stock',
    vehicle: 'STOCK', km: 0, type:'Ingreso stock',
    user:    App.currentUser?.name || 'Sistema',
    obs:     `Alta de cubierta ${document.getElementById('ns-tipo').value} — ${document.getElementById('ns-supplier').value||'sin proveedor'}`,
  });

  closeModal();
  renderTires(); // refrescar página completa para actualizar stock
  showToast('ok', `Cubierta ${serial} agregada al stock`);
}

// ─────────────────────────────────────────
// DETALLE completo de cubierta con historial
function openTireDetail(serial) {
  const t = App.data.tires.find(x=>x.serial===serial);
  if (!t) return;
  const hist     = App.data.tireHistory.filter(h=>h.serial===serial);
  const depthPct = Math.round((t.depth / t.maxDepth) * 100);
  const cpkm     = t.km > 0 ? (t.purchase / t.km).toFixed(2) : '—';

  openModal('Cubierta — ' + serial, `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
      <div style="background:var(--bg3);border-radius:var(--radius);padding:12px;border:1px solid var(--border);text-align:center">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">Dibujo</div>
        <div style="font-size:26px;font-weight:700;font-family:var(--mono);color:var(--${t.status==='danger'?'danger':t.status==='warn'?'warn':'ok'})">${t.depth}mm</div>
        <div style="font-size:10px;color:var(--text3)">prof. actual</div>
        <div style="height:4px;background:var(--bg4);border-radius:2px;margin-top:5px;overflow:hidden">
          <div style="height:4px;width:${depthPct}%;background:var(--${t.status==='danger'?'danger':t.status==='warn'?'warn':'ok'});border-radius:2px"></div>
        </div>
      </div>
      <div style="background:var(--bg3);border-radius:var(--radius);padding:12px;border:1px solid var(--border);text-align:center">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">Km acumulados</div>
        <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--text)">${t.km.toLocaleString()}</div>
        <div style="font-size:10px;color:var(--text3)">km totales</div>
      </div>
      <div style="background:var(--bg3);border-radius:var(--radius);padding:12px;border:1px solid var(--border);text-align:center">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">Costo/km</div>
        <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--text)">$${cpkm}</div>
        <div style="font-size:10px;color:var(--text3)">costo acumulado</div>
      </div>
    </div>

    <table style="width:100%;font-size:13px;margin-bottom:16px">
      <tr><td style="color:var(--text3);padding:5px 0;width:38%">Marca / Modelo</td><td style="font-weight:500">${t.brand}</td></tr>
      <tr><td style="color:var(--text3);padding:5px 0">Medida</td><td class="td-mono">${t.size}</td></tr>
      <tr><td style="color:var(--text3);padding:5px 0">Posición actual</td><td class="td-mono" style="color:var(--accent)">${t.pos} · ${t.vehicle}</td></tr>
      <tr><td style="color:var(--text3);padding:5px 0">Estado</td><td><span class="badge ${t.status==='ok'?'badge-ok':t.status==='warn'?'badge-warn':'badge-danger'}">${t.status==='ok'?'OK':t.status==='warn'?'Revisar':'Crítica'}</span></td></tr>
      <tr><td style="color:var(--text3);padding:5px 0">Precio compra</td><td class="td-mono">$${t.purchase.toLocaleString()}</td></tr>
    </table>

    <div style="font-size:11px;font-weight:500;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
      Historial de posiciones — ${hist.length} movimiento${hist.length!==1?'s':''}
    </div>
    <div style="max-height:180px;overflow-y:auto;margin-bottom:16px">
      ${hist.length
        ? `<table style="width:100%;font-size:12px">
            <thead style="position:sticky;top:0;background:var(--bg2)">
              <tr><th style="padding:5px 8px;color:var(--text3);text-align:left">Fecha</th><th style="padding:5px 8px;color:var(--text3);text-align:left">Desde</th><th style="padding:5px 8px;color:var(--text3);text-align:left">Hacia</th><th style="padding:5px 8px;color:var(--text3);text-align:left">Tipo</th><th style="padding:5px 8px;color:var(--text3);text-align:left">Km</th><th style="padding:5px 8px;color:var(--text3);text-align:left">Obs.</th></tr>
            </thead>
            <tbody>${hist.map(h=>`<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:6px 8px;font-family:var(--mono);color:var(--text3)">${h.date}</td>
              <td style="padding:6px 8px;font-family:var(--mono);color:var(--text3)">${h.fromPos}</td>
              <td style="padding:6px 8px;font-family:var(--mono);color:var(--accent)">→ ${h.toPos}</td>
              <td style="padding:6px 8px"><span class="badge ${h.type.includes('Rotación')?'badge-info':h.type==='Montaje'?'badge-ok':'badge-gray'}">${h.type}</span></td>
              <td style="padding:6px 8px;font-family:var(--mono)">${h.km.toLocaleString()}</td>
              <td style="padding:6px 8px;color:var(--text3);font-size:11px">${h.obs}</td>
            </tr>`).join('')}</tbody>
          </table>`
        : '<div style="color:var(--text3);font-size:13px;padding:8px 0">Sin movimientos previos registrados.</div>'
      }
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div class="form-group" style="margin:0">
        <label class="form-label">Actualizar profundidad (mm)</label>
        <input class="form-input" type="number" id="td-depth" value="${t.depth}" min="0" max="${t.maxDepth}">
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">Acción</label>
        <select class="form-select" id="td-action">
          <option value="depth">Solo actualizar medición</option>
          <option value="stock">Desmontar → stock</option>
          <option value="recap">Enviar a recapado</option>
          <option value="baja">Baja definitiva</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Observaciones</label>
      <input class="form-input" id="td-obs" placeholder="Detalle de la acción...">
    </div>
  `, [
    { label:'Guardar', cls:'btn-primary',   fn: () => saveTireAction(serial) },
    { label:'Cerrar',  cls:'btn-secondary', fn: closeModal },
  ]);
}

function saveTireAction(serial) {
  const t      = App.data.tires.find(x=>x.serial===serial);
  if (!t) return;
  const action = document.getElementById('td-action').value;
  const depth  = parseInt(document.getElementById('td-depth').value);
  const obs    = document.getElementById('td-obs').value || 'Sin observaciones';
  const now    = new Date().toISOString().split('T')[0];
  const vehicle= App.data.vehicles.find(v=>v.code===t.vehicle);
  const km     = vehicle?.km || 0;
  const user   = App.currentUser?.name || 'Sistema';

  if (!isNaN(depth)) {
    t.depth  = depth;
    t.status = depth <= 4 ? 'danger' : depth <= 6 ? 'warn' : 'ok';
  }

  if (action === 'stock') {
    App.data.tireHistory.unshift({ date:now, serial, fromPos:t.pos, toPos:'Stock', vehicle:t.vehicle, km, type:'Desmontaje', user, obs });
    t.pos = 'Stock'; t.vehicle = 'STOCK';
    showToast('ok', `${serial} desmontada y enviada al stock`);
  } else if (action === 'recap') {
    App.data.tireHistory.unshift({ date:now, serial, fromPos:t.pos, toPos:'Recapado', vehicle:t.vehicle, km, type:'Envío recapado', user, obs });
    t.pos = 'Recapado'; t.vehicle = 'RECAP';
    showToast('ok', `${serial} enviada a recapado`);
  } else if (action === 'baja') {
    App.data.tireHistory.unshift({ date:now, serial, fromPos:t.pos, toPos:'Baja', vehicle:t.vehicle, km, type:'Baja definitiva', user, obs });
    t.pos = 'Baja'; t.vehicle = 'BAJA'; t.status = 'danger';
    showToast('warn', `${serial} dada de baja definitiva`);
  } else {
    App.data.tireHistory.unshift({ date:now, serial, fromPos:t.pos, toPos:t.pos, vehicle:t.vehicle, km, type:'Medición desgaste', user, obs:`Profundidad actualizada a ${depth}mm` });
    showToast('ok', `Medición actualizada: ${depth}mm`);
  }
  closeModal();
  refreshTireMap();
  renderTireHistory();
}

// ─────────────────────────────────────────
// MOVIMIENTO MANUAL
function openManualMoveModal() {
  const code    = getSelectedVehicle();
  const vTires  = App.data.tires.filter(t=>t.vehicle===code);
  openModal('Registrar movimiento manual', `
    <div style="font-size:12px;color:var(--text3);margin-bottom:14px">
      Para registrar rotaciones o movimientos realizados físicamente sin usar el drag & drop.
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Cubierta</label>
        <select class="form-select" id="mm-serial">
          ${[...App.data.tires.filter(t=>t.vehicle===code), ...App.data.tires.filter(t=>t.vehicle==='STOCK')]
            .map(t=>`<option value="${t.serial}">${t.serial} — ${t.pos} — ${t.brand.split(' ')[0]}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Tipo de movimiento</label>
        <select class="form-select" id="mm-type">
          <option>Rotación</option><option>Rotación (permuta)</option>
          <option>Reubicación</option><option>Montaje</option><option>Desmontaje</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Posición origen</label>
        <input class="form-input" id="mm-from" placeholder="Ej: 2-TIE o Stock">
      </div>
      <div class="form-group">
        <label class="form-label">Posición destino</label>
        <input class="form-input" id="mm-to" placeholder="Ej: 2-TDE o Stock">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Km al momento</label>
        <input class="form-input" type="number" id="mm-km" value="${App.data.vehicles.find(v=>v.code===code)?.km||0}">
      </div>
      <div class="form-group">
        <label class="form-label">Fecha</label>
        <input class="form-input" type="date" id="mm-date" value="${new Date().toISOString().split('T')[0]}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Observaciones</label>
      <textarea class="form-textarea" id="mm-obs" placeholder="Motivo, condición de la cubierta..."></textarea>
    </div>
  `, [
    { label:'Registrar', cls:'btn-primary',   fn: () => saveManualMove(code) },
    { label:'Cancelar',  cls:'btn-secondary', fn: closeModal },
  ]);
}

function saveManualMove(vehicleCode) {
  const serial  = document.getElementById('mm-serial').value;
  const type    = document.getElementById('mm-type').value;
  const fromPos = document.getElementById('mm-from').value.trim();
  const toPos   = document.getElementById('mm-to').value.trim();
  const km      = parseInt(document.getElementById('mm-km').value) || 0;
  const date    = document.getElementById('mm-date').value;
  const obs     = document.getElementById('mm-obs').value || '—';
  const user    = App.currentUser?.name || 'Sistema';

  if (!fromPos || !toPos) { showToast('warn','Completá las posiciones de origen y destino'); return; }

  const t = App.data.tires.find(x=>x.serial===serial);
  if (t) { t.pos = toPos; if (toPos==='Stock') t.vehicle='STOCK'; else t.vehicle=vehicleCode; }

  App.data.tireHistory.unshift({ date, serial, fromPos, toPos, vehicle:vehicleCode, km, type, user, obs });
  closeModal();
  refreshTireMap();
  renderTireHistory();
  showToast('ok', `Movimiento registrado: ${serial} ${fromPos} → ${toPos}`);
}

// ── STOCK ──
function renderStock() {
  const critical = App.data.stock.filter(s=>s.qty<=s.min).length;
  const totalVal = App.data.stock.reduce((a,b)=>a+b.qty*b.cost,0);
  const isDueno  = userHasRole('dueno','gerencia');

  // Construir filas de la tabla sin template literals anidados
  let tableRows = '';
  if (App.data.stock.length === 0) {
    tableRows = '<tr><td colspan="11" style="text-align:center;padding:32px;color:var(--text3)">Sin ítems en stock. Usá el botón <strong>+ Registrar ítem</strong> para agregar.</td></tr>';
  }
  App.data.stock.forEach(function(s) {
    const pct   = s.qty / s.min;
    const st    = pct<=1 ? 'danger' : pct<=1.5 ? 'warn' : 'ok';
    const stLbl = st==='ok' ? 'Normal' : st==='warn' ? 'Bajo' : 'Crítico';
    const bajaBtn = isDueno
      ? '<button class="btn btn-danger btn-sm" onclick="openStockBajaItemModal('+s.id+')" title="Solo dueño/gerencia">✕ Baja</button>'
      : '<span style="font-size:11px;color:var(--text3);padding:0 4px" title="Solo dueño puede dar de baja">🔒</span>';
    tableRows += '<tr>'
      + '<td class="td-mono td-main">'+s.code+'</td>'
      + '<td>'+s.name+'</td>'
      + '<td><span class="tag" style="background:var(--bg4);color:var(--text2)">'+s.cat+'</span></td>'
      + '<td class="td-mono" style="color:var(--'+st+')">'+s.qty+' '+s.unit+'</td>'
      + '<td class="td-mono">'+s.min+' '+s.unit+'</td>'
      + '<td class="td-mono">'+s.reorder+' '+s.unit+'</td>'
      + '<td class="td-mono">$'+s.cost.toLocaleString()+'</td>'
      + '<td class="td-mono">$'+(s.qty*s.cost).toLocaleString()+'</td>'
      + '<td style="font-size:12px">'+s.supplier+'</td>'
      + '<td><span class="badge badge-'+st+'">'+stLbl+'</span></td>'
      + '<td style="white-space:nowrap;display:flex;gap:4px;padding:8px 6px">'
      +   '<button class="btn btn-secondary btn-sm" onclick="openStockEgresoModal('+s.id+')">Egreso</button>'
      +   bajaBtn
      + '</td>'
      + '</tr>';
  });

  // Construir filas del historial
  let histRows = '';
  (App.data.stockHistory || []).slice(0,15).forEach(function(h) {
    const tc   = h.type==='Baja'?'badge-danger':h.type==='Egreso'?'badge-warn':h.type==='Ajuste'?'badge-purple':'badge-ok';
    const sign = (h.type==='Baja'||h.type==='Egreso') ? '-' : '+';
    const cc   = (h.type==='Baja'||h.type==='Egreso') ? 'danger' : 'ok';
    histRows += '<tr>'
      + '<td class="td-mono" style="font-size:11px">'+h.date+'</td>'
      + '<td style="color:var(--text)">'+h.name+'</td>'
      + '<td><span class="badge '+tc+'">'+h.type+'</span></td>'
      + '<td class="td-mono" style="color:var(--'+cc+')">'+sign+h.qty+' '+h.unit+'</td>'
      + '<td style="font-size:12px;color:var(--text3)">'+h.motivo+'</td>'
      + '<td style="font-size:12px">'+h.user+'</td>'
      + '</tr>';
  });

  const histSection = histRows
    ? '<div class="card" style="margin-top:16px">'
      + '<div class="card-title">Últimos movimientos del pañol</div>'
      + '<div class="table-wrap"><table>'
      + '<thead><tr><th>Fecha</th><th>Ítem</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th>Usuario</th></tr></thead>'
      + '<tbody>'+histRows+'</tbody>'
      + '</table></div></div>'
    : '';

  const bajaBtnHeader = isDueno
    ? '<button class="btn btn-danger btn-sm" onclick="openStockBajaModal()">✕ Dar de baja</button>'
    : '';

  document.getElementById('page-stock').innerHTML =
    '<div class="kpi-row kpi-row-3" style="margin-bottom:20px">'
    + '<div class="kpi-card '+(critical===0?'ok':'danger')+'">'
    +   '<div class="kpi-label">Ítems en stock crítico</div>'
    +   '<div class="kpi-value '+(critical===0?'ok':'danger')+'">'+critical+'</div>'
    +   '<div class="kpi-trend">debajo del mínimo</div>'
    + '</div>'
    + '<div class="kpi-card info">'
    +   '<div class="kpi-label">Total ítems</div>'
    +   '<div class="kpi-value white">'+App.data.stock.length+'</div>'
    +   '<div class="kpi-trend">en el pañol</div>'
    + '</div>'
    + '<div class="kpi-card ok">'
    +   '<div class="kpi-label">Valor stock total</div>'
    +   '<div class="kpi-value ok">$'+Math.round(totalVal/1000)+'K</div>'
    +   '<div class="kpi-trend">valorización al costo actual</div>'
    + '</div>'
    + '</div>'
    + '<div class="section-header">'
    +   '<div><div class="section-title">Inventario de repuestos e insumos</div></div>'
    +   '<div style="display:flex;gap:8px">'
    +   bajaBtnHeader
    +   '<button class="btn btn-secondary btn-sm" onclick="openStockAjusteModal()">± Ajuste inventario</button>'
    +   '<button class="btn btn-primary btn-sm" onclick="openNewStockModal()">+ Registrar ítem</button>'
    +   '</div>'
    + '</div>'
    + '<div class="card" style="padding:0">'
    +   '<div class="table-wrap">'
    +   '<table><thead><tr>'
    +   '<th>Código</th><th>Descripción</th><th>Cat.</th>'
    +   '<th>Stock</th><th>Mínimo</th><th>P. pedido</th>'
    +   '<th>Costo unit.</th><th>Valorización</th><th>Proveedor</th>'
    +   '<th>Estado</th><th></th>'
    +   '</tr></thead>'
    +   '<tbody>'+tableRows+'</tbody>'
    +   '</table></div>'
    + '</div>'
    + histSection;
}

// ── EGRESO de stock (pañolero, jefe mantenimiento, encargado)
function openStockEgresoModal(stockId) {
  const s = App.data.stock.find(function(x){ return x.id===stockId; });
  if (!s) return;
  openModal('Registrar egreso — '+s.name, ''
    + '<div style="background:var(--bg3);border-radius:var(--radius);padding:10px 14px;margin-bottom:14px">'
    + '<div style="font-size:13px;font-weight:500;color:var(--text)">'+s.name+'</div>'
    + '<div style="font-size:12px;color:var(--text3);margin-top:2px">'
    + 'Stock actual: <span style="font-family:var(--mono);color:var(--text)">'+s.qty+' '+s.unit+'</span>'
    + ' &nbsp;·&nbsp; '
    + 'Costo unit.: <span style="font-family:var(--mono);color:var(--text)">$'+s.cost.toLocaleString()+'</span>'
    + '</div></div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Cantidad a egresar</label>'
    + '<input class="form-input" type="number" id="eg-qty" value="1" min="1" max="'+s.qty+'"></div>'
    + '<div class="form-group"><label class="form-label">Destino / uso</label>'
    + '<select class="form-select" id="eg-dest">'
    + '<option value="ot">Orden de trabajo</option>'
    + '<option value="taller">Consumo taller</option>'
    + '<option value="otro">Otro uso</option>'
    + '</select></div>'
    + '</div>'
    + '<div class="form-group"><label class="form-label">Referencia (OT, observación)</label>'
    + '<input class="form-input" id="eg-ref" placeholder="Ej: OT-0284 o descripción del uso"></div>',
  [
    { label:'Confirmar egreso', cls:'btn-primary',   fn: function(){ saveStockEgreso(stockId); } },
    { label:'Cancelar',         cls:'btn-secondary', fn: closeModal },
  ]);
}

function saveStockEgreso(stockId) {
  const s   = App.data.stock.find(function(x){ return x.id===stockId; });
  if (!s) return;
  const qty = parseInt(document.getElementById('eg-qty').value) || 1;
  const ref = document.getElementById('eg-ref').value || '—';
  if (qty > s.qty) { showToast('warn','Stock insuficiente. Disponible: '+s.qty+' '+s.unit); return; }
  s.qty -= qty;
  (App.data.stockHistory || (App.data.stockHistory = [])).unshift({
    date:   new Date().toISOString().split('T')[0],
    name:   s.name, unit: s.unit, qty, type: 'Egreso',
    motivo: ref,
    user:   (App.currentUser && App.currentUser.name) || 'Sistema',
  });
  closeModal();
  renderStock();
  showToast('ok', 'Egreso registrado: '+qty+' '+s.unit+' de '+s.name);
}

// ── BAJA de stock — SOLO DUEÑO / GERENCIA ──
function openStockBajaModal() {
  if (!userHasRole('dueno','gerencia')) {
    showToast('warn','Solo el dueño o gerencia puede dar de baja ítems del pañol');
    return;
  }
  const opts = App.data.stock.map(function(s){
    return '<option value="'+s.id+'">'+s.name+' — Stock: '+s.qty+' '+s.unit+'</option>';
  }).join('');
  openModal('Dar de baja ítem del pañol', ''
    + '<div style="background:var(--warn-bg);border:1px solid rgba(245,158,11,.3);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--warn);margin-bottom:14px">'
    + '<strong>Acción auditada — solo Dueño / Gerencia.</strong> Registra una baja definitiva del inventario '
    + 'por robo, pérdida, daño o vencimiento. Queda registrado con usuario, fecha y motivo detallado.'
    + '</div>'
    + '<div class="form-group"><label class="form-label">Ítem a dar de baja</label>'
    + '<select class="form-select" id="bj-id" onchange="onBajaItemSelect()">'
    + '<option value="">— Seleccioná un ítem —</option>'+opts
    + '</select></div>'
    + '<div id="baja-detail" style="display:none">'
    +   '<div class="form-row">'
    +     '<div class="form-group"><label class="form-label">Cantidad a dar de baja</label>'
    +     '<input class="form-input" type="number" id="bj-qty" value="1" min="1" oninput="updateBajaSummary()"></div>'
    +     '<div class="form-group"><label class="form-label">Motivo de la baja</label>'
    +     '<select class="form-select" id="bj-motivo">'
    +       '<option value="robo">Robo</option>'
    +       '<option value="perdida">Pérdida / extravío</option>'
    +       '<option value="danio">Daño / inutilizable</option>'
    +       '<option value="vencimiento">Vencimiento</option>'
    +       '<option value="diferencia">Diferencia de inventario</option>'
    +       '<option value="otro">Otro</option>'
    +     '</select></div>'
    +   '</div>'
    +   '<div class="form-group"><label class="form-label">Detalle completo (obligatorio)</label>'
    +   '<textarea class="form-textarea" id="bj-obs" '
    +   'placeholder="Describí qué pasó, cuándo, dónde y cómo se detectó la diferencia..."></textarea></div>'
    +   '<div id="bj-summary" style="background:var(--bg3);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--text3)">'
    +   'Impacto en valorización: —</div>'
    + '</div>',
  [
    { label:'Confirmar baja', cls:'btn-danger',    fn: saveStockBaja },
    { label:'Cancelar',       cls:'btn-secondary', fn: closeModal },
  ]);
}

function openStockBajaItemModal(stockId) {
  openStockBajaModal();
  setTimeout(function() {
    const sel = document.getElementById('bj-id');
    if (sel) { sel.value = stockId; onBajaItemSelect(); }
  }, 150);
}

function onBajaItemSelect() {
  const id  = parseInt((document.getElementById('bj-id')||{}).value);
  const det = document.getElementById('baja-detail');
  if (!det) return;
  if (id) {
    det.style.display = '';
    updateBajaSummary();
  } else {
    det.style.display = 'none';
  }
}

function updateBajaSummary() {
  const id  = parseInt((document.getElementById('bj-id')||{}).value);
  const qty = parseInt((document.getElementById('bj-qty')||{}).value) || 1;
  const sum = document.getElementById('bj-summary');
  const s   = App.data.stock.find(function(x){ return x.id===id; });
  if (!sum || !s) return;
  sum.innerHTML = 'Impacto: <strong style="color:var(--danger)">-'+qty+' '+s.unit+'</strong>'
    + ' &nbsp;·&nbsp; '
    + 'Pérdida valorizada: <strong style="color:var(--danger)">$'+(qty*s.cost).toLocaleString()+'</strong>';
}

function saveStockBaja() {
  if (!userHasRole('dueno','gerencia')) {
    showToast('warn','Sin permiso para realizar esta operación');
    return;
  }
  const id     = parseInt((document.getElementById('bj-id')||{}).value);
  const qty    = parseInt((document.getElementById('bj-qty')||{}).value) || 1;
  const motivo = (document.getElementById('bj-motivo')||{}).value || 'otro';
  const obs    = ((document.getElementById('bj-obs')||{}).value || '').trim();
  const s      = App.data.stock.find(function(x){ return x.id===id; });

  if (!id)         { showToast('warn','Seleccioná un ítem'); return; }
  if (!obs)        { showToast('warn','El detalle de la baja es obligatorio'); return; }
  if (!s)          { showToast('warn','Ítem no encontrado'); return; }
  if (qty > s.qty) { showToast('warn','Cantidad mayor al stock disponible ('+s.qty+')'); return; }

  s.qty -= qty;

  (App.data.stockHistory || (App.data.stockHistory = [])).unshift({
    date:   new Date().toISOString().split('T')[0],
    name:   s.name,
    unit:   s.unit,
    qty:    qty,
    type:   'Baja',
    motivo: '['+motivo.toUpperCase()+'] '+obs,
    user:   (App.currentUser && App.currentUser.name) || 'Dueño',
  });

  closeModal();
  renderStock();
  showToast('ok', 'Baja registrada: '+qty+' '+s.unit+' de '+s.name+' — Motivo: '+motivo);
}

// ── AJUSTE de inventario (pañolero / jefe)
function openStockAjusteModal() {
  const opts = App.data.stock.map(function(s){
    return '<option value="'+s.id+'">'+s.name+' — Sistema: '+s.qty+' '+s.unit+'</option>';
  }).join('');
  openModal('Ajuste de inventario', ''
    + '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">'
    + 'Para corregir diferencias entre el sistema y el recuento físico. '
    + 'Si la diferencia es por robo o pérdida, usá "Dar de baja" (requiere autorización del dueño).'
    + '</div>'
    + '<div class="form-row">'
    +   '<div class="form-group"><label class="form-label">Ítem</label>'
    +   '<select class="form-select" id="aj-id"><option value="">— Seleccioná —</option>'+opts+'</select></div>'
    +   '<div class="form-group"><label class="form-label">Cantidad real (recuento físico)</label>'
    +   '<input class="form-input" type="number" id="aj-qty" placeholder="Cantidad que hay realmente"></div>'
    + '</div>'
    + '<div class="form-group"><label class="form-label">Motivo del ajuste</label>'
    + '<input class="form-input" id="aj-obs" placeholder="Ej: Recuento físico mensual, diferencia detectada..."></div>',
  [
    { label:'Guardar ajuste', cls:'btn-primary',   fn: saveStockAjuste },
    { label:'Cancelar',       cls:'btn-secondary', fn: closeModal },
  ]);
}

function saveStockAjuste() {
  const id     = parseInt((document.getElementById('aj-id')||{}).value);
  const newQty = parseInt((document.getElementById('aj-qty')||{}).value);
  const obs    = (document.getElementById('aj-obs')||{}).value || 'Ajuste de inventario';
  const s      = App.data.stock.find(function(x){ return x.id===id; });
  if (!s || isNaN(newQty)) { showToast('warn','Completá todos los campos'); return; }
  const diff = newQty - s.qty;
  s.qty = newQty;
  (App.data.stockHistory || (App.data.stockHistory = [])).unshift({
    date:   new Date().toISOString().split('T')[0],
    name:   s.name, unit: s.unit,
    qty:    Math.abs(diff),
    type:   'Ajuste',
    motivo: (diff>=0?'+':'')+diff+' '+s.unit+' · '+obs,
    user:   (App.currentUser && App.currentUser.name) || 'Sistema',
  });
  closeModal();
  renderStock();
  showToast('ok', 'Inventario ajustado: '+s.name+' → '+newQty+' '+s.unit);
}

// ── NUEVO ítem de stock
function openNewStockModal() {
  openModal('Registrar nuevo ítem de stock', ''
    + '<div class="form-row">'
    +   '<div class="form-group"><label class="form-label">Código interno</label>'
    +   '<input class="form-input" placeholder="FLT-ACE-003" id="ns-code"></div>'
    +   '<div class="form-group"><label class="form-label">Categoría</label>'
    +   '<select class="form-select" id="ns-cat">'
    +   '<option>Filtros</option><option>Lubricantes</option><option>Mecánico</option>'
    +   '<option>Frenos</option><option>Eléctrico</option><option>Tornillería</option>'
    +   '</select></div>'
    + '</div>'
    + '<div class="form-group"><label class="form-label">Descripción completa</label>'
    + '<input class="form-input" placeholder="Nombre completo del repuesto o insumo" id="ns-name"></div>'
    + '<div class="form-row form-row-3">'
    +   '<div class="form-group"><label class="form-label">Stock inicial</label>'
    +   '<input class="form-input" type="number" placeholder="0" id="ns-qty"></div>'
    +   '<div class="form-group"><label class="form-label">Stock mínimo</label>'
    +   '<input class="form-input" type="number" placeholder="2" id="ns-min"></div>'
    +   '<div class="form-group"><label class="form-label">Unidad</label>'
    +   '<select class="form-select" id="ns-unit">'
    +   '<option>un</option><option>L</option><option>kg</option><option>jgo</option><option>m</option>'
    +   '</select></div>'
    + '</div>'
    + '<div class="form-row">'
    +   '<div class="form-group"><label class="form-label">Costo unitario ($)</label>'
    +   '<input class="form-input" type="number" placeholder="0" id="ns-cost"></div>'
    +   '<div class="form-group"><label class="form-label">Proveedor</label>'
    +   '<input class="form-input" placeholder="Nombre del proveedor" id="ns-supplier"></div>'
    + '</div>',
  [
    { label:'Guardar ítem', cls:'btn-primary',   fn: saveNewStockItem },
    { label:'Cancelar',     cls:'btn-secondary', fn: closeModal },
  ]);
}

async function saveNewStockItem() {
  const code     = (document.getElementById('si-code')?.value  || '').trim();
  const name     = (document.getElementById('si-name')?.value  || '').trim();
  const category = document.getElementById('si-cat')?.value    || 'general';
  const unit     = document.getElementById('si-unit')?.value   || 'un';
  const qty      = parseFloat(document.getElementById('si-qty')?.value)   || 0;
  const min_qty  = parseFloat(document.getElementById('si-min')?.value)   || 0;
  const cost     = parseFloat(document.getElementById('si-cost')?.value)  || 0;
  const location = (document.getElementById('si-loc')?.value   || '').trim();

  if (!name) { showToast('error','Ingresá el nombre del ítem'); return; }

  const res = await apiFetch('/api/stock', {
    method: 'POST',
    body: JSON.stringify({ code, name, category, unit, qty, min_qty, unit_cost: cost, location })
  });
  if (!res.ok) { const e=await res.json(); showToast('error', e.error||'Error al guardar stock'); return; }

  closeModal(); showToast('ok','Ítem de stock creado');
  renderStock(); loadInitialData().then(()=>renderStock());
}


function renderDocuments() {
  const expired = App.data.documents.filter(d=>d.status==='danger').length;
  const nearExp  = App.data.documents.filter(d=>d.status==='warn').length;
  document.getElementById('page-documents').innerHTML = `
    <div class="kpi-row kpi-row-3" style="margin-bottom:20px">
      <div class="kpi-card ${expired===0?'ok':'danger'}"><div class="kpi-label">Documentos vencidos</div><div class="kpi-value ${expired===0?'ok':'danger'}">${expired}</div><div class="kpi-trend">requieren acción inmediata</div></div>
      <div class="kpi-card ${nearExp===0?'ok':'warn'}"><div class="kpi-label">Vencen en 30 días</div><div class="kpi-value ${nearExp===0?'ok':'warn'}">${nearExp}</div><div class="kpi-trend">programar renovación</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Documentos al día</div><div class="kpi-value ok">${App.data.documents.filter(d=>d.status==='ok').length}</div><div class="kpi-trend">sin vencimientos próximos</div></div>
    </div>
    <div class="section-header">
      <div><div class="section-title">Control de vencimientos</div></div>
      <button class="btn btn-primary" onclick="openNewDocModal()">+ Cargar documento</button>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Vehículo</th><th>Patente</th><th>Tipo</th><th>Vencimiento actual</th><th>Días restantes</th><th>Referencia</th><th>Estado</th><th></th></tr></thead>
          <tbody>${App.data.documents.map((d,idx)=>{
            const days = Math.ceil((new Date(d.expiry)-new Date())/86400000);
            return `<tr>
              <td class="td-main">${d.vehicle}</td>
              <td class="td-mono">${d.plate||'—'}</td>
              <td>${d.type}</td>
              <td class="td-mono">${d.expiry}</td>
              <td class="td-mono" style="color:var(--${d.status==='danger'?'danger':d.status==='warn'?'warn':'ok'})">
                ${days<0?'Vencido hace '+Math.abs(days)+' días':days+' días'}
              </td>
              <td style="font-size:11px;color:var(--text3)">${d.ref||'—'}</td>
              <td><span class="badge ${d.status==='ok'?'badge-ok':d.status==='warn'?'badge-warn':'badge-danger'}">${d.status==='ok'?'Vigente':d.status==='warn'?'Por vencer':'Vencido'}</span></td>
              <td style="white-space:nowrap;display:flex;gap:4px;padding:8px 6px">
                <button class="btn btn-primary btn-sm"   onclick="openRenewDocModal(${idx})">Renovar</button>
                <button class="btn btn-secondary btn-sm" onclick="openEditDocModal(${idx})">Editar</button>
              </td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── RENOVAR documento existente ──
function openRenewDocModal(idx) {
  const d = App.data.documents[idx];
  if (!d) return;
  // Sugerir nueva fecha: +1 año para la mayoría, +6 meses para VTV
  const suggested = new Date(d.expiry);
  suggested.setMonth(suggested.getMonth() + (d.type==='VTV'?6:12));
  const suggestedStr = suggested.toISOString().split('T')[0];

  openModal(`Renovar — ${d.type} de ${d.vehicle}`, `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:12px 14px;margin-bottom:16px">
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Documento actual</div>
      <div style="font-size:14px;font-weight:500;color:var(--text)">${d.type} · ${d.vehicle}</div>
      <div style="font-size:12px;color:var(--text3);margin-top:2px">Vencimiento anterior: <span style="font-family:var(--mono)">${d.expiry}</span></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Nueva fecha de vencimiento</label>
        <input class="form-input" type="date" id="rn-expiry" value="${suggestedStr}">
        <div style="font-size:11px;color:var(--text3);margin-top:4px">Sugerida: +${d.type==='VTV'?'6 meses':'1 año'} automáticamente</div>
      </div>
      <div class="form-group">
        <label class="form-label">Número / referencia del nuevo doc.</label>
        <input class="form-input" placeholder="Nro. póliza, certificado, etc." id="rn-ref" value="${d.ref||''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Observaciones (opcional)</label>
      <input class="form-input" placeholder="Ej: Renovado en ACARA, póliza actualizada..." id="rn-obs">
    </div>
    <div style="background:var(--info-bg);border:1px solid rgba(6,182,212,.25);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--info)">
      Al confirmar se actualizará la fecha de vencimiento y el estado del documento automáticamente.
    </div>
  `, [
    { label:'Confirmar renovación', cls:'btn-primary', fn: () => saveRenewDoc(idx) },
    { label:'Cancelar',             cls:'btn-secondary', fn: closeModal }
  ]);
}

function saveRenewDoc(idx) {
  const newExpiry = document.getElementById('rn-expiry').value;
  const newRef    = document.getElementById('rn-ref').value;
  if (!newExpiry) { showToast('warn','Ingresá la nueva fecha de vencimiento'); return; }
  const d = App.data.documents[idx];
  const days = Math.ceil((new Date(newExpiry)-new Date())/86400000);
  d.expiry = newExpiry;
  d.ref    = newRef || d.ref;
  d.status = days > 30 ? 'ok' : days > 0 ? 'warn' : 'danger';
  closeModal();
  renderDocuments();
  showToast('ok', `${d.type} de ${d.vehicle} renovado — nuevo vencimiento: ${newExpiry}`);
}

// ── EDITAR documento (todos los campos) ──
function openEditDocModal(idx) {
  const d = App.data.documents[idx];
  if (!d) return;
  openModal(`Editar documento — ${d.vehicle}`, `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Vehículo (código)</label>
        <input class="form-input" id="ed-veh" value="${d.vehicle}">
      </div>
      <div class="form-group">
        <label class="form-label">Tipo de documento</label>
        <select class="form-select" id="ed-type">
          ${['VTV','Seguro','Habilitación','Certificado','CNRT','Carnet chofer','Otro'].map(t=>
            `<option ${t===d.type?'selected':''}>${t}</option>`
          ).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Fecha de vencimiento</label>
        <input class="form-input" type="date" id="ed-expiry" value="${d.expiry}">
      </div>
      <div class="form-group">
        <label class="form-label">Número / referencia</label>
        <input class="form-input" placeholder="Nro. de póliza, certificado..." id="ed-ref" value="${d.ref||''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Patente del vehículo</label>
      <input class="form-input" placeholder="ABC 123" id="ed-plate" value="${d.plate||''}">
    </div>
  `, [
    { label:'Guardar cambios', cls:'btn-primary', fn: () => saveEditDoc(idx) },
    { label:'Cancelar',        cls:'btn-secondary', fn: closeModal }
  ]);
}

function saveEditDoc(idx) {
  const newExpiry = document.getElementById('ed-expiry').value;
  if (!newExpiry) { showToast('warn','La fecha de vencimiento es obligatoria'); return; }
  const d = App.data.documents[idx];
  const days = Math.ceil((new Date(newExpiry)-new Date())/86400000);
  d.vehicle = document.getElementById('ed-veh').value    || d.vehicle;
  d.type    = document.getElementById('ed-type').value;
  d.expiry  = newExpiry;
  d.ref     = document.getElementById('ed-ref').value;
  d.plate   = document.getElementById('ed-plate').value  || d.plate;
  d.status  = days > 30 ? 'ok' : days > 0 ? 'warn' : 'danger';
  closeModal();
  renderDocuments();
  showToast('ok', `Documento actualizado correctamente`);
}

// ── NUEVO documento ──
function openNewDocModal() {
  openModal('Cargar nuevo documento', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Vehículo (código interno)</label>
        <input class="form-input" placeholder="INT-XX" id="nd-veh">
      </div>
      <div class="form-group">
        <label class="form-label">Patente</label>
        <input class="form-input" placeholder="ABC 123" id="nd-plate">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Tipo de documento</label>
        <select class="form-select" id="nd-type">
          <option>VTV</option><option>Seguro</option><option>Habilitación</option>
          <option>Certificado</option><option>CNRT</option><option>Carnet chofer</option><option>Otro</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de vencimiento</label>
        <input class="form-input" type="date" id="nd-expiry">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Número / referencia (póliza, certificado, etc.)</label>
      <input class="form-input" placeholder="Ej: POL-00123456" id="nd-ref">
    </div>
  `, [
    { label:'Guardar documento', cls:'btn-primary', fn: saveNewDoc },
    { label:'Cancelar',          cls:'btn-secondary', fn: closeModal }
  ]);
}

function saveNewDoc() {
  const expiry = document.getElementById('nd-expiry').value;
  const veh    = document.getElementById('nd-veh').value;
  if (!veh)    { showToast('warn','Ingresá el código del vehículo'); return; }
  if (!expiry) { showToast('warn','Ingresá la fecha de vencimiento'); return; }
  const days   = Math.ceil((new Date(expiry)-new Date())/86400000);
  App.data.documents.push({
    id:      App.data.documents.length + 1,
    vehicle: veh,
    plate:   document.getElementById('nd-plate').value || '—',
    type:    document.getElementById('nd-type').value,
    expiry,
    ref:     document.getElementById('nd-ref').value || '—',
    status:  days > 30 ? 'ok' : days > 0 ? 'warn' : 'danger',
    file:    '—'
  });
  closeModal();
  renderDocuments();
  showToast('ok', 'Documento cargado correctamente');
}

// ── COSTOS ──
// ══════════════════════════════════════════
//  MÓDULO DE COSTOS — Interactivo con drill-down
// ══════════════════════════════════════════

// Datos de costo detallados por unidad (simulados pero realistas)
function getCostDetail(vehicleCode) {
  const v = App.data.vehicles.find(x => x.code === vehicleCode);
  if (!v) return null;

  // ── Período: mes actual ──
  const now  = new Date();
  const yr   = now.getFullYear();
  const mo   = now.getMonth() + 1;

  const inMes = d => { const x = new Date(d); return x.getFullYear()===yr && x.getMonth()+1===mo; };

  // ── Combustible real ──
  const fuelLogs = App.data.fuelLogs.filter(f => f.vehicle === vehicleCode);
  const fuelMes  = fuelLogs.filter(f => inMes(f.date));
  const fuelTotal = fuelMes.reduce((a,f) => a + (f.liters * f.ppu), 0);
  const fuelItems = fuelMes.map(f => ({
    fecha:   f.date.split(' ')[0],
    desc:    `Carga ${f.liters}L · ${f.place}`,
    monto:   Math.round(f.liters * f.ppu),
    detalle: `${f.liters}L × $${f.ppu}/L · ${f.km ? f.km.toLocaleString()+' km' : 'km GPS'}`,
  }));

  // ── OTs reales del mes ──
  const otsMes = App.data.workOrders.filter(o => {
    if (o.vehicle !== vehicleCode) return false;
    return inMes(o.closed_at || o.opened || o.date);
  });
  const prevOTs  = otsMes.filter(o => o.type === 'Preventivo');
  const corrOTs  = otsMes.filter(o => o.type !== 'Preventivo');
  const prevTotal = prevOTs.reduce((a,o) => a + (o.labor_cost||0) + (o.parts_cost||0), 0);
  const corrTotal = corrOTs.reduce((a,o) => a + (o.labor_cost||0) + (o.parts_cost||0), 0);
  const manoTotal = otsMes.reduce((a,o) => a + (o.labor_cost||0), 0);
  const repTotal  = otsMes.reduce((a,o) => a + (o.parts_cost||0), 0);

  const prevItems = prevOTs.map(o => ({
    fecha:   (o.opened||'').split(' ')[0],
    desc:    o.desc || o.description || '—',
    monto:   Math.round((o.labor_cost||0) + (o.parts_cost||0)),
    detalle: `Repuestos: $${Math.round(o.parts_cost||0).toLocaleString()} · M.O.: $${Math.round(o.labor_cost||0).toLocaleString()} · ${o.id}`,
  }));
  const corrItems = corrOTs.map(o => ({
    fecha:   (o.opened||'').split(' ')[0],
    desc:    o.desc || o.description || '—',
    monto:   Math.round((o.labor_cost||0) + (o.parts_cost||0)),
    detalle: `Repuestos: $${Math.round(o.parts_cost||0).toLocaleString()} · M.O.: $${Math.round(o.labor_cost||0).toLocaleString()} · ${o.id}`,
  }));

  // ── Km reales del mes (GPS) ──
  // Diferencia entre primera y última lectura de km en cargas del mes
  const kmsDelMes = fuelMes.filter(f => f.km > 0).map(f => f.km).sort((a,b)=>a-b);
  let kmMes = 0;
  if (kmsDelMes.length >= 2) {
    kmMes = kmsDelMes[kmsDelMes.length-1] - kmsDelMes[0];
  } else if (kmsDelMes.length === 1) {
    kmMes = 0; // solo una carga, no podemos calcular diferencia
  }
  // Sin datos de km GPS en cargas del mes → no estimamos, mostramos sin datos

  // ── Costo/km real ──
  const totalMes = fuelTotal + prevTotal + corrTotal;
  const costKmReal = kmMes > 0 && totalMes > 0 ? totalMes / kmMes : 0;

  return {
    v, kmMes, totalMes, costKmReal,
    manoTotal, repTotal,
    rubros: [
      {
        id:'fuel', label:'Combustible', color:'#3b82f6',
        total: fuelTotal, pct: totalMes>0 ? Math.round(fuelTotal/totalMes*100) : 0,
        items: fuelItems.length ? fuelItems : [{ fecha:'—', desc:'Sin cargas registradas este mes', monto:0, detalle:'—' }],
      },
      {
        id:'prev', label:'Mantenimiento preventivo', color:'#22c55e',
        total: prevTotal, pct: totalMes>0 ? Math.round(prevTotal/totalMes*100) : 0,
        items: prevItems.length ? prevItems : [{ fecha:'—', desc:'Sin OTs preventivas este mes', monto:0, detalle:'—' }],
      },
      {
        id:'corr', label:'Mantenimiento correctivo', color:'#ef4444',
        total: corrTotal, pct: totalMes>0 ? Math.round(corrTotal/totalMes*100) : 0,
        items: corrItems.length ? corrItems : [{ fecha:'—', desc:'Sin OTs correctivas este mes', monto:0, detalle:'—' }],
      },
    ]
  };
}


// Estado del módulo de costos
let _costSelectedUnit  = null;
let _costExpandedRubro = null;
let _costPeriod        = 'mes';

function exportCostCSV() {
  const now = new Date();
  const yr = now.getFullYear(), mo = now.getMonth()+1;
  const mesStr = yr+'-'+String(mo).padStart(2,'0');

  let csv = 'Unidad,Marca,Modelo,Km mes,Combustible ($),Preventivo ($),Correctivo ($),Total ($),$/km\n';
  App.data.vehicles.forEach(v => {
    const d = getCostDetail(v.code);
    if (!d || d.totalMes === 0) return;
    csv += `${v.code},${v.brand},${v.model},${d.kmMes},${Math.round(d.rubros[0].total)},${Math.round(d.rubros[1].total)},${Math.round(d.rubros[2].total)},${Math.round(d.totalMes)},${d.costKmReal>0?d.costKmReal.toFixed(3):'—'}\n`;
  });

  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `costos-operativos-${mesStr}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast('ok', 'CSV exportado');
}

function renderCosts() {
  // Calcular costo real de cada vehículo este mes
  const withCost = App.data.vehicles.map(v => {
    const d = getCostDetail(v.code);
    return { ...v, _costReal: d ? d.costKmReal : 0, _totalMes: d ? d.totalMes : 0, _kmMes: d ? d.kmMes : 0 };
  });
  const sorted = [...withCost].sort((a,b) => b._totalMes - a._totalMes);
  const conDatos = sorted.filter(v => v._costReal > 0);
  const avg = conDatos.length > 0
    ? (conDatos.reduce((a,v)=>a+v._costReal,0)/conDatos.length).toFixed(3)
    : '—';

  document.getElementById('page-costs').innerHTML = `
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card info">
        <div class="kpi-label">Costo/km promedio flota</div>
        <div class="kpi-value white">$${avg}</div>
        <div class="kpi-trend">todas las unidades · mes actual</div>
      </div>
      <div class="kpi-card danger">
        <div class="kpi-label">Unidad más costosa</div>
        <div class="kpi-value danger">${sorted[0]._totalMes>0 ? '$'+Math.round(sorted[0]._totalMes/1000)+'K' : 'Sin datos'}</div>
        <div class="kpi-trend" style="cursor:pointer;text-decoration:underline" onclick="openCostDrillDown('${sorted[0].code}')">${sorted[0].code} — clic para ver detalle</div>
      </div>
      <div class="kpi-card ok">
        <div class="kpi-label">Unidad más eficiente</div>
        <div class="kpi-value ok">${conDatos.length>0 ? '$'+conDatos[conDatos.length-1]._costReal.toFixed(3)+'/km' : '—'}</div>
        <div class="kpi-trend">${conDatos.length>0 ? conDatos[conDatos.length-1].code+' — '+conDatos[conDatos.length-1].brand : 'Sin datos suficientes'}</div>
      </div>
      <div class="kpi-card warn">
        <div class="kpi-label">Con gasto este mes</div>
        <div class="kpi-value warn">${conDatos.length}</div>
        <div class="kpi-trend">unidades con movimiento registrado</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px;margin-bottom:20px">
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="card-title" style="margin:0">Ranking costo/km — hacé clic para ver el desglose</div>
        </div>
        <div style="position:relative;height:300px">
          <canvas id="costRankChart" role="img" aria-label="Ranking costo por km"></canvas>
        </div>
      </div>
      <div class="card" id="cost-summary-panel">
        <div class="card-title">Seleccioná una unidad</div>
        <div style="color:var(--text3);font-size:13px;padding:16px 0">
          Hacé clic en una barra del gráfico o en cualquier fila de la tabla para ver el desglose completo de costos de esa unidad.
        </div>
      </div>
    </div>

    <div class="section-header">
      <div><div class="section-title">Detalle por unidad — clic en una fila para el desglose completo</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" onclick="exportCostCSV()">↓ Exportar CSV</button>
      </div>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table id="costs-table">
          <thead><tr>
            <th>Código</th><th>Marca / Modelo</th><th>Km mes</th>
            <th style="color:#3b82f6">Combustible</th><th style="color:#22c55e">Preventivo</th><th style="color:#ef4444">Correctivo</th>
            <th>Total mes</th><th>$/km</th><th>Eval.</th><th></th>
          </tr></thead>
          <tbody>${sorted.slice(0,20).map(v=>{
            const d = getCostDetail(v.code);
            if (!d || d.totalMes === 0) return '';
            const ck = d.costKmReal;
            const ev = ck>0.25?['danger','Alto']:ck>0.20?['warn','Revisar']:['ok','Eficiente'];
            return `<tr style="cursor:pointer" onclick="openCostDrillDown('${v.code}')" title="Clic para ver desglose completo">
              <td class="td-mono td-main">${v.code}</td>
              <td>${v.brand} ${v.model}</td>
              <td class="td-mono">${d.kmMes > 0 ? d.kmMes.toLocaleString() : '—'}</td>
              <td class="td-mono" style="color:#3b82f6">${d.rubros[0].total>0?'$'+Math.round(d.rubros[0].total/1000)+'K':'—'}</td>
              <td class="td-mono" style="color:#22c55e">${d.rubros[1].total>0?'$'+Math.round(d.rubros[1].total/1000)+'K':'—'}</td>
              <td class="td-mono" style="color:#ef4444">${d.rubros[2].total>0?'$'+Math.round(d.rubros[2].total/1000)+'K':'—'}</td>
              <td class="td-mono" style="font-weight:600">$${Math.round(d.totalMes/1000)}K</td>
              <td class="td-mono" style="font-weight:700;color:var(--${ev[0]})">${ck>0?'$'+ck.toFixed(3):'—'}</td>
              <td><span class="badge badge-${ev[0]}">${ev[1]}</span></td>
              <td><button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openCostDrillDown('${v.code}')">Desglose</button></td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  setTimeout(() => buildCostRankChart(sorted), 100);
}

function buildCostRankChart(sorted) {
  const ctx = document.getElementById('costRankChart');
  if (!ctx) return;
  if (window._costChart) window._costChart.destroy();
  window._costChart = new Chart(ctx, {
    type:'bar',
    data:{
      labels: sorted.slice(0,12).map(v=>v.code),
      datasets:[{
        label:'$/km',
        data: sorted.slice(0,12).map(v=>v._costReal||0),
        backgroundColor: sorted.slice(0,12).map(v=>
          v._costReal>0.25?'rgba(239,68,68,.75)':
          v._costReal>0.20?'rgba(245,158,11,.75)':
          v._costReal>0?'rgba(34,197,94,.75)':'rgba(100,116,139,.4)'
        ),
        borderRadius:4, borderColor:'transparent',
        hoverBackgroundColor: sorted.slice(0,12).map(v=>
          v._costReal>0.25?'rgba(239,68,68,1)':
          v._costReal>0.20?'rgba(245,158,11,1)':
          v._costReal>0?'rgba(34,197,94,1)':'rgba(100,116,139,.6)'
        ),
      }]
    },
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      onClick: (e, elements) => {
        if (elements.length) {
          const idx  = elements[0].index;
          const code = sorted[idx].code;
          openCostDrillDown(code);
        }
      },
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:ctx=>'  $'+ctx.parsed.x.toFixed(3)+'/km'}}
      },
      scales:{
        x:{ticks:{color:'#9ba3be',callback:v=>'$'+v.toFixed(2)}, grid:{color:'rgba(128,128,128,.1)'}},
        y:{ticks:{color:'#9ba3be',font:{size:11}}, grid:{display:false}}
      }
    }
  });
}

// ── DRILL-DOWN: desglose completo de una unidad ──
function openCostDrillDown(vehicleCode) {
  const d = getCostDetail(vehicleCode);
  if (!d) return;

  openModal(`Desglose de costos — ${vehicleCode}`, `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:16px;font-weight:600">${d.v.brand} ${d.v.model} · ${d.v.year}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${d.v.driver} · Base ${d.v.base} · ${d.kmMes.toLocaleString()} km este mes</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:28px;font-weight:700;font-family:var(--mono);color:var(--${d.costKmReal>0.25?'danger':d.costKmReal>0.20?'warn':'ok'})">${d.costKmReal>0?'$'+d.costKmReal.toFixed(3):'Sin datos'}</div>
        <div style="font-size:11px;color:var(--text3)">por kilómetro</div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-top:2px">$${d.totalMes.toLocaleString()} / mes</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:18px">
      ${d.rubros.map(r=>`
        <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 8px;text-align:center;border:1px solid var(--border);cursor:pointer;transition:all .15s"
          onclick="toggleCostRubro('${vehicleCode}','${r.id}')"
          id="rubro-card-${r.id}">
          <div style="width:8px;height:8px;border-radius:50%;background:${r.color};margin:0 auto 5px"></div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:3px;line-height:1.3">${r.label.split(' ')[0]}</div>
          <div style="font-size:15px;font-weight:700;font-family:var(--mono);color:var(--text)">$${Math.round(r.total/1000)}K</div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">${r.pct}% del total</div>
          <div style="height:3px;background:var(--bg4);border-radius:2px;margin-top:6px;overflow:hidden">
            <div style="height:3px;width:${r.pct}%;background:${r.color};border-radius:2px"></div>
          </div>
          <div style="font-size:9px;color:var(--text3);margin-top:4px">▼ ver detalle</div>
        </div>`).join('')}
    </div>

    <div style="position:relative;height:160px;margin-bottom:18px">
      <canvas id="drilldown-chart-${vehicleCode}" role="img" aria-label="Distribución de costos por rubro"></canvas>
    </div>

    <div id="rubro-detail-panel" style="min-height:40px">
      <div style="font-size:12px;color:var(--text3);text-align:center;padding:8px 0">
        Hacé clic en cualquier rubro de arriba para ver el desglose evento por evento.
      </div>
    </div>

    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Proyección anual estimada</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        ${[
          ['Costo anual total',    '$'+(d.totalMes*12/1000).toFixed(0)+'K', 'text'],
          ['Costo/km real mes',    d.costKmReal>0?'$'+d.costKmReal.toFixed(3):'—', d.costKmReal>0.25?'danger':d.costKmReal>0.20?'warn':'ok'],
          ['Km proyectados año',   (d.kmMes*12).toLocaleString(), 'text'],
          ['Combustible año',      '$'+(d.rubros[0].total*12/1000).toFixed(0)+'K', 'text'],
        ].map(([l,val,c])=>`
          <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 12px;border:1px solid var(--border)">
            <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">${l}</div>
            <div style="font-size:16px;font-weight:700;font-family:var(--mono);color:var(--${c==='text'?'text':c})">${val}</div>
          </div>`).join('')}
      </div>
    </div>
  `, [
    { label:'Ver OT de esta unidad', cls:'btn-secondary', fn:()=>{ closeModal(); navigate('workorders'); } },
    { label:'Cerrar',                cls:'btn-secondary', fn: closeModal },
  ]);

  // Dibujar gráfico de dona dentro del modal
  setTimeout(() => {
    const ctx = document.getElementById(`drilldown-chart-${vehicleCode}`);
    if (!ctx) return;
    new Chart(ctx, {
      type:'doughnut',
      data:{
        labels: d.rubros.map(r=>r.label),
        datasets:[{ data:d.rubros.map(r=>r.total), backgroundColor:d.rubros.map(r=>r.color), borderWidth:0, hoverOffset:6 }]
      },
      options:{
        responsive:true, maintainAspectRatio:false, cutout:'55%',
        plugins:{
          legend:{ display:true, position:'right', labels:{ color:'#9ba3be', font:{size:11}, boxWidth:10, padding:10 } },
          tooltip:{ callbacks:{ label: ctx => `  $${ctx.parsed.toLocaleString()} (${Math.round(ctx.parsed/d.totalMes*100)}%)` } }
        }
      }
    });
    // Guardar referencia al detalle para toggleCostRubro
    window._drillDownData = d;
  }, 80);
}

function toggleCostRubro(vehicleCode, rubroId) {
  const d = window._drillDownData;
  if (!d || d.v.code !== vehicleCode) return;
  const rubro = d.rubros.find(r=>r.id===rubroId);
  if (!rubro) return;

  // Resaltar la tarjeta seleccionada
  d.rubros.forEach(r => {
    const card = document.getElementById('rubro-card-'+r.id);
    if (card) card.style.borderColor = r.id===rubroId ? rubro.color : 'var(--border)';
  });

  const panel = document.getElementById('rubro-detail-panel');
  if (!panel) return;

  panel.innerHTML = `
    <div style="background:var(--bg3);border-radius:var(--radius-lg);padding:14px 16px;border:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <div style="width:10px;height:10px;border-radius:50%;background:${rubro.color};flex-shrink:0"></div>
        <div style="font-size:13px;font-weight:600;color:var(--text)">${rubro.label}</div>
        <div style="margin-left:auto;font-family:var(--mono);font-weight:700;color:var(--text)">$${rubro.total.toLocaleString()} · ${rubro.pct}% del costo total</div>
      </div>
      <table style="width:100%;font-size:12px">
        <thead><tr>
          <th style="text-align:left;padding:5px 8px;color:var(--text3);border-bottom:1px solid var(--border)">Fecha</th>
          <th style="text-align:left;padding:5px 8px;color:var(--text3);border-bottom:1px solid var(--border)">Descripción</th>
          <th style="text-align:left;padding:5px 8px;color:var(--text3);border-bottom:1px solid var(--border)">Detalle</th>
          <th style="text-align:right;padding:5px 8px;color:var(--text3);border-bottom:1px solid var(--border)">Monto</th>
          <th style="text-align:right;padding:5px 8px;color:var(--text3);border-bottom:1px solid var(--border)">% del rubro</th>
        </tr></thead>
        <tbody>
          ${rubro.items.map(item=>`
            <tr>
              <td style="padding:7px 8px;color:var(--text3);font-family:var(--mono);white-space:nowrap">${item.fecha}</td>
              <td style="padding:7px 8px;color:var(--text);font-weight:500">${item.desc}</td>
              <td style="padding:7px 8px;color:var(--text3);font-size:11px;max-width:200px">${item.detalle}</td>
              <td style="padding:7px 8px;text-align:right;font-family:var(--mono);font-weight:600;color:${rubro.color}">$${item.monto.toLocaleString()}</td>
              <td style="padding:7px 8px;text-align:right;font-family:var(--mono);color:var(--text3)">
                ${Math.round(item.monto/rubro.total*100)}%
                <div style="height:3px;background:var(--bg4);border-radius:2px;margin-top:3px;overflow:hidden">
                  <div style="height:3px;width:${Math.round(item.monto/rubro.total*100)}%;background:${rubro.color};border-radius:2px"></div>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border2)">
            <td colspan="3" style="padding:8px 8px;font-weight:600;color:var(--text)">Total ${rubro.label}</td>
            <td style="padding:8px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:${rubro.color}">$${rubro.total.toLocaleString()}</td>
            <td style="padding:8px 8px;text-align:right;font-family:var(--mono);color:var(--text3)">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

// ── MANTENIMIENTO ──
function renderMaintenance() {
  const root = document.getElementById('page-maintenance');
  if (!root) return;

  const vehicles = App.data.vehicles || [];

  if (vehicles.length === 0) {
    root.innerHTML = `
      <div class="section-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div><h2 style="font-size:18px;font-weight:700;margin:0">Plan de mantenimiento</h2></div>
      </div>
      <div class="card" style="text-align:center;padding:40px;color:var(--text3)">
        <div style="font-size:32px;margin-bottom:12px">🔧</div>
        <div style="font-weight:600;margin-bottom:8px">Sin vehículos registrados</div>
      </div>`;
    return;
  }

  // Generar planes usando intervalos guardados en tech_spec o defaults
  const plans = vehicles.map(v => {
    const km = v.km || 0;
    const ts = v.tech_spec || {};
    const interval = parseInt(ts.maint_interval_km) || 15000;
    const lastMaint = parseInt(ts.maint_last_km) || 0;
    const kmSinceLast = km - lastMaint;
    const pct = Math.min(100, Math.round(kmSinceLast / interval * 100));
    const nextKm = lastMaint + interval;
    const status = pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : 'ok';
    const taskName = ts.maint_task_name || 'Cambio aceite + filtros';
    return { v, km, interval, lastMaint, kmSinceLast, pct, nextKm, status, taskName };
  });

  const rows = plans.map(p => `
    <tr>
      <td class="td-mono td-main">${p.v.code}</td>
      <td>
        <div style="font-weight:500">${p.taskName}</div>
        <div style="font-size:11px;color:var(--text3)">c/${p.interval.toLocaleString()} km · último: ${p.lastMaint.toLocaleString()} km</div>
      </td>
      <td><span class="badge badge-info">Por km</span></td>
      <td class="td-mono">${p.nextKm.toLocaleString()} km</td>
      <td class="td-mono">${p.km.toLocaleString()} km</td>
      <td style="width:140px">
        <div style="background:var(--bg4);border-radius:4px;height:6px;overflow:hidden">
          <div style="background:var(--${p.status});width:${p.pct}%;height:100%"></div>
        </div>
        <div style="font-size:11px;color:var(--${p.status});margin-top:2px">${p.pct}% · faltan ${Math.max(0,p.nextKm-p.km).toLocaleString()} km</div>
      </td>
      <td><span class="badge badge-${p.status}">${p.status==='ok'?'Al día':p.status==='warn'?'Próximo':'Vencido'}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="openMaintConfigModal('${p.v.id}')">⚙ Configurar</button>
      </td>
    </tr>`).join('');

  const vencidos = plans.filter(p=>p.status==='danger').length;
  const proximos = plans.filter(p=>p.status==='warn').length;

  root.innerHTML = `
    <div class="section-header" style="margin-bottom:20px">
      <div>
        <h2 style="font-size:18px;font-weight:700;margin:0">Plan de mantenimiento</h2>
        <p style="font-size:13px;color:var(--text3);margin:4px 0 0">Preventivo · predictivo · correctivo</p>
      </div>
    </div>
    ${vencidos>0 ? `<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--danger);display:flex;align-items:center;justify-content:space-between">
      <span>⚠ <b>${vencidos} unidad${vencidos>1?'es':''}</b> con mantenimiento vencido.</span>
      <button class="btn btn-sm" style="background:var(--danger);color:white;border:none" onclick="plans.filter(p=>p.status==='danger').forEach(p=>createPreventiveOT(p.v.code,p.taskName))">Crear OTs preventivas</button>
    </div>` : ''}
    ${proximos>0 ? `<div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--warn)">🔧 <b>${proximos} unidad${proximos>1?'es':''}</b> próxima${proximos>1?'s':''} a mantenimiento. Programar service.</div>` : ''}
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Unidad</th><th>Tarea</th><th>Tipo</th><th>Próximo</th><th>Actual</th><th>Progreso</th><th>Estado</th><th>Acción</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <div style="margin-top:12px;font-size:12px;color:var(--text3)">
      💡 Hacé clic en <b>⚙ Configurar</b> en cualquier unidad para personalizar el intervalo, el km del último service y la tarea.
    </div>`;
}

function openMaintConfigModal(vehicleId) {
  const v = App.data.vehicles.find(x=>x.id===vehicleId);
  if (!v) return;
  const ts = v.tech_spec || {};
  const interval = ts.maint_interval_km || 15000;
  const lastKm   = ts.maint_last_km    || 0;
  const taskName = ts.maint_task_name  || 'Cambio aceite + filtros';

  openModal(`⚙ Configurar mantenimiento — ${v.code}`, `
    <div style="margin-bottom:14px;font-size:12px;color:var(--text3)">
      Configurá el plan de mantenimiento preventivo para esta unidad. Los datos se guardan en la ficha técnica.
    </div>
    <div class="form-group">
      <label class="form-label">Tarea / nombre del service</label>
      <input class="form-input" id="mc-task" value="${taskName}" placeholder="Ej: Cambio aceite + filtros">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Intervalo (cada cuántos km)</label>
        <input class="form-input" type="number" id="mc-interval" value="${interval}" placeholder="15000">
        <div style="font-size:11px;color:var(--text3);margin-top:4px">Ej: 15000, 20000, 25000</div>
      </div>
      <div class="form-group">
        <label class="form-label">Km del último service</label>
        <input class="form-input" type="number" id="mc-last" value="${lastKm}" placeholder="0">
        <div style="font-size:11px;color:var(--text3);margin-top:4px">Km cuando hiciste el último service</div>
      </div>
    </div>
    <div style="background:var(--bg3);border-radius:var(--radius);padding:12px;margin-top:8px;font-size:12px;color:var(--text3)">
      <b>Km actuales:</b> ${(v.km||0).toLocaleString()} km<br>
      <b>Próximo service:</b> ${(parseInt(lastKm||0)+parseInt(interval||15000)).toLocaleString()} km
      <span id="mc-preview" style="margin-left:8px;font-weight:600"></span>
    </div>
  `, [
    { label: '💾 Guardar', cls: 'btn-primary',   fn: () => saveMaintConfig(vehicleId) },
    { label: 'Cancelar',   cls: 'btn-secondary', fn: closeModal },
  ]);

  // Preview dinámico
  ['mc-interval','mc-last'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      const int = parseInt(document.getElementById('mc-interval')?.value)||15000;
      const last = parseInt(document.getElementById('mc-last')?.value)||0;
      const next = last + int;
      const pct = Math.min(100, Math.round((v.km - last) / int * 100));
      const preview = document.getElementById('mc-preview');
      if (preview) preview.textContent = `(${pct}% completado → próximo: ${next.toLocaleString()} km)`;
    });
  });
}

async function saveMaintConfig(vehicleId) {
  const v = App.data.vehicles.find(x=>x.id===vehicleId);
  if (!v) return;

  const taskName = (document.getElementById('mc-task')?.value||'').trim() || 'Cambio aceite + filtros';
  const interval = parseInt(document.getElementById('mc-interval')?.value) || 15000;
  const lastKm   = parseInt(document.getElementById('mc-last')?.value)    || 0;

  const newTechSpec = Object.assign({}, v.tech_spec||{}, {
    maint_task_name:   taskName,
    maint_interval_km: interval,
    maint_last_km:     lastKm,
  });

  const res = await apiFetch(`/api/vehicles/${vehicleId}/techspec`, {
    method: 'PATCH',
    body: JSON.stringify(newTechSpec)
  });

  if (!res.ok) { showToast('error', 'Error al guardar'); return; }
  const updated = await res.json();
  v.tech_spec = updated.tech_spec || newTechSpec;

  closeModal();
  showToast('ok', `Mantenimiento de ${v.code} configurado — próximo service: ${(lastKm+interval).toLocaleString()} km`);
  renderMaintenance();
  renderDashboard(); // actualizar alertas del panel
}


function openNewMaintModal() {
  const vehicleOpts = (App.data.vehicles||[]).map(v =>
    `<option value="${v.id}" data-code="${v.code}" data-km="${v.km}">${v.code} — ${v.brand} ${v.model} (${v.km.toLocaleString()} km)</option>`
  ).join('');
  openModal('Nueva tarea de mantenimiento', `
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Vehículo</label>
      <select class="form-select" id="nm-veh">${vehicleOpts}</select>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Descripción de la tarea</label>
      <input class="form-input" placeholder="Ej: Cambio aceite motor 15W-40 + filtros" id="nm-task">
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Intervalo (km)</label><input class="form-input" type="number" placeholder="15000" id="nm-interval" value="15000"></div>
      <div class="form-group"><label class="form-label">Km del último service</label><input class="form-input" type="number" placeholder="0" id="nm-last" value="0"></div>
    </div>
  `, [
    { label:'Guardar', cls:'btn-primary', fn: saveNewMaintTask },
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal }
  ]);
}

async function saveNewMaintTask() {
  const sel      = document.getElementById('nm-veh');
  const vehicleId = sel?.value || '';
  const task     = (document.getElementById('nm-task')?.value || '').trim();
  const interval = parseInt(document.getElementById('nm-interval')?.value) || 15000;
  const lastKm   = parseInt(document.getElementById('nm-last')?.value) || 0;
  const code     = sel?.options[sel.selectedIndex]?.dataset?.code || '';

  if (!vehicleId) { showToast('error', 'Seleccioná un vehículo'); return; }
  if (!task)      { showToast('error', 'Ingresá la descripción de la tarea'); return; }

  const v = App.data.vehicles.find(x => x.id === vehicleId);
  const newTechSpec = Object.assign({}, v?.tech_spec || {}, {
    maint_task_name:   task,
    maint_interval_km: interval,
    maint_last_km:     lastKm,
  });

  const res = await apiFetch(`/api/vehicles/${vehicleId}/techspec`, {
    method: 'PATCH',
    body: JSON.stringify(newTechSpec)
  });

  if (!res.ok) { showToast('error', 'Error al guardar la tarea'); return; }
  const updated = await res.json();
  if (v) v.tech_spec = updated.tech_spec || newTechSpec;

  closeModal();
  showToast('ok', `Tarea de mantenimiento guardada para ${code} — próximo service: ${(lastKm+interval).toLocaleString()} km`);
  renderMaintenance();
}

async function createPreventiveOT(vehicleCode, task) {
  const v = App.data.vehicles.find(x => x.code === vehicleCode);
  if (!v) { showToast('error', 'Vehículo no encontrado'); return; }

  const res = await apiFetch('/api/workorders', {
    method: 'POST',
    body: JSON.stringify({
      vehicle_id:  v.id,
      type:        'Preventivo',
      priority:    'urgente',
      description: task || 'Mantenimiento preventivo programado',
    })
  });

  if (!res.ok) { showToast('error', 'Error al crear OT preventiva'); return; }
  const wo = await res.json();

  // Agregar a memoria local
  App.data.workOrders.unshift({
    id: wo.code || wo.id,
    vehicle: vehicleCode, plate: v.plate || '—',
    type: 'Preventivo', status: 'Abierta', priority: 'urgente',
    desc: wo.description, mechanic: '—',
    opened: new Date().toISOString().slice(0,16).replace('T',' '),
    parts_cost: 0, labor_cost: 0
  });

  showToast('ok', `OT preventiva ${wo.code} creada para ${vehicleCode}`);
  renderMaintenance();
}

// ── MODAL HELPER ──
function openModal(title, bodyHTML, actions=[]) {
  const overlay = document.getElementById('modal-overlay');
  const modal = overlay.querySelector('.modal');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  const footer = document.getElementById('modal-footer');
  footer.innerHTML = actions.map((a,i)=>`<button class="btn ${a.cls}" id="modal-action-${i}">${a.label}</button>`).join('');
  actions.forEach((a,i) => { document.getElementById('modal-action-'+i).onclick = a.fn; });
  if (modal) modal.style.display = 'block';
  overlay.classList.add('open');
  overlay.style.display = 'flex';
}
function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.style.display = 'none';
  }
  // Limpiar contenido del modal
  const body = document.getElementById('modal-body');
  const footer = document.getElementById('modal-footer');
  if (body) body.innerHTML = '';
  if (footer) footer.innerHTML = '';
}

// ── TOAST ──
function showToast(type, msg) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${type==='ok'?'✓':type==='danger'?'✗':'!'}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(10px)'; el.style.transition='all .3s'; setTimeout(()=>el.remove(),300); }, 3500);
}
// ══════════════════════════════════════════════════
//  MÓDULO: GESTIÓN DE USUARIOS
// ══════════════════════════════════════════════════

const ROLES_LIST = [
  { value:'dueno',                 label:'Dueño / Dirección' },
  { value:'gerencia',              label:'Gerencia operativa' },
  { value:'jefe_mantenimiento',    label:'Jefe de mantenimiento' },
  { value:'mecanico',              label:'Mecánico' },
  { value:'chofer',                label:'Chofer' },
  { value:'encargado_combustible', label:'Encargado combustible' },
  { value:'paniol',                label:'Pañol / Stock' },
  { value:'contador',              label:'Contador / Administración' },
  { value:'auditor',               label:'Auditor' },
];

async function renderUsers() {
  const root = document.getElementById('page-users');
  if (!root) return;

  root.innerHTML = `
    <div class="section-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <h2 style="font-size:18px;font-weight:700;color:var(--text1);margin:0">Gestión de usuarios</h2>
        <p style="font-size:13px;color:var(--text3);margin:4px 0 0">Crear, administrar y aprobar accesos al sistema</p>
      </div>
      <button class="btn btn-primary" onclick="openNewUserModal()">+ Nuevo usuario</button>
    </div>
    <div id="pending-wrap"></div>
    <div id="users-table-wrap"><div style="text-align:center;padding:40px;color:var(--text3)">Cargando usuarios...</div></div>
  `;

  try {
    const res = await apiFetch('/api/users');
    if (!res || !res.ok) { document.getElementById('users-table-wrap').innerHTML = '<div style="color:var(--danger);padding:20px">Error cargando usuarios</div>'; return; }
    const users = await res.json();

    // Separar pendientes de aprobación
    const pending = users.filter(u => !u.active && u.role === 'chofer');
    const active  = users.filter(u => u.active || u.role !== 'chofer');

    // Sección de pendientes
    if (pending.length > 0) {
      document.getElementById('pending-wrap').innerHTML = `
        <div class="card" style="border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.06);margin-bottom:20px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
            <span style="font-size:18px">⏳</span>
            <div>
              <div style="font-weight:700;color:var(--warn)">Choferes pendientes de aprobación (${pending.length})</div>
              <div style="font-size:12px;color:var(--text3)">Estos choferes se registraron y esperan que les apruebes el acceso.</div>
            </div>
          </div>
          ${pending.map(u=>`
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg2);border-radius:var(--radius);margin-bottom:8px;border:1px solid var(--border)">
              <div>
                <div style="font-weight:600;color:var(--text)">${u.name}</div>
                <div style="font-size:12px;color:var(--text3)">${u.email} ${u.vehicle_code?'· Unidad: '+u.vehicle_code:''}</div>
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn btn-primary btn-sm" onclick="approveUser('${u.id}')">✓ Aprobar</button>
                <button class="btn btn-secondary btn-sm" style="color:var(--danger)" onclick="rejectUser('${u.id}','${u.name.replace(/'/g,"\\'")}')">✕ Rechazar</button>
              </div>
            </div>`).join('')}
        </div>`;
    } else {
      document.getElementById('pending-wrap').innerHTML = '';
    }

    document.getElementById('users-table-wrap').innerHTML = `
      <div class="card" style="padding:0;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:var(--bg3);border-bottom:1px solid var(--border1)">
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Nombre</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Email</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Rol</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Unidad</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Estado</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Último acceso</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${active.map(u => `
              <tr style="border-bottom:1px solid var(--border1)">
                <td style="padding:12px 16px;font-weight:600;color:var(--text1)">${u.name}</td>
                <td style="padding:12px 16px;color:var(--text2);font-size:13px">${u.email}</td>
                <td style="padding:12px 16px">
                  <span style="background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:3px 10px;font-size:12px;color:var(--text2)">
                    ${ROLES_LIST.find(r=>r.value===u.role)?.label || u.role}
                  </span>
                </td>
                <td style="padding:12px 16px;color:var(--text3);font-size:13px">${u.vehicle_code || '—'}</td>
                <td style="padding:12px 16px">
                  <span style="background:${u.active ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)'};color:${u.active ? '#22c55e' : '#ef4444'};border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600">
                    ${u.active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td style="padding:12px 16px;color:var(--text3);font-size:12px">${u.last_login ? new Date(u.last_login).toLocaleDateString('es-AR') : 'Nunca'}</td>
                <td style="padding:12px 16px">
                  <button class="btn btn-secondary btn-sm" onclick="openEditUserModal('${u.id}','${u.name.replace(/'/g,"\\'")}','${u.email}','${u.role}','${u.vehicle_code||''}',${u.active})">Editar</button>
                  ${userHasRole('dueno') && u.email !== 'admin@fleetos.com' ? `<button class="btn btn-sm" style="background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);margin-left:6px" onclick="confirmDeleteUser('${u.id}','${u.name.replace(/'/g,"\\'")}')">🗑 Eliminar</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--text3);margin-top:12px">${active.length} usuario${active.length !== 1 ? 's' : ''} activo${active.length !== 1 ? 's' : ''}</p>
    `;
  } catch(e) {
    document.getElementById('users-table-wrap').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>`;
  }
}

async function confirmDeleteUser(id, name) {
  if (!confirm(`⚠ ¿Estás seguro que querés eliminar al usuario "${name}"?\n\nEsta acción no se puede deshacer.`)) return;
  const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error || 'Error al eliminar'); return; }
  showToast('ok', `Usuario "${name}" eliminado`);
  renderUsers();
}

async function approveUser(id) {
  // Buscar el usuario para tener todos sus datos
  const res = await apiFetch('/api/users');
  if (!res.ok) { showToast('error', 'Error al obtener usuarios'); return; }
  const users = await res.json();
  const u = users.find(x => x.id === id);
  if (!u) { showToast('error', 'Usuario no encontrado'); return; }

  const res2 = await apiFetch(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: u.name, role: u.role, vehicle_code: u.vehicle_code, active: true })
  });
  if (res2.ok) { showToast('ok', `✓ ${u.name} aprobado — ya puede ingresar al sistema`); renderUsers(); }
  else { const e = await res2.json(); showToast('error', e.error || 'Error al aprobar'); }
}

async function rejectUser(id, name) {
  if (!confirm(`¿Rechazar y desactivar la solicitud de ${name}?`)) return;

  const res = await apiFetch('/api/users');
  if (!res.ok) { showToast('error', 'Error al obtener usuarios'); return; }
  const users = await res.json();
  const u = users.find(x => x.id === id);
  if (!u) { showToast('error', 'Usuario no encontrado'); return; }

  const res2 = await apiFetch(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: u.name, role: u.role, vehicle_code: u.vehicle_code, active: false })
  });
  if (res2.ok) { showToast('ok', 'Solicitud rechazada'); renderUsers(); }
  else { const e = await res2.json(); showToast('error', e.error || 'Error al rechazar'); }
}


function openNewUserModal() {
  const rolesOpts = ROLES_LIST.map(r => `<option value="${r.value}">${r.label}</option>`).join('');
  const vehiclesOpts = (App.data.vehicles||[]).map(v => `<option value="${v.code}">${v.code} · ${v.plate}</option>`).join('');

  openModal('Nuevo usuario', `
    <div class="form-grid">
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Nombre completo *</label>
        <input class="form-input" id="nu-name" type="text" placeholder="Juan Pérez">
      </div>
      <div class="form-group">
        <label class="form-label">Email *</label>
        <input class="form-input" id="nu-email" type="email" placeholder="juan@empresa.com">
      </div>
      <div class="form-group">
        <label class="form-label">Contraseña *</label>
        <input class="form-input" id="nu-pass" type="password" placeholder="Mínimo 8 caracteres">
      </div>
      <div class="form-group">
        <label class="form-label">Rol *</label>
        <select class="form-select" id="nu-role">
          <option value="">— Seleccioná un rol —</option>
          ${rolesOpts}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Unidad asignada <span style="color:var(--text3)">(solo choferes)</span></label>
        <select class="form-select" id="nu-vehicle">
          <option value="">— Sin unidad —</option>
          ${vehiclesOpts}
        </select>
      </div>
    </div>
    <div id="nu-error" style="color:#ef4444;font-size:12px;margin-top:8px;min-height:16px"></div>
  `, [
    { label:'Crear usuario', cls:'btn-primary', fn: saveNewUser },
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal },
  ]);
}

async function saveNewUser() {
  const name  = (document.getElementById('nu-name')?.value  || '').trim();
  const email = (document.getElementById('nu-email')?.value || '').trim();
  const role  = document.getElementById('nu-role')?.value   || 'operario';
  const pass  = (document.getElementById('nu-pass')?.value  || '').trim();

  if (!name || !email || !pass) { showToast('error','Nombre, email y contraseña son obligatorios'); return; }

  const res = await apiFetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ name, email, role, password: pass })
  });
  if (!res.ok) { const e=await res.json(); showToast('error', e.error||'Error al crear usuario'); return; }

  closeModal(); showToast('ok',`Usuario ${name} creado`);
  renderUsers(); loadInitialData().then(()=>renderUsers());
}


function openEditUserModal(id, name, email, role, vehicle, active) {
  const rolesOpts = ROLES_LIST.map(r => `<option value="${r.value}" ${r.value===role?'selected':''}>${r.label}</option>`).join('');
  const vehiclesOpts = (App.data.vehicles||[]).map(v => `<option value="${v.code}" ${v.code===vehicle?'selected':''}>${v.code} · ${v.plate}</option>`).join('');

  openModal(`Editar: ${name}`, `
    <div class="form-grid">
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Nombre completo</label>
        <input class="form-input" id="eu-name" type="text" value="${name}">
      </div>
      <div class="form-group">
        <label class="form-label">Rol</label>
        <select class="form-select" id="eu-role">${rolesOpts}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Unidad asignada</label>
        <select class="form-select" id="eu-vehicle">
          <option value="">— Sin unidad —</option>
          ${vehiclesOpts}
        </select>
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Nueva contraseña <span style="color:var(--text3)">(dejá vacío para no cambiar)</span></label>
        <input class="form-input" id="eu-pass" type="password" placeholder="••••••••">
      </div>
      <div class="form-group" style="grid-column:1/-1;display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="eu-active" ${active?'checked':''} style="width:16px;height:16px">
        <label for="eu-active" style="font-size:13px;color:var(--text2);cursor:pointer">Usuario activo</label>
      </div>
    </div>
    <div id="eu-error" style="color:#ef4444;font-size:12px;margin-top:8px;min-height:16px"></div>
  `, [
    { label:'Guardar cambios', cls:'btn-primary', fn: () => saveEditUser(id) },
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal },
  ]);
}

async function saveEditUser(id) {
  const name     = document.getElementById('eu-name')?.value?.trim();
  const role     = document.getElementById('eu-role')?.value;
  const vehicle  = document.getElementById('eu-vehicle')?.value;
  const password = document.getElementById('eu-pass')?.value;
  const active   = document.getElementById('eu-active')?.checked;
  const errDiv   = document.getElementById('eu-error');

  if (!name || !role) { if(errDiv) errDiv.textContent = 'Nombre y rol son obligatorios'; return; }
  if (password && password.length < 8) { if(errDiv) errDiv.textContent = 'La contraseña debe tener al menos 8 caracteres'; return; }

  try {
    const body = { name, role, vehicle_code: vehicle || null, active };
    if (password) body.password = password;

    const res = await apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { if(errDiv) errDiv.textContent = data.error || 'Error al guardar'; return; }

    closeModal();
    showToast('ok', `Usuario ${name} actualizado`);
    renderUsers();
  } catch(e) {
    if(errDiv) errDiv.textContent = 'Error de conexión';
  }
}


// ── INIT ──

// ── ÓRDENES DE TRABAJO ──
function renderWorkOrders() {
  const open   = App.data.workOrders.filter(o=>o.status!=='Cerrada');
  const closed = App.data.workOrders.filter(o=>o.status==='Cerrada');
  document.getElementById('page-workorders').innerHTML = `
    <div class="kpi-row kpi-row-3" style="margin-bottom:20px">
      <div class="kpi-card ${open.length<5?'ok':'warn'}"><div class="kpi-label">OT abiertas</div><div class="kpi-value ${open.length<5?'ok':'warn'}">${open.length}</div><div class="kpi-trend">requieren atención</div></div>
      <div class="kpi-card info"><div class="kpi-label">En proceso hoy</div><div class="kpi-value info">${open.filter(o=>o.status==='En proceso').length}</div><div class="kpi-trend">en ejecución activa</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Cerradas este mes</div><div class="kpi-value ok">${closed.length}</div><div class="kpi-trend">completadas con éxito</div></div>
    </div>
    <div class="section-header">
      <div><div class="section-title">Órdenes de trabajo</div></div>
      <button class="btn btn-primary" onclick="openNewOTModal()">+ Nueva OT</button>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Vehículo</th><th>Tipo</th><th>Descripción</th><th>Mecánico</th><th>Estado</th><th>Prioridad</th><th>Costo total</th><th>Fecha</th><th></th></tr></thead>
          <tbody>${App.data.workOrders.length === 0 ? '<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:32px">Sin órdenes de trabajo registradas</td></tr>' :
            App.data.workOrders.map(o=>`<tr>
            <td class="td-mono td-main">${o.id||o._id||'—'}</td>
            <td class="td-main">${o.vehicle||'—'}<br><span style="color:var(--text3);font-size:11px;font-family:var(--mono)">${o.plate||'—'}</span></td>
            <td><span class="badge ${o.type==='Preventivo'?'badge-ok':'badge-danger'}">${o.type||'—'}</span></td>
            <td style="max-width:180px;color:var(--text2)">${o.desc||o.title||'—'}</td>
            <td>${o.mechanic||'—'}</td>
            <td><span class="badge ${
              o.status==='Cerrada'?'badge-ok':
              o.status==='En proceso'?'badge-info':
              o.status==='Esperando repuesto'?'badge-warn':'badge-gray'
            }">${o.status||'—'}</span></td>
            <td><span class="badge ${o.priority==='Urgente'?'badge-danger':o.priority==='Media'?'badge-warn':'badge-gray'}">${o.priority||'—'}</span></td>
            <td class="td-mono">${(o.parts_cost||0)+(o.labor_cost||0)>0?'$'+Math.round((o.parts_cost||0)+(o.labor_cost||0)).toLocaleString():'—'}</td>
            <td class="td-mono" style="font-size:11px">${(o.opened||'—').toString().split('T')[0]}</td>
            <td style="white-space:nowrap">
              ${o.status!=='Cerrada'?`<button class="btn btn-secondary btn-sm" onclick="openEditOTModal('${o.id||o._id}')">Editar</button>`:''}
            </td>
          </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── PANEL CHOFER ──
function renderChoferPanel() {
  const u = App.currentUser;
  // Buscar el vehículo asignado al chofer
  const myVehicle = (App.data.vehicles||[]).find(v =>
    v.driver && v.driver.toLowerCase() === u?.name?.toLowerCase()
  ) || (App.data.vehicles||[]).find(v => v.code === u?.vehicle_code);

  // Últimas cargas del chofer
  const myFuel = (App.data.fuelLogs||[]).filter(f =>
    f.driver && f.driver.toLowerCase().includes((u?.name||'').toLowerCase().split(' ')[0])
  ).slice(0,5);
  const lastFuel = myFuel[0];

  // Novedades del chofer (work orders abiertas)
  const myOTs = (App.data.workOrders||[]).filter(o =>
    (o.mechanic === u?.name || o.driver === u?.name) && o.status !== 'Cerrada'
  );

  const statusLabel = { ok:'Operativo', warn:'Con alerta', taller:'En taller', detenida:'Detenida', inactiva:'Inactiva' };
  const statusClass = { ok:'badge-ok', warn:'badge-warn', taller:'badge-warn', detenida:'badge-danger', inactiva:'badge-warn' };

  document.getElementById('page-chofer_panel').innerHTML = `
    <div style="max-width:480px;margin:0 auto">

      <!-- Card vehículo asignado -->
      <div class="card" style="text-align:center;margin-bottom:16px;padding:24px 20px">
        ${myVehicle ? `
          <div style="font-size:22px;font-weight:700;color:var(--info);letter-spacing:1px">${myVehicle.code}</div>
          <div style="color:var(--text3);font-size:13px;margin:4px 0 10px">${myVehicle.plate} · ${myVehicle.brand} ${myVehicle.model}</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:12px">
            <span class="badge ${statusClass[myVehicle.status]||'badge-ok'}">${statusLabel[myVehicle.status]||myVehicle.status}</span>
            <span style="font-family:monospace;font-size:13px;color:var(--text2)">${(myVehicle.km||0).toLocaleString()} km</span>
          </div>
        ` : `
          <div style="color:var(--text3);font-size:14px">Sin vehículo asignado</div>
          <div style="color:var(--text3);font-size:12px;margin-top:4px">Contactá al encargado</div>
        `}
      </div>

      <!-- Acciones rápidas -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <button onclick="openChoferNovedadModal()" style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:var(--radius);padding:24px 16px;cursor:pointer;text-align:center;transition:.2s" onmouseover="this.style.background='rgba(239,68,68,.25)'" onmouseout="this.style.background='rgba(239,68,68,.15)'">
          <div style="font-size:28px;margin-bottom:8px">⚠️</div>
          <div style="color:#f87171;font-weight:600;font-size:14px">Reportar novedad</div>
        </button>
        <button onclick="openChoferCargaModal('diesel')" style="background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);border-radius:var(--radius);padding:24px 16px;cursor:pointer;text-align:center;transition:.2s" onmouseover="this.style.background='rgba(59,130,246,.25)'" onmouseout="this.style.background='rgba(59,130,246,.15)'">
          <div style="font-size:28px;margin-bottom:8px">⛽</div>
          <div style="color:#60a5fa;font-weight:600;font-size:14px">Cargar combustible</div>
        </button>
        <button onclick="openChoferChecklistModal()" style="background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);border-radius:var(--radius);padding:24px 16px;cursor:pointer;text-align:center;transition:.2s" onmouseover="this.style.background='rgba(34,197,94,.25)'" onmouseout="this.style.background='rgba(34,197,94,.15)'">
          <div style="font-size:28px;margin-bottom:8px">✅</div>
          <div style="color:#4ade80;font-weight:600;font-size:14px">Checklist salida</div>
        </button>
        <button onclick="openChoferCargaModal('urea')" style="background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:var(--radius);padding:24px 16px;cursor:pointer;text-align:center;transition:.2s" onmouseover="this.style.background='rgba(99,102,241,.25)'" onmouseout="this.style.background='rgba(99,102,241,.15)'">
          <div style="font-size:28px;margin-bottom:8px">🔵</div>
          <div style="color:#a5b4fc;font-weight:600;font-size:14px">Cargar urea</div>
        </button>
      </div>

      <!-- Mis novedades -->
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="card-title" style="margin:0">MIS NOVEDADES</div>
          <span style="font-size:11px;color:var(--text3)">${myOTs.length} total · ${myOTs.filter(o=>o.status==='Abierta').length} abiertas</span>
        </div>
        ${myOTs.length === 0
          ? '<p style="color:var(--text3);font-size:13px">No tenés novedades abiertas en este momento.</p>'
          : myOTs.map(o=>`<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
              <b>${o.vehicle||'—'}</b> — ${o.desc||o.title||'—'}
              <span class="badge badge-warn" style="margin-left:6px">${o.status}</span>
            </div>`).join('')
        }
      </div>

      <!-- Última carga -->
      <div class="card">
        <div class="card-title" style="margin-bottom:12px">ÚLTIMA CARGA DE COMBUSTIBLE</div>
        ${lastFuel ? `
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center">
            <div>
              <div style="font-size:28px;font-weight:700;color:var(--text1)">${lastFuel.liters}</div>
              <div style="font-size:11px;color:var(--text3)">litros</div>
            </div>
            <div>
              <div style="font-size:28px;font-weight:700;color:var(--text1)">${(lastFuel.km||0).toLocaleString()}</div>
              <div style="font-size:11px;color:var(--text3)">km</div>
            </div>
            <div>
              <div style="font-size:16px;font-weight:600;color:var(--text2);margin-top:6px">${lastFuel.date?.slice(0,10)||'—'}</div>
              <div style="font-size:11px;color:var(--text3)">${lastFuel.place||'—'}</div>
            </div>
          </div>
        ` : '<p style="color:var(--text3);font-size:13px">Sin cargas registradas.</p>'}
      </div>

    </div>
  `;
}

function openChoferCargaModal(tipo) {
  // Pre-seleccionar el tipo y abrir el modal de carga
  openFuelLoadModal();
  setTimeout(() => {
    const typeEl = document.getElementById('fl-type');
    if (typeEl) { typeEl.value = tipo; updateFuelPlaceOpts(); }
    // Pre-llenar el chofer con el nombre del usuario actual
    const driverEl = document.getElementById('fl-driver');
    if (driverEl && App.currentUser?.name) driverEl.value = App.currentUser.name;
    // Pre-seleccionar el vehículo asignado
    const myVehicle = (App.data.vehicles||[]).find(v =>
      v.driver && v.driver.toLowerCase() === App.currentUser?.name?.toLowerCase()
    );
    const vehicleEl = document.getElementById('fl-vehicle');
    if (vehicleEl && myVehicle) vehicleEl.value = myVehicle.code;
  }, 100);
}

function openChoferNovedadModal() {
  const myVehicle = (App.data.vehicles||[]).find(v =>
    v.driver && v.driver.toLowerCase() === App.currentUser?.name?.toLowerCase()
  );
  openModal('Reportar novedad', `
    <div class="form-group">
      <label class="form-label">Vehículo</label>
      <select class="form-select" id="cn-vehicle">
        ${(App.data.vehicles||[]).map(v=>`<option value="${v.id}" ${myVehicle?.id===v.id?'selected':''}>${v.code} — ${v.plate}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Descripción de la novedad</label>
      <textarea class="form-input" id="cn-desc" rows="3" placeholder="Describí el problema o novedad..."></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Prioridad</label>
      <select class="form-select" id="cn-prio">
        <option value="normal">Normal</option>
        <option value="urgente">Urgente</option>
        <option value="critica">Crítica — no puede salir</option>
      </select>
    </div>
  `, [
    { label:'Reportar', cls:'btn-primary', fn: saveChoferNovedad },
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal }
  ]);
}

async function saveChoferNovedad() {
  const vehicle_id = document.getElementById('cn-vehicle')?.value;
  const desc       = document.getElementById('cn-desc')?.value?.trim();
  const priority   = document.getElementById('cn-prio')?.value;
  if (!desc) { showToast('error','Describí la novedad'); return; }
  const res = await apiFetch('/api/workorders', {
    method: 'POST',
    body: JSON.stringify({ vehicle_id, description: desc, priority, type: 'correctivo', reported_by: App.currentUser?.name })
  });
  if (!res.ok) { showToast('error','Error al reportar'); return; }
  closeModal(); showToast('ok','Novedad reportada correctamente');
  loadInitialData().then(()=>renderChoferPanel());
}

function openChoferChecklistModal() {
  const myVehicle = (App.data.vehicles||[]).find(v =>
    v.driver && v.driver.toLowerCase() === App.currentUser?.name?.toLowerCase()
  ) || (App.data.vehicles||[]).find(v => v.code === App.currentUser?.vehicle_code);

  const items = [
    { id:'aceite',    label:'Nivel de aceite OK',                            critical:true },
    { id:'agua',      label:'Agua del radiador OK',                          critical:true },
    { id:'neumaticos',label:'Presión de neumáticos OK',                      critical:true },
    { id:'luces',     label:'Luces funcionando (frontal y trasera)',          critical:false },
    { id:'frenos',    label:'Frenos OK',                                     critical:true },
    { id:'docu',      label:'Documentación a bordo (libreta, seguro, VTV)',  critical:false },
    { id:'extintor',  label:'Extintor vigente',                              critical:false },
    { id:'perdidas',  label:'Sin pérdidas de fluidos visibles',              critical:true },
  ];

  openModal('✅ Checklist de salida', `
    <div style="font-size:13px;color:var(--text3);margin-bottom:12px">
      ${myVehicle ? myVehicle.code+' — '+myVehicle.plate : 'Completá el checklist antes de salir'}
    </div>
    ${items.map(item=>`
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <input type="checkbox" id="chk-${item.id}" style="width:20px;height:20px;cursor:pointer;accent-color:var(--ok)">
        <label for="chk-${item.id}" style="cursor:pointer;font-size:13px;flex:1">
          ${item.label}
          ${item.critical ? '<span style="color:var(--warn);font-size:10px;margin-left:4px">●</span>' : ''}
        </label>
      </div>
    `).join('')}
    <div style="margin-top:14px">
      <label class="form-label">Km actuales del vehículo</label>
      <input class="form-input" type="number" id="chk-km" placeholder="${(myVehicle?.km||0).toLocaleString()}">
    </div>
    <div style="margin-top:8px">
      <label class="form-label">Observaciones <span style="color:var(--text3);font-weight:400">(opcional)</span></label>
      <textarea class="form-input" id="chk-obs" rows="2" placeholder="Ej: ruido leve en motor, cubiertas con poco aire..."></textarea>
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--text3)">● ítems críticos — si están sin marcar se genera una OT automáticamente</div>
  `, [
    { label:'Confirmar salida ✅', cls:'btn-primary', fn: () => saveChoferChecklist(myVehicle, items) },
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal }
  ]);
}

async function saveChoferChecklist(myVehicle, items) {
  const km = parseInt(document.getElementById('chk-km')?.value) || 0;
  const obs = document.getElementById('chk-obs')?.value?.trim() || '';

  const checkedItems = items.map(item => ({
    id: item.id,
    label: item.label,
    critical: item.critical,
    ok: document.getElementById('chk-'+item.id)?.checked || false,
  }));

  const allOk = checkedItems.every(i => i.ok);
  const criticalFailed = checkedItems.filter(i => !i.ok && i.critical);

  // Confirmar si hay ítems críticos sin marcar
  if (criticalFailed.length > 0) {
    const nombres = criticalFailed.map(i=>i.label).join('\n• ');
    if (!confirm(`⚠ Hay ${criticalFailed.length} ítem(s) crítico(s) sin marcar:\n• ${nombres}\n\n¿Confirmar de todos modos? Se generará una OT automáticamente.`)) return;
  }

  const res = await apiFetch('/api/checklists', {
    method: 'POST',
    body: JSON.stringify({
      vehicle_id: myVehicle?.id || null,
      vehicle_code: myVehicle?.code || null,
      km_at_check: km || null,
      items: checkedItems,
      observations: obs,
      all_ok: allOk,
    })
  });

  if (!res.ok) { showToast('error','Error al guardar checklist'); return; }

  closeModal();
  const msg = allOk
    ? '✅ Checklist OK — Buen viaje!'
    : `⚠ Checklist guardado con ${criticalFailed.length} problema(s) — OT generada automáticamente`;
  showToast(allOk ? 'ok' : 'warn', msg);
}

// ── PANEL ENCARGADO ──
async function renderEncargadoPanel() {
  const el = document.getElementById('page-encargado_panel');
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)">Cargando resumen del día...</div>`;

  try {
    const res = await apiFetch('/api/encargado/resumen');
    if (!res.ok) throw new Error('Error API');
    const d = await res.json();

    const today = new Date().toLocaleDateString('es-AR', {weekday:'long', day:'numeric', month:'long'});
    const flotaOk    = d.flota?.ok    || 0;
    const flotaTaller= (d.flota?.taller||0) + (d.flota?.detenida||0);
    const flotaWarn  = d.flota?.warn  || 0;
    const flotaTotal = Object.values(d.flota||{}).reduce((a,b)=>a+b,0);

    el.innerHTML = `
      <div style="margin-bottom:20px">
        <div style="font-size:13px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">${today}</div>
      </div>

      <!-- KPIs del día -->
      <div class="kpi-row" style="margin-bottom:20px">
        <div class="kpi-card ${d.sin_checklist_count>0?'warn':'ok'}">
          <div class="kpi-label">Sin checklist hoy</div>
          <div class="kpi-value ${d.sin_checklist_count>0?'warn':'ok'}">${d.sin_checklist_count}</div>
          <div class="kpi-trend">${d.checklists_count} completados hoy</div>
        </div>
        <div class="kpi-card ${d.novedades_count>0?'warn':'ok'}">
          <div class="kpi-label">Novedades abiertas</div>
          <div class="kpi-value ${d.novedades_count>0?'warn':'ok'}">${d.novedades_count}</div>
          <div class="kpi-trend">${d.checklists_con_problema} con problemas hoy</div>
        </div>
        <div class="kpi-card info">
          <div class="kpi-label">Cargas combustible hoy</div>
          <div class="kpi-value info">${d.cargas_count}</div>
          <div class="kpi-trend">${Math.round(d.litros_hoy).toLocaleString()} litros totales</div>
        </div>
        <div class="kpi-card ${flotaTaller>0?'warn':'ok'}">
          <div class="kpi-label">Flota operativa</div>
          <div class="kpi-value ${flotaTaller>0?'warn':'ok'}">${flotaOk}/${flotaTotal}</div>
          <div class="kpi-trend">${flotaTaller>0?flotaTaller+' en taller':'Toda operativa'}${flotaWarn>0?' · '+flotaWarn+' con alerta':''}</div>
        </div>
      </div>

      <div class="two-col" style="margin-bottom:20px">

        <!-- Vehículos sin checklist -->
        <div class="card">
          <div class="card-title" style="display:flex;justify-content:space-between">
            <span>🚛 Sin checklist hoy</span>
            <span style="color:var(--text3);font-size:11px;font-weight:400">${d.sin_checklist_count} unidades</span>
          </div>
          ${d.sin_checklist_count === 0
            ? '<div style="color:var(--ok);font-size:13px">✓ Todos los vehículos activos hicieron checklist</div>'
            : `<div style="max-height:200px;overflow-y:auto">
                ${d.sin_checklist.map(v=>`
                  <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
                    <span><b>${v.code}</b> ${v.plate}</span>
                    <span style="color:var(--text3)">${v.driver_name||'Sin chofer'}</span>
                  </div>`).join('')}
               </div>`
          }
        </div>

        <!-- Novedades abiertas -->
        <div class="card">
          <div class="card-title" style="display:flex;justify-content:space-between">
            <span>⚠️ Novedades abiertas</span>
            <span style="color:var(--text3);font-size:11px;font-weight:400">${d.novedades_count} pendientes</span>
          </div>
          ${d.novedades_count === 0
            ? '<div style="color:var(--ok);font-size:13px">✓ Sin novedades abiertas</div>'
            : `<div style="max-height:200px;overflow-y:auto">
                ${d.novedades_abiertas.map(o=>`
                  <div style="padding:7px 0;border-bottom:1px solid var(--border);font-size:13px">
                    <div style="display:flex;justify-content:space-between">
                      <b>${o.vehicle_code||'—'}</b>
                      <span class="badge ${o.priority==='critica'?'badge-danger':o.priority==='urgente'?'badge-warn':'badge-info'}">${o.priority||'normal'}</span>
                    </div>
                    <div style="color:var(--text3);font-size:12px;margin-top:2px">${(o.description||'').substring(0,60)}${o.description?.length>60?'...':''}</div>
                  </div>`).join('')}
               </div>`
          }
        </div>
      </div>

      <!-- Checklists del día con detalle -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-title">📋 Checklists de hoy — detalle</div>
        ${d.checklists_count === 0
          ? '<div style="color:var(--text3);font-size:13px">No se realizaron checklists hoy.</div>'
          : `<div class="table-wrap"><table>
              <thead><tr><th>Hora</th><th>Unidad</th><th>Chofer</th><th>Km</th><th>Estado</th><th>Obs.</th></tr></thead>
              <tbody>${d.checklists_hoy.map(c=>`<tr>
                <td class="td-mono" style="font-size:11px">${c.created_at?.slice(11,16)||'—'}</td>
                <td class="td-main">${c.vehicle_code||'—'}</td>
                <td>${c.driver_name||'—'}</td>
                <td class="td-mono">${c.km_at_check?.toLocaleString()||'—'}</td>
                <td><span class="badge ${c.all_ok?'badge-ok':'badge-warn'}">${c.all_ok?'✓ OK':'⚠ Con prob.'}</span></td>
                <td style="font-size:11px;color:var(--text3)">${c.observations?c.observations.substring(0,40)+'...':'—'}</td>
              </tr>`).join('')}</tbody>
            </table></div>`
        }
      </div>

      <!-- Cargas del día -->
      <div class="card">
        <div class="card-title">⛽ Cargas de combustible hoy</div>
        ${d.cargas_count === 0
          ? '<div style="color:var(--text3);font-size:13px">Sin cargas registradas hoy.</div>'
          : `<div class="table-wrap"><table>
              <thead><tr><th>Hora</th><th>Unidad</th><th>Tipo</th><th>Litros</th><th>Lugar</th><th>Ticket</th></tr></thead>
              <tbody>${d.cargas_hoy.map(f=>`<tr>
                <td class="td-mono" style="font-size:11px">${f.logged_at?.slice(11,16)||'—'}</td>
                <td class="td-main">${f.vehicle_code||'—'}</td>
                <td><span class="badge ${f.fuel_type==='urea'?'badge-info':'badge-ok'}" style="font-size:10px">${f.fuel_type==='urea'?'Urea':'Gasoil'}</span></td>
                <td class="td-mono">${parseFloat(f.liters||0).toFixed(0)} L</td>
                <td>${f.location||'—'}</td>
                <td>${f.ticket_image?'<span style="color:var(--ok)">✓ Sí</span>':'<span style="color:var(--text3)">No</span>'}</td>
              </tr>`).join('')}</tbody>
            </table></div>`
        }
      </div>
    `;
  } catch(err) {
    el.innerHTML = `<div style="color:var(--warn);padding:20px">Error al cargar el resumen: ${err.message}</div>`;
  }
}

// ── PANEL CONTADOR ──
function renderContadorPanel() {
  if (!window._contadorMes) {
    const now = new Date();
    window._contadorMes = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  }
  _buildContadorPanel(window._contadorMes);
}

function _buildContadorPanel(mesStr) {
  window._contadorMes = mesStr;
  const [yr, mo] = mesStr.split('-').map(Number);
  const mesLabel = new Date(yr, mo-1, 1).toLocaleString('es-AR', { month:'long', year:'numeric' });

  const fuelMes = App.data.fuelLogs.filter(f => {
    const d = new Date(f.date); return d.getFullYear()===yr && d.getMonth()+1===mo;
  });
  const otsMes = App.data.workOrders.filter(o => {
    if (o.status !== 'Cerrada') return false;
    const d = new Date(o.closed_at || o.date); return d.getFullYear()===yr && d.getMonth()+1===mo;
  });

  const totalCombustible = fuelMes.reduce((a,f) => a + (f.liters * f.ppu), 0);
  const totalLitros      = fuelMes.reduce((a,f) => a + f.liters, 0);
  const totalOTs         = otsMes.reduce((a,o) => a + ((o.labor_cost||0) + (o.parts_cost||0)), 0);
  const totalMano        = otsMes.reduce((a,o) => a + (o.labor_cost||0), 0);
  const totalRepuestos   = otsMes.reduce((a,o) => a + (o.parts_cost||0), 0);
  const totalGeneral     = totalCombustible + totalOTs;

  const byVeh = {};
  App.data.vehicles.forEach(v => {
    byVeh[v.code] = { code:v.code, brand:v.brand, model:v.model, combustible:0, litros:0, mano:0, repuestos:0, ots:0 };
  });
  fuelMes.forEach(f => {
    if (!byVeh[f.vehicle]) byVeh[f.vehicle] = { code:f.vehicle, brand:'—', model:'', combustible:0, litros:0, mano:0, repuestos:0, ots:0 };
    byVeh[f.vehicle].combustible += f.liters * f.ppu;
    byVeh[f.vehicle].litros      += f.liters;
  });
  otsMes.forEach(o => {
    const vc = o.vehicle_code || o.vehicle || '';
    if (!byVeh[vc]) byVeh[vc] = { code:vc, brand:'—', model:'', combustible:0, litros:0, mano:0, repuestos:0, ots:0 };
    byVeh[vc].mano      += o.labor_cost || 0;
    byVeh[vc].repuestos += o.parts_cost || 0;
    byVeh[vc].ots++;
  });
  const rows = Object.values(byVeh)
    .map(v => ({ ...v, total: v.combustible + v.mano + v.repuestos }))
    .filter(v => v.total > 0)
    .sort((a,b) => b.total - a.total);

  const meses = [];
  for (let i=0; i<12; i++) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-i);
    const val = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const lbl = d.toLocaleString('es-AR',{month:'long',year:'numeric'});
    meses.push(`<option value="${val}" ${val===mesStr?'selected':''}>${lbl.charAt(0).toUpperCase()+lbl.slice(1)}</option>`);
  }

  const rowsHTML = rows.map(v => {
    const pct = totalGeneral > 0 ? (v.total/totalGeneral*100).toFixed(1) : 0;
    return `<tr>
      <td class="td-mono td-main">${v.code}</td>
      <td>${v.brand} ${v.model}</td>
      <td class="td-mono" style="color:#3b82f6">${v.combustible>0?'$'+Math.round(v.combustible).toLocaleString('es-AR'):'—'}</td>
      <td class="td-mono" style="color:#3b82f6">${v.litros>0?Math.round(v.litros).toLocaleString()+' L':'—'}</td>
      <td class="td-mono" style="color:#f59e0b">${v.mano>0?'$'+Math.round(v.mano).toLocaleString('es-AR'):'—'}</td>
      <td class="td-mono" style="color:#f59e0b">${v.repuestos>0?'$'+Math.round(v.repuestos).toLocaleString('es-AR'):'—'}</td>
      <td class="td-mono">${v.ots||'—'}</td>
      <td class="td-mono" style="font-weight:700">$${Math.round(v.total).toLocaleString('es-AR')}</td>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div style="width:60px;height:6px;background:var(--border2);border-radius:3px">
          <div style="width:${Math.min(pct,100)}%;height:100%;background:var(--accent);border-radius:3px"></div>
        </div>
        <span style="font-size:12px;color:var(--text3)">${pct}%</span>
      </div></td>
    </tr>`;
  }).join('');

  const emptyMsg = '<div style="padding:32px;text-align:center;color:var(--text3)">Sin movimientos registrados en este mes</div>';

  document.getElementById('page-contador_panel').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div class="section-title" style="margin:0">📊 Panel contable — ${mesLabel.charAt(0).toUpperCase()+mesLabel.slice(1)}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="form-select" style="width:220px" onchange="_buildContadorPanel(this.value)">${meses.join('')}</select>
        <button class="btn btn-secondary btn-sm" onclick="_exportContadorCSV('${mesStr}')">⬇ Exportar CSV</button>
      </div>
    </div>
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card info">
        <div class="kpi-label">💰 Costo total del mes</div>
        <div class="kpi-value white">$${Math.round(totalGeneral).toLocaleString('es-AR')}</div>
        <div class="kpi-trend">combustible + mantenimiento</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(59,130,246,.4)">
        <div class="kpi-label">⛽ Combustible</div>
        <div class="kpi-value" style="color:#3b82f6">$${Math.round(totalCombustible).toLocaleString('es-AR')}</div>
        <div class="kpi-trend">${Math.round(totalLitros).toLocaleString()} L · ${fuelMes.length} cargas</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(245,158,11,.4)">
        <div class="kpi-label">🔧 Mantenimiento</div>
        <div class="kpi-value" style="color:#f59e0b">$${Math.round(totalOTs).toLocaleString('es-AR')}</div>
        <div class="kpi-trend">mano $${Math.round(totalMano).toLocaleString()} · repuestos $${Math.round(totalRepuestos).toLocaleString()}</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(168,85,247,.4)">
        <div class="kpi-label">📋 OTs cerradas</div>
        <div class="kpi-value" style="color:#a855f7">${otsMes.length}</div>
        <div class="kpi-trend">${rows.length} unidades con movimiento</div>
      </div>
    </div>
    <div class="card" style="padding:0">
      <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border2)">
        <div class="card-title" style="margin:0">Desglose por unidad</div>
      </div>
      ${rows.length === 0 ? emptyMsg : `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Unidad</th><th>Marca / Modelo</th>
            <th style="color:#3b82f6">Combustible</th><th style="color:#3b82f6">Litros</th>
            <th style="color:#f59e0b">Mano obra</th><th style="color:#f59e0b">Repuestos</th>
            <th>OTs</th><th>Total</th><th>% del mes</th>
          </tr></thead>
          <tbody>${rowsHTML}</tbody>
          <tfoot><tr style="font-weight:700;border-top:2px solid var(--border2)">
            <td colspan="2" style="padding:12px 16px">TOTAL</td>
            <td class="td-mono" style="color:#3b82f6">$${Math.round(totalCombustible).toLocaleString('es-AR')}</td>
            <td class="td-mono" style="color:#3b82f6">${Math.round(totalLitros).toLocaleString()} L</td>
            <td class="td-mono" style="color:#f59e0b">$${Math.round(totalMano).toLocaleString('es-AR')}</td>
            <td class="td-mono" style="color:#f59e0b">$${Math.round(totalRepuestos).toLocaleString('es-AR')}</td>
            <td class="td-mono">${otsMes.length}</td>
            <td class="td-mono" style="font-weight:700">$${Math.round(totalGeneral).toLocaleString('es-AR')}</td>
            <td></td>
          </tr></tfoot>
        </table>
      </div>`}
    </div>`;
}

function _exportContadorCSV(mesStr) {
  const [yr, mo] = mesStr.split('-').map(Number);
  const fuelMes = App.data.fuelLogs.filter(f => { const d=new Date(f.date); return d.getFullYear()===yr && d.getMonth()+1===mo; });
  const otsMes  = App.data.workOrders.filter(o => { if(o.status!=='Cerrada') return false; const d=new Date(o.closed_at||o.date); return d.getFullYear()===yr && d.getMonth()+1===mo; });
  const byVeh = {};
  fuelMes.forEach(f => { if(!byVeh[f.vehicle]) byVeh[f.vehicle]={combustible:0,litros:0,mano:0,repuestos:0}; byVeh[f.vehicle].combustible+=f.liters*f.ppu; byVeh[f.vehicle].litros+=f.liters; });
  otsMes.forEach(o  => { const vc=o.vehicle_code||o.vehicle||''; if(!byVeh[vc]) byVeh[vc]={combustible:0,litros:0,mano:0,repuestos:0}; byVeh[vc].mano+=o.labor_cost||0; byVeh[vc].repuestos+=o.parts_cost||0; });
  let csv = 'Unidad,Combustible ($),Litros,Mano de obra ($),Repuestos ($),Total ($)\n';
  Object.entries(byVeh).sort((a,b)=>(b[1].combustible+b[1].mano+b[1].repuestos)-(a[1].combustible+a[1].mano+a[1].repuestos)).forEach(([code,v]) => {
    const total = v.combustible+v.mano+v.repuestos;
    if(total>0) csv += `${code},${Math.round(v.combustible)},${Math.round(v.litros)},${Math.round(v.mano)},${Math.round(v.repuestos)},${Math.round(total)}\n`;
  });
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download=`costos-${mesStr}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast('ok','CSV descargado');
}


// ── FUNCIONES FALTANTES ──────────────────────────────────────────────────────

function openNewVehicleModal() {
  openModal('Registrar nueva unidad', `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Código interno</label><input class="form-input" placeholder="Ej: INT-46" id="nv-code"></div>
      <div class="form-group"><label class="form-label">Patente</label><input class="form-input" placeholder="Ej: ABC 001" id="nv-plate"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Marca</label><input class="form-input" placeholder="Ej: Mercedes-Benz" id="nv-brand"></div>
      <div class="form-group"><label class="form-label">Modelo</label><input class="form-input" placeholder="Ej: Actros 2651" id="nv-model"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Año</label><input class="form-input" type="number" placeholder="Ej: 2019" id="nv-year"></div>
      <div class="form-group"><label class="form-label">Tipo</label>
        <select class="form-select" id="nv-type">
          ${(App.config?.vehicle_types||['tractor','camion','semirremolque','acoplado','utilitario','autoelevador']).map(t=>`<option value="${t}">${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Km actuales</label><input class="form-input" type="number" placeholder="Ej: 250000" id="nv-km"></div>
      <div class="form-group"><label class="form-label">Base operativa</label>
        <select class="form-select" id="nv-base">
          ${(App.config?.bases||['Central','Norte','Sur']).map(b=>`<option value="${b}">${b}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Chofer habitual</label><input class="form-input" placeholder="Ej: Juan Pérez" id="nv-driver"></div>
      <div class="form-group"><label class="form-label">Estado</label>
        <select class="form-select" id="nv-status">
          <option value="ok">Operativo</option>
          <option value="warn">Con alerta</option>
          <option value="taller">En taller</option>
          <option value="detenida">Detenida</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">VIN / Chasis</label><input class="form-input" placeholder="Ej: 9BM..." id="nv-vin"></div>
      <div class="form-group"><label class="form-label">Número de motor</label><input class="form-input" placeholder="Ej: OM471..." id="nv-engine"></div>
    </div>
    <div class="form-group"><label class="form-label">Centro de costo</label><input class="form-input" placeholder="Ej: CC-01" id="nv-cc"></div>
  `, [
    { label: 'Registrar unidad', cls: 'btn-primary',   fn: saveNewVehicle },
    { label: 'Cancelar',         cls: 'btn-secondary', fn: closeModal }
  ]);
}

async function saveNewVehicle() {
  const code   = (document.getElementById('nv-code')?.value   || '').trim();
  const plate  = (document.getElementById('nv-plate')?.value  || '').trim();
  const brand  = (document.getElementById('nv-brand')?.value  || '').trim();
  const model  = (document.getElementById('nv-model')?.value  || '').trim();
  const year   = parseInt(document.getElementById('nv-year')?.value)  || new Date().getFullYear();
  const km     = parseInt(document.getElementById('nv-km')?.value)    || 0;
  const type   = document.getElementById('nv-type')?.value            || 'camion';
  const base   = document.getElementById('nv-base')?.value            || 'Central';
  const driver = (document.getElementById('nv-driver')?.value || '').trim();
  const status = document.getElementById('nv-status')?.value          || 'ok';
  const vin    = (document.getElementById('nv-vin')?.value    || '').trim();
  const engine = (document.getElementById('nv-engine')?.value || '').trim();
  const cc     = (document.getElementById('nv-cc')?.value     || '').trim();

  if (!code)  { showToast('error', 'El código interno es obligatorio'); return; }
  if (!plate) { showToast('error', 'La patente es obligatoria'); return; }
  if (!brand || !model) { showToast('error', 'Marca y modelo son obligatorios'); return; }

  const res = await apiFetch('/api/vehicles', {
    method: 'POST',
    body: JSON.stringify({ code, plate, brand, model, year, type, base, km_current: km,
                           driver, status, vin, engine_no: engine, cost_center: cc })
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error || 'Error al registrar unidad'); return; }

  const newV = await res.json();
  // Agregar directamente a App.data usando datos del servidor
  if (!App.data.vehicles) App.data.vehicles = [];
  App.data.vehicles.push({
    id: newV.id, code: newV.code, plate: newV.plate, brand: newV.brand,
    model: newV.model, year: newV.year, type: newV.type,
    base: newV.base || base, status: newV.status || status,
    km: newV.km_current || km,
    driver: newV.driver_name || driver || '—',
    vin: newV.vin, engine_no: newV.engine_no, cost_center: newV.cost_center,
    cost_km: 0, gps_status: 'unknown', tech_spec: {}
  });
  closeModal();
  showToast('ok', `Unidad ${code} registrada correctamente`);
  renderFleet();
  renderDashboard();
  // Refrescar en background para sincronizar con DB
  loadInitialData().then(()=>{ renderFleet(); renderDashboard(); });
}

function openNewOTModal(preselectedVehicle) {
  const vehicleOpts = (App.data.vehicles || [])
    .map(v => `<option value="${v.id||v._id}" ${preselectedVehicle===v.code?'selected':''}>${v.code} — ${v.brand} ${v.model} (${v.plate})</option>`)
    .join('');

  openModal('Nueva orden de trabajo', `
    <div class="form-group">
      <label class="form-label">Unidad</label>
      <select class="form-select" id="ot-vehicle">
        <option value="">— Seleccioná una unidad —</option>
        ${vehicleOpts}
      </select>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Tipo</label>
        <select class="form-select" id="ot-type">
          <option value="Correctivo">Correctivo</option>
          <option value="Preventivo">Preventivo</option>
          <option value="Predictivo">Predictivo</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Prioridad</label>
        <select class="form-select" id="ot-priority">
          <option value="Normal">Normal</option>
          <option value="Media">Media</option>
          <option value="Urgente">Urgente</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label class="form-label">Título / Descripción del trabajo</label>
      <input class="form-input" placeholder="Ej: Cambio de aceite y filtros" id="ot-title">
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Mecánico asignado</label>
        <input class="form-input" placeholder="Nombre del mecánico" id="ot-assigned">
      </div>
      <div class="form-group"><label class="form-label">Fecha límite</label>
        <input class="form-input" type="date" id="ot-due">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Mano de obra ($)</label>
        <input class="form-input" type="number" placeholder="0" id="ot-labor">
      </div>
    </div>
    <div class="form-group"><label class="form-label">Notas adicionales</label>
      <textarea class="form-input" rows="3" placeholder="Observaciones, síntomas, instrucciones..." id="ot-notes" style="resize:vertical"></textarea>
    </div>
  `, [
    { label: 'Crear OT', cls: 'btn-primary',   fn: saveNewOT },
    { label: 'Cancelar', cls: 'btn-secondary', fn: closeModal }
  ]);
}

async function syncGPSNow(btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Sincronizando...'; }
  try {
    // Recargar vehículos con datos actualizados
    const res = await apiFetch('/api/vehicles');
    if (res.ok) {
      const vehicles = await res.json();
      // Mapear igual que en loadInitialData
      App.data.vehicles = vehicles.map(v => ({
        id: v.id, code: v.code, plate: v.plate, brand: v.brand, model: v.model,
        year: v.year, type: v.type, status: v.status || 'ok',
        km: v.km_current || 0, base: v.base || 'Central',
        driver: v.driver_name || '—', cost_km: parseFloat(v.cost_km) || 0,
        vin: v.vin, engine_no: v.engine_no, cost_center: v.cost_center,
        driver_id: v.driver_id,
        gps_lat: parseFloat(v.gps_lat) || null,
        gps_lng: parseFloat(v.gps_lng) || null,
        gps_speed: parseFloat(v.gps_speed) || 0,
        gps_status: v.gps_status || 'unknown',
        gps_updated: v.gps_updated_at || null,
        tech_spec: v.tech_spec || {},
      }));
      renderFleet();
      renderDashboard();
      showToast('ok', `Datos actualizados — ${App.data.vehicles.length} unidades`);
    } else {
      showToast('warn', 'No se pudieron actualizar los datos');
    }
  } catch(e) {
    showToast('warn', 'Error al sincronizar');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '⚡ Sync GPS'; }
  }
}

function openEditTechSpecModal(id) {
  const v = App.data.vehicles.find(x => x.id === id);
  if (!v) return;
  const spec = getTechSpec(v.brand, v.model, v.type);
  const saved = v.tech_spec || {};
  const merged = Object.assign({}, spec, saved);
  const fields = [
    { key:'engine',              label:'Motor' },
    { key:'power',               label:'Potencia / Torque' },
    { key:'transmission',        label:'Transmisión / Caja' },
    { key:'differential',        label:'Diferencial' },
    { key:'urea',                label:'Usa urea / AdBlue' },
    { key:'fuel_cap',            label:'Capacidad combustible' },
    { key:'tire_size',           label:'Medida cubiertas' },
    { key:'tire_pressure_steer', label:'Presión dirección' },
    { key:'tire_pressure_drive', label:'Presión tracción' },
    { key:'wheel_torque',        label:'Torque de ruedas' },
    { key:'battery',             label:'Baterías' },
    { key:'grease',              label:'Puntos de engrase' },
  ];
  openModal(`Editar ficha técnica — ${v.code}`, `
    <div style="margin-bottom:12px;font-size:12px;color:var(--text3)">
      Los datos del fabricante se cargan como base. Podés modificar cualquier campo para este vehículo específico.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${fields.map(f => `
        <div class="form-group" style="margin:0">
          <label class="form-label">${f.label}</label>
          <input class="form-input" id="ts-${f.key}" value="${(merged[f.key]||'').replace(/"/g,'&quot;')}" placeholder="${spec[f.key]||''}">
        </div>`).join('')}
    </div>
    <div style="margin-top:12px;padding:10px 12px;background:var(--bg3);border-radius:var(--radius);font-size:11px;color:var(--text3)">
      💡 Los campos marcados en azul son datos que ya modificaste antes. Los demás vienen del fabricante.
    </div>
  `, [
    { label: 'Guardar ficha', cls: 'btn-primary',   fn: () => saveTechSpec(id) },
    { label: 'Restaurar fábrica', cls: 'btn-secondary', fn: () => resetTechSpec(id) },
    { label: 'Cancelar',      cls: 'btn-secondary', fn: () => showVehicleFicha(id, 'tecnica') },
  ]);
}

async function saveTechSpec(id) {
  const fields = ['engine','power','transmission','differential','urea','fuel_cap',
                  'tire_size','tire_pressure_steer','tire_pressure_drive','wheel_torque','battery','grease'];
  const data = {};
  fields.forEach(k => {
    const val = document.getElementById('ts-' + k)?.value?.trim();
    if (val) data[k] = val;
  });
  const res = await apiFetch(`/api/vehicles/${id}/techspec`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error || 'Error al guardar'); return; }
  const updated = await res.json();
  // Actualizar en App.data
  const v = App.data.vehicles.find(x => x.id === id);
  if (v) v.tech_spec = updated.tech_spec;
  closeModal();
  showToast('ok', 'Ficha técnica guardada correctamente');
  showVehicleFicha(id, 'tecnica');
}

async function resetTechSpec(id) {
  const res = await apiFetch(`/api/vehicles/${id}/techspec`, {
    method: 'PATCH',
    body: JSON.stringify({})
  });
  if (!res.ok) return;
  const v = App.data.vehicles.find(x => x.id === id);
  if (v) v.tech_spec = {};
  closeModal();
  showToast('ok', 'Ficha técnica restaurada a datos de fábrica');
  showVehicleFicha(id, 'tecnica');
}

function renderConfig() {
  const bases  = (App.config?.bases  || ['Central','Norte','Sur']);
  const vtypes = (App.config?.vehicle_types || ['tractor','camion','semirremolque','acoplado','utilitario','autoelevador']);
  document.getElementById('page-config').innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Configuración del sistema</div>
        <div class="section-sub">Bases operativas y tipos de vehículos</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:900px">

      <!-- BASES -->
      <div class="card">
        <div class="card-title">Bases / Centrales operativas</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:14px">Estas son las bases que aparecen en el formulario de vehículos.</div>
        <div id="cfg-bases-list" style="margin-bottom:12px">
          ${bases.map((b,i)=>`
            <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
              <input class="form-input" value="${b}" id="cfg-base-${i}" style="flex:1">
              <button class="btn btn-secondary btn-sm" onclick="removeCfgBase(${i})" style="color:var(--danger)">✕</button>
            </div>`).join('')}
        </div>
        <button class="btn btn-secondary btn-sm" onclick="addCfgBase()" style="margin-bottom:16px">+ Agregar base</button>
        <button class="btn btn-primary" onclick="saveConfig()">Guardar cambios</button>
      </div>

      <!-- TIPOS DE VEHÍCULO -->
      <div class="card">
        <div class="card-title">Tipos de vehículos</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:14px">Los autoelevadores usan horas en lugar de km.</div>
        <div id="cfg-types-list" style="margin-bottom:12px">
          ${vtypes.map((t,i)=>`
            <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
              <input class="form-input" value="${t}" id="cfg-type-${i}" style="flex:1">
              <button class="btn btn-secondary btn-sm" onclick="removeCfgType(${i})" style="color:var(--danger)">✕</button>
            </div>`).join('')}
        </div>
        <button class="btn btn-secondary btn-sm" onclick="addCfgType()" style="margin-bottom:16px">+ Agregar tipo</button>
        <button class="btn btn-primary" onclick="saveConfig()">Guardar cambios</button>
      </div>

    </div>`;
}

function addCfgBase() {
  const list = document.getElementById('cfg-bases-list');
  const i = list.querySelectorAll('input').length;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center';
  div.innerHTML = `<input class="form-input" placeholder="Nombre de la base" id="cfg-base-${i}" style="flex:1">
    <button class="btn btn-secondary btn-sm" onclick="this.parentElement.remove()" style="color:var(--danger)">✕</button>`;
  list.appendChild(div);
}

function removeCfgBase(i) {
  document.getElementById('cfg-base-'+i)?.closest('div')?.remove();
}

function addCfgType() {
  const list = document.getElementById('cfg-types-list');
  const i = list.querySelectorAll('input').length;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center';
  div.innerHTML = `<input class="form-input" placeholder="Ej: autoelevador" id="cfg-type-${i}" style="flex:1">
    <button class="btn btn-secondary btn-sm" onclick="this.parentElement.remove()" style="color:var(--danger)">✕</button>`;
  list.appendChild(div);
}

function removeCfgType(i) {
  document.getElementById('cfg-type-'+i)?.closest('div')?.remove();
}

async function saveConfig() {
  const bases  = Array.from(document.querySelectorAll('[id^="cfg-base-"]')).map(el=>el.value.trim()).filter(Boolean);
  const vtypes = Array.from(document.querySelectorAll('[id^="cfg-type-"]')).map(el=>el.value.trim()).filter(Boolean);
  if (!bases.length)  { showToast('error','Necesitás al menos una base'); return; }
  if (!vtypes.length) { showToast('error','Necesitás al menos un tipo de vehículo'); return; }
  const res = await apiFetch('/api/config', { method:'PUT', body: JSON.stringify({ bases, vehicle_types: vtypes }) });
  if (!res.ok) { showToast('error','Error al guardar configuración'); return; }
  App.config.bases = bases;
  App.config.vehicle_types = vtypes;
  showToast('ok', 'Configuración guardada correctamente');
  renderConfig();
}

function openAccountConfigModal() {
  if (!userHasRole('dueno')) { showToast('error', 'Solo el dueño puede acceder a la configuración'); return; }
  const bases  = App.config?.bases  || ['Central'];
  const vtypes = App.config?.vehicle_types || ['tractor','camion','semirremolque'];

  openModal('⚙ Configuración de la cuenta', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div>
        <div style="font-weight:600;color:var(--text);margin-bottom:10px;font-size:13px">🏢 Bases / Centrales operativas</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Aparecen en el formulario de vehículos.</div>
        <div id="cfg-bases-list">
          ${bases.map((b,i)=>`
            <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
              <input class="form-input" value="${b}" id="cfg-base-${i}" style="flex:1">
              <button class="btn btn-secondary btn-sm" onclick="this.parentElement.remove()" style="color:var(--danger);padding:4px 8px">✕</button>
            </div>`).join('')}
        </div>
        <button class="btn btn-secondary btn-sm" onclick="addCfgBase()" style="margin-top:4px">+ Agregar base</button>
      </div>
      <div>
        <div style="font-weight:600;color:var(--text);margin-bottom:10px;font-size:13px">🚛 Tipos de vehículos</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Los autoelevadores usan horas en lugar de km.</div>
        <div id="cfg-types-list">
          ${vtypes.map((t,i)=>`
            <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
              <input class="form-input" value="${t}" id="cfg-type-${i}" style="flex:1">
              <button class="btn btn-secondary btn-sm" onclick="this.parentElement.remove()" style="color:var(--danger);padding:4px 8px">✕</button>
            </div>`).join('')}
        </div>
        <button class="btn btn-secondary btn-sm" onclick="addCfgType()" style="margin-top:4px">+ Agregar tipo</button>
      </div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--bg3);border-radius:var(--radius);font-size:11px;color:var(--text3)">
      🔒 Esta configuración solo es visible para el rol <strong>Dueño / Dirección</strong>.
    </div>
  `, [
    { label: '💾 Guardar cambios', cls: 'btn-primary',   fn: saveConfig },
    { label: 'Cancelar',           cls: 'btn-secondary', fn: closeModal },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Asegurar que el modal esté cerrado al iniciar
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.style.display = 'none';
  }
  if (typeof initLogin === 'function') {
    initLogin();
  }
});
