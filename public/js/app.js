// ═══════════════════════════════════════════
//  FleetOS — Motor de datos y lógica central
// ═══════════════════════════════════════════

// ── HELPERS DE FECHA/HORA EN ZONA HORARIA ARGENTINA ──
// Resuelve el bug de que toISOString() devuelve UTC (3h adelante).
// Todos los inputs type=date y los timestamps visibles deben usar estos helpers.

// YYYY-MM-DD en zona horaria Argentina
function todayISO() {
  if (window.FleetTime?.dateInputAR) return window.FleetTime.dateInputAR();
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
}

// YYYY-MM-DDTHH:MM para inputs datetime-local en Argentina
function nowDatetimeLocal() {
  if (window.FleetTime?.datetimeLocalAR) return window.FleetTime.datetimeLocalAR();
  const p = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Argentina/Buenos_Aires', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false, hourCycle:'h23' }).formatToParts(new Date()).reduce((a,x)=>(a[x.type]=x.value,a),{});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// Hora "HH:MM" en formato argentino
function nowTimeAR() {
  if (window.FleetTime?.timeAR) return window.FleetTime.timeAR();
  return new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
}

// Fecha "DD/MM/YYYY" en formato argentino
function nowDateAR() {
  if (window.FleetTime?.dateDisplayAR) return window.FleetTime.dateDisplayAR();
  return new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function fleetNowIsoAR() {
  return window.FleetTime?.isoAR ? window.FleetTime.isoAR() : new Date().toISOString();
}

function fleetDateTimeAR(value) {
  if (!value) return '—';
  const txt = String(value).trim();
  const m = txt.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  // Si el backend ya manda hora argentina sin offset en *_ar, no la volvemos a convertir.
  if (m && !/[zZ]|[+-]\d{2}:?\d{2}/.test(txt.slice(10))) {
    return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  }
  if (window.FleetTime?.dateTimeDisplayAR) return window.FleetTime.dateTimeDisplayAR(value);
  const d = new Date(txt.includes(' ') ? txt.replace(' ', 'T') : txt);
  if (isNaN(d.getTime())) return txt.slice(0,16).replace('T',' ');
  return new Intl.DateTimeFormat('es-AR', { timeZone:'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(d).replace(',', '');
}

function fleetDisplayAR(value) {
  if (!value) return '—';
  const txt = String(value).trim();
  const m = txt.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m && !/[zZ]|[+-]\d{2}:?\d{2}/.test(txt.slice(10))) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  if (window.FleetTime?.displayAR) return window.FleetTime.displayAR(value);
  return fleetDateTimeAR(value);
}

function fleetYmdCompactAR(value) {
  if (window.FleetTime?.ymdCompactAR) return window.FleetTime.ymdCompactAR(value);
  const txt = String(value || fleetNowIsoAR()).trim();
  const m = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  return todayISO().replace(/-/g,'');
}

// Exponer globalmente por si otros archivos las necesitan
window.todayISO = todayISO;
window.nowDatetimeLocal = nowDatetimeLocal;
window.nowTimeAR = nowTimeAR;
window.nowDateAR = nowDateAR;
window.fleetDateTimeAR = window.fleetDateTimeAR || fleetDateTimeAR;
window.fleetDisplayAR = window.fleetDisplayAR || fleetDisplayAR;
window.fleetNowIsoAR = window.fleetNowIsoAR || fleetNowIsoAR;

// ═══════════════════════════════════════════════════════════
//  BRANDING PDF — Identidad visual Expreso Biletta
//  Colores y tipografía oficial usados por TODOS los exportadores.
//  Cambiar acá se refleja en los 10 PDFs del sistema.
// ═══════════════════════════════════════════════════════════
const BILETTA_BRAND = {
  // Naranja corporativo (logo EB)
  orange:      [229, 90, 17],   // #E55A11
  orangeSoft:  [252, 232, 218], // versión clara para fondos alternos
  // Gris oscuro del texto principal
  dark:        [39, 42, 57],    // #272A39
  darkSoft:    [100, 105, 120], // gris medio para subtítulos
  // Neutros
  white:       [255, 255, 255],
  rowAlt:      [250, 248, 246], // crema muy sutil para filas alternas
};

// Dibuja el logo "EB" naranja + "Expreso Biletta" en un doc jsPDF
// x, y = esquina superior izquierda del logo. Devuelve la Y final para seguir abajo.
function _pdfDrawLogo(doc, x, y) {
  const O = BILETTA_BRAND.orange;
  const D = BILETTA_BRAND.dark;
  // Cuadrado naranja con "EB"
  doc.setFillColor(O[0], O[1], O[2]);
  doc.roundedRect(x, y, 32, 32, 5, 5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('EB', x + 16, y + 21, { align: 'center' });
  // Texto "Expreso Biletta" al lado
  doc.setTextColor(D[0], D[1], D[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Expreso Biletta SRL', x + 42, y + 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 105, 120);
  doc.text('Sistema de gestión de flota', x + 42, y + 25);
  return y + 32;
}

// Header estándar de cada PDF exportable: logo + título + subtítulo + fecha generación.
// Devuelve la Y donde puede empezar el contenido siguiente (típicamente autoTable).
function _pdfHeader(doc, titulo, subtitulo) {
  const D = BILETTA_BRAND.dark;
  const O = BILETTA_BRAND.orange;
  // Logo arriba a la izquierda
  _pdfDrawLogo(doc, 40, 30);
  // Título centrado-derecha
  doc.setTextColor(D[0], D[1], D[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(titulo, doc.internal.pageSize.getWidth() - 40, 48, { align: 'right' });
  // Subtítulo
  if (subtitulo) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 105, 120);
    doc.text(subtitulo, doc.internal.pageSize.getWidth() - 40, 62, { align: 'right' });
  }
  // Fecha de generación
  doc.setFontSize(8);
  doc.setTextColor(140, 145, 160);
  doc.text(`Generado el ${nowDateAR()} a las ${nowTimeAR()}`, doc.internal.pageSize.getWidth() - 40, 76, { align: 'right' });
  // Línea divisoria naranja
  doc.setDrawColor(O[0], O[1], O[2]);
  doc.setLineWidth(1.5);
  doc.line(40, 90, doc.internal.pageSize.getWidth() - 40, 90);
  return 110; // Y donde empezar el contenido
}

// Estilo común de autoTable usado por todos los exportadores
function _pdfTableStyle() {
  return {
    styles: { fontSize: 8, cellPadding: 4, textColor: BILETTA_BRAND.dark, lineColor: [230, 230, 230] },
    headStyles: { fillColor: BILETTA_BRAND.dark, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    alternateRowStyles: { fillColor: BILETTA_BRAND.rowAlt },
    footStyles: { fillColor: BILETTA_BRAND.orange, textColor: 255, fontStyle: 'bold', fontSize: 9 },
  };
}

// ── ESTADO GLOBAL ──
const App = {
  currentPage: 'dashboard',
  currentUser: null,
  data: {}
};
// Puente para los ES modules nuevos (Fase 3): App es `const`, así que no queda
// en el global object; lo exponemos explícitamente para que los módulos lo lean.
window.App = App;
// Helper para verificar rol del usuario actual
function userHasRole(...roles) {
  const role = App.currentUser?.role;
  return roles.includes(role);
}

// ── HELPER CENTRAL: refrescar UI después de cualquier acción que modifica datos ──
// Cada "save" del sistema lo llama al final para que nada requiera Ctrl+F5.
// Recarga toda la data desde la API y re-renderiza la página activa.
// Silencioso: si falla, no muestra error (el save ya mostró el toast de éxito).
async function afterSave(options) {
  const opts = options || {};
  try {
    // Recargar toda la data del sistema (vehículos, OTs, stock, etc.)
    if (typeof loadInitialData === 'function') {
      await loadInitialData();
    }
  } catch(e) {
    console.warn('[afterSave] loadInitialData falló (no crítico):', e?.message);
  }
  try {
    // Re-renderizar la página activa (o la que piden explícitamente)
    const page = opts.page || App.currentPage;
    if (typeof renderPage === 'function') {
      renderPage(page);
    }
  } catch(e) {
    console.warn('[afterSave] renderPage falló:', e?.message);
  }
}

// Refresco MANUAL desde el botón de la cabecera. A diferencia de afterSave (silencioso),
// da feedback visual. Sirve de "escape": si alguna vista quedó vieja tras una carga,
// con un clic se recarga la data y se re-renderiza sin perder la sesión (sin Ctrl+F5).
async function manualRefresh(btn) {
  const el = btn || document.getElementById('btn-refresh');
  const prev = el ? el.innerHTML : null;
  if (el) { el.disabled = true; el.innerHTML = '⏳ Actualizando…'; }
  try {
    if (typeof loadInitialData === 'function') await loadInitialData();
    if (typeof renderPage === 'function') renderPage(App.currentPage);
    showToast?.('ok', 'Datos actualizados');
  } catch(e) {
    console.warn('[manualRefresh] falló:', e?.message);
    showToast?.('error', 'No se pudo actualizar. Reintentá.');
  } finally {
    if (el) { el.disabled = false; el.innerHTML = prev || '🔄 Actualizar'; }
  }
}




// usuarios cargados desde la API


window.FleetRoles = {
  dueno:         { code:'dueno',         label:'Dueño / Dirección', modules:['all'] },
  gerencia:      { code:'gerencia',      label:'Gerencia',          modules:['dashboard','fleet','workorders','maintenance','fuel','tires','stock','documents','costs','encargado_panel','contador_panel'] },
  mecanico:      { code:'mecanico',      label:'Mecánico',          modules:['dashboard','fleet','workorders','maintenance','stock','fuel','tires'] },
  contador:      { code:'contador',      label:'Administración',    modules:['dashboard','stock','purchase_orders','suppliers','costs','documents','contador_panel'] },
  gerente_sucursal: { code:'gerente_sucursal', label:'Gerente de sucursal', modules:['dashboard','fleet','workorders','maintenance','fuel','tires','stock','purchase_orders','documents','costs'] },
  compras:       { code:'compras',       label:'Compras',           modules:['dashboard','purchase_orders','suppliers','fuel'] },
  tesoreria:     { code:'tesoreria',     label:'Tesorería',         modules:['dashboard','tesoreria_panel','purchase_orders'] },
  proveedores:   { code:'proveedores',   label:'Proveedores',       modules:['proveedor_panel','suppliers','purchase_orders'] },
  chofer:        { code:'chofer',        label:'Chofer',            modules:['dashboard','fuel','documents','chofer_panel'] }
};

// ── DATOS ── (cargados desde la API por roles.js)
App.data.vehicles    = App.data.vehicles    || [];
App.data.workOrders  = App.data.workOrders  || [];
App.data.fuelLogs    = App.data.fuelLogs    || [];
App.data.fuelDispatches = App.data.fuelDispatches || [];
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
  const t = { home:'Inicio', dashboard:'Panel ejecutivo', fleet:'Flota y vehículos', workorders:'Órdenes de trabajo', fuel:'Combustible y urea', tires:'Cubiertas y neumáticos', stock:'Stock y Depósito', documents:'Documentación', costs:'Costos operativos', maintenance:'Mantenimiento', chofer_panel:'Mi panel', encargado_panel:'Operativo del día', contador_panel:'Panel contable', auditor_panel:'Panel de auditoría', assets:'Activos patrimoniales', proveedor_panel:'Mis Órdenes de Compra', tesoreria_panel:'Pagos / Tesorería' };
  return t[p] || 'FleetOS';
}
function getPageSub(p) {
  const s = { home:'', dashboard:`Vista ejecutiva · Flota ${(App.data.vehicles||[]).length} unidades`, fleet:'Administración y ficha técnica de activos', workorders:'Gestión de intervenciones técnicas', fuel:'Control de cisternas y consumo', tires:'Mapa por eje · trazabilidad', stock:'Stock por sucursal y área · pañoles propios', documents:'Vencimientos y cumplimiento', costs:'Análisis financiero por unidad', maintenance:'Preventivo · predictivo · correctivo', chofer_panel:'Novedades y cargas', encargado_panel:'Checklists · novedades · combustible', contador_panel:'Costos · reportes · KPIs', auditor_panel:'Anomalías · trazabilidad · log de acciones', assets:'Edificios · herramientas · equipos · informática', proveedor_panel:'OCs aprobadas · Cargá las facturas correspondientes', tesoreria_panel:'Facturas pendientes de pago · Vencimientos' };
  return s[p] || '';
}

function renderPage(page) {
  const fns = { home: renderHome, dashboard: renderDashboard, fleet: renderFleet, workorders: renderWorkOrders, fuel: renderFuel, tires: renderTires, stock: renderStock, documents: renderDocuments, costs: renderCosts, maintenance: renderMaintenance, chofer_panel: renderChoferPanel, encargado_panel: renderEncargadoPanel, contador_panel: renderContadorPanel, auditor_panel: renderAuditorPanel, users: renderUsers, config: renderConfig, purchase_orders: renderPurchaseOrders, suppliers: renderSuppliers, assets: renderAssets, proveedor_panel: function(){ if (typeof renderProveedorPanelInline==='function') renderProveedorPanelInline(); }, tesoreria_panel: function(){ if (typeof renderTesoreriaPanelInline==='function') renderTesoreriaPanelInline(); } };
  if (fns[page]) fns[page]();
}

// ── INICIO ──
// Pantalla de bienvenida neutra (logo EB grande, centrado). Es el aterrizaje de
// todos los roles al entrar; no muestra datos sensibles. El panel con gastos/
// totales pasó a llamarse "Panel ejecutivo" (solo Dueño/Gerencia).
function renderHome() {
  const el = document.getElementById('page-home');
  if (!el) return;
  const nombre = (App.currentUser?.name || '').trim();
  el.innerHTML = `
    <div style="min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:18px">
      <div style="width:140px;height:140px;border-radius:28px;background:#ea580c;display:flex;align-items:center;justify-content:center;box-shadow:0 16px 48px rgba(234,88,12,.35)">
        <span style="font-size:64px;font-weight:800;color:#fff;letter-spacing:1px">EB</span>
      </div>
      <div>
        <div style="font-size:30px;font-weight:800;color:var(--text)">Expreso Biletta</div>
        <div style="font-size:14px;color:var(--text3);margin-top:6px">Sistema de gestión de flota — FleetOS</div>
      </div>
      ${nombre ? `<div style="font-size:15px;color:var(--text2);margin-top:4px">👋 Hola, <b>${escapeHtml(nombre)}</b></div>` : ''}
      <div style="font-size:13px;color:var(--text3);margin-top:8px">Elegí una sección en el menú de la izquierda para empezar.</div>
    </div>`;
}

// ── DASHBOARD ──
// Accesos rápidos por rol: tira de botones grandes arriba del dashboard, para que
// los roles operativos (mecánico, pañol, jefe mant.) tengan a mano lo que más usan.
// Solo presentación: reusa navigate(). Dueño/gerencia ya tienen el centro de comando.
function _dashQuickAccess() {
  const role = App.currentUser?.role;
  const map = {
    mecanico: [['🔧','Órdenes de trabajo','workorders'],['📦','Stock / Repuestos','stock'],['🚛','Flota','fleet']],
    jefe_mantenimiento: [['🔧','Órdenes de trabajo','workorders'],['🛒','Órdenes de compra','purchase_orders'],['📦','Stock','stock'],['🚛','Flota','fleet']],
    paniol: [['📦','Stock / Depósito','stock'],['🛒','Órdenes de compra','purchase_orders']],
    gerente_sucursal: [['📦','Stock','stock'],['🛒','Órdenes de compra','purchase_orders'],['🚛','Flota','fleet']],
  };
  const items = map[role];
  if (!items) return '';
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px">
    ${items.map(([icon,label,nav]) => `<button onclick="navigate('${nav}')" style="display:flex;flex-direction:column;align-items:center;gap:6px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow);padding:18px 12px;cursor:pointer;transition:transform .12s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'"><span style="font-size:26px">${icon}</span><span style="font-size:13px;font-weight:600;color:var(--text)">${label}</span></button>`).join('')}
  </div>`;
}

function renderDashboard() {
  const v = App.data.vehicles || [];
  const ok = v.filter(x=>x.status==='ok').length;
  const taller = v.filter(x=>x.status==='taller').length;
  const detenida = v.filter(x=>x.status==='detenida').length;
  const warn = v.filter(x=>x.status==='warn').length;
  const doRate = v.length > 0 ? ((ok+warn)/v.length*100).toFixed(1) : '0';
  const alerts = (App.data.documents||[]).filter(d=>d.status!=='ok').length;

  // ═══ MÉTRICAS PARA PENDIENTES CRÍTICOS ═══
  const dangerDocs  = (App.data.documents||[]).filter(d=>d.status==='danger');
  const warnDocs    = (App.data.documents||[]).filter(d=>d.status==='warn');
  const otsUrgentes = (App.data.workOrders||[]).filter(o => o.priority === 'Urgente' && o.status !== 'Cerrada');
  const otsAbiertas = (App.data.workOrders||[]).filter(o => o.status !== 'Cerrada');
  const stockBajo   = (App.data.stock||[]).filter(s => {
    const cur = parseFloat(s.qty_current ?? s.qty) || 0;
    const min = parseFloat(s.qty_min ?? s.min) || 0;
    return min > 0 && cur <= min;
  });
  const ocsRevision = (App.data.purchaseOrders||[]).filter(p => p.status === 'pendiente_cotizacion' || p.status === 'en_cotizacion');
  const ocsAprobadas = (App.data.purchaseOrders||[]).filter(p => p.status === 'aprobada_compras' || p.status === 'enviada_proveedor' || p.status === 'pagada');
  const fuelObs = (App.data.fuelLogs||[]).filter(f => f.ticket_estado === 'observado');

  // Mantenimientos vencidos (>=95% del intervalo)
  const maintAlerts = v.map(veh => {
    const km = veh.km || 0;
    const ts = veh.tech_spec || {};
    const isFork = isAutoelevador(veh);
    const interval = parseInt(ts.maint_interval_km) || (isFork ? 250 : 15000);
    const pct = interval > 0 ? (km % interval / interval * 100) : 0;
    return { code: veh.code, pct: Math.round(pct), km, interval, unit: isFork ? 'hs' : 'km', nextKm: Math.ceil(km/interval)*interval };
  }).filter(m => m.pct >= 80).sort((a,b) => b.pct - a.pct);
  const maintVencidos = maintAlerts.filter(m => m.pct >= 95);
  const maintProximos = maintAlerts.filter(m => m.pct >= 80 && m.pct < 95);

  // ═══ MÉTRICAS DEL MES ═══
  const ahora = new Date();
  const yr = ahora.getFullYear();
  const mo = ahora.getMonth();
  const enMesActual = (fecha) => {
    if (!fecha) return false;
    const d = new Date(fecha);
    return d.getFullYear() === yr && d.getMonth() === mo;
  };

  const fuelMes = (App.data.fuelLogs||[]).filter(f => enMesActual(f.date));
  const litrosMes = fuelMes.reduce((a,b) => a + (parseFloat(b.liters)||0), 0);
  const combustibleMesCosto = fuelMes.reduce((a,b) => a + ((parseFloat(b.liters)||0) * (parseFloat(b.ppu)||0)), 0);

  const otsCerradasMes = (App.data.workOrders||[]).filter(o =>
    o.status === 'Cerrada' && enMesActual(o.closed_at || o.closed || o.date)
  );
  const costoOTsMes = otsCerradasMes.reduce((a,o) => a + (parseFloat(o.parts_cost)||0) + (parseFloat(o.labor_cost)||0), 0);

  const ocsMes = (App.data.purchaseOrders||[]).filter(p => enMesActual(p.created_at));
  const ocsMesTotal = ocsMes.reduce((a,p) => a + (parseFloat(p.factura_monto) || parseFloat(p.total_estimado) || 0), 0);

  // Total pendientes críticos
  const totalPendientes = dangerDocs.length + otsUrgentes.length + stockBajo.length + ocsRevision.length + maintVencidos.length;

  // ═══ ACTIVIDAD RECIENTE ═══
  const actividad = [];
  (App.data.workOrders||[]).slice(0, 3).forEach(o => {
    if (!o.opened && !o.created_at) return;
    const fecha = new Date(o.opened || o.created_at);
    actividad.push({
      when: fecha,
      icon: '🔧',
      text: `OT <b>${escapeHtml(o.id || o.code)}</b> creada (${o.vehicle || '—'})`,
      action: `navigate('workorders')`,
    });
  });
  (App.data.purchaseOrders||[]).slice(0, 3).forEach(p => {
    if (!p.created_at) return;
    actividad.push({
      when: new Date(p.created_at),
      icon: '🛒',
      text: `OC <b>${escapeHtml(p.code)}</b> · ${escapeHtml(p.proveedor || '—')} · ${p.status}`,
      action: `navigate('purchase_orders')`,
    });
  });
  (App.data.fuelLogs||[]).slice(0, 3).forEach(f => {
    if (!f.date) return;
    actividad.push({
      when: new Date(f.date),
      icon: '⛽',
      text: `Carga <b>${f.vehicle || '—'}</b> · ${f.liters} L · $${(parseFloat(f.total)||0).toLocaleString('es-AR')}`,
      action: `navigate('fuel')`,
    });
  });
  actividad.sort((a,b) => b.when - a.when);
  const actividadReciente = actividad.slice(0, 8);

  // Helper: tiempo transcurrido
  const tiempoAgo = (d) => {
    const diff = (new Date() - d) / 1000;
    if (diff < 60) return 'hace instantes';
    if (diff < 3600) return `hace ${Math.round(diff/60)} min`;
    if (diff < 86400) return `hace ${Math.round(diff/3600)} h`;
    const dias = Math.round(diff/86400);
    if (dias === 1) return 'ayer';
    if (dias < 7) return `hace ${dias} días`;
    return d.toLocaleDateString('es-AR');
  };

  // ═══ Centro de comando: helper de tarjeta (solo presentación) ═══
  const _tones = {
    danger: ['rgba(239,68,68,.12)', 'rgba(239,68,68,.30)', 'var(--danger)'],
    warn:   ['rgba(245,158,11,.12)', 'rgba(245,158,11,.30)', 'var(--warn)'],
    ok:     ['rgba(16,185,129,.10)', 'rgba(16,185,129,.28)', 'var(--ok)'],
    info:   ['rgba(37,99,235,.10)',  'rgba(37,99,235,.28)',  'var(--accent)'],
    muted:  ['var(--bg3)',           'var(--border)',        'var(--text3)'],
  };
  const cmdTile = ({ icon, label, value, sub, tone = 'muted', nav, id }) => {
    const [bg, bd, fg] = _tones[tone] || _tones.muted;
    const click = nav ? `onclick="navigate('${nav}')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'"` : '';
    return `<div ${id ? `id="${id}"` : ''} ${click} style="${nav ? 'cursor:pointer;' : ''}background:${bg};border:1px solid ${bd};border-radius:var(--radius);padding:14px;transition:transform .15s">
      <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px"><span style="font-size:14px">${icon}</span>${label}</div>
      <div style="font-size:26px;font-weight:800;line-height:1;color:${fg}">${value}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:5px">${sub}</div>
    </div>`;
  };
  const verPagos = ['dueno','gerencia','tesoreria'].includes(App.currentUser?.role);

  // ═══ HTML DEL PANEL ═══
  document.getElementById('page-dashboard').innerHTML = `
    ${_dashQuickAccess()}
    <!-- KPIs superiores -->
    <div class="kpi-row" style="margin-bottom:16px">
      <div class="kpi-card ${ok>=v.length?'ok':'warn'}">
        <div class="kpi-label">Unidades operativas</div>
        <div class="kpi-value ${ok>=v.length?'ok':'warn'}">${ok}</div>
        <div class="kpi-trend">de ${v.length} en flota</div>
      </div>
      <div class="kpi-card ${taller+detenida===0?'ok':'warn'}">
        <div class="kpi-label">En taller / detenidas</div>
        <div class="kpi-value ${taller+detenida===0?'ok':'danger'}">${taller+detenida}</div>
        <div class="kpi-trend">${taller} en taller · ${detenida} detenida${detenida===1?'':'s'}</div>
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

    <!-- CENTRO DE COMANDO: indicadores accionables de un vistazo -->
    <div class="card" style="margin-bottom:16px;${totalPendientes > 0 ? 'border-left:4px solid var(--danger)' : 'border-left:4px solid var(--ok)'}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div class="card-title" style="margin:0">🧭 Centro de comando</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">${totalPendientes > 0 ? `${totalPendientes} pendientes críticos` : 'Ningún pendiente crítico ahora mismo'}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
        ${cmdTile({ icon:'🛒', label:'OC por cotizar',      value:ocsRevision.length,  sub:`${ocsAprobadas.length} en curso`,                                tone:ocsRevision.length>0?'warn':'muted', nav:'purchase_orders' })}
        ${cmdTile({ icon:'📦', label:'OC por recibir',      value:ocsAprobadas.length, sub:'aprobadas / enviadas',                                           tone:ocsAprobadas.length>0?'info':'muted', nav:'purchase_orders' })}
        ${cmdTile({ icon:'🔧', label:'OT abiertas',         value:otsAbiertas.length,  sub:`${otsUrgentes.length} urgentes`,                                 tone:otsUrgentes.length>0?'danger':(otsAbiertas.length>0?'info':'ok'), nav:'workorders' })}
        ${cmdTile({ icon:'🚛', label:'Unidades en taller',  value:taller+detenida,     sub:`${taller} taller · ${detenida} detenida${detenida===1?'':'s'}`,  tone:(taller+detenida)>0?'warn':'ok', nav:'fleet' })}
        ${cmdTile({ icon:'📥', label:'Stock crítico',       value:stockBajo.length,    sub:stockBajo.length>0?'necesitan reposición':'abastecido',          tone:stockBajo.length>0?'warn':'ok', nav:'stock' })}
        ${cmdTile({ icon:'⛽', label:'Combustible observado',value:fuelObs.length,      sub:fuelObs.length>0?'tickets a revisar':'sin observaciones',         tone:fuelObs.length>0?'warn':'ok', nav:'fuel' })}
        ${cmdTile({ icon:'📄', label:'Documentos',          value:dangerDocs.length+warnDocs.length, sub:`${dangerDocs.length} vencidos · ${warnDocs.length} por vencer`, tone:dangerDocs.length>0?'danger':(warnDocs.length>0?'warn':'ok'), nav:'documents' })}
        ${cmdTile({ icon:'🛠️', label:'Mantenimiento',        value:maintVencidos.length, sub:`${maintProximos.length} próximos`,                              tone:maintVencidos.length>0?'danger':(maintProximos.length>0?'warn':'ok'), nav:'maintenance' })}
        ${verPagos ? cmdTile({ icon:'🧾', label:'Facturas pendientes', value:'…', sub:'cargando…',          tone:'info',   id:'cmd-fac-pend' }) : ''}
        ${verPagos ? cmdTile({ icon:'⏰', label:'Pagos por vencer',     value:'…', sub:'próximos 7 días',    tone:'warn',   id:'cmd-pag-porvencer' }) : ''}
        ${verPagos ? cmdTile({ icon:'🔴', label:'Pagos vencidos',       value:'…', sub:'facturas atrasadas', tone:'danger', id:'cmd-pag-vencidos' }) : ''}
      </div>
    </div>

    <!-- BLOQUE 2: Mapa de flota + Alertas detalladas -->
    <div class="two-col" style="margin-bottom:16px">
      <div class="card">
        <div class="card-title">Estado de la flota — ${v.length} unidades</div>
        <div class="fleet-grid" id="fleet-grid-mini"></div>
        <div style="display:flex;gap:12px;font-size:11px;color:var(--text3);font-family:var(--mono)">
          <span>● Verde: operativo</span><span>● Naranja: alerta</span><span>● Rojo: taller/detenida</span>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Alertas activas</div>
        <div id="dash-alerts" style="max-height:260px;overflow-y:auto"></div>
      </div>
    </div>

    <!-- BLOQUE 3: NÚMEROS DEL MES -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">📈 Números del mes · ${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][mo]} ${yr}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        <div style="background:var(--bg3);border-radius:var(--radius);padding:12px">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">⛽ Combustible</div>
          <div style="font-size:20px;font-weight:700;color:var(--text);font-family:var(--mono)">$${Math.round(combustibleMesCosto).toLocaleString('es-AR')}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">${Math.round(litrosMes).toLocaleString('es-AR')} L · ${fuelMes.length} cargas</div>
        </div>
        <div style="background:var(--bg3);border-radius:var(--radius);padding:12px">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">🔧 OTs cerradas</div>
          <div style="font-size:20px;font-weight:700;color:var(--text);font-family:var(--mono)">${otsCerradasMes.length}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">Costo: $${Math.round(costoOTsMes).toLocaleString('es-AR')}</div>
        </div>
        <div style="background:var(--bg3);border-radius:var(--radius);padding:12px">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">🛒 OCs del mes</div>
          <div style="font-size:20px;font-weight:700;color:var(--text);font-family:var(--mono)">$${Math.round(ocsMesTotal).toLocaleString('es-AR')}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">${ocsMes.length} órdenes</div>
        </div>
        <div style="background:var(--bg3);border-radius:var(--radius);padding:12px">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">💰 Total gastado</div>
          <div style="font-size:20px;font-weight:700;color:var(--accent);font-family:var(--mono)">$${Math.round(combustibleMesCosto + costoOTsMes).toLocaleString('es-AR')}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">combustible + mantenimiento</div>
        </div>
      </div>
    </div>

    <!-- BLOQUE 4: OTs abiertas + últimas cargas -->
    <div class="two-col" style="margin-bottom:16px">
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

    <!-- BLOQUE 5: OCs recientes + Actividad reciente -->
    <div class="two-col">
      <div class="card">
        <div class="section-header">
          <div><div class="section-title">Órdenes de compra recientes</div></div>
          <button class="btn btn-secondary btn-sm" onclick="navigate('purchase_orders')">Ver todas</button>
        </div>
        <div id="dash-oc"></div>
      </div>
      <div class="card">
        <div class="section-header">
          <div><div class="section-title">📋 Actividad reciente</div></div>
        </div>
        <div id="dash-activity"></div>
      </div>
    </div>

    <!-- ═══ ACTIVIDAD DEL DÍA (fusionado desde el antiguo "Operativo del día") ═══ -->
    <div style="margin-top:32px;padding-top:24px;border-top:2px solid var(--border)">
      <div id="dash-daily-activity"></div>
    </div>
  `;

  // ═══ FLEET GRID ═══
  const grid = document.getElementById('fleet-grid-mini');
  v.forEach(vc => {
    const cls = {ok:'ok',warn:'warn',taller:'danger',detenida:'danger'}[vc.status]||'ok';
    const el = document.createElement('div');
    el.className = `fleet-unit ${cls}`;
    el.textContent = vc.code;
    el.title = `${escapeHtml(vc.code)} — ${escapeHtml(vc.brand||'')} ${escapeHtml(vc.model||'')} — ${(vc.status||'').toUpperCase()}`;
    el.addEventListener('click', () => { navigate('fleet'); setTimeout(()=>filterVehicle(vc.code),100); });
    grid.appendChild(el);
  });

  // ═══ ALERTAS ═══
  const alertsEl = document.getElementById('dash-alerts');
  const detainedVehicles = v.filter(x => x.status === 'detenida');
  let html = '';
  detainedVehicles.forEach(veh => {
    html += `<div class="alert-row danger"><span>⚠</span><span class="alert-text"><b>${escapeHtml(veh.code)}</b> — Unidad detenida en base.</span></div>`;
  });
  dangerDocs.forEach(d => {
    html += `<div class="alert-row danger"><span>⚠</span><span class="alert-text"><b>${d.vehicle||d.displayName||'—'}</b> — ${d.type} vencido (${d.expiry})</span></div>`;
  });
  maintVencidos.forEach(m => {
    html += `<div class="alert-row danger"><span>🔧</span><span class="alert-text"><b>${escapeHtml(m.code)}</b> — Mantenimiento VENCIDO — ${m.km.toLocaleString('es-AR')} / ${m.nextKm.toLocaleString('es-AR')} ${escapeHtml(m.unit)}</span></div>`;
  });
  maintProximos.slice(0,3).forEach(m => {
    html += `<div class="alert-row warn"><span>🔧</span><span class="alert-text"><b>${escapeHtml(m.code)}</b> — Mantenimiento próximo (${m.pct}%) — faltan ${(m.nextKm-m.km).toLocaleString('es-AR')} ${escapeHtml(m.unit)}</span></div>`;
  });
  warnDocs.slice(0,2).forEach(d => {
    const days = Math.ceil((new Date(d.expiry)-new Date())/86400000);
    html += `<div class="alert-row warn"><span>!</span><span class="alert-text"><b>${d.vehicle||d.displayName||'—'}</b> — ${d.type} vence en ${days} días</span></div>`;
  });
  if (!html) html = '<div class="alert-row ok"><span>✓</span><span class="alert-text">Sin alertas críticas activas</span></div>';
  alertsEl.innerHTML = html;

  // ═══ OTs abiertas ═══
  const otEl = document.getElementById('dash-ot');
  const openOT = (App.data.workOrders||[]).filter(o=>o.status!=='Cerrada').slice(0,5);
  otEl.innerHTML = openOT.length === 0
    ? '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px">✓ No hay OTs abiertas</div>'
    : `<table><thead><tr><th>OT</th><th>Vehículo</th><th>Estado</th><th>Prioridad</th></tr></thead><tbody>
      ${openOT.map(o=>`<tr>
        <td class="td-mono">${o.id}</td>
        <td class="td-main">${o.vehicle}</td>
        <td><span class="badge ${o.status==='En proceso'?'badge-info':o.status==='Esperando repuesto'?'badge-warn':'badge-gray'}">${o.status}</span></td>
        <td><span class="badge ${o.priority==='Urgente'?'badge-danger':o.priority==='Media'?'badge-warn':'badge-gray'}">${o.priority}</span></td>
      </tr>`).join('')}
    </tbody></table>`;

  // ═══ Combustible ═══
  const fuelEl = document.getElementById('dash-fuel');
  const ultimasCargas = (App.data.fuelLogs||[]).slice(0,5);
  fuelEl.innerHTML = ultimasCargas.length === 0
    ? '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px">Sin cargas registradas</div>'
    : `<table><thead><tr><th>Unidad</th><th>Litros</th><th>Rendimiento</th><th>Estado</th></tr></thead><tbody>
      ${ultimasCargas.map(f=>`<tr>
        <td class="td-main">${f.vehicle}</td>
        <td class="td-mono">${f.liters} L</td>
        <td class="td-mono">${(()=>{const veh=(App.data.vehicles||[]).find(x=>x.code===f.vehicle);const u=veh&&isAutoelevador(veh)?'h/L':'km/L';const logs=(App.data.fuelLogs||[]).filter(x=>x.vehicle===f.vehicle&&x.km>0&&String(x.fuel_type||'').toLowerCase()!=='urea').sort((a,b)=>a.km-b.km);if(logs.length>=2){const diff=logs[logs.length-1].km-logs[0].km;const lts=logs.reduce((a,x)=>a+x.liters,0);return diff>0&&lts>0?(diff/lts).toFixed(1)+' '+u:'—'}return '—'})()}</td>
        <td><span class="badge ${f.status==='OK'?'badge-ok':'badge-warn'}">${f.status}</span></td>
      </tr>`).join('')}
    </tbody></table>`;

  // ═══ OCs recientes ═══
  const ocEl = document.getElementById('dash-oc');
  const recentOCs = (App.data.purchaseOrders||[]).slice(0,5);
  ocEl.innerHTML = recentOCs.length === 0
    ? '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px">Sin órdenes de compra todavía</div>'
    : `<table><thead><tr><th>OC</th><th>Proveedor</th><th>Total</th><th>Estado</th></tr></thead><tbody>
      ${recentOCs.map(p => `<tr>
        <td class="td-mono"><b>${escapeHtml(p.code)}</b></td>
        <td>${escapeHtml((p.proveedor || '—').substring(0, 22))}</td>
        <td class="td-mono">$${Math.round(parseFloat(p.factura_monto) || parseFloat(p.total_estimado) || 0).toLocaleString('es-AR')}</td>
        <td>${_ocEstadoBadge(p)}</td>
      </tr>`).join('')}
    </tbody></table>`;

  // ═══ Actividad reciente ═══
  const actEl = document.getElementById('dash-activity');
  actEl.innerHTML = actividadReciente.length === 0
    ? '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px">Sin actividad reciente</div>'
    : `<div style="display:flex;flex-direction:column;gap:6px">
      ${actividadReciente.map(a => `
        <div onclick="${a.action}" style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg3);border-radius:var(--radius);cursor:pointer;transition:all .1s" onmouseover="this.style.background='var(--bg4)'" onmouseout="this.style.background='var(--bg3)'">
          <span style="font-size:16px">${a.icon}</span>
          <span style="flex:1;font-size:12px;color:var(--text)">${a.text}</span>
          <span style="font-size:10px;color:var(--text3);white-space:nowrap">${tiempoAgo(a.when)}</span>
        </div>
      `).join('')}
    </div>`;

  // ═══ Actividad del día (antiguo panel "Operativo del día") ═══
  // Se llena asincrónicamente para no bloquear la primera renderización.
  _renderDailyActivityInto('dash-daily-activity');

  // ═══ Centro de comando: tiles financieros (async, solo roles con acceso a pagos) ═══
  // Lee datos que ya existen (/api/payments/pendientes); no cambia ninguna lógica.
  if (verPagos) {
    (async () => {
      try {
        const res = await apiFetch('/api/payments/pendientes');
        if (!res || !res.ok) return;
        const rows = await res.json();
        const pend = rows.filter(r => !r.pagada);
        const suma = (arr) => arr.reduce((a, r) => a + (parseFloat(r.saldo) || 0), 0);
        const porVencer = pend.filter(r => r.por_vencer);
        const vencidas  = pend.filter(r => r.vencida);
        const setTile = (id, n, monto, vacio) => {
          const el = document.getElementById(id);
          if (!el || el.children.length < 3) return;
          el.children[1].textContent = n;
          el.children[2].textContent = n > 0 ? '$' + Math.round(monto).toLocaleString('es-AR') : vacio;
        };
        setTile('cmd-fac-pend',      pend.length,      suma(pend),      'sin pendientes');
        setTile('cmd-pag-porvencer', porVencer.length, suma(porVencer), 'nada por vencer');
        setTile('cmd-pag-vencidos',  vencidas.length,  suma(vencidas),  'sin vencidas');
      } catch (e) { /* la parte financiera es opcional; si falla, queda en '…' */ }
    })();
  }
}

// ── FLOTA ──
let vehicleFilter = '';
function filterVehicle(code) { vehicleFilter = code; renderFleet(); }


function normalizeVehicleTypeLabel(type) {
  return String(type || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '');
}

function isAutoelevador(vOrType) {
  const raw = typeof vOrType === 'string' ? vOrType : (vOrType?.type || '');
  return normalizeVehicleTypeLabel(raw) === 'autoelevador';
}

// Remolcados: semirremolques y acoplados. No tienen motor, no cargan
// combustible ni tienen km/horas propios. Se evalúan solo por costo de
// mantenimiento, no por $/km ni $/hora.
function isRemolcado(vOrType) {
  const raw = typeof vOrType === 'string' ? vOrType : (vOrType?.type || '');
  const t = normalizeVehicleTypeLabel(raw);
  return t === 'semirremolque' || t === 'acoplado';
}

function vehicleMeasureLabel(v, lower=false) {
  const label = isAutoelevador(v) ? 'Horas actuales' : 'Km actuales';
  return lower ? label.toLowerCase() : label;
}

function vehicleMeasureUnit(v) {
  return isAutoelevador(v) ? 'hs' : 'km';
}

function vehicleCostLabel(v) {
  return isAutoelevador(v) ? 'Costo/hora' : 'Costo/km';
}

function vehicleOperatorLabel(v) {
  return isAutoelevador(v) ? 'Operador habitual' : 'Chofer habitual';
}

function formatVehicleMeasure(v, value) {
  const n = Number(value ?? v?.km ?? 0) || 0;
  return n.toLocaleString('es-AR') + ' ' + vehicleMeasureUnit(v);
}

function updateVehicleTypeLabels(prefix) {
  const typeEl = document.getElementById(`${prefix}-type`);
  const tempV = { type: typeEl?.value || '' };
  const kmLabel = document.getElementById(`${prefix}-km-label`);
  const driverLabel = document.getElementById(`${prefix}-driver-label`);
  const plateHelp = document.getElementById(`${prefix}-plate-help`);
  const kmInput = document.getElementById(`${prefix}-km`);
  const driverInput = document.getElementById(`${prefix}-driver`);
  if (kmLabel) kmLabel.textContent = vehicleMeasureLabel(tempV);
  if (driverLabel) driverLabel.textContent = vehicleOperatorLabel(tempV);
  if (plateHelp) plateHelp.textContent = isAutoelevador(tempV)
    ? 'Opcional para autoelevador. Si no tiene patente, se usa el código interno.'
    : 'Obligatoria para unidades patentadas.';
  if (kmInput) kmInput.placeholder = isAutoelevador(tempV) ? 'Ej: 9449' : 'Ej: 250000';
  if (driverInput) driverInput.placeholder = isAutoelevador(tempV) ? 'Ej: Billani Matías' : 'Ej: Juan Pérez';
}

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
            <th>Año</th><th>Km / horas</th><th>Base</th><th>Chofer / operador</th>
            <th>Costo</th><th>Estado</th><th>GPS</th><th></th>
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
  // Costo/km (o /hora) de cada unidad este mes + promedio por tipo, para colorear
  // de forma relativa: rojo solo si supera 25% el promedio de SU tipo (camión vs
  // autoelevador). Reemplaza el umbral fijo viejo de $0,25/km, que hoy —con la
  // inflación— lo supera cualquier valor y pintaba todo de rojo sin sentido.
  const _rows = data.map(v => ({ v, d: getCostDetail(v.code) }));
  const _ckOf = x => (x.d ? x.d.costKmReal : 0) || 0;
  const _avgOf = pred => {
    const xs = _rows.filter(x => _ckOf(x) > 0 && pred(x.v)).map(_ckOf);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  };
  const _avgCamion = _avgOf(v => !isAutoelevador(v) && !isRemolcado(v));
  const _avgFork   = _avgOf(v => isAutoelevador(v));
  tbody.innerHTML = _rows.map(({ v, d }) => {
    const st = {ok:'badge-ok',warn:'badge-warn',taller:'badge-info',detenida:'badge-danger'}[v.status]||'badge-gray';
    const stLbl = {ok:'Operativo',warn:'Con alerta',taller:'En taller',detenida:'Detenida'}[v.status]||v.status;
    const ckReal = d ? d.costKmReal : 0;
    // Vara de comparación = promedio del tipo de la unidad (autoelevador usa $/hora).
    const _base = isAutoelevador(v) ? _avgFork : _avgCamion;
    const cpkm_color = (_base>0 && ckReal>_base*1.25) ? 'danger'
                     : (_base>0 && ckReal>_base)      ? 'warn'
                     : 'ok';
    return `<tr>
      <td class="td-mono td-main">${escapeHtml(v.code)}</td>
      <td class="td-mono">${escapeHtml(v.plate)}</td>
      <td class="td-main">${escapeHtml(v.brand)} ${escapeHtml(v.model)}</td>
      <td><span class="tag" style="background:var(--bg4);color:var(--text2)">${v.type}</span></td>
      <td class="td-mono">${v.year}</td>
      <td class="td-mono">${formatVehicleMeasure(v)}</td>
      <td>${escapeHtml(v.base)}</td>
      <td>${escapeHtml(v.driver)}</td>
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
  if (isAutoelevador(type)) {
    return {
      engine: 'Motor industrial — completar según placa del equipo',
      power: 'No registrado — completar HP / torque si corresponde',
      transmission: 'Transmisión industrial / convertidor — completar modelo',
      differential: 'Eje motriz / dirección — completar según equipo',
      oil_engine: 'Aceite de motor — completar viscosidad y litros',
      oil_gearbox: 'Aceite hidráulico / transmisión — completar especificación',
      oil_diff: 'Aceite diferencial / mandos finales — completar especificación',
      coolant: 'Refrigerante — completar tipo y capacidad',
      filter_oil: 'Filtro de aceite — completar código',
      filter_fuel_p: 'Filtro de combustible — completar código',
      filter_fuel_s: 'Filtro secundario / separador — completar si aplica',
      filter_air: 'Filtro de aire — completar código',
      filter_sep: 'Separador de agua — completar si aplica',
      filter_cabin: 'No aplica / completar si posee cabina cerrada',
      grease: 'Engrase de mástil, cadenas, pernos y dirección — según manual',
      battery: 'Batería — completar amperaje / CCA',
      urea: 'No registrado / no aplica salvo equipo con SCR',
      service_km: 'Cada 250 hs: control general + aceite/filtros según manual',
      service_engage: 'Cada 500 hs: hidráulico, mástil, cadenas, frenos y dirección',
      service_major: 'Cada 1.000 hs: servicio mayor de motor, transmisión e hidráulico',
      tire_size: 'No registrado — completar medida de cubiertas',
      tire_pressure_steer: 'Según cubierta / manual',
      tire_pressure_drive: 'Según cubierta / manual',
      wheel_torque: 'No registrado — completar torque',
      fuel_cap: 'No registrado — completar capacidad de tanque',
    };
  }
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
        <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--accent)">${escapeHtml(v.code)}</div>
        <div style="font-size:11px;color:var(--text3);font-family:var(--mono)">${escapeHtml(v.plate)}</div>
      </div>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:600;color:var(--text)">${escapeHtml(v.brand)} ${escapeHtml(v.model)} · ${v.year}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:3px">${v.type} · Base ${escapeHtml(v.base)} · ${escapeHtml(v.driver)}</div>
        <div style="margin-top:8px"><span class="badge ${stBadge[v.status]||'badge-gray'}">${stLabel[v.status]||v.status}</span></div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--text)">${(Number(v.km)||0).toLocaleString('es-AR')}</div>
        <div style="font-size:11px;color:var(--text3)">${vehicleMeasureLabel(v, true)}</div>
        <div style="font-size:13px;font-family:var(--mono);color:var(--text3);margin-top:4px">${(()=>{const _d=getCostDetail(v.code);return _d&&_d.costKmReal>0?'$'+_d.costKmReal.toFixed(3)+(isAutoelevador(v)?'/h':'/km'):'Sin datos ' + vehicleCostLabel(v).toLowerCase();})()}</div>
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
          [vehicleOperatorLabel(v), v.driver],
          [vehicleMeasureLabel(v),  formatVehicleMeasure(v)],
          [vehicleCostLabel(v),     (()=>{const _d=getCostDetail(v.code);return _d&&_d.costKmReal>0?'$'+_d.costKmReal.toFixed(3)+' (mes actual)':'Sin datos suficientes';})()],
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
                <td style="color:var(--text2)">${escapeHtml(o.desc)}</td>
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
            <td style="max-width:200px;color:var(--text2)">${escapeHtml(o.desc)}</td>
            <td>${o.mechanic}</td>
            <td><span class="badge ${o.status==='Cerrada'?'badge-ok':o.status==='En proceso'?'badge-info':'badge-warn'}">${o.status}</span></td>
            <td class="td-mono">${(o.parts_cost)>0?'$'+Math.round(o.parts_cost).toLocaleString('es-AR'):'—'}</td>
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
         <table><thead><tr><th>Fecha</th><th>Litros</th><th>${isAutoelevador(v)?'Horas':'Odómetro'}</th><th>Precio/L</th><th>Total</th><th>Lugar</th></tr></thead>
          <tbody>${vFuel.map(f=>`<tr>
            <td class="td-mono" style="font-size:11px">${f.date}</td>
            <td class="td-mono">${f.liters} L</td>
            <td class="td-mono">${(Number(f.km)||0).toLocaleString('es-AR')} ${vehicleMeasureUnit(v)}</td>
            <td class="td-mono">$${f.ppu.toLocaleString()}</td>
            <td class="td-mono">$${f.total.toLocaleString()}</td>
            <td style="color:var(--text3)">${f.place}</td>
          </tr>`).join('')}</tbody></table>`
      : `<div style="color:var(--text3);font-size:13px;padding:24px 0;text-align:center">Sin cargas de combustible registradas para esta unidad.</div>`;
  }

  const actions = [
    { label:'Nueva OT',   cls:'btn-primary',   fn: () => { closeModal(); openNewOTModal(v.code); } },
    { label:'Editar',     cls:'btn-secondary', fn: () => openEditVehicleModal(id) },
    { label:'Cerrar',     cls:'btn-secondary', fn: closeModal },
  ];
  // Solo el dueño puede dar de baja una unidad
  if (App.currentUser?.role === 'dueno') {
    actions.splice(2, 0, { label:'🗑 Dar de baja', cls:'btn-danger', fn: () => confirmBajaVehiculo(id, v.code) });
  }
  openModal(`${escapeHtml(v.code)} — ${escapeHtml(v.brand)} ${escapeHtml(v.model)}`, header + tabBar + `<div id="ficha-tab-content">${content}</div>`, actions);
}

async function confirmBajaVehiculo(id, code) {
  openModal('Dar de baja — ' + code, `
    <div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:var(--radius);padding:16px;margin-bottom:16px">
      <div style="font-weight:600;color:var(--danger);margin-bottom:8px">⚠ Esta acción es irreversible</div>
      <div style="font-size:13px;color:var(--text3)">La unidad <strong>${code}</strong> quedará inactiva y no aparecerá más en el sistema. Sus registros históricos se conservan.</div>
    </div>
    <div class="form-group">
      <label class="form-label">Motivo de la baja</label>
      <input class="form-input" id="baja-motivo" placeholder="Ej: Venta, siniestro total, fin de vida útil...">
    </div>
  `, [
    { label:'Confirmar baja', cls:'btn-danger', fn: async () => {
      const motivo = document.getElementById('baja-motivo')?.value?.trim();
      if (!motivo) { showToast('warn','Ingresá el motivo de la baja'); return; }
      const res = await apiFetch(`/api/vehicles/${id}`, { method: 'DELETE' });
      if (!res.ok) { showToast('error','Error al dar de baja'); return; }
      App.data.vehicles = App.data.vehicles.filter(v => v.id !== id);
      closeModal();
      showToast('ok', `Unidad ${code} dada de baja`);
      renderFleet();
    }},
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal },
  ]);
}

// ── EDITAR datos generales del vehículo ──
function openEditVehicleModal(id) {
  const v = App.data.vehicles.find(x=>x.id===id);
  if (!v) return;
  openModal('Editar unidad — ' + v.code, `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Código interno</label><input class="form-input" id="ev-code" value="${escapeHtml(v.code)}"></div>
      <div class="form-group"><label class="form-label">Patente</label><input class="form-input" id="ev-plate" value="${escapeHtml(v.plate||'')}"><div id="ev-plate-help" style="font-size:11px;color:var(--text3);margin-top:4px"></div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Marca</label><input class="form-input" id="ev-brand" value="${escapeHtml(v.brand)}"></div>
      <div class="form-group"><label class="form-label">Modelo</label><input class="form-input" id="ev-model" value="${escapeHtml(v.model)}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Año</label><input class="form-input" type="number" id="ev-year" value="${v.year}"></div>
      <div class="form-group"><label class="form-label">Tipo</label>
        <select class="form-select" id="ev-type" onchange="updateVehicleTypeLabels('ev')">
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
      <div class="form-group"><label class="form-label" id="ev-driver-label">${vehicleOperatorLabel(v)}</label><input class="form-input" id="ev-driver" value="${escapeHtml(v.driver||'')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" id="ev-km-label">${vehicleMeasureLabel(v)}</label><input class="form-input" type="number" id="ev-km" value="${v.km}"></div>
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
  updateVehicleTypeLabels('ev');
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

  if (!code) { showToast('error','El código interno es obligatorio'); return; }
  if (!plate && !isAutoelevador(type)) { showToast('error','La patente es obligatoria para unidades patentadas'); return; }

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
  const ot_tipo   = window._otTipoActual || 'vehiculo';
  const target_id = document.getElementById('ot-target-select')?.value || '';
  const title      = (document.getElementById('ot-title')?.value || '').trim();
  const priority   = document.getElementById('ot-priority')?.value || 'Normal';
  const labor_cost = 0;
  const notes      = (document.getElementById('ot-notes')?.value || '').trim();

  // Repuestos — leer directo del DOM. El stock sale siempre del catálogo
  // (modelo nuevo, catalog_id); el modelo viejo (stock_id) fue retirado.
  const parts = [];
  let stockSinSeleccion = false;
  document.querySelectorAll('[id^="otp-name-"]').forEach(nameEl => {
    const idx   = nameEl.id.replace('otp-name-', '');
    const name  = nameEl.value.trim();
    if (!name || name.length < 2) return;

    const originEl = document.getElementById('otp-origin-' + idx);
    const origin = originEl?.value === 'stock' ? 'stock' : 'externo';
    const catalog_id = (origin === 'stock') ? (nameEl.dataset.catalogId || null) : null;

    if (origin === 'stock' && !catalog_id) {
      stockSinSeleccion = true;
      nameEl.style.borderColor = 'var(--danger)';
      return;
    }

    const qty = parseFloat(document.getElementById('otp-qty-'  + idx)?.value) || 1;
    const unitCost = parseFloat(document.getElementById('otp-cost-' + idx)?.value) || 0;

    parts.push({
      name,
      qty,
      unit:      document.getElementById('otp-unit-' + idx)?.value || 'un',
      unit_cost: unitCost,
      origin,
      stock_id:  null,
      catalog_id,
      base_location: catalog_id ? (nameEl.dataset.baseLocation || null) : null,
      area:          catalog_id ? (nameEl.dataset.area || null) : null,
    });
  });
  if (stockSinSeleccion) {
    showToast('error', 'Elegiste Pañol, pero falta seleccionar el artículo del listado. Hacé click en la sugerencia del stock.');
    return;
  }

  if (!target_id) {
    showToast('error', ot_tipo==='vehiculo' ? 'Seleccioná una unidad' : 'Seleccioná un activo');
    return;
  }
  if (!title) { showToast('error','Ingresá un título para la OT'); return; }

  const payload = {
    ot_tipo,
    description: title + (notes ? '\n' + notes : ''),
    type:        document.getElementById('ot-type')?.value || 'Correctivo',
    priority,
    mechanic_id: null,
    mechanic: document.getElementById('ot-mechanic')?.value?.trim() || null,
    parts,
    labor_cost,
    external_required: !!document.getElementById('ot-external-required')?.checked,
    external_description: (document.getElementById('ot-external-description')?.value || '').trim()
  };
  if (ot_tipo === 'vehiculo') payload.vehicle_id = target_id;
  else                         payload.asset_id   = target_id;

  const res = await apiFetch('/api/workorders', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error al crear OT'); return; }
  const ot = await res.json();

  window._otParts = [];
  closeModal();
  const poCodes = Array.isArray(ot.external_po_codes) && ot.external_po_codes.length
    ? ot.external_po_codes
    : (ot.external_po_code ? [ot.external_po_code] : []);
  showToast('ok', `OT ${escapeHtml(ot.code)} creada${poCodes.length ? ' · OC generada/s: ' + poCodes.join(', ') : ''}`);
  await afterSave({ page: 'workorders' });
}


function _otIsClosed(ot) {
  return String(ot?.status || '').toLowerCase().includes('cerrad');
}

function openEditOTModal(id) {
  const ot = App.data.workOrders.find(o=>o.id===id);
  if (!ot) return;
  const otClosed = _otIsClosed(ot);
  const statusOpts = ['En proceso','Pendiente','Esperando repuesto','Esperando tercerizado','Asignada'];
  const prioOpts   = ['Normal','Media','Urgente'];
  const typeOpts   = ['Correctivo','Preventivo','Predictivo'];

  openModal(`Editar OT — ${id}`, `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--text3);font-family:var(--mono)">
      Abierta: ${ot.opened} &nbsp;·&nbsp; Vehículo: ${ot.vehicle}
    </div>
    ${otClosed ? `<div style="background:rgba(16,185,129,.10);border:1px solid rgba(16,185,129,.35);color:var(--ok);border-radius:var(--radius);padding:10px 14px;margin-bottom:14px;font-size:12px;font-weight:600">✓ OT cerrada: queda en modo consulta. No permite agregar mano de obra ni repuestos.</div>` : ''}
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Vehículo (código)</label>
        <input class="form-input" id="eo-vehicle" value="${ot.vehicle}" ${otClosed ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label class="form-label">Tipo de trabajo</label>
        <select class="form-select" id="eo-type" ${otClosed ? 'disabled' : ''}>
          ${typeOpts.map(t=>`<option ${t===ot.type?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Prioridad</label>
        <select class="form-select" id="eo-priority" ${otClosed ? 'disabled' : ''}>
          ${prioOpts.map(p=>`<option ${p===ot.priority?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Estado actual</label>
        <select class="form-select" id="eo-status" ${otClosed ? 'disabled' : ''}>
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
      <textarea class="form-textarea" id="eo-desc" ${otClosed ? 'disabled' : ''}>${ot.desc||''}</textarea>
    </div>

    <!-- ⏱ PARTES DE TRABAJO (opción B) ──────────────────────── -->
    <div style="margin:16px 0 8px;padding-top:12px;border-top:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div>
          <label class="form-label" style="margin:0;font-weight:700">⏱️ Partes de trabajo (mano de obra propia)</label>
          <div style="font-size:11px;color:var(--text3)">Quién trabajó y cuántas horas. No se valoriza la mano de obra propia.</div>
        </div>
        ${otClosed ? `<span style="font-size:11px;color:var(--text3);background:var(--bg3);border:1px solid var(--border2);border-radius:999px;padding:6px 10px">Solo lectura</span>` : `<button type="button" class="btn btn-secondary btn-sm" onclick="_labAddRow()">+ Agregar parte</button>`}
      </div>
      <div id="eo-labor-list" style="margin-bottom:8px">
        <div style="text-align:center;padding:12px;color:var(--text3);font-size:12px">⏳ Cargando partes...</div>
      </div>
      <div id="eo-labor-total" style="text-align:right;font-size:13px;padding:6px 10px;background:var(--bg3);border-radius:var(--radius);display:none">
        Total horas registradas: <strong id="eo-labor-total-hours" style="color:var(--accent)">0</strong> h
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Costo repuestos ($)
          <span style="font-size:10px;color:var(--text3);font-weight:400">· autocalculado desde los repuestos</span>
        </label>
        <input class="form-input" type="number" id="eo-parts" value="${ot.parts_cost||0}" readonly style="background:var(--bg3)">
      </div>
      <div class="form-group">
        <label class="form-label">Mano de obra propia</label>
        <input class="form-input" id="eo-labor" value="Sin precio · se registra por horas" readonly style="background:var(--bg3);color:var(--text3)">
      </div>
    </div>
    ${(ot.parts||[]).length>0?`
      <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--text3);margin-bottom:12px">
        ℹ️ Esta OT ya tiene ${ot.parts.length} repuesto/s cargado/s desde la creación.
      </div>`:''
    }

    <!-- 🔧 REPUESTOS EN OT EXISTENTE ─────────────────────────── -->
    <div style="margin:16px 0 8px;padding-top:12px;border-top:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div>
          <label class="form-label" style="margin:0;font-weight:700">🔧 Repuestos de la OT</label>
          <div style="font-size:11px;color:var(--text3)">Pañol suma costo al instante. Cada repuesto externo o mano de obra tercerizada genera su propia OC y se valoriza cuando Compras aprueba el precio.</div>
        </div>
        ${otClosed ? `<span style="font-size:11px;color:var(--text3);background:var(--bg3);border:1px solid var(--border2);border-radius:999px;padding:6px 10px">Solo lectura</span>` : `<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn btn-secondary btn-sm" onclick="_partsAddRow()">+ Agregar repuesto</button><button type="button" class="btn btn-secondary btn-sm" onclick="_partsAddExternalLabor()">+ Tercerizar MO</button></div>`}
      </div>
      <div id="eo-parts-list" style="margin-bottom:8px">
        <div style="text-align:center;padding:12px;color:var(--text3);font-size:12px">⏳ Cargando repuestos...</div>
      </div>
      <div id="eo-parts-total" style="text-align:right;font-size:13px;padding:6px 10px;background:var(--bg3);border-radius:var(--radius);display:none">
        Total repuestos: <strong id="eo-parts-total-val" style="color:var(--accent)">$0</strong>
      </div>
    </div>
  `, otClosed
    ? [{ label:'Cerrar', cls:'btn-secondary', fn: closeModal }]
    : [
        { label:'Guardar cambios', cls:'btn-primary',   fn: () => saveEditOT(id) },
        { label:'Cancelar',        cls:'btn-secondary', fn: closeModal }
      ]
  );

  // Guardar el ID de la OT en una variable global del modal
  window._labCurrentOtId = ot._uuid || ot.id;
  window._labCurrentOtClosed = otClosed;
  // Cargar los partes de trabajo Y los repuestos de esta OT
  _labLoadList();
  _partsLoadList();
}

async function saveEditOT(id) {
  const ot = App.data.workOrders.find(o=>o.id===id);
  if (!ot) return;
  const status     = document.getElementById('eo-status')?.value   || ot.status;
  const mechanic   = document.getElementById('eo-mechanic')?.value || '';
  const desc       = document.getElementById('eo-desc')?.value     || ot.desc;
  const priority   = document.getElementById('eo-priority')?.value || ot.priority;
  const labor      = 0;
  const parts_cost = parseFloat(document.getElementById('eo-parts')?.value)  || ot.parts_cost  || 0;
  const woUUID = ot._uuid || ot.id;
  const res = await apiFetch(`/api/workorders/${woUUID}`, {
    method: 'PUT',
    body: JSON.stringify({ status, mechanic_id: null, description: desc, labor_cost: 0, parts_cost, priority })
  });
  if (!res.ok) { showToast('error', 'Error al actualizar OT'); return; }
  ot.status = status; ot.desc = desc; ot.priority = priority; ot.labor_cost = 0; ot.parts_cost = parts_cost;
  closeModal();
  showToast('ok', `${id} actualizada correctamente`);
  await afterSave({ page: 'workorders' });
}


// Opciones del select de cierre: artículo × ubicación con saldo del catálogo
// nuevo. El value es el índice en window._closeStockList (así dos ubicaciones
// del mismo artículo no colisionan).
function _closeStockOptionsHTML() {
  window._closeStockList = _catalogStockSuggestions('', 300);
  return window._closeStockList.map((s, i) =>
    `<option value="${i}" data-cost="${s.unit_cost}">${escapeHtml(s.code)} — ${escapeHtml(s.name)} · ${escapeHtml(s.base_location)}/${escapeHtml(s.area)} — ${s.qty} ${escapeHtml(s.unit)} — $${Math.round(s.unit_cost).toLocaleString('es-AR')}</option>`
  ).join('');
}

function openCloseOTModal(id) {
  const ot = App.data.workOrders.find(o=>o.id===id);
  if (!ot) return;
  if (!ot.closeParts) ot.closeParts = [];

  const stockOpts = _closeStockOptionsHTML();

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
          <td style="padding:5px 6px;color:var(--text)">${escapeHtml(p.name)}</td>
          <td style="padding:5px 6px;text-align:center;font-family:var(--mono)">${p.qty||1} ${escapeHtml(p.unit||'')}</td>
          <td style="padding:5px 6px"><span class="badge ${p.origin==='stock'?'badge-info':'badge-purple'}">${p.origin==='stock'?'Pañol':'Compra'}</span></td>
          <td style="padding:5px 6px;text-align:right;font-family:var(--mono)">$${((p.cost||0)*(p.qty||1)).toLocaleString()}</td>
        </tr>`).join('')}</tbody>
       </table>`
    : '';

  openModal(`Cerrar OT — ${id}`, `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:12px;margin-bottom:14px;font-size:13px">
      <div style="color:var(--text2);margin-bottom:3px;font-family:var(--mono);font-size:11px">${ot.vehicle} · ${ot.type} · ${ot.priority}</div>
      <div style="color:var(--text);font-weight:500">${escapeHtml(ot.desc)}</div>
    </div>

    ${existingPartsHTML}

    <div id="cl-compras-wrap"></div>

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
            <option value="externo">Compra externa (genera OC a Compras)</option>
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
          <label class="form-label">Costo stock ($)</label>
          <input class="form-input" type="number" id="cl-unit-cost" placeholder="0" readonly style="background:var(--bg3)" oninput="previewClosePartTotal()"><div id="cl-preview-total" style="font-size:11px;color:var(--accent);font-family:var(--mono);margin-top:3px;height:14px"></div>
        </div>
        <button class="btn btn-secondary" style="height:38px;padding:0 14px;flex-shrink:0" onclick="addCloseOTPart('${id}')">+ Agregar</button>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Causa raíz / diagnóstico final</label>
      <textarea class="form-textarea" placeholder="Describí qué se encontró y cómo se resolvió..." id="cl-causa"></textarea>
    </div>
    <div class="form-row">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--text3)">La mano de obra propia no lleva precio. Queda registrada por partes de trabajo y horas.</div>
      <div style="display:none">
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
  // El catálogo puede no estar cargado todavía: lo traemos y repoblamos el select.
  _ensureStockCatalog().then(() => {
    const sel = document.getElementById('cl-stock-id');
    if (sel) sel.innerHTML = '<option value="">— Seleccioná —</option>' + _closeStockOptionsHTML();
  });
  // Repuestos comprados para esta OT que ya están en stock → consumir al cerrar.
  _loadComprasEnStock(ot._uuid || ot.id);
}

// Trae los repuestos comprados para la OT que entraron al stock y arma la sección
// "consumir al cerrar". Default usado = lo comprado (se puede bajar; el resto queda).
async function _loadComprasEnStock(otUUID) {
  const wrap = document.getElementById('cl-compras-wrap');
  if (!wrap) return;
  let list = [];
  try { const r = await apiFetch(`/api/workorders/${otUUID}/compras-en-stock`); list = r.ok ? await r.json() : []; }
  catch (e) { list = []; }
  window._otComprasStock = list;
  if (!list.length) { wrap.innerHTML = ''; return; }
  const num = (v) => parseFloat(v) || 0;
  const rows = list.map((c, i) => {
    const comprada = num(c.qty_comprada), disp = num(c.qty_disponible);
    const def = Math.min(comprada, disp);
    return `<div style="display:grid;grid-template-columns:1fr 96px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:13px;font-weight:600">${escapeHtml(c.name)}</div>
        <div style="font-size:11px;color:var(--text3)"><span style="font-family:var(--mono)">${escapeHtml(c.code)}</span> · comprado: <b>${comprada} ${escapeHtml(c.unit)}</b> · en stock: ${disp} · ${escapeHtml(typeof _stockShortLoc === 'function' ? _stockShortLoc(c.base_location) : c.base_location)}/${escapeHtml(c.area)}</div>
      </div>
      <div>
        <label style="font-size:10px;color:var(--text3)">Usado</label>
        <input class="form-input" type="number" min="0" max="${disp}" step="0.01" value="${def}" data-compra-idx="${i}" style="text-align:right;padding:6px">
      </div>
    </div>`;
  }).join('');
  wrap.innerHTML = `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:var(--radius);padding:12px;margin-bottom:14px">
    <div style="font-size:11px;color:#1e40af;font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">📦 Repuestos comprados para esta OT (en stock)</div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px">Al cerrar se descuenta del stock lo que usaste. Lo que no uses queda en stock.</div>
    ${rows}
  </div>`;
}

function onClosePartOriginChange() {
  const origin = document.getElementById('cl-origin')?.value;
  const sG = document.getElementById('cl-stock-grp');
  const nG = document.getElementById('cl-name-grp');
  const costEl = document.getElementById('cl-unit-cost');
  const prev = document.getElementById('cl-preview-total');
  if (!sG || !nG) return;
  if (origin === 'stock') {
    sG.style.display=''; nG.style.display='none';
    if (costEl) { costEl.readOnly = true; costEl.style.background = 'var(--bg3)'; costEl.value = ''; }
    if (prev) prev.textContent = '';
  } else {
    sG.style.display='none'; nG.style.display='';
    if (costEl) { costEl.readOnly = true; costEl.style.background = 'var(--bg3)'; costEl.value = 0; }
    if (prev) prev.textContent = 'Se generará OC para Compras. Sin precio en la OT.';
  }
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
    const sel    = document.getElementById('cl-stock-id');
    const valIdx = sel?.value || '';
    if (valIdx === '') { showToast('warn','Seleccioná un ítem del stock'); return; }
    const item   = (window._closeStockList || [])[parseInt(valIdx, 10)];
    if (!item)   return;
    if (item.qty < qty) { showToast('warn',`Stock insuficiente. Disponible: ${item.qty} ${escapeHtml(item.unit)}`); return; }
    ot.closeParts.push({ name:item.name, origin:'stock', catalog_id:item.catalog_id, base_location:item.base_location, area:item.area, qty, cost:cost||item.unit_cost, unit:item.unit });
    sel.value = '';
  } else {
    const name = document.getElementById('cl-part-name')?.value.trim();
    if (!name) { showToast('warn','Escribí el nombre del repuesto o servicio externo'); return; }
    ot.closeParts.push({ name, origin:'externo', stockId:null, qty, cost:0, unit:'un' });
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
        <td style="padding:5px 6px;color:var(--text)">${escapeHtml(p.name)}</td>
        <td style="padding:5px 6px;text-align:center;font-family:var(--mono)">${p.qty||1}</td>
        <td style="padding:5px 6px"><span class="badge ${p.origin==='stock'?'badge-info':'badge-purple'}">${p.origin==='stock'?'Pañol':'OC Compras'}</span></td>
        <td style="padding:5px 6px;text-align:right;font-family:var(--mono)">${p.origin==='stock' ? '$'+((p.cost||0)*(p.qty||1)).toLocaleString() : 'A cotizar'}</td>
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

async function closeOTConfirmed(id) {
  const ot = App.data.workOrders.find(o=>o.id===id);
  if (!ot) return;
  const causa  = document.getElementById('cl-causa')?.value  || '—';
  const labor  = 0;

  // Repuestos agregados al cerrar: pañol descuenta stock; externos generan OC para Compras.
  const parts = (ot.closeParts || []).map(p => ({
    stock_id: null,
    catalog_id: p.origin === 'stock' ? (p.catalog_id || null) : null,
    base_location: p.origin === 'stock' ? (p.base_location || null) : null,
    area: p.origin === 'stock' ? (p.area || null) : null,
    name: p.name,
    qty: parseFloat(p.qty) || 1,
    unit: p.unit || 'un',
    unit_cost: p.origin === 'stock' ? (parseFloat(p.cost) || 0) : 0,
    origin: p.origin === 'stock' ? 'stock' : 'externo'
  }));
  let descuentos = parts.filter(p => p.origin === 'stock').length;
  let externos = parts.filter(p => p.origin !== 'stock').length;

  // Consumo de los repuestos comprados para esta OT (sección "en stock").
  const consumed_purchases = [];
  (window._otComprasStock || []).forEach((c, i) => {
    const inp = document.querySelector(`[data-compra-idx="${i}"]`);
    const usada = parseFloat(inp?.value);
    if (usada > 0) {
      consumed_purchases.push({
        work_order_part_id: c.work_order_part_id, catalog_id: c.catalog_id,
        base_location: c.base_location, area: c.area, qty_usada: usada,
      });
    }
  });
  descuentos += consumed_purchases.length;

  const woUUID = ot._uuid || ot.id;
  const res = await apiFetch(`/api/workorders/${woUUID}/close`, {
    method: 'POST',
    body: JSON.stringify({ root_cause: causa, labor_cost: labor, close_parts: parts, consumed_purchases })
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error || 'Error al cerrar OT'); return; }

  ot.status = 'Cerrada'; ot.labor_cost = 0;
  closeModal();
  showToast('ok', `${id} cerrada${descuentos>0?' · '+descuentos+' ítems descontados del stock':''}${externos>0?' · OC generada para externo':''}`);
  await afterSave({ page: 'workorders' });
}


function closeOT(id) { openCloseOTModal(id); }

// ── IMPRIMIR OT ──
async function printOT(id) {
  const ot = App.data.workOrders.find(o => o.id === id);
  if (!ot) return;
  const v = App.data.vehicles.find(x => x.code === ot.vehicle);

  // Traer repuestos y partes de trabajo desde el backend (datos frescos)
  let partsData = [];
  let laborData = [];
  try {
    const woUUID = ot._uuid || ot.id;
    const [partsRes, laborRes] = await Promise.all([
      apiFetch(`/api/workorders/${woUUID}/parts`),
      apiFetch(`/api/workorders/${woUUID}/labor`),
    ]);
    if (partsRes?.ok) partsData = await partsRes.json();
    if (laborRes?.ok) laborData = await laborRes.json();
  } catch(e) { /* usar datos en memoria */ }

  // Si no se pudo traer del backend, caer en los datos de memoria
  if (partsData.length === 0) {
    partsData = [].concat(ot.parts || [], ot.closeParts || []).map(p => ({
      name: p.name,
      qty: p.qty || 1,
      unit: p.unit || 'un',
      unit_cost: p.cost || p.unit_cost || 0,
      origin: p.origin || 'externo',
      subtotal: (p.cost || p.unit_cost || 0) * (p.qty || 1),
    }));
  }

  // Calcular totales
  const partsTotal = partsData.reduce((a, p) => a + (parseFloat(p.subtotal) || (p.qty * p.unit_cost)), 0);
  const laborHours = laborData.reduce((a, l) => a + (parseFloat(l.hours) || 0), 0);
  const totalCost = partsTotal;

  // Filas de repuestos
  let partsRows = '';
  if (partsData.length > 0) {
    partsData.forEach(p => {
      const qty = parseFloat(p.qty) || 1;
      const unitCost = parseFloat(p.unit_cost) || 0;
      const subtotal = parseFloat(p.subtotal) || (qty * unitCost);
      const origenBadge = p.origin === 'stock'
        ? '<span class="badge-stock">📦 Pañol</span>'
        : '<span class="badge-compra">🛒 Externo</span>';
      partsRows += `<tr>
        <td>${escapeHtml(p.name || '—')}</td>
        <td style="text-align:center">${qty} ${escapeHtml(p.unit || 'un')}</td>
        <td style="text-align:center">${origenBadge}</td>
        <td style="text-align:right">$${Math.round(unitCost).toLocaleString('es-AR')}</td>
        <td style="text-align:right;font-weight:600">$${Math.round(subtotal).toLocaleString('es-AR')}</td>
      </tr>`;
    });
  } else {
    partsRows = '<tr><td colspan="5" style="padding:10px;color:#9ca3af;text-align:center">Sin repuestos registrados</td></tr>';
  }

  // Filas de partes de trabajo (MO)
  let laborRows = '';
  if (laborData.length > 0) {
    laborData.forEach(l => {
      const hours = parseFloat(l.hours) || 0;
      const fecha = l.work_date ? new Date(l.work_date).toLocaleDateString('es-AR') : '—';
      laborRows += `<tr>
        <td>${l.worker_name || '—'}</td>
        <td style="text-align:center">${fecha}</td>
        <td style="text-align:right">${hours.toFixed(2)} h</td>
        <td>${escapeHtml(l.notes || '—')}</td>
      </tr>`;
    });
  } else {
    laborRows = `<tr><td colspan="4" style="padding:10px;color:#9ca3af;text-align:center">Sin partes de trabajo registrados</td></tr>`;
  }

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8">
    <title>Orden de Trabajo ${ot.id} — Biletta</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; padding: 32px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 3px solid #E55A11; }
      .logo-wrap { display: flex; align-items: center; gap: 14px; }
      .logo-square { width: 52px; height: 52px; background: #E55A11; color: #fff; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 20px; letter-spacing: .5px; }
      .empresa { font-size: 20px; font-weight: 700; color: #111; }
      .empresa-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
      .ot-id { font-size: 22px; font-weight: 700; font-family: monospace; color: #E55A11; text-align: right; }
      .ot-date { font-size: 11px; color: #6b7280; text-align: right; margin-top: 4px; }
      .status-bar { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; margin-top: 6px; }
      .status-cerrada { background: #dcfce7; color: #166534; }
      .status-proceso { background: #dbeafe; color: #1e40af; }
      .status-pendiente { background: #fef3c7; color: #92400e; }
      .status-other { background: #f3f4f6; color: #374151; }
      .section { margin-bottom: 22px; }
      .section-title { font-size: 11px; font-weight: 700; color: #E55A11; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
      .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
      .field { margin-bottom: 8px; }
      .field-label { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 2px; }
      .field-value { font-size: 13px; font-weight: 500; color: #111; }
      .desc-box { background: #f9fafb; border-left: 3px solid #E55A11; padding: 12px; font-size: 13px; line-height: 1.6; color: #374151; border-radius: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; }
      thead tr { background: #eff6ff; }
      th { text-align: left; padding: 8px; border-bottom: 2px solid #E55A11; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #E55A11; font-weight: 700; }
      td { padding: 7px 8px; border-bottom: 1px solid #f3f4f6; }
      .total-row { background: #f9fafb; }
      .total-row td { padding: 8px; font-weight: 700; border-top: 2px solid #111; }
      .grand-total-row td { background: #E55A11; color: #fff; font-size: 15px; padding: 10px 8px; }
      .firma-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 32px; margin-top: 40px; }
      .firma-box { border-top: 1px solid #111; padding-top: 8px; font-size: 11px; color: #6b7280; text-align: center; }
      .badge-stock { background: #dcfce7; color: #166534; padding: 2px 7px; border-radius: 10px; font-size: 10px; }
      .badge-compra { background: #fef3c7; color: #92400e; padding: 2px 7px; border-radius: 10px; font-size: 10px; }
      .badge-urgente { background: #fee2e2; color: #991b1b; padding: 2px 7px; border-radius: 10px; font-size: 10px; }
      .badge-normal { background: #f3f4f6; color: #374151; padding: 2px 7px; border-radius: 10px; font-size: 10px; }
      .badge-prev { background: #dcfce7; color: #166534; padding: 2px 7px; border-radius: 10px; font-size: 10px; }
      .badge-corr { background: #fee2e2; color: #991b1b; padding: 2px 7px; border-radius: 10px; font-size: 10px; }
      @media print {
        body { padding: 16px; }
        @page { margin: 12mm; }
      }
    </style>
  </head><body>

    <div class="header">
      <div class="logo-wrap">
        <div class="logo-square">EB</div>
        <div>
          <div class="empresa">Expreso Biletta SRL</div>
          <div class="empresa-sub">Sistema de gestión de flota y taller</div>
        </div>
      </div>
      <div style="text-align:right">
        <div class="ot-id">ORDEN DE TRABAJO ${ot.id}</div>
        <div class="ot-date">Apertura: ${ot.opened}</div>
        ${ot.closed ? `<div class="ot-date">Cierre: ${ot.closed}</div>` : ''}
        <div style="margin-top:6px">
          <span class="status-${ot.status==='Cerrada'?'cerrada':ot.status==='En proceso'?'proceso':ot.status==='Pendiente'?'pendiente':'other'}">${ot.status}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Datos del vehículo</div>
      <div class="grid-3">
        <div class="field"><div class="field-label">Código interno</div><div class="field-value">${ot.vehicle}</div></div>
        <div class="field"><div class="field-label">Patente</div><div class="field-value">${v?escapeHtml(v.plate):escapeHtml(ot.plate||'—')}</div></div>
        <div class="field"><div class="field-label">Marca / Modelo</div><div class="field-value">${v?escapeHtml(v.brand||'')+' '+escapeHtml(v.model||''):'—'}</div></div>
        <div class="field"><div class="field-label">${v && isAutoelevador(v) ? 'Horas al momento' : 'Km al momento'}</div><div class="field-value">${v?formatVehicleMeasure(v):'—'}</div></div>
        <div class="field"><div class="field-label">Base operativa</div><div class="field-value">${v?escapeHtml(v.base||'—'):'—'}</div></div>
        <div class="field"><div class="field-label">${v && isAutoelevador(v) ? 'Operador habitual' : 'Chofer habitual'}</div><div class="field-value">${v?escapeHtml(v.driver||'—'):'—'}</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Datos de la orden</div>
      <div class="grid-3" style="margin-bottom:12px">
        <div class="field"><div class="field-label">Tipo de trabajo</div><div class="field-value"><span class="${ot.type==='Preventivo'?'badge-prev':'badge-corr'}">${ot.type}</span></div></div>
        <div class="field"><div class="field-label">Prioridad</div><div class="field-value"><span class="${ot.priority==='Urgente'?'badge-urgente':'badge-normal'}">${ot.priority}</span></div></div>
        <div class="field"><div class="field-label">Mecánico asignado</div><div class="field-value">${ot.mechanic || '—'}</div></div>
      </div>
      <div class="field"><div class="field-label">Descripción / diagnóstico</div></div>
      <div class="desc-box">${ot.desc || '—'}</div>
      ${ot.causa_raiz && ot.causa_raiz !== '—' ? `
        <div class="field" style="margin-top:12px"><div class="field-label">Causa raíz / resolución</div></div>
        <div class="desc-box">${ot.causa_raiz}</div>
      ` : ''}
    </div>

    <div class="section">
      <div class="section-title">🔧 Repuestos e insumos utilizados</div>
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
            <td colspan="4" style="text-align:right">Subtotal repuestos:</td>
            <td style="text-align:right">$${Math.round(partsTotal).toLocaleString('es-AR')}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="section">
      <div class="section-title">⏱️ Mano de obra — partes de trabajo</div>
      <table>
        <thead><tr>
          <th>Trabajador</th>
          <th style="text-align:center">Fecha</th>
          <th style="text-align:right">Horas</th>
          <th>Notas</th>
        </tr></thead>
        <tbody>${laborRows}</tbody>
        ${laborData.length > 0 ? `<tfoot>
          <tr class="total-row">
            <td colspan="2" style="text-align:right">Total horas:</td>
            <td style="text-align:right">${laborHours.toFixed(2)} h</td>
            <td style="text-align:right;color:#6b7280">Sin precio</td>
          </tr>
        </tfoot>` : ''}
      </table>
    </div>

    <div class="section">
      <table>
        <tr class="grand-total-row">
          <td style="font-weight:700">TOTAL ORDEN DE TRABAJO</td>
          <td style="text-align:right;font-weight:700">$${Math.round(totalCost).toLocaleString('es-AR')}</td>
        </tr>
      </table>
      <div style="font-size:10px;color:#6b7280;margin-top:6px;text-align:right">
        Repuestos: $${Math.round(partsTotal).toLocaleString('es-AR')} · Mano de obra propia sin precio
      </div>
    </div>

    <div class="firma-row">
      <div class="firma-box">Mecánico responsable<br><br><br></div>
      <div class="firma-box">Jefe de mantenimiento<br><br><br></div>
      <div class="firma-box">Conformidad / recepción<br><br><br></div>
    </div>

    <div style="margin-top:32px;font-size:10px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;padding-top:10px">
      Expreso Biletta SRL · Orden de Trabajo ${ot.id} · Generado el ${nowDateAR()} ${nowTimeAR()}
    </div>

    <script>window.onload=function(){setTimeout(function(){window.print();},200);}<\/script>
  </body></html>`);
  win.document.close();
}

// ── COMBUSTIBLE ──
// Meses (YYYY-MM) presentes en el historial de cargas, del más nuevo al más viejo.
function _fuelKmMonths() {
  const set = new Set();
  (App.data.fuelLogs || []).forEach(f => {
    const d = new Date(f.date);
    if (!isNaN(d)) set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  });
  return [...set].sort().reverse();
}
function _fuelMonthLabel(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-').map(Number);
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return `${meses[m - 1] || m} ${y}`;
}
// Tabla de km recorridos (u horas, en autoelevadoras) por cada unidad en el mes
// elegido. El recorrido = diferencia entre la primera y la última lectura del
// odómetro/horómetro de las cargas del mes (mismo método que el costo por km).
// Hacen falta ≥2 lecturas para poder calcularlo.
function _fuelKmRows(ym) {
  if (!ym) return [];
  const [yy, mm] = ym.split('-').map(Number);
  const inSel = (d) => { const x = new Date(d); return !isNaN(x) && x.getFullYear() === yy && x.getMonth() + 1 === mm; };
  const logs = (App.data.fuelLogs || []).filter(f => inSel(f.date) && String(f.fuel_type || '').toLowerCase() !== 'urea');
  const byVeh = {};
  logs.forEach(f => {
    const g = byVeh[f.vehicle] = byVeh[f.vehicle] || { litros: 0, kms: [], cargas: 0 };
    g.litros += (f.liters || 0); g.cargas++;
    if (f.km > 0) g.kms.push(f.km);
  });
  return Object.entries(byVeh).map(([code, g]) => {
    const veh = (App.data.vehicles || []).find(v => v.code === code);
    const unit = (typeof isAutoelevador === 'function' && veh && isAutoelevador(veh)) ? 'h' : 'km';
    const kms = g.kms.slice().sort((a, b) => a - b);
    const recorrido = kms.length >= 2 ? (kms[kms.length - 1] - kms[0]) : null;
    return { code, unit, recorrido, litros: g.litros, cargas: g.cargas };
  }).sort((a, b) => (b.recorrido || 0) - (a.recorrido || 0) || String(a.code).localeCompare(String(b.code)));
}
function _renderFuelKmTable() {
  const cont = document.getElementById('fuel-km-body');
  if (!cont) return;
  const ym = App.fuelKmMonth;
  if (!ym) { cont.innerHTML = '<div style="padding:18px;text-align:center;color:var(--text3);font-size:12px">Sin cargas registradas.</div>'; return; }
  const rows = _fuelKmRows(ym);
  if (!rows.length) { cont.innerHTML = '<div style="padding:18px;text-align:center;color:var(--text3);font-size:12px">Sin cargas de combustible en ' + _fuelMonthLabel(ym) + '.</div>'; return; }
  const totKm = rows.filter(r => r.unit === 'km').reduce((a, r) => a + (r.recorrido || 0), 0);
  const totLt = rows.reduce((a, r) => a + r.litros, 0);
  cont.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Unidad</th><th style="text-align:right">Km / Horas del mes</th><th style="text-align:right">Litros</th><th style="text-align:right">Cargas</th></tr></thead>
      <tbody>
        ${rows.map(r => {
          const rec = r.recorrido != null ? (r.recorrido.toLocaleString('es-AR') + ' ' + r.unit) : '<span style="color:var(--text3)">— (1 lectura)</span>';
          return `<tr>
            <td class="td-mono td-main">${escapeHtml(r.code)}</td>
            <td class="td-mono" style="text-align:right;font-weight:600">${rec}</td>
            <td class="td-mono" style="text-align:right">${Math.round(r.litros).toLocaleString('es-AR')} L</td>
            <td class="td-mono" style="text-align:right">${r.cargas}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
    <div style="padding:8px 14px;font-size:11px;color:var(--text3);border-top:1px solid var(--border)">
      Total recorrido (vehículos): <b>${totKm.toLocaleString('es-AR')} km</b> · Litros del mes: <b>${Math.round(totLt).toLocaleString('es-AR')} L</b> · Las autoelevadoras se miden en horas (h).
    </div>`;
}
// Exporta a PDF la tabla de km/horas por unidad del mes elegido.
function exportFuelKmPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) { showToast?.('error', 'jsPDF no cargado. Refrescá la página.'); return; }
  const ym = App.fuelKmMonth;
  const rows = _fuelKmRows(ym);
  if (!rows.length) { showToast('warn', 'No hay cargas en ' + _fuelMonthLabel(ym)); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const startY = _pdfHeader(doc, 'Km / horas por unidad — ' + _fuelMonthLabel(ym), `${rows.length} unidad${rows.length === 1 ? '' : 'es'} con cargas`);
  const totKm = rows.filter(r => r.unit === 'km').reduce((a, r) => a + (r.recorrido || 0), 0);
  const totLt = rows.reduce((a, r) => a + r.litros, 0);
  const body = rows.map(r => [
    r.code,
    r.recorrido != null ? (r.recorrido.toLocaleString('es-AR') + ' ' + r.unit) : '— (1 lectura)',
    Math.round(r.litros).toLocaleString('es-AR') + ' L',
    String(r.cargas),
  ]);
  doc.autoTable({
    startY,
    head: [['Unidad', 'Km / Horas del mes', 'Litros', 'Cargas']],
    body,
    ..._pdfTableStyle(),
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    foot: [['TOTAL (vehículos)', totKm.toLocaleString('es-AR') + ' km', Math.round(totLt).toLocaleString('es-AR') + ' L', '']],
  });
  doc.save(`Km-por-unidad-Biletta-${ym}.pdf`);
  showToast('ok', 'PDF descargado');
}
function renderFuel() {
  // Reset del tamaño de página del listado (el "Ver más" muestra de a más).
  window._fuelPageSize = 10;
  // Asegurar TODAS las cargas antes de calcular rendimiento/litros. Si no, los KPIs
  // cambiaban según cuántas páginas se hubieran traído (100 al entrar → 200 tras
  // pasar por Costos), y el rendimiento "saltaba" al recargar o navegar.
  if (!window._fuelAllLoaded && !window._fuelLoadingAll) {
    window._fuelLoadingAll = true;
    _ensureAllFuelLoaded().then(() => {
      window._fuelLoadingAll = false;
      if (document.getElementById('page-fuel')) renderFuel();
    });
  }
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
  const gasoilClass = tankLevel < 10000 ? 'warn' : 'info';
  const ureaClass   = ureaPct   < 20 ? 'warn' : 'info';
  const tankEntries = App.data.tankEntries || [];
  const fuelDispatches = App.data.fuelDispatches || [];
  const esGerenteSucursal = _fuelIsGerenteSucursal();
  const branchName = _fuelCurrentBranchName();
  const fuelTitlePrefix = esGerenteSucursal ? `Stock ${branchName}` : 'Stock cisterna';
  const levelTitle = esGerenteSucursal ? 'Nivel de tanque de sucursal' : 'Nivel de cisternas';
  const dispatchHelp = esGerenteSucursal
    ? 'Combustible recibido desde casa central para la sucursal. Al recibirse debe quedar disponible en el tanque propio.'
    : 'Salida de cisterna sin cargar consumo a una unidad. Genera remito interno imprimible.';

  // ── Litros cargados HOY ──
  const today = todayISO();
  const logsHoy = App.data.fuelLogs.filter(f => f.date && f.date.startsWith(today));
  const litrosHoy = logsHoy.reduce((a,b) => a + (b.liters||0), 0);

  // ── Rendimiento promedio real ──
  // Necesita logs con km y litros. Calcular km/litro por vehiculo en últimos 30 días
  const logsConKm = App.data.fuelLogs.filter(f => f.km > 0 && f.liters > 0 && String(f.fuel_type||'').toLowerCase() !== 'urea');
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
  // Resumen mensual de km/horas por unidad (selector de mes por defecto = el más reciente con cargas).
  const kmMonths = _fuelKmMonths();
  if (!App.fuelKmMonth || !kmMonths.includes(App.fuelKmMonth)) App.fuelKmMonth = kmMonths[0] || '';
  const kmMonthOpts = kmMonths.length
    ? kmMonths.map(m => `<option value="${m}"${m === App.fuelKmMonth ? ' selected' : ''}>${_fuelMonthLabel(m)}</option>`).join('')
    : '<option>Sin datos</option>';

  document.getElementById('page-fuel').innerHTML = `
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card ${gasoilClass}"><div class="kpi-label">${fuelTitlePrefix} gasoil</div><div class="kpi-value ${gasoilClass}">${tankLevel.toLocaleString()} L</div><div class="kpi-trend">${gasoilPct}% de capacidad (${tankCap.toLocaleString()} L)${tankLevel<10000?' · ⚠ Pedir gasoil / cotizar compra':gasoilPct<20?' · ⚠ Solicitar reposición':''}</div></div>
      <div class="kpi-card ${ureaClass}"><div class="kpi-label">${fuelTitlePrefix} urea</div><div class="kpi-value ${ureaClass}">${ureaLevel.toLocaleString()} L</div><div class="kpi-trend">${ureaPct}% de capacidad (${ureaCap.toLocaleString()} L)${ureaPct<20?' · ⚠ Solicitar reposición':''}</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Litros cargados hoy</div><div class="kpi-value ok">${litrosHoy.toLocaleString()}</div><div class="kpi-trend">en ${logsHoy.length} cargas · ${App.data.fuelLogs.length} total historial</div></div>
      ${(() => {
        // Mientras falta traer el historial completo, el promedio saldría de una
        // porción de las cargas y "bailaría" al completarse (p. ej. 7.2 → 5.2).
        // Mejor mostrar que se está calculando y pintar el número una sola vez.
        if (!window._fuelAllLoaded) return `<div class="kpi-card"><div class="kpi-label">Rendimiento promedio</div><div class="kpi-value white">…</div><div class="kpi-trend">calculando con el historial completo…</div></div>`;
        return `<div class="kpi-card ${rendimiento==='—'?'':'ok'}"><div class="kpi-label">Rendimiento promedio</div><div class="kpi-value ${rendimiento==='—'?'white':'ok'}">${rendimiento}</div><div class="kpi-trend">${rendTrend}</div></div>`;
      })()}
    </div>
    <div class="two-col" style="margin-bottom:20px">
      <div class="card">
        <div class="card-title">${levelTitle}</div>
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px"><span>Gasoil</span><span class="td-mono">${tankLevel.toLocaleString()} / ${tankCap.toLocaleString()} L</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${gasoilPct}%;background:${gasoilPct<20?'var(--warn)':'var(--ok)'}"></div></div>
        </div>
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px"><span ${ureaPct<20?'style="color:var(--warn)"':''}>Urea / AdBlue</span><span class="td-mono" ${ureaPct<20?'style="color:var(--warn)"':''}>${ureaLevel.toLocaleString()} / ${ureaCap.toLocaleString()} L ${ureaPct<20?'⚠':''}</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${ureaPct}%;background:${ureaPct<20?'var(--warn)':'var(--ok)'}"></div></div>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          ${_fuelPuedeGestionarCisterna(App.currentUser?.role) ? `<button class="btn btn-primary" onclick="openFuelEntryModal()">+ Registrar ingreso a cisterna</button><button class="btn btn-secondary" onclick="openEditTankCapacityModal()">⚙ Editar capacidad</button>` : ''}
          ${_fuelPuedeGestionarDespachos(App.currentUser?.role) ? `<button class="btn btn-secondary" onclick="openFuelDispatchModal()">🚚 Despacho interno</button>` : ''}
          ${esGerenteSucursal ? `<button class="btn btn-primary" onclick="openFuelLoadModal()">⛽ Cargar desde tanque de sucursal</button>` : ''}
          ${_fuelPuedeVerificarTickets(App.currentUser?.role) ? `<button class="btn btn-warn" onclick="openVerificacionTickets()" style="background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.4);color:var(--warn)">🧾 Verificar tickets</button>` : ''}
        </div>
        <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-size:11px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">🧾 Últimos tickets de ingreso</div>
            ${tankEntries.length ? `<span style="font-size:10px;color:var(--text3)">${tankEntries.length} registrados</span>` : ''}
          </div>
          ${tankEntries.length === 0 ? `
            <div style="font-size:12px;color:var(--text3);background:var(--bg3);border-radius:var(--radius);padding:10px">Todavía no hay ingresos a cisterna registrados con ticket.</div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:6px;max-height:145px;overflow:auto">
              ${tankEntries.slice(0,5).map(e => `
                <div style="display:flex;align-items:center;gap:8px;background:var(--bg3);border-radius:var(--radius);padding:8px 10px;font-size:12px">
                  <span style="font-family:var(--mono);color:var(--accent);font-weight:700">${_fuelTankEntryCode(e)}</span>
                  <span style="flex:1">${_fuelTankTypeLabel(e.type)} · <b>${Math.round(e.liters).toLocaleString('es-AR')} L</b> ${e.supplier ? '· '+escapeHtml(e.supplier) : ''}</span>
                  <button class="btn btn-secondary btn-sm" onclick="openFuelTankEntryTicket('${e.id}')">Ver ticket</button>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
      <div class="card">
        <div class="card-title">Consumo por unidad (últimos 30 días)</div>
        <div style="position:relative;height:180px"><canvas id="fuelChart" role="img" aria-label="Consumo de combustible por unidad"></canvas></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        <div>
          <div class="card-title" style="margin:0">🚚 Despachos internos a sucursales / bidones</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">${dispatchHelp}</div>
        </div>
        ${_fuelPuedeGestionarDespachos(App.currentUser?.role) ? `<button class="btn btn-primary btn-sm" onclick="openFuelDispatchModal()">+ Nuevo despacho</button>` : ''}
      </div>
      ${fuelDispatches.length === 0 ? `
        <div style="padding:18px;text-align:center;color:var(--text3);font-size:12px">Todavía no hay despachos internos registrados.</div>
      ` : `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Fecha</th><th>Destino</th><th>Producto</th><th>Litros</th><th>Responsable</th><th>Estado</th><th></th>
            </tr></thead>
            <tbody>
              ${fuelDispatches.slice(0,8).map(d => `
                <tr>
                  <td class="td-mono" style="font-size:11px">${d.date || '—'}</td>
                  <td><b>${d.destination || '—'}</b>${d.destination_detail ? `<div style="font-size:11px;color:var(--text3)">${d.destination_detail}</div>` : ''}</td>
                  <td><span class="badge ${d.type==='urea'?'badge-info':'badge-ok'}">${d.type==='urea'?'🔵 Urea':'🟡 Gasoil'}</span></td>
                  <td class="td-mono">${Math.round(d.liters||0).toLocaleString('es-AR')} L</td>
                  <td>${escapeHtml(d.responsible || d.created_by_name || '—')}</td>
                  <td><span class="badge ${d.status==='recibido'?'badge-ok':'badge-warn'}">${d.status==='recibido'?'Recibido':'Despachado'}</span></td>
                  <td>
                    <div style="display:flex;gap:4px;flex-wrap:wrap">
                      <button class="btn btn-secondary btn-sm" onclick="openFuelDispatchTicket('${d.id}')">🧾 Remito</button>
                      ${d.status !== 'recibido' && _fuelPuedeRecibirDespachos(App.currentUser?.role) ? `<button class="btn btn-primary btn-sm" onclick="openFuelDispatchReceiveModal('${d.id}')">✓ Recibir</button>` : ''}
                      ${d.status === 'recibido' && !d.destination_stock_applied && _fuelPuedeRecibirDespachos(App.currentUser?.role) ? `<button class="btn btn-primary btn-sm" onclick="applyFuelDispatchToBranchTank('${d.id}')">↪ Sumar al tanque</button>` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <div class="section-header">
      <div><div class="section-title">Registro de cargas</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="form-input" id="fuel-search" placeholder="🔍 Buscar por unidad, chofer, fecha..."
          oninput="_filterFuelLogs()" style="width:260px;font-size:13px">
        <select class="form-select" id="fuel-type-filter" onchange="_filterFuelLogs()" style="width:130px;font-size:13px">
          <option value="all">Todos los tipos</option>
          <option value="diesel">🟡 Gasoil</option>
          <option value="urea">🔵 Urea</option>
        </select>
        <button class="btn btn-secondary btn-sm" onclick="exportFuelPDF()">📄 Exportar PDF</button>
        ${_fuelPuedeRegistrarCarga(App.currentUser?.role) ? `<button class="btn btn-primary" onclick="openFuelLoadModal()">${esGerenteSucursal ? '⛽ Cargar desde tanque' : '+ Registrar carga'}</button>` : ''}
      </div>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table class="table-cards"><thead><tr>
          <th onclick="_fuelSortBy('date')" style="cursor:pointer;user-select:none">Fecha <span id="fuel-sort-date" style="opacity:.3">⇅</span></th>
          <th onclick="_fuelSortBy('vehicle')" style="cursor:pointer;user-select:none">Unidad <span id="fuel-sort-vehicle" style="opacity:.3">⇅</span></th>
          <th onclick="_fuelSortBy('driver')" style="cursor:pointer;user-select:none">Chofer <span id="fuel-sort-driver" style="opacity:.3">⇅</span></th>
          <th>Tipo</th>
          <th onclick="_fuelSortBy('liters')" style="cursor:pointer;user-select:none">Litros <span id="fuel-sort-liters" style="opacity:.3">⇅</span></th>
          <th title="Odómetro (km) para vehículos, horómetro (h) para autoelevadores">Odóm. / Horóm.</th>
          ${_fuelPuedeVerPrecios(App.currentUser?.role) ? `
            <th>Precio/L</th>
            <th onclick="_fuelSortBy('total')" style="cursor:pointer;user-select:none">Total <span id="fuel-sort-total" style="opacity:.3">⇅</span></th>
          ` : ''}
          <th>Lugar</th>
          <th>Estado</th>
          <th>Ticket</th>
        </tr></thead>
        <tbody id="fuel-logs-tbody">${_renderFuelLogRows((App.data.fuelLogs||[]).slice(0, 10))}</tbody>
        </table>
      </div>
      <div id="fuel-count-info" style="padding:8px 14px;font-size:11px;color:var(--text3);border-top:1px solid var(--border)">
        Mostrando <b>${Math.min(10, App.data.fuelLogs.length)}</b> de ${App.data.fuelLogs.length} cargas${App.data.fuelLogs.length > 10 ? ` · <a onclick="_fuelLoadMore()" style="color:var(--accent);cursor:pointer;font-weight:600">Ver más →</a>` : ''}
      </div>
    </div>

    <div class="card" style="margin-top:20px;padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        <div>
          <div class="card-title" style="margin:0">📏 Km / horas por unidad en el mes</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">Recorrido del mes según el odómetro (o horómetro, en autoelevadoras) de las cargas de combustible.</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <select class="form-select" id="fuel-km-month" onchange="App.fuelKmMonth=this.value;_renderFuelKmTable()" style="width:170px;font-size:13px">${kmMonthOpts}</select>
          <button class="btn btn-secondary btn-sm" onclick="exportFuelKmPDF()">📄 PDF</button>
        </div>
      </div>
      <div id="fuel-km-body"></div>
    </div>
  `;
  _renderFuelKmTable();
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
  const esGerenteSucursal = _fuelIsGerenteSucursal();
  const branchName = _fuelCurrentBranchName();
  const vehicleOpts = (App.data.vehicles||[]).map(v=>`<option value="${v.id}">${escapeHtml(v.code)} — ${escapeHtml(v.plate)}</option>`).join('');
  const initialTankOptions = esGerenteSucursal
    ? _fuelTanksForType('diesel').map(t => `<option value="${String(t.location || '').replace(/"/g,'&quot;')}">${escapeHtml(t.location || 'Tanque sucursal')} (${Math.round(parseFloat(t.current_l)||0).toLocaleString('es-AR')} L)</option>`).join('')
    : `<option value="Cisterna R3">Cisterna R3 (descuenta stock)</option><option value="Estación de servicio">Estación de servicio</option><option value="Bidón / Sucursal">Bidón / Sucursal</option><option value="Otra">Otra</option>`;
  openModal(esGerenteSucursal ? `Cargar consumo interno — ${branchName}` : 'Registrar carga de combustible / urea', `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Unidad</label>
        <select class="form-select" id="fl-vehicle" onchange="updateFuelVehicleMeasure()">
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
      <div class="form-group"><label class="form-label">${esGerenteSucursal ? 'Responsable / operador' : 'Chofer'}</label><input class="form-input" placeholder="${esGerenteSucursal ? 'Nombre de quien carga o usa' : 'Nombre del chofer'}" id="fl-driver"></div>
      <div class="form-group"><label class="form-label">Lugar de carga</label>
        <select class="form-select" id="fl-place" onchange="updateFuelPlaceNote()">
          ${initialTankOptions || '<option value="">— Sin tanque disponible —</option>'}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Litros cargados</label><input class="form-input" type="number" placeholder="400" id="fl-liters"></div>
      <div class="form-group" id="fl-measure-wrap"><label class="form-label" id="fl-measure-label">Km actual del odómetro *</label><input class="form-input" id="fl-km" type="number" min="0" step="1" placeholder="Ej: 263958"></div>
    </div>
    <div class="form-row" id="fl-ppu-wrap">
      <div class="form-group"><label class="form-label" id="fl-ppu-label">Precio por litro ($)</label><input class="form-input" type="number" placeholder="1250" id="fl-ppu" value="1250"></div>
    </div>
    <div id="fl-place-note" style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--warn);margin-top:4px">
      ⚠ Los litros se descontarán del stock de cisterna al confirmar.
    </div>
    <div class="form-group" id="fl-ticket-wrap" style="margin-top:10px">
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
  // Autocompletar precio al abrir si ya hay cisterna seleccionada
  if (esGerenteSucursal && !_fuelTanksForType('diesel').length && !_fuelTanksForType('urea').length) {
    setTimeout(() => showToast('warn', 'Tu sucursal todavía no tiene tanque recibido. Primero debe llegar y recibirse un despacho interno.'), 150);
  }
  setTimeout(() => { updateFuelVehicleMeasure(); updateFuelPlaceNote(); }, 100);
}

function updateFuelVehicleMeasure() {
  const vehId = document.getElementById('fl-vehicle')?.value || '';
  const v = (App.data.vehicles || []).find(x => String(x.id) === String(vehId));
  // Autocompletar el chofer con el asignado a la unidad. Queda editable por si
  // ese día maneja un suplente.
  const driverInput = document.getElementById('fl-driver');
  if (driverInput && v) driverInput.value = (v.driver && v.driver !== '—') ? v.driver : '';
  const label = document.getElementById('fl-measure-label');
  const input = document.getElementById('fl-km');
  if (!label || !input) return;
  const isFork = v && normalizeVehicleTypeLabel(v.type) === 'autoelevador';
  if (isFork) {
    label.innerHTML = 'Horas actuales del autoelevador *';
    input.disabled = false;
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    // NO autocompletamos las horas: el campo queda vacío para forzar leer el
    // horómetro real (igual que el odómetro de los camiones). Si se precarga el
    // último valor, el operador tiende a aceptarlo sin mirar el reloj y todas las
    // cargas quedan con la misma hora → no se puede calcular el costo/hora.
    // La última lectura va de referencia en el placeholder, no en el valor.
    input.placeholder = v?.km_current ? `Leé el horómetro real — última: ${Number(v.km_current).toLocaleString('es-AR')} h` : 'Leé el horómetro real';
    input.value = '';
    input.style.opacity = '1';
  } else {
    label.innerHTML = 'Km actual del odómetro *';
    input.disabled = false;
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.placeholder = 'Ej: 263958';
    input.value = '';
    input.style.opacity = '1';
  }
}

function updateFuelPlaceOpts() {
  const tipo = document.getElementById('fl-type')?.value;
  const placeEl = document.getElementById('fl-place');
  if (!placeEl) return;
  if (_fuelIsGerenteSucursal()) {
    const opts = _fuelTanksForType(tipo === 'urea' ? 'urea' : 'diesel')
      .map(t => `<option value="${String(t.location || '').replace(/"/g,'&quot;')}">${escapeHtml(t.location || 'Tanque sucursal')} (${Math.round(parseFloat(t.current_l)||0).toLocaleString('es-AR')} L)</option>`)
      .join('');
    placeEl.innerHTML = opts || '<option value="">— Sin tanque disponible —</option>';
    updateFuelPlaceNote();
    return;
  }
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

async function updateFuelPlaceNote() {
  const place  = document.getElementById('fl-place')?.value || '';
  const type   = document.getElementById('fl-type')?.value  || 'diesel';
  const noteEl = document.getElementById('fl-place-note');
  const ppuEl  = document.getElementById('fl-ppu');
  const ppuWrap     = document.getElementById('fl-ppu-wrap');
  const ticketWrap  = document.getElementById('fl-ticket-wrap');
  if (!noteEl) return;
  const descuenta = _fuelIsInternalTankPlace(place, type);

  // ── Regla de visibilidad por rol+lugar ──
  const role = App.currentUser?.role;
  const puedeVerPrecios = _fuelPuedeVerPrecios(role);

  if (descuenta) {
    // Carga desde CISTERNA PROPIA → precio se toma automático del tanque
    // El jefe_mantenimiento NO ve el precio ni el ticket (todo lo gestiona compras)
    if (!puedeVerPrecios) {
      if (ppuWrap)    ppuWrap.style.display    = 'none';
      if (ticketWrap) ticketWrap.style.display = 'none';
    } else {
      if (ppuWrap)    ppuWrap.style.display    = '';
      if (ticketWrap) ticketWrap.style.display = '';
    }
    noteEl.style.background  = 'rgba(34,197,94,.1)';
    noteEl.style.borderColor = 'rgba(34,197,94,.3)';
    noteEl.style.color       = 'var(--ok)';

    // Recargar tanks frescos para tener el precio actualizado
    try {
      const tr = await apiFetch('/api/fuel/tanks');
      if (tr.ok) App.data.tanks = await tr.json();
    } catch(e) {}

    let tank = _fuelFindTankByPlaceAndType(place, type) || _fuelFindTankForType(type);
    const precio = tank?.price_per_l ? parseFloat(tank.price_per_l) : null;

    if (puedeVerPrecios && ppuEl && precio && precio > 0) {
      // Precio fijo — no editable
      ppuEl.value    = precio;
      ppuEl.readOnly = true;
      ppuEl.style.opacity    = '0.65';
      ppuEl.style.cursor     = 'not-allowed';
      ppuEl.style.background = 'var(--bg3)';
      ppuEl.title            = 'Precio fijado por el abastecimiento de cisterna';
      const ppuLabel = document.getElementById('fl-ppu-label');
      if (ppuLabel) ppuLabel.innerHTML = 'Precio por litro <span style="color:var(--ok);font-size:11px;font-weight:400">🔒 fijado por cisterna</span>';
      noteEl.innerHTML = `💡 Litros se descontarán de cisterna · <strong>$${Math.round(precio).toLocaleString('es-AR')}/L</strong>`;
    } else if (puedeVerPrecios) {
      if (ppuEl) { ppuEl.readOnly = false; ppuEl.style.opacity = '1'; ppuEl.style.cursor = ''; ppuEl.style.background = ''; }
      noteEl.textContent = '⚠ Sin precio configurado en cisterna — compras debe actualizarlo. Se guarda sin precio hasta entonces.';
    } else {
      // Jefe mant / chofer: solo ven el mensaje informativo (sin precio)
      noteEl.innerHTML = _fuelIsGerenteSucursal() ? `💡 Carga interna desde tanque de sucursal — se descuenta stock y se genera ticket interno.` : `💡 Carga desde cisterna — los litros se descontarán del stock. El precio lo gestiona compras.`;
      // Forzar que el precio quede como 0 ó el de la cisterna (backend ignora este valor igual si hay tank_id)
      if (ppuEl) ppuEl.value = precio || 0;
    }
  } else {
    // ── CARGA EXTERNA (estación de servicio, bidón, etc) ──
    // Acá SIEMPRE se pide precio y ticket, incluso para jefe mant (viene del ticket que él tiene)
    if (ppuWrap)    ppuWrap.style.display    = '';
    if (ticketWrap) ticketWrap.style.display = '';

    if (ppuEl) {
      ppuEl.readOnly = false; ppuEl.style.opacity = '1';
      ppuEl.style.cursor = ''; ppuEl.style.background = ''; ppuEl.title = '';
      // Si venía en 0 (porque era cisterna), limpiar el valor
      if (parseFloat(ppuEl.value) === 0) ppuEl.value = '';
      const ppuLabel = document.getElementById('fl-ppu-label');
      if (ppuLabel) ppuLabel.innerHTML = 'Precio por litro ($) <span style="color:var(--danger);font-size:11px">*</span>';
    }
    noteEl.style.background  = 'rgba(99,102,241,.1)';
    noteEl.style.borderColor = 'rgba(99,102,241,.3)';
    noteEl.style.color       = 'var(--info, #60a5fa)';
    noteEl.innerHTML         = '📦 Carga externa — cargá el <strong>precio del ticket</strong> y subí la <strong>foto del ticket</strong>.';
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
  const vehSel = (App.data.vehicles || []).find(x => String(x.id) === String(vehicle_id));
  const isForkFuel = vehSel && normalizeVehicleTypeLabel(vehSel.type) === 'autoelevador';
  if (isForkFuel && (!km || km <= 0)) { showToast('error','Ingresá las horas actuales del autoelevador'); return; }
  if (!isForkFuel && type !== 'urea' && (!km || km <= 0)) { showToast('error','Ingresá el km actual del odómetro'); return; }

  // Solo descontar de cisterna si el lugar es cisterna
  const esCisterna = _fuelIsInternalTankPlace(place, type);
  let tank_id = null;
  if (esCisterna) {
    // Matchear el tanque por TIPO + LOCATION (no solo por tipo).
    // Para gerente_sucursal, App.data.tanks ya viene limitado a su sucursal.
    const tank = _fuelFindTankByPlaceAndType(place, type) || _fuelFindTankForType(type);
    tank_id = tank?.id || null;
    if (!tank_id) {
      showToast('error','No se encontró tanque/cisterna para ' + type + ' en ' + (place || 'la sucursal'));
      return;
    }
  }
  if (_fuelIsGerenteSucursal() && !tank_id) {
    showToast('error','La sucursal solo puede cargar desde su tanque interno');
    return;
  }

  window._ticketImage = null;

  const res = await apiFetch('/api/fuel', {
    method: 'POST',
    body: JSON.stringify({
      vehicle_id, liters, price_per_l: ppu,
      driver, fuel_type: type,
      location: place, tank_id, ticket_image: ticketImg, odometer_km: km || null
    })
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error || 'Error al registrar carga'); return; }
  const savedLog = await res.json().catch(() => null);

  const msg = esCisterna
    ? `Carga registrada — ${liters}L descontados de cisterna · ticket interno generado`
    : `Carga registrada — ${place}${ticketImg ? ' · con ticket 📄' : ''}`;
  closeModal(); showToast('ok', msg);
  await afterSave({ page: 'fuel' });

  // Si fue una carga desde cisterna a vehículo, abrir ticket básico imprimible.
  if (esCisterna && savedLog?.id) {
    setTimeout(() => openFuelVehicleTicket(savedLog.id), 200);
  }
}


// viewTicket está definido más abajo con versión mejorada (vista con metadatos)

function openFuelEntryModal() {
  const tanks = App.data.tanks || [];
  const gasoilTank = tanks.find(t => t.type === 'fuel' || t.type === 'gasoil');
  const ureaTank   = tanks.find(t => t.type === 'urea');
  const gasoilNivel = gasoilTank ? `${Math.round(gasoilTank.current_l).toLocaleString()} / ${Math.round(gasoilTank.capacity_l).toLocaleString()} L` : 'Sin datos';
  const ureaNivel   = ureaTank   ? `${Math.round(ureaTank.current_l).toLocaleString()} / ${Math.round(ureaTank.capacity_l).toLocaleString()} L` : 'Sin datos';
  openModal('Ingreso a cisterna', `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Tipo</label>
        <select class="form-select" id="fe-type" onchange="document.getElementById('fe-nivel-actual').textContent=this.value==='gasoil'?'${gasoilNivel}':'${ureaNivel}'">
          <option value="gasoil">Gasoil</option>
          <option value="urea">Urea / AdBlue</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Litros a ingresar</label><input class="form-input" type="number" placeholder="5000" id="fe-liters" min="1"></div>
    </div>
    <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--text3);margin-bottom:10px">
      Nivel actual: <strong id="fe-nivel-actual">${gasoilNivel}</strong>
    </div>
    ${_fuelPuedeVerPrecios(App.currentUser?.role) ? `
      <div class="form-row">
        <div class="form-group"><label class="form-label">Proveedor</label><input class="form-input" placeholder="Nombre del proveedor" id="fe-supplier"></div>
        <div class="form-group"><label class="form-label">Precio por litro ($)</label><input class="form-input" type="number" placeholder="1200" id="fe-ppu"></div>
      </div>
      <div class="form-group"><label class="form-label">Número de remito</label><input class="form-input" placeholder="REM-00001" id="fe-remito"></div>
    ` : `
      <div style="background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.3);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--accent);display:flex;align-items:center;gap:8px">
        <span style="font-size:16px">💡</span>
        <span>Registrá los <b>litros recibidos</b>. El <b>precio y datos del proveedor</b> los gestionará compras cuando llegue la factura.</span>
      </div>
    `}
  `, [
    { label:'Confirmar ingreso', cls:'btn-primary', fn: saveFuelEntry },
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal }
  ]);
}

async function saveFuelEntry() {
  const type     = document.getElementById('fe-type')?.value || 'gasoil';
  const liters   = parseFloat(document.getElementById('fe-liters')?.value) || 0;
  const supplier = (document.getElementById('fe-supplier')?.value || '').trim();
  const remito   = (document.getElementById('fe-remito')?.value || '').trim();
  const ppu      = _fuelPuedeVerPrecios(App.currentUser?.role) ? (parseFloat(document.getElementById('fe-ppu')?.value) || null) : null;

  if (liters <= 0) { showToast('error', 'Ingresá la cantidad de litros'); return; }

  const tanks = App.data.tanks || [];
  const tipoDb = type === 'urea' ? 'urea' : 'fuel';
  // Prefiere el tanque de "Cisterna R3" si existe. Si no, cualquiera del tipo correcto.
  let tank = tanks.find(t => (t.type === tipoDb || (tipoDb === 'fuel' && t.type === 'gasoil')) && (t.location || '').includes('Cisterna R3'));
  if (!tank) {
    tank = tanks.find(t => t.type === tipoDb || (tipoDb === 'fuel' && t.type === 'gasoil'));
  }

  if (!tank) { showToast('error', 'No se encontró la cisterna en el sistema'); return; }

  const capacidad   = parseFloat(tank.capacity_l) || 47000;
  const nivelActual = parseFloat(tank.current_l) || 0;
  const nuevoNivel  = nivelActual + liters;

  if (nuevoNivel > capacidad) {
    showToast('error', `Excede la capacidad (${capacidad.toLocaleString()} L). Nivel actual: ${Math.round(nivelActual).toLocaleString()} L`);
    return;
  }

  const res = await apiFetch('/api/fuel/tank-entries', {
    method: 'POST',
    body: JSON.stringify({
      tank_id: tank.id,
      type,
      liters,
      price_per_l: ppu,
      supplier,
      remito,
      notes: 'Ingreso registrado desde módulo Combustible'
    })
  });

  if (!res.ok) {
    let e = {};
    try { e = await res.json(); } catch(_) {}
    showToast('error', e.error || 'Error al registrar ingreso');
    return;
  }

  const data = await res.json();
  const entry = data.entry || null;

  // Actualizar en memoria para que se vea sin Ctrl+F5.
  if (data.tank) {
    const idx = (App.data.tanks || []).findIndex(t => t.id === data.tank.id);
    if (idx >= 0) App.data.tanks[idx] = data.tank;
  } else {
    tank.current_l = nuevoNivel;
    if (ppu) tank.price_per_l = ppu;
  }
  if (entry) {
    const mapped = {
      id: entry.id,
      type: entry.type || type,
      liters: parseFloat(entry.liters) || liters,
      price_per_l: entry.price_per_l === null || entry.price_per_l === undefined ? ppu : parseFloat(entry.price_per_l),
      supplier: entry.supplier || supplier,
      remito: entry.remito || remito,
      notes: entry.notes || '',
      previous_l: parseFloat(entry.previous_l) || nivelActual,
      new_l: parseFloat(entry.new_l) || nuevoNivel,
      created_at: entry.created_at_ar || entry.created_at || fleetNowIsoAR(),
      created_at_ar: entry.created_at_ar || null,
      date: fleetDisplayAR(entry.created_at_ar || entry.created_at || fleetNowIsoAR()),
      tank_id: entry.tank_id || tank.id,
      tank_location: tank.location || 'Cisterna',
      created_by_name: App.currentUser?.name || '—',
      _raw: entry
    };
    App.data.tankEntries = [mapped, ...(App.data.tankEntries || [])];
  }

  closeModal();
  showToast('ok', `✅ ${liters.toLocaleString()} L de ${_fuelTankTypeLabel(type)} ingresados a cisterna — ticket generado`);

  try { await loadInitialData(); } catch(e) {}
  renderFuel();
  if (entry) setTimeout(() => openFuelTankEntryTicket(entry.id || entry), 150);
}

function openFuelTankEntryTicket(entryOrId) {
  const entries = App.data.tankEntries || [];
  const entry = typeof entryOrId === 'string'
    ? entries.find(e => e.id === entryOrId)
    : entryOrId;

  if (!entry) { showToast('error', 'No se encontró el ticket de cisterna'); return; }

  const ticketCode = _fuelTankEntryCode(entry);
  const litros = Math.round(parseFloat(entry.liters) || 0).toLocaleString('es-AR');
  const ppu = entry.price_per_l !== null && entry.price_per_l !== undefined && !isNaN(parseFloat(entry.price_per_l))
    ? '$' + Math.round(parseFloat(entry.price_per_l)).toLocaleString('es-AR')
    : '—';
  const total = entry.price_per_l !== null && entry.price_per_l !== undefined && !isNaN(parseFloat(entry.price_per_l))
    ? '$' + Math.round((parseFloat(entry.liters)||0) * (parseFloat(entry.price_per_l)||0)).toLocaleString('es-AR')
    : '—';
  const fecha = fleetDateTimeAR(entry.created_at_ar || entry.created_at || entry.date);

  openModal(`🧾 Ticket ${ticketCode}`, `
    <div id="fuel-tank-ticket-print" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:18px">
      <div style="display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:14px">
        <div>
          <div style="font-size:18px;font-weight:900;color:var(--text)">Expreso Biletta SRL</div>
          <div style="font-size:12px;color:var(--text3)">Ingreso a cisterna</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:900;color:var(--accent);font-family:var(--mono)">${ticketCode}</div>
          <div style="font-size:11px;color:var(--text3)">${fecha}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
        <div><b>Producto</b><br>${_fuelTankTypeLabel(entry.type)}</div>
        <div><b>Litros ingresados</b><br>${litros} L</div>
        <div><b>Cisterna</b><br>${entry.tank_location || 'Cisterna'}</div>
        <div><b>Proveedor</b><br>${escapeHtml(entry.supplier || "—")}</div>
        <div><b>Remito</b><br>${escapeHtml(entry.remito || '—')}</div>
        <div><b>Precio/L</b><br>${ppu}</div>
        <div><b>Total estimado</b><br>${total}</div>
        <div><b>Registró</b><br>${escapeHtml(entry.created_by_name || App.currentUser?.name || '—')}</div>
      </div>

      <div style="margin-top:14px;background:var(--bg3);border-radius:var(--radius);padding:10px;font-size:12px;color:var(--text2)">
        Nivel anterior: <b>${Math.round(parseFloat(entry.previous_l)||0).toLocaleString('es-AR')} L</b> ·
        Nivel nuevo: <b>${Math.round(parseFloat(entry.new_l)||0).toLocaleString('es-AR')} L</b>
      </div>
    </div>
  `, [
    { label:'🖨 Imprimir ticket', cls:'btn-primary', fn: () => printFuelTankEntryTicket(entry.id) },
    { label:'Cerrar', cls:'btn-secondary', fn: closeModal }
  ]);
}

function printFuelTankEntryTicket(entryId) {
  const entry = (App.data.tankEntries || []).find(e => e.id === entryId);
  if (!entry) { showToast('error', 'No se encontró el ticket'); return; }

  const ticketCode = _fuelTankEntryCode(entry);
  const litros = Math.round(parseFloat(entry.liters) || 0).toLocaleString('es-AR');
  const ppuVal = entry.price_per_l !== null && entry.price_per_l !== undefined && !isNaN(parseFloat(entry.price_per_l));
  const ppu = ppuVal ? '$' + Math.round(parseFloat(entry.price_per_l)).toLocaleString('es-AR') : '—';
  const total = ppuVal ? '$' + Math.round((parseFloat(entry.liters)||0) * (parseFloat(entry.price_per_l)||0)).toLocaleString('es-AR') : '—';
  const fecha = fleetDateTimeAR(entry.created_at_ar || entry.created_at || entry.date);

  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>${ticketCode}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111827}
      .ticket{border:1px solid #d1d5db;border-radius:10px;padding:18px;max-width:720px;margin:auto}
      .head{display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding-bottom:12px;margin-bottom:14px}
      .brand{font-size:20px;font-weight:800}.sub{font-size:12px;color:#6b7280}.code{font:700 16px monospace;color:#2563eb;text-align:right}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px}.box{background:#f3f4f6;border-radius:8px;padding:10px;margin-top:14px;font-size:12px}
      b{display:block;margin-bottom:3px;color:#374151}@media print{button{display:none}}
    </style></head><body>
      <div class="ticket">
        <div class="head"><div><div class="brand">Expreso Biletta SRL</div><div class="sub">Ingreso a cisterna</div></div><div><div class="code">${ticketCode}</div><div class="sub">${fecha}</div></div></div>
        <div class="grid">
          <div><b>Producto</b>${_fuelTankTypeLabel(entry.type)}</div><div><b>Litros ingresados</b>${litros} L</div>
          <div><b>Cisterna</b>${escapeHtml(entry.tank_location || 'Cisterna')}</div><div><b>Proveedor</b>${escapeHtml(entry.supplier || '—')}</div>
          <div><b>Remito</b>${escapeHtml(entry.remito || '—')}</div><div><b>Precio/L</b>${ppu}</div>
          <div><b>Total estimado</b>${total}</div><div><b>Registró</b>${escapeHtml(entry.created_by_name || App.currentUser?.name || '—')}</div>
        </div>
        <div class="box">Nivel anterior: <b style="display:inline">${Math.round(parseFloat(entry.previous_l)||0).toLocaleString('es-AR')} L</b> · Nivel nuevo: <b style="display:inline">${Math.round(parseFloat(entry.new_l)||0).toLocaleString('es-AR')} L</b></div>
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);}<\/script>
    </body></html>`);
  win.document.close();
}


function openFuelDispatchModal() {
  if (!_fuelPuedeGestionarDespachos(App.currentUser?.role)) {
    showToast('error', 'No tenés permiso para registrar despachos internos');
    return;
  }
  const bases = (App.config && Array.isArray(App.config.bases) && App.config.bases.length)
    ? App.config.bases
    : ['Río Tercero', 'Sucursal', 'Tanque chico', 'Bidones'];
  const gasoilTank = _fuelFindTankForType('gasoil');
  const ureaTank = _fuelFindTankForType('urea');
  const tankInfo = (type) => {
    const t = _fuelFindTankForType(type);
    if (!t) return 'Sin cisterna configurada';
    return `${escapeHtml(t.location || 'Cisterna')} · ${Math.round(parseFloat(t.current_l)||0).toLocaleString('es-AR')} L disponibles`;
  };
  openModal('🚚 Despacho interno de combustible', `
    <div style="background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.25);border-radius:var(--radius);padding:10px 12px;font-size:12px;color:var(--text2);line-height:1.45;margin-bottom:12px">
      Esto es para enviar gasoil/urea a <b>sucursales, bidones o tanques chicos</b>. No se carga a ningún vehículo y no afecta el rendimiento de unidades.
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Producto</label>
        <select class="form-select" id="fd-type" onchange="updateFuelDispatchTankInfo()">
          <option value="gasoil">🟡 Gasoil</option>
          <option value="urea">🔵 Urea / AdBlue</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Litros a despachar *</label><input class="form-input" type="number" id="fd-liters" min="1" placeholder="Ej: 500"></div>
    </div>
    <div id="fd-tank-info" style="background:var(--bg3);border-radius:var(--radius);padding:10px 12px;font-size:12px;color:var(--text3);margin-bottom:10px">
      Origen: <b>${tankInfo('gasoil')}</b>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Destino *</label>
        <select class="form-select" id="fd-destination">
          ${bases.map(b => `<option value="${String(b).replace(/"/g,'&quot;')}">${b}</option>`).join('')}
          <option value="Bidones / tanque chico">Bidones / tanque chico</option>
          <option value="Otra sucursal">Otra sucursal</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Detalle destino</label><input class="form-input" id="fd-destination-detail" placeholder="Ej: tanque patio, bidones, obra, depósito..."></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Responsable que retira</label><input class="form-input" id="fd-responsible" placeholder="Nombre y apellido"></div>
      <div class="form-group"><label class="form-label">Vehículo / transporte</label><input class="form-input" id="fd-transport" placeholder="Patente o unidad que transporta"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Remito interno</label><input class="form-input" id="fd-remito" placeholder="Ej: DI-001 / Remito papel"></div>
      <div class="form-group"><label class="form-label">Observación</label><input class="form-input" id="fd-notes" placeholder="Opcional"></div>
    </div>
  `, [
    { label:'Confirmar despacho', cls:'btn-primary', fn: saveFuelDispatch },
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal }
  ]);
}

function updateFuelDispatchTankInfo() {
  const type = document.getElementById('fd-type')?.value || 'gasoil';
  const t = _fuelFindTankForType(type);
  const el = document.getElementById('fd-tank-info');
  if (!el) return;
  if (!t) {
    el.innerHTML = 'Origen: <b style="color:var(--danger)">No hay cisterna configurada para este producto</b>';
    return;
  }
  el.innerHTML = `Origen: <b>${escapeHtml(t.location || 'Cisterna')}</b> · Disponible: <b>${Math.round(parseFloat(t.current_l)||0).toLocaleString('es-AR')} L</b>`;
}

async function saveFuelDispatch() {
  const type = document.getElementById('fd-type')?.value || 'gasoil';
  const liters = parseFloat(document.getElementById('fd-liters')?.value) || 0;
  const destination = (document.getElementById('fd-destination')?.value || '').trim();
  const destination_detail = (document.getElementById('fd-destination-detail')?.value || '').trim();
  const responsible = (document.getElementById('fd-responsible')?.value || '').trim();
  const transport_vehicle = (document.getElementById('fd-transport')?.value || '').trim();
  const remito = (document.getElementById('fd-remito')?.value || '').trim();
  const notes = (document.getElementById('fd-notes')?.value || '').trim();

  if (liters <= 0) { showToast('error', 'Ingresá los litros a despachar'); return; }
  if (!destination) { showToast('error', 'Indicá el destino'); return; }

  const tank = _fuelFindTankForType(type);
  if (!tank) { showToast('error', 'No se encontró cisterna de origen para ' + _fuelTankTypeLabel(type)); return; }
  const disponible = parseFloat(tank.current_l) || 0;
  if (liters > disponible) {
    showToast('error', `Stock insuficiente: hay ${Math.round(disponible).toLocaleString('es-AR')} L disponibles`);
    return;
  }

  const res = await apiFetch('/api/fuel/dispatches', {
    method: 'POST',
    body: JSON.stringify({
      tank_id: tank.id,
      type,
      liters,
      destination,
      destination_detail,
      responsible,
      transport_vehicle,
      remito,
      notes
    })
  });
  let data = {};
  try { data = await res.json(); } catch(_) {}
  if (!res.ok) { showToast('error', data.error || 'Error al registrar despacho'); return; }

  if (data.tank) {
    const idx = (App.data.tanks || []).findIndex(t => t.id === data.tank.id);
    if (idx >= 0) App.data.tanks[idx] = data.tank;
  }

  let d = data.dispatch || null;
  if (d) {
    d = {
      id: d.id,
      type: d.type || type,
      liters: parseFloat(d.liters) || liters,
      destination: d.destination || destination,
      destination_detail: d.destination_detail || destination_detail,
      responsible: d.responsible || responsible,
      transport_vehicle: d.transport_vehicle || transport_vehicle,
      remito: d.remito || remito,
      notes: d.notes || notes,
      previous_l: parseFloat(d.previous_l) || disponible,
      new_l: parseFloat(d.new_l) || (disponible - liters),
      status: d.status || 'despachado',
      received_by: d.received_by || '',
      received_liters: d.received_liters === null || d.received_liters === undefined ? null : parseFloat(d.received_liters),
      receive_notes: d.receive_notes || '',
      received_at: d.received_at_ar || d.received_at || null,
      received_at_ar: d.received_at_ar || null,
      created_at: d.created_at_ar || d.created_at || fleetNowIsoAR(),
      created_at_ar: d.created_at_ar || null,
      date: fleetDisplayAR(d.created_at_ar || d.created_at || fleetNowIsoAR()),
      tank_id: d.tank_id || tank.id,
      tank_location: tank.location || 'Cisterna',
      created_by_name: App.currentUser?.name || '—',
      _raw: d
    };
    App.data.fuelDispatches = [d, ...(App.data.fuelDispatches || [])];
  }

  closeModal();
  showToast('ok', `Despacho interno registrado — ${Math.round(liters).toLocaleString('es-AR')} L descontados de cisterna`);
  try { await loadInitialData(); } catch(e) {}
  renderFuel();
  if (d) setTimeout(() => openFuelDispatchTicket(d.id), 150);
}

async function applyFuelDispatchToBranchTank(dispatchId) {
  const d = (App.data.fuelDispatches || []).find(x => x.id === dispatchId);
  if (!d) { showToast('error', 'No se encontró el despacho'); return; }
  const litros = Math.round(d.received_liters || d.liters || 0).toLocaleString('es-AR');
  if (!confirm(`¿Sumar ${litros} L de ${_fuelTankTypeLabel(d.type)} al tanque de la sucursal?`)) return;

  const res = await apiFetch(`/api/fuel/dispatches/${dispatchId}/apply-to-tank`, { method: 'PATCH', body: JSON.stringify({}) });
  let data = {};
  try { data = await res.json(); } catch(_) {}
  if (!res.ok) { showToast('error', data.error || 'No se pudo sumar al tanque'); return; }

  const idx = (App.data.fuelDispatches || []).findIndex(x => x.id === dispatchId);
  if (idx >= 0 && data.dispatch) {
    App.data.fuelDispatches[idx] = Object.assign(App.data.fuelDispatches[idx], {
      destination_tank_id: data.dispatch.destination_tank_id || null,
      destination_stock_applied: true,
      destination_stock_applied_at: data.dispatch.destination_stock_applied_at_ar || data.dispatch.destination_stock_applied_at || fleetNowIsoAR(),
      _raw: data.dispatch
    });
  }
  if (data.destination_tank) {
    const tIdx = (App.data.tanks || []).findIndex(t => t.id === data.destination_tank.id);
    if (tIdx >= 0) App.data.tanks[tIdx] = data.destination_tank;
    else App.data.tanks = [data.destination_tank, ...(App.data.tanks || [])];
  }

  showToast('ok', 'Combustible sumado al tanque de la sucursal');
  try { await loadInitialData(); } catch(e) {}
  renderFuel();
}

function openFuelDispatchTicket(dispatchId) {
  const d = (App.data.fuelDispatches || []).find(x => x.id === dispatchId);
  if (!d) { showToast('error', 'No se encontró el despacho'); return; }
  const code = _fuelDispatchCode(d);
  const fecha = fleetDateTimeAR(d.created_at_ar || d.created_at || d.date);
  const recibido = d.status === 'recibido';
  openModal(`🧾 Remito ${code}`, `
    <div id="fuel-dispatch-ticket-print" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:18px">
      <div style="display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:14px">
        <div>
          <div style="font-size:18px;font-weight:900;color:var(--text)">Expreso Biletta SRL</div>
          <div style="font-size:12px;color:var(--text3)">Remito interno de combustible</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:900;color:var(--accent);font-family:var(--mono)">${code}</div>
          <div style="font-size:11px;color:var(--text3)">${fecha}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
        <div><b>Producto</b><br>${_fuelTankTypeLabel(d.type)}</div>
        <div><b>Litros despachados</b><br>${Math.round(d.liters||0).toLocaleString('es-AR')} L</div>
        <div><b>Origen</b><br>${d.tank_location || 'Cisterna'}</div>
        <div><b>Destino</b><br>${d.destination || '—'}</div>
        <div><b>Detalle destino</b><br>${d.destination_detail || '—'}</div>
        <div><b>Responsable retira</b><br>${d.responsible || '—'}</div>
        <div><b>Vehículo / transporte</b><br>${d.transport_vehicle || '—'}</div>
        <div><b>Remito referencia</b><br>${d.remito || '—'}</div>
        <div><b>Registró</b><br>${escapeHtml(d.created_by_name || App.currentUser?.name || '—')}</div>
        <div><b>Estado</b><br>${recibido ? 'Recibido' : 'Despachado'}</div>
      </div>
      ${d.notes ? `<div style="margin-top:12px;background:var(--bg3);border-radius:var(--radius);padding:10px;font-size:12px;color:var(--text2)"><b>Observación</b><br>${escapeHtml(d.notes)}</div>` : ''}
      <div style="margin-top:14px;background:var(--bg3);border-radius:var(--radius);padding:10px;font-size:12px;color:var(--text2)">
        Nivel anterior: <b>${Math.round(d.previous_l||0).toLocaleString('es-AR')} L</b> · Nivel nuevo: <b>${Math.round(d.new_l||0).toLocaleString('es-AR')} L</b>
      </div>
      ${recibido ? `<div style="margin-top:12px;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.25);border-radius:var(--radius);padding:10px;font-size:12px;color:var(--ok)">
        Recibió: <b>${d.received_by || '—'}</b> · Litros recibidos: <b>${d.received_liters !== null && d.received_liters !== undefined ? Math.round(d.received_liters).toLocaleString('es-AR') + ' L' : '—'}</b>
        ${(d.received_at_ar || d.received_at) ? ` · ${fleetDateTimeAR(d.received_at_ar || d.received_at)}` : ''}
        ${d.receive_notes ? `<br>Observación recepción: ${d.receive_notes}` : ''}
      </div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px;font-size:12px;color:var(--text3)">
        <div style="border-top:1px solid var(--border);padding-top:8px;text-align:center">Firma entrega</div>
        <div style="border-top:1px solid var(--border);padding-top:8px;text-align:center">Firma recibe</div>
      </div>
    </div>
  `, [
    { label:'🖨 Imprimir', cls:'btn-primary', fn: () => printFuelDispatchTicket(dispatchId) },
    ...(d.status !== 'recibido' && _fuelPuedeRecibirDespachos(App.currentUser?.role) ? [{ label:'✓ Marcar recibido', cls:'btn-secondary', fn: () => openFuelDispatchReceiveModal(dispatchId) }] : []),
    ...(d.status === 'recibido' && !d.destination_stock_applied && _fuelPuedeRecibirDespachos(App.currentUser?.role) ? [{ label:'↪ Sumar al tanque', cls:'btn-primary', fn: () => applyFuelDispatchToBranchTank(dispatchId) }] : []),
    { label:'Cerrar', cls:'btn-secondary', fn: closeModal }
  ]);
}

function printFuelDispatchTicket(dispatchId) {
  const d = (App.data.fuelDispatches || []).find(x => x.id === dispatchId);
  if (!d) { showToast('error', 'No se encontró el despacho'); return; }
  const code = _fuelDispatchCode(d);
  const fecha = fleetDateTimeAR(d.created_at_ar || d.created_at || d.date);
  const recibido = d.status === 'recibido';
  const receivedHtml = recibido ? `
    <div class="box ok">Recibió: <b style="display:inline">${d.received_by || '—'}</b> · Litros recibidos: <b style="display:inline">${d.received_liters !== null && d.received_liters !== undefined ? Math.round(d.received_liters).toLocaleString('es-AR') + ' L' : '—'}</b>${(d.received_at_ar || d.received_at) ? ' · ' + fleetDateTimeAR(d.received_at_ar || d.received_at) : ''}${d.receive_notes ? '<br>Obs.: '+d.receive_notes : ''}</div>
  ` : '';
  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>${code}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111827}.ticket{border:1px solid #d1d5db;border-radius:10px;padding:18px;max-width:760px;margin:auto}
      .head{display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding-bottom:12px;margin-bottom:14px}.brand{font-size:20px;font-weight:800}.sub{font-size:12px;color:#6b7280}.code{font:700 16px monospace;color:#2563eb;text-align:right}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px}.box{background:#f3f4f6;border-radius:8px;padding:10px;margin-top:14px;font-size:12px}.ok{background:#ecfdf5;color:#047857}
      b{display:block;margin-bottom:3px;color:#374151}.firma{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:42px}.firma div{border-top:1px solid #9ca3af;text-align:center;padding-top:8px;font-size:12px;color:#6b7280}@media print{button{display:none}}
    </style></head><body>
      <div class="ticket">
        <div class="head"><div><div class="brand">Expreso Biletta SRL</div><div class="sub">Remito interno de combustible</div></div><div><div class="code">${code}</div><div class="sub">${fecha}</div></div></div>
        <div class="grid">
          <div><b>Producto</b>${_fuelTankTypeLabel(d.type)}</div><div><b>Litros despachados</b>${Math.round(d.liters||0).toLocaleString('es-AR')} L</div>
          <div><b>Origen</b>${d.tank_location || 'Cisterna'}</div><div><b>Destino</b>${d.destination || '—'}</div>
          <div><b>Detalle destino</b>${d.destination_detail || '—'}</div><div><b>Responsable retira</b>${d.responsible || '—'}</div>
          <div><b>Vehículo / transporte</b>${d.transport_vehicle || '—'}</div><div><b>Remito referencia</b>${d.remito || '—'}</div>
          <div><b>Registró</b>${escapeHtml(d.created_by_name || App.currentUser?.name || '—')}</div><div><b>Estado</b>${recibido ? 'Recibido' : 'Despachado'}</div>
        </div>
        ${d.notes ? `<div class="box"><b>Observación</b>${escapeHtml(d.notes)}</div>` : ''}
        <div class="box">Nivel anterior: <b style="display:inline">${Math.round(d.previous_l||0).toLocaleString('es-AR')} L</b> · Nivel nuevo: <b style="display:inline">${Math.round(d.new_l||0).toLocaleString('es-AR')} L</b></div>
        ${receivedHtml}
        <div class="firma"><div>Firma entrega</div><div>Firma recibe</div></div>
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);}<\/script>
    </body></html>`);
  win.document.close();
}

function openFuelDispatchReceiveModal(dispatchId) {
  const d = (App.data.fuelDispatches || []).find(x => x.id === dispatchId);
  if (!d) { showToast('error', 'No se encontró el despacho'); return; }
  openModal('✓ Confirmar recepción del despacho', `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 12px;font-size:12px;color:var(--text2);margin-bottom:12px">
      ${_fuelDispatchCode(d)} · ${d.destination || '—'} · <b>${Math.round(d.liters||0).toLocaleString('es-AR')} L</b>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Quién recibió</label><input class="form-input" id="fdr-received-by" placeholder="Nombre y apellido"></div>
      <div class="form-group"><label class="form-label">Litros recibidos</label><input class="form-input" type="number" id="fdr-liters" value="${parseFloat(d.liters)||0}"></div>
    </div>
    <div class="form-group"><label class="form-label">Observación</label><input class="form-input" id="fdr-notes" placeholder="Ej: recibido completo / diferencia / bidones devueltos"></div>
  `, [
    { label:'Confirmar recibido', cls:'btn-primary', fn: () => saveFuelDispatchReception(dispatchId) },
    { label:'Cancelar', cls:'btn-secondary', fn: () => openFuelDispatchTicket(dispatchId) }
  ]);
}

async function saveFuelDispatchReception(dispatchId) {
  const received_by = (document.getElementById('fdr-received-by')?.value || '').trim();
  const received_liters = parseFloat(document.getElementById('fdr-liters')?.value) || null;
  const receive_notes = (document.getElementById('fdr-notes')?.value || '').trim();
  const res = await apiFetch(`/api/fuel/dispatches/${dispatchId}/receive`, {
    method:'PATCH',
    body: JSON.stringify({ received_by, received_liters, receive_notes })
  });
  let data = {};
  try { data = await res.json(); } catch(_) {}
  if (!res.ok) { showToast('error', data.error || 'Error al confirmar recepción'); return; }
  const idx = (App.data.fuelDispatches || []).findIndex(x => x.id === dispatchId);
  if (idx >= 0 && data.dispatch) {
    App.data.fuelDispatches[idx] = Object.assign(App.data.fuelDispatches[idx], {
      status: data.dispatch.status || 'recibido',
      received_by: data.dispatch.received_by || received_by,
      received_liters: data.dispatch.received_liters === null || data.dispatch.received_liters === undefined ? received_liters : parseFloat(data.dispatch.received_liters),
      receive_notes: data.dispatch.receive_notes || receive_notes,
      received_at: data.dispatch.received_at_ar || data.dispatch.received_at || fleetNowIsoAR(),
      received_at_ar: data.dispatch.received_at_ar || null,
      destination_tank_id: data.dispatch.destination_tank_id || null,
      destination_stock_applied: data.dispatch.destination_stock_applied === true || data.dispatch.destination_stock_applied === 'true',
      destination_stock_applied_at: data.dispatch.destination_stock_applied_at_ar || data.dispatch.destination_stock_applied_at || fleetNowIsoAR(),
    });
  }
  if (data.destination_tank) {
    const tIdx = (App.data.tanks || []).findIndex(t => t.id === data.destination_tank.id);
    if (tIdx >= 0) App.data.tanks[tIdx] = data.destination_tank;
    else App.data.tanks = [data.destination_tank, ...(App.data.tanks || [])];
  }
  showToast('ok', 'Despacho marcado como recibido y sumado al tanque de sucursal');
  try { await loadInitialData(); } catch(e) {}
  renderFuel();
  setTimeout(() => openFuelDispatchTicket(dispatchId), 150);
}


async function openEditTankCapacityModal() {
  const tanks = App.data.tanks || [];
  const gasoilTank = tanks.find(t => t.type === 'fuel' || t.type === 'gasoil');
  const ureaTank   = tanks.find(t => t.type === 'urea');
  openModal('⚙ Editar cisternas', `
    <div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:10px;text-transform:uppercase">🟡 Cisterna Gasoil</div>
    <div class="form-row">
      <div class='form-group'>
        <label class='form-label'>Capacidad (L)</label>
        <input class='form-input' type='number' id='tc-gasoil-cap' value='${gasoilTank ? gasoilTank.capacity_l : 47000}'>
      </div>
      ${_fuelPuedeVerPrecios(App.currentUser?.role) ? `
        <div class='form-group'>
          <label class='form-label'>Precio por litro ($)</label>
          <input class='form-input' type='number' id='tc-gasoil-price' placeholder='Ej: 1250' value='${gasoilTank?.price_per_l ? parseFloat(gasoilTank.price_per_l) : ""}'>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">Se autocompleta al cargar desde cisterna</div>
        </div>
      ` : ''}
    </div>
    <div style="font-size:12px;font-weight:700;color:var(--accent);margin:12px 0 10px;text-transform:uppercase">🔵 Cisterna Urea</div>
    <div class="form-row">
      <div class='form-group'>
        <label class='form-label'>Capacidad (L)</label>
        <input class='form-input' type='number' id='tc-urea-cap' value='${ureaTank ? ureaTank.capacity_l : 2000}'>
      </div>
      ${_fuelPuedeVerPrecios(App.currentUser?.role) ? `
        <div class='form-group'>
          <label class='form-label'>Precio por litro ($)</label>
          <input class='form-input' type='number' id='tc-urea-price' placeholder='Ej: 800' value='${ureaTank?.price_per_l ? parseFloat(ureaTank.price_per_l) : ""}'>
        </div>
      ` : ''}
    </div>
  `, [
    { label:'Guardar', cls:'btn-primary', fn: async () => {
      const gasoilCap   = parseInt(document.getElementById('tc-gasoil-cap').value);
      const gasoilPriceEl = document.getElementById('tc-gasoil-price');
      const gasoilPrice = gasoilPriceEl ? (parseFloat(gasoilPriceEl.value) || null) : undefined;
      const ureaCap     = parseInt(document.getElementById('tc-urea-cap').value);
      const ureaPriceEl = document.getElementById('tc-urea-price');
      const ureaPrice   = ureaPriceEl ? (parseFloat(ureaPriceEl.value) || null) : undefined;
      const puedeVer = _fuelPuedeVerPrecios(App.currentUser?.role);
      if (gasoilTank) {
        const body = puedeVer ? { capacity_l: gasoilCap, price_per_l: gasoilPrice } : { capacity_l: gasoilCap };
        await apiFetch(`/api/fuel/tanks/${gasoilTank.id}`, { method:'PATCH', body: JSON.stringify(body) });
      }
      if (ureaTank) {
        const body = puedeVer ? { capacity_l: ureaCap, price_per_l: ureaPrice } : { capacity_l: ureaCap };
        await apiFetch(`/api/fuel/tanks/${ureaTank.id}`, { method:'PATCH', body: JSON.stringify(body) });
      }
      // Recargar tanks
      const r = await apiFetch('/api/fuel/tanks');
      if (r.ok) { App.data.tanks = await r.json(); }
      closeModal();
      navigate('fuel');
      showToast('ok', 'Cisternas actualizadas');
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
// Puente para el módulo de neumáticos (Fase 3): AXLE_CONFIGS es const, no queda
// en el global object; lo exponemos para que tires.mjs lo lea.
window.AXLE_CONFIGS = AXLE_CONFIGS;

function getAxleConfig(vehicle) {
  const customAxles = vehicle?.tech_spec?.axles;
  if (customAxles && customAxles.length > 0) {
    return customAxles.map((axle, i) => {
      const prefix = vehicle.type === 'semirremolque' ? 'S' : '';
      const n = i + 1;
      if (axle.dual) {
        return { name:'Eje ' + n + ' - ' + (axle.label||'Portante'), positions:[prefix+n+'-IE',prefix+n+'-II',prefix+n+'-DE',prefix+n+'-DD'], dual:true };
      } else {
        return { name:'Eje ' + n + ' - ' + (axle.label||'Direccion'), positions:[prefix+n+'-DI',prefix+n+'-DD'], dual:false };
      }
    });
  }
  return AXLE_CONFIGS[vehicle?.type] || AXLE_CONFIGS.camion;
}



function stockFormValue(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


function stockCanManage() {
  return userHasRole('dueno','gerencia','jefe_mantenimiento','paniol','contador','gerente_sucursal');
}

function stockBaseOptions() {
  const cfgBases = Array.isArray(App.config?.bases) ? App.config.bases : [];
  const dataBases = (App.data.stock || []).map(s => s.sucursal || s.base_location).filter(Boolean);
  const fallback = App.currentUser?.sucursal ? [App.currentUser.sucursal] : [];
  return [...new Set([...fallback, ...cfgBases, ...dataBases])].filter(Boolean);
}

function stockAreaOptions(sucursal) {
  const fixed = ['Administración', 'Depósito', 'Taller'];
  const cfg = App.config?.areas || {};
  const fromCfg = Array.isArray(cfg[sucursal]) ? cfg[sucursal].map(a => typeof a === 'string' ? a : (a.nombre || a.area || '')).filter(Boolean) : [];
  const fromData = (App.data.stock || []).filter(s => !sucursal || s.sucursal === sucursal || s.base_location === sucursal).map(s => s.area).filter(Boolean);
  return [...new Set([...fixed, ...fromCfg, ...fromData])].filter(Boolean);
}

function stockCurrentFilters() {
  App.stockFilters = App.stockFilters || { sucursal:'all', area:'all', q:'' };
  if (App.currentUser?.role === 'gerente_sucursal' && App.currentUser?.sucursal) {
    App.stockFilters.sucursal = App.currentUser.sucursal;
  }
  return App.stockFilters;
}

function stockFilteredItems() {
  const f = stockCurrentFilters();
  const q = (f.q || '').trim().toLowerCase();
  return (App.data.stock || []).filter(s => {
    const suc = s.sucursal || s.base_location || 'Central';
    const area = s.area || 'Depósito';
    if (f.sucursal !== 'all' && suc !== f.sucursal) return false;
    if (f.area !== 'all' && area !== f.area) return false;
    if (q) {
      const hay = [s.code, s.name, s.cat, s.supplier, suc, area].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}




// Campo de categoría con sugerencias administradas (dueño/gerencia definen la lista
// en 🏷 Categorías). Permite elegir de la lista o escribir una nueva.





function stockLocationControls(prefix, currentSucursal, currentArea) {
  const branches = stockBaseOptions();
  const areas = stockAreaOptions(currentSucursal || branches[0] || 'Central');
  const lockSucursal = App.currentUser?.role === 'gerente_sucursal' && App.currentUser?.sucursal;
  const suc = lockSucursal ? App.currentUser.sucursal : (currentSucursal || branches[0] || 'Central');
  const area = currentArea || 'Depósito';
  return '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Sucursal</label><select class="form-select" id="'+prefix+'-sucursal" '+(lockSucursal?'disabled':'')+' onchange="stockRefreshAreaOptions(\''+prefix+'\')">'
    + branches.map(b => '<option value="'+stockFormValue(b)+'" '+(b===suc?'selected':'')+'>'+stockFormValue(b)+'</option>').join('')
    + '</select></div>'
    + '<div class="form-group"><label class="form-label">Área / Pañol</label><select class="form-select" id="'+prefix+'-area">'
    + stockAreaOptions(suc).map(a => '<option value="'+stockFormValue(a)+'" '+(a===area?'selected':'')+'>'+stockFormValue(a)+'</option>').join('')
    + '</select></div>'
    + '</div>';
}

function stockRefreshAreaOptions(prefix) {
  const suc = document.getElementById(prefix+'-sucursal')?.value || 'Central';
  const areaEl = document.getElementById(prefix+'-area');
  if (!areaEl) return;
  const old = areaEl.value;
  const areas = stockAreaOptions(suc);
  areaEl.innerHTML = areas.map(a => '<option value="'+stockFormValue(a)+'" '+(a===old?'selected':'')+'>'+stockFormValue(a)+'</option>').join('');
}


// ── EGRESO de stock


















function getCostDetail(vehicleCode, mesStr) {
  const v = App.data.vehicles.find(x => x.code === vehicleCode);
  if (!v) return null;
  const measureUnit = vehicleMeasureUnit(v);
  const measureFallback = isAutoelevador(v) ? 'horas registradas' : 'km GPS';

  // ── Período: mes seleccionado (mesStr 'YYYY-MM') o mes actual si no se pasa ──
  let yr, mo;
  if (mesStr && /^\d{4}-\d{2}$/.test(mesStr)) {
    [yr, mo] = mesStr.split('-').map(Number);
  } else {
    const now  = new Date();
    yr   = now.getFullYear();
    mo   = now.getMonth() + 1;
  }

  const inMes = d => { const x = new Date(d); return x.getFullYear()===yr && x.getMonth()+1===mo; };

  // ── Combustible real (gasoil/nafta) SEPARADO de urea/AdBlue ──
  const esUrea = f => String(f.fuel_type || '').toLowerCase() === 'urea';
  const fuelLogs = App.data.fuelLogs.filter(f => f.vehicle === vehicleCode);
  const fuelMesAll = fuelLogs.filter(f => inMes(f.date));
  const fuelMes  = fuelMesAll.filter(f => !esUrea(f));   // solo gasoil/nafta → propulsión
  const ureaMes  = fuelMesAll.filter(f => esUrea(f));    // AdBlue → insumo aparte
  const fuelTotal = fuelMes.reduce((a,f) => a + (f.liters * f.ppu), 0);
  const ureaTotal = ureaMes.reduce((a,f) => a + (f.liters * f.ppu), 0);
  const fuelItems = fuelMes.map(f => ({
    fecha:   f.date.split(' ')[0],
    desc:    `Carga ${f.liters}L · ${f.place}`,
    monto:   Math.round(f.liters * f.ppu),
    detalle: `${f.liters}L × $${f.ppu}/L · ${f.km ? f.km.toLocaleString('es-AR')+' '+measureUnit : measureFallback}`,
  }));
  const ureaItems = ureaMes.map(f => ({
    fecha:   f.date.split(' ')[0],
    desc:    `AdBlue ${f.liters}L · ${f.place}`,
    monto:   Math.round(f.liters * f.ppu),
    detalle: `${f.liters}L × $${f.ppu}/L`,
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

  // Lecturas DISTINTAS de horómetro/odómetro en el mes. Hacen falta ≥2 distintas
  // para poder calcular horas/km del período. Si el operador deja la hora
  // autocompletada (misma en cada carga), todas coinciden → 1 distinta → no se
  // puede calcular y el costo/hora sería engañoso.
  const readingsCount = new Set(kmsDelMes).size;

  // ── Costo/km real ──
  const totalMes = fuelTotal + ureaTotal + prevTotal + corrTotal;
  const costKmReal = kmMes > 0 && totalMes > 0 ? totalMes / kmMes : 0;

  // ── Rendimiento del mes (mismo método que el panel de Combustible: tramo a tramo entre cargas) ──
  const litrosMes = fuelMes.reduce((a, f) => a + (f.liters || 0), 0);
  let kmPorLitro = 0;
  const logsKm = fuelMes.filter(f => f.km > 0 && f.liters > 0).sort((a, b) => a.km - b.km);
  if (logsKm.length >= 2) {
    let acum = 0, tramos = 0;
    for (let i = 1; i < logsKm.length; i++) {
      const kmDiff = logsKm[i].km - logsKm[i - 1].km;
      const lts = logsKm[i].liters;
      if (kmDiff > 0 && kmDiff < 5000 && lts > 0) { acum += kmDiff / lts; tramos++; }
    }
    if (tramos > 0) kmPorLitro = acum / tramos;
  }

  return {
    v, kmMes, totalMes, costKmReal,
    litrosMes, kmPorLitro, measureUnit, readingsCount,
    manoTotal, repTotal,
    rubros: [
      {
        id:'fuel', label:'Combustible', short:'Combustible', color:'#3b82f6',
        total: fuelTotal, pct: totalMes>0 ? Math.round(fuelTotal/totalMes*100) : 0,
        items: fuelItems.length ? fuelItems : [{ fecha:'—', desc:'Sin cargas registradas este mes', monto:0, detalle:'—' }],
      },
      {
        id:'prev', label:'Mantenimiento preventivo', short:'Preventivo', color:'#22c55e',
        total: prevTotal, pct: totalMes>0 ? Math.round(prevTotal/totalMes*100) : 0,
        items: prevItems.length ? prevItems : [{ fecha:'—', desc:'Sin OTs preventivas este mes', monto:0, detalle:'—' }],
      },
      {
        id:'corr', label:'Mantenimiento correctivo', short:'Correctivo', color:'#ef4444',
        total: corrTotal, pct: totalMes>0 ? Math.round(corrTotal/totalMes*100) : 0,
        items: corrItems.length ? corrItems : [{ fecha:'—', desc:'Sin OTs correctivas este mes', monto:0, detalle:'—' }],
      },
      {
        id:'urea', label:'Urea / AdBlue', short:'Urea', color:'#06b6d4',
        total: ureaTotal, pct: totalMes>0 ? Math.round(ureaTotal/totalMes*100) : 0,
        items: ureaItems.length ? ureaItems : [{ fecha:'—', desc:'Sin cargas de urea este mes', monto:0, detalle:'—' }],
      },
    ]
  };
}


// Estado del módulo de costos
let _costSelectedUnit  = null;
let _costExpandedRubro = null;
let _costPeriod        = 'mes';

function exportCostPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast?.('error','jsPDF no cargado. Refrescá la página.');
    return;
  }

  // Usar el mes seleccionado en la vista (o mes actual por default)
  const mesStr = window._costsMes || (() => {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  })();
  const [yr, mo] = mesStr.split('-').map(Number);
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const mesNombre = meses[mo-1];

  // Recopilar datos del mes seleccionado
  const rows = [];
  const forkRows = [];
  const remolRows = [];
  let totalCombustible = 0, totalPreventivo = 0, totalCorrectivo = 0, totalGeneral = 0, totalKm = 0;
  let forkTotalGeneral = 0, forkTotalHoras = 0;
  let remolTotalGeneral = 0;
  App.data.vehicles.forEach(v => {
    const d = getCostDetail(v.code, mesStr);
    if (!d || d.totalMes === 0) return;
    const comb = Math.round(d.rubros[0].total);
    const prev = Math.round(d.rubros[1].total);
    const corr = Math.round(d.rubros[2].total);
    totalCombustible += comb;
    totalPreventivo  += prev;
    totalCorrectivo  += corr;
    totalGeneral     += Math.round(d.totalMes);
    const fila = [
      v.code,
      `${escapeHtml(v.brand||'')} ${escapeHtml(v.model||'')}`.trim() || '—',
      d.kmMes.toLocaleString('es-AR'),
      '$'+comb.toLocaleString('es-AR'),
      '$'+prev.toLocaleString('es-AR'),
      '$'+corr.toLocaleString('es-AR'),
      '$'+Math.round(d.totalMes).toLocaleString('es-AR'),
      d.costKmReal>0 ? '$'+d.costKmReal.toFixed(3) : '—',
    ];
    // Autoelevadores: se miden por hora (d.kmMes son horas, d.costKmReal es $/hora).
    // Van en su propia tabla y NO entran en el promedio $/km de la flota.
    if (isAutoelevador(v)) {
      // Solo promediar los que tienen horas calculables (≥2 lecturas → kmMes>0),
      // para no inflar el promedio con costo sin horas.
      if (d.kmMes > 0) { forkTotalGeneral += Math.round(d.totalMes); forkTotalHoras += d.kmMes; }
      forkRows.push(fila);
    } else if (isRemolcado(v)) {
      // Remolcados: sin motor → solo mantenimiento, sin km ni $/km.
      remolTotalGeneral += Math.round(d.totalMes);
      remolRows.push([
        v.code,
        `${escapeHtml(v.brand||'')} ${escapeHtml(v.model||'')}`.trim() || '—',
        '$'+prev.toLocaleString('es-AR'),
        '$'+corr.toLocaleString('es-AR'),
        '$'+Math.round(d.totalMes).toLocaleString('es-AR'),
      ]);
    } else {
      totalKm += d.kmMes;
      rows.push(fila);
    }
  });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  const startY = _pdfHeader(doc, 'Costos Operativos', `Período: ${mesNombre} ${yr}  ·  ${rows.length} unidades con movimientos`);

  // Tabla principal
  doc.autoTable({
    startY: startY,
    head: [['Unidad','Marca/Modelo','Km mes','Combustible','Preventivo','Correctivo','Total mes','$/km real']],
    body: rows,
    ..._pdfTableStyle(),
    columnStyles: {
      0: { cellWidth: 60, fontStyle: 'bold' },
      1: { cellWidth: 130 },
      2: { halign: 'right', cellWidth: 65 },
      3: { halign: 'right', cellWidth: 85 },
      4: { halign: 'right', cellWidth: 85 },
      5: { halign: 'right', cellWidth: 85 },
      6: { halign: 'right', cellWidth: 90, fontStyle: 'bold' },
      7: { halign: 'right', cellWidth: 70 },
    },
  });

  // Totales
  const finalY = doc.lastAutoTable.finalY || 100;
  doc.setFontSize(11);
  doc.setFont('helvetica','bold');
  doc.setTextColor(BILETTA_BRAND.dark[0], BILETTA_BRAND.dark[1], BILETTA_BRAND.dark[2]);
  doc.text(`TOTALES DEL MES:`, 40, finalY + 25);
  doc.setFontSize(10);
  doc.setFont('helvetica','normal');
  doc.text(`Km totales: ${totalKm.toLocaleString('es-AR')}`, 40, finalY + 42);
  doc.text(`Combustible: $${totalCombustible.toLocaleString('es-AR')}`, 180, finalY + 42);
  doc.text(`Preventivo: $${totalPreventivo.toLocaleString('es-AR')}`, 340, finalY + 42);
  doc.text(`Correctivo: $${totalCorrectivo.toLocaleString('es-AR')}`, 490, finalY + 42);
  doc.setFont('helvetica','bold');
  doc.setTextColor(BILETTA_BRAND.orange[0], BILETTA_BRAND.orange[1], BILETTA_BRAND.orange[2]);
  doc.setFontSize(12);
  doc.text(`TOTAL GENERAL: $${totalGeneral.toLocaleString('es-AR')}`, 40, finalY + 65);

  if (totalKm > 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica','normal');
    doc.setTextColor(100, 105, 120);
    // Promedio de camiones (excluye autoelevadores, que se miden por hora).
    doc.text(`Costo promedio de la flota (camiones): $${((totalGeneral-forkTotalGeneral)/totalKm).toFixed(3)} / km`, 40, finalY + 82);
  }

  // ── Tabla aparte para autoelevadores (costo por hora) ──
  if (forkRows.length) {
    const fbase = (doc.lastAutoTable.finalY || 100) + 105;
    doc.setFontSize(11);
    doc.setFont('helvetica','bold');
    doc.setTextColor(BILETTA_BRAND.dark[0], BILETTA_BRAND.dark[1], BILETTA_BRAND.dark[2]);
    doc.text('AUTOELEVADORES — costo por hora', 40, fbase);
    doc.autoTable({
      startY: fbase + 12,
      head: [['Unidad','Marca/Modelo','Horas','Combustible','Preventivo','Correctivo','Total mes','$/hora']],
      body: forkRows,
      ..._pdfTableStyle(),
      columnStyles: {
        0: { cellWidth: 60, fontStyle: 'bold' },
        1: { cellWidth: 130 },
        2: { halign: 'right', cellWidth: 65 },
        3: { halign: 'right', cellWidth: 85 },
        4: { halign: 'right', cellWidth: 85 },
        5: { halign: 'right', cellWidth: 85 },
        6: { halign: 'right', cellWidth: 90, fontStyle: 'bold' },
        7: { halign: 'right', cellWidth: 70 },
      },
    });
    if (forkTotalHoras > 0) {
      const fy = doc.lastAutoTable.finalY || (fbase + 12);
      doc.setFontSize(9);
      doc.setFont('helvetica','normal');
      doc.setTextColor(100, 105, 120);
      doc.text(`Costo promedio de autoelevadores: $${(forkTotalGeneral/forkTotalHoras).toFixed(3)} / hora`, 40, fy + 20);
    }
  }

  // ── Tabla aparte para remolcados (semirremolque / acoplado): solo mantenimiento ──
  if (remolRows.length) {
    const rbase = (doc.lastAutoTable.finalY || 100) + 105;
    doc.setFontSize(11);
    doc.setFont('helvetica','bold');
    doc.setTextColor(BILETTA_BRAND.dark[0], BILETTA_BRAND.dark[1], BILETTA_BRAND.dark[2]);
    doc.text('REMOLCADOS — solo mantenimiento (sin motor, no aplica $/km)', 40, rbase);
    doc.autoTable({
      startY: rbase + 12,
      head: [['Unidad','Marca/Modelo','Preventivo','Correctivo','Total mes']],
      body: remolRows,
      ..._pdfTableStyle(),
      columnStyles: {
        0: { cellWidth: 60, fontStyle: 'bold' },
        1: { cellWidth: 180 },
        2: { halign: 'right', cellWidth: 100 },
        3: { halign: 'right', cellWidth: 100 },
        4: { halign: 'right', cellWidth: 110, fontStyle: 'bold' },
      },
    });
    const ry = doc.lastAutoTable.finalY || (rbase + 12);
    doc.setFontSize(9);
    doc.setFont('helvetica','normal');
    doc.setTextColor(100, 105, 120);
    doc.text(`Total mantenimiento de remolcados: $${remolTotalGeneral.toLocaleString('es-AR')}`, 40, ry + 20);
  }

  doc.save(`Costos-Biletta-${mesStr}.pdf`);
  showToast('ok', 'PDF de costos descargado');
}

// Wrapper para mantener compatibilidad con botones viejos que llaman exportCostCSV
function exportCostCSV() { exportCostPDF(); }

// Trae TODAS las páginas de cargas de combustible (no solo las primeras 100 del
// arranque). Necesario para que los km y costos del mes se sumen completos.
async function _ensureAllFuelLoaded() {
  let guard = 0;
  while (!window._fuelAllLoaded && guard++ < 50) {
    const before = (App.data.fuelLogs || []).length;
    await _fuelFetchMore();
    if ((App.data.fuelLogs || []).length === before) break; // no avanzó → cortar
  }
}
function renderCosts() {
  // Asegurar que estén TODAS las cargas antes de calcular. Al entrar solo se
  // trajeron las últimas 100; si un mes tiene más, los km/costos salían cortos.
  // Se cargan una sola vez y se vuelve a renderizar cuando termina.
  if (!window._fuelAllLoaded && !window._costsLoadingAll) {
    window._costsLoadingAll = true;
    _ensureAllFuelLoaded().then(() => {
      window._costsLoadingAll = false;
      if (document.getElementById('page-costs')) renderCosts();
    });
  }
  // Inicializar mes seleccionado (persiste entre re-renders)
  if (!window._costsMes) {
    const now = new Date();
    window._costsMes = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  }
  const mesStr = window._costsMes;
  const [yr, mo] = mesStr.split('-').map(Number);
  const mesLabel = new Date(yr, mo-1, 1).toLocaleString('es-AR', { month:'long', year:'numeric' });

  // Opciones del selector: últimos 12 meses
  const mesOpts = [];
  for (let i=0; i<12; i++) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-i);
    const val = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const lbl = d.toLocaleString('es-AR',{month:'long',year:'numeric'});
    mesOpts.push(`<option value="${val}" ${val===mesStr?'selected':''}>${lbl.charAt(0).toUpperCase()+lbl.slice(1)}</option>`);
  }

  // Calcular costo real de cada vehículo del mes seleccionado
  const withCost = App.data.vehicles.map(v => {
    const d = getCostDetail(v.code, mesStr);
    return { ...v, _costReal: d ? d.costKmReal : 0, _totalMes: d ? d.totalMes : 0, _kmMes: d ? d.kmMes : 0, _detail: d };
  });
  const sorted = [...withCost].sort((a,b) => b._totalMes - a._totalMes);
  // Los autoelevadores se miden por HORA, no por km. Mezclar su costo/hora con el
  // costo/km de los camiones distorsiona el promedio de la flota y la evaluación
  // Alto/Revisar/Eficiente. Por eso se separan en su propia sección y tienen su
  // propio promedio (ver más abajo).
  const sortedTrucks     = sorted.filter(v => !isAutoelevador(v) && !isRemolcado(v));
  const sortedForks      = sorted.filter(v =>  isAutoelevador(v));
  const sortedRemolcados = sorted.filter(v =>  isRemolcado(v));   // ordenados por costo total (sorted ya viene por _totalMes desc)
  const conDatos = sortedTrucks.filter(v => v._costReal > 0);
  const avgNum = conDatos.length > 0
    ? (conDatos.reduce((a,v)=>a+v._costReal,0)/conDatos.length)
    : 0;
  const avg = conDatos.length > 0
    ? avgNum.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})
    : '—';
  // Confianza del costo/hora de un autoelevador. El divisor de horas sale del
  // delta del horómetro entre cargas, así que es frágil:
  //  - insuf: <2 lecturas distintas → no se puede calcular (operador no actualizó
  //    el horómetro, o hubo una sola carga).
  //  - broken: consumo implícito imposible (litros/hora altísimo) → la ventana de
  //    horas no representa el uso real; el costo/hora estaría inflado.
  //  - low: solo una ventana (2 lecturas) → confiable a medias.
  // Los 'insuf' y 'broken' NO entran al promedio para no contaminarlo.
  const FORK_MAX_LH = 12; // L/hora tope plausible para un autoelevador
  const forkConf = (v) => {
    const d = v._detail;
    if (!d) return { insuf:true, low:false, broken:false, impliedLh:0 };
    const ck = d.costKmReal, readings = d.readingsCount || 0;
    const impliedLh = d.kmMes > 0 ? (d.litrosMes / d.kmMes) : 0;
    const insuf  = !(ck > 0) || readings < 2;
    const broken = !insuf && impliedLh > FORK_MAX_LH;
    const low    = !insuf && !broken && readings <= 2;
    return { insuf, low, broken, impliedLh };
  };
  // Promedio de costo/hora de los autoelevadores (su unidad correcta), solo con
  // datos confiables (excluye insuficientes y consumos imposibles).
  const conDatosFork = sortedForks.filter(v => { const c = forkConf(v); return !c.insuf && !c.broken; });
  const avgForkNum = conDatosFork.length > 0
    ? (conDatosFork.reduce((a,v)=>a+v._costReal,0)/conDatosFork.length)
    : 0;
  const avgFork = conDatosFork.length > 0
    ? avgForkNum.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})
    : '—';

  // ═══ TOTALES DEL MES (de Panel contable) ═══
  const fuelMes = (App.data.fuelLogs||[]).filter(f => {
    const d = new Date(f.date); return d.getFullYear()===yr && d.getMonth()+1===mo;
  });
  const otsMes = (App.data.workOrders||[]).filter(o => {
    if (o.status !== 'Cerrada') return false;
    const d = new Date(o.closed_at || o.date); return d.getFullYear()===yr && d.getMonth()+1===mo;
  });
  const totalCombustible = fuelMes.reduce((a,f) => a + (f.liters * f.ppu), 0);
  const totalLitros      = fuelMes.reduce((a,f) => a + f.liters, 0);
  const totalMano        = otsMes.reduce((a,o) => a + (o.labor_cost||0), 0);
  const totalRepuestos   = otsMes.reduce((a,o) => a + (o.parts_cost||0), 0);
  const totalOTs         = totalMano + totalRepuestos;
  const totalGeneral     = totalCombustible + totalOTs;

  // Litros por vehículo (para la columna nueva) — solo gasoil/nafta, sin urea
  const litrosByVeh = {};
  fuelMes.forEach(f => {
    if (String(f.fuel_type||'').toLowerCase() === 'urea') return;
    litrosByVeh[f.vehicle] = (litrosByVeh[f.vehicle]||0) + (f.liters||0);
  });

  document.getElementById('page-costs').innerHTML = `
    <!-- Header con selector de mes -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div class="section-title" style="margin:0">💰 Costos operativos — ${mesLabel.charAt(0).toUpperCase()+mesLabel.slice(1)}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="form-select" style="width:220px" onchange="window._costsMes=this.value;renderCosts()">${mesOpts.join('')}</select>
        <button class="btn btn-secondary btn-sm" onclick="exportCostPDF()">📄 PDF</button>
      </div>
    </div>

    <!-- KPIs del mes -->
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
        <div class="kpi-trend">mano $${Math.round(totalMano).toLocaleString()} · rep $${Math.round(totalRepuestos).toLocaleString()}</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-label">📐 Costo/km promedio</div>
        <div class="kpi-value white">$${avg}</div>
        <div class="kpi-trend">${conDatos.length} camiones con movimiento · ${otsMes.length} OTs cerradas</div>
      </div>
    </div>

    <!-- Gráfico ranking + detalle lateral -->
    <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px;margin-bottom:20px">
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="card-title" style="margin:0">Ranking costo/km — hacé clic en una barra o fila</div>
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
        ${sorted[0] && sorted[0]._totalMes>0 ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:12px;color:var(--text3)">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span>Unidad más costosa del mes:</span>
              <span style="cursor:pointer;text-decoration:underline;color:var(--danger)" onclick="openCostDrillDown('${escapeJsArg(sorted[0].code)}')">${escapeHtml(sorted[0].code)}</span>
            </div>
            ${conDatos.length>0 ? `<div style="display:flex;justify-content:space-between">
              <span>Más eficiente ($/km):</span>
              <span style="cursor:pointer;color:var(--ok)">${escapeHtml(conDatos[conDatos.length-1].code)} · $${conDatos[conDatos.length-1]._costReal.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
            </div>` : ''}
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Tabla detalle por unidad -->
    <div class="section-header">
      <div><div class="section-title">Desglose por unidad — clic en una fila para el detalle</div></div>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table id="costs-table">
          <thead><tr>
            <th>Código</th><th>Marca / Modelo</th><th>Km</th><th>Litros</th>
            <th style="color:#3b82f6">Combustible</th><th style="color:#06b6d4">Urea</th><th style="color:#22c55e">Preventivo</th><th style="color:#ef4444">Correctivo</th>
            <th>Total</th><th>$/km</th><th>% mes</th><th>Eval.</th><th></th>
          </tr></thead>
          <tbody>${sortedTrucks.filter(v => v._totalMes > 0).slice(0,30).map(v=>{
            const d = v._detail;
            if (!d || d.totalMes === 0) return '';
            const ck = d.costKmReal;
            // Evaluación relativa al promedio de la flota (se auto-ajusta con inflación):
            // Alto = más de 25% sobre el promedio; Revisar = sobre el promedio; Eficiente = en o bajo el promedio.
            const ev = (avgNum>0 && ck>avgNum*1.25)?['danger','Alto']:(avgNum>0 && ck>avgNum)?['warn','Revisar']:['ok','Eficiente'];
            const litros = litrosByVeh[v.code] || 0;
            const pctMes = totalGeneral > 0 ? (d.totalMes/totalGeneral*100).toFixed(1) : 0;
            return `<tr style="cursor:pointer" onclick="openCostDrillDown('${escapeJsArg(v.code)}')" title="Clic para ver desglose completo">
              <td class="td-mono td-main">${escapeHtml(v.code)}</td>
              <td>${escapeHtml(v.brand || '')} ${escapeHtml(v.model || '')}</td>
              <td class="td-mono">${d.kmMes > 0 ? d.kmMes.toLocaleString() : '—'}</td>
              <td class="td-mono" style="color:#3b82f6">${litros > 0 ? Math.round(litros).toLocaleString()+' L' : '—'}</td>
              <td class="td-mono" style="color:#3b82f6">${d.rubros[0].total>0?'$'+Math.round(d.rubros[0].total).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="color:#06b6d4">${d.rubros[3]&&d.rubros[3].total>0?'$'+Math.round(d.rubros[3].total).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="color:#22c55e">${d.rubros[1].total>0?'$'+Math.round(d.rubros[1].total).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="color:#ef4444">${d.rubros[2].total>0?'$'+Math.round(d.rubros[2].total).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="font-weight:600">$${Math.round(d.totalMes).toLocaleString('es-AR')}</td>
              <td class="td-mono" style="font-weight:700;color:var(--${ev[0]})">${ck>0?'$'+ck.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
              <td class="td-mono" style="color:var(--text3)">${pctMes}%</td>
              <td><span class="badge badge-${ev[0]}">${ev[1]}</span></td>
              <td><button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openCostDrillDown('${escapeJsArg(v.code)}')">Ver</button></td>
            </tr>`;
          }).join('')}
          ${sortedTrucks.filter(v => v._totalMes > 0).length === 0 ? '<tr><td colspan="12" style="padding:32px;text-align:center;color:var(--text3)">Sin camiones con movimientos en este mes</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    </div>

    ${sortedForks.filter(v => v._totalMes > 0).length > 0 ? `
    <!-- ═══ Autoelevadores: se miden por HORA, no por km — sección y promedio aparte ═══ -->
    <div class="kpi-row" style="margin:24px 0 16px">
      <div class="kpi-card info" style="border-color:rgba(245,158,11,.4)">
        <div class="kpi-label">⏱ Costo/hora promedio — Autoelevadores</div>
        <div class="kpi-value white">$${avgFork}</div>
        <div class="kpi-trend">${conDatosFork.length} con dato confiable · promedio entre autoelevadores (por hora)</div>
      </div>
    </div>
    <div class="section-header">
      <div>
        <div class="section-title">⏱ Autoelevadores — costo por hora</div>
        <div style="font-size:12px;color:var(--text3)">Se evalúan entre ellos (no contra el costo/km de los camiones), porque trabajan por hora.</div>
      </div>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table id="costs-table-fork">
          <thead><tr>
            <th>Código</th><th>Marca / Modelo</th><th>Horas</th><th>Litros</th>
            <th style="color:#3b82f6">Combustible</th><th style="color:#06b6d4">Urea</th><th style="color:#22c55e">Preventivo</th><th style="color:#ef4444">Correctivo</th>
            <th>Total</th><th>$/h</th><th>% mes</th><th>Eval.</th><th></th>
          </tr></thead>
          <tbody>${sortedForks.filter(v => v._totalMes > 0).slice(0,30).map(v=>{
            const d = v._detail;
            if (!d || d.totalMes === 0) return '';
            const ck = d.costKmReal; // para autoelevadores, costKmReal = costo por HORA
            const litros = litrosByVeh[v.code] || 0;
            const pctMes = totalGeneral > 0 ? (d.totalMes/totalGeneral*100).toFixed(1) : 0;
            // Celda $/h y badge de evaluación según la confianza del dato.
            const conf = forkConf(v);
            const ckFmt = '$'+ck.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
            let ckCell, evalCell;
            if (conf.insuf) {
              ckCell   = `<span style="color:var(--text3)" title="Hacen falta al menos 2 lecturas de horómetro distintas en el mes para calcular el costo/hora">datos insuf.</span>`;
              evalCell = `<span class="badge badge-info" title="No se puede calcular el costo/hora: faltan lecturas de horómetro (revisá que carguen las horas reales)">s/d</span>`;
            } else if (conf.broken) {
              ckCell   = `<span style="font-weight:700;color:var(--warn)">${ckFmt}</span>`;
              evalCell = `<span class="badge badge-warn" title="Consumo implícito de ${conf.impliedLh.toFixed(1)} L/h: la ventana de horas no representa el uso real. El costo/hora está probablemente inflado — revisá cómo se cargan las horas.">⚠ revisar carga</span>`;
            } else {
              const ev = (avgForkNum>0 && ck>avgForkNum*1.25)?['danger','Alto']:(avgForkNum>0 && ck>avgForkNum)?['warn','Revisar']:['ok','Eficiente'];
              const lowMark = conf.low ? ` <span style="color:var(--warn)" title="Calculado con una sola ventana entre 2 cargas: confianza media">⚠</span>` : '';
              ckCell   = `<span style="font-weight:700;color:var(--${ev[0]})">${ckFmt}</span>${lowMark}`;
              evalCell = `<span class="badge badge-${ev[0]}">${ev[1]}</span>`;
            }
            return `<tr style="cursor:pointer" onclick="openCostDrillDown('${escapeJsArg(v.code)}')" title="Clic para ver desglose completo">
              <td class="td-mono td-main">${escapeHtml(v.code)}</td>
              <td>${escapeHtml(v.brand || '')} ${escapeHtml(v.model || '')}</td>
              <td class="td-mono">${d.kmMes > 0 ? d.kmMes.toLocaleString()+' h' : '—'}</td>
              <td class="td-mono" style="color:#3b82f6">${litros > 0 ? Math.round(litros).toLocaleString()+' L' : '—'}</td>
              <td class="td-mono" style="color:#3b82f6">${d.rubros[0].total>0?'$'+Math.round(d.rubros[0].total).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="color:#06b6d4">${d.rubros[3]&&d.rubros[3].total>0?'$'+Math.round(d.rubros[3].total).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="color:#22c55e">${d.rubros[1].total>0?'$'+Math.round(d.rubros[1].total).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="color:#ef4444">${d.rubros[2].total>0?'$'+Math.round(d.rubros[2].total).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="font-weight:600">$${Math.round(d.totalMes).toLocaleString('es-AR')}</td>
              <td class="td-mono">${ckCell}</td>
              <td class="td-mono" style="color:var(--text3)">${pctMes}%</td>
              <td>${evalCell}</td>
              <td><button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openCostDrillDown('${escapeJsArg(v.code)}')">Ver</button></td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

    ${sortedRemolcados.filter(v => v._totalMes > 0).length > 0 ? `
    <!-- ═══ Remolcados (semirremolque / acoplado): sin motor, solo mantenimiento ═══ -->
    <div class="section-header" style="margin-top:24px">
      <div>
        <div class="section-title">🚛 Remolcados — solo mantenimiento</div>
        <div style="font-size:12px;color:var(--text3)">Semirremolques y acoplados no tienen motor ni km propios. Se ordenan por costo total de mantenimiento del mes (no aplica $/km).</div>
      </div>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table id="costs-table-remolque">
          <thead><tr>
            <th>Código</th><th>Marca / Modelo</th>
            <th style="color:#22c55e">Preventivo</th><th style="color:#ef4444">Correctivo</th>
            <th>Total mes</th><th>% mes</th><th></th>
          </tr></thead>
          <tbody>${sortedRemolcados.filter(v => v._totalMes > 0).slice(0,30).map(v=>{
            const d = v._detail;
            if (!d || d.totalMes === 0) return '';
            const pctMes = totalGeneral > 0 ? (d.totalMes/totalGeneral*100).toFixed(1) : 0;
            return `<tr style="cursor:pointer" onclick="openCostDrillDown('${escapeJsArg(v.code)}')" title="Clic para ver desglose completo">
              <td class="td-mono td-main">${escapeHtml(v.code)}</td>
              <td>${escapeHtml(v.brand || '')} ${escapeHtml(v.model || '')}</td>
              <td class="td-mono" style="color:#22c55e">${d.rubros[1].total>0?'$'+Math.round(d.rubros[1].total).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="color:#ef4444">${d.rubros[2].total>0?'$'+Math.round(d.rubros[2].total).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="font-weight:600">$${Math.round(d.totalMes).toLocaleString('es-AR')}</td>
              <td class="td-mono" style="color:var(--text3)">${pctMes}%</td>
              <td><button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openCostDrillDown('${escapeJsArg(v.code)}')">Ver</button></td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}
  `;

  setTimeout(() => buildCostRankChart(sortedTrucks, avgNum), 100);
}

function buildCostRankChart(sorted, avgNum) {
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
          (avgNum>0 && v._costReal>avgNum*1.25)?'rgba(239,68,68,.75)':
          (avgNum>0 && v._costReal>avgNum)?'rgba(245,158,11,.75)':
          v._costReal>0?'rgba(34,197,94,.75)':'rgba(100,116,139,.4)'
        ),
        borderRadius:4, borderColor:'transparent',
        hoverBackgroundColor: sorted.slice(0,12).map(v=>
          (avgNum>0 && v._costReal>avgNum*1.25)?'rgba(239,68,68,1)':
          (avgNum>0 && v._costReal>avgNum)?'rgba(245,158,11,1)':
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
        tooltip:{callbacks:{label:ctx=>'  $'+ctx.parsed.x.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})+'/km'}}
      },
      scales:{
        x:{ticks:{color:'#9ba3be',callback:v=>'$'+v.toLocaleString('es-AR')}, grid:{color:'rgba(128,128,128,.1)'}},
        y:{ticks:{color:'#9ba3be',font:{size:11}}, grid:{display:false}}
      }
    }
  });
}

// ── DRILL-DOWN: desglose completo de una unidad ──
// Formatea montos grandes de forma legible: millones con "M", el resto con separador de miles AR.
// Evita el "4145K" que se lee mal; muestra "$4,1 M".
function fmtMontoCorto(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return '$' + (n / 1000000).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' M';
  return '$' + Math.round(n).toLocaleString('es-AR');
}
function openCostDrillDown(vehicleCode) {
  // Respetar el mes elegido en Costos (si no, el detalle mostraba siempre el mes
  // actual, que a principio de mes está vacío → "0 km · $0").
  const d = getCostDetail(vehicleCode, window._costsMes);
  if (!d) return;

  const unidad = d.measureUnit || 'km';
  const rendStr = d.kmPorLitro > 0
    ? d.kmPorLitro.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' ' + unidad + '/L'
    : '—';

  openModal(`Desglose de costos — ${vehicleCode}`, `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:16px;font-weight:600">${escapeHtml(d.v.brand)} ${escapeHtml(d.v.model)} · ${d.v.year}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${escapeHtml(d.v.driver)} · Base ${escapeHtml(d.v.base)} · ${d.kmMes.toLocaleString()} km este mes</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:28px;font-weight:700;font-family:var(--mono);color:var(--${d.costKmReal>0.25?'danger':d.costKmReal>0.20?'warn':'ok'})">${d.costKmReal>0?'$'+d.costKmReal.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}):'Sin datos'}</div>
        <div style="font-size:11px;color:var(--text3)">por ${unidad === 'km' ? 'kilómetro' : unidad}</div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-top:2px">$${Math.round(d.totalMes).toLocaleString('es-AR')} / mes</div>
        <div style="font-size:13px;font-weight:600;color:var(--${d.kmPorLitro>0?'ok':'text3'});margin-top:4px" title="Rendimiento del mes, tramo a tramo entre cargas">⛽ ${rendStr}${d.kmPorLitro>0?' · '+Math.round(d.litrosMes).toLocaleString('es-AR')+' L':''}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:18px">
      ${d.rubros.map(r=>`
        <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 8px;text-align:center;border:1px solid var(--border);cursor:pointer;transition:all .15s"
          onclick="toggleCostRubro('${escapeJsArg(vehicleCode)}','${r.id}')"
          id="rubro-card-${r.id}">
          <div style="width:8px;height:8px;border-radius:50%;background:${r.color};margin:0 auto 5px"></div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:3px;line-height:1.3">${r.short || r.label.split(' ')[0]}</div>
          <div style="font-size:15px;font-weight:700;font-family:var(--mono);color:var(--text)">${fmtMontoCorto(r.total)}</div>
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
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
        ${[
          ['Costo anual total',    fmtMontoCorto(d.totalMes*12), 'text'],
          ['Costo/km real',        d.costKmReal>0?'$'+d.costKmReal.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—', d.costKmReal>0.25?'danger':d.costKmReal>0.20?'warn':'ok'],
          ['Rendimiento (mes)',    rendStr, d.kmPorLitro>0?'ok':'text3'],
          ['Km proyectados año',   (d.kmMes*12).toLocaleString('es-AR')+' '+unidad, 'text'],
          ['Combustible año',      fmtMontoCorto(d.rubros[0].total*12), 'text'],
        ].map(([l,val,c])=>`
          <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 12px;border:1px solid var(--border)">
            <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">${l}</div>
            <div style="font-size:16px;font-weight:700;font-family:var(--mono);color:var(--${c==='text'?'text':c})">${val}</div>
          </div>`).join('')}
      </div>
    </div>
  `, [
    { label:'📋 Ver historial del vehículo', cls:'btn-primary', fn:()=>{ closeModal(); openVehicleHistoryModal(vehicleCode); } },
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
              <td style="padding:7px 8px;color:var(--text);font-weight:500">${escapeHtml(item.desc)}</td>
              <td style="padding:7px 8px;color:var(--text3);font-size:11px;max-width:200px">${escapeHtml(item.detalle)}</td>
              <td style="padding:7px 8px;text-align:right;font-family:var(--mono);font-weight:600;color:${rubro.color}">$${item.monto.toLocaleString()}</td>
              <td style="padding:7px 8px;text-align:right;font-family:var(--mono);color:var(--text3)">
                ${rubro.total>0?Math.round(item.monto/rubro.total*100):0}%
                <div style="height:3px;background:var(--bg4);border-radius:2px;margin-top:3px;overflow:hidden">
                  <div style="height:3px;width:${rubro.total>0?Math.round(item.monto/rubro.total*100):0}%;background:${rubro.color};border-radius:2px"></div>
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

// ── MODAL HELPER ──
function openModal(title, bodyHTML, actions=[]) {
  const overlay = document.getElementById('modal-overlay');
  const modal = overlay.querySelector('.modal');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  const footer = document.getElementById('modal-footer');
  // Hacer que los botones envuelvan en múltiples líneas si no entran
  footer.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;padding:12px 16px';
  // Un item { spacer:true } empuja los botones que siguen hacia la derecha
  // (separa "utilidad" de "acciones" para que no queden todos amontonados).
  footer.innerHTML = actions.map((a,i)=> a.spacer
    ? `<div style="flex:1 1 8px;min-width:8px"></div>`
    : `<button class="btn ${a.cls}" id="modal-action-${i}" style="white-space:nowrap">${a.label}</button>`).join('');
  actions.forEach((a,i) => { if (a.spacer) return; const _b = document.getElementById('modal-action-'+i); if (_b) _b.onclick = a.fn; });
  if (modal) modal.style.display = 'block';
  overlay.classList.add('open');
  overlay.style.display = 'flex';
}
function closeModal() {
  // Al cerrar, olvidar la OC abierta para que timeline.js no enriquezca otra
  // trazabilidad con datos de la OC anterior.
  if (window.App) App.currentPODetailId = null;
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
  { value:'paniol',                label:'Stock / Depósito' },
  { value:'contador',              label:'Administración' },
  { value:'gerente_sucursal',      label:'Gerente de sucursal' },
  { value:'auditor',               label:'Auditor' },
  { value:'compras',               label:'Compras' },
  { value:'tesoreria',             label:'Tesorería' },
  { value:'proveedores',           label:'Proveedores' },
];

// ═══════════════════════════════════════════════════════════
//  WORKFLOW de OC — fuente única de verdad
//  Los 6 estados, sus labels, colores, íconos y transiciones
// ═══════════════════════════════════════════════════════════
const OC_ESTADOS = {
  pendiente_cotizacion: { label: 'Pendiente cotización', icon: '📝', bg: 'rgba(251,191,36,.15)', fg: '#f59e0b', border: 'rgba(251,191,36,.4)' },
  en_cotizacion:        { label: 'En cotización',        icon: '🔎', bg: 'rgba(139,92,246,.15)', fg: '#a78bfa', border: 'rgba(139,92,246,.4)' },
  aprobada_compras:     { label: 'Aprobada por compras', icon: '✅', bg: 'rgba(14,165,233,.15)', fg: '#38bdf8', border: 'rgba(14,165,233,.4)' },
  enviada_proveedor:    { label: 'Enviada al proveedor', icon: '📤', bg: 'rgba(99,102,241,.15)', fg: '#818cf8', border: 'rgba(99,102,241,.4)' },
  pagada:               { label: 'Pagada',               icon: '💰', bg: 'rgba(34,197,94,.15)',  fg: '#4ade80', border: 'rgba(34,197,94,.4)' },
  recibida:             { label: 'Recibida',             icon: '📦', bg: 'rgba(16,185,129,.2)',  fg: '#10b981', border: 'rgba(16,185,129,.5)' },
  cerrada:              { label: 'Cerrada',              icon: '🔒', bg: 'rgba(100,116,139,.18)', fg: '#94a3b8', border: 'rgba(100,116,139,.45)' },
  rechazada:            { label: 'Rechazada',            icon: '❌', bg: 'rgba(239,68,68,.15)',  fg: '#f87171', border: 'rgba(239,68,68,.4)' },
  dividida:             { label: 'Dividida por proveedor', icon: '🔀', bg: 'rgba(168,85,247,.15)', fg: '#c084fc', border: 'rgba(168,85,247,.4)' }
};

// Genera el badge HTML del estado (usa el ícono + label + color)
function _ocEstadoBadge(statusOrPo) {
  const po = (statusOrPo && typeof statusOrPo === 'object') ? statusOrPo : null;
  const status = po ? po.status : statusOrPo;
  const e = OC_ESTADOS[status] || { label: status, icon: '❓', bg: '#333', fg: '#fff', border: '#555' };

  let label = e.label;
  if (po && status === 'recibida') {
    const invoiceDone = String(po.invoice_status || '').toLowerCase() === 'total' || !!po.factura_nro || (parseFloat(po.factura_monto || 0) > 0);
    const paymentDone = String(po.payment_status || '').toLowerCase() === 'total';
    const faltan = [];
    if (!invoiceDone) faltan.push('factura');
    if (!paymentDone) faltan.push('pago');
    if (faltan.length) label = 'Recibida · falta ' + faltan.join('/');
  }

  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;background:${e.bg};color:${e.fg};border:1px solid ${e.border};font-size:11px;font-weight:600;white-space:nowrap">
    <span>${e.icon}</span><span>${label}</span>
  </span>` + _ocParcialChips(po, status);
}

// Chips secundarios de avance parcial (entrega/pago). SOLO visual: no cambian el
// estado real de la OC, solo lo hacen más legible de un vistazo.
function _ocParcialChips(po, status) {
  if (!po || ['cerrada','rechazada','recibida'].includes(status)) return '';
  const chip = (txt) => `<span style="display:inline-flex;align-items:center;padding:2px 7px;border-radius:10px;background:rgba(245,158,11,.13);color:#f59e0b;border:1px solid rgba(245,158,11,.35);font-size:9px;font-weight:700;margin-left:4px;white-space:nowrap">${txt}</span>`;
  let out = '';
  if (String(po.delivery_status || '').toLowerCase() === 'parcial') out += chip('📦 entrega parcial');
  if (String(po.payment_status || '').toLowerCase() === 'parcial')  out += chip('💵 pago parcial');
  return out;
}

// Qué acciones puede hacer un rol sobre una OC en un estado dado
// Devuelve lista de {key, label, color} para mostrar como botones
// (legacy) _ocAccionesPermitidas() eliminado: las acciones de OC se arman en openPODetail().

// ¿El rol tiene permitido ver precios de OCs?
// Los roles SOLICITANTES (jefe mant, pañol, contador) NO ven precios.
// Las cotizaciones y pagos las gestiona compras/tesorería.
function _ocPuedeVerPrecios(role) {
  return !['jefe_mantenimiento','paniol','contador','gerente_sucursal'].includes(role);
}

// ¿El rol tiene permitido ver precios de combustible ($ por litro, totales)?
// El jefe mant y el chofer NO ven precios — compras los gestiona
function _fuelPuedeVerPrecios(role) {
  const rolesQueSiVen = ['dueno','gerencia','compras','contador','auditor','encargado_combustible','proveedores'];
  return rolesQueSiVen.includes(role);
}

function _fuelPuedeGestionarCisterna(role) {
  return ['dueno','gerencia','compras','encargado_combustible','jefe_mantenimiento'].includes(role);
}

function _fuelPuedeGestionarDespachos(role) {
  return ['dueno','gerencia','compras','encargado_combustible','jefe_mantenimiento','mecanico'].includes(role);
}

function _fuelPuedeRecibirDespachos(role) {
  return _fuelPuedeGestionarDespachos(role) || role === 'gerente_sucursal';
}

function _fuelPuedeRegistrarCarga(role) {
  return ['dueno','gerencia','jefe_mantenimiento','encargado_combustible','chofer','mecanico','gerente_sucursal'].includes(role);
}

function _fuelPuedeVerificarTickets(role) {
  return ['dueno','gerencia','jefe_mantenimiento','encargado_combustible'].includes(role);
}

function _fuelTankEntryCode(entry) {
  if (!entry) return 'TC-0000';
  const ymd = fleetYmdCompactAR(entry.created_at_ar || entry.created_at || entry.date);
  return `TC-${ymd}-${String(entry.id || '').slice(0,6).toUpperCase()}`;
}

function _fuelTankTypeLabel(type) {
  const t = String(type || '').toLowerCase();
  return t === 'urea' ? 'Urea / AdBlue' : 'Gasoil';
}

function _fuelDispatchCode(d) {
  if (!d) return 'DI-0000';
  const ymd = fleetYmdCompactAR(d.created_at_ar || d.created_at || d.date);
  return `DI-${ymd}-${String(d.id || '').slice(0,6).toUpperCase()}`;
}

function _fuelIsGerenteSucursal() {
  return App.currentUser?.role === 'gerente_sucursal';
}

function _fuelCurrentBranchName() {
  return String(App.currentUser?.sucursal || '').trim() || 'Sucursal';
}

function _fuelDbType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'urea' ? 'urea' : 'fuel';
}

function _fuelTankMatchesType(tank, type) {
  const tipoDb = _fuelDbType(type);
  return tank && (tank.type === tipoDb || (tipoDb === 'fuel' && tank.type === 'gasoil'));
}

function _fuelFindTankByPlaceAndType(place, type) {
  const p = String(place || '').trim();
  const tanks = App.data.tanks || [];
  if (!p) return null;
  return tanks.find(t => _fuelTankMatchesType(t, type) && String(t.location || '').trim() === p)
      || tanks.find(t => _fuelTankMatchesType(t, type) && p.includes(String(t.location || '').trim()))
      || null;
}

function _fuelTanksForType(type) {
  return (App.data.tanks || []).filter(t => _fuelTankMatchesType(t, type));
}

function _fuelIsInternalTankPlace(place, type) {
  return !!_fuelFindTankByPlaceAndType(place, type) || String(place || '').includes('Cisterna');
}

function _fuelFindTankForType(type) {
  const tanks = App.data.tanks || [];
  const tipoDb = _fuelDbType(type);
  if (_fuelIsGerenteSucursal()) {
    return tanks.find(t => _fuelTankMatchesType(t, type)) || null;
  }
  return tanks.find(t => (t.type === tipoDb || (tipoDb === 'fuel' && t.type === 'gasoil')) && (t.location || '').includes('Cisterna R3'))
      || tanks.find(t => t.type === tipoDb || (tipoDb === 'fuel' && t.type === 'gasoil'))
      || null;
}

function _getGasoilTankForAlert() {
  const tanks = App.data.tanks || [];
  return tanks.find(t => t.type === 'fuel' || t.type === 'gasoil') || null;
}

function _renderGasoilLowBannerForCompras() {
  if (App.currentUser?.role !== 'compras') return '';
  const gasoilTank = _getGasoilTankForAlert();
  if (!gasoilTank) return '';

  const level = parseFloat(gasoilTank.current_l) || 0;
  const cap   = parseFloat(gasoilTank.capacity_l) || 0;
  if (level >= 10000) return '';

  const pct = cap > 0 ? Math.round(level / cap * 100) : 0;
  return `
    <div style="background:rgba(239,68,68,.10);border:1px solid rgba(239,68,68,.35);border-left:4px solid var(--danger);border-radius:var(--radius-lg);padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div style="display:flex;gap:12px;align-items:flex-start">
        <div style="font-size:24px;line-height:1">⛽</div>
        <div>
          <div style="font-size:15px;font-weight:900;color:var(--danger);margin-bottom:3px">Materia prima crítica: hay que cotizar / comprar gasoil</div>
          <div style="font-size:12px;color:var(--text2);line-height:1.45">
            Stock actual de cisterna: <b>${Math.round(level).toLocaleString('es-AR')} L</b>${cap ? ` de ${Math.round(cap).toLocaleString('es-AR')} L (${pct}%)` : ''}.
            El aviso queda activo hasta que el stock vuelva a superar <b>10.000 L</b>.
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" onclick="openNewPOModal()">🛒 Crear OC / cotizar</button>
        <button class="btn btn-secondary btn-sm" onclick="navigate('fuel')">Ver cisterna</button>
      </div>
    </div>`;
}

function checkGasoilLowForCompras(force) {
  if (App.currentUser?.role !== 'compras') return;
  const gasoilTank = _getGasoilTankForAlert();
  if (!gasoilTank) return;

  const level = parseFloat(gasoilTank.current_l) || 0;
  const cap   = parseFloat(gasoilTank.capacity_l) || 0;
  if (level >= 10000) return;

  // No usamos sessionStorage/localStorage: al abrir el sistema debe volver a avisar
  // todos los días y en cada nuevo ingreso, hasta que la cisterna supere 10.000 L.
  if (!force) {
    const last = window._gasoilLowModalLastShownAt || 0;
    if (Date.now() - last < 5000) return;
    window._gasoilLowModalLastShownAt = Date.now();
  }

  const pct = cap > 0 ? Math.round(level / cap * 100) : 0;
  openModal('⚠ Comprar gasoil', `
    <div style="background:rgba(239,68,68,.10);border:1px solid rgba(239,68,68,.35);border-left:4px solid var(--danger);border-radius:var(--radius);padding:16px;margin-bottom:14px">
      <div style="font-size:16px;font-weight:900;color:var(--danger);margin-bottom:6px">La cisterna de gasoil está debajo del mínimo</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.5">
        Stock actual: <b>${Math.round(level).toLocaleString('es-AR')} L</b>${cap ? ` de ${Math.round(cap).toLocaleString('es-AR')} L (${pct}%)` : ''}.<br>
        Es materia prima de la empresa: hay que <b>cotizar / comprar gasoil</b>.
      </div>
    </div>
    <div style="font-size:12px;color:var(--text3);line-height:1.5">
      Mínimo configurado: <b>10.000 L</b>. Este aviso vuelve a aparecer al ingresar al sistema mientras el stock siga bajo ese límite.
    </div>
  `, [
    { label:'🛒 Crear OC / cotizar', cls:'btn-primary', fn: () => { closeModal(); navigate('purchase_orders'); setTimeout(() => { if (typeof openNewPOModal === 'function') openNewPOModal(); }, 250); } },
    { label:'⛽ Ver cisterna', cls:'btn-secondary', fn: () => { closeModal(); navigate('fuel'); } },
    { label:'Cerrar', cls:'btn-secondary', fn: closeModal }
  ]);
}
// ═══════════════════════════════════════════════════════════

async function renderUsers() {
  const root = document.getElementById('page-users');
  if (!root) return;

  root.innerHTML = `
    <div class="section-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <h2 style="font-size:18px;font-weight:700;color:var(--text);margin:0">Gestión de usuarios</h2>
        <p style="font-size:13px;color:var(--text3);margin:4px 0 0">Crear, administrar y aprobar accesos al sistema</p>
      </div>
      ${userHasRole('dueno') ? `<button class="btn btn-secondary" onclick="downloadBackupDB()" style="margin-right:8px;background:rgba(59,130,246,.15);color:var(--accent);border:1px solid rgba(59,130,246,.3)" title="Descargar backup completo de la base de datos">🔒 Backup DB</button>` : ''}<button class="btn btn-primary" onclick="openNewUserModal()">+ Nuevo usuario</button>
    </div>
    <div id="pending-wrap"></div>
    <div id="users-table-wrap"><div style="text-align:center;padding:40px;color:var(--text3)">Cargando usuarios...</div></div>
  `;

  try {
    const res = await apiFetch('/api/users');
    if (!res || !res.ok) { document.getElementById('users-table-wrap').innerHTML = '<div style="color:var(--danger);padding:20px">Error cargando usuarios</div>'; return; }
    const users = await res.json();
    App.data.users = users;

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
                <div style="font-weight:600;color:var(--text)">${escapeHtml(u.name)}</div>
                <div style="font-size:12px;color:var(--text3)">${escapeHtml(u.email)} ${u.vehicle_code?'· Unidad: '+u.vehicle_code:''}</div>
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn btn-primary btn-sm" onclick="approveUser('${u.id}')">✓ Aprobar</button>
                <button class="btn btn-secondary btn-sm" style="color:var(--danger)" onclick="rejectUser('${u.id}','${escapeJsArg(u.name)}')">✕ Rechazar</button>
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
            <tr style="background:var(--bg3);border-bottom:1px solid var(--border)">
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Nombre</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Email</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Rol</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Unidad</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Sucursal</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Área</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Estado</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Último acceso</th>
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${active.map(u => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:12px 16px;font-weight:600;color:var(--text)">${escapeHtml(u.name)}</td>
                <td style="padding:12px 16px;color:var(--text2);font-size:13px">${escapeHtml(u.email)}</td>
                <td style="padding:12px 16px">
                  <span style="background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:3px 10px;font-size:12px;color:var(--text2)">
                    ${ROLES_LIST.find(r=>r.value===u.role)?.label || u.role}
                  </span>
                </td>
                <td style="padding:12px 16px;color:var(--text3);font-size:13px">${u.vehicle_code || '—'}</td>
                <td style="padding:12px 16px;color:var(--text3);font-size:13px">${escapeHtml(u.sucursal || '—')}</td>
                <td style="padding:12px 16px;color:var(--text3);font-size:13px">${escapeHtml(u.area || '—')}</td>
                <td style="padding:12px 16px">
                  <span style="background:${u.active ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)'};color:${u.active ? '#22c55e' : '#ef4444'};border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600">
                    ${u.active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td style="padding:12px 16px;color:var(--text3);font-size:12px">${u.last_login ? new Date(u.last_login).toLocaleDateString('es-AR') : 'Nunca'}</td>
                <td style="padding:12px 16px">
                  <button class="btn btn-secondary btn-sm" onclick="openEditUserModal('${u.id}')">Editar</button>
                  ${userHasRole('dueno') && u.email !== 'admin@fleetos.com' ? `<button class="btn btn-sm" style="background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);margin-left:6px" onclick="confirmDeleteUser('${u.id}','${escapeJsArg(u.name)}')">🗑 Eliminar</button>` : ''}
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
  if (!confirm(`⚠ ¿Estás seguro que querés eliminar al usuario "${name}"?\n\nSi el usuario tiene historial en el sistema, se desactivará en vez de borrarse (para no perder el registro de lo que hizo).`)) return;
  const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error || 'Error al eliminar'); return; }
  const data = await res.json().catch(() => ({}));
  if (data.deactivated) {
    showToast('ok', data.message || `Usuario "${name}" desactivado (tiene historial).`);
  } else {
    showToast('ok', `Usuario "${name}" eliminado`);
  }
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
    body: JSON.stringify({ name: u.name, role: u.role, vehicle_code: u.vehicle_code, sucursal: u.sucursal || null, area: u.area || null, active: true })
  });
  if (res2.ok) { showToast('ok', `✓ ${escapeHtml(u.name)} aprobado — ya puede ingresar al sistema`); renderUsers(); }
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
    body: JSON.stringify({ name: u.name, role: u.role, vehicle_code: u.vehicle_code, sucursal: u.sucursal || null, area: u.area || null, active: false })
  });
  if (res2.ok) { showToast('ok', 'Solicitud rechazada'); renderUsers(); }
  else { const e = await res2.json(); showToast('error', e.error || 'Error al rechazar'); }
}


function userOrgOptions(kind, current, sucursal) {
  let opts = [];
  if (kind === 'sucursal') opts = stockBaseOptions();
  else opts = stockAreaOptions(sucursal || App.currentUser?.sucursal || 'Central');
  if (current && !opts.includes(current)) opts.unshift(current);
  return [...new Set(opts.filter(Boolean))];
}

function userOrgSelect(prefix, currentSucursal, currentArea) {
  const sucursal = currentSucursal || '';
  const area = currentArea || '';
  const sucOpts = userOrgOptions('sucursal', sucursal, sucursal);
  const areaOpts = userOrgOptions('area', area, sucursal || sucOpts[0] || 'Central');
  return '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Sucursal asignada</label><select class="form-select" id="'+prefix+'-sucursal" onchange="refreshUserOrgArea(\''+prefix+'\')"><option value="">— Sin sucursal fija —</option>'+sucOpts.map(function(b){ return '<option value="'+stockFormValue(b)+'" '+(b===sucursal?'selected':'')+'>'+stockFormValue(b)+'</option>'; }).join('')+'</select><div style="font-size:11px;color:var(--text3);margin-top:4px">Para gerente de sucursal se usa para limitar stock, vehículos y pedidos.</div></div>'
    + '<div class="form-group"><label class="form-label">Área asignada</label><select class="form-select" id="'+prefix+'-area"><option value="">— Sin área fija —</option>'+areaOpts.map(function(a){ return '<option value="'+stockFormValue(a)+'" '+(a===area?'selected':'')+'>'+stockFormValue(a)+'</option>'; }).join('')+'</select><div style="font-size:11px;color:var(--text3);margin-top:4px">Ej: Administración, Depósito o Taller.</div></div>'
    + '</div>';
}

function refreshUserOrgArea(prefix) {
  const sucursal = document.getElementById(prefix+'-sucursal')?.value || 'Central';
  const areaEl = document.getElementById(prefix+'-area');
  if (!areaEl) return;
  const current = areaEl.value || '';
  const opts = userOrgOptions('area', current, sucursal);
  areaEl.innerHTML = '<option value="">— Sin área fija —</option>' + opts.map(function(a){ return '<option value="'+stockFormValue(a)+'" '+(a===current?'selected':'')+'>'+stockFormValue(a)+'</option>'; }).join('');
}


// Descarga el backup completo de la base (gzip) desde /api/admin/backup.
// El endpoint exige JWT en el header Authorization, así que NO sirve un link plano:
// hay que pedirlo con apiFetch (que agrega el token) y bajar el blob a un archivo.
async function downloadBackupDB() {
  try {
    showToast('info', 'Generando backup… puede tardar unos segundos');
    const res = await apiFetch('/api/admin/backup');
    if (!res || !res.ok) {
      let msg = 'No se pudo generar el backup';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
      showToast('error', msg);
      return;
    }
    // Nombre del archivo desde el header Content-Disposition (o uno por defecto).
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = m ? m[1] : `fleetos-backup-${stamp}.sql.gz`;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('ok', 'Backup descargado');
  } catch (err) {
    console.error('[downloadBackupDB]', err);
    showToast('error', 'Error al descargar el backup');
  }
}

function openNewUserModal() {
  const rolesOpts = ROLES_LIST.map(r => `<option value="${r.value}">${r.label}</option>`).join('');
  const vehiclesOpts = (App.data.vehicles||[]).map(v => `<option value="${escapeHtml(v.code)}">${escapeHtml(v.code)} · ${escapeHtml(v.plate)}</option>`).join('');

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
      ${userOrgSelect('nu', '', '')}
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
  const vehicle  = document.getElementById('nu-vehicle')?.value || '';
  const sucursal = document.getElementById('nu-sucursal')?.value || '';
  const area     = document.getElementById('nu-area')?.value || '';

  if (!name || !email || !pass) { showToast('error','Nombre, email y contraseña son obligatorios'); return; }

  const res = await apiFetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ name, email, role, password: pass, vehicle_code: vehicle || null, sucursal: sucursal || null, area: area || null })
  });
  if (!res.ok) { const e=await res.json(); showToast('error', e.error||'Error al crear usuario'); return; }

  closeModal(); showToast('ok',`Usuario ${name} creado`);
  renderUsers(); loadInitialData().then(()=>renderUsers());
}


function openEditUserModal(id) {
  const u = (App.data.users || []).find(x => String(x.id) === String(id));
  if (!u) { showToast('error', 'Usuario no encontrado — recargá la lista'); return; }
  const name = u.name, email = u.email, role = u.role;
  const vehicle = u.vehicle_code || '', active = !!u.active, sucursal = u.sucursal || '', area = u.area || '';
  const rolesOpts = ROLES_LIST.map(r => `<option value="${r.value}" ${r.value===role?'selected':''}>${r.label}</option>`).join('');
  const vehiclesOpts = (App.data.vehicles||[]).map(v => `<option value="${escapeHtml(v.code)}" ${v.code===vehicle?'selected':''}>${escapeHtml(v.code)} · ${escapeHtml(v.plate)}</option>`).join('');

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
      ${userOrgSelect('eu', sucursal || '', area || '')}
      <div class="form-group" id="eu-supplier-group" style="display:${role==='proveedores'?'block':'none'}">
        <label class="form-label">Proveedor vinculado <span style="color:#ef4444">*</span></label>
        <select class="form-select" id="eu-supplier">
          <option value="">— Cargar al guardar —</option>
        </select>
        <div style="font-size:11px;color:var(--text3);margin-top:4px">Solo verá las OCs de este proveedor</div>
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
  const sucursal = document.getElementById('eu-sucursal')?.value || '';
  const area     = document.getElementById('eu-area')?.value || '';
  const errDiv   = document.getElementById('eu-error');

  if (!name || !role) { if(errDiv) errDiv.textContent = 'Nombre y rol son obligatorios'; return; }
  if (password && password.length < 8) { if(errDiv) errDiv.textContent = 'La contraseña debe tener al menos 8 caracteres'; return; }

  try {
    const supplier_id = document.getElementById('eu-supplier')?.value || null;
    const body = { name, role, vehicle_code: vehicle || null, active, supplier_id, sucursal: sucursal || null, area: area || null };
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
// ═══════════════════════════════════════════════════════════
//  ÓRDENES DE TRABAJO — Tabla mejorada con filtros, sort,
//  inline edit, progreso, export PDF.
// ═══════════════════════════════════════════════════════════

// Estado global de la tabla (filtros, ordenamiento)
App.otTable = App.otTable || {
  search: '',
  status: 'all',
  priority: 'all',
  type: 'all',
  hideClosed: false,
  sortKey: 'opened',
  sortDir: 'desc',
};

function renderWorkOrders() {
  const root = document.getElementById('page-workorders');
  if (!root) return;

  const all    = App.data.workOrders || [];
  const open   = all.filter(o => o.status !== 'Cerrada');
  const inProc = open.filter(o => o.status === 'En proceso');
  const waiting= open.filter(o => (o.status||'').includes('Esperando'));
  const closed = all.filter(o => o.status === 'Cerrada');

  // Filtros únicos para los dropdowns
  const allStatuses  = [...new Set(all.map(o => o.status).filter(Boolean))];
  const allPriorities = [...new Set(all.map(o => o.priority).filter(Boolean))];
  const allTypes      = [...new Set(all.map(o => o.type).filter(Boolean))];

  root.innerHTML = `
    <div class="kpi-row kpi-row-4" style="margin-bottom:20px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
      <div class="kpi-card ${open.length<5?'ok':'warn'}">
        <div class="kpi-label">OT abiertas</div>
        <div class="kpi-value ${open.length<5?'ok':'warn'}">${open.length}</div>
        <div class="kpi-trend">requieren atención</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-label">En proceso</div>
        <div class="kpi-value info">${inProc.length}</div>
        <div class="kpi-trend">en ejecución activa</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(217,119,6,.35)">
        <div class="kpi-label">Esperando</div>
        <div class="kpi-value" style="color:var(--warn)">${waiting.length}</div>
        <div class="kpi-trend">repuesto / aprobación</div>
      </div>
      <div class="kpi-card ok">
        <div class="kpi-label">Cerradas (mes)</div>
        <div class="kpi-value ok">${closed.length}</div>
        <div class="kpi-trend">completadas</div>
      </div>
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <input id="ot-search" type="text" placeholder="🔍 Buscar ID, vehículo, descripción..." value="${App.otTable.search}"
        oninput="App.otTable.search=this.value;_otRenderRows()"
        style="flex:1;min-width:200px;max-width:320px;padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-family:inherit;font-size:13px">

      <select id="ot-f-status" onchange="App.otTable.status=this.value;_otRenderRows()"
        style="padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-family:inherit;font-size:12px">
        <option value="all" ${App.otTable.status==='all'?'selected':''}>Estado: Todos</option>
        ${allStatuses.map(s => `<option value="${s}" ${App.otTable.status===s?'selected':''}>${s}</option>`).join('')}
      </select>

      <select id="ot-f-priority" onchange="App.otTable.priority=this.value;_otRenderRows()"
        style="padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-family:inherit;font-size:12px">
        <option value="all" ${App.otTable.priority==='all'?'selected':''}>Prioridad: Todas</option>
        ${allPriorities.map(p => `<option value="${p}" ${App.otTable.priority===p?'selected':''}>${p}</option>`).join('')}
      </select>

      <select id="ot-f-type" onchange="App.otTable.type=this.value;_otRenderRows()"
        style="padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-family:inherit;font-size:12px">
        <option value="all" ${App.otTable.type==='all'?'selected':''}>Tipo: Todos</option>
        ${allTypes.map(t => `<option value="${t}" ${App.otTable.type===t?'selected':''}>${t}</option>`).join('')}
      </select>

      <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);cursor:pointer">
        <input type="checkbox" ${App.otTable.hideClosed?'checked':''} onchange="App.otTable.hideClosed=this.checked;_otRenderRows()">
        Ocultar cerradas
      </label>

      <div style="margin-left:auto;display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="_otExportPDF()" title="Descargar PDF con las OTs visibles">📄 PDF</button>
        <button class="btn btn-primary" onclick="openNewOTModal()">+ Nueva OT</button>
      </div>
    </div>

    <div id="ot-table-wrap" class="card" style="padding:0;overflow:hidden">
      <div style="overflow-x:auto">
        <table id="ot-table" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead id="ot-thead"></thead>
          <tbody id="ot-tbody"></tbody>
        </table>
      </div>
      <div id="ot-footer" style="padding:10px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text3);display:flex;justify-content:space-between;align-items:center;background:var(--bg2)"></div>
    </div>
  `;

  _otRenderRows();
}

// Renderiza thead + tbody según filtros y sort actuales
function _otRenderRows() {
  const thead = document.getElementById('ot-thead');
  const tbody = document.getElementById('ot-tbody');
  const footer= document.getElementById('ot-footer');
  if (!thead || !tbody) return;

  const all = App.data.workOrders || [];
  const T   = App.otTable;

  // Filtrar
  let rows = all.filter(o => {
    if (T.hideClosed && o.status === 'Cerrada') return false;
    if (T.status !== 'all' && o.status !== T.status) return false;
    if (T.priority !== 'all' && o.priority !== T.priority) return false;
    if (T.type !== 'all' && o.type !== T.type) return false;
    if (T.search) {
      const q = T.search.toLowerCase();
      const hay = [o.id, o.vehicle, o.plate, o.desc, o.mechanic].filter(Boolean).map(s=>String(s).toLowerCase());
      if (!hay.some(h => h.includes(q))) return false;
    }
    return true;
  });

  // Ordenar
  const getSortVal = (o, k) => {
    if (k === 'cost') return (parseFloat(o.parts_cost)||0);
    if (k === 'opened') return o.opened || '';
    if (k === 'priority') {
      const order = {'Urgente':4,'Crítica':4,'Alta':3,'Media':2,'Normal':1,'Baja':0};
      return order[o.priority] ?? 0;
    }
    return (o[k] || '').toString().toLowerCase();
  };
  rows.sort((a,b) => {
    const va = getSortVal(a, T.sortKey);
    const vb = getSortVal(b, T.sortKey);
    if (va < vb) return T.sortDir === 'asc' ? -1 : 1;
    if (va > vb) return T.sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // Header con sort
  const cols = [
    ['id',       'ID'],
    ['vehicle',  'Vehículo'],
    ['type',     'Tipo'],
    ['desc',     'Descripción'],
    ['mechanic', 'Mecánico'],
    ['status',   'Estado'],
    ['priority', 'Prioridad'],
    ['progress', 'Progreso', true],
    ['cost',     'Costo'],
    ['opened',   'Apertura'],
    ['actions',  '', true],
  ];
  thead.innerHTML = `<tr style="background:var(--bg3);border-bottom:2px solid var(--border)">${cols.map(([k, label, noSort]) => {
    const isSorted = !noSort && T.sortKey === k;
    const arrow = isSorted ? (T.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    const cls = isSorted ? 'color:var(--accent)' : 'color:var(--text3)';
    const cursor = noSort ? 'default' : 'pointer';
    return `<th onclick="${noSort?'':'_otSort(\''+k+'\')'}" style="text-align:left;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:600;cursor:${cursor};white-space:nowrap;font-family:var(--mono);${cls}">${label}${arrow}</th>`;
  }).join('')}</tr>`;

  // Body
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" style="text-align:center;padding:40px;color:var(--text3)">
      Sin órdenes de trabajo ${T.search||T.status!=='all'||T.priority!=='all'?'que coincidan con los filtros':'registradas'}
    </td></tr>`;
  } else {
    tbody.innerHTML = rows.map(o => _otRenderRow(o)).join('');
  }

  // Footer con conteo
  if (footer) {
    const totalCost = rows.reduce((a,o) => a + (parseFloat(o.parts_cost)||0), 0);
    footer.innerHTML = `
      <span>Mostrando <b style="color:var(--text)">${rows.length}</b> de ${all.length} OTs</span>
      <span>Costo total visible: <b style="color:var(--text);font-family:var(--mono)">$${Math.round(totalCost).toLocaleString('es-AR')}</b></span>
    `;
  }
}

function _otSort(key) {
  const T = App.otTable;
  if (T.sortKey === key) {
    T.sortDir = T.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    T.sortKey = key;
    T.sortDir = 'asc';
  }
  _otRenderRows();
}

// Render de UNA fila (con inline edit en status y priority)
function _otRenderRow(o) {
  const priorityBar = {
    'Urgente':  'var(--danger)', 'Crítica':'var(--danger)',
    'Alta':     'var(--warn)',   'Media':  'var(--warn)',
    'Normal':   'var(--accent)', 'Baja':   'var(--text3)',
  }[o.priority] || 'var(--border2)';

  const progress = _otProgress(o.status);
  const progColor = o.status === 'Cerrada' ? 'var(--ok)' :
                    o.status === 'En proceso' ? 'var(--info)' :
                    (o.status||'').includes('Esperando') ? 'var(--warn)' : 'var(--text3)';

  const totalCost = (parseFloat(o.parts_cost)||0);
  const isClosed = o.status === 'Cerrada';

  // Opciones de estados/prioridades para inline edit
  const statusOpts = ['Pendiente','Asignada','En proceso','Esperando repuesto','Esperando tercerizado','Cerrada'];
  const prioOpts   = ['Normal','Media','Urgente'];

  const canEdit = !isClosed && ['dueno','gerencia','jefe_mantenimiento','mecanico'].includes(App.currentUser?.role);

  return `<tr style="border-left:3px solid ${priorityBar};border-bottom:1px solid var(--border);transition:background .1s"
    onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='transparent'">

    <td style="padding:10px 12px;font-family:var(--mono);font-weight:600;color:var(--accent)">${o.id||'—'}</td>

    <td style="padding:10px 12px">
      <div style="font-family:var(--mono);font-weight:700;font-size:13px;color:var(--text)">${o.vehicle||'—'}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--text3)">${escapeHtml(o.plate||'—')}</div>
    </td>

    <td style="padding:10px 12px">
      <span class="badge ${o.type==='Preventivo'?'badge-ok':'badge-gray'}" style="font-size:10px">${o.type||'—'}</span>
    </td>

    <td style="padding:10px 12px;max-width:150px;color:var(--text2);font-size:12px;line-height:1.35">
      ${(o.desc||'—').substring(0,80)}${(o.desc||'').length>80?'…':''}
    </td>

    <td style="padding:10px 12px;font-size:12px;color:var(--text2)">${o.mechanic||'—'}</td>

    <td style="padding:10px 12px">
      ${canEdit ? `
        <select onchange="_otInlineEdit('${o._uuid||o.id}','status',this.value)"
          style="padding:3px 8px;border:1px solid var(--border2);border-radius:12px;background:var(--bg);color:var(--text);font-family:var(--mono);font-size:10px;cursor:pointer">
          ${statusOpts.map(s => `<option value="${s}" ${s===o.status?'selected':''}>${s}</option>`).join('')}
        </select>
      ` : `<span class="badge ${isClosed?'badge-ok':(o.status||'').includes('Esperando')?'badge-warn':o.status==='En proceso'?'badge-info':'badge-gray'}" style="font-size:10px">${o.status||'—'}</span>`}
    </td>

    <td style="padding:10px 12px">
      ${canEdit ? `
        <select onchange="_otInlineEdit('${o._uuid||o.id}','priority',this.value)"
          style="padding:3px 8px;border:1px solid var(--border2);border-radius:12px;background:var(--bg);color:${priorityBar};font-weight:600;font-family:var(--mono);font-size:10px;cursor:pointer">
          ${prioOpts.map(p => `<option value="${p}" ${p===o.priority?'selected':''}>${p}</option>`).join('')}
        </select>
      ` : `<span class="badge ${o.priority==='Urgente'?'badge-danger':o.priority==='Media'?'badge-warn':'badge-gray'}" style="font-size:10px">${o.priority||'—'}</span>`}
    </td>

    <td style="padding:10px 12px;min-width:72px">
      <div style="display:flex;align-items:center;gap:6px">
        <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;min-width:34px;max-width:52px">
          <div style="height:100%;background:${progColor};width:${progress}%;transition:width .3s"></div>
        </div>
        <span style="font-size:10px;font-family:var(--mono);color:var(--text3);min-width:30px">${progress}%</span>
      </div>
    </td>

    <td style="padding:10px 12px;font-family:var(--mono);font-weight:600;font-size:12px;color:${totalCost>0?'var(--text)':'var(--text3)'}">
      ${totalCost>0 ? '$'+Math.round(totalCost).toLocaleString('es-AR') : '—'}
    </td>

    <td style="padding:10px 12px;font-family:var(--mono);font-size:10px;color:var(--text3);white-space:nowrap">
      ${(o.opened||'—').toString().split(' ')[0]}
    </td>

    <td style="padding:10px 12px;white-space:nowrap;text-align:right">
      ${isClosed ? `
        <button class="btn btn-secondary btn-sm" onclick="openEditOTModal('${o.id||o._id}')">Ver</button>
      ` : `
        <button class="btn btn-secondary btn-sm" onclick="openEditOTModal('${o.id||o._id}')">Editar</button>
        ${['dueno','gerencia','jefe_mantenimiento','mecanico'].includes(App.currentUser?.role) ?
          `<button class="btn btn-primary btn-sm" onclick="closeOT('${o.id||o._id}')" style="margin-left:4px">Cerrar</button>` : ''}
      `}
      <button class="btn btn-secondary btn-sm" onclick="printOT('${o.id||o._id}')" title="Imprimir" style="margin-left:4px">🖨</button>
    </td>
  </tr>`;
}

// Calcula % de progreso según status
function _otProgress(status) {
  const map = {
    'Pendiente': 0,
    'Asignada': 15,
    'Esperando repuesto': 30,
    'Esperando tercerizado': 30,
    'En proceso': 60,
    'Cerrada': 100,
  };
  return map[status] ?? 10;
}

// Inline edit: cambiar un campo vía API sin abrir modal
async function _otInlineEdit(uuid, field, newValue) {
  const ot = (App.data.workOrders || []).find(o => (o._uuid||o.id) === uuid);
  if (!ot) { showToast?.('error','OT no encontrada'); return; }

  // Backup para revertir si falla
  const oldValue = ot[field];
  ot[field] = newValue;

  const body = {
    status:       ot.status,
    mechanic_id: null,
    description:  ot.desc,
    labor_cost:   parseFloat(ot.labor_cost) || 0,
    parts_cost:   parseFloat(ot.parts_cost) || 0,
    priority:     ot.priority,
  };

  try {
    const res = await apiFetch(`/api/workorders/${uuid}`, {
      method: 'PUT', body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Error HTTP');
    showToast?.('ok', `${field==='status'?'Estado':'Prioridad'} actualizado: ${newValue}`);
    _otRenderRows();
  } catch(err) {
    ot[field] = oldValue; // revertir
    showToast?.('error', 'No se pudo actualizar. Revisá permisos.');
    _otRenderRows();
  }
}

// Export a PDF con las OTs actualmente visibles (respeta filtros)
function _otExportPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast?.('error','jsPDF no cargado. Refrescá la página.');
    return;
  }

  const all = App.data.workOrders || [];
  const T   = App.otTable;

  // Aplicar mismos filtros que la tabla
  let rows = all.filter(o => {
    if (T.hideClosed && o.status === 'Cerrada') return false;
    if (T.status !== 'all' && o.status !== T.status) return false;
    if (T.priority !== 'all' && o.priority !== T.priority) return false;
    if (T.type !== 'all' && o.type !== T.type) return false;
    if (T.search) {
      const q = T.search.toLowerCase();
      const hay = [o.id, o.vehicle, o.plate, o.desc, o.mechanic].filter(Boolean).map(s=>String(s).toLowerCase());
      if (!hay.some(h => h.includes(q))) return false;
    }
    return true;
  });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  const startY = _pdfHeader(doc, 'Órdenes de Trabajo', `${rows.length} OT${rows.length===1?'':'s'}`);

  // Tabla
  const tableData = rows.map(o => [
    o.id || '—',
    o.vehicle || '—',
    o.plate || '—',
    o.type || '—',
    (o.desc || '—').substring(0,60),
    o.mechanic || '—',
    o.status || '—',
    o.priority || '—',
    `$${Math.round((parseFloat(o.parts_cost)||0) + (parseFloat(o.labor_cost)||0)).toLocaleString('es-AR')}`,
    (o.opened||'—').split(' ')[0],
  ]);

  doc.autoTable({
    startY: startY,
    head: [['ID','Veh','Patente','Tipo','Descripción','Mecánico','Estado','Prioridad','Costo','Apertura']],
    body: tableData,
    ..._pdfTableStyle(),
    columnStyles: {
      0: { cellWidth: 50, fontStyle: 'bold' },
      1: { cellWidth: 60 },
      2: { cellWidth: 60 },
      3: { cellWidth: 60 },
      4: { cellWidth: 180 },
      8: { halign: 'right', fontStyle: 'bold' },
    },
  });

  // Total en el pie
  const totalCost = rows.reduce((a,o) => a + (parseFloat(o.parts_cost)||0), 0);
  const finalY = doc.lastAutoTable.finalY || 90;
  doc.setFontSize(10);
  doc.setFont('helvetica','bold');
  doc.setTextColor(BILETTA_BRAND.dark[0], BILETTA_BRAND.dark[1], BILETTA_BRAND.dark[2]);
  doc.text(`TOTAL VISIBLE: $${Math.round(totalCost).toLocaleString('es-AR')}`, 40, finalY + 20);

  const fileDate = todayISO();
  doc.save(`OTs-Biletta-${fileDate}.pdf`);
  showToast?.('ok','PDF descargado');
}

// ── PANEL ENCARGADO ──
// ═══════════════════════════════════════════════════════════════════
//  ACTIVIDAD DEL DÍA (resumen operativo) — helper reutilizable
//  Usado por:
//   - renderEncargadoPanel (página encargado_panel, legacy)
//   - renderDashboard (página principal, al final del dashboard)
//  Hace el fetch a /api/encargado/resumen y pinta todo dentro del
//  contenedor que se le pase (por ID).
// ═══════════════════════════════════════════════════════════════════
async function _renderDailyActivityInto(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)">Cargando actividad del día...</div>`;

  try {
    // Verificar tickets pendientes (solo dispara un toast, no bloquea)
    const tickRes = await apiFetch('/api/fuel/pendientes-verificacion');
    const tickPendientes = tickRes.ok ? await tickRes.json() : [];
    if (tickPendientes.length > 0) {
      showToast('warn', `🧾 ${tickPendientes.length} ticket${tickPendientes.length>1?'s':''} de combustible pendiente${tickPendientes.length>1?'s':''} de verificación`);
    }
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
        <div style="font-size:13px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Actividad · ${today}</div>
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
                    <span><b>${escapeHtml(v.code)}</b> ${escapeHtml(v.plate)}</span>
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
                    <div style="color:var(--text3);font-size:12px;margin-top:2px">${escapeHtml((o.description||'').substring(0,60))}${o.description?.length>60?'...':''}</div>
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
                <td style="font-size:11px;color:var(--text3)">${escapeHtml(c.observations?c.observations.substring(0,40)+'...':'—')}</td>
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
                <td>${escapeHtml(f.location||'—')}</td>
                <td>${f.ticket_image?'<span style="color:var(--ok)">✓ Sí</span>':'<span style="color:var(--text3)">No</span>'}</td>
              </tr>`).join('')}</tbody>
            </table></div>`
        }
      </div>
    `;
  } catch(err) {
    el.innerHTML = `<div style="color:var(--warn);padding:20px">Error al cargar la actividad del día: ${err.message}</div>`;
  }
}

// Compat: página encargado_panel sigue existiendo por si algún link viejo la llama
async function renderEncargadoPanel() {
  await _renderDailyActivityInto('page-encargado_panel');
}

// ── FUNCIONES FALTANTES ──────────────────────────────────────────────────────

function openNewVehicleModal() {
  openModal('Registrar nueva unidad', `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Código interno</label><input class="form-input" placeholder="Ej: INT-46" id="nv-code"></div>
      <div class="form-group"><label class="form-label">Patente</label><input class="form-input" placeholder="Ej: ABC 001" id="nv-plate"><div id="nv-plate-help" style="font-size:11px;color:var(--text3);margin-top:4px"></div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Marca</label><input class="form-input" placeholder="Ej: Mercedes-Benz" id="nv-brand"></div>
      <div class="form-group"><label class="form-label">Modelo</label><input class="form-input" placeholder="Ej: Actros 2651" id="nv-model"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Año</label><input class="form-input" type="number" placeholder="Ej: 2019" id="nv-year"></div>
      <div class="form-group"><label class="form-label">Tipo</label>
        <select class="form-select" id="nv-type" onchange="updateVehicleTypeLabels('nv')">
          ${(App.config?.vehicle_types||['tractor','camion','semirremolque','acoplado','utilitario','autoelevador']).map(t=>`<option value="${t}">${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" id="nv-km-label">Km actuales</label><input class="form-input" type="number" placeholder="Ej: 250000" id="nv-km"></div>
      <div class="form-group"><label class="form-label">Base operativa</label>
        <select class="form-select" id="nv-base">
          ${(App.config?.bases||['Central','Norte','Sur']).map(b=>`<option value="${b}">${b}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" id="nv-driver-label">Chofer habitual</label><input class="form-input" placeholder="Ej: Juan Pérez" id="nv-driver"></div>
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
  updateVehicleTypeLabels('nv');
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
  if (!plate && !isAutoelevador(type)) { showToast('error', 'La patente es obligatoria para unidades patentadas'); return; }
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
  window._otParts = [];

  // Cargar activos si no están cargados aún
  if (!App.data.assets) loadAssetsIntoData();

  openModal('🛠️ Nueva orden de trabajo', `
    <style>
      .otv-step{margin-bottom:18px}
      .otv-sh{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
      .otv-num{width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
      .otv-t{font-size:14px;font-weight:700;color:var(--text)}
      .otv-opt{font-weight:500;color:var(--text3);font-size:12px}
      .otv-body{margin-left:34px}
      .otv-div{height:1px;background:var(--border);margin:0 0 16px 34px}
    </style>

    <!-- PASO 1 -->
    <div class="otv-step">
      <div class="otv-sh"><div class="otv-num">1</div><div class="otv-t">¿Qué hay que arreglar?</div></div>
      <div class="otv-body">
        <div id="ot-tipo-pills" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          ${[
            ['vehiculo',    '🚛 Vehículo'],
            ['edilicio',    '🏢 Edificio'],
            ['herramienta', '🧰 Herramienta'],
            ['equipo',      '⚙️ Equipo'],
            ['informatica', '💻 Informática'],
            ['instalacion', '🔌 Instalación'],
            ['otro',        '📌 Otro'],
          ].map(([v,label]) => `
            <button type="button" class="ot-tipo-pill" data-tipo="${v}" onclick="_otSelectTipo('${v}')"
              style="padding:8px 15px;border:1.5px solid var(--border2);border-radius:20px;background:${v==='vehiculo'?'var(--accent)':'var(--bg)'};color:${v==='vehiculo'?'white':'var(--text2)'};cursor:pointer;font-size:12.5px;font-weight:600;transition:.15s">
              ${label}
            </button>
          `).join('')}
        </div>
        <div class="form-group" id="ot-target-group" style="margin:0">
          <label class="form-label" id="ot-target-label">¿Cuál? <span style="color:var(--danger)">*</span></label>
          <select class="form-select" id="ot-target-select">
            <option value="">— Cargando... —</option>
          </select>
          <div style="font-size:11px;margin-top:4px" id="ot-target-hint"></div>
        </div>
      </div>
    </div>
    <div class="otv-div"></div>

    <!-- PASO 2 -->
    <div class="otv-step">
      <div class="otv-sh"><div class="otv-num">2</div><div class="otv-t">¿Qué pasa y qué urgencia tiene?</div></div>
      <div class="otv-body">
        <div class="form-group"><label class="form-label">Contanos el problema <span style="color:var(--danger)">*</span></label>
          <input class="form-input" placeholder="Ej: Pierde aceite / Cambio de aceite y filtros" id="ot-title">
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Tipo de trabajo</label>
            <select class="form-select" id="ot-type">
              <option value="Correctivo">🔧 Correctivo (se rompió)</option>
              <option value="Preventivo">🗓️ Preventivo (mantenimiento)</option>
              <option value="Predictivo">📊 Predictivo</option>
            </select>
          </div>
          <div class="form-group"><label class="form-label">Prioridad</label>
            <select class="form-select" id="ot-priority">
              <option value="Normal">⚪ Normal — sin apuro</option>
              <option value="Media">🟡 Media — esta semana</option>
              <option value="Urgente">🔴 Urgente — ya</option>
            </select>
          </div>
        </div>
      </div>
    </div>
    <div class="otv-div"></div>

    <!-- PASO 3 -->
    <div class="otv-step">
      <div class="otv-sh"><div class="otv-num">3</div><div class="otv-t">¿Quién lo hace y para cuándo?</div><span class="otv-opt">(opcional)</span></div>
      <div class="otv-body">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Responsable / mecánico</label>
            <input class="form-input" list="ot-mecanicos-list" id="ot-mechanic" placeholder="Nombre del responsable">
            <datalist id="ot-mecanicos-list">
              ${(App.data.users||[]).filter(u=>['mecanico','jefe_mantenimiento','encargado_taller'].includes(u.role)).map(u=>`<option value="${escapeHtml(u.name)}">`).join('')}
            </datalist>
          </div>
          <div class="form-group"><label class="form-label">Fecha límite</label>
            <input class="form-input" type="date" id="ot-due">
          </div>
        </div>
      </div>
    </div>
    <div class="otv-div"></div>

    <!-- PASO 4 -->
    <div class="otv-step">
      <div class="otv-sh"><div class="otv-num">4</div><div class="otv-t">Repuestos y costos</div><span class="otv-opt">(opcional)</span></div>
      <div class="otv-body">
        <div style="margin:0 0 8px;display:flex;align-items:center;justify-content:space-between">
          <label class="form-label" style="margin:0;font-weight:700">🔧 Repuestos</label>
          <button class="btn btn-secondary btn-sm" type="button" onclick="addOTPart()">+ Agregar repuesto</button>
        </div>
        <div id="ot-parts-list" style="margin-bottom:8px"></div>
        <div id="ot-parts-total" style="font-size:13px;color:var(--text3);text-align:right;display:none">
          Total repuestos: <strong id="ot-parts-total-val">$0</strong>
        </div>

        <div style="margin-top:10px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;font-size:12px;color:var(--text3)">
          La mano de obra propia se registra por horas/partes de trabajo, sin precio. Las compras externas se valorizan en la OT cuando Compras aprueba el precio, aunque Tesorería todavía no haya pagado.
        </div>
        <div style="margin-top:10px;background:rgba(14,165,233,.08);border:1px solid rgba(14,165,233,.25);border-radius:var(--radius);padding:10px 12px">
          <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--text);cursor:pointer">
            <input type="checkbox" id="ot-external-required" style="margin-top:2px" onchange="document.getElementById('ot-external-desc-wrap').style.display=this.checked?'block':'none'">
            <span><strong>Mano de obra externa / tercerizada</strong><br><span style="font-size:11px;color:var(--text3)">Si el trabajo sale a un taller externo, se genera una OC separada para Compras. Los repuestos externos también generan una OC por cada ítem.</span></span>
          </label>
          <div id="ot-external-desc-wrap" style="display:none;margin-top:10px">
            <label class="form-label">Descripción del trabajo tercerizado</label>
            <input class="form-input" id="ot-external-description" placeholder="Ej: rectificación, soldadura, service externo, mano de obra de taller tercero">
          </div>
        </div>
        <div class="form-group" style="margin-top:10px"><label class="form-label">Costo estimado de repuestos</label>
          <input class="form-input" type="text" id="ot-total-display" readonly style="background:var(--bg3);font-weight:700;color:var(--accent)" value="$0">
        </div>
        <div class="form-group"><label class="form-label">Notas adicionales</label>
          <textarea class="form-input" rows="2" placeholder="Observaciones, síntomas, instrucciones..." id="ot-notes" style="resize:vertical"></textarea>
        </div>
      </div>
    </div>
  `, [
    { label: '✓ Crear OT', cls: 'btn-primary',   fn: saveNewOT },
    { label: 'Cancelar', cls: 'btn-secondary', fn: closeModal }
  ]);

  // Estado inicial: arrancamos en vehículo
  window._otTipoActual = 'vehiculo';
  _otPopulateTarget('vehiculo', preselectedVehicle);
}

// Cambia el dropdown de target según el tipo de OT
function _otSelectTipo(tipo) {
  window._otTipoActual = tipo;

  // Actualizar visual de los pills
  document.querySelectorAll('.ot-tipo-pill').forEach(btn => {
    const isActive = btn.dataset.tipo === tipo;
    btn.style.background = isActive ? 'var(--accent)' : 'var(--bg)';
    btn.style.color      = isActive ? 'white' : 'var(--text2)';
  });

  _otPopulateTarget(tipo);
}

function _otPopulateTarget(tipo, preselectedVehicle) {
  const label  = document.getElementById('ot-target-label');
  const select = document.getElementById('ot-target-select');
  const hint   = document.getElementById('ot-target-hint');
  if (!label || !select) return;

  if (tipo === 'vehiculo') {
    label.textContent = 'Unidad (vehículo)';
    const opts = (App.data.vehicles || [])
      .map(v => `<option value="${v.id||v._id}" ${preselectedVehicle===v.code?'selected':''}>${escapeHtml(v.code)} — ${escapeHtml(v.brand||'')} ${escapeHtml(v.model||'')} (${escapeHtml(v.plate)})</option>`)
      .join('');
    select.innerHTML = `<option value="">— Seleccioná una unidad —</option>${opts}`;
    if (hint) hint.innerHTML = `<span style="color:var(--text3)">${(App.data.vehicles||[]).length} unidades disponibles</span>`;
  } else {
    // Filtrar activos por tipo
    const assets = (App.data.assets || []).filter(a => a.type === tipo);
    label.textContent = {
      edilicio:    'Edificio / Oficina',
      herramienta: 'Herramienta',
      equipo:      'Equipo',
      informatica: 'Equipo informático',
      instalacion: 'Instalación',
      otro:        'Activo',
    }[tipo] || 'Activo';

    const opts = assets.map(a => `<option value="${a.id}">${escapeHtml(a.code)} — ${escapeHtml(a.name)}${a.location?' ('+escapeHtml(a.location)+')':''}</option>`).join('');

    if (assets.length === 0) {
      select.innerHTML = `<option value="">— No hay ${label.textContent.toLowerCase()}s registrados —</option>`;
      if (hint) hint.innerHTML = `<span style="color:var(--warn)">⚠️ Primero cargá activos en el módulo <b>Activos patrimoniales</b>. <a href="#" onclick="closeModal();navigate('assets');return false" style="color:var(--accent)">Ir al módulo →</a></span>`;
    } else {
      select.innerHTML = `<option value="">— Seleccioná un activo —</option>${opts}`;
      if (hint) hint.innerHTML = `<span style="color:var(--text3)">${assets.length} activo${assets.length===1?'':'s'} disponible${assets.length===1?'':'s'} de tipo "${tipo}"</span>`;
    }
  }
}

// Catálogo nuevo para los pickers de OT (crear/cerrar). Se asegura de tenerlo
// cargado y arma sugerencias "artículo × ubicación con saldo > 0".
async function _ensureStockCatalog() {
  if (Array.isArray(App.data.stockCatalog) && App.data.stockCatalog.length) return App.data.stockCatalog;
  try { const r = await apiFetch('/api/stock/catalog'); if (r.ok) App.data.stockCatalog = await r.json(); } catch (e) {}
  return App.data.stockCatalog || [];
}
function _catalogStockSuggestions(q, limit) {
  const ql = (q || '').toLowerCase();
  const out = [];
  (App.data.stockCatalog || []).forEach(a => {
    if (ql && !((a.name || '').toLowerCase().includes(ql) || (a.code || '').toLowerCase().includes(ql))) return;
    (a.balances || []).forEach(b => {
      const qty = parseFloat(b.qty_current) || 0;
      if (qty > 0) out.push({ catalog_id: a.id, code: a.code, name: a.name, unit: a.unit || 'un',
        unit_cost: parseFloat(a.unit_cost) || 0, base_location: b.base_location, area: b.area, qty });
    });
  });
  return out.slice(0, limit || 12);
}

function addOTPart() {
  if (!window._otParts) window._otParts = [];
  _ensureStockCatalog();
  const idx = window._otParts.length;
  window._otParts.push({ name:'', qty:1, unit:'un', unit_cost:0, origin:'externo', stock_id:null });

  const container = document.getElementById('ot-parts-list');
  if (!container) return;
  const div = document.createElement('div');
  div.id = 'ot-part-row-' + idx;
  div.style.cssText = 'display:grid;grid-template-columns:90px 1fr 60px 60px 110px 32px;gap:6px;margin-bottom:6px;align-items:start;position:relative';
  div.innerHTML = `
    <select class="form-select" id="otp-origin-${idx}"
      onchange="changeOTPartOrigin(${idx}, this.value)"
      style="font-size:12px;padding:6px">
      <option value="externo">🛒 Externo / genera OC</option>
      <option value="stock">📦 Pañol</option>
    </select>
    <div style="position:relative">
      <input class="form-input" placeholder="Descripción del repuesto" id="otp-name-${idx}"
        oninput="onOTPartNameInput(${idx}, this.value)" autocomplete="off"
        style="font-size:13px;width:100%">
      <div id="otp-suggestions-${idx}" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border2);border-radius:0 0 var(--radius) var(--radius);z-index:100;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.25)"></div>
      <div id="otp-stock-info-${idx}" style="display:none;font-size:10px;color:var(--text3);padding:3px 0">
        <span id="otp-stock-msg-${idx}"></span>
      </div>
    </div>
    <input class="form-input" type="number" value="1" min="0.01" id="otp-qty-${idx}"
      oninput="onOTPartQtyChange(${idx})" style="font-size:13px;text-align:center">
    <input class="form-input" value="un" id="otp-unit-${idx}"
      oninput="updateOTPartField(${idx},'unit',this.value)" style="font-size:13px;text-align:center">
    <input class="form-input" type="number" value="0" placeholder="Precio" id="otp-cost-${idx}"
      oninput="updateOTPartField(${idx},'unit_cost',parseFloat(this.value)||0)" style="font-size:13px;text-align:right">
    <button type="button" onclick="removeOTPart(${idx})"
      style="background:none;border:1px solid var(--border2);border-radius:6px;cursor:pointer;color:var(--danger);font-size:16px;padding:0 6px;height:36px">✕</button>`;
  container.appendChild(div);
  document.getElementById('ot-parts-total').style.display = 'block';
  updateOTTotal();
}

// Cuando el usuario cambia el selector "Externo" / "Pañol"
function changeOTPartOrigin(idx, origin) {
  if (!window._otParts[idx]) return;
  window._otParts[idx].origin = origin;
  const nameEl = document.getElementById('otp-name-' + idx);
  const stockInfoEl = document.getElementById('otp-stock-info-' + idx);
  const sugEl = document.getElementById('otp-suggestions-' + idx);

  if (origin === 'externo') {
    // Limpiar vinculación al stock
    window._otParts[idx].stock_id = null;
    window._otParts[idx].catalog_id = null;
    if (nameEl) {
      nameEl.placeholder = 'Descripción del repuesto (compra externa)';
      nameEl.style.borderLeft = '';
      nameEl.dataset.stockId = '';
      nameEl.dataset.catalogId = '';
    }
    if (stockInfoEl) stockInfoEl.style.display = 'none';
    if (sugEl) sugEl.style.display = 'none';
  } else {
    // Origen = stock: asegurar catálogo cargado y mostrar hint para buscar
    _ensureStockCatalog();
    if (nameEl) {
      nameEl.placeholder = 'Escribí para buscar en el pañol...';
      nameEl.value = '';
      nameEl.dataset.stockId = '';
      nameEl.dataset.catalogId = '';
      nameEl.style.borderLeft = '';
    }
    if (stockInfoEl) {
      stockInfoEl.style.display = 'block';
      const msg = document.getElementById('otp-stock-msg-' + idx);
      if (msg) msg.innerHTML = '<span style="color:var(--accent)">📦 Elegí un ítem del pañol</span>';
    }
    // Resetear cantidad/precio
    const qtyEl = document.getElementById('otp-qty-' + idx);
    const costEl = document.getElementById('otp-cost-' + idx);
    if (qtyEl) qtyEl.value = 1;
    if (costEl) { costEl.value = 0; costEl.readOnly = false; }
  }
  updateOTTotal();
}

// Input del nombre: si es stock, busca autocompletado; si es externo, solo guarda texto
function onOTPartNameInput(idx, val) {
  if (!window._otParts[idx]) return;
  window._otParts[idx].name = val;

  const origin = window._otParts[idx].origin;
  const sugEl = document.getElementById('otp-suggestions-' + idx);
  if (!sugEl) return;

  if (origin !== 'stock') {
    // Origen externo: sin sugerencias
    sugEl.style.display = 'none';
    return;
  }

  // Si el usuario modifica el texto después de haber seleccionado, desvincula
  const nameEl = document.getElementById('otp-name-' + idx);
  if (nameEl && (nameEl.dataset.stockId || nameEl.dataset.catalogId)) {
    window._otParts[idx].stock_id = null;
    window._otParts[idx].catalog_id = null;
    nameEl.dataset.stockId = '';
    nameEl.dataset.catalogId = '';
    nameEl.style.borderLeft = '';
  }

  if (!val || val.length < 2) { sugEl.style.display = 'none'; return; }
  const sugg = _catalogStockSuggestions(val, 10);

  if (!sugg.length) {
    sugEl.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:12px;text-align:center">Sin resultados con stock en el pañol. Cambiá a "Externo" si es una compra de afuera.</div>';
    sugEl.style.display = 'block';
    return;
  }

  sugEl.innerHTML = sugg.map(s => {
    const safeName = String(s.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    return `<div onclick="selectOTCatalogItem(${idx},'${s.catalog_id}','${safeName}','${escapeJsArg(s.unit)}',${s.unit_cost},${s.qty},'${escapeJsArg(s.base_location)}','${escapeJsArg(s.area)}')"
      style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <div>
        <div style="font-weight:600">${escapeHtml(s.name)}</div>
        <div style="color:var(--text3);font-size:11px"><span style="font-family:monospace">${escapeHtml(s.code)}</span> · ${escapeHtml(s.base_location)} / ${escapeHtml(s.area)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;color:var(--accent)">$${Math.round(s.unit_cost).toLocaleString('es-AR')}/${escapeHtml(s.unit)}</div>
        <div style="font-size:10px;color:var(--ok);font-weight:700">Stock: ${s.qty} ${escapeHtml(s.unit)}</div>
      </div>
    </div>`;
  }).join('');
  sugEl.style.display = 'block';
}

// Cuando eligen un ítem del autocompletado
function selectOTCatalogItem(idx, catalogId, name, unit, unitCost, qtyAvailable, baseLocation, area) {
  if (!window._otParts[idx]) return;
  const p = window._otParts[idx];
  p.name = name; p.unit = unit; p.unit_cost = unitCost;
  p.origin = 'stock'; p.stock_id = null;
  p.catalog_id = catalogId; p.base_location = baseLocation; p.area = area;

  const nameEl = document.getElementById('otp-name-' + idx);
  const unitEl = document.getElementById('otp-unit-' + idx);
  const costEl = document.getElementById('otp-cost-' + idx);
  const sugEl = document.getElementById('otp-suggestions-' + idx);
  const msgEl = document.getElementById('otp-stock-msg-' + idx);
  const infoEl = document.getElementById('otp-stock-info-' + idx);

  if (nameEl) {
    nameEl.value = name;
    nameEl.dataset.catalogId = catalogId;
    nameEl.dataset.baseLocation = baseLocation;
    nameEl.dataset.area = area;
    nameEl.dataset.stockId = '';
    nameEl.dataset.stockAvailable = qtyAvailable;
    nameEl.style.borderLeft = '3px solid var(--ok)';
  }
  if (unitEl) unitEl.value = unit;
  if (costEl) { costEl.value = unitCost; costEl.readOnly = true; costEl.style.background = 'var(--bg3)'; }
  if (sugEl) sugEl.style.display = 'none';
  if (infoEl) infoEl.style.display = 'block';
  if (msgEl) msgEl.innerHTML = `<span style="color:var(--ok)">✓ ${escapeHtml(baseLocation)}/${escapeHtml(area)} · Disponible: <b>${qtyAvailable} ${escapeHtml(unit)}</b></span>`;
  // Validar cantidad contra disponible
  onOTPartQtyChange(idx);
  updateOTTotal();
  if (typeof showToast === 'function') showToast('ok', 'Repuesto vinculado al pañol');
}

// Al cambiar la cantidad: validar contra stock disponible si es del pañol
function onOTPartQtyChange(idx) {
  if (!window._otParts[idx]) return;
  const qtyEl = document.getElementById('otp-qty-' + idx);
  const nameEl = document.getElementById('otp-name-' + idx);
  const msgEl = document.getElementById('otp-stock-msg-' + idx);
  const qty = parseFloat(qtyEl?.value) || 0;
  window._otParts[idx].qty = qty;

  if (window._otParts[idx].origin === 'stock' && (nameEl?.dataset.stockId || nameEl?.dataset.catalogId)) {
    const available = parseFloat(nameEl.dataset.stockAvailable || 0);
    if (qty > available) {
      if (qtyEl) qtyEl.style.borderColor = 'var(--danger)';
      if (msgEl) msgEl.innerHTML = `<span style="color:var(--danger)">⚠️ Cantidad mayor al disponible (${available})</span>`;
    } else {
      if (qtyEl) qtyEl.style.borderColor = '';
      if (msgEl) msgEl.innerHTML = `<span style="color:var(--ok)">✓ Disponible: <b>${available}</b> · Usando: <b>${qty}</b> · Queda: <b>${available - qty}</b></span>`;
    }
  }
  updateOTTotal();
}

function removeOTPart(idx) {
  window._otParts[idx] = null;
  document.getElementById('ot-part-row-' + idx)?.remove();
  updateOTTotal();
}

function updateOTPartField(idx, field, val) {
  if (!window._otParts[idx]) return;
  window._otParts[idx][field] = val;
  updateOTTotal();
}

function updateOTTotal() {
  // Leer directo de los inputs del DOM
  let partsTotal = 0;
  document.querySelectorAll('[id^="otp-qty-"]').forEach(qtyEl => {
    const idx   = qtyEl.id.replace('otp-qty-', '');
    const qty   = parseFloat(qtyEl.value) || 0;
    const cost  = parseFloat(document.getElementById('otp-cost-' + idx)?.value) || 0;
    partsTotal += qty * cost;
  });
  const total = partsTotal;
  const totalEl    = document.getElementById('ot-total-display');
  const partsValEl = document.getElementById('ot-parts-total-val');
  const partsTotalDiv = document.getElementById('ot-parts-total');
  if (totalEl)    totalEl.value = '$' + Math.round(total).toLocaleString('es-AR');
  if (partsValEl) partsValEl.textContent = '$' + Math.round(partsTotal).toLocaleString('es-AR');
  if (partsTotalDiv && partsTotal > 0) partsTotalDiv.style.display = 'block';
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
  openModal(`Editar ficha técnica — ${escapeHtml(v.code)}`, `
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
    { label: '⚙️ Ejes', cls: 'btn-secondary', fn: () => openAxleConfigModal(id) },
    { label: 'Restaurar fábrica', cls: 'btn-secondary', fn: () => resetTechSpec(id) },
    { label: 'Cancelar',      cls: 'btn-secondary', fn: () => showVehicleFicha(id, 'tecnica') },
  ]);
}

function openAxleConfigModal(id) {
  const v = App.data.vehicles.find(x => x.id === id);
  if (!v) return;
  const currentAxles = v.tech_spec?.axles || getAxleConfig(v);
  openModal(`⚙️ Configurar ejes — ${escapeHtml(v.code)}`, `
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">
      Configurá la cantidad y tipo de ejes. Los cambios afectan el mapa de cubiertas.
    </div>
    <div id="axles-container">
      ${currentAxles.map((axle, i) => `
        <div id="axle-row-${i}" style="display:flex;align-items:center;gap:10px;margin-bottom:8px;background:var(--bg3);padding:8px 12px;border-radius:var(--radius)">
          <div style="font-size:12px;font-weight:700;min-width:50px">Eje ${i+1}</div>
          <input class="form-input" id="axle-label-${i}" value="${escapeHtml(axle.label||axle.name?.split('—')[1]?.trim()||'')}" placeholder="Ej: Dirección, Tracción, Portante" style="flex:2">
          <select class="form-select" id="axle-dual-${i}" style="flex:1">
            <option value="false" ${!axle.dual?'selected':''}>Simple (2 cub.)</option>
            <option value="true"  ${axle.dual?'selected':''}>Dual (4 cub.)</option>
          </select>
          <button class="btn btn-secondary btn-sm" onclick="removeAxleRow(${i})">🗑</button>
        </div>`).join('')}
    </div>
    <button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="addAxleRow()">+ Agregar eje</button>
    <div style="margin-top:12px;font-size:11px;color:var(--text3)">
      💡 Simple = 2 cubiertas · Dual = 4 cubiertas (rueda doble)
    </div>
  `, [
    { label: 'Guardar ejes', cls: 'btn-primary', fn: () => saveAxleConfig(id) },
    { label: 'Cancelar', cls: 'btn-secondary', fn: () => openEditTechSpecModal(id) },
  ]);
}

function addAxleRow() {
  const container = document.getElementById('axles-container');
  const count = container.querySelectorAll('[id^="axle-row-"]').length;
  const div = document.createElement('div');
  div.id = `axle-row-${count}`;
  div.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;background:var(--bg3);padding:8px 12px;border-radius:6px';
  div.innerHTML = `
    <div style="font-size:12px;font-weight:700;min-width:50px">Eje ${count+1}</div>
    <input class="form-input" id="axle-label-${count}" value="" placeholder="Ej: Portante" style="flex:2">
    <select class="form-select" id="axle-dual-${count}" style="flex:1">
      <option value="false">Simple (2 cub.)</option>
      <option value="true" selected>Dual (4 cub.)</option>
    </select>
    <button class="btn btn-secondary btn-sm" onclick="removeAxleRow(${count})">🗑</button>`;
  container.appendChild(div);
}

function removeAxleRow(i) {
  const el = document.getElementById(`axle-row-${i}`);
  if (el) el.remove();
}

async function saveAxleConfig(id) {
  const v = App.data.vehicles.find(x => x.id === id);
  if (!v) return;
  const axles = [];
  let i = 0;
  while (document.getElementById(`axle-label-${i}`)) {
    const label = document.getElementById(`axle-label-${i}`)?.value?.trim() || `Eje ${i+1}`;
    const dual  = document.getElementById(`axle-dual-${i}`)?.value === 'true';
    axles.push({ label, dual });
    i++;
  }
  if (axles.length === 0) { showToast('error', 'Agregá al menos un eje'); return; }
  const newTechSpec = Object.assign({}, v.tech_spec || {}, { axles });
  const res = await apiFetch(`/api/vehicles/${id}/techspec`, {
    method: 'PATCH',
    body: JSON.stringify(newTechSpec)
  });
  if (!res.ok) { showToast('error', 'Error al guardar'); return; }
  const updated = await res.json();
  if (v) v.tech_spec = updated.tech_spec;
  closeModal();
  showToast('ok', `Ejes configurados: ${axles.length} ejes · ${axles.reduce((a,x)=>a+(x.dual?4:2),0)} posiciones`);
  showVehicleFicha(id, 'tecnica');
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

// ════════════════════════════════════════════════════════════
//  VERIFICACIÓN DE TICKETS DE COMBUSTIBLE
// ════════════════════════════════════════════════════════════

async function openVerificacionTickets() {
  const res = await apiFetch('/api/fuel/pendientes-verificacion');
  if (!res.ok) { showToast('error','Error al cargar tickets'); return; }
  const pendientes = await res.json();

  if (pendientes.length === 0) {
    openModal('✅ Tickets verificados', `
      <div style="text-align:center;padding:24px">
        <div style="font-size:40px;margin-bottom:12px">✅</div>
        <div style="font-weight:600;font-size:15px">No hay tickets pendientes de verificación</div>
        <div style="font-size:13px;color:var(--text3);margin-top:8px">Todas las cargas con foto han sido verificadas</div>
      </div>`, [{ label:'Cerrar', cls:'btn-secondary', fn: closeModal }]);
    return;
  }

  let idx = 0;
  function renderTicket() {
    const t = pendientes[idx];
    if (!t) { closeModal(); showToast('ok','Todos los tickets revisados'); renderFuel(); return; }
    const total = (parseFloat(t.liters) * parseFloat(t.price_per_l)).toLocaleString('es-AR');
    document.getElementById('modal-title').textContent = `🧾 Ticket ${idx+1} de ${pendientes.length} — ${t.vehicle_code}`;
    document.getElementById('modal-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div style="font-size:12px;color:var(--text3);margin-bottom:12px">
            📅 ${new Date(t.logged_at).toLocaleString('es-AR')}<br>
            🚛 ${t.vehicle_code} · 👤 ${t.driver_name||'—'}<br>
            ⛽ ${t.liters} L × $${t.price_per_l}/L = <strong>$${total}</strong><br>
            📍 ${escapeHtml(t.location||'—')}
          </div>
          <div class="form-group">
            <label class="form-label">Observación (si rechazás)</label>
            <textarea class="form-textarea" id="tick-obs" placeholder="Ej: Precio no coincide, ticket ilegible..." rows="3"></textarea>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-primary" style="flex:1" onclick="verificarTicket('${t.id}','aprobar')">✅ Aprobar y conservar foto</button>
            <button class="btn btn-danger" style="flex:1" onclick="verificarTicket('${t.id}','observar')">⚠ Observar</button>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:8px;text-align:center">
            Al aprobar, la foto queda guardada para poder verla después desde el historial
          </div>
        </div>
        <div style="text-align:center">
          ${t.ticket_image ? `<img src="${t.ticket_image}" style="max-width:100%;max-height:300px;border-radius:8px;object-fit:contain;border:1px solid var(--border2)">` : '<div style="padding:40px;color:var(--text3)">Sin foto</div>'}
        </div>
      </div>`;
    window._ticketIdx = idx;
    window._ticketPendientes = pendientes;
  }

  openModal(`🧾 Ticket 1 de ${pendientes.length}`, '', [
    { label:'Saltar', cls:'btn-secondary', fn: () => { idx++; renderTicket(); } },
    { label:'Cerrar', cls:'btn-secondary', fn: closeModal }
  ]);
  renderTicket();
}

async function verificarTicket(id, accion) {
  const obs = document.getElementById('tick-obs')?.value?.trim() || '';
  if (accion === 'observar' && !obs) { showToast('warn','Escribí una observación'); return; }

  const res = await apiFetch(`/api/fuel/${id}/verificar`, {
    method: 'PATCH',
    body: JSON.stringify({ accion, observacion: obs })
  });
  if (!res.ok) { showToast('error','Error al verificar'); return; }

  const pendientes = window._ticketPendientes || [];
  const idx = (window._ticketIdx || 0) + 1;
  window._ticketIdx = idx;

  const restantes = pendientes.length - idx;
  showToast('ok', accion === 'aprobar' ? `✅ Aprobado · foto conservada · ${restantes} pendientes` : `⚠ Observado · ${restantes} pendientes`);

  if (idx >= pendientes.length) {
    closeModal();
    showToast('ok', '✅ Todos los tickets revisados');
    renderFuel();
  } else {
    // Continuar con el siguiente
    const next = pendientes[idx];
    const total = (parseFloat(next.liters) * parseFloat(next.price_per_l)).toLocaleString('es-AR');
    document.getElementById('modal-title').textContent = `🧾 Ticket ${idx+1} de ${pendientes.length} — ${next.vehicle_code}`;
    document.getElementById('modal-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div style="font-size:12px;color:var(--text3);margin-bottom:12px">
            📅 ${new Date(next.logged_at).toLocaleString('es-AR')}<br>
            🚛 ${next.vehicle_code} · 👤 ${next.driver_name||'—'}<br>
            ⛽ ${next.liters} L × $${next.price_per_l}/L = <strong>$${total}</strong><br>
            📍 ${escapeHtml(next.location||'—')}
          </div>
          <div class="form-group">
            <label class="form-label">Observación (si rechazás)</label>
            <textarea class="form-textarea" id="tick-obs" placeholder="Ej: Precio no coincide, ticket ilegible..." rows="3"></textarea>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-primary" style="flex:1" onclick="verificarTicket('${next.id}','aprobar')">✅ Aprobar y conservar foto</button>
            <button class="btn btn-danger" style="flex:1" onclick="verificarTicket('${next.id}','observar')">⚠ Observar</button>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:8px;text-align:center">
            Al aprobar, la foto queda guardada para poder verla después desde el historial
          </div>
        </div>
        <div style="text-align:center">
          ${next.ticket_image ? `<img src="${next.ticket_image}" style="max-width:100%;max-height:300px;border-radius:8px;object-fit:contain;border:1px solid var(--border2)">` : '<div style="padding:40px;color:var(--text3)">Sin foto</div>'}
        </div>
      </div>`;
  }
}

async function deleteFuelLog(id, vehicle, liters) {
  if (!confirm(`¿Eliminar la carga de ${liters}L para ${vehicle}?\n\nSi la carga provino de cisterna, los litros se reintegrarán al stock.`)) return;
  try {
    const res = await apiFetch('/api/fuel/' + id, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error'); return; }
    const data = await res.json();
    const msg = data.liters_devueltos > 0
      ? `Carga eliminada · ${data.liters_devueltos}L reintegrados a cisterna`
      : 'Carga eliminada';
    showToast('ok', msg);
    await loadInitialData();
    renderFuel();
  } catch(err) { showToast('error', err.message||'Error'); }
}

// ═══════════════════════════════════════════════════════════
//  ÓRDENES DE COMPRA — Tabla mejorada
// ═══════════════════════════════════════════════════════════

// Estado global de la tabla de OCs
App.poTable = App.poTable || {
  search: '',
  status: 'all',
  area:   'all',
  sucursal:'all',
  sortKey: 'created_at',
  sortDir: 'desc',
  rawData: [],     // cache local de la lista traída del server
  pageSize: 100,   // cuántas OCs trae cada página del backend
  lastCount: 0,    // cuántas devolvió la última página (para saber si hay más)
};

async function renderPurchaseOrders() {
  try { await loadSucursalesFromAPI(); } catch(e){}
  const root = document.getElementById('page-purchase_orders');
  if (!root) return;

  const role = App.currentUser?.role;
  const canCreate = ['dueno','gerencia','jefe_mantenimiento','compras','paniol','contador','gerente_sucursal'].includes(role);

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div>
        <h2 style="font-size:20px;font-weight:700;margin:0;color:var(--text)">📋 Órdenes de Compra</h2>
        <p style="font-size:13px;color:var(--text3);margin:4px 0 0">Proceso de compra: pendiente de cotizar → en cotización → aprobada → pagada → recibida</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${userHasRole('dueno','gerencia') ? `<button class="btn btn-secondary btn-sm" onclick="openSucursalesConfigModal()">🏢 Sucursales</button><button class="btn btn-secondary btn-sm" onclick="openAreasConfigModal()">⚙ Áreas</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="_poExportPDF()" title="Descargar PDF con las OCs visibles">📄 PDF</button>
        ${canCreate ? `<button class="btn btn-primary" onclick="openNewPOModal()">+ Nueva OC</button>` : ''}
      </div>
    </div>

    ${_renderGasoilLowBannerForCompras()}

    <div id="po-kpi-row" class="kpi-row" style="margin-bottom:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
      <div class="kpi-card"><div class="kpi-label">Pendientes de cotización</div><div class="kpi-value" style="color:#f59e0b" id="po-kpi-pend">—</div><div class="kpi-trend">📝 Compras debe solicitar cotización</div></div>
      <div class="kpi-card"><div class="kpi-label">En cotización</div><div class="kpi-value" style="color:#38bdf8" id="po-kpi-curso">—</div><div class="kpi-trend">🔎 pendiente de aprobar</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Aprobadas / por recibir</div><div class="kpi-value ok" id="po-kpi-pag">—</div><div class="kpi-trend">📦 mercadería pendiente</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Recibidas</div><div class="kpi-value" style="color:#10b981" id="po-kpi-rec">—</div><div class="kpi-trend">📦 mercadería recibida</div></div>
    </div>

    <div id="po-status-chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${_poStatusChipsHTML()}</div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <input id="po-search" type="text" placeholder="🔍 Buscar código, proveedor, factura..." value="${App.poTable.search}"
        oninput="App.poTable.search=this.value;_poRenderRows()"
        style="flex:1;min-width:200px;max-width:320px;padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-family:inherit;font-size:13px">

      <select id="po-f-sucursal" onchange="App.poTable.sucursal=this.value;_poRenderRows()"
        style="padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-family:inherit;font-size:12px">
        <option value="all">Sucursal: Todas</option>
      </select>

      <select id="po-f-area" onchange="App.poTable.area=this.value;_poRenderRows()"
        style="padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-family:inherit;font-size:12px">
        <option value="all">Área: Todas</option>
      </select>
    </div>

    <div id="po-table-wrap" class="card" style="padding:0;overflow:hidden">
      <div style="overflow-x:auto">
        <table id="po-table" class="table-cards" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead id="po-thead"></thead>
          <tbody id="po-tbody"><tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text3)">⏳ Cargando...</td></tr></tbody>
        </table>
      </div>
      <div id="po-footer" style="padding:10px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text3);display:flex;justify-content:space-between;align-items:center;background:var(--bg2)"></div>
    </div>
  `;

  await loadPOList();
}

async function loadPOList(append = false) {
  try {
    // Cache-busting para que el navegador siempre traiga datos frescos del server
    const ts = Date.now();
    const pageSize = App.poTable.pageSize || 100;
    const offset = append ? (App.poTable.rawData?.length || 0) : 0;
    const res = await apiFetch(`/api/purchase-orders?limit=${pageSize}&offset=${offset}&_t=${ts}`);
    if (!res.ok) {
      const tbody = document.getElementById('po-tbody');
      if (tbody && !append) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--danger)">Error al cargar OCs</td></tr>`;
      return;
    }
    const rows = await res.json();
    App.poTable.lastCount = rows.length;
    App.poTable.rawData = append ? (App.poTable.rawData || []).concat(rows) : rows;

    // Populate los filtros de sucursal y área con valores reales (preservando la selección)
    const sucs = [...new Set(App.poTable.rawData.map(p=>p.sucursal).filter(Boolean))];
    const areas = [...new Set(App.poTable.rawData.map(p=>p.area).filter(Boolean))];
    const sucSel = document.getElementById('po-f-sucursal');
    const areaSel = document.getElementById('po-f-area');
    if (sucSel) { sucSel.innerHTML = `<option value="all">Sucursal: Todas</option>` + sucs.map(s=>`<option value="${s}">${s}</option>`).join(''); sucSel.value = App.poTable.sucursal || 'all'; }
    if (areaSel) { areaSel.innerHTML = `<option value="all">Área: Todas</option>` + areas.map(a=>`<option value="${a}">${a}</option>`).join(''); areaSel.value = App.poTable.area || 'all'; }

    _poRenderKPIs();
    _poRenderRows();
  } catch(err) {
    const tbody = document.getElementById('po-tbody');
    if (tbody && !append) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--danger)">Error: ${err.message}</td></tr>`;
  }
}

function _poRenderKPIs() {
  const data = App.poTable.rawData || [];
  const set = (id, val, color) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = val; if (color) el.style.color = color; }
  };

  const isPendienteCotizacion = (p) => p.status === 'pendiente_cotizacion';
  const isEnCotizacion = (p) => p.status === 'en_cotizacion';
  const isAprobadaPorRecibir = (p) => (
    ['aprobada_compras','enviada_proveedor'].includes(p.status) &&
    String(p.delivery_status || 'pendiente').toLowerCase() !== 'total'
  );
  const isRecibida = (p) => (
    p.status === 'recibida' ||
    String(p.delivery_status || '').toLowerCase() === 'total'
  );

  set('po-kpi-pend',  data.filter(isPendienteCotizacion).length);
  set('po-kpi-curso', data.filter(isEnCotizacion).length);
  set('po-kpi-pag',   data.filter(isAprobadaPorRecibir).length);
  set('po-kpi-rec',   data.filter(isRecibida).length);
}

// Chips de filtro de estado: mismo filtro que el dropdown anterior, pero visible
// y de un solo click. Solo presentación — usa el mismo App.poTable.status.
function _poStatusChipsHTML() {
  const cur = App.poTable.status || 'all';
  const chips = [
    ['all','Todos','📋'],
    ['pendiente_cotizacion','Pendiente','📝'],
    ['en_cotizacion','Cotizando','🔎'],
    ['aprobada_compras','Aprobada','✅'],
    ['enviada_proveedor','Enviada','📤'],
    ['pagada','Pagada','💰'],
    ['recibida','Recibida','📦'],
    ['cerrada','Cerrada','🔒'],
    ['rechazada','Rechazada','❌'],
  ];
  return chips.map(([val,label,icon]) => {
    const a = cur === val;
    return `<button onclick="_poSetStatus('${val}')" style="display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border-radius:16px;border:1px solid ${a?'var(--accent)':'var(--border2)'};background:${a?'var(--accent)':'var(--bg)'};color:${a?'#fff':'var(--text2)'};font-size:12px;font-weight:${a?'600':'500'};cursor:pointer;transition:all .12s;font-family:inherit;white-space:nowrap">${icon} ${label}</button>`;
  }).join('');
}
function _poSetStatus(s) {
  App.poTable.status = s;
  const bar = document.getElementById('po-status-chips');
  if (bar) bar.innerHTML = _poStatusChipsHTML();
  _poRenderRows();
}

function _poRenderRows() {
  const thead = document.getElementById('po-thead');
  const tbody = document.getElementById('po-tbody');
  const footer= document.getElementById('po-footer');
  if (!thead || !tbody) return;

  const all = App.poTable.rawData || [];
  const T   = App.poTable;

  let rows = all.filter(p => {
    if (T.status !== 'all' && p.status !== T.status) return false;
    if (T.sucursal !== 'all' && p.sucursal !== T.sucursal) return false;
    if (T.area !== 'all' && p.area !== T.area) return false;
    if (T.search) {
      const q = T.search.toLowerCase();
      const hay = [p.code, p.proveedor, p.factura_nro, p.solicitante_nombre].filter(Boolean).map(s=>String(s).toLowerCase());
      if (!hay.some(h => h.includes(q))) return false;
    }
    return true;
  });

  const getSortVal = (p, k) => {
    if (k === 'total') { const tr = parseFloat(p.total_real||0); return tr > 0 ? tr : parseFloat(p.total_estimado||0); }
    if (k === 'created_at') return p.created_at || '';
    if (k === 'status') {
      const order = {'pendiente_cotizacion':1,'en_cotizacion':2,'aprobada_compras':3,'pagada':4,'recibida':5,'rechazada':6};
      return order[p.status] ?? 0;
    }
    return (p[k] || '').toString().toLowerCase();
  };
  rows.sort((a,b) => {
    const va = getSortVal(a, T.sortKey);
    const vb = getSortVal(b, T.sortKey);
    if (va < vb) return T.sortDir === 'asc' ? -1 : 1;
    if (va > vb) return T.sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const cols = [
    ['code',       'Código'],
    ['status',     'Estado'],
    ['sucursal',   'Sucursal'],
    ['area',       'Área'],
    ['solicitante_nombre', 'Solicitante'],
    ['proveedor',  'Proveedor'],
    ['factura_nro','Factura'],
    ['progress',   'Progreso', true],
    ['total',      'Total'],
    ['created_at', 'Fecha'],
    ['actions',    '', true],
  ];
  thead.innerHTML = `<tr style="background:var(--bg3);border-bottom:2px solid var(--border)">${cols.map(([k,label,noSort]) => {
    const isSorted = !noSort && T.sortKey === k;
    const arrow = isSorted ? (T.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    const cls = isSorted ? 'color:var(--accent)' : 'color:var(--text3)';
    const cursor = noSort ? 'default' : 'pointer';
    return `<th onclick="${noSort?'':'_poSort(\''+k+'\')'}" style="text-align:left;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:600;cursor:${cursor};white-space:nowrap;font-family:var(--mono);${cls}">${label}${arrow}</th>`;
  }).join('')}</tr>`;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" style="text-align:center;padding:40px;color:var(--text3)">
      ${all.length===0 ? 'Sin órdenes de compra registradas' : 'Sin OCs que coincidan con los filtros'}
    </td></tr>`;
  } else {
    tbody.innerHTML = rows.map(p => _poRenderRow(p)).join('');
  }

  if (footer) {
    const totalMonto = rows.reduce((a,p) => { const tr = parseFloat(p.total_real||0); return a + (tr > 0 ? tr : parseFloat(p.total_estimado||0)); }, 0);
    // Si la última página vino completa, probablemente haya más OCs viejas para traer.
    const hayMas = (App.poTable.lastCount || 0) >= (App.poTable.pageSize || 100);
    const cargarMas = hayMas
      ? ` · <a onclick="loadPOList(true)" style="color:var(--accent);cursor:pointer;font-weight:600">Cargar más →</a>`
      : '';
    footer.innerHTML = `
      <span>Mostrando <b style="color:var(--text)">${rows.length}</b> de ${all.length} cargadas${cargarMas}</span>
      <span>Monto total visible: <b style="color:var(--text);font-family:var(--mono)">$${Math.round(totalMonto).toLocaleString('es-AR')}</b></span>
    `;
  }
}

function _poSort(key) {
  const T = App.poTable;
  if (T.sortKey === key) {
    T.sortDir = T.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    T.sortKey = key;
    T.sortDir = 'asc';
  }
  _poRenderRows();
}

function _ocPrioridadBadge(po) {
  const p = String(po.prioridad || 'Normal').trim().toLowerCase();
  if (p === 'urgente' || p === 'critica' || p === 'crítica') return `<span title="Prioridad Urgente — indicada por el área solicitante" style="background:rgba(239,68,68,.18);color:#ef4444;border:1px solid rgba(239,68,68,.45);padding:1px 7px;border-radius:10px;font-size:9px;font-weight:700;font-family:var(--mono);white-space:nowrap">🔴 URGENTE</span>`;
  if (p === 'media' || p === 'medio')   return `<span title="Prioridad Media" style="background:rgba(245,158,11,.18);color:#f59e0b;border:1px solid rgba(245,158,11,.4);padding:1px 7px;border-radius:10px;font-size:9px;font-weight:700;font-family:var(--mono);white-space:nowrap">🟡 MEDIA</span>`;
  return `<span title="Prioridad Normal" style="background:var(--bg4);color:var(--text3);padding:1px 7px;border-radius:10px;font-size:9px;font-weight:600;font-family:var(--mono);white-space:nowrap">NORMAL</span>`;
}

function _poRenderRow(po) {
  const role = App.currentUser?.role;
  const puedeVerPrecios = _ocPuedeVerPrecios(role);
  const progress = _poProgress(po);
  const progressLabel = _poProgressLabel(po);

  const e = OC_ESTADOS[po.status] || { border: '#555', fg: '#aaa' };
  const sideColor = e.fg;

  // Solicitantes pueden borrar sus propias OCs si están en pendiente
  const canDelete = (
    ['dueno','gerencia'].includes(role) && po.status !== 'recibida'
  ) || (
    ['jefe_mantenimiento','paniol','contador'].includes(role) && po.requested_by === App.currentUser?.id && po.status === 'pendiente_cotizacion'
  ) || (
    role === 'compras' && po.requested_by === App.currentUser?.id && ['pendiente_cotizacion','en_cotizacion'].includes(po.status)
  );

  // Calcular total: preferir total_real si tiene valor > 0, sino usar total_estimado
  const tReal = parseFloat(po.total_real || 0);
  const tEst  = parseFloat(po.total_estimado || 0);
  const total = tReal > 0 ? tReal : tEst;

  // Ícono de origen según quién creó la OC
  let origenIcon = '';
  const solRol = po.solicitante_rol || '';
  if (solRol === 'compras') {
    origenIcon = `<span title="Creada por Compras" style="margin-right:4px;font-size:13px">🛒</span>`;
  } else if (solRol === 'jefe_mantenimiento') {
    origenIcon = `<span title="Solicitada por Jefe de Mantenimiento" style="margin-right:4px;font-size:13px">🔧</span>`;
  } else if (solRol === 'paniol') {
    origenIcon = `<span title="Solicitada por Pañol / Depósito" style="margin-right:4px;font-size:13px">📦</span>`;
  } else if (solRol === 'contador') {
    origenIcon = `<span title="Solicitada por Administración" style="margin-right:4px;font-size:13px">📋</span>`;
  } else if (['dueno','gerencia'].includes(solRol)) {
    origenIcon = `<span title="Creada por Gerencia" style="margin-right:4px;font-size:13px">👑</span>`;
  }

  return `<tr style="border-left:3px solid ${sideColor};border-bottom:1px solid var(--border);transition:background .1s"
    onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='transparent'">

    <td data-label="Código" style="padding:10px 12px;font-family:var(--mono);font-weight:700;color:var(--accent);white-space:nowrap">${origenIcon}${escapeHtml(po.code||'—')}<div style="margin-top:4px">${_ocPrioridadBadge(po)}</div></td>

    <td data-label="Estado" style="padding:10px 12px">
      ${_ocEstadoBadge(po)}
    </td>

    <td data-label="Sucursal" style="padding:10px 12px;font-size:12px">
      ${po.sucursal ? `<span style='background:rgba(37,99,235,.15);color:var(--accent);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;font-family:var(--mono)'>${escapeHtml(po.sucursal)}</span>` : '<span style="color:var(--text3)">—</span>'}
    </td>

    <td data-label="Área" style="padding:10px 12px;font-size:12px;color:var(--text3)">${escapeHtml(po.area||'—')}</td>

    <td data-label="Solicitante" style="padding:10px 12px;font-size:12px;color:var(--text2)">${po.solicitante_nombre||'—'}</td>

    <td data-label="Proveedor" style="padding:10px 12px;font-size:12px;color:var(--text2)">${po.proveedor ? escapeHtml(po.proveedor) : '<span style="color:var(--text3)">Sin asignar</span>'}</td>

    <td data-label="Factura" style="padding:10px 12px;font-size:11px;font-family:var(--mono);color:var(--text2)">${po.factura_nro ? escapeHtml(po.factura_nro) : '<span style="color:var(--text3)">—</span>'}</td>

    <td data-label="Progreso" style="padding:10px 12px;min-width:120px">
      <div style="display:flex;align-items:center;gap:6px">
        <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;min-width:50px;max-width:80px">
          <div style="height:100%;background:${sideColor};width:${progress}%;transition:width .3s"></div>
        </div>
        <span style="font-size:10px;font-family:var(--mono);color:var(--text3);min-width:30px">${progress}%</span>
      </div>
      ${progressLabel ? `<div style="font-size:9px;color:${progress===100?'var(--ok)':'var(--warn)'};font-family:var(--mono);margin-top:3px;white-space:nowrap">${progressLabel}</div>` : ''}
    </td>

    <td data-label="Total" style="padding:10px 12px;font-family:var(--mono);font-weight:700;font-size:12px;color:var(--text);text-align:right">
      ${puedeVerPrecios
        ? `$${Math.round(total).toLocaleString('es-AR')}${parseFloat(po.iva_pct||0) > 0 ? `<div style="font-size:9px;color:var(--text3);font-weight:400">IVA ${po.iva_pct}%</div>` : ''}`
        : `<span style="color:var(--text3)" title="Solo compras/tesorería ven los precios">—</span>`
      }
    </td>

    <td data-label="Fecha" style="padding:10px 12px;font-family:var(--mono);font-size:10px;color:var(--text3);white-space:nowrap">
      ${po.created_at ? new Date(po.created_at).toLocaleDateString('es-AR') : '—'}
    </td>

    <td data-label="" style="padding:10px 12px;white-space:nowrap;text-align:right">
      <button class="btn btn-secondary btn-sm" onclick="openPODetail('${po.id}')">Ver</button>
      <button class="btn btn-secondary btn-sm" onclick="printPO('${po.id}')" title="Imprimir" style="margin-left:4px">🖨</button>
      ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="deletePO('${po.id}')" style="margin-left:4px">✕</button>` : ''}
    </td>
  </tr>`;
}

function _poProgress(po) {
  const status = typeof po === 'string' ? po : (po?.status || '');
  if (status === 'rechazada') return 0;

  const deliveryDone = ['total','recibida'].includes(String(po?.delivery_status || '').toLowerCase()) || status === 'recibida';
  const invoiceDone  = String(po?.invoice_status || '').toLowerCase() === 'total' || !!po?.factura_nro || (parseFloat(po?.factura_monto || 0) > 0);
  const paymentDone  = String(po?.payment_status || '').toLowerCase() === 'total';

  // 100% solo cuando terminó TODO el circuito administrativo:
  // cotización/aprobación + mercadería recibida + factura cargada + pago completo.
  if (deliveryDone && invoiceDone && paymentDone) return 100;

  if (status === 'pendiente_cotizacion') return 15;
  if (status === 'en_cotizacion') return 35;
  if (status === 'aprobada_compras') return 60;
  if (status === 'enviada_proveedor') return 68;

  // Estados avanzados, pero incompletos: no mostrar 100 para no confundir.
  let pct = 60;
  if (deliveryDone) pct = Math.max(pct, 75);
  if (invoiceDone)  pct = Math.max(pct, 82);
  if (paymentDone || status === 'pagada') pct = Math.max(pct, 90);
  return pct;
}

function _poProgressLabel(po) {
  if (!po || po.status === 'rechazada') return '';
  const deliveryDone = ['total','recibida'].includes(String(po.delivery_status || '').toLowerCase()) || po.status === 'recibida';
  const invoiceDone  = String(po.invoice_status || '').toLowerCase() === 'total' || !!po.factura_nro || (parseFloat(po.factura_monto || 0) > 0);
  const paymentDone  = String(po.payment_status || '').toLowerCase() === 'total';
  if (deliveryDone && invoiceDone && paymentDone) return 'Completa';

  const faltan = [];
  if (!deliveryDone) faltan.push('recibir');
  if (!invoiceDone)  faltan.push('factura');
  if (!paymentDone)  faltan.push('pagar');
  return faltan.length ? 'Falta ' + faltan.join('/') : '';
}

// Export PDF de OCs (respeta filtros activos)
function _poExportPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast?.('error','jsPDF no cargado. Refrescá la página.');
    return;
  }

  const all = App.poTable.rawData || [];
  const T   = App.poTable;

  let rows = all.filter(p => {
    if (T.status !== 'all' && p.status !== T.status) return false;
    if (T.sucursal !== 'all' && p.sucursal !== T.sucursal) return false;
    if (T.area !== 'all' && p.area !== T.area) return false;
    if (T.search) {
      const q = T.search.toLowerCase();
      const hay = [p.code, p.proveedor, p.factura_nro, p.solicitante_nombre].filter(Boolean).map(s=>String(s).toLowerCase());
      if (!hay.some(h => h.includes(q))) return false;
    }
    return true;
  });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  const startY = _pdfHeader(doc, 'Órdenes de Compra', `${rows.length} OC${rows.length===1?'':'s'}`);

  const statusLabels = {
    pendiente_cotizacion: 'Pendiente cotización',
    en_cotizacion:        'En cotización',
    aprobada_compras:     'Aprobada compras',
    pagada:               'Pagada',
    recibida:             'Recibida',
    rechazada:            'Rechazada',
    dividida:             'Dividida por proveedor',
  };
  const tableData = rows.map(p => [
    p.code || '—',
    statusLabels[p.status] || p.status || '—',
    p.sucursal || '—',
    p.area || '—',
    p.solicitante_nombre || '—',
    p.proveedor || '—',
    p.factura_nro || '—',
    (() => { const tr = parseFloat(p.total_real||0); const t = tr > 0 ? tr : parseFloat(p.total_estimado||0); return `$${Math.round(t).toLocaleString('es-AR')}`; })(),
    p.created_at ? new Date(p.created_at).toLocaleDateString('es-AR') : '—',
  ]);

  doc.autoTable({
    startY: startY,
    head: [['Código','Estado','Sucursal','Área','Solicitante','Proveedor','Factura','Total','Fecha']],
    body: tableData,
    ..._pdfTableStyle(),
    columnStyles: {
      0: { cellWidth: 70, fontStyle: 'bold' },
      7: { halign: 'right', fontStyle: 'bold' },
    },
  });

  const totalMonto = rows.reduce((a,p) => { const tr = parseFloat(p.total_real||0); return a + (tr > 0 ? tr : parseFloat(p.total_estimado||0)); }, 0);
  const finalY = doc.lastAutoTable.finalY || 90;
  doc.setFontSize(10);
  doc.setFont('helvetica','bold');
  doc.setTextColor(BILETTA_BRAND.dark[0], BILETTA_BRAND.dark[1], BILETTA_BRAND.dark[2]);
  doc.text(`TOTAL VISIBLE: $${Math.round(totalMonto).toLocaleString('es-AR')}`, 40, finalY + 20);

  doc.save(`OCs-Biletta-${todayISO()}.pdf`);
  showToast?.('ok','PDF descargado');
}

// ── Modal nueva OC ────────────────────────────────────────
async function openNewPOModal() {
  // Roles solicitantes (jefe mant, pañol/depósito, contador/administración)
  // usan un modal específico SIN precios / proveedor.
  // Ese workflow lo completa compras después.
  if (['jefe_mantenimiento','paniol','contador','gerente_sucursal'].includes(App.currentUser?.role)) {
    return openNewPOModalJefe();
  }

  try { await loadSucursalesFromAPI(); } catch(e){}
  window._poTipo = 'flota';
  window._poIvaPct = 0;
  window._poSupplierId = null; // para guardar el ID del proveedor del catálogo si se elige uno
  window._ocEditValues = {};   // limpiar valores de un detalle/OC anterior (si no, pisan el autocompletado)

  // Proveedores del catálogo nuevo (módulo Proveedores)
  const catalogoProveedores = (App.data.suppliers || []).filter(s => s.status === 'activo');

  // Fallback: si no hay catálogo cargado, traer los nombres históricos usados en OCs anteriores
  var proveedoresPrev = [];
  try {
    const rp = await apiFetch('/api/purchase-orders/aux/proveedores');
    if (rp.ok) proveedoresPrev = await rp.json();
  } catch(e) {}

  var solicitante = App.currentUser?.name || App.currentUser?.email || '—';

  openModal('📋 Nueva orden de compra', `
    <style>
      .ocv-step{margin-bottom:18px}
      .ocv-sh{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
      .ocv-num{width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
      .ocv-t{font-size:14px;font-weight:700;color:var(--text)}
      .ocv-opt{font-weight:500;color:var(--text3);font-size:12px}
      .ocv-body{margin-left:34px}
      .ocv-div{height:1px;background:var(--border);margin:0 0 16px 34px}
    </style>

    <!-- PASO 1 -->
    <div class="ocv-step">
      <div class="ocv-sh"><div class="ocv-num">1</div><div class="ocv-t">¿De dónde sale el pedido?</div><span style="margin-left:auto;font-size:11.5px;color:var(--text3)">👤 Solicita: <b style="color:var(--accent)">${solicitante}</b></span></div>
      <div class="ocv-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Sucursal <span style="color:var(--danger)">*</span></label>
            <select class="form-select" id="po-sucursal" onchange="updatePOAreaSelect()">
              <option value="">— Seleccionar sucursal —</option>
              ${(App.config?.bases||[]).map(b => `<option value="${b}">${b}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Área <span style="color:var(--danger)">*</span></label>
            <select class="form-select" id="po-area">
              <option value="">— Primero seleccioná la sucursal —</option>
            </select>
          </div>
        </div>
      </div>
    </div>
    <div class="ocv-div"></div>

    <!-- PASO 2 -->
    <div class="ocv-step">
      <div class="ocv-sh"><div class="ocv-num">2</div><div class="ocv-t">¿Qué tipo de compra y qué urgencia?</div></div>
      <div class="ocv-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Tipo de orden</label>
            <select class="form-select" id="po-tipo-select" onchange="setPOTipo(this.value)">
              <option value="flota">🚛 Flota</option>
              <option value="mantenimiento">🏢 Mantenimiento edilicio</option>
              <option value="otro">📦 Otro</option>
            </select>
          </div>
          <div class="form-group" style="margin:0" id="po-vehicle-field">
            <label class="form-label">Vehículo <span class="ocv-opt">(opcional)</span></label>
            <select class="form-select" id="po-vehicle">
              <option value="">— Sin vehículo asignado —</option>
              ${(App.data.vehicles||[]).map(v => `<option value="${v.id}">${escapeHtml(v.code)} · ${escapeHtml(v.plate)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Prioridad / Urgencia</label>
          <select class="form-select" id="po-prioridad">
            <option value="Normal">⚪ Normal — sin apuro</option>
            <option value="Media">🟡 Media — esta semana</option>
            <option value="Urgente">🔴 Urgente — ya</option>
          </select>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">Indicá la urgencia para que Compras la priorice</div>
        </div>
      </div>
    </div>
    <div class="ocv-div"></div>

    <!-- PASO 3 -->
    <div class="ocv-step">
      <div class="ocv-sh"><div class="ocv-num">3</div><div class="ocv-t">¿A quién le compramos y cómo se paga?</div><span style="color:var(--danger)">*</span></div>
      <div class="ocv-body">
        <div class="form-group" style="margin:0 0 14px 0">
          <label class="form-label">Proveedor <span style="color:var(--danger)">*</span></label>
          ${catalogoProveedores.length > 0 ? `
            <select class="form-select" id="po-supplier-select" onchange="_poOnSupplierChange(this.value)">
              <option value="">— Seleccioná del catálogo —</option>
              ${catalogoProveedores.map(s => `<option value="${s.id}" data-name="${escapeHtml(s.name)}" data-fpago="${escapeHtml(s.forma_pago||'')}" data-ccdias="${s.cc_dias||''}" data-moneda="${s.moneda||'ARS'}">${escapeHtml(s.name)}${s.cuit ? ' · ' + escapeHtml(s.cuit) : ''}</option>`).join('')}
              <option value="__manual__">✍️ Escribir uno manualmente (no está en el catálogo)</option>
            </select>
            <div id="po-supplier-manual" style="display:none;margin-top:6px">
              <input class="form-input" id="po-proveedor" list="po-proveedores-datalist" placeholder="Nombre del proveedor (se creará en el catálogo luego)" autocomplete="off">
              <datalist id="po-proveedores-datalist">
                ${proveedoresPrev.map(pr => `<option value="${pr}"></option>`).join('')}
              </datalist>
            </div>
            <div style="font-size:11px;color:var(--text3);margin-top:3px">💡 Elegí del catálogo para autocompletar forma de pago y condiciones</div>
          ` : `
            <input class="form-input" id="po-proveedor" list="po-proveedores-datalist" placeholder="Nombre del proveedor" autocomplete="off">
            <datalist id="po-proveedores-datalist">
              ${proveedoresPrev.map(pr => `<option value="${pr}"></option>`).join('')}
            </datalist>
            <div style="font-size:11px;color:var(--warn);margin-top:3px">⚠️ No hay proveedores en el catálogo. Cargalos en el módulo "🏢 Proveedores" para autocompletar.</div>
          `}
        </div>
        <div class="form-label" style="font-weight:700;margin-bottom:8px">💳 Pago y moneda</div>
        <div id="po-extra-fields"></div>
      </div>
    </div>
    <div class="ocv-div"></div>

    <!-- PASO 4 -->
    <div class="ocv-step">
      <div class="ocv-sh"><div class="ocv-num">4</div><div class="ocv-t">¿Qué se compra?</div><span style="color:var(--danger)">*</span><button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="addPOItem()">+ Agregar artículo</button></div>
      <div class="ocv-body">
        <div id="po-items">
          ${buildPOItemRow(0)}
        </div>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border2)">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
            <span style="color:var(--text3);font-weight:600;font-size:12px">IVA:</span>
            <button type="button" id="po-iva-btn-Sin IVA" onclick="setPOIva('Sin IVA')"
              style="padding:4px 12px;border-radius:20px;border:1px solid var(--border2);cursor:pointer;font-size:12px;font-weight:600;background:var(--accent);color:white;transition:.15s">Sin IVA</button>
            <button type="button" id="po-iva-btn-10.5%" onclick="setPOIva('10.5%')"
              style="padding:4px 12px;border-radius:20px;border:1px solid var(--border2);cursor:pointer;font-size:12px;font-weight:600;background:transparent;color:var(--text3);transition:.15s">10.5%</button>
            <button type="button" id="po-iva-btn-21%" onclick="setPOIva('21%')"
              style="padding:4px 12px;border-radius:20px;border:1px solid var(--border2);cursor:pointer;font-size:12px;font-weight:600;background:transparent;color:var(--text3);transition:.15s">21%</button>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding-top:6px;font-size:13px">
            <span style="color:var(--text3)">Subtotal</span>
            <span id="po-subtotal" style="font-family:monospace">$0</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:13px">
            <span style="color:var(--text3)" id="po-iva-label">IVA (0%)</span>
            <span id="po-iva-monto" style="font-family:monospace">$0</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:2px solid var(--border2)">
            <span style="font-weight:700;font-size:14px">TOTAL</span>
            <span id="po-total" style="font-weight:700;font-size:18px;font-family:monospace;color:var(--accent)">$0</span>
          </div>
        </div>
      </div>
    </div>
    <div class="ocv-div"></div>

    <!-- PASO 5 -->
    <div class="ocv-step">
      <div class="ocv-sh"><div class="ocv-num">5</div><div class="ocv-t">Observaciones</div><span class="ocv-opt">(opcional)</span></div>
      <div class="ocv-body">
        <textarea class="form-textarea" id="po-notes" rows="2" placeholder="Ej: Repuestos para preventivo INT-08"></textarea>
      </div>
    </div>`,
    [
      { label:'Cancelar', cls:'btn-secondary', fn: closeModal },
      { label:'✅ Crear OC', cls:'btn-primary', fn: saveNewPO },
    ]
  );

  if (typeof renderPOExtraFields === 'function') {
    renderPOExtraFields('flota', 'po-extra-fields');
  }
  setTimeout(function(){
    var selMon = document.getElementById('po-moneda');
    if (selMon) selMon.addEventListener('change', updatePOTotal);
  }, 50);
}
function buildPOItemRow(idx) {
  return `<div id="po-item-${idx}" style="margin-bottom:6px">
    <div style="display:grid;grid-template-columns:1fr 80px 80px 120px 32px;gap:6px;align-items:center">
      <div style="position:relative">
        <input class="form-input" placeholder="Descripción o buscá del stock..." id="poi-desc-${idx}"
          oninput="searchPOStock(${idx})" autocomplete="off" style="font-size:13px;width:100%">
        <div id="poi-suggestions-${idx}" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);
          border:1px solid var(--border2);border-radius:0 0 var(--radius) var(--radius);z-index:100;max-height:160px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.2)">
        </div>
      </div>
      <input class="form-input" type="number" placeholder="Cant." id="poi-qty-${idx}" value="1"
        min="0.01" step="0.01" oninput="updatePOTotal()" style="font-size:13px;text-align:center">
      <input class="form-input" placeholder="Unidad" id="poi-unit-${idx}" value="un"
        style="font-size:13px;text-align:center">
      <input class="form-input" type="number" placeholder="Precio unit." id="poi-price-${idx}" value="0"
        min="0" oninput="updatePOTotal()" style="font-size:13px;text-align:right">
      <button style="background:none;border:1px solid var(--border2);border-radius:6px;cursor:pointer;color:var(--danger);font-size:16px;padding:0 6px;height:36px"
        onclick="removePOItem(${idx})">✕</button>
    </div>
    <div id="poi-stock-hint-${idx}" style="font-size:10px;color:var(--text3);padding:2px 4px;display:none">
      📦 Stock disponible: <span id="poi-stock-qty-${idx}"></span>
    </div>
  </div>`;
}



let _poItemCount = 1;
function addPOItem() {
  const container = document.getElementById('po-items');
  if (!container) return;
  const div = document.createElement('div');
  div.innerHTML = buildPOItemRow(_poItemCount);
  container.appendChild(div.firstElementChild);
  _poItemCount++;
}

function removePOItem(idx) {
  document.getElementById(`po-item-${idx}`)?.remove();
  updatePOTotal();
}

// IVA activo en la OC actual
window._poIvaPct = 0;

function setPOIva(val) {
  window._poIvaPct = val === '21%' ? 21 : val === '10.5%' ? 10.5 : 0;
  // Actualizar botones
  ['Sin IVA','10.5%','21%'].forEach(v => {
    const btn = document.getElementById('po-iva-btn-' + v);
    if (!btn) return;
    btn.style.background = v === val ? 'var(--accent)' : 'transparent';
    btn.style.color      = v === val ? 'white' : 'var(--text3)';
  });
  updatePOTotal();
}

function updatePOTotal() {
  let subtotal = 0;
  document.querySelectorAll('[id^="poi-qty-"]').forEach(qtyEl => {
    const idx   = qtyEl.id.replace('poi-qty-', '');
    const qty   = parseFloat(qtyEl.value) || 0;
    const price = parseFloat(document.getElementById('poi-price-'+idx)?.value) || 0;
    subtotal += qty * price;
  });
  const ivaPct   = window._poIvaPct || 0;
  const ivaMonto = subtotal * ivaPct / 100;
  const total    = subtotal + ivaMonto;

  const subEl   = document.getElementById('po-subtotal');
  const ivaLbl  = document.getElementById('po-iva-label');
  const ivaMEl  = document.getElementById('po-iva-monto');
  const totalEl = document.getElementById('po-total');

  if (subEl)  subEl.textContent  = '$' + Math.round(subtotal).toLocaleString('es-AR');
  if (ivaLbl) ivaLbl.textContent = 'IVA (' + ivaPct + '%)';
  if (ivaMEl) ivaMEl.textContent = '$' + Math.round(ivaMonto).toLocaleString('es-AR');
  if (totalEl) totalEl.textContent = '$' + Math.round(total).toLocaleString('es-AR');
}

// ═══════════════════════════════════════════════════════════════════
//  MODAL ESPECÍFICO para JEFE DE MANTENIMIENTO
//  Sin precios, sin proveedor, sin forma de pago, sin IVA, sin moneda.
//  Solo describe QUÉ NECESITA. Compras cotiza después.
// ═══════════════════════════════════════════════════════════════════
async function openNewPOModalJefe() {
  try { await loadSucursalesFromAPI(); } catch(e){}
  window._poTipoJefe = 'flota';
  window._presupuestoArchivo = null;

  var solicitante = App.currentUser?.name || App.currentUser?.email || '—';
  var lockedSucursalPO = (App.currentUser?.role === 'gerente_sucursal' && App.currentUser?.sucursal) ? App.currentUser.sucursal : '';
  var lockedAreaPO = (App.currentUser?.role === 'gerente_sucursal' && App.currentUser?.area) ? App.currentUser.area : '';
  var sucursalesPO = stockBaseOptions();
  if (lockedSucursalPO && !sucursalesPO.includes(lockedSucursalPO)) sucursalesPO.unshift(lockedSucursalPO);
  var sucursalOptionsPO = sucursalesPO.map(b => `<option value="${b}" ${b===lockedSucursalPO?'selected':''}>${b}</option>`).join('');

  openModal('📋 Nueva solicitud de compra', `
    <div style="background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.3);border-radius:var(--radius);padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--accent);display:flex;align-items:center;gap:8px">
      <span style="font-size:18px">💡</span>
      <span>Describí <b>qué necesitás</b>. Compras se encarga del precio y elegir al proveedor.</span>
    </div>

    <!-- ORIGEN -->
    <div class="card" style="padding:12px 16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">🏢 Origen</div>
        <div style="font-size:11px;color:var(--text3)">👤 Solicita: <span style="font-weight:700;color:var(--accent)">${solicitante}</span></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group" style="margin:0">
          <label class="form-label">Sucursal <span style="color:var(--danger)">*</span></label>
          <select class="form-select" id="poj-sucursal" onchange="updatePOJefeAreaSelect()" ${lockedSucursalPO?'disabled':''}>
            ${lockedSucursalPO ? '' : '<option value="">— Seleccionar sucursal —</option>'}
            ${sucursalOptionsPO}
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Área <span style="color:var(--danger)">*</span></label>
          <select class="form-select" id="poj-area">
            <option value="">— Primero seleccioná la sucursal —</option>
          </select>
        </div>
      </div>
    </div>

    <!-- DESTINO -->
    <div class="card" style="padding:12px 16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">🚛 Destino</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group" style="margin:0">
          <label class="form-label">Tipo</label>
          <select class="form-select" id="poj-tipo-select" onchange="setPOJefeTipo(this.value)">
            <option value="flota">🚛 Flota</option>
            <option value="mantenimiento">🏪 Mantenimiento edilicio</option>
            <option value="otro">📋 Otro</option>
          </select>
        </div>
        <div class="form-group" style="margin:0" id="poj-vehicle-field">
          <label class="form-label">Vehículo (opcional)</label>
          <select class="form-select" id="poj-vehicle">
            <option value="">— Sin vehículo asignado —</option>
            ${(App.data.vehicles||[]).map(v => `<option value="${v.id}">${escapeHtml(v.code)} · ${escapeHtml(v.plate)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="poj-extra-fields" style="margin-top:10px;display:none"></div>
    </div>

    <!-- ARTÍCULOS (SIN PRECIO) -->
    <div class="card" style="padding:12px 16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">📝 Qué necesito</div>
        <button class="btn btn-secondary btn-sm" onclick="addPOJefeItem()" type="button">+ Agregar artículo</button>
      </div>
      <div id="poj-items-list"></div>
    </div>

    <!-- PRESUPUESTO OPCIONAL -->
    <div class="card" style="padding:12px 16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">📎 Presupuesto (opcional)</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px">Si ya tenés un presupuesto de algún proveedor, subilo acá (JPG, PNG o PDF, máx 5MB). Compras lo va a ver.</div>
      <div id="poj-file-zone" style="border:2px dashed var(--border2);border-radius:var(--radius);padding:14px;text-align:center;cursor:pointer;background:var(--bg3)" onclick="document.getElementById('poj-file-input').click()">
        <div id="poj-file-preview">
          <div style="font-size:24px;margin-bottom:4px">📎</div>
          <div style="font-size:12px;color:var(--text3)">Tocá para subir presupuesto</div>
        </div>
        <input type="file" id="poj-file-input" accept="image/*,application/pdf" style="display:none" onchange="previewPOJefeFile(this)">
      </div>
    </div>

    <!-- PRIORIDAD -->
    <div class="card" style="padding:12px 16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">🚦 Prioridad</div>
      <select class="form-select" id="poj-prioridad" style="max-width:260px">
        <option value="Normal">⚪ Normal</option>
        <option value="Media">🟡 Media</option>
        <option value="Urgente">🔴 Urgente</option>
      </select>
      <div style="font-size:11px;color:var(--text3);margin-top:6px">Indicá la urgencia para que Compras priorice tu pedido</div>
    </div>

    <!-- NOTAS -->
    <div class="card" style="padding:12px 16px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">🗒️ Notas / problema</div>
      <textarea class="form-textarea" id="poj-notes" rows="3" placeholder="Describí el problema o contexto de la compra (opcional pero recomendado)"></textarea>
    </div>
  `, [
    { label:'Cancelar',        cls:'btn-secondary', fn: closeModal },
    { label:'Enviar solicitud', cls:'btn-primary',   fn: saveNewPOJefe },
  ]);

  // Agregar 1 ítem inicial y preseleccionar sucursal/área si es gerente de sucursal
  setTimeout(async () => {
    if (lockedSucursalPO) {
      const suc = document.getElementById('poj-sucursal');
      if (suc) suc.value = lockedSucursalPO;
      await updatePOJefeAreaSelect();
      if (lockedAreaPO) {
        const area = document.getElementById('poj-area');
        if (area) area.value = lockedAreaPO;
      }
    }
    addPOJefeItem();
  }, 50);
}

function setPOJefeTipo(tipo) {
  window._poTipoJefe = tipo;
  var vehField = document.getElementById('poj-vehicle-field');
  var extraField = document.getElementById('poj-extra-fields');
  if (vehField) vehField.style.display = (tipo === 'flota') ? '' : 'none';
  if (extraField) {
    if (tipo === 'flota') {
      extraField.style.display = 'none';
      extraField.innerHTML = '';
    } else {
      extraField.style.display = '';
      extraField.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Local / Sector</label>
            <input class="form-input" id="pojx-local" placeholder="Ej: Taller / Oficina / Depósito">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Sector / Detalle</label>
            <input class="form-input" id="pojx-sector" placeholder="Ej: Planta baja / Sala 2">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Equipo / Activo</label>
            <input class="form-input" id="pojx-equipo" placeholder="Ej: Compresor, Heladera, PC">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Nro de serie (opcional)</label>
            <input class="form-input" id="pojx-serie" placeholder="Si aplica">
          </div>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Urgencia</label>
          <select class="form-select" id="pojx-urgencia">
            <option value="normal">Normal</option>
            <option value="urgente">Urgente</option>
            <option value="critica">Crítica</option>
          </select>
        </div>
      `;
    }
  }
}

async function updatePOJefeAreaSelect() {
  const suc = document.getElementById('poj-sucursal')?.value;
  const areaSel = document.getElementById('poj-area');
  if (!areaSel) return;
  if (!suc) {
    areaSel.innerHTML = '<option value="">— Primero seleccioná la sucursal —</option>';
    return;
  }
  let areas = [];
  try {
    const r = await apiFetch('/api/sucursales/' + encodeURIComponent(suc) + '/areas');
    if (r.ok) areas = await r.json();
  } catch(e) {}
  if (!Array.isArray(areas) || areas.length === 0) {
    areas = ['General','Mantenimiento','Oficina','Taller','Depósito'];
  }
  areaSel.innerHTML = '<option value="">— Seleccionar área —</option>' +
    areas.map(a => `<option value="${typeof a==='string'?a:(a.nombre||'')}">${typeof a==='string'?a:(a.nombre||'')}</option>`).join('');
}

function addPOJefeItem() {
  const list = document.getElementById('poj-items-list');
  if (!list) return;
  const idx = list.children.length;
  const div = document.createElement('div');
  div.style.cssText = 'display:grid;grid-template-columns:2fr 80px 80px 40px;gap:6px;margin-bottom:6px;align-items:end';
  div.innerHTML = `
    <div>
      ${idx === 0 ? '<label style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600;letter-spacing:.5px">Descripción</label>' : ''}
      <input class="form-input poj-item-desc" type="text" placeholder="Ej: Filtro de aceite 10W-40" style="width:100%">
    </div>
    <div>
      ${idx === 0 ? '<label style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600;letter-spacing:.5px">Cantidad</label>' : ''}
      <input class="form-input poj-item-qty" type="number" min="0.01" step="0.01" value="1" style="width:100%">
    </div>
    <div>
      ${idx === 0 ? '<label style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600;letter-spacing:.5px">Unidad</label>' : ''}
      <select class="form-select poj-item-unit" style="width:100%">
        <option value="un">un</option>
        <option value="kg">kg</option>
        <option value="lt">lt</option>
        <option value="m">m</option>
        <option value="caja">caja</option>
        <option value="paquete">paquete</option>
        <option value="par">par</option>
        <option value="rollo">rollo</option>
      </select>
    </div>
    <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()" style="height:34px">✕</button>
  `;
  list.appendChild(div);
}

function previewPOJefeFile(input) {
  const file = input.files?.[0];
  const preview = document.getElementById('poj-file-preview');
  if (!file) { window._presupuestoArchivo = null; return; }

  // Validar tamaño
  if (file.size > 5 * 1024 * 1024) {
    showToast('error', 'El archivo no puede superar 5MB');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    window._presupuestoArchivo = e.target.result; // base64
    const esPDF = file.type === 'application/pdf';
    if (preview) {
      preview.innerHTML = esPDF
        ? `<div style="font-size:32px;margin-bottom:4px">📄</div>
           <div style="font-size:12px;color:var(--text)">${escapeHtml(file.name)}</div>
           <div style="font-size:10px;color:var(--text3);margin-top:4px">PDF subido (${Math.round(file.size/1024)}KB) · click para cambiar</div>`
        : `<img src="${e.target.result}" style="max-width:120px;max-height:100px;border-radius:6px;margin-bottom:4px">
           <div style="font-size:11px;color:var(--text3)">${escapeHtml(file.name)} · click para cambiar</div>`;
    }
  };
  reader.readAsDataURL(file);
}

async function saveNewPOJefe() {
  const sucursal = document.getElementById('poj-sucursal')?.value?.trim() || '';
  const area     = document.getElementById('poj-area')?.value?.trim() || '';
  const tipo     = window._poTipoJefe || 'flota';
  const vehicle_id = document.getElementById('poj-vehicle')?.value || null;
  const notes    = document.getElementById('poj-notes')?.value?.trim() || '';
  const prioridad = document.getElementById('poj-prioridad')?.value || 'Normal';

  // Validaciones básicas
  if (!sucursal) { showToast('error','Elegí una sucursal'); return; }
  if (!area)     { showToast('error','Elegí un área'); return; }

  // Leer items
  const descs = document.querySelectorAll('.poj-item-desc');
  const qtys  = document.querySelectorAll('.poj-item-qty');
  const units = document.querySelectorAll('.poj-item-unit');
  const items = [];
  for (let i = 0; i < descs.length; i++) {
    const d = descs[i].value.trim();
    if (!d) continue;
    items.push({
      descripcion: d,
      cantidad:    parseFloat(qtys[i].value) || 1,
      unidad:      units[i].value || 'un'
      // NO se envía precio_unit — lo pondrá compras
    });
  }
  if (items.length === 0) {
    showToast('error','Agregá al menos un artículo describiendo lo que necesitás');
    return;
  }

  // Campos específicos de tipo edilicio / otro
  const extras = {};
  if (tipo !== 'flota') {
    extras.tipo           = tipo === 'mantenimiento' ? 'edilicio' : 'otro';
    extras.local_sector   = document.getElementById('pojx-local')?.value?.trim() || null;
    extras.sector_detalle = document.getElementById('pojx-sector')?.value || null;
    extras.equipo         = document.getElementById('pojx-equipo')?.value?.trim() || null;
    extras.activo_serie   = document.getElementById('pojx-serie')?.value?.trim() || null;
    extras.urgencia       = document.getElementById('pojx-urgencia')?.value || 'normal';
  } else {
    extras.tipo = 'flota';
  }

  const body = {
    sucursal, area, notes, prioridad,
    vehicle_id: vehicle_id || null,
    items,
    presupuesto_imagen: window._presupuestoArchivo || null,
    ...extras
  };

  try {
    const res = await apiFetch('/api/purchase-orders', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const e = await res.json();
      showToast('error', e.error || 'Error al enviar la solicitud');
      return;
    }
    showToast('ok', '📝 Solicitud enviada — compras la va a cotizar');
    closeModal();
    // Limpiar archivo y refrescar listado
    window._presupuestoArchivo = null;
    await loadPOList?.();
  } catch(err) {
    showToast('error', err.message || 'Error de red');
  }
}

async function saveNewPO() {
  try {
    const notes    = document.getElementById('po-notes')?.value?.trim() || '';
    const sucursal = document.getElementById('po-sucursal')?.value || '';
    const area     = document.getElementById('po-area')?.value || '';
    const prioridad = document.getElementById('po-prioridad')?.value || 'Normal';

    // Proveedor: puede venir del catálogo (supplier_id) o manual (texto)
    let proveedor = '';
    let supplier_id = null;
    const supplierSel = document.getElementById('po-supplier-select');
    if (supplierSel && supplierSel.value && supplierSel.value !== '__manual__') {
      // Elegido del catálogo
      supplier_id = supplierSel.value;
      const opt = supplierSel.options[supplierSel.selectedIndex];
      proveedor = opt?.dataset?.name || opt?.text || '';
    } else {
      // Escrito a mano (sin catálogo o modo manual)
      proveedor = document.getElementById('po-proveedor')?.value?.trim() || '';
    }

    const tipo     = window._poTipo || 'flota';
    const extra    = getPOExtraFields();
    const vehicle_id = document.getElementById('po-vehicle')?.value || null;
    const items = [];
    document.querySelectorAll('[id^="poi-desc-"]').forEach(descEl => {
      const idx   = descEl.id.replace('poi-desc-', '');
      const desc  = descEl.value.trim();
      if (!desc) return;
      const stockLinked = descEl.dataset.stockLinked === 'true';
      items.push({
        descripcion: desc,
        cantidad:    parseFloat(document.getElementById(`poi-qty-${idx}`)?.value)   || 1,
        unidad:      document.getElementById(`poi-unit-${idx}`)?.value              || 'un',
        precio_unit: parseFloat(document.getElementById(`poi-price-${idx}`)?.value) || 0,
        stock_item_id: stockLinked ? (descEl.dataset.stockId || null) : null,
      });
    });
    if (!items.length) { showToast('warn','Agregá al menos un artículo'); return; }
    if (!sucursal)  { showToast('warn','Seleccioná una sucursal'); return; }
    if (!area)      { showToast('warn','Seleccioná un área');    return; }
    if (!proveedor) { showToast('warn','Seleccioná o escribí un proveedor'); return; }

    const ivaPct = window._poIvaPct || 0;
    const res = await apiFetch('/api/purchase-orders', {
      method: 'POST',
      body: JSON.stringify({ notes, sucursal, area, prioridad, proveedor, supplier_id, tipo, vehicle_id: vehicle_id||null, ...extra, iva_pct: ivaPct, items })
    });
    window._poIvaPct = 0;
    window._poSupplierId = null;
    if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error'); return; }
    const po = await res.json();
    closeModal();
    showToast('ok', `OC ${escapeHtml(po.code)} creada`);
    _poItemCount = 1;
    // Recargar listado (usa la nueva loadPOList sin parámetros)
    await loadPOList();
  } catch(err) {
    showToast('error', err.message || 'Error al crear OC');
  }
}

// Handler al cambiar el dropdown de proveedor del catálogo en el modal OC
function _poOnSupplierChange(value) {
  const manualDiv = document.getElementById('po-supplier-manual');
  const sel = document.getElementById('po-supplier-select');
  if (!sel) return;

  if (value === '__manual__') {
    // Mostrar input manual
    if (manualDiv) manualDiv.style.display = 'block';
    window._poSupplierId = null;
    return;
  }
  if (manualDiv) manualDiv.style.display = 'none';

  if (!value) {
    window._poSupplierId = null;
    return;
  }

  // Si elegimos un proveedor, autocompletar forma de pago / moneda / cc_dias
  const opt = sel.options[sel.selectedIndex];
  window._poSupplierId = value;

  const fpago = opt.dataset.fpago;
  const ccdias = opt.dataset.ccdias;
  const moneda = opt.dataset.moneda;

  // Persistir las condiciones del proveedor: así, si se re-renderizan los campos
  // extra (ej. al cambiar el tipo de OC con setPOTipo), el render las vuelve a
  // aplicar en vez de pisarlas con vacío.
  window._ocEditValues = Object.assign({}, window._ocEditValues, {
    forma_pago: fpago || null,
    cc_dias: (ccdias !== '' && ccdias != null) ? ccdias : null,
    moneda: moneda || 'ARS',
  });

  // Autocompletar el render actual (se renderizan por setPOTipo -> getPOExtraFields)
  setTimeout(() => {
    const fpagoEl  = document.getElementById('po-forma-pago');
    const ccdiasEl = document.getElementById('po-cc-dias');
    const monedaEl = document.getElementById('po-moneda');

    if (fpagoEl && fpago)  fpagoEl.value = fpago;
    if (ccdiasEl && ccdias) ccdiasEl.value = ccdias;
    if (monedaEl && moneda) monedaEl.value = moneda;

    if (fpagoEl && fpago && typeof _ocToggleCC === 'function') {
      _ocToggleCC('po');
    }
  }, 50);

  if (fpago) showToast?.('ok', 'Condiciones del proveedor cargadas automáticamente');
}

// ── Ver detalle de OC ────────────────────────────────────
async function openPODetail(id) {
  try {
    // Resetear el contador de ids para los artículos editables inline
    window._podItemNextIdx = 0;
    // Cache-busting: siempre datos frescos al abrir el detalle
    const ts = Date.now();
    const res = await apiFetch(`/api/purchase-orders/${id}?_t=${ts}`);
    if (!res.ok) { showToast('error','Error al cargar OC'); return; }
    const po = await res.json();
    // ID autoritativo de la OC abierta — lo usa timeline.js para enriquecer la
    // trazabilidad. Sin esto, timeline.js adivinaba el id y podía arrastrar las
    // facturas/pagos de OTRA OC.
    if (window.App) App.currentPODetailId = id;

    // ¿OC consolidada generada desde una OT? Solo en ese caso mostramos el
    // selector de proveedor por ítem (Compras lo usa antes de dividir la OC).
    window._podFromOT = !!po.ot_id;

    const role    = App.currentUser?.role;
    const puedeVerPrecios = _ocPuedeVerPrecios(role);
    const esCreador = po.requested_by === App.currentUser?.id;
    const esAdmin   = ['dueno','gerencia'].includes(role);

    // ── canEdit inteligente: según rol + estado de la OC ──
    // Cada actor solo puede editar campos en su etapa correspondiente.
    // Los admins (dueño/gerencia) siempre pueden editar.
    let canEdit = false;
    let bloqueoMensaje = '';
    if (esAdmin) {
      canEdit = true;
    } else if (role === 'compras') {
      if (['pendiente_cotizacion','en_cotizacion'].includes(po.status)) {
        canEdit = true;
      } else if (po.status === 'aprobada_compras') {
        bloqueoMensaje = '🔒 Esta OC ya fue aprobada. No se pueden modificar items ni proveedor. Si hay un error, usá "⏪ Devolver" para que el solicitante la corrija.';
      } else {
        bloqueoMensaje = '🔒 Esta OC ya avanzó a tesorería/recepción. No podés modificarla en su etapa actual.';
      }
    } else if (role === 'tesoreria') {
      if (['aprobada_compras','enviada_proveedor'].includes(po.status)) {
        // Tesorería NO edita datos — solo verifica y paga (la factura llega cargada por compras)
        canEdit = false;
        bloqueoMensaje = po.status === 'aprobada_compras'
          ? '⏳ Esta OC todavía no fue enviada al proveedor. Compras debe marcarla como enviada antes de poder pagarla.'
          : '📋 Tesorería: Click en "📄 Facturas" para ver/cargar facturas y registrar pagos. Cada factura puede tener uno o varios pagos parciales.';
      } else if (po.status === 'pagada') {
        bloqueoMensaje = '🔒 Esta OC ya fue pagada. Los datos de factura quedan congelados.';
      } else {
        bloqueoMensaje = '🔒 Esta OC todavía no llegó a tesorería. Esperá que compras la apruebe.';
      }
    } else {
      // jefe_mant, paniol, contador, y otros solicitantes
      bloqueoMensaje = '🔒 Esta OC ya fue enviada a compras. Podés verla pero no modificarla.';
    }

    const canPay  = ['dueno','gerencia','tesoreria'].includes(role);
    const canCancel = ['dueno','gerencia'].includes(role);

    const estadoInfo = {
      pendiente_cotizacion: { label:'PENDIENTE COTIZACIÓN', color:'#f59e0b', icon:'📝' },
      en_cotizacion:        { label:'EN COTIZACIÓN',        color:'#a78bfa', icon:'🔎' },
      aprobada_compras:     { label:'APROBADA POR COMPRAS', color:'#38bdf8', icon:'✅' },
      pagada:               { label:'PAGADA',               color:'#10b981', icon:'💰' },
      recibida:             { label:'RECIBIDA',             color:'#10b981', icon:'📦' },
      rechazada:            { label:'RECHAZADA',            color:'#ef4444', icon:'❌' },
      dividida:             { label:'DIVIDIDA POR PROVEEDOR', color:'#c084fc', icon:'🔀' }
    };
    const st = estadoInfo[po.status] || { label:(po.status||'').toUpperCase(), color:'#6b7280', icon:'📋' };
    const esTerminal = ['rechazada','cerrada'].includes(po.status);
    const canEditItems = canEdit && !esTerminal && puedeVerPrecios && ['pendiente_cotizacion','en_cotizacion'].includes(po.status);
    // Los artículos quedan congelados al aprobar Compras: desde ese momento el precio ya impacta la OT vinculada.
    window._poItemsEditable = canEditItems;
    window._ocEditValues = { forma_pago: po.forma_pago, cc_dias: po.cc_dias, moneda: po.moneda };

    const totalReal = po.items.reduce((a,i) => a + (parseFloat(i.cantidad||0) * parseFloat(i.precio_unit||0)), 0);
    const fmt = d => d ? new Date(d).toLocaleString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';

    const tl = (label, nombre, fecha, done) => `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0">
        <div style="width:10px;height:10px;border-radius:50%;background:${done?'var(--accent)':'var(--border2)'};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">${label}</div>
          <div style="font-size:13px;font-weight:${done?'600':'400'};color:${done?'var(--text)':'var(--text3)'}">${done ? (nombre||'—') : '—'}</div>
        </div>
        <div style="font-size:11px;color:var(--text3);white-space:nowrap">${done ? fmt(fecha) : ''}</div>
      </div>
    `;

    // Enriquecer datos de vehículo si el backend no los trae (buscar en App.data.vehicles)
    let vehInfoDet = { code: po.vehicle_code || null, plate: po.vehicle_plate || null };
    if (po.vehicle_id && (!vehInfoDet.code || !vehInfoDet.plate)) {
      const v = (App.data.vehicles||[]).find(x => x.id === po.vehicle_id);
      if (v) { vehInfoDet.code = v.code; vehInfoDet.plate = v.plate; }
    }

    openModal(`${st.icon} ${escapeHtml(po.code)} — ${escapeHtml(po.sucursal||'—')} · ${escapeHtml(po.area||'—')}`, `
      <div style="background:${st.color}22;border:1px solid ${st.color};border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="background:${st.color};color:white;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700">${st.label}</span>
          <span style="font-size:13px;color:var(--text2)">${po.moneda==='USD'?'US$':'$'} ${_ocFormaPagoLabel(po.forma_pago, po.cc_dias)}</span>
        </div>
        <div style="font-size:11px;color:var(--text3)">Creada ${fmt(po.created_at)}</div>
      </div>

      ${(!canEdit && bloqueoMensaje && !esTerminal) ? `
      <div style="background:rgba(107,114,128,.12);border:1px solid rgba(107,114,128,.4);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text2)">
        <span style="font-size:18px">🔒</span>
        <span>${bloqueoMensaje}</span>
      </div>` : ''}
      ${po.status === 'rechazada' ? `
      <div style="background:rgba(107,114,128,.12);border:1px solid rgba(107,114,128,.4);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text2)">
        <span style="font-size:18px">🔒</span>
        <span>Esta OC está rechazada y ya no se puede modificar.</span>
      </div>` : ''}
      ${po.status === 'recibida' && (po.payment_status !== 'total' || po.invoice_status !== 'total') ? `
      <div style="background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.35);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text2)">
        <span style="font-size:18px">📦</span>
        <span>Mercadería recibida. La OC sigue abierta administrativamente: ${po.invoice_status !== 'total' ? 'falta cargar factura' : ''}${po.invoice_status !== 'total' && po.payment_status !== 'total' ? ' y ' : ''}${po.payment_status !== 'total' ? 'falta pagar' : ''}.</span>
      </div>` : ''}

      ${po.status==='rechazada' && po.rechazo_motivo ? `
      <div style="background:#ef444422;border-left:3px solid #ef4444;border-radius:var(--radius);padding:10px 14px;margin-bottom:16px">
        <div style="font-size:11px;color:#ef4444;font-weight:700;text-transform:uppercase;margin-bottom:4px">Motivo del rechazo</div>
        <div style="font-size:13px;color:var(--text)">${po.rechazo_motivo}</div>
      </div>` : ''}

      <div class="card" style="padding:12px 16px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">🕐 Trazabilidad</div>
        ${tl('Solicitó',         po.solicitante_nombre, po.created_at,              true)}
        ${tl('Tomó cotización',  po.cotizador_nombre,   po.cotizado_at,             !!po.cotizado_at)}
        ${tl('Aprobó',           po.aprobador_nombre,   po.aprobado_compras_at,     !!po.aprobado_compras_at)}
        ${tl('Pagó',             po.pagador_nombre,     po.pagado_at,               !!po.pagado_at)}
        ${tl('Recibió',          po.receptor_nombre,    po.recibido_at,             !!po.recibido_at)}
        ${po.status==='rechazada' ? tl('Rechazó', po.rechazador_nombre, po.rechazado_at, true) : ''}
      </div>

      ${po.motivo_devolucion ? `
      <div class="card" style="padding:10px 14px;margin-bottom:14px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35)">
        <div style="font-size:11px;color:var(--warn);font-weight:700;text-transform:uppercase;margin-bottom:4px">⏪ Devuelta por corrección</div>
        <div style="font-size:13px;color:var(--text)">${escapeHtml(po.motivo_devolucion)}</div>
      </div>` : ''}

      ${po.vehicle_id ? `
      <div class="card" style="padding:12px 16px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">🚛 Vehículo</div>
        <div style="font-size:15px;font-weight:700;color:var(--accent)">${escapeHtml(vehInfoDet.code || '—')} · ${escapeHtml(vehInfoDet.plate || '—')}</div>
        ${po.ot_id ? `<div style="font-size:11px;margin-top:4px">✅ OT generada: <a onclick="closeModal();navigate('workorders')" style="color:var(--accent);cursor:pointer;text-decoration:underline">Ver en OTs</a></div>` :
          (po.status==='aprobada_compras' ? '<div style="font-size:11px;color:var(--text3);margin-top:3px">💡 Al recibir se generará automáticamente una OT con el costo de la factura</div>' : '')}
      </div>` : ''}

      ${puedeVerPrecios ? `
      <div class="card" style="padding:12px 16px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">🏢 Proveedor</div>
        <div style="display:grid;grid-template-columns:1fr;gap:10px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Proveedor</label>
            ${(() => {
              const cat = (App.data.suppliers || []).filter(s => s.status === 'activo');
              const readonly = !(canEdit && !esTerminal);
              if (readonly) {
                return `<input class="form-input" id="pod-proveedor" value="${escapeHtml(po.proveedor||'')}" readonly>`;
              }
              if (!cat.length) {
                return `<input class="form-input" id="pod-proveedor" value="${escapeHtml(po.proveedor||'')}" placeholder="Nombre del proveedor">
                        <div style="font-size:11px;color:var(--warn);margin-top:3px">⚠️ Cargá proveedores en el módulo "🏢 Proveedores" para elegirlos del catálogo.</div>`;
              }
              // Matchear proveedor actual por supplier_id o por nombre
              const matchedId = po.supplier_id || (cat.find(s => s.name === po.proveedor)?.id || '');
              return `
                <select class="form-select" id="pod-supplier-select" onchange="onPODSupplierChange()">
                  <option value="">— Seleccionar del catálogo —</option>
                  ${cat.map(s => `<option value="${s.id}" data-name="${escapeHtml(s.name)}" ${s.id===matchedId?'selected':''}>${escapeHtml(s.name)}${s.cuit?' · '+escapeHtml(s.cuit):''}</option>`).join('')}
                  <option value="__manual__" ${!matchedId && po.proveedor ? 'selected' : ''}>✏️ Escribir manualmente...</option>
                </select>
                <input class="form-input" id="pod-proveedor" value="${escapeHtml(po.proveedor||'')}"
                  placeholder="Nombre del proveedor"
                  style="margin-top:6px;${matchedId ? 'display:none' : ''}">
              `;
            })()}
          </div>
          <!-- Los datos de la factura los carga el rol Proveedores cuando reciben la factura física.
               Compras solo cierra la cotización con: proveedor + forma de pago + items. -->
        </div>
      </div>

      <div class="card" style="padding:12px 16px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">💳 Pago y moneda</div>
        <div id="pod-extra-fields"></div>
        <div style="margin-top:10px">
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px">IVA</div>
          ${canEdit && !esTerminal
            ? ('<div style="display:flex;gap:8px">'
                + ['Sin IVA','10.5%','21%'].map(v => {
                    const pct = v==='21%' ? 21 : v==='10.5%' ? 10.5 : 0;
                    const active = parseFloat(po.iva_pct||0) === pct;
                    return '<button type="button" id="pod-iva-btn-'+v+'" onclick="setPODetailIva(\''+v+'\')"'
                      +' style="padding:4px 14px;border-radius:20px;border:1px solid var(--border2);cursor:pointer;font-size:12px;font-weight:600;'
                      +'background:'+(active?'var(--accent)':'transparent')+';color:'+(active?'white':'var(--text3)')+';transition:.15s">'+v+'</button>';
                  }).join('')
                + '<input type="hidden" id="pod-iva-pct" value="'+parseFloat(po.iva_pct||0)+'">'
                + '</div>')
            : ('<span style="font-weight:600">' + (parseFloat(po.iva_pct||0) > 0 ? po.iva_pct+'%' : 'Sin IVA') + '</span>')}
        </div>
      </div>
      ` : ''}

      <div class="card" style="padding:0;margin-bottom:16px">
        <div style="padding:10px 16px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">🛒 Artículos</span>
          ${canEditItems ? `
            <button class="btn btn-secondary btn-sm" onclick="addPODetailItem()" style="font-size:11px;padding:4px 10px">+ Agregar</button>
          ` : ''}
        </div>

        ${canEditItems ? `
          <!-- MODO EDITABLE INLINE -->
          <div style="padding:10px 16px">
            <div style="display:grid;grid-template-columns:1fr 70px 65px 110px 100px 30px;gap:6px;margin-bottom:6px;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.5px">
              <div>Descripción</div>
              <div style="text-align:center">Cant.</div>
              <div style="text-align:center">Unid.</div>
              <div style="text-align:right">P. Unit.</div>
              <div style="text-align:right">Subtotal</div>
              <div></div>
            </div>
            <div id="pod-items-container">
              ${po.items.map((item, idx) => buildPODetailItemRow(idx, item)).join('')}
            </div>
          </div>
        ` : `
          <!-- MODO LECTURA (roles que no editan o estados finales) -->
          <table style="font-size:13px">
            <thead><tr>
              <th>Descripción</th>
              <th style="text-align:center">Cant.</th>
              <th style="text-align:center">Unid.</th>
              ${puedeVerPrecios ? `
                <th style="text-align:right">P. Unit.</th>
                <th style="text-align:right">Subtotal</th>
              ` : ''}
            </tr></thead>
            <tbody>
              ${po.items.map(i => `<tr>
                <td>${escapeHtml(i.descripcion)}</td>
                <td style="text-align:center">${parseFloat(i.cantidad)}</td>
                <td style="text-align:center">${escapeHtml(i.unidad)}</td>
                ${puedeVerPrecios ? `
                  <td style="text-align:right;font-family:monospace">${po.moneda==='USD'?'US$':'$'}${parseFloat(i.precio_unit||0).toLocaleString('es-AR')}</td>
                  <td style="text-align:right;font-family:monospace;font-weight:600">${po.moneda==='USD'?'US$':'$'}${Math.round(parseFloat(i.subtotal||0)).toLocaleString('es-AR')}</td>
                ` : ''}
              </tr>`).join('')}
            </tbody>
          </table>
        `}

        ${puedeVerPrecios ? `
        <div style="padding:8px 16px;border-top:1px solid var(--border2);display:flex;justify-content:space-between">
          <span style="font-size:12px;color:var(--text3)">Subtotal</span>
          <span style="font-family:monospace;font-size:12px" id="pod-subtotal-display">${po.moneda==='USD'?'US$':'$'}${Math.round(totalReal).toLocaleString('es-AR')}</span>
        </div>
        <div id="pod-iva-row" style="padding:4px 16px;display:flex;justify-content:space-between;${parseFloat(po.iva_pct||0)===0?'opacity:.4':''}">
          <span style="font-size:12px;color:var(--text3)" id="pod-iva-row-label">IVA (${po.iva_pct||0}%)</span>
          <span style="font-family:monospace;font-size:12px" id="pod-iva-row-monto">${po.moneda==='USD'?'US$':'$'}${Math.round(totalReal * parseFloat(po.iva_pct||0) / 100).toLocaleString('es-AR')}</span>
        </div>
        <div style="padding:10px 16px;border-top:2px solid var(--border2);display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:13px;font-weight:700">TOTAL</span>
          <span style="font-size:20px;font-weight:700;font-family:monospace;color:var(--accent)" id="pod-total-display">${po.moneda==='USD'?'US$':'$'}${Math.round(totalReal * (1 + parseFloat(po.iva_pct||0)/100)).toLocaleString('es-AR')}</span>
        </div>
        ` : ''}
      </div>

      ${(po.split_parent || (po.split_children && po.split_children.length)) ? `
      <div class="card" style="padding:12px 16px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">🔀 Trazabilidad de división por proveedor</div>
        ${po.split_parent ? `
          <div style="font-size:13px;margin-bottom:6px">
            Esta OC nació al dividir la OC madre
            <a href="#" onclick="closeModal();openPODetail('${po.split_parent.id}');return false;" style="color:var(--accent);font-weight:600">${escapeHtml(po.split_parent.code)}</a>.
          </div>` : ''}
        ${(po.split_children && po.split_children.length) ? `
          <div style="font-size:13px;margin-bottom:6px">Se dividió en ${po.split_children.length} OC, una por proveedor:</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${po.split_children.map(h => `
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px">
                <a href="#" onclick="closeModal();openPODetail('${h.id}');return false;" style="color:var(--accent);font-weight:600">${escapeHtml(h.code)}</a>
                <span style="color:var(--text3)">→ ${escapeHtml(h.supplier_name || 'sin proveedor')}</span>
                ${_ocEstadoBadge(h.status)}
              </div>`).join('')}
          </div>` : ''}
      </div>` : ''}

      <div class="card" style="padding:12px 16px;margin-bottom:4px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">📝 Observaciones</div>
        <textarea class="form-textarea" id="pod-notes" rows="2" ${canEdit && !esTerminal?'':'readonly'} placeholder="—">${escapeHtml(po.notes||'')}</textarea>
      </div>`,
      (() => {
        // ── Armar botones según rol + estado actual (lógica limpia) ──
        const btns = [];

        // Siempre presente
        btns.push({ label:'Cerrar', cls:'btn-secondary', fn: closeModal });
        btns.push({ label:'🖨 Imprimir', cls:'btn-secondary', fn: () => { closeModal(); printPO(id); } });

        // 📎 Presupuesto adjunto — se trae aparte (carga diferida) para no
        // ralentizar la apertura de la OC con el base64.
        if (po.tiene_presupuesto) {
          btns.push({ label:'📎 Ver presupuesto', cls:'btn-secondary', fn: () => verPresupuestoOC(id) });
        }

        // OC cerrada: dueño/gerencia pueden reabrirla (para corregir, ej. anular una recepción).
        if (po.status === 'cerrada' && ['dueno','gerencia'].includes(role)) {
          btns.push({ label:'🔓 Reabrir OC', cls:'btn-warn', fn: () => reabrirOC(id) });
        }

        // Si la OC está rechazada/cerrada, solo cerrar/imprimir (+ reabrir si corresponde).
        if (esTerminal) return btns;

        // Separador: utilidad (Cerrar/Imprimir) a la izquierda, acciones a la derecha.
        btns.push({ spacer: true });

        // Botón de guardar cambios — solo si el rol puede editar
        // (Los artículos ya son editables inline cuando canEdit, no hace falta botón aparte)
        if (canEdit) {
          btns.push({ label:'💾 Guardar cambios', cls:'btn-primary', fn: () => savePODetail(id) });
        }

        // 🔀 Dividir por proveedor — OC consolidada de una OT. Compras asigna un
        // proveedor por ítem y genera una OC por proveedor (con trazabilidad).
        if (window._podFromOT && ['pendiente_cotizacion','en_cotizacion'].includes(po.status)
            && (role === 'compras' || ['dueno','gerencia'].includes(role))) {
          btns.push({ label:'🔀 Dividir por proveedor', cls:'btn-warn', fn: () => dividirOCPorProveedor(id) });
        }

        // ══════════════════════════════════════════════
        //  ACCIÓN PRINCIPAL: una sola por estado/rol
        // ══════════════════════════════════════════════

        // 📝 Pendiente cotización → compras/dueño toman
        if (po.status === 'pendiente_cotizacion' && (role === 'compras' || ['dueno','gerencia'].includes(role))) {
          btns.push({ label:'🔎 Tomar cotización', cls:'btn-primary', fn: () => tomarCotizacionOC(id) });
        }

        // 🔎 En cotización → compras/dueño aprueban (con datos completos)
        if (po.status === 'en_cotizacion' && (role === 'compras' || ['dueno','gerencia'].includes(role))) {
          btns.push({ label:'✅ Aprobar con precios', cls:'btn-primary', fn: () => aprobarOC(id) });
        }

        // 📤 Aprobada compras → compras/dueño marcan enviada al proveedor (paso obligatorio)
        if (po.status === 'aprobada_compras' && (role === 'compras' || ['dueno','gerencia'].includes(role))) {
          btns.push({ label:'📤 Marcar enviada al proveedor', cls:'btn-primary', fn: () => marcarEnviadaOC(id) });
        }

        // ✅ Enviada al proveedor → tesorería/dueño confirman pago
        if (po.status === 'enviada_proveedor' && (role === 'tesoreria' || ['dueno','gerencia'].includes(role))) {
          btns.push({ label:'✓ Confirmar pago', cls:'btn-primary', fn: () => pagarOC(id) });
        }

        // 📦 Recepción: disponible desde que se envió al proveedor. No depende del pago.
        const esMismaSucursalRecepcion = role === 'gerente_sucursal'
          && App.currentUser?.sucursal
          && po.sucursal
          && String(App.currentUser.sucursal).trim().toLowerCase() === String(po.sucursal).trim().toLowerCase();
        // 📦 Recepción de mercadería — ÚNICO camino: la recepción granular, que
        // crea historial detallado, respeta OC abierta e impacta el stock.
        // Visible en enviada_proveedor/pagada; en 'recibida' solo si la OC es abierta
        // (servicios fraccionados); nunca en 'cerrada'.
        const puedeRecibirMercaderia =
          ['enviada_proveedor','pagada'].includes(po.status) ||
          (po.status === 'recibida' && po.is_open === true);
        // El gerente de sucursal solo recibe mercadería de OCs de SU sucursal. El backend
        // ya lo bloquea (checkSucursalScope); acá ocultamos el botón para no ofrecer una
        // acción que va a fallar. Para el resto de los roles no aplica el filtro de sucursal.
        const rolPuedeRecibir =
          ['dueno','gerencia','jefe_mantenimiento','paniol','contador','compras','gerente_sucursal'].includes(role)
          && (role !== 'gerente_sucursal' || esMismaSucursalRecepcion);
        if (puedeRecibirMercaderia && rolPuedeRecibir) {
          btns.push({ label:'📦 Recibir mercadería', cls:'btn-primary', fn: () => abrirModalRecepciones(id) });
        }

        // 📄 Facturas (disponible desde aprobada_compras en adelante, incluida cerrada
        // para consulta — en cerrada es solo lectura, no se cargan facturas nuevas).
        if (['aprobada_compras','enviada_proveedor','pagada','recibida','cerrada'].includes(po.status) && (
          ['dueno','gerencia','compras','tesoreria','contador','proveedores'].includes(role)
        )) {
          btns.push({ label: po.status === 'cerrada' ? '📄 Ver facturas' : '📄 Facturas', cls:'btn-secondary', fn: () => abrirModalFacturas(id) });
        }

        // 🔒 Cerrar OC manualmente (sobre todo para OC abiertas/servicios).
        // El cierre automático (pago + entrega total) ocurre solo; este botón es para
        // cerrar a mano cuando el circuito no se completa por cantidad.
        if (['enviada_proveedor','pagada','recibida'].includes(po.status) && ['dueno','gerencia','compras'].includes(role)) {
          btns.push({ label:'🔒 Cerrar OC', cls:'btn-secondary', fn: () => cerrarOC(id) });
        }

        // ══════════════════════════════════════════════
        //  ACCIONES SECUNDARIAS: Devolver / Rechazar
        // ══════════════════════════════════════════════

        // ⏪ Devolver (retrocede etapa con motivo)
        const puedeDevolver = (
          (role === 'compras' && ['en_cotizacion','enviada_proveedor'].includes(po.status)) ||
          (role === 'tesoreria' && po.status === 'enviada_proveedor') ||
          (['jefe_mantenimiento','paniol','contador'].includes(role) && esCreador && po.status === 'pagada') ||
          (['dueno','gerencia'].includes(role) && ['en_cotizacion','aprobada_compras','enviada_proveedor','pagada'].includes(po.status))
        );
        if (puedeDevolver) {
          btns.push({ label: role === 'compras' ? '↩ Rechazo parcial / corregir' : '⏪ Devolver', cls:'btn-warn', fn: () => devolverOC(id, po.status) });
        }

        // ❌ Rechazar (cierre definitivo)
        const puedeRechazar = (
          (['jefe_mantenimiento','paniol','contador'].includes(role) && esCreador && po.status === 'pendiente_cotizacion') ||
          (role === 'compras' && ['pendiente_cotizacion','en_cotizacion','aprobada_compras'].includes(po.status)) ||
          (role === 'tesoreria' && po.status === 'enviada_proveedor') ||
          ['dueno','gerencia'].includes(role)
        );
        if (puedeRechazar) {
          btns.push({ label: role === 'compras' ? '🚫 Anular compra' : '❌ Rechazar final', cls:'btn-danger', fn: () => rechazarOC(id) });
        }

        return btns;
      })()
    );

    if (typeof renderPOExtraFields === 'function') {
      renderPOExtraFields(po.tipo, 'pod-extra-fields');
    }

    // Marcar el input de monto como "editado manualmente" si ya tiene valor cargado
    // (así no se auto-sobreescribe al abrir la OC por primera vez)
    const montoEl = document.getElementById('pod-factura-monto');
    if (montoEl && po.factura_monto && parseFloat(po.factura_monto) > 0) {
      montoEl.dataset.manualEdit = '1';
    }
  } catch(err) { showToast('error', err.message); }
}
// 📎 Ver el presupuesto adjunto de una OC (carga diferida). El base64 ya no
// viaja en el detalle; se pide acá solo cuando el usuario quiere verlo.
async function verPresupuestoOC(id) {
  try {
    showToast?.('info', 'Cargando presupuesto…');
    const res = await apiFetch(`/api/purchase-orders/${id}/presupuesto`);
    if (!res.ok) { const e = await res.json().catch(()=>({})); showToast('error', e.error || 'No se pudo cargar el presupuesto'); return; }
    const { presupuesto_imagen } = await res.json();
    if (!presupuesto_imagen) { showToast('error', 'Esta OC no tiene presupuesto adjunto'); return; }

    // data URL → Blob → URL de objeto (más robusto que abrir el data URL directo,
    // sobre todo con PDFs y archivos grandes).
    const coma = presupuesto_imagen.indexOf(',');
    const head = presupuesto_imagen.slice(0, coma);
    const b64  = presupuesto_imagen.slice(coma + 1);
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin  = atob(b64);
    const arr  = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: mime }));

    const w = window.open(url, '_blank');
    if (!w) { showToast('error', 'Habilitá las ventanas emergentes para ver el presupuesto'); }
    // Liberar la URL después de un rato (ya se abrió en la otra pestaña).
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) { showToast('error', err.message); }
}

async function savePODetail(id) {
  try {
    const body = {};

    // IVA — si el hidden existe
    const ivaEl = document.getElementById('pod-iva-pct');
    if (ivaEl) body.iva_pct = parseFloat(ivaEl.value) || 0;

    // Campos extras (forma_pago, cc_dias, moneda)
    try {
      const extra = (typeof getPODetailExtraFields === 'function') ? getPODetailExtraFields() : {};
      Object.assign(body, extra);
    } catch(e) {}

    // Proveedor: puede venir del catálogo (supplier_id) o manual (texto)
    const podSupSel = document.getElementById('pod-supplier-select');
    const provEl    = document.getElementById('pod-proveedor');
    if (podSupSel && podSupSel.value && podSupSel.value !== '__manual__') {
      body.supplier_id = podSupSel.value;
      const opt = podSupSel.options[podSupSel.selectedIndex];
      body.proveedor = opt?.dataset?.name || opt?.text || '';
    } else if (provEl && provEl.value !== undefined) {
      body.supplier_id = null;
      body.proveedor = provEl.value.trim() || null;
    }

    // Datos de factura (solo si existen los inputs)
    const fnEl = document.getElementById('pod-factura-nro');
    if (fnEl) body.factura_nro = fnEl.value.trim() || null;
    const ffEl = document.getElementById('pod-factura-fecha');
    if (ffEl) body.factura_fecha = ffEl.value || null;
    const fmEl = document.getElementById('pod-factura-monto');
    if (fmEl) body.factura_monto = fmEl.value ? parseFloat(fmEl.value) : null;

    // Notas
    const notesEl = document.getElementById('pod-notes');
    if (notesEl) body.notes = notesEl.value.trim() || null;

    // ── Leer artículos si están en modo editable inline ──
    let itemsEditados = null;
    if (window._poItemsEditable && document.querySelector('[id^="podi-desc-"]')) {
      itemsEditados = readPODetailItems();
      if (itemsEditados.length === 0) {
        showToast('warn', 'Debe haber al menos un artículo con descripción');
        return;
      }
    }

    if (Object.keys(body).length === 0 && !itemsEditados) {
      showToast('warn', 'Nada para guardar');
      return;
    }

    // 1) PATCH con datos de cabecera
    if (Object.keys(body).length > 0) {
      const res = await apiFetch(`/api/purchase-orders/${id}`, { method:'PATCH', body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error al guardar cabecera'); return; }
    }

    // 2) PUT con los artículos (si hubo edición)
    if (itemsEditados) {
      const res2 = await apiFetch(`/api/purchase-orders/${id}/items`, {
        method: 'PUT',
        body: JSON.stringify({ items: itemsEditados })
      });
      if (!res2.ok) { const e = await res2.json(); showToast('error', e.error||'Error al guardar artículos'); return; }
    }

    showToast('ok','✅ Cambios guardados');
    // Reabrir el modal con datos frescos (no sacar al usuario del contexto)
    await openPODetail(id);
    // Refrescar listado en paralelo
    loadPOList();
  } catch(err) { showToast('error', err.message); }
}

// 🔀 Dividir una OC consolidada (de una OT) en una OC por proveedor.
// Compras asigna un proveedor a cada ítem; al dividir, se generan N OCs hijas
// (una por proveedor) con trazabilidad a la OC madre y a la OT.
async function dividirOCPorProveedor(id) {
  try {
    // 1) Guardar primero los proveedores asignados por ítem (si está editable),
    //    para que el backend divida con los datos actuales en pantalla.
    let items = null;
    if (window._poItemsEditable && document.querySelector('[id^="podi-desc-"]')) {
      items = readPODetailItems();
      if (!items.length) { showToast('warn', 'Debe haber al menos un artículo'); return; }
      const sinProv = items.filter(it => !it.supplier_id);
      if (sinProv.length) {
        showToast('warn', `Asigná un proveedor a cada ítem antes de dividir (faltan ${sinProv.length})`);
        return;
      }
      const resItems = await apiFetch(`/api/purchase-orders/${id}/items`, {
        method: 'PUT', body: JSON.stringify({ items })
      });
      if (!resItems.ok) { const e = await resItems.json(); showToast('error', e.error||'Error al guardar artículos'); return; }
    }

    // ¿Cuántos proveedores distintos hay? Para el mensaje de confirmación.
    const provs = items ? [...new Set(items.map(it => it.supplier_id))] : [];
    const msg = provs.length > 1
      ? `Se generarán ${provs.length} órdenes de compra, una por proveedor. La OC actual quedará como registro de la división. ¿Continuar?`
      : '¿Dividir esta OC por proveedor?';
    if (!confirm(msg)) return;

    // 2) Dividir
    const res = await apiFetch(`/api/purchase-orders/${id}/dividir`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.items_sin_proveedor?.length) {
        showToast('error', `Falta proveedor en: ${data.items_sin_proveedor.join(', ')}`);
      } else {
        showToast('error', data.error || 'Error al dividir la OC');
      }
      return;
    }

    if (data.dividida) {
      const codes = (data.hijas || []).map(h => h.code).join(', ');
      showToast('ok', `✅ OC dividida en: ${codes}`);
    } else {
      showToast('ok', '✅ Proveedor asignado a la OC');
    }
    await openPODetail(id);
    loadPOList();
  } catch(err) { showToast('error', err.message); }
}

async function deletePO(id) {
  if (!confirm('¿Eliminar esta OC? Esta acción no se puede deshacer.')) return;
  try {
    const res = await apiFetch(`/api/purchase-orders/${id}`, { method:'DELETE' });
    if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error'); return; }
    showToast('ok','OC eliminada');
    await loadPOList();
  } catch(err) { showToast('error', err.message); }
}

// Handler del dropdown de proveedor en el modal de detalle de OC
function onPODSupplierChange() {
  const sel   = document.getElementById('pod-supplier-select');
  const input = document.getElementById('pod-proveedor');
  if (!sel || !input) return;
  if (sel.value === '__manual__') {
    // Modo manual: mostrar input vacío para escribir
    input.style.display = '';
    input.value = '';
    input.focus();
  } else if (sel.value) {
    // Del catálogo: ocultar input y poner nombre del proveedor ahí (para el save)
    const opt = sel.options[sel.selectedIndex];
    input.value = opt?.dataset?.name || opt?.text || '';
    input.style.display = 'none';
  } else {
    // Sin seleccionar: limpiar
    input.style.display = 'none';
    input.value = '';
  }
}

// ── Impresión de OC ──────────────────────────────────────
async function printPO(id) {
  try {
    // Cache-busting para traer datos FRESCOS del servidor (no cache del browser)
    const ts = Date.now();
    const res = await apiFetch(`/api/purchase-orders/${id}?_t=${ts}`);
    if (!res.ok) { showToast('error','Error al cargar OC'); return; }
    const po = await res.json();

    // Cargar recepciones, facturas y pagos del flujo nuevo
    let recepciones = [], facturas = [], pagosByFactura = {};
    try {
      const [recR, facR] = await Promise.all([
        apiFetch(`/api/purchase-orders/${id}/recepciones`),
        apiFetch(`/api/purchase-orders/${id}/facturas`),
      ]);
      if (recR.ok) recepciones = await recR.json();
      if (facR.ok) facturas = await facR.json();
      for (const f of facturas) {
        try {
          const r = await apiFetch(`/api/purchase-orders/${id}/facturas/${f.id}/pagos`);
          if (r.ok) pagosByFactura[f.id] = await r.json();
        } catch {}
      }
    } catch (e) { console.warn('print extra data', e); }

    const totalReal = po.items.reduce((a,i) => a + (parseFloat(i.cantidad||0) * parseFloat(i.precio_unit||0)), 0);
    const ivaMonto = Math.round(totalReal * parseFloat(po.iva_pct||0) / 100);
    const totalConIva = Math.round(totalReal * (1 + parseFloat(po.iva_pct||0)/100));

    // Helper: badge de estado con color
    const statusBadge = {
      'pendiente_cotizacion': 'background:#fef3c7;color:#92400e',
      'en_cotizacion':        'background:#ede9fe;color:#5b21b6',
      'aprobada_compras':     'background:#dbeafe;color:#1e40af',
      'pagada':               'background:#dcfce7;color:#166534',
      'recibida':             'background:#dcfce7;color:#166534',
      'rechazada':            'background:#fee2e2;color:#991b1b',
    }[po.status] || 'background:#f3f4f6;color:#374151';

    // Enriquecer vehículo si el backend no lo trae — buscar en App.data.vehicles
    let vehInfo = { code: po.vehicle_code || null, plate: po.vehicle_plate || null };
    if (po.vehicle_id && (!vehInfo.code || !vehInfo.plate)) {
      const v = (App.data.vehicles||[]).find(x => x.id === po.vehicle_id);
      if (v) { vehInfo.code = v.code; vehInfo.plate = v.plate; }
    }

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html lang="es"><head>
      <meta charset="UTF-8">
      <title>OC ${escapeHtml(po.code)} — Biletta</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size:13px; color:#111; padding:32px; background:#fff; }
        .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28px; padding-bottom:20px; border-bottom:3px solid #E55A11; }
        .logo-wrap { display:flex; align-items:center; gap:14px; }
        .logo-square { width:52px; height:52px; background:#E55A11; color:#fff; border-radius:10px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:20px; letter-spacing:.5px; }
        .empresa { font-size:20px; font-weight:700; color:#111; }
        .empresa-sub { font-size:11px; color:#6b7280; margin-top:2px; }
        .doc-code { font-size:22px; font-weight:700; font-family:monospace; color:#E55A11; text-align:right; }
        .doc-sub { font-size:11px; color:#6b7280; text-align:right; margin-top:4px; }
        .status-pill { display:inline-block; padding:4px 12px; border-radius:20px; font-size:11px; font-weight:700; margin-top:6px; text-transform:uppercase; letter-spacing:.5px; }
        .section { margin-bottom:22px; }
        .section-title { font-size:11px; font-weight:700; color:#E55A11; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px; border-bottom:1px solid #e5e7eb; padding-bottom:6px; }
        .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }
        .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        .field { margin-bottom:8px; }
        .field-label { font-size:10px; color:#9ca3af; text-transform:uppercase; letter-spacing:.5px; margin-bottom:2px; }
        .field-value { font-size:13px; font-weight:500; color:#111; }
        table { width:100%; border-collapse:collapse; font-size:12px; }
        thead tr { background:#eff6ff; }
        th { text-align:left; padding:8px; border-bottom:2px solid #E55A11; font-size:10px; text-transform:uppercase; letter-spacing:.5px; color:#E55A11; font-weight:700; }
        td { padding:7px 8px; border-bottom:1px solid #f3f4f6; }
        .total-row td { background:#f9fafb; font-weight:700; }
        .grand-total td { background:#E55A11; color:#fff; font-size:14px; font-weight:700; padding:10px 8px; }
        .firma-section { display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px; margin-top:40px; }
        .firma-box { border-top:1px solid #333; padding-top:8px; text-align:center; font-size:11px; color:#6b7280; }
        .observ-box { background:#f9fafb; border-left:3px solid #E55A11; padding:10px 14px; font-size:12px; border-radius:4px; margin-top:6px; }
        @media print { body { padding:16px; } @page { margin:12mm; } }
      </style>
    </head><body>
      <div class="header">
        <div class="logo-wrap">
          <div class="logo-square">EB</div>
          <div>
            <div class="empresa">Expreso Biletta SRL</div>
            <div class="empresa-sub">Sistema de gestión de flota y taller</div>
          </div>
        </div>
        <div>
          <div class="doc-code">${escapeHtml(po.code)}</div>
          <div class="doc-sub">ORDEN DE COMPRA</div>
          <div class="doc-sub">Fecha: ${new Date(po.created_at).toLocaleDateString('es-AR')}</div>
          <div style="margin-top:6px;text-align:right">
            <span class="status-pill" style="${statusBadge}">${(OC_ESTADOS[po.status] && OC_ESTADOS[po.status].label) || (po.status||'').replace('_',' ')}</span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">📋 Datos del pedido</div>
        <div class="grid3">
          <div class="field"><div class="field-label">Sucursal</div><div class="field-value">${escapeHtml(po.sucursal||'—')}</div></div>
          <div class="field"><div class="field-label">Área</div><div class="field-value">${escapeHtml(po.area||'—')}</div></div>
          <div class="field"><div class="field-label">Prioridad</div><div class="field-value">${(()=>{const p=po.prioridad||'Normal';const c=p==='Urgente'?'#ef4444':p==='Media'?'#f59e0b':'var(--text)';const ic=p==='Urgente'?'🔴 ':p==='Media'?'🟡 ':'';return `<span style="color:${c};font-weight:${p==='Normal'?'400':'700'}">${ic}${p}</span>`;})()}</div></div>
          <div class="field"><div class="field-label">Solicitado por</div><div class="field-value">${po.solicitante_nombre||'—'}</div></div>
          <div class="field"><div class="field-label">Proveedor</div><div class="field-value">${escapeHtml(po.proveedor||'—')}</div></div>
          <div class="field"><div class="field-label">Vehículo asociado</div><div class="field-value">${escapeHtml(vehInfo.code || '—')}${vehInfo.plate ? ' ('+escapeHtml(vehInfo.plate)+')' : ''}</div></div>
          <div class="field"><div class="field-label">Moneda</div><div class="field-value">${po.moneda==="USD" ? "Dólares (USD)" : "Pesos (ARS)"}</div></div>
        </div>
      </div>

      ${po.factura_nro || po.factura_fecha || po.factura_monto ? `
      <div class="section">
        <div class="section-title">💰 Datos de facturación</div>
        <div class="grid3">
          <div class="field"><div class="field-label">Nº Factura</div><div class="field-value">${escapeHtml(po.factura_nro||'—')}</div></div>
          <div class="field"><div class="field-label">Fecha Factura</div><div class="field-value">${po.factura_fecha ? new Date(po.factura_fecha).toLocaleDateString('es-AR') : '—'}</div></div>
          <div class="field"><div class="field-label">Monto Factura</div><div class="field-value">${po.factura_monto ? '$'+parseFloat(po.factura_monto).toLocaleString('es-AR') : '—'}</div></div>
          <div class="field"><div class="field-label">IVA</div><div class="field-value">${po.iva_pct ? po.iva_pct+'%' : '—'}</div></div>
          <div class="field"><div class="field-label">Forma de pago</div><div class="field-value">${_ocFormaPagoLabel(po.forma_pago, po.cc_dias)}</div></div>
          <div class="field"><div class="field-label">Estado</div><div class="field-value">${(OC_ESTADOS[po.status] && OC_ESTADOS[po.status].label) || (po.status||'').replace('_',' ')}</div></div>
        </div>
      </div>
      ` : ''}

      <div class="section">
        <div class="section-title">🛒 Artículos solicitados</div>
        <table>
          <thead><tr>
            <th style="width:45%">Descripción</th>
            <th style="text-align:center">Cant.</th>
            <th style="text-align:center">Unidad</th>
            <th style="text-align:right">Precio unit.</th>
            <th style="text-align:right">Subtotal</th>
          </tr></thead>
          <tbody>
            ${po.items.map(i => `<tr>
              <td>${escapeHtml(i.descripcion)}</td>
              <td style="text-align:center">${parseFloat(i.cantidad)}</td>
              <td style="text-align:center">${escapeHtml(i.unidad||'un')}</td>
              <td style="text-align:right">$${parseFloat(i.precio_unit||0).toLocaleString('es-AR')}</td>
              <td style="text-align:right;font-weight:600">$${Math.round(parseFloat(i.cantidad||0) * parseFloat(i.precio_unit||0)).toLocaleString('es-AR')}</td>
            </tr>`).join('')}
            ${parseFloat(po.iva_pct||0) > 0 ? `
            <tr class="total-row">
              <td colspan="4" style="text-align:right">Subtotal neto</td>
              <td style="text-align:right">$${Math.round(totalReal).toLocaleString('es-AR')}</td>
            </tr>
            <tr class="total-row">
              <td colspan="4" style="text-align:right">IVA (${po.iva_pct}%)</td>
              <td style="text-align:right">$${ivaMonto.toLocaleString('es-AR')}</td>
            </tr>` : ''}
            <tr class="grand-total">
              <td colspan="4" style="text-align:right">TOTAL${parseFloat(po.iva_pct||0) > 0 ? ' CON IVA' : ''}</td>
              <td style="text-align:right">$${totalConIva.toLocaleString('es-AR')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      ${po.observaciones ? `
      <div class="section">
        <div class="section-title">📝 Observaciones</div>
        <div class="observ-box">${escapeHtml(po.observaciones)}</div>
      </div>
      ` : ''}

      <div class="section">
        <div class="section-title">🕐 Trazabilidad del proceso</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px">
          <thead>
            <tr style="background:#f3f4f6;border-bottom:2px solid #e5e7eb">
              <th style="padding:8px;text-align:left;font-weight:600;color:#374151">ETAPA</th>
              <th style="padding:8px;text-align:left;font-weight:600;color:#374151">RESPONSABLE</th>
              <th style="padding:8px;text-align:left;font-weight:600;color:#374151">FECHA</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:8px">Solicitó</td><td style="padding:8px"><b>${po.solicitante_nombre||'—'}</b></td><td style="padding:8px">${po.created_at ? new Date(po.created_at).toLocaleString('es-AR') : '—'}</td></tr>
            <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:8px">Tomó cotización</td><td style="padding:8px">${po.cotizador_nombre ? '<b>'+po.cotizador_nombre+'</b>' : '—'}</td><td style="padding:8px">${po.cotizado_at ? new Date(po.cotizado_at).toLocaleString('es-AR') : '—'}</td></tr>
            <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:8px">Aprobó compras</td><td style="padding:8px">${po.aprobador_nombre ? '<b>'+po.aprobador_nombre+'</b>' : '—'}</td><td style="padding:8px">${po.aprobado_compras_at ? new Date(po.aprobado_compras_at).toLocaleString('es-AR') : '—'}</td></tr>
            ${facturas.length ? (() => { const f1 = facturas.slice().sort((a,b) => new Date(a.uploaded_at) - new Date(b.uploaded_at))[0]; return `<tr style="border-bottom:1px solid #e5e7eb"><td style="padding:8px">Cargó factura</td><td style="padding:8px"><b>${escapeHtml(f1.uploaded_by_name||'—')}</b></td><td style="padding:8px">${f1.uploaded_at ? new Date(f1.uploaded_at).toLocaleString('es-AR') : '—'}</td></tr>`; })() : ''}
            <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:8px">Pagó tesorería</td><td style="padding:8px">${po.pagador_nombre ? '<b>'+po.pagador_nombre+'</b>' : '—'}</td><td style="padding:8px">${po.pagado_at ? new Date(po.pagado_at).toLocaleString('es-AR') : '—'}</td></tr>
            <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:8px">Recibió mercadería</td><td style="padding:8px">${po.receptor_nombre ? '<b>'+po.receptor_nombre+'</b>' : '—'}</td><td style="padding:8px">${po.recibido_at ? new Date(po.recibido_at).toLocaleString('es-AR') : '—'}</td></tr>
            ${po.status === 'rechazada' ? `<tr style="background:#fee2e2"><td style="padding:8px">Rechazada</td><td style="padding:8px"><b>${po.rechazador_nombre||'—'}</b></td><td style="padding:8px">${po.rechazado_at ? new Date(po.rechazado_at).toLocaleString('es-AR') : '—'}</td></tr>` : ''}
          </tbody>
        </table>
        ${po.motivo_devolucion ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;padding:8px 10px;margin-top:10px;font-size:11px"><b>⏪ Devuelta por:</b> ${escapeHtml(po.motivo_devolucion)}</div>` : ''}
        ${po.motivo_rechazo ? `<div style="background:#fee2e2;border:1px solid #ef4444;border-radius:4px;padding:8px 10px;margin-top:10px;font-size:11px"><b>❌ Motivo de rechazo:</b> ${escapeHtml(po.motivo_rechazo)}</div>` : ''}
        <div style="margin-top:12px;padding:10px;background:#eff6ff;border:1px solid #3b82f6;border-radius:4px;font-size:12px">
          <b>📍 Estado actual:</b> <span style="${statusBadge};padding:2px 8px;border-radius:4px;font-weight:700">${po.status.toUpperCase()}</span>
        </div>
      </div>

      ${recepciones.length ? `
      <div style="margin-top:24px;page-break-inside:avoid">
        <div style="font-size:13px;font-weight:700;color:#ea580c;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">📦 Recepciones (${recepciones.length})</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px">
          <thead><tr style="background:#fef3c7;border-bottom:2px solid #f59e0b">
            <th style="padding:6px;text-align:left">Fecha</th>
            <th style="padding:6px;text-align:left">Destino</th>
            <th style="padding:6px;text-align:left">Remito</th>
            <th style="padding:6px;text-align:left">Items</th>
            <th style="padding:6px;text-align:left">Por</th>
          </tr></thead>
          <tbody>
            ${recepciones.map(r => `<tr style="border-bottom:1px solid #e5e7eb">
              <td style="padding:6px">${new Date(r.received_at).toLocaleString('es-AR')}</td>
              <td style="padding:6px">${escapeHtml(r.destino || '—')}</td>
              <td style="padding:6px">${escapeHtml(r.remito_nro || '—')}</td>
              <td style="padding:6px">${(r.items||[]).map(it => `${escapeHtml(it.descripcion)}: ${parseFloat(it.cantidad).toFixed(2)} ${escapeHtml(it.unidad||'')}`).join(' · ')}</td>
              <td style="padding:6px">${escapeHtml(r.received_by_name || '—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}

      ${facturas.length ? `
      <div style="margin-top:24px;page-break-inside:avoid">
        <div style="font-size:13px;font-weight:700;color:#ea580c;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">📄 Facturas (${facturas.length})</div>
        ${facturas.map(f => {
          const pagos = pagosByFactura[f.id] || [];
          const neto = parseFloat(f.invoice_monto||0);
          const ivaPctF = parseFloat(f.iva_pct||0);
          const monto = parseFloat(f.invoice_total || f.total_a_pagar || 0) || Math.round((neto * (1 + ivaPctF / 100)) * 100) / 100;
          const pagado = parseFloat(f.monto_pagado||0);
          const saldo = monto - pagado;
          const venc = f.vencimiento ? new Date(f.vencimiento).toLocaleDateString('es-AR') : '—';
          return `
            <div style="border:1px solid #e5e7eb;border-radius:4px;padding:10px;margin-bottom:8px;font-size:11px;background:${f.pagada?'#dcfce7':'#fff'}">
              <div style="display:flex;justify-content:space-between;font-weight:600">
                <span>N° ${escapeHtml(f.invoice_nro)} · Total c/IVA $${monto.toLocaleString('es-AR',{minimumFractionDigits:2})}${f.pagada?' ✓ PAGADA':''}</span>
                <span style="color:#374151">Vence ${venc}</span>
              </div>
              <div style="color:#6b7280;margin-top:4px">Neto $${neto.toLocaleString('es-AR',{minimumFractionDigits:2})} · IVA ${ivaPctF}% · Fecha ${new Date(f.invoice_fecha).toLocaleDateString('es-AR')} · ${f.forma_pago||'—'}${f.cc_dias?' '+f.cc_dias+'d':''} · Cargada por ${escapeHtml(f.uploaded_by_name||'—')}</div>
              ${pagos.length ? `
                <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #e5e7eb">
                  ${pagos.map(p => {
                    let detalle = '';
                    if (p.metodo === 'transferencia') detalle = ` · ${escapeHtml(p.banco_origen||'')}→${escapeHtml(p.banco_destino||'')}`;
                    else if (p.metodo === 'cheque') detalle = ` · Cheque ${p.cheque_nro||''} ${p.cheque_banco||''}`;
                    else if (p.metodo === 'echeq') detalle = ` · eCheq ${p.echeq_nro||''}`;
                    else if (p.metodo === 'tarjeta') detalle = ` · Aprob ${p.tarjeta_aprobacion||''}`;
                    return `<div style="padding:2px 0;color:#166534">💰 $${parseFloat(p.monto).toLocaleString('es-AR',{minimumFractionDigits:2})} · ${p.metodo}${detalle} · ${new Date(p.paid_at).toLocaleDateString('es-AR')} (${escapeHtml(p.paid_by_name||'—')})</div>`;
                  }).join('')}
                </div>
              ` : '<div style="margin-top:4px;color:#92400e;font-style:italic">Sin pagos registrados</div>'}
            </div>
          `;
        }).join('')}
      </div>` : ''}

      <div class="firma-section" style="margin-top:32px">
        <div class="firma-box">Solicitado por<br><br><br></div>
        <div class="firma-box">Autorizado por<br><br><br></div>
        <div class="firma-box">Recibido / Conforme<br><br><br></div>
      </div>

      <div style="margin-top:32px;font-size:10px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;padding-top:10px">
        Expreso Biletta SRL · Orden de Compra ${escapeHtml(po.code)} · Generado el ${nowDateAR()} ${nowTimeAR()}
      </div>
    </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 500);
  } catch(err) { showToast('error', err.message); }
}


// funciones auxiliares OC
function getPODetailExtraFields() {
  var tipo = document.getElementById('pod-tipo')?.value || 'flota';
  var out = { tipo };

  // Forma de pago, días CC, moneda (los selects del modal detalle usan prefix 'pod-')
  var fpEl = document.getElementById('pod-forma-pago');
  var ccEl = document.getElementById('pod-cc-dias');
  var monEl = document.getElementById('pod-moneda');
  if (fpEl) {
    out.forma_pago = fpEl.value || null;
    if (out.forma_pago === 'cuenta_corriente' || out.forma_pago === 'cheque' || out.forma_pago === 'echeq') {
      out.cc_dias = (ccEl && ccEl.value !== '') ? parseInt(ccEl.value, 10) : null;
    } else {
      out.cc_dias = null;
    }
  }
  if (monEl) {
    out.moneda = monEl.value || 'ARS';
  }

  // Campos extra solo para tipos edilicio/otro
  if (tipo !== 'flota') {
    var prefix = 'pod-x';
    out.urgencia       = document.getElementById(prefix+'-urgencia')?.value || 'normal';
    out.local_sector   = document.getElementById(prefix+'-local')?.value?.trim() || null;
    out.sector_detalle = document.getElementById(prefix+'-sector')?.value || null;
    out.equipo         = document.getElementById(prefix+'-equipo')?.value?.trim() || null;
    out.activo_serie   = document.getElementById(prefix+'-serie')?.value?.trim() || null;
    out.problema_desc  = document.getElementById(prefix+'-problema')?.value?.trim() || null;
  }

  return out;
}

function updatePOAreaSelect() {
  var suc    = document.getElementById('po-sucursal')?.value || '';
  var sel    = document.getElementById('po-area');
  if (!sel) return;
  var areas  = (App.config?.areas || {})[suc] || [];
  sel.innerHTML = areas.length
    ? '<option value="">— Seleccioná el área —</option>' + areas.map(function(a){ return '<option value="'+a+'">'+a+'</option>'; }).join('')
    : '<option value="">— Sin áreas configuradas —</option>';
}

function setPOTipo(tipo) {
  window._poTipo = tipo;
  ['flota','mantenimiento','otro'].forEach(function(t) {
    var btn = document.getElementById('po-tipo-' + t);
    if (!btn) return;
    var active = t === tipo;
    btn.style.background   = active ? 'var(--accent)' : 'transparent';
    btn.style.color        = active ? 'white' : 'var(--text3)';
    btn.style.borderColor  = active ? 'var(--accent)' : 'var(--border2)';
  });
  // Mostrar selector de vehículo solo en tipo Flota
  var vehField = document.getElementById('po-vehicle-field');
  if (vehField) vehField.style.display = tipo === 'flota' ? '' : 'none';
  renderPOExtraFields(tipo, 'po-extra-fields');
}

// (legacy) recibirOC()/POST /recibir eliminados: la recepción es por la vía granular con historial.

function setPODetailTipo(tipo) {
  var hidden = document.getElementById('pod-tipo');
  if (hidden) hidden.value = tipo;
  ['flota','mantenimiento','otro'].forEach(function(t) {
    var btn = document.getElementById('pod-tipo-' + t);
    if (!btn) return;
    var active = t === tipo;
    btn.style.background   = active ? 'var(--accent)' : 'transparent';
    btn.style.color        = active ? 'white' : 'var(--text3)';
    btn.style.borderColor  = active ? 'var(--accent)' : 'var(--border2)';
  });
  renderPOExtraFields(tipo, 'pod-extra-fields');
}

// ══════════════════════════════════════════════════
//  HELPERS: edición inline de artículos en el modal detalle
// ══════════════════════════════════════════════════

// Contador global para ids únicos (se reinicia cada vez que abre el modal)
window._podItemNextIdx = 0;

// Construye una fila de artículo editable inline
function buildPODetailItemRow(idx, item) {
  item = item || {};
  const desc  = (item.descripcion || '').replace(/"/g, '&quot;');
  const qty   = parseFloat(item.cantidad || 1);
  const unit  = (item.unidad || 'un').replace(/"/g, '&quot;');
  const price = parseFloat(item.precio_unit || 0);
  const sub   = Math.round(qty * price);
  // Actualizar contador
  if (idx >= (window._podItemNextIdx || 0)) window._podItemNextIdx = idx + 1;
  const stockItemId = (item.stock_item_id || '').replace(/"/g, '&quot;');
  const woPartId = (item.work_order_part_id || '').replace(/"/g, '&quot;');
  // Selector de proveedor por ítem — solo para OCs consolidadas de una OT.
  let supRow = '';
  if (window._podFromOT) {
    const sel = item.supplier_id || '';
    const opts = (App.data.suppliers || [])
      .filter(s => s.status !== 'blacklist')
      .map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${escapeHtml(s.name)}</option>`)
      .join('');
    supRow = `<div style="grid-column:1 / -1;display:flex;align-items:center;gap:6px;margin-top:2px">
      <span style="font-size:11px;color:var(--text3);white-space:nowrap">🏢 Proveedor:</span>
      <select class="form-select" id="podi-sup-${idx}" style="font-size:12px;flex:1;max-width:360px;padding:3px 6px">
        <option value="">— Sin asignar —</option>${opts}
      </select>
    </div>`;
  }
  return `<div id="podi-row-${idx}" data-stock-item-id="${stockItemId}" data-work-order-part-id="${woPartId}" style="display:grid;grid-template-columns:1fr 70px 65px 110px 100px 30px;gap:6px;margin-bottom:6px;align-items:center">
    <input class="form-input" id="podi-desc-${idx}" value="${desc}" placeholder="Descripción" style="font-size:12px" oninput="updatePODetailItemsTotal()">
    <input class="form-input" type="number" id="podi-qty-${idx}" value="${qty}" min="0.01" step="0.01" style="font-size:12px;text-align:center" oninput="updatePODetailItemsTotal()">
    <input class="form-input" id="podi-unit-${idx}" value="${unit}" style="font-size:12px;text-align:center" oninput="updatePODetailItemsTotal()">
    <input class="form-input" type="number" id="podi-price-${idx}" value="${price}" min="0" step="0.01" style="font-size:12px;text-align:right" oninput="updatePODetailItemsTotal()">
    <div id="podi-sub-${idx}" style="font-size:12px;text-align:right;font-family:monospace;color:var(--text2);padding:4px 8px">$${sub.toLocaleString('es-AR')}</div>
    <button onclick="removePODetailItem(${idx})" title="Quitar"
      style="background:none;border:1px solid var(--border2);border-radius:6px;cursor:pointer;color:var(--danger);font-size:14px;padding:0;width:28px;height:28px">✕</button>
    ${supRow}
  </div>`;
}

// Agregar nuevo artículo vacío al final
function addPODetailItem() {
  const container = document.getElementById('pod-items-container');
  if (!container) return;
  const idx = window._podItemNextIdx || 0;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildPODetailItemRow(idx, {});
  container.appendChild(wrapper.firstElementChild);
  window._podItemNextIdx = idx + 1;
  // Focus en la descripción nueva
  setTimeout(() => { document.getElementById('podi-desc-' + idx)?.focus(); }, 50);
  updatePODetailItemsTotal();
}

// Quitar un artículo
function removePODetailItem(idx) {
  const el = document.getElementById('podi-row-' + idx);
  if (!el) return;
  // Validar que quede al menos uno
  const container = document.getElementById('pod-items-container');
  if (container && container.children.length <= 1) {
    showToast('warn', 'Debe haber al menos un artículo');
    return;
  }
  el.remove();
  updatePODetailItemsTotal();
}

// Leer todos los items desde los inputs del modal (para guardar)
function readPODetailItems() {
  const items = [];
  document.querySelectorAll('[id^="podi-desc-"]').forEach(descEl => {
    const idx = descEl.id.replace('podi-desc-', '');
    const desc = (descEl.value || '').trim();
    if (!desc) return; // descartar items sin descripción
    const rowEl = document.getElementById('podi-row-' + idx);
    items.push({
      descripcion: desc,
      cantidad:    parseFloat(document.getElementById('podi-qty-'   + idx)?.value) || 1,
      unidad:                 document.getElementById('podi-unit-'  + idx)?.value || 'un',
      precio_unit: parseFloat(document.getElementById('podi-price-' + idx)?.value) || 0,
      stock_item_id: rowEl?.dataset?.stockItemId || null,
      work_order_part_id: rowEl?.dataset?.workOrderPartId || null,
      supplier_id: document.getElementById('podi-sup-' + idx)?.value || null
    });
  });
  return items;
}

// Recalcular subtotales de cada item + totales generales en vivo
function updatePODetailItemsTotal() {
  let subtotal = 0;
  document.querySelectorAll('[id^="podi-qty-"]').forEach(qtyEl => {
    const idx = qtyEl.id.replace('podi-qty-', '');
    const qty   = parseFloat(qtyEl.value) || 0;
    const price = parseFloat(document.getElementById('podi-price-' + idx)?.value) || 0;
    const sub   = Math.round(qty * price);
    subtotal += sub;
    const subEl = document.getElementById('podi-sub-' + idx);
    if (subEl) subEl.textContent = '$' + sub.toLocaleString('es-AR');
  });
  // Actualizar totales generales
  const subDisplay = document.getElementById('pod-subtotal-display');
  if (subDisplay) {
    const isUSD = (subDisplay.textContent || '').startsWith('US$');
    const prefix = isUSD ? 'US$' : '$';
    subDisplay.textContent = prefix + subtotal.toLocaleString('es-AR');
  }
  // Recalcular IVA y total con el IVA actual
  const ivaPct = parseFloat(document.getElementById('pod-iva-pct')?.value || 0);
  const ivaMonto = Math.round(subtotal * ivaPct / 100);
  const total = Math.round(subtotal * (1 + ivaPct / 100));
  const ivaMontoEl = document.getElementById('pod-iva-row-monto');
  const totEl = document.getElementById('pod-total-display');
  const ivaLabelEl = document.getElementById('pod-iva-row-label');
  if (ivaLabelEl) ivaLabelEl.textContent = `IVA (${ivaPct}%)`;
  const prefix2 = (totEl && totEl.textContent.startsWith('US$')) ? 'US$' : '$';
  if (ivaMontoEl) ivaMontoEl.textContent = prefix2 + ivaMonto.toLocaleString('es-AR');
  if (totEl) totEl.textContent = prefix2 + total.toLocaleString('es-AR');

  // 🔄 Auto-actualizar el monto de la factura con el total (subtotal + IVA)
  // Solo si el usuario no lo está editando manualmente (se respeta si ya puso un valor custom)
  const montoFacturaEl = document.getElementById('pod-factura-monto');
  if (montoFacturaEl && !montoFacturaEl.readOnly) {
    // Solo auto-actualizar si el campo está vacío, en 0, o si el valor actual coincide con el total anterior
    const valorActual = parseFloat(montoFacturaEl.value) || 0;
    const autoTotal = total;
    // Si no fue editado manualmente (coincide con el total anterior o está vacío) → actualizar
    if (!montoFacturaEl.dataset.manualEdit) {
      montoFacturaEl.value = autoTotal;
    }
  }
}

function setPODetailIva(val) {
  const pct = val === '21%' ? 21 : val === '10.5%' ? 10.5 : 0;
  const hidden = document.getElementById('pod-iva-pct');
  if (hidden) hidden.value = pct;
  ['Sin IVA','10.5%','21%'].forEach(v => {
    const btn = document.getElementById('pod-iva-btn-' + v);
    if (!btn) return;
    btn.style.background = v === val ? 'var(--accent)' : 'transparent';
    btn.style.color      = v === val ? 'white' : 'var(--text3)';
  });

  // Si hay inputs de items (modo editable), recalcular desde los inputs reales
  // Si no, usa el texto del subtotal como fuente
  const hayInputsItems = document.querySelector('[id^="podi-qty-"]') != null;
  if (hayInputsItems) {
    // Delegamos a updatePODetailItemsTotal que ya hace todo bien
    updatePODetailItemsTotal();
    return;
  }

  // Modo lectura: leer del texto del display
  const subEl = document.getElementById('pod-subtotal-display');
  const ivaRowEl = document.getElementById('pod-iva-row');
  const ivaRowLabelEl = document.getElementById('pod-iva-row-label');
  const ivaRowMontoEl = document.getElementById('pod-iva-row-monto');
  const totEl = document.getElementById('pod-total-display');
  if (!subEl || !totEl) return;

  const subTxt = subEl.textContent || '';
  const isUSD = subTxt.startsWith('US$');
  const prefix = isUSD ? 'US$' : '$';
  const limpio = subTxt.replace(/US\$|\$/g, '').replace(/\./g,'').replace(',','.').trim();
  const subNum = parseFloat(limpio) || 0;
  const ivaMonto = Math.round(subNum * pct / 100);
  const total = Math.round(subNum * (1 + pct/100));

  if (ivaRowEl) ivaRowEl.style.opacity = pct === 0 ? '.4' : '1';
  if (ivaRowLabelEl) ivaRowLabelEl.textContent = `IVA (${pct}%)`;
  if (ivaRowMontoEl) ivaRowMontoEl.textContent = prefix + ivaMonto.toLocaleString('es-AR');
  totEl.textContent = prefix + total.toLocaleString('es-AR');
}

function updatePODetailAreaSelect() {
  var suc   = document.getElementById('pod-sucursal')?.value || '';
  var sel   = document.getElementById('pod-area');
  if (!sel) return;
  var areas = (App.config?.areas || {})[suc] || [];
  var cur   = sel.value;
  sel.innerHTML = '<option value="">— Sin área —</option>'
    + areas.map(function(a){ return '<option value="'+a+'"'+(a===cur?' selected':'')+'>'+a+'</option>'; }).join('');
}

function searchPOStock(idx) {
  updatePOTotal();
  var val = (document.getElementById('poi-desc-'+idx)?.value || '').trim().toLowerCase();
  var sug = document.getElementById('poi-suggestions-'+idx);
  if (!sug) return;
  if (!val || val.length < 2) { sug.style.display = 'none'; return; }

  // Si el usuario modificó el texto después de elegir del stock, se desvincula
  const descInput = document.getElementById('poi-desc-'+idx);
  if (descInput && descInput.dataset.stockLinked === 'true') {
    const prevName = descInput.dataset.stockName || '';
    if (descInput.value.trim() !== prevName) {
      descInput.dataset.stockId = '';
      descInput.dataset.stockLinked = 'false';
      const hint = document.getElementById('poi-stock-hint-'+idx);
      if (hint) hint.style.display = 'none';
    }
  }

  var stock = App.data.stock || [];
  var matches = stock.filter(function(s) {
    return (s.name||'').toLowerCase().includes(val) || (s.code||'').toLowerCase().includes(val);
  }).slice(0, 8);

  if (!matches.length) { sug.style.display = 'none'; return; }

  sug.innerHTML = matches.map(function(s) {
    var sucLabel = s.sucursal ? '<span style="color:var(--accent);font-size:10px;margin-left:6px">['+s.sucursal+']</span>' : '';
    var critColor = s.is_critical ? 'var(--danger)' : 'var(--text3)';
    return '<div onclick="selectPOStockItem('+idx+',\''+s.id+'\',\''+s.name.replace(/'/g,"\\'").replace(/"/g,'&quot;')+'\',\''+s.unit+'\','+parseFloat((s.unit_cost ?? s.cost) || 0)+','+parseFloat((s.qty_current ?? s.qty) || 0)+')"'
      +' style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center"'
      +' onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'">'
      +'<div><span style="font-weight:600">'+s.name+'</span>'
      +'<span style="color:var(--text3);margin-left:8px;font-family:monospace;font-size:11px">'+s.code+'</span>'
      +sucLabel+'</div>'
      +'<div style="text-align:right">'
      +'<div style="font-weight:700;color:var(--accent)">$'+Math.round((s.unit_cost ?? s.cost) || 0).toLocaleString('es-AR')+'/'+s.unit+'</div>'
      +'<div style="font-size:10px;color:'+critColor+'">Stock: '+parseFloat((s.qty_current ?? s.qty) || 0)+' '+s.unit+'</div>'
      +'</div></div>';
  }).join('');
  sug.style.display = 'block';
}

// Cuando el usuario elige un ítem del autocompletado, lo vinculamos al artículo de la OC
function selectPOStockItem(idx, stockId, name, unit, unitCost, qtyCurrent) {
  const descEl  = document.getElementById('poi-desc-' + idx);
  const unitEl  = document.getElementById('poi-unit-' + idx);
  const priceEl = document.getElementById('poi-price-' + idx);
  const sugEl   = document.getElementById('poi-suggestions-' + idx);
  const hintEl  = document.getElementById('poi-stock-hint-' + idx);
  const qtyHintEl = document.getElementById('poi-stock-qty-' + idx);

  if (descEl) {
    descEl.value = name;
    // Guardar el stock_item_id en un dataset para recuperarlo al enviar el form
    descEl.dataset.stockId = stockId;
    descEl.dataset.stockLinked = 'true';
    descEl.dataset.stockName = name;
    // Indicador visual: borde verde si está vinculado al stock
    descEl.style.borderLeft = '3px solid var(--ok)';
  }
  if (unitEl && unit)   unitEl.value = unit;
  if (priceEl && unitCost) priceEl.value = parseFloat(unitCost).toFixed(2);
  if (sugEl)  sugEl.style.display = 'none';
  if (hintEl) hintEl.style.display = 'block';
  if (qtyHintEl) qtyHintEl.textContent = `${parseFloat(qtyCurrent)} ${unit} · vinculado al stock ✓`;

  updatePOTotal();
  if (typeof showToast === 'function') {
    showToast('ok', `Vinculado al stock: ${name}`);
  }
}

async function openSucursalesConfigModal() {
  // Refrescar lista de sucursales desde la API
  try { await loadSucursalesFromAPI(true); } catch(e) {}
  window._sucList = (App.config?.bases || []).slice();
  renderSucursalesModalBody();
  openModal('🏢 Sucursales', '<div id="suc-modal-body"></div>', [
    { label: 'Cerrar', cls: 'btn-secondary', fn: closeModal },
  ]);
  setTimeout(renderSucursalesModalBody, 0);
}

function renderSucursalesModalBody() {
  const body = document.getElementById('suc-modal-body');
  if (!body) return;
  const bases = window._sucList || [];
  const optsDest = (i) => bases.map((b, j) => j === i ? '' : `<option value="${j}">${stockFormValue(b)}</option>`).join('');
  const rows = bases.map((n, i) => `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;background:var(--bg3);padding:8px 10px;border-radius:8px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px;font-weight:600">${stockFormValue(n)}</div>
      <select class="form-select" id="suc-dest-${i}" style="max-width:220px;font-size:12px">
        <option value="">— mover registros a… —</option>${optsDest(i)}
      </select>
      <button class="btn btn-danger btn-sm" onclick="quitarSucursal(${i})">✕ Quitar y migrar</button>
    </div>`).join('') || '<div style="color:var(--text3);padding:10px">No hay sucursales cargadas.</div>';

  body.innerHTML = `
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Al quitar una sucursal, sus registros (stock, OCs, usuarios, etc.) se mueven a la sucursal destino que elijas. No se borra nada: la sucursal queda desactivada.</div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <input class="form-input" id="suc-nueva" placeholder="Nombre de nueva sucursal" style="flex:1">
      <button class="btn btn-primary" onclick="nuevaSucursal()">+ Agregar</button>
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Sucursales actuales</div>
    ${rows}`;
}

async function nuevaSucursal() {
  const input = document.getElementById('suc-nueva');
  const nombre = (input?.value || '').trim();
  if (!nombre) { showToast('warn', 'Escribí el nombre de la sucursal'); return; }
  try {
    const res = await apiFetch('/api/sucursales', { method: 'POST', body: JSON.stringify({ nombre }) });
    if (!res.ok) { const e = await res.json().catch(()=>({})); showToast('error', e.error || 'Error al crear'); return; }
    showToast('ok', `Sucursal "${nombre}" agregada`);
    await loadSucursalesFromAPI(true);
    window._sucList = (App.config?.bases || []).slice();
    renderSucursalesModalBody();
  } catch(e) { showToast('error', 'Error al crear sucursal'); }
}

async function quitarSucursal(i) {
  const bases = window._sucList || [];
  const de = bases[i];
  const destSel = document.getElementById('suc-dest-' + i);
  const destIdx = destSel?.value;
  if (destIdx === '' || destIdx == null) { showToast('warn', 'Elegí a qué sucursal mover los registros'); return; }
  const a = bases[parseInt(destIdx, 10)];
  if (!a || a === de) { showToast('warn', 'El destino debe ser distinto'); return; }
  if (!confirm(`¿Quitar "${de}" y mover todos sus registros a "${a}"?\n\nLa sucursal "${de}" quedará desactivada.`)) return;
  try {
    const res = await apiFetch('/api/sucursales/migrar', { method: 'POST', body: JSON.stringify({ de, a }) });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) { showToast('error', data.error || 'Error al migrar'); return; }
    const m = data.movidos || {};
    showToast('ok', `"${de}" migrada a "${a}" (${(m.items_stock||0)} ítems, ${(m.ordenes_compra||0)} OCs, ${(m.usuarios||0)} usuarios)`);
    await loadSucursalesFromAPI(true);
    window._sucList = (App.config?.bases || []).slice();
    renderSucursalesModalBody();
    if (typeof loadInitialData === 'function') loadInitialData();
  } catch(e) { showToast('error', 'Error al migrar la sucursal'); }
}

async function openAreasConfigModal() {
  var bases = App.config?.bases || [];
  var areas = App.config?.areas || {};

  var rows = bases.map(function(suc) {
    var sucAreas = (areas[suc] || []).join(', ');
    return '<div class="form-group">'
      +'<label class="form-label" style="font-weight:700">'+suc+'</label>'
      +'<input class="form-input" id="areas-'+suc.replace(/\s+/g,'_')+'" value="'+sucAreas+'" '
      +'placeholder="Ej: Flota, Mantenimiento edilicio, Administración" style="font-size:13px">'
      +'<div style="font-size:11px;color:var(--text3);margin-top:3px">Separar las áreas con comas</div>'
      +'</div>';
  }).join('');

  openModal('⚙️ Configurar áreas por sucursal', rows, [
    { label:'Cancelar',          cls:'btn-secondary', fn: closeModal },
    { label:'Guardar áreas',     cls:'btn-primary',   fn: saveAreasConfig },
  ]);
}

// Guardar configuración de áreas por sucursal
async function saveAreasConfig() {
  var bases = App.config?.bases || [];
  var newAreas = {};

  // Leer inputs de cada sucursal
  bases.forEach(function(suc) {
    var input = document.getElementById('areas-' + suc.replace(/\s+/g,'_'));
    if (!input) return;
    var raw = (input.value || '').trim();
    if (!raw) { newAreas[suc] = []; return; }
    // Separar por coma y limpiar espacios/duplicados
    var list = raw.split(',')
      .map(function(a){ return a.trim(); })
      .filter(function(a){ return a.length > 0; });
    // Eliminar duplicados manteniendo orden
    var seen = {};
    newAreas[suc] = list.filter(function(a){
      var k = a.toLowerCase();
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  });

  try {
    var res = await apiFetch('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ areas: newAreas })
    });
    if (!res.ok) {
      var e = await res.json().catch(function(){ return {}; });
      showToast('error', e.error || 'Error al guardar áreas');
      return;
    }
    // Actualizar config local
    App.config = App.config || {};
    App.config.areas = newAreas;
    closeModal();
    showToast('ok', 'Áreas por sucursal actualizadas');
    await afterSave();
  } catch(err) {
    showToast('error', err.message || 'Error al guardar');
  }
}

/* ═══════════════════════════════════════════════════════════
   OC EXTRAS v1 — forma de pago, cc_dias, moneda + sucursales API
   ═══════════════════════════════════════════════════════════ */

async function loadSucursalesFromAPI(force) {
  try {
    // Evita pedir sucursales cada vez que se abre la solapa de OC.
    // Las sucursales/áreas cambian poco y este cache mejora la apertura de la pantalla.
    const now = Date.now();
    if (!force && App._sucursalesCacheAt && (now - App._sucursalesCacheAt) < 5 * 60 * 1000 && App.config?.bases?.length) {
      return;
    }

    const res = await apiFetch('/api/sucursales');
    if (!res || res.ok === false) return;
    const rows = await res.json();
    if (Array.isArray(rows) === false) return;
    App.config = App.config || {};
    App.config.bases = rows.map(function(r){ return r.nombre; });
    App.config.areas = {};
    rows.forEach(function(r){
      App.config.areas[r.nombre] = Array.isArray(r.areas) ? r.areas : [];
    });
    App._sucursalesCacheAt = now;
  } catch(e) { console.warn('loadSucursalesFromAPI', e); }
}


async function devolverOC(id, estadoActual) {
  const role = App.currentUser?.role;
  const titulo = role === 'compras'
    ? 'Motivo del rechazo parcial / devolución para corregir:'
    : 'Motivo de la devolución:';
  const motivo = prompt(titulo);
  if (!motivo || motivo.trim().length < 5) {
    if (motivo !== null) showToast('error', 'Indicá un motivo de al menos 5 caracteres');
    return;
  }
  try {
    const res = await apiFetch('/api/purchase-orders/' + id + '/devolver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: motivo.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al devolver OC');
    showToast('ok', role === 'compras' ? 'OC devuelta para corregir' : 'OC devuelta');
    closeModal();
    await renderPurchaseOrders();
  } catch(err) {
    showToast('error', err.message);
  }
}

async function rechazarOC(id) {
  const role = App.currentUser?.role;
  const aviso = role === 'compras'
    ? 'Vas a ANULAR esta compra de forma final. No se podrá seguir avanzando.\n\nMotivo:'
    : 'Vas a rechazar esta OC de forma final.\n\nMotivo:';
  const motivo = prompt(aviso);
  if (!motivo || motivo.trim().length < 5) {
    if (motivo !== null) showToast('error', 'Indicá un motivo de al menos 5 caracteres');
    return;
  }
  try {
    const res = await apiFetch('/api/purchase-orders/' + id + '/rechazar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: motivo.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al rechazar OC');
    showToast('ok', role === 'compras' ? 'Compra anulada' : 'OC rechazada');
    closeModal();
    await renderPurchaseOrders();
  } catch(err) {
    showToast('error', err.message);
  }
}

function _ocFormaPagoLabel(fp, ccDias) {
  if (fp === 'contado') return 'Contado';
  if (fp === 'cuenta_corriente') return 'Cuenta corriente a ' + (ccDias || 0) + ' días';
  if (fp === 'transferencia') return 'Transferencia';
  if (fp === 'cheque') return ccDias ? 'Cheque a ' + ccDias + ' días' : 'Cheque';
  if (fp === 'echeq')  return ccDias ? 'E-cheq a ' + ccDias + ' días' : 'E-cheq';
  return '—';
}

function _ocToggleCC(prefix) {
  var sel = document.getElementById(prefix + '-forma-pago');
  var fld = document.getElementById(prefix + '-cc-dias-field');
  if (sel == null || fld == null) return;
  // El plazo en días aplica a cuenta corriente, cheque y e-cheq.
  var conPlazo = (sel.value === 'cuenta_corriente' || sel.value === 'cheque' || sel.value === 'echeq');
  fld.style.display = conPlazo ? '' : 'none';
  var lbl = document.getElementById(prefix + '-cc-dias-label');
  if (lbl != null) {
    lbl.textContent = (sel.value === 'cheque') ? 'Días del cheque'
                    : (sel.value === 'echeq')  ? 'Días del e-cheq'
                    : 'Días CC';
  }
}

function _ocExtrasHTML(prefix, values) {
  values = values || {};
  var fp  = values.forma_pago || '';
  var ccd = (values.cc_dias == null) ? '' : values.cc_dias;
  var mon = values.moneda || 'ARS';
  var ccDisplay = (fp === 'cuenta_corriente' || fp === 'cheque' || fp === 'echeq') ? '' : 'display:none';
  var ccLabel   = (fp === 'cheque') ? 'Días del cheque' : (fp === 'echeq') ? 'Días del e-cheq' : 'Días CC';
  var html = ''
    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">'
    +   '<div class="form-group">'
    +     '<label class="form-label">Forma de pago</label>'
    +     '<select class="form-select" id="' + prefix + '-forma-pago" onchange="_ocToggleCC(\'' + prefix + '\')">'
    +       '<option value="">-- Seleccionar --</option>'
    +       '<option value="contado">Contado</option>'
    +       '<option value="cuenta_corriente">Cuenta corriente</option>'
    +       '<option value="transferencia">Transferencia</option>'
    +       '<option value="cheque">Cheque</option>'
    +       '<option value="echeq">E-cheq</option>'
    +     '</select>'
    +   '</div>'
    +   '<div class="form-group" id="' + prefix + '-cc-dias-field" style="' + ccDisplay + '">'
    +     '<label class="form-label" id="' + prefix + '-cc-dias-label">' + ccLabel + '</label>'
    +     '<input class="form-input" type="number" min="0" step="1" id="' + prefix + '-cc-dias" value="' + ccd + '" placeholder="30">'
    +   '</div>'
    +   '<div class="form-group">'
    +     '<label class="form-label">Moneda</label>'
    +     '<select class="form-select" id="' + prefix + '-moneda">'
    +       '<option value="ARS">Pesos (ARS)</option>'
    +       '<option value="USD">Dolares (USD)</option>'
    +     '</select>'
    +   '</div>'
    + '</div>';
  setTimeout(function(){
    var sel1 = document.getElementById(prefix + '-forma-pago');
    var sel2 = document.getElementById(prefix + '-moneda');
    if (sel1 != null) sel1.value = fp;
    if (sel2 != null) sel2.value = mon;
  }, 0);
  return html;
}

function renderPOExtraFields(tipo, containerId) {
  var el = document.getElementById(containerId);
  if (el == null) return;
  var prefix = (containerId === 'pod-extra-fields') ? 'pod' : 'po';
  var vals = window._ocEditValues || {};
  el.style.display = '';
  el.innerHTML = _ocExtrasHTML(prefix, vals);
}

function getPOExtraFields() {
  // Datos de pago (siempre presentes)
  var fp  = document.getElementById('po-forma-pago');
  var ccd = document.getElementById('po-cc-dias');
  var mon = document.getElementById('po-moneda');
  var out = {
    forma_pago: fp ? (fp.value || null) : null,
    moneda:     mon ? (mon.value || 'ARS') : 'ARS'
  };
  if (out.forma_pago === 'cuenta_corriente' || out.forma_pago === 'cheque' || out.forma_pago === 'echeq') {
    out.cc_dias = (ccd && ccd.value !== '') ? parseInt(ccd.value, 10) : null;
  } else {
    out.cc_dias = null;
  }
  
  // Datos de tipo de OC (solo si es edilicio u otro)
  var tipo = window._poTipo || 'flota';
  if (tipo !== 'flota') {
    var prefix = 'po-x';
    out.tipo           = tipo;
    out.urgencia       = document.getElementById(prefix+'-urgencia')?.value || 'normal';
    out.local_sector   = document.getElementById(prefix+'-local')?.value?.trim() || null;
    out.sector_detalle = document.getElementById(prefix+'-sector')?.value || null;
    out.equipo         = document.getElementById(prefix+'-equipo')?.value?.trim() || null;
    out.activo_serie   = document.getElementById(prefix+'-serie')?.value?.trim() || null;
    out.problema_desc  = document.getElementById(prefix+'-problema')?.value?.trim() || null;
  }
  
  return out;
}

/* FIN OC EXTRAS v1 */
/* --- OC WORKFLOW ACTIONS v2 — 6 estados nuevos --- */

// COMPRAS marca la OC como enviada al proveedor (paso obligatorio antes de pagar/recibir)
async function marcarEnviadaOC(id) {
  if (!confirm('¿Confirmás que esta OC se envió al proveedor? Recién después se podrá pagar o recibir.')) return;
  try {
    const r = await apiFetch('/api/purchase-orders/' + id + '/marcar-enviada', { method: 'POST' });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error al marcar enviada'); return; }
    showToast('ok', '📤 OC marcada como enviada al proveedor');
    closeModal();
    await loadPOList();
  } catch(err) { showToast('error', err.message || 'Error'); }
}

// Cierre manual de la OC (terminal). Sobre todo para OC abiertas / servicios.
async function cerrarOC(id) {
  if (!confirm('¿Cerrar esta OC? Queda en estado final "cerrada" y no se podrá seguir operando sobre ella.')) return;
  try {
    const r = await apiFetch('/api/purchase-orders/' + id + '/cerrar', { method: 'POST' });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error al cerrar OC'); return; }
    showToast('ok', '🔒 OC cerrada');
    closeModal();
    await loadPOList();
  } catch(err) { showToast('error', err.message || 'Error'); }
}

// Reabrir una OC cerrada (dueño/gerencia) para poder corregir.
async function reabrirOC(id) {
  if (!confirm('¿Reabrir esta OC cerrada? Se habilitará para corregir recepciones, facturas o pagos según corresponda. Si pago y entrega siguen completos, se volverá a cerrar sola.')) return;
  try {
    const r = await apiFetch('/api/purchase-orders/' + id + '/reabrir', { method: 'POST' });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error al reabrir OC'); return; }
    showToast('ok', '🔓 OC reabierta');
    closeModal();
    await loadPOList();
  } catch(err) { showToast('error', err.message || 'Error'); }
}

// COMPRAS toma la OC para empezar a cotizar
async function tomarCotizacionOC(id) {
  if (!confirm('¿Tomar esta OC para cotizar? Quedará marcada como "en cotización".')) return;
  try {
    const r = await apiFetch('/api/purchase-orders/' + id + '/tomar-cotizacion', { method: 'POST' });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error al tomar la OC'); return; }
    showToast('ok', '🔎 OC tomada para cotizar');
    closeModal();
    await loadPOList();
  } catch(err) { showToast('error', err.message || 'Error'); }
}

// COMPRAS aprueba con precios cargados y proveedor elegido
// Usa los campos que ya hay en el modal de detalle (proveedor, forma_pago, cc_dias, moneda, iva_pct)
async function aprobarOC(id) {
  // Leer los datos actuales del modal
  const pod_prov_el = document.getElementById('pod-proveedor');
  const pod_prov = pod_prov_el ? (pod_prov_el.value.trim() || null) : null;
  const pod_iva_el = document.getElementById('pod-iva-pct');
  const pod_iva = pod_iva_el ? parseFloat(pod_iva_el.value) : null;

  // Datos de factura (compras los carga al aprobar — ya le llegó del proveedor)
  const fnEl = document.getElementById('pod-factura-nro');
  const ffEl = document.getElementById('pod-factura-fecha');
  const fmEl = document.getElementById('pod-factura-monto');
  const pod_fact_nro = fnEl ? (fnEl.value.trim() || null) : null;
  const pod_fact_fch = ffEl ? (ffEl.value || null) : null;
  const pod_fact_mnt = fmEl ? (fmEl.value || null) : null;

  // Forma de pago y moneda vienen del helper
  let pod_fp = null, pod_cc = null, pod_mon = 'ARS';
  try {
    const extra = (typeof getPODetailExtraFields === 'function') ? getPODetailExtraFields() : {};
    if (extra.forma_pago) pod_fp = extra.forma_pago;
    if (extra.cc_dias != null) pod_cc = extra.cc_dias;
    if (extra.moneda) pod_mon = extra.moneda;
  } catch(e) {}

  // Validaciones obligatorias — solo proveedor (la factura la carga proveedores luego)
  if (!pod_prov) {
    showToast('warn', '⚠️ Tenés que seleccionar el proveedor antes de aprobar.');
    if (pod_prov_el) pod_prov_el.focus();
    return;
  }

  // Confirmación con resumen
  const resumen = [
    '¿Aprobar esta OC para enviar al proveedor?',
    '',
    'Proveedor: ' + pod_prov,
    'Forma de pago: ' + _ocFormaPagoLabel(pod_fp, pod_cc),
    'Moneda: ' + (pod_mon || 'ARS'),
    '',
    'La factura la cargará el proveedor cuando entregue la mercadería.',
  ];
  if (!confirm(resumen.join('\n'))) return;

  try {
    const body = {
      proveedor: pod_prov,
      iva_pct: pod_iva,
      forma_pago: pod_fp,
      cc_dias: pod_cc,
      moneda: pod_mon,
    };
    // El supplier_id si está vinculado
    const supplierSel = document.getElementById('pod-supplier-select');
    if (supplierSel && supplierSel.value && supplierSel.value !== '__manual__') {
      body.supplier_id = supplierSel.value;
    }
    const res = await apiFetch(`/api/purchase-orders/${id}/aprobar-compras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast('error', err.error || 'Error al aprobar la OC');
      return;
    }
    showToast('ok', '✅ OC aprobada y enviada al proveedor');
    closeModal();
    await renderPurchaseOrders();
  } catch (err) {
    console.error('[aprobarOC]', err);
    showToast('error', 'Error al aprobar la OC');
  }
}


// TESORERÍA confirma pago de una OC aprobada por Compras
async function pagarOC(id) {
  if (!confirm('¿Confirmar el pago de esta OC?')) return;
  try {
    const res = await apiFetch(`/api/purchase-orders/${id}/pagar`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast('error', err.error || 'Error al confirmar el pago');
      return;
    }
    showToast('ok', '💰 Pago confirmado');
    closeModal();
    await renderPurchaseOrders();
  } catch (err) {
    console.error('[pagarOC]', err);
    showToast('error', 'Error al confirmar el pago');
  }
}

// ═══════════════════════════════════════════════════════════
//  PROVEEDORES — módulo completo con tabla moderna + modal
// ═══════════════════════════════════════════════════════════
App.supTable = App.supTable || {
  rawData: [],
  search: '',
  status: 'all',
  rubro:  'all',
  sortKey: 'name',
  sortDir: 'asc',
};

async function renderSuppliers() {
  const root = document.getElementById('page-suppliers');
  if (!root) return;

  const canCreate = ['dueno','gerencia','paniol','proveedores'].includes(App.currentUser?.role);

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div>
        <h2 style="font-size:20px;font-weight:700;margin:0;color:var(--text)">🏢 Proveedores</h2>
        <p style="font-size:13px;color:var(--text3);margin:4px 0 0">Catálogo de proveedores con datos fiscales y condiciones comerciales</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" onclick="_supExportPDF()">📄 PDF</button>
        ${['dueno','gerencia','compras','contador','tesoreria'].includes(App.currentUser?.role) ?
          `<button class="btn btn-secondary btn-sm" onclick="verRankingProveedores()">🏆 Ranking de gasto</button>` : ''}
        ${canCreate ? `<button class="btn btn-primary" onclick="openNewSupplierModal()">+ Nuevo proveedor</button>` : ''}
      </div>
    </div>

    <div id="sup-kpi-row" class="kpi-row" style="margin-bottom:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
      <div class="kpi-card"><div class="kpi-label">Total proveedores</div><div class="kpi-value" style="color:var(--text)" id="sup-kpi-total">—</div><div class="kpi-trend">registrados</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Activos</div><div class="kpi-value ok" id="sup-kpi-activos">—</div><div class="kpi-trend">habilitados para operar</div></div>
      <div class="kpi-card" style="border-color:rgba(217,119,6,.35)"><div class="kpi-label">Suspendidos</div><div class="kpi-value" style="color:var(--warn)" id="sup-kpi-susp">—</div><div class="kpi-trend">pendientes de revisión</div></div>
      <div class="kpi-card" style="border-color:rgba(220,38,38,.35)"><div class="kpi-label">Blacklist</div><div class="kpi-value" style="color:var(--danger)" id="sup-kpi-black">—</div><div class="kpi-trend">no operar</div></div>
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <input id="sup-search" type="text" placeholder="🔍 Buscar nombre, CUIT, contacto..." value="${App.supTable.search}"
        oninput="App.supTable.search=this.value;_supRenderRows()"
        style="flex:1;min-width:200px;max-width:320px;padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-family:inherit;font-size:13px">

      <select onchange="App.supTable.status=this.value;_supRenderRows()"
        style="padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-family:inherit;font-size:12px">
        <option value="all">Estado: Todos</option>
        <option value="activo">Activo</option>
        <option value="suspendido">Suspendido</option>
        <option value="blacklist">Blacklist</option>
      </select>

      <select id="sup-f-rubro" onchange="App.supTable.rubro=this.value;_supRenderRows()"
        style="padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-family:inherit;font-size:12px">
        <option value="all">Rubro: Todos</option>
      </select>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <div style="overflow-x:auto">
        <table id="sup-table" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead id="sup-thead"></thead>
          <tbody id="sup-tbody"><tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3)">⏳ Cargando...</td></tr></tbody>
        </table>
      </div>
      <div id="sup-footer" style="padding:10px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text3);display:flex;justify-content:space-between;align-items:center;background:var(--bg2)"></div>
    </div>
  `;

  await loadSuppliersList();
}

async function loadSuppliersList() {
  try {
    const res = await apiFetch('/api/suppliers');
    if (!res.ok) {
      const tbody = document.getElementById('sup-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--danger)">Error al cargar proveedores</td></tr>`;
      return;
    }
    App.supTable.rawData = await res.json();

    // Populate dropdown de rubros con valores únicos encontrados
    const allRubros = new Set();
    App.supTable.rawData.forEach(s => (s.rubros || []).forEach(r => allRubros.add(r)));
    const rubroSel = document.getElementById('sup-f-rubro');
    if (rubroSel) {
      rubroSel.innerHTML = `<option value="all">Rubro: Todos</option>` +
        [...allRubros].sort().map(r => `<option value="${r}">${r}</option>`).join('');
    }

    _supRenderKPIs();
    _supRenderRows();
  } catch(err) {
    const tbody = document.getElementById('sup-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--danger)">Error: ${err.message}</td></tr>`;
  }
}

function _supRenderKPIs() {
  const d = App.supTable.rawData || [];
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('sup-kpi-total',   d.length);
  set('sup-kpi-activos', d.filter(s => s.status === 'activo').length);
  set('sup-kpi-susp',    d.filter(s => s.status === 'suspendido').length);
  set('sup-kpi-black',   d.filter(s => s.status === 'blacklist').length);
}

function _supRenderRows() {
  const thead = document.getElementById('sup-thead');
  const tbody = document.getElementById('sup-tbody');
  const footer= document.getElementById('sup-footer');
  if (!thead || !tbody) return;

  const all = App.supTable.rawData || [];
  const T = App.supTable;

  let rows = all.filter(s => {
    if (T.status !== 'all' && s.status !== T.status) return false;
    if (T.rubro !== 'all' && !(s.rubros || []).includes(T.rubro)) return false;
    if (T.search) {
      const q = T.search.toLowerCase();
      const hay = [s.name, s.razon_social, s.cuit, s.contact_person, s.phone, s.email]
        .filter(Boolean).map(x => String(x).toLowerCase());
      if (!hay.some(h => h.includes(q))) return false;
    }
    return true;
  });

  rows.sort((a,b) => {
    const va = (a[T.sortKey] || '').toString().toLowerCase();
    const vb = (b[T.sortKey] || '').toString().toLowerCase();
    if (va < vb) return T.sortDir === 'asc' ? -1 : 1;
    if (va > vb) return T.sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const cols = [
    ['name',           'Nombre'],
    ['cuit',           'CUIT'],
    ['rubros',         'Rubros', true],
    ['contact_person', 'Contacto'],
    ['phone',          'Teléfono'],
    ['forma_pago',     'Pago'],
    ['rating',         '⭐'],
    ['status',         'Estado'],
    ['actions',        '', true],
  ];
  thead.innerHTML = `<tr style="background:var(--bg3);border-bottom:2px solid var(--border)">${cols.map(([k,label,noSort]) => {
    const isSorted = !noSort && T.sortKey === k;
    const arrow = isSorted ? (T.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    const cls = isSorted ? 'color:var(--accent)' : 'color:var(--text3)';
    const cursor = noSort ? 'default' : 'pointer';
    return `<th onclick="${noSort?'':'_supSort(\''+k+'\')'}" style="text-align:left;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:600;cursor:${cursor};white-space:nowrap;font-family:var(--mono);${cls}">${label}${arrow}</th>`;
  }).join('')}</tr>`;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" style="text-align:center;padding:40px;color:var(--text3)">
      ${all.length===0 ? 'Sin proveedores registrados — creá el primero con "+ Nuevo proveedor"' : 'No hay proveedores que coincidan con los filtros'}
    </td></tr>`;
  } else {
    tbody.innerHTML = rows.map(s => _supRenderRow(s)).join('');
  }

  if (footer) {
    footer.innerHTML = `<span>Mostrando <b style="color:var(--text)">${rows.length}</b> de ${all.length} proveedores</span>`;
  }
}

function _supSort(key) {
  const T = App.supTable;
  if (T.sortKey === key) T.sortDir = T.sortDir === 'asc' ? 'desc' : 'asc';
  else { T.sortKey = key; T.sortDir = 'asc'; }
  _supRenderRows();
}

function _supRenderRow(s) {
  const statusColors = {
    activo:      'var(--ok)',
    suspendido:  'var(--warn)',
    blacklist:   'var(--danger)',
  };
  const statusLabels = {
    activo:      '✅ Activo',
    suspendido:  '⏸ Suspendido',
    blacklist:   '🚫 Blacklist',
  };
  const sideColor = statusColors[s.status] || 'var(--border2)';

  const rubros = (s.rubros || []).slice(0, 3).map(r =>
    `<span style="background:var(--bg3);padding:1px 6px;border-radius:8px;font-size:9px;color:var(--text3)">${r}</span>`
  ).join(' ');
  const extraRubros = (s.rubros || []).length > 3 ? `<span style="color:var(--text3);font-size:9px"> +${s.rubros.length-3}</span>` : '';

  const rating = s.rating ? `<span style="font-family:var(--mono);color:var(--warn);font-weight:700">${parseFloat(s.rating).toFixed(1)}</span>` : '<span style="color:var(--text3)">—</span>';

  const formaPagoLabel = { contado: 'Contado', cuenta_corriente: `CC ${s.cc_dias||'—'}d`, cheque: 'Cheque', echeq: 'E-cheq', transferencia: 'Transf.' }[s.forma_pago] || '—';

  return `<tr style="border-left:3px solid ${sideColor};border-bottom:1px solid var(--border);transition:background .1s"
    onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='transparent'">

    <td style="padding:10px 12px">
      <div style="font-weight:600;color:var(--text)">${escapeHtml(s.name)}</div>
      ${s.razon_social ? `<div style="font-size:10px;color:var(--text3)">${escapeHtml(s.razon_social)}</div>` : ''}
    </td>

    <td style="padding:10px 12px;font-family:var(--mono);font-size:12px;color:var(--text2)">${escapeHtml(s.cuit || '—')}</td>

    <td style="padding:10px 12px">${rubros || '<span style="color:var(--text3);font-size:10px">—</span>'}${extraRubros}</td>

    <td style="padding:10px 12px;font-size:12px">
      <div>${s.contact_person || '—'}</div>
      ${s.email ? `<div style="font-size:10px;color:var(--text3)">${escapeHtml(s.email)}</div>` : ''}
    </td>

    <td style="padding:10px 12px;font-family:var(--mono);font-size:12px;color:var(--text2)">${s.phone || '—'}</td>

    <td style="padding:10px 12px;font-size:11px;color:var(--text2)">${formaPagoLabel}</td>

    <td style="padding:10px 12px;text-align:center">${rating}</td>

    <td style="padding:10px 12px">
      <span style="background:${statusColors[s.status]||'var(--text3)'}22;color:${statusColors[s.status]||'var(--text3)'};padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;font-family:var(--mono)">
        ${statusLabels[s.status] || s.status}
      </span>
    </td>

    <td style="padding:10px 12px;white-space:nowrap;text-align:right">
      <button class="btn btn-secondary btn-sm" onclick="openSupplierDetail('${s.id}')">Ver</button>
      ${['dueno','gerencia','compras','contador','tesoreria'].includes(App.currentUser?.role) ?
        `<button class="btn btn-secondary btn-sm" onclick="verCuentaProveedor('${s.id}')" style="margin-left:4px">📒 Cuenta</button>` : ''}
      ${['dueno','gerencia','paniol','proveedores'].includes(App.currentUser?.role) ?
        `<button class="btn btn-secondary btn-sm" onclick="openEditSupplierModal('${s.id}')" style="margin-left:4px">Editar</button>` : ''}
    </td>
  </tr>`;
}


function _supTitleCase(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const upperTokens = new Set(['SA','S.A','S.A.','SRL','S.R.L','S.R.L.','SAS','S.A.S','S.A.S.','SNC','CUIT','IVA','CBU','CVU','YPF','ACA','R3M','LD']);
  const romanTokens = new Set(['I','II','III','IV','V','VI','VII','VIII','IX','X']);
  const lowerJoiners = new Set(['de','del','la','las','los','y','e','el','en','a','al','da','do']);
  return raw.split(' ').map((word, index) => {
    const cleanUpper = word.replace(/[.,]/g, '').toUpperCase();
    if (upperTokens.has(cleanUpper) || romanTokens.has(cleanUpper)) return cleanUpper;
    const lower = word.toLocaleLowerCase('es-AR');
    if (index > 0 && lowerJoiners.has(lower)) return lower;
    return lower.replace(/(^|[-'’/])([\p{L}])/gu, (_, sep, letter) => sep + letter.toLocaleUpperCase('es-AR'));
  }).join(' ');
}

function _supLowerClean(value) {
  return String(value || '').trim().toLowerCase();
}

function _supNormalizeFormFields() {
  const titleIds = ['sup-name','sup-razon','sup-contact','sup-address','sup-city','sup-province','sup-bank'];
  titleIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = _supTitleCase(el.value);
  });

  const cuit = document.getElementById('sup-cuit');
  if (cuit) cuit.value = String(cuit.value || '').replace(/\D/g, '');

  const email = document.getElementById('sup-email');
  if (email) email.value = _supLowerClean(email.value);

  const website = document.getElementById('sup-website');
  if (website) {
    const v = _supLowerClean(website.value);
    website.value = (v === 'https://' || v === 'http://') ? '' : v;
  }

  const alias = document.getElementById('sup-alias');
  if (alias) alias.value = _supLowerClean(alias.value);
}

// ── Modal nuevo proveedor (también sirve para editar) ────
function openNewSupplierModal() { _openSupplierModal(null); }
function openEditSupplierModal(id) {
  const sup = (App.supTable.rawData || []).find(s => s.id === id);
  if (!sup) { showToast('error', 'Proveedor no encontrado'); return; }
  _openSupplierModal(sup);
}

function _openSupplierModal(existing) {
  const s = existing || {};
  const isEdit = !!existing;
  const canDeleteSupplier = ['dueno','gerencia'].includes(App.currentUser?.role);

  const body = `
    <div style="max-height:70vh;overflow-y:auto;padding-right:8px">

      <div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:10px;letter-spacing:.5px">🏢 DATOS GENERALES</div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:16px">
        <div>
          <label class="form-label">Nombre comercial *</label>
          <input id="sup-name" class="form-input" value="${escapeHtml(s.name||'')}" placeholder="Ej: Distribuidora ABC">
        </div>
        <div>
          <label class="form-label">Estado</label>
          <select id="sup-status" class="form-select">
            <option value="activo" ${s.status==='activo'?'selected':''}>Activo</option>
            <option value="suspendido" ${s.status==='suspendido'?'selected':''}>Suspendido</option>
            <option value="blacklist" ${s.status==='blacklist'?'selected':''}>Blacklist</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:16px">
        <label class="form-label">Razón social</label>
        <input id="sup-razon" class="form-input" value="${escapeHtml(s.razon_social||'')}" placeholder="Ej: Distribuidora ABC S.R.L.">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
        <div>
          <label class="form-label">CUIT</label>
          <input id="sup-cuit" class="form-input" value="${escapeHtml(s.cuit||'')}" placeholder="30-12345678-9">
        </div>
        <div>
          <label class="form-label">Condición IVA</label>
          <select id="sup-iva" class="form-select">
            <option value="">—</option>
            <option value="responsable_inscripto" ${s.iva_condition==='responsable_inscripto'?'selected':''}>Responsable Inscripto</option>
            <option value="monotributo" ${s.iva_condition==='monotributo'?'selected':''}>Monotributo</option>
            <option value="exento" ${s.iva_condition==='exento'?'selected':''}>Exento</option>
            <option value="consumidor_final" ${s.iva_condition==='consumidor_final'?'selected':''}>Consumidor final</option>
          </select>
        </div>
      </div>

      <div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:10px;letter-spacing:.5px">📞 CONTACTO</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label class="form-label">Persona de contacto</label>
          <input id="sup-contact" class="form-input" value="${s.contact_person||''}" placeholder="Juan Pérez">
        </div>
        <div>
          <label class="form-label">Teléfono</label>
          <input id="sup-phone" class="form-input" value="${s.phone||''}" placeholder="+54 11 1234-5678">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
        <div>
          <label class="form-label">Email</label>
          <input id="sup-email" class="form-input" type="email" value="${escapeHtml(s.email||'')}" placeholder="contacto@proveedor.com">
        </div>
        <div>
          <label class="form-label">Sitio web</label>
          <input id="sup-website" class="form-input" value="${s.website||''}" placeholder="https://">
        </div>
      </div>

      <div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:10px;letter-spacing:.5px">📍 DIRECCIÓN</div>
      <div style="margin-bottom:12px">
        <label class="form-label">Domicilio</label>
        <input id="sup-address" class="form-input" value="${s.address||''}" placeholder="Calle 123">
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;margin-bottom:20px">
        <div>
          <label class="form-label">Ciudad</label>
          <input id="sup-city" class="form-input" value="${s.city||''}">
        </div>
        <div>
          <label class="form-label">Provincia</label>
          <input id="sup-province" class="form-input" value="${s.province||''}">
        </div>
        <div>
          <label class="form-label">CP</label>
          <input id="sup-cp" class="form-input" value="${s.postal_code||''}">
        </div>
      </div>

      <div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:10px;letter-spacing:.5px">🏷 RUBROS</div>
      <div style="margin-bottom:20px">
        <label class="form-label">Rubros (separados por coma)</label>
        <input id="sup-rubros" class="form-input" value="${(s.rubros||[]).join(', ')}" placeholder="repuestos, cubiertas, aceites, administrativo">
        <div style="font-size:11px;color:var(--text3);margin-top:4px">Ej: repuestos, cubiertas, aceites, limpieza, informatica, libreria, herramientas</div>
      </div>

      <div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:10px;letter-spacing:.5px">💰 CONDICIONES COMERCIALES</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label class="form-label">Forma de pago</label>
          <select id="sup-fpago" class="form-select">
            <option value="">—</option>
            <option value="contado" ${s.forma_pago==='contado'?'selected':''}>Contado</option>
            <option value="cuenta_corriente" ${s.forma_pago==='cuenta_corriente'?'selected':''}>Cuenta corriente</option>
            <option value="cheque" ${s.forma_pago==='cheque'?'selected':''}>Cheque</option>
            <option value="echeq" ${s.forma_pago==='echeq'?'selected':''}>E-cheq</option>
            <option value="transferencia" ${s.forma_pago==='transferencia'?'selected':''}>Transferencia</option>
          </select>
        </div>
        <div>
          <label class="form-label">Días CC</label>
          <input id="sup-ccdias" class="form-input" type="number" value="${s.cc_dias||''}" placeholder="30">
        </div>
        <div>
          <label class="form-label">Moneda</label>
          <select id="sup-moneda" class="form-select">
            <option value="ARS" ${s.moneda==='ARS'?'selected':''}>ARS (pesos)</option>
            <option value="USD" ${s.moneda==='USD'?'selected':''}>USD (dólares)</option>
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
        <div>
          <label class="form-label">Descuento habitual (%)</label>
          <input id="sup-disc" class="form-input" type="number" step="0.01" value="${s.discount_pct||0}">
        </div>
        <div>
          <label class="form-label">Tiempo entrega (días)</label>
          <input id="sup-deliv" class="form-input" type="number" value="${s.delivery_time_days||''}" placeholder="7">
        </div>
        <div>
          <label class="form-label">Calificación ⭐</label>
          <input id="sup-rating" class="form-input" type="number" step="0.1" min="0" max="5" value="${s.rating||''}" placeholder="4.5">
        </div>
      </div>

      <div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:10px;letter-spacing:.5px">🏦 DATOS BANCARIOS</div>
      <div style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:12px;margin-bottom:20px">
        <div>
          <label class="form-label">Banco</label>
          <input id="sup-bank" class="form-input" value="${s.bank_name||''}">
        </div>
        <div>
          <label class="form-label">CBU</label>
          <input id="sup-cbu" class="form-input" value="${s.bank_cbu||''}">
        </div>
        <div>
          <label class="form-label">Alias</label>
          <input id="sup-alias" class="form-input" value="${s.bank_alias||''}">
        </div>
      </div>

      <div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:10px;letter-spacing:.5px">📝 NOTAS</div>
      <div style="margin-bottom:16px">
        <label class="form-label">Observaciones</label>
        <textarea id="sup-notes" class="form-input" rows="2" placeholder="Notas internas...">${escapeHtml(s.notes||'')}</textarea>
      </div>

      <div id="sup-blacklist-row" style="display:${s.status==='blacklist'?'block':'none'};margin-bottom:10px">
        <label class="form-label" style="color:var(--danger)">Razón de blacklist</label>
        <textarea id="sup-blreason" class="form-input" rows="2">${s.blacklist_reason||''}</textarea>
      </div>
    </div>
  `;

  openModal(
    isEdit ? `Editar proveedor — ${escapeHtml(s.name)}` : 'Nuevo proveedor',
    body,
    [
      ...(isEdit && canDeleteSupplier ? [{ label: '🗑 Eliminar', cls: 'btn-danger', fn: () => _supDelete(s.id) }] : []),
      { label: 'Cancelar', cls: 'btn-secondary', fn: closeModal },
      { label: isEdit ? 'Guardar cambios' : 'Crear proveedor', cls: 'btn-primary', fn: () => _supSave(isEdit ? s.id : null) },
    ]
  );

  // Toggle del campo razón de blacklist según status elegido + normalización al salir de los campos
  setTimeout(() => {
    const statusSel = document.getElementById('sup-status');
    const blRow     = document.getElementById('sup-blacklist-row');
    if (statusSel && blRow) {
      statusSel.addEventListener('change', () => {
        blRow.style.display = statusSel.value === 'blacklist' ? 'block' : 'none';
      });
    }

    ['sup-name','sup-razon','sup-contact','sup-address','sup-city','sup-province','sup-bank','sup-cuit','sup-email','sup-website','sup-alias']
      .forEach(id => document.getElementById(id)?.addEventListener('blur', _supNormalizeFormFields));
  }, 100);
}

async function _supSave(id) {
  const val = (x) => document.getElementById(x)?.value?.trim() || '';
  const numOrNull = (x) => {
    const v = document.getElementById(x)?.value;
    return (v === '' || v == null) ? null : parseFloat(v);
  };

  _supNormalizeFormFields();

  const payload = {
    name:          _supTitleCase(val('sup-name')),
    razon_social:  _supTitleCase(val('sup-razon')),
    cuit:          val('sup-cuit'),
    iva_condition: val('sup-iva') || null,
    contact_person:_supTitleCase(val('sup-contact')),
    phone:         val('sup-phone'),
    email:         _supLowerClean(val('sup-email')),
    website:       _supLowerClean(val('sup-website')) === 'https://' || _supLowerClean(val('sup-website')) === 'http://' ? '' : _supLowerClean(val('sup-website')),
    address:       _supTitleCase(val('sup-address')),
    city:          _supTitleCase(val('sup-city')),
    province:      _supTitleCase(val('sup-province')),
    postal_code:   val('sup-cp'),
    rubros:        val('sup-rubros').split(',').map(r => r.trim().toLowerCase()).filter(Boolean),
    forma_pago:    val('sup-fpago') || null,
    cc_dias:       numOrNull('sup-ccdias'),
    moneda:        val('sup-moneda') || 'ARS',
    discount_pct:  numOrNull('sup-disc'),
    delivery_time_days: numOrNull('sup-deliv'),
    rating:        (() => { const v = numOrNull('sup-rating'); if (v == null) return null; if (v > 5) return 5; if (v < 0) return 0; return v; })(),
    bank_name:     _supTitleCase(val('sup-bank')),
    bank_cbu:      val('sup-cbu'),
    bank_alias:    _supLowerClean(val('sup-alias')),
    notes:         val('sup-notes'),
    status:        val('sup-status') || 'activo',
    blacklist_reason: val('sup-blreason') || null,
  };

  if (!payload.name) { showToast('error', 'El nombre es obligatorio'); return; }

  try {
    const url = id ? `/api/suppliers/${id}` : '/api/suppliers';
    const method = id ? 'PUT' : 'POST';
    const res = await apiFetch(url, { method, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    showToast('ok', id ? `Proveedor actualizado: ${escapeHtml(payload.name)}` : `Proveedor creado: ${escapeHtml(payload.name)}`);
    closeModal();
    await loadSuppliersList();
  } catch(err) {
    showToast('error', err.message);
  }
}

async function _supDelete(id) {
  if (!confirm('¿Eliminar este proveedor? (soft delete)')) return;
  try {
    const res = await apiFetch(`/api/suppliers/${id}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    showToast('ok', 'Proveedor eliminado');
    closeModal();
    await loadSuppliersList();
  } catch(err) { showToast('error', err.message); }
}

async function openSupplierDetail(id) {
  const sup = (App.supTable.rawData || []).find(s => s.id === id);
  if (!sup) { showToast('error', 'Proveedor no encontrado'); return; }

  const formaPagoLabel = { contado: 'Contado', cuenta_corriente: `CC a ${sup.cc_dias||'—'} días`, cheque: 'Cheque', echeq: 'E-cheq', transferencia: 'Transferencia' }[sup.forma_pago] || '—';
  const ivaLabel = { responsable_inscripto: 'Responsable Inscripto', monotributo: 'Monotributo', exento: 'Exento', consumidor_final: 'Consumidor final' }[sup.iva_condition] || '—';
  const statusBadge = { activo: '✅ Activo', suspendido: '⏸ Suspendido', blacklist: '🚫 Blacklist' }[sup.status] || sup.status;

  const body = `
    <div style="max-height:70vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--text)">${escapeHtml(sup.name)}</div>
          <div style="font-size:12px;color:var(--text3)">${escapeHtml(sup.razon_social||'—')}</div>
        </div>
        <span style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;font-family:var(--mono);background:var(--bg3)">${statusBadge}</span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px;margin-bottom:16px">
        <div>
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700;margin-bottom:8px">🏢 Fiscal</div>
          <div style="padding:8px 0"><b>CUIT:</b> <span style="font-family:var(--mono)">${escapeHtml(sup.cuit||'—')}</span></div>
          <div style="padding:4px 0"><b>IVA:</b> ${ivaLabel}</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700;margin-bottom:8px">📞 Contacto</div>
          <div style="padding:4px 0"><b>Persona:</b> ${sup.contact_person||'—'}</div>
          <div style="padding:4px 0"><b>Tel:</b> <span style="font-family:var(--mono)">${sup.phone||'—'}</span></div>
          <div style="padding:4px 0"><b>Email:</b> ${escapeHtml(sup.email||'—')}</div>
          ${sup.website ? `<div style="padding:4px 0"><b>Web:</b> <a href="${sup.website}" target="_blank" style="color:var(--accent)">${sup.website}</a></div>` : ''}
        </div>
      </div>

      ${sup.address || sup.city ? `
      <div style="padding:12px;background:var(--bg3);border-radius:var(--radius);font-size:13px;margin-bottom:16px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700;margin-bottom:6px">📍 Dirección</div>
        ${sup.address||''} ${sup.address&&sup.city?', ':''}${sup.city||''} ${sup.province?'('+sup.province+')':''} ${sup.postal_code?'- CP '+sup.postal_code:''}
      </div>` : ''}

      ${(sup.rubros||[]).length ? `
      <div style="margin-bottom:16px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700;margin-bottom:8px">🏷 Rubros</div>
        ${sup.rubros.map(r => `<span style="display:inline-block;background:var(--accent);color:white;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-right:5px;margin-bottom:5px">${r}</span>`).join('')}
      </div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div style="padding:12px;background:var(--bg3);border-radius:var(--radius)">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700;margin-bottom:8px">💰 Condiciones</div>
          <div style="font-size:13px;padding:3px 0"><b>Pago:</b> ${formaPagoLabel}</div>
          <div style="font-size:13px;padding:3px 0"><b>Moneda:</b> ${sup.moneda||'ARS'}</div>
          ${sup.discount_pct ? `<div style="font-size:13px;padding:3px 0"><b>Desc:</b> ${sup.discount_pct}%</div>` : ''}
          ${sup.delivery_time_days ? `<div style="font-size:13px;padding:3px 0"><b>Entrega:</b> ${sup.delivery_time_days} días</div>` : ''}
          ${sup.rating ? `<div style="font-size:13px;padding:3px 0"><b>Calificación:</b> <span style="color:var(--warn);font-weight:700">${parseFloat(sup.rating).toFixed(1)} ⭐</span></div>` : ''}
        </div>
        ${sup.bank_name || sup.bank_cbu ? `
        <div style="padding:12px;background:var(--bg3);border-radius:var(--radius)">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700;margin-bottom:8px">🏦 Bancario</div>
          ${sup.bank_name ? `<div style="font-size:13px;padding:3px 0"><b>Banco:</b> ${sup.bank_name}</div>` : ''}
          ${sup.bank_cbu ? `<div style="font-size:12px;padding:3px 0;font-family:var(--mono)"><b>CBU:</b> ${sup.bank_cbu}</div>` : ''}
          ${sup.bank_alias ? `<div style="font-size:12px;padding:3px 0;font-family:var(--mono)"><b>Alias:</b> ${sup.bank_alias}</div>` : ''}
        </div>` : '<div></div>'}
      </div>

      ${sup.notes ? `
      <div style="padding:12px;background:rgba(217,119,6,.10);border-left:3px solid var(--warn);border-radius:var(--radius);font-size:13px;margin-bottom:10px">
        <div style="font-size:10px;color:var(--warn);text-transform:uppercase;font-weight:700;margin-bottom:4px">📝 Notas</div>
        ${escapeHtml(sup.notes)}
      </div>` : ''}

      ${sup.blacklist_reason ? `
      <div style="padding:12px;background:rgba(220,38,38,.10);border-left:3px solid var(--danger);border-radius:var(--radius);font-size:13px">
        <div style="font-size:10px;color:var(--danger);text-transform:uppercase;font-weight:700;margin-bottom:4px">🚫 Razón blacklist</div>
        ${escapeHtml(sup.blacklist_reason)}
      </div>` : ''}
    </div>
  `;

  openModal(
    `Proveedor: ${escapeHtml(sup.name)}`,
    body,
    [
      { label: 'Cerrar', cls: 'btn-secondary', fn: closeModal },
      ...(['dueno','gerencia','paniol','proveedores'].includes(App.currentUser?.role) ?
        [{ label: '✎ Editar', cls: 'btn-primary', fn: () => { closeModal(); openEditSupplierModal(id); } }] : []),
    ]
  );
}

// Export PDF de proveedores
function _supExportPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) { showToast('error', 'jsPDF no cargado'); return; }
  const all = App.supTable.rawData || [];
  const T = App.supTable;
  let rows = all.filter(s => {
    if (T.status !== 'all' && s.status !== T.status) return false;
    if (T.rubro !== 'all' && !(s.rubros || []).includes(T.rubro)) return false;
    if (T.search) {
      const q = T.search.toLowerCase();
      const hay = [s.name, s.razon_social, s.cuit, s.contact_person].filter(Boolean).map(x=>String(x).toLowerCase());
      if (!hay.some(h => h.includes(q))) return false;
    }
    return true;
  });
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const startY = _pdfHeader(doc, 'Proveedores', `${rows.length} proveedor${rows.length===1?'':'es'}`);
  const tableData = rows.map(s => [
    s.name || '—', s.cuit || '—',
    (s.rubros||[]).join(', ') || '—',
    s.contact_person || '—', s.phone || '—', s.email || '—',
    s.forma_pago || '—',
    s.status || '—',
  ]);
  doc.autoTable({
    startY: startY,
    head: [['Nombre','CUIT','Rubros','Contacto','Tel','Email','Pago','Estado']],
    body: tableData,
    ..._pdfTableStyle(),
  });
  doc.save(`Proveedores-Biletta-${todayISO()}.pdf`);
  showToast('ok', 'PDF descargado');
}

// ═══════════════════════════════════════════════════════════
// ACTIVOS — cargar assets en App.data (para OTs edilicias/etc)
// ═══════════════════════════════════════════════════════════
async function loadAssetsIntoData() {
  try {
    const res = await apiFetch('/api/assets');
    if (res.ok) App.data.assets = await res.json();
  } catch(e) { App.data.assets = []; }
}

// ═══════════════════════════════════════════════════════════
//  PARTES DE TRABAJO — Opción B (trazabilidad MO)
// ═══════════════════════════════════════════════════════════

// Cargar lista de partes de la OT actual
async function _labLoadList() {
  const otId = window._labCurrentOtId;
  const container = document.getElementById('eo-labor-list');
  if (!otId || !container) return;
  try {
    const r = await apiFetch(`/api/workorders/${otId}/labor`);
    if (!r.ok) {
      container.innerHTML = `<div style="padding:10px;color:var(--danger);font-size:12px">Error al cargar partes de trabajo</div>`;
      return;
    }
    const partes = await r.json();
    window._labCurrentPartes = partes;
    _labRender(partes);
  } catch(err) {
    container.innerHTML = `<div style="padding:10px;color:var(--danger);font-size:12px">Error: ${err.message}</div>`;
  }
}

function _labRender(partes) {
  const container = document.getElementById('eo-labor-list');
  const totalDiv  = document.getElementById('eo-labor-total');
    const totalHrs  = document.getElementById('eo-labor-total-hours');
  const eoLabor   = document.getElementById('eo-labor');
  if (!container) return;

  if (!partes || partes.length === 0) {
    container.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text3);font-size:12px;background:var(--bg3);border-radius:var(--radius);border:1px dashed var(--border2)">
      Aún no hay partes de trabajo cargados.<br>Click en <b>"+ Agregar parte"</b> para registrar quién trabajó y cuántas horas.
    </div>`;
    if (totalDiv) totalDiv.style.display = 'none';
    if (eoLabor) eoLabor.value = 0;
    return;
  }

  container.innerHTML = partes.map(p => {
    const hours    = parseFloat(p.hours || 0);
    const rate     = 0;
    const subtotal = 0;
    const fecha    = p.work_date ? new Date(p.work_date).toLocaleDateString('es-AR') : '—';
    return `<div style="display:grid;grid-template-columns:1fr 70px 32px;gap:6px;margin-bottom:6px;align-items:center;padding:6px 10px;background:var(--bg3);border-radius:var(--radius);font-size:12px">
      <div>
        <div style="font-weight:600">${p.worker_name}</div>
        <div style="color:var(--text3);font-size:10px">${fecha}${p.notes ? ' · ' + escapeHtml(p.notes.substring(0,50)) : ''}</div>
      </div>
      <div style="text-align:center;font-family:var(--mono)">${hours} h</div>
      ${window._labCurrentOtClosed ? '<span></span>' : `<button type="button" onclick="_labDelete('${p.id}')"
        title="Eliminar este parte"
        style="background:none;border:1px solid var(--border2);border-radius:6px;cursor:pointer;color:var(--danger);font-size:14px;padding:0 6px;height:28px">✕</button>`}
    </div>`;
  }).join('');

  const totalH = partes.reduce((a,p) => a + parseFloat(p.hours||0), 0);
  if (totalDiv) totalDiv.style.display = 'block';
  if (totalHrs) totalHrs.textContent = totalH.toFixed(1);
  if (eoLabor)  eoLabor.value = 'Sin precio · ' + totalH.toFixed(1) + ' h';
}

// Modal para agregar un parte nuevo
function _labAddRow() {
  if (!window._labCurrentOtId) return showToast('error', 'Abrí una OT primero');
  if (window._labCurrentOtClosed) return showToast('info', 'La OT está cerrada: no se puede modificar');

  // Lista de mecánicos del sistema (users con rol mecanico, jefe_mantenimiento o el que sea)
  const mechanics = (App.data.users || []).filter(u =>
    ['mecanico','jefe_mantenimiento','dueno','gerencia'].includes(u.role)
  );
  const mechOpts = mechanics.map(u => `<option value="${u.id}" data-name="${escapeHtml(u.name)}">${escapeHtml(u.name)} (${u.role})</option>`).join('');

  const body = `
    <div style="margin-bottom:14px;padding:10px;background:var(--bg3);border-radius:var(--radius);font-size:12px;color:var(--text3)">
      💡 <b>Parte de trabajo:</b> registrá quién trabajó y cuántas horas.
      La mano de obra propia queda registrada sin precio.
    </div>

    <div class="form-group">
      <label class="form-label">¿Quién trabajó? *</label>
      <select class="form-select" id="lab-user" onchange="_labUserChanged()">
        <option value="">— Seleccionar o escribir manualmente —</option>
        ${mechOpts}
        <option value="__manual__">✍️ Otro (escribir nombre)</option>
      </select>
      <div id="lab-user-manual-wrap" style="display:none;margin-top:6px">
        <input class="form-input" id="lab-user-manual" placeholder="Nombre del trabajador">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Horas trabajadas *</label>
        <input class="form-input" type="number" id="lab-hours" step="0.25" min="0.25" max="24" value="1"
          oninput="_labRecalc()" style="font-size:14px">
        <div style="font-size:10px;color:var(--text3);margin-top:3px">Ej: 0.5 (media hora), 3 (tres horas), 3.5 (tres y media)</div>
      </div>
      <div class="form-group">
        <label class="form-label">Valorización</label>
        <input class="form-input" readonly value="Sin precio" style="background:var(--bg3);color:var(--text3)">
        <div style="font-size:10px;color:var(--text3);margin-top:3px">La empresa registra horas, no precio de mano de obra propia.</div>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Fecha del trabajo</label>
        <input class="form-input" type="date" id="lab-date" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label">Resumen</label>
        <input class="form-input" id="lab-subtotal" readonly style="background:var(--bg3);font-weight:700;color:var(--accent);font-size:14px" value="1 h registrada">
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Notas (opcional)</label>
      <input class="form-input" id="lab-notes" placeholder="Qué hizo exactamente, observaciones, etc.">
    </div>
  `;
  openModal('⏱️ Agregar parte de trabajo', body, [
    { label: 'Cancelar', cls: 'btn-secondary', fn: () => { closeModal(); openEditOTModal(window._labCurrentOtId); } },
    { label: 'Guardar parte', cls: 'btn-primary', fn: _labSave },
  ]);

  setTimeout(() => _labRecalc(), 50);
}

// Cuando cambia el select de usuario
function _labUserChanged() {
  const sel = document.getElementById('lab-user');
  const manualWrap = document.getElementById('lab-user-manual-wrap');
  if (!sel || !manualWrap) return;
  manualWrap.style.display = sel.value === '__manual__' ? 'block' : 'none';
}

// Recalcular subtotal en tiempo real
function _labRecalc() {
  const hours = parseFloat(document.getElementById('lab-hours')?.value) || 0;
  const subtotalEl = document.getElementById('lab-subtotal');
  if (subtotalEl) subtotalEl.value = hours ? (hours + ' h registrada/s') : 'Sin horas';
}

// Guardar el parte
async function _labSave() {
  const otId  = window._labCurrentOtId;
  if (!otId) { showToast('error', 'No hay OT seleccionada'); return; }
  if (window._labCurrentOtClosed) { showToast('info', 'La OT está cerrada: no se puede modificar'); return; }

  const userSel = document.getElementById('lab-user');
  const userVal = userSel?.value || '';
  let user_id = null;
  let worker_name = '';

  if (userVal === '__manual__' || userVal === '') {
    // Manual: tomar del input
    worker_name = (document.getElementById('lab-user-manual')?.value || '').trim();
    if (!worker_name && userVal === '') {
      // Si no eligió nada ni escribió nada, error
      showToast('error', 'Indicá quién trabajó');
      return;
    }
  } else {
    // Seleccionó un usuario del dropdown
    user_id = userVal;
    const opt = userSel.options[userSel.selectedIndex];
    worker_name = opt?.dataset?.name || opt?.text?.split(' (')[0] || 'Trabajador';
  }

  if (!worker_name) { showToast('error', 'Indicá quién trabajó'); return; }

  const hours = parseFloat(document.getElementById('lab-hours')?.value);
  const rate  = 0;
  const work_date = document.getElementById('lab-date')?.value || null;
  const notes = (document.getElementById('lab-notes')?.value || '').trim() || null;

  if (!hours || hours <= 0) { showToast('error', 'Ingresá las horas trabajadas'); return; }

  try {
    const r = await apiFetch(`/api/workorders/${otId}/labor`, {
      method: 'POST',
      body: JSON.stringify({ user_id, worker_name, hours, rate, work_date, notes })
    });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error'); return; }
    showToast('ok', `Parte agregado: ${worker_name} · ${hours} h`);
    closeModal();
    // Reabrir modal de edición y refrescar
    openEditOTModal(otId);
  } catch(err) {
    showToast('error', err.message);
  }
}

// Eliminar un parte
async function _labDelete(laborId) {
  const otId = window._labCurrentOtId;
  if (!otId) return;
  if (window._labCurrentOtClosed) return showToast('info', 'La OT está cerrada: no se puede modificar');
  if (!confirm('¿Eliminar este parte de trabajo?')) return;
  try {
    const r = await apiFetch(`/api/workorders/${otId}/labor/${laborId}`, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error'); return; }
    showToast('ok', 'Parte eliminado');
    _labLoadList();
  } catch(err) {
    showToast('error', err.message);
  }
}

// Helper: cargar labor_rate al config global de App en loadInitialData
async function loadLaborRate() {
  try {
    const r = await apiFetch('/api/config');
    if (r.ok) {
      const cfg = await r.json();
      App.config = App.config || {};
      App.config.labor_rate = parseFloat(cfg.labor_rate) || 0;
    }
  } catch(e) { /* silent */ }
}

// ═══════════════════════════════════════════════════════════
//  REPUESTOS EN OT EXISTENTE (agregar/eliminar después de crear)
// ═══════════════════════════════════════════════════════════

async function _partsLoadList() {
  const otId = window._labCurrentOtId;
  const container = document.getElementById('eo-parts-list');
  if (!otId || !container) return;
  try {
    const [r, rc] = await Promise.all([
      apiFetch(`/api/workorders/${otId}/parts`),
      apiFetch(`/api/workorders/${otId}/compras-en-stock`).catch(() => null),
    ]);
    if (!r.ok) {
      container.innerHTML = `<div style="padding:10px;color:var(--danger);font-size:12px">Error al cargar repuestos</div>`;
      return;
    }
    const parts = await r.json();
    const compras = (rc && rc.ok) ? await rc.json() : [];
    window._otComprasMap = {};
    compras.forEach(c => { window._otComprasMap[c.work_order_part_id] = c; });
    _partsRender(parts);
  } catch(err) {
    container.innerHTML = `<div style="padding:10px;color:var(--danger);font-size:12px">Error: ${err.message}</div>`;
  }
}

function _partsRender(parts) {
  const container = document.getElementById('eo-parts-list');
  const totalDiv  = document.getElementById('eo-parts-total');
  const totalVal  = document.getElementById('eo-parts-total-val');
  const eoParts   = document.getElementById('eo-parts');
  if (!container) return;

  if (!parts || parts.length === 0) {
    container.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text3);font-size:12px;background:var(--bg3);border-radius:var(--radius);border:1px dashed var(--border2)">
      Aún no hay repuestos cargados en esta OT.<br>Click en <b>"+ Agregar repuesto"</b> para incorporarlos.
    </div>`;
    if (totalDiv) totalDiv.style.display = 'none';
    if (eoParts) eoParts.value = 0;
    return;
  }

  container.innerHTML = parts.map(p => {
    const qty = parseFloat(p.qty || 0);
    const cost = parseFloat(p.unit_cost || 0);
    const subtotal = parseFloat(p.subtotal || (qty * cost));
    const isTerc = String(p.name || '').toLowerCase().includes('terceriz');
    const origenLabel = p.origin === 'stock' ? '📦 Pañol' : (isTerc ? '🧰 Tercerizado' : '🛒 Externo');
    const origenColor = p.origin === 'stock' ? 'var(--ok)' : (cost > 0 ? 'var(--accent)' : 'var(--text3)');
    const stockCode = p.stock_code ? ` · <span style="font-family:var(--mono);font-size:10px">${p.stock_code}</span>` : '';
    const poCode = p.po_code ? ` · <span style="font-family:var(--mono);font-size:10px;color:var(--accent)">${p.po_code}</span>` : '';
    const costText = p.origin === 'externo' && cost <= 0 ? 'A cotizar' : ('$' + Math.round(cost).toLocaleString('es-AR'));
    const subText  = p.origin === 'externo' && cost <= 0 ? 'Pendiente' : ('$' + Math.round(subtotal).toLocaleString('es-AR'));
    return `<div style="display:grid;grid-template-columns:70px 1fr 70px 90px 100px 32px;gap:6px;margin-bottom:6px;align-items:center;padding:6px 10px;background:var(--bg3);border-radius:var(--radius);font-size:12px">
      <div style="color:${origenColor};font-weight:600;font-size:11px">${origenLabel}</div>
      <div>
        <div style="font-weight:600">${escapeHtml(p.name)}</div>
        <div style="color:var(--text3);font-size:10px">${escapeHtml((p.unit||'un'))}${stockCode}${poCode}${p.origin==='externo' && cost>0 ? ' · precio aprobado por Compras' : ''}</div>
      </div>
      <div style="text-align:center;font-family:var(--mono)">${qty}</div>
      <div style="text-align:right;font-family:var(--mono);color:var(--text3)">${costText}</div>
      <div style="text-align:right;font-weight:700;color:${cost > 0 ? 'var(--accent)' : 'var(--text3)'};font-family:var(--mono)">${subText}</div>
      ${window._labCurrentOtClosed ? '<span></span>' : `<button type="button" onclick="_partsDelete('${p.id}', ${p.origin === 'stock' ? 'true' : 'false'})"
        title="${p.origin === 'stock' ? 'Eliminar y devolver al stock' : 'Eliminar repuesto'}"
        style="background:none;border:1px solid var(--border2);border-radius:6px;cursor:pointer;color:var(--danger);font-size:14px;padding:0 6px;height:28px">✕</button>`}
    </div>${_partsConsumibleSubrow(p)}`;
  }).join('');

  const totalM = parts.reduce((a,p) => a + parseFloat(p.subtotal || (p.qty * p.unit_cost) || 0), 0);
  if (totalDiv) totalDiv.style.display = 'block';
  if (totalVal) totalVal.textContent = '$' + Math.round(totalM).toLocaleString('es-AR');
  if (eoParts)  eoParts.value = totalM.toFixed(2);
}


// Sub-fila "Confirmar uso" para los repuestos comprados para esta OT que están
// en stock (vinieron por OC y se recibieron). Permite descontar del stock lo
// usado SIN cerrar la OT. Lo que no se usa queda en stock.
function _partsConsumibleSubrow(p) {
  const c = (window._otComprasMap || {})[p.id];
  if (!c || window._labCurrentOtClosed) return '';
  const disp = parseFloat(c.qty_disponible) || 0;
  return `<div style="margin:-2px 0 8px;padding:6px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:var(--radius);display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;flex-wrap:wrap">
    <span style="color:#1e40af">📦 Comprado para esta OT · en stock: <b>${disp} ${escapeHtml(c.unit || '')}</b></span>
    <button type="button" class="btn btn-primary btn-sm" style="padding:3px 10px;font-size:11px" onclick="_openConsumirCompra('${p.id}')">✓ Confirmar uso / dar de baja</button>
  </div>`;
}

function _openConsumirCompra(partId) {
  const c = (window._otComprasMap || {})[partId];
  if (!c) return;
  const num = (v) => parseFloat(v) || 0;
  const disp = num(c.qty_disponible), comprada = num(c.qty_comprada);
  openModal('Confirmar uso del repuesto', `
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">${escapeHtml(c.name)} <span style="color:var(--text3);font-weight:400;font-family:var(--mono);font-size:11px">${escapeHtml(c.code || '')}</span></div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Comprado: <b>${comprada} ${escapeHtml(c.unit || '')}</b> · En stock: <b>${disp}</b> · ${escapeHtml(c.base_location || '')}/${escapeHtml(c.area || '')}</div>
    <div class="form-group"><label class="form-label">¿Cuánto usaste? *</label>
      <input class="form-input" id="cc-qty" type="number" min="0" max="${disp}" step="0.01" value="${Math.min(comprada, disp)}"></div>
    <div style="font-size:11px;color:var(--text3)">Se descuenta del stock. Lo que no uses queda en stock.</div>
  `, [
    { label: 'Cancelar', cls: 'btn-secondary', fn: () => { closeModal(); openEditOTModal(window._labCurrentOtId); } },
    { label: 'Confirmar uso', cls: 'btn-primary', fn: () => _saveConsumirCompra(partId) },
  ]);
}

async function _saveConsumirCompra(partId) {
  const c = (window._otComprasMap || {})[partId];
  const otId = window._labCurrentOtId;
  if (!c || !otId) return;
  const qty = parseFloat(document.getElementById('cc-qty')?.value);
  if (!(qty > 0)) { showToast('warn', 'Ingresá cuánto usaste'); return; }
  try {
    const r = await apiFetch(`/api/workorders/${otId}/consumir-compra`, {
      method: 'POST',
      body: JSON.stringify({ work_order_part_id: partId, catalog_id: c.catalog_id, base_location: c.base_location, area: c.area, qty_usada: qty }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); showToast('error', e.error || 'Error al confirmar el uso'); return; }
    closeModal();
    showToast('ok', 'Uso confirmado · descontado del stock');
    openEditOTModal(otId);
  } catch (err) { showToast('error', err.message); }
}

function _partsAddExternalLabor() {
  if (!window._labCurrentOtId) return showToast('error', 'Abrí una OT primero');
  if (window._labCurrentOtClosed) return showToast('info', 'La OT está cerrada: no se puede modificar');
  const body = `
    <div style="margin-bottom:14px;padding:10px;background:rgba(14,165,233,.08);border:1px solid rgba(14,165,233,.25);border-radius:var(--radius);font-size:12px;color:var(--text3)">
      🧰 Esto genera una OC pendiente para Compras. El costo se verá en la OT cuando Compras apruebe proveedor y precio.
    </div>
    <div class="form-group">
      <label class="form-label">Trabajo tercerizado *</label>
      <input class="form-input" id="pnew-labor-desc" placeholder="Ej: rectificación, soldadura, mano de obra taller externo">
    </div>
  `;
  openModal('🧰 Tercerizar mano de obra', body, [
    { label: 'Cancelar', cls: 'btn-secondary', fn: () => { closeModal(); openEditOTModal(window._labCurrentOtId); } },
    { label: 'Generar OC', cls: 'btn-primary', fn: _partsSaveExternalLabor },
  ]);
}

async function _partsSaveExternalLabor() {
  const otId = window._labCurrentOtId;
  const desc = (document.getElementById('pnew-labor-desc')?.value || '').trim();
  if (!otId) return showToast('error', 'No hay OT seleccionada');
  if (!desc || desc.length < 3) return showToast('error', 'Ingresá una descripción del trabajo tercerizado');
  try {
    const r = await apiFetch(`/api/workorders/${otId}/parts`, {
      method: 'POST',
      body: JSON.stringify({
        name: `Mano de obra tercerizada: ${desc}`,
        origin: 'externo',
        qty: 1,
        unit: 'servicio',
        unit_cost: 0
      })
    });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error'); return; }
    closeModal();
    showToast('ok', 'Mano de obra tercerizada agregada · OC generada para Compras');
    try { await loadInitialData(); } catch(e) {}
    openEditOTModal(otId);
  } catch(err) {
    showToast('error', err.message);
  }
}

async function _partsAddRow() {
  if (!window._labCurrentOtId) return showToast('error', 'Abrí una OT primero');
  if (window._labCurrentOtClosed) return showToast('info', 'La OT está cerrada: no se puede modificar');
  // El buscador de pañol usa el catálogo; asegurarlo cargado.
  if (!Array.isArray(App.data.stockCatalog)) {
    try { const r = await apiFetch('/api/stock/catalog'); App.data.stockCatalog = r.ok ? await r.json() : []; } catch (e) { App.data.stockCatalog = []; }
  }

  const body = `
    <div style="margin-bottom:14px;padding:10px;background:var(--bg3);border-radius:var(--radius);font-size:12px;color:var(--text3)">
      💡 Elegí el origen: 📦 Pañol descuenta stock. 🛒 Externo genera una OC pendiente para Compras.
    </div>

    <div class="form-group">
      <label class="form-label">Origen *</label>
      <select class="form-select" id="pnew-origin" onchange="_partsOriginChanged()">
        <option value="externo">🛒 Externo (genera OC a Compras)</option>
        <option value="stock">📦 Pañol (usar stock existente)</option>
      </select>
    </div>

    <div class="form-group" style="position:relative">
      <label class="form-label">Descripción del repuesto *</label>
      <input class="form-input" id="pnew-name" placeholder="Descripción del repuesto" autocomplete="off"
        oninput="_partsNameInput(this.value)">
      <div id="pnew-suggestions" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border2);border-radius:0 0 var(--radius) var(--radius);z-index:100;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.25)"></div>
      <div id="pnew-stock-info" style="display:none;font-size:11px;color:var(--text3);margin-top:4px"></div>
    </div>

    <div class="form-group" id="pnew-location-wrap" style="display:none">
      <label class="form-label">Ubicación — de dónde sale el repuesto *</label>
      <select class="form-select" id="pnew-location" onchange="_partsLocationChanged()"></select>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Cantidad *</label>
        <input class="form-input" type="number" id="pnew-qty" min="0.01" step="0.01" value="1"
          oninput="_partsQtyChanged()" style="font-size:14px">
      </div>
      <div class="form-group">
        <label class="form-label">Unidad</label>
        <input class="form-input" id="pnew-unit" value="un" style="font-size:14px">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group" id="pnew-cost-wrap" style="display:none">
        <label class="form-label">Costo pañol ($)</label>
        <input class="form-input" type="number" id="pnew-cost" min="0" value="0" readonly
          oninput="_partsRecalc()" style="font-size:14px;background:var(--bg3)">
      </div>
      <div class="form-group" id="pnew-total-wrap" style="display:none">
        <label class="form-label">Total valorizado</label>
        <input class="form-input" id="pnew-subtotal" readonly style="background:var(--bg3);font-weight:700;color:var(--accent);font-size:14px" value="$0">
      </div>
    </div>
  `;
  openModal('🔧 Agregar repuesto a la OT', body, [
    { label: 'Cancelar', cls: 'btn-secondary', fn: () => { closeModal(); openEditOTModal(window._labCurrentOtId); } },
    { label: 'Agregar', cls: 'btn-primary', fn: _partsSave },
  ]);

  // Limpiar dataset para nueva entrada
  window._pnewStockId = null;
  window._pnewCatalogId = null;
  window._pnewLoc = null;
  window._pnewBalances = [];
  window._pnewStockAvailable = 0;
  setTimeout(() => _partsOriginChanged(), 30);
}

function _partsOriginChanged() {
  const origin = document.getElementById('pnew-origin')?.value;
  const nameEl = document.getElementById('pnew-name');
  const costEl = document.getElementById('pnew-cost');
  const costWrap = document.getElementById('pnew-cost-wrap');
  const totalWrap = document.getElementById('pnew-total-wrap');
  const sugEl = document.getElementById('pnew-suggestions');
  const infoEl = document.getElementById('pnew-stock-info');

  if (origin === 'externo') {
    if (nameEl) { nameEl.placeholder = 'Descripción del repuesto/servicio externo para Compras'; nameEl.value = ''; nameEl.style.borderLeft = ''; }
    if (costEl) { costEl.readOnly = true; costEl.style.background = 'var(--bg3)'; costEl.value = 0; }
    if (costWrap) costWrap.style.display = 'none';
    if (totalWrap) totalWrap.style.display = 'none';
    if (sugEl)  sugEl.style.display = 'none';
    if (infoEl) { infoEl.style.display = 'block'; infoEl.innerHTML = '<span style="color:var(--warn)">🛒 Se generará una OC pendiente para que Compras cotice/negocie. No cargues precio en la OT.</span>'; }
    window._pnewStockId = null;
    window._pnewStockAvailable = 0;
  } else {
    if (nameEl) { nameEl.placeholder = 'Escribí para buscar en el pañol...'; nameEl.value = ''; nameEl.style.borderLeft = ''; }
    if (costEl) { costEl.value = 0; costEl.readOnly = true; costEl.style.background = 'var(--bg3)'; }
    if (costWrap) costWrap.style.display = '';
    if (totalWrap) totalWrap.style.display = '';
    if (infoEl) { infoEl.style.display = 'block'; infoEl.innerHTML = '<span style="color:var(--accent)">📦 Elegí un ítem del pañol</span>'; }
    window._pnewStockId = null;
  }
  window._pnewCatalogId = null;
  window._pnewLoc = null;
  window._pnewBalances = [];
  window._pnewStockAvailable = 0;
  const _locWrap = document.getElementById('pnew-location-wrap');
  if (_locWrap) _locWrap.style.display = 'none';
  _partsRecalc();
}

function _partsNameInput(val) {
  const origin = document.getElementById('pnew-origin')?.value;
  const sugEl = document.getElementById('pnew-suggestions');
  if (!sugEl) return;

  if (origin !== 'stock') { sugEl.style.display = 'none'; return; }

  // Si el usuario edita después de haber seleccionado, desvincular
  if (window._pnewCatalogId || window._pnewStockId) {
    window._pnewCatalogId = null;
    window._pnewStockId = null;
    window._pnewStockAvailable = 0;
    window._pnewLoc = null;
    window._pnewBalances = [];
    const nameEl = document.getElementById('pnew-name');
    if (nameEl) nameEl.style.borderLeft = '';
    const locWrap = document.getElementById('pnew-location-wrap');
    if (locWrap) locWrap.style.display = 'none';
  }

  if (!val || val.length < 2) { sugEl.style.display = 'none'; return; }
  const q = val.toLowerCase();
  const arts = (App.data.stockCatalog || []).filter(a =>
    (a.name||'').toLowerCase().includes(q) || (a.code||'').toLowerCase().includes(q)
  ).slice(0, 8);

  if (!arts.length) {
    sugEl.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:12px;text-align:center">Sin resultados en el pañol. Cambiá a "Externo" si es compra de afuera.</div>';
    sugEl.style.display = 'block';
    return;
  }

  sugEl.innerHTML = arts.map(a => {
    const total = parseFloat(a.total || 0);
    const color = a.is_critical ? 'var(--danger)' : (total > 0 ? 'var(--ok)' : 'var(--text3)');
    return `<div onclick="_partsSelectCatalog('${a.id}')"
      style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <div>
        <div style="font-weight:600">${escapeHtml(a.name)}</div>
        <div style="color:var(--text3);font-family:monospace;font-size:11px">${escapeHtml(a.code||'—')}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;color:var(--accent)">$${Math.round(parseFloat(a.unit_cost)||0).toLocaleString('es-AR')}/${escapeHtml(a.unit||'un')}</div>
        <div style="font-size:10px;color:${color};font-weight:700">Stock: ${total} ${escapeHtml(a.unit||'un')}</div>
      </div>
    </div>`;
  }).join('');
  sugEl.style.display = 'block';
}

// Seleccionar un artículo del catálogo: setea nombre/unidad/costo y arma el
// selector de ubicación con los saldos disponibles (de dónde sale el repuesto).
function _partsSelectCatalog(catalogId) {
  const a = (App.data.stockCatalog || []).find((x) => String(x.id) === String(catalogId));
  if (!a) return;
  const nameEl = document.getElementById('pnew-name');
  const unitEl = document.getElementById('pnew-unit');
  const costEl = document.getElementById('pnew-cost');
  const sugEl = document.getElementById('pnew-suggestions');
  const locWrap = document.getElementById('pnew-location-wrap');
  const locSel = document.getElementById('pnew-location');

  if (nameEl) { nameEl.value = a.name; nameEl.style.borderLeft = '3px solid var(--ok)'; }
  if (unitEl) unitEl.value = a.unit || 'un';
  if (costEl) { costEl.value = parseFloat(a.unit_cost) || 0; costEl.readOnly = true; costEl.style.background = 'var(--bg3)'; }
  if (sugEl) sugEl.style.display = 'none';

  window._pnewCatalogId = a.id;
  window._pnewStockId = null;
  // Solo ubicaciones con stock > 0.
  window._pnewBalances = (a.balances || []).filter((b) => parseFloat(b.qty_current) > 0);
  if (locSel) {
    if (window._pnewBalances.length === 0) {
      locSel.innerHTML = '<option value="">Sin stock en ninguna ubicación</option>';
    } else {
      locSel.innerHTML = window._pnewBalances.map((b, i) =>
        `<option value="${i}">${escapeHtml(b.base_location)} / ${escapeHtml(b.area)} — ${parseFloat(b.qty_current)} ${escapeHtml(a.unit || 'un')}</option>`).join('');
    }
  }
  if (locWrap) locWrap.style.display = 'block';
  _partsLocationChanged();
}

// Cambió la ubicación elegida → fijar disponible para validar la cantidad.
function _partsLocationChanged() {
  const locSel = document.getElementById('pnew-location');
  const idx = locSel ? parseInt(locSel.value, 10) : NaN;
  const b = Number.isFinite(idx) ? (window._pnewBalances || [])[idx] : null;
  window._pnewLoc = b ? { base_location: b.base_location, area: b.area } : null;
  window._pnewStockAvailable = b ? parseFloat(b.qty_current) : 0;
  _partsQtyChanged();
  _partsRecalc();
}

function _partsSelectStock(stockId, name, unit, unitCost, qtyAvailable) {
  const nameEl = document.getElementById('pnew-name');
  const unitEl = document.getElementById('pnew-unit');
  const costEl = document.getElementById('pnew-cost');
  const sugEl = document.getElementById('pnew-suggestions');
  const infoEl = document.getElementById('pnew-stock-info');

  if (nameEl) { nameEl.value = name; nameEl.style.borderLeft = '3px solid var(--ok)'; }
  if (unitEl) unitEl.value = unit;
  if (costEl) { costEl.value = unitCost; costEl.readOnly = true; costEl.style.background = 'var(--bg3)'; }
  if (sugEl) sugEl.style.display = 'none';

  window._pnewStockId = stockId;
  window._pnewStockAvailable = qtyAvailable;

  if (infoEl) {
    const color = qtyAvailable > 0 ? 'var(--ok)' : 'var(--danger)';
    infoEl.innerHTML = `<span style="color:${color}">✓ Vinculado al pañol · Disponible: <b>${qtyAvailable} ${unit}</b></span>`;
  }
  _partsQtyChanged();
  _partsRecalc();
}

function _partsQtyChanged() {
  const qty = parseFloat(document.getElementById('pnew-qty')?.value) || 0;
  const origin = document.getElementById('pnew-origin')?.value;
  const qtyEl = document.getElementById('pnew-qty');
  const infoEl = document.getElementById('pnew-stock-info');

  if (origin === 'stock' && (window._pnewCatalogId || window._pnewStockId)) {
    const available = window._pnewStockAvailable;
    if (qty > available) {
      if (qtyEl) qtyEl.style.borderColor = 'var(--danger)';
      if (infoEl) infoEl.innerHTML = `<span style="color:var(--danger)">⚠️ Cantidad mayor al disponible (${available})</span>`;
    } else {
      if (qtyEl) qtyEl.style.borderColor = '';
      if (infoEl) infoEl.innerHTML = `<span style="color:var(--ok)">✓ Disponible: <b>${available}</b> · Usando: <b>${qty}</b> · Queda: <b>${available - qty}</b></span>`;
    }
  }
  _partsRecalc();
}

function _partsRecalc() {
  const origin = document.getElementById('pnew-origin')?.value || 'externo';
  const qty = parseFloat(document.getElementById('pnew-qty')?.value) || 0;
  const cost = origin === 'stock' ? (parseFloat(document.getElementById('pnew-cost')?.value) || 0) : 0;
  const subtotalEl = document.getElementById('pnew-subtotal');
  if (subtotalEl) subtotalEl.value = origin === 'stock' ? ('$' + Math.round(qty * cost).toLocaleString('es-AR')) : 'OC a cotizar';
}

async function _partsSave() {
  const otId = window._labCurrentOtId;
  if (!otId) { showToast('error', 'No hay OT seleccionada'); return; }
  if (window._labCurrentOtClosed) { showToast('info', 'La OT está cerrada: no se puede modificar'); return; }

  const origin = document.getElementById('pnew-origin')?.value || 'externo';
  const name = (document.getElementById('pnew-name')?.value || '').trim();
  const qty = parseFloat(document.getElementById('pnew-qty')?.value);
  const unit = document.getElementById('pnew-unit')?.value || 'un';
  const unit_cost = origin === 'stock' ? (parseFloat(document.getElementById('pnew-cost')?.value) || 0) : 0;

  if (!name || name.length < 2) { showToast('error', 'Ingresá el nombre del repuesto'); return; }
  if (!qty || qty <= 0) { showToast('error', 'Cantidad inválida'); return; }
  if (origin === 'stock' && !window._pnewCatalogId) { showToast('error', 'Seleccioná un repuesto del pañol o cambiá a Externo'); return; }
  if (origin === 'stock' && !window._pnewLoc) { showToast('error', 'Elegí la ubicación de la que sale el repuesto'); return; }
  if (origin === 'stock' && qty > window._pnewStockAvailable) { showToast('error', `Cantidad mayor al stock disponible en esa ubicación (${window._pnewStockAvailable})`); return; }

  const payload = { name, origin, qty, unit, unit_cost };
  if (origin === 'stock') {
    payload.catalog_id = window._pnewCatalogId;
    payload.base_location = window._pnewLoc.base_location;
    payload.area = window._pnewLoc.area;
  }

  try {
    const r = await apiFetch(`/api/workorders/${otId}/parts`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error'); return; }
    showToast('ok', origin === 'externo' ? `Repuesto externo agregado: ${name} · OC generada para Compras` : `Repuesto agregado: ${name}`);
    closeModal();
    // Refrescar stock global (si vino del pañol) y reabrir modal edit
    try { await loadInitialData(); } catch(e) {}
    openEditOTModal(otId);
  } catch(err) {
    showToast('error', err.message);
  }
}

async function _partsDelete(partId, wasFromStock) {
  const otId = window._labCurrentOtId;
  if (!otId) return;
  if (window._labCurrentOtClosed) return showToast('info', 'La OT está cerrada: no se puede modificar');
  const msg = wasFromStock
    ? '¿Eliminar este repuesto? La cantidad se devolverá al stock.'
    : '¿Eliminar este repuesto?';
  if (!confirm(msg)) return;
  try {
    const r = await apiFetch(`/api/workorders/${otId}/parts/${partId}`, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error'); return; }
    const data = await r.json();
    showToast('ok', data.restored_to_stock ? 'Repuesto eliminado y devuelto al stock' : 'Repuesto eliminado');
    // Refrescar stock global y la lista
    try { await loadInitialData(); } catch(e) {}
    _partsLoadList();
  } catch(err) {
    showToast('error', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  MODAL HISTORIAL DE VEHÍCULO (OTs + OCs + Combustible)
//  Accesible desde Costos operativos (botón "Ver historial")
// ═══════════════════════════════════════════════════════════

function openVehicleHistoryModal(vehicleCode) {
  const v = (App.data.vehicles || []).find(x => x.code === vehicleCode);
  if (!v) { showToast('error', 'Vehículo no encontrado'); return; }

  // Traer OTs del vehículo
  const ots = (App.data.workOrders || []).filter(o =>
    o.vehicle === vehicleCode || o.vehicle_id === v.id
  ).slice(0, 10);

  // Traer OCs del vehículo (las que tengan vehicle_id asociado)
  const ocs = (App.data.purchaseOrders || []).filter(p =>
    p.vehicle_id === v.id || p.vehicle_code === vehicleCode
  ).slice(0, 10);

  // Traer cargas de combustible
  const fuels = (App.data.fuel || []).filter(f =>
    f.vehicle === vehicleCode || f.vehicle_id === v.id
  ).slice(0, 10);

  const statusColors = {
    'Pendiente': 'var(--warn)',
    'En proceso': 'var(--accent)',
    'Cerrada': 'var(--ok)',
    'Esperando repuesto': 'var(--warn)',
    'Esperando tercerizado': 'var(--warn)',
    'Asignada': 'var(--text2)',
  };

  const ocStatusColors = {
    'pendiente_cotizacion': 'var(--warn)',
    'en_cotizacion':        'var(--accent)',
    'aprobada_compras':     'var(--accent)',
    'pagada':               'var(--ok)',
    'recibida':             'var(--ok)',
    'rechazada':            'var(--danger)',
  };

  openModal(`📋 Historial completo — ${escapeHtml(v.code)} (${escapeHtml(v.plate || '—')})`, `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;font-size:12px">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        <div><b>${escapeHtml(v.brand || '—')} ${escapeHtml(v.model || '')}</b></div>
        <div>Año: ${v.year || '—'}</div>
        <div>Km: ${v.km ? v.km.toLocaleString('es-AR') : '—'}</div>
        <div>Estado: <span style="color:var(--${v.status==='ok'?'ok':v.status==='taller'?'warn':'danger'})">${v.status || '—'}</span></div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">
      <div class="kpi-card info" style="padding:12px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Órdenes de trabajo</div>
        <div style="font-size:24px;font-weight:700;color:var(--accent)">${ots.length}</div>
        <div style="font-size:10px;color:var(--text3)">últimas 10</div>
      </div>
      <div class="kpi-card info" style="padding:12px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Órdenes de compra</div>
        <div style="font-size:24px;font-weight:700;color:var(--accent)">${ocs.length}</div>
        <div style="font-size:10px;color:var(--text3)">últimas 10</div>
      </div>
      <div class="kpi-card info" style="padding:12px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Cargas combustible</div>
        <div style="font-size:24px;font-weight:700;color:var(--accent)">${fuels.length}</div>
        <div style="font-size:10px;color:var(--text3)">últimas 10</div>
      </div>
    </div>

    <!-- OTs -->
    <div style="margin-bottom:18px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">🔧 Órdenes de trabajo recientes</div>
      ${ots.length === 0 ? '<div style="color:var(--text3);font-size:12px;padding:10px;text-align:center">Sin OTs registradas para esta unidad</div>' : `
        <table style="width:100%;font-size:12px">
          <thead>
            <tr style="color:var(--text3);font-size:11px">
              <th style="text-align:left;padding:6px">Código</th>
              <th style="text-align:left;padding:6px">Fecha</th>
              <th style="text-align:left;padding:6px">Tipo</th>
              <th style="text-align:left;padding:6px">Descripción</th>
              <th style="text-align:right;padding:6px">Costo</th>
              <th style="text-align:left;padding:6px">Estado</th>
            </tr>
          </thead>
          <tbody>
            ${ots.map(o => `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px;font-family:var(--mono);font-weight:600"><a onclick="closeModal();navigate('workorders');setTimeout(()=>{const ot=(App.data.workOrders||[]).find(x=>x.id==='${o.id}'||x.code==='${escapeJsArg(o.code || o.id)}');if(ot)openEditOTModal(ot.id);},200)" style="color:var(--accent);cursor:pointer">${escapeHtml(o.code || o.id)}</a></td>
              <td style="padding:8px">${(o.opened || o.created_at || '—').toString().slice(0,10)}</td>
              <td style="padding:8px">${o.type || '—'}</td>
              <td style="padding:8px">${escapeHtml((o.desc || o.description || '—').substring(0, 50))}</td>
              <td style="padding:8px;text-align:right;font-family:var(--mono)">$${Math.round((o.parts_cost||0)+(o.labor_cost||0)).toLocaleString('es-AR')}</td>
              <td style="padding:8px"><span style="color:${statusColors[o.status] || 'var(--text3)'};font-weight:600">● ${o.status || '—'}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      `}
    </div>

    <!-- OCs -->
    <div style="margin-bottom:18px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">🛒 Órdenes de compra recientes</div>
      ${ocs.length === 0 ? '<div style="color:var(--text3);font-size:12px;padding:10px;text-align:center">Sin OCs registradas para esta unidad</div>' : `
        <table style="width:100%;font-size:12px">
          <thead>
            <tr style="color:var(--text3);font-size:11px">
              <th style="text-align:left;padding:6px">Código</th>
              <th style="text-align:left;padding:6px">Fecha</th>
              <th style="text-align:left;padding:6px">Proveedor</th>
              <th style="text-align:right;padding:6px">Total</th>
              <th style="text-align:left;padding:6px">Estado</th>
            </tr>
          </thead>
          <tbody>
            ${ocs.map(p => `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px;font-family:var(--mono);font-weight:600">${escapeHtml(p.code || '—')}</td>
              <td style="padding:8px">${(p.created_at || '—').toString().slice(0,10)}</td>
              <td style="padding:8px">${escapeHtml(p.proveedor || '—')}</td>
              <td style="padding:8px;text-align:right;font-family:var(--mono)">$${Math.round(p.factura_monto || p.total_estimado || 0).toLocaleString('es-AR')}</td>
              <td style="padding:8px"><span style="color:${ocStatusColors[p.status] || 'var(--text3)'};font-weight:600">● ${p.status || '—'}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      `}
    </div>

    <!-- Combustible -->
    <div style="margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">⛽ Cargas de combustible recientes</div>
      ${fuels.length === 0 ? '<div style="color:var(--text3);font-size:12px;padding:10px;text-align:center">Sin cargas de combustible registradas</div>' : `
        <table style="width:100%;font-size:12px">
          <thead>
            <tr style="color:var(--text3);font-size:11px">
              <th style="text-align:left;padding:6px">Fecha</th>
              <th style="text-align:right;padding:6px">Litros</th>
              <th style="text-align:right;padding:6px">$/L</th>
              <th style="text-align:right;padding:6px">Total</th>
              <th style="text-align:right;padding:6px">Km</th>
            </tr>
          </thead>
          <tbody>
            ${fuels.map(f => `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px">${(f.date || f.created_at || '—').toString().slice(0,10)}</td>
              <td style="padding:8px;text-align:right;font-family:var(--mono)">${f.liters || '—'}</td>
              <td style="padding:8px;text-align:right;font-family:var(--mono)">$${Math.round((f.ppu != null ? f.ppu : f.price_per_l) || 0).toLocaleString('es-AR')}</td>
              <td style="padding:8px;text-align:right;font-family:var(--mono);color:var(--accent);font-weight:600">$${Math.round(f.total != null ? f.total : (f.liters||0)*((f.ppu != null ? f.ppu : f.price_per_l)||0)).toLocaleString('es-AR')}</td>
              <td style="padding:8px;text-align:right;font-family:var(--mono)">${f.km ? f.km.toLocaleString('es-AR') : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      `}
    </div>

    <div style="font-size:10px;color:var(--text3);text-align:center;padding-top:10px;border-top:1px solid var(--border)">
      Mostrando las últimas 10 entradas de cada tipo. Para ver historial completo, ir al módulo correspondiente.
    </div>
  `, [
    { label: '🔧 Ir a OTs', cls: 'btn-secondary', fn: () => { closeModal(); navigate('workorders'); } },
    { label: '🛒 Ir a OCs', cls: 'btn-secondary', fn: () => { closeModal(); navigate('purchase_orders'); } },
    { label: 'Cerrar', cls: 'btn-primary', fn: closeModal },
  ]);
}

// ═══════════════════════════════════════════════════════════
//  COMBUSTIBLE — buscador, filtros, ver ticket, exportar PDF
// ═══════════════════════════════════════════════════════════

function _fuelIsCisternaVehicleLog(f) {
  if (!f) return false;
  const place = String(f.place || f.location || '').toLowerCase();
  return !!f.tank_id || place.includes('cisterna');
}

function _fuelVehicleTicketCode(f) {
  if (!f) return 'CV-0000';
  const rawDate = f.logged_at || f.date || new Date().toISOString();
  const d = new Date(rawDate);
  const ymd = isNaN(d.getTime()) ? todayISO().replace(/-/g,'') : d.toISOString().slice(0,10).replace(/-/g,'');
  return `CV-${ymd}-${String(f.id || '').slice(0,6).toUpperCase()}`;
}

function _fuelProductLabel(type) {
  const t = String(type || '').toLowerCase();
  return t === 'urea' ? 'Urea / AdBlue' : 'Gasoil';
}

function openFuelVehicleTicket(logId) {
  const f = (App.data.fuelLogs || []).find(x => x.id === logId);
  if (!f) { showToast('error', 'No se encontró la carga'); return; }

  // Lectura: km para vehículos, horas para autoelevadores (se guarda en f.km).
  const _tv = (App.data.vehicles||[]).find(x => x.code === f.vehicle);
  const _tUnit  = (_tv && isAutoelevador(_tv)) ? 'h' : 'km';
  const _tLabel = (_tv && isAutoelevador(_tv)) ? 'Horómetro' : 'Odómetro';

  const verPrecios = _fuelPuedeVerPrecios(App.currentUser?.role);
  const code = _fuelVehicleTicketCode(f);
  const fecha = f.logged_at ? new Date(f.logged_at).toLocaleString('es-AR') : (f.date || '—');
  const litros = Math.round(parseFloat(f.liters) || 0).toLocaleString('es-AR');
  const ppuVal = parseFloat(f.ppu || 0);
  const totalVal = (parseFloat(f.liters)||0) * (parseFloat(f.ppu)||0);

  openModal(`🧾 Ticket ${code}`, `
    <div id="fuel-vehicle-ticket-print" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:18px">
      <div style="display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:14px">
        <div>
          <div style="font-size:18px;font-weight:900;color:var(--text)">Expreso Biletta SRL</div>
          <div style="font-size:12px;color:var(--text3)">Salida de cisterna a vehículo</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:900;color:var(--accent);font-family:var(--mono)">${code}</div>
          <div style="font-size:11px;color:var(--text3)">${fecha}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
        <div><b>Unidad</b><br>${f.vehicle || '—'}</div>
        <div><b>Patente</b><br>${escapeHtml(f.plate || '—')}</div>
        <div><b>Producto</b><br>${_fuelProductLabel(f.fuel_type)}</div>
        <div><b>Litros cargados</b><br>${litros} L</div>
        <div><b>${_tLabel}</b><br>${f.km ? f.km.toLocaleString('es-AR') + ' ' + _tUnit : '—'}</div>
        <div><b>Lugar / cisterna</b><br>${f.place || 'Cisterna'}</div>
        <div><b>Chofer</b><br>${escapeHtml(f.driver || '—')}</div>
        <div><b>Cargó</b><br>${escapeHtml(f.cargado_por || App.currentUser?.name || '—')}</div>
        <div><b>Estado</b><br>Ticket interno generado</div>
        ${verPrecios ? `<div><b>Precio/L</b><br>${ppuVal ? '$' + Math.round(ppuVal).toLocaleString('es-AR') : '—'}</div><div><b>Total</b><br>${totalVal ? '$' + Math.round(totalVal).toLocaleString('es-AR') : '—'}</div>` : ''}
      </div>

      <div style="margin-top:14px;background:var(--bg3);border-radius:var(--radius);padding:10px;font-size:12px;color:var(--text2)">
        Este ticket se genera automáticamente al registrar una carga desde cisterna propia. Sirve como comprobante interno para imprimir o archivar.
      </div>
    </div>
  `, [
    { label:'🖨 Imprimir ticket', cls:'btn-primary', fn: () => printFuelVehicleTicket(logId) },
    { label:'Cerrar', cls:'btn-secondary', fn: closeModal }
  ]);
}

function printFuelVehicleTicket(logId) {
  const f = (App.data.fuelLogs || []).find(x => x.id === logId);
  if (!f) { showToast('error', 'No se encontró la carga'); return; }

  const verPrecios = _fuelPuedeVerPrecios(App.currentUser?.role);
  const code = _fuelVehicleTicketCode(f);
  const fecha = f.logged_at ? new Date(f.logged_at).toLocaleString('es-AR') : (f.date || '—');
  const litros = Math.round(parseFloat(f.liters) || 0).toLocaleString('es-AR');
  const ppuVal = parseFloat(f.ppu || 0);
  const totalVal = (parseFloat(f.liters)||0) * (parseFloat(f.ppu)||0);
  const priceHtml = verPrecios ? `
    <div><b>Precio/L</b>${ppuVal ? '$' + Math.round(ppuVal).toLocaleString('es-AR') : '—'}</div>
    <div><b>Total</b>${totalVal ? '$' + Math.round(totalVal).toLocaleString('es-AR') : '—'}</div>
  ` : '';

  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>${code}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111827}
      .ticket{border:1px solid #d1d5db;border-radius:10px;padding:18px;max-width:720px;margin:auto}
      .head{display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding-bottom:12px;margin-bottom:14px}
      .brand{font-size:20px;font-weight:800}.sub{font-size:12px;color:#6b7280}.code{font:700 16px monospace;color:#2563eb;text-align:right}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px}.box{background:#f3f4f6;border-radius:8px;padding:10px;margin-top:14px;font-size:12px}
      b{display:block;margin-bottom:3px;color:#374151}@media print{button{display:none}}
    </style></head><body>
      <div class="ticket">
        <div class="head"><div><div class="brand">Expreso Biletta SRL</div><div class="sub">Salida de cisterna a vehículo</div></div><div><div class="code">${code}</div><div class="sub">${fecha}</div></div></div>
        <div class="grid">
          <div><b>Unidad</b>${f.vehicle || '—'}</div><div><b>Patente</b>${escapeHtml(f.plate || '—')}</div>
          <div><b>Producto</b>${_fuelProductLabel(f.fuel_type)}</div><div><b>Litros cargados</b>${litros} L</div>
          <div><b>${_tLabel}</b>${f.km ? f.km.toLocaleString('es-AR') + ' ' + _tUnit : '—'}</div><div><b>Lugar / cisterna</b>${f.place || 'Cisterna'}</div>
          <div><b>Chofer</b>${escapeHtml(f.driver || '—')}</div><div><b>Cargó</b>${escapeHtml(f.cargado_por || App.currentUser?.name || '—')}</div><div><b>Estado</b>Ticket interno generado</div>
          ${priceHtml}
        </div>
        <div class="box">Comprobante interno generado automáticamente por FleetOS al descontar litros de cisterna propia.</div>
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);}<\/script>
    </body></html>`);
  win.document.close();
}

// Render de una fila de la tabla de combustible (refactorizada para poder filtrar)
function _renderFuelLogRows(logs) {
  const verPrecios = _fuelPuedeVerPrecios(App.currentUser?.role);
  const colspan = verPrecios ? 11 : 9;
  if (!logs || logs.length === 0) {
    return `<tr><td colspan="${colspan}" style="text-align:center;color:var(--text3);padding:24px">Sin cargas registradas con los filtros actuales</td></tr>`;
  }
  return logs.map(f => {
    // La lectura se guarda en f.km, pero para autoelevadores son HORAS, no km.
    const veh = (App.data.vehicles||[]).find(x => x.code === f.vehicle);
    const isFork = !!veh && isAutoelevador(veh);
    const readUnit  = isFork ? 'h' : 'km';
    const readLabel = isFork ? 'Horómetro' : 'Odómetro';
    return `<tr>
    <td data-label="Fecha" class="td-mono" style="font-size:11px">${f.date || '—'}</td>
    <td data-label="Unidad" class="td-main">${f.vehicle || '—'}</td>
    <td data-label="Chofer">${escapeHtml(f.driver || '—')}${f.cargado_por && f.cargado_por !== '—' && f.cargado_por !== f.driver ? `<div style="font-size:10px;color:var(--text3)">cargó: ${escapeHtml(f.cargado_por)}</div>` : ''}</td>
    <td data-label="Tipo"><span class="badge ${f.fuel_type==='urea'?'badge-info':'badge-ok'}" style="font-size:10px">${f.fuel_type==='urea'?'🔵 Urea':'🟡 Gasoil'}</span></td>
    <td data-label="Litros" class="td-mono">${f.liters || 0} L</td>
    <td data-label="${readLabel}" class="td-mono">${f.km > 0 ? f.km.toLocaleString('es-AR')+' '+readUnit : '—'}</td>
    ${verPrecios ? `
      <td data-label="Precio/L" class="td-mono">$${(f.ppu||0).toLocaleString('es-AR')}</td>
      <td data-label="Total" class="td-mono" style="font-weight:600;color:var(--accent)">$${(f.total||0).toLocaleString('es-AR')}</td>
    ` : ''}
    <td data-label="Lugar">${f.place || '—'}</td>
    <td data-label="Estado"><span class="badge ${f.ticket_estado==='verificado'?'badge-ok':(f.ticket_estado==='observado'?'badge-warn':'badge-info')}">${f.ticket_estado ? ('Ticket ' + f.ticket_estado) : (f.status||'—')}</span></td>
    <td data-label="">
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
        ${_fuelIsCisternaVehicleLog(f)
          ? `<button class="btn btn-secondary btn-sm" onclick="openFuelVehicleTicket('${f.id}')" title="Ticket interno de cisterna a vehículo">🧾 Ticket</button>`
          : (f.ticket_image
              ? `<button class="btn btn-secondary btn-sm" onclick="viewTicket('${f.id}')" title="Ver foto del ticket">📷 Foto</button>`
              : '<span style="color:var(--text3);font-size:11px">sin ticket</span>')}
        ${f.ticket_image && _fuelIsCisternaVehicleLog(f)
          ? `<button class="btn btn-secondary btn-sm" onclick="viewTicket('${f.id}')" title="Ver foto adjunta">📷</button>`
          : ''}
        ${App.currentUser?.role === 'dueno' ? `<button class="btn btn-danger btn-sm" onclick="deleteFuelLog('${f.id}','${f.vehicle}',${f.liters})" title="Eliminar" style="padding:4px 8px">🗑</button>` : ''}
      </div>
    </td>
  </tr>`;
  }).join('');
}

// Filtrar cargas por texto de búsqueda y tipo (con paginación)
function _filterFuelLogs() {
  const q = (document.getElementById('fuel-search')?.value || '').toLowerCase().trim();
  const typeFilter = document.getElementById('fuel-type-filter')?.value || 'all';
  const tbody = document.getElementById('fuel-logs-tbody');
  const countInfo = document.getElementById('fuel-count-info');

  // Resetear paginación si cambió el filtro
  window._fuelPageSize = window._fuelPageSize || 10;

  let filtered = App.data.fuelLogs || [];

  // Filtro por tipo
  if (typeFilter === 'diesel') {
    filtered = filtered.filter(f => f.fuel_type !== 'urea');
  } else if (typeFilter === 'urea') {
    filtered = filtered.filter(f => f.fuel_type === 'urea');
  }

  // Filtro por texto (busca en unidad, chofer, fecha, lugar)
  if (q) {
    filtered = filtered.filter(f => {
      const hay = [f.vehicle, f.driver, f.date, f.place, f.plate].filter(Boolean)
        .map(s => String(s).toLowerCase());
      return hay.some(h => h.includes(q));
    });
  }

  // Paginación: mostrar solo los primeros N
  const shown = filtered.slice(0, window._fuelPageSize);

  if (tbody) tbody.innerHTML = _renderFuelLogRows(shown);

  if (countInfo) {
    const total = (App.data.fuelLogs || []).length;
    const totalLitros = filtered.reduce((a,b) => a + (b.liters||0), 0);
    const totalPesos  = filtered.reduce((a,b) => a + (b.total||0), 0);
    // Mostramos "Ver más" si quedan filas cargadas por revelar, o si el backend
    // todavía puede tener más cargas para traer (historial completo).
    const verMasBtn = (filtered.length > window._fuelPageSize || !window._fuelAllLoaded)
      ? ` · <a onclick="_fuelLoadMore()" style="color:var(--accent);cursor:pointer;font-weight:600">Ver más →</a>`
      : '';

    if (filtered.length === total) {
      countInfo.innerHTML = `Mostrando <b>${shown.length}</b> de ${total} cargas · <b>${Math.round(totalLitros).toLocaleString('es-AR')}</b> L · $${Math.round(totalPesos).toLocaleString('es-AR')}${verMasBtn}`;
    } else {
      countInfo.innerHTML = `Mostrando <b>${shown.length}</b> de ${filtered.length} filtrados (${total} total) · <b>${Math.round(totalLitros).toLocaleString('es-AR')}</b> L · $${Math.round(totalPesos).toLocaleString('es-AR')}${verMasBtn}`;
    }
  }
}

// Cargar 10 más en la tabla de combustible. Si ya revelamos casi todo lo que
// hay en memoria y el backend puede tener más, traemos la próxima página.
async function _fuelLoadMore() {
  window._fuelPageSize = (window._fuelPageSize || 10) + 10;
  if (window._fuelPageSize >= (App.data.fuelLogs || []).length && !window._fuelAllLoaded) {
    await _fuelFetchMore();
  }
  _filterFuelLogs();
}

// Trae la próxima página de cargas desde el backend (offset = lo ya cargado).
async function _fuelFetchMore() {
  try {
    const offset = (App.data.fuelLogs || []).length;
    const res = await apiFetch(`/api/fuel?limit=100&offset=${offset}`);
    if (!res.ok) { window._fuelAllLoaded = true; return; }
    const more = await res.json();
    if (!Array.isArray(more) || more.length < 100) window._fuelAllLoaded = true;
    if (Array.isArray(more) && more.length) {
      // Las páginas siguientes vienen CRUDAS del backend: hay que pasarlas por el
      // mismo mapper que la carga inicial (roles.js), si no quedan sin unidad/fecha/
      // precio y los litros como texto (rompía la suma → "NaN L"). Los datos en la
      // base están completos; esto es solo el formateo del frontend.
      const mapped = (typeof _mapFuelLog === 'function') ? more.map(_mapFuelLog) : more;
      App.data.fuelLogs = (App.data.fuelLogs || []).concat(mapped);
      App.data.fuel = App.data.fuelLogs;
    }
  } catch (e) { /* no rompemos la UI si falla la página extra */ }
}

// Exportar cargas filtradas a PDF
function exportFuelPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast?.('error','jsPDF no cargado. Refrescá la página.');
    return;
  }

  // Aplicar mismos filtros que la tabla
  const q = (document.getElementById('fuel-search')?.value || '').toLowerCase().trim();
  const typeFilter = document.getElementById('fuel-type-filter')?.value || 'all';
  let filtered = App.data.fuelLogs || [];
  if (typeFilter === 'diesel') filtered = filtered.filter(f => f.fuel_type !== 'urea');
  else if (typeFilter === 'urea') filtered = filtered.filter(f => f.fuel_type === 'urea');
  if (q) {
    filtered = filtered.filter(f => {
      const hay = [f.vehicle, f.driver, f.date, f.place, f.plate].filter(Boolean).map(s => String(s).toLowerCase());
      return hay.some(h => h.includes(q));
    });
  }

  if (filtered.length === 0) { showToast('warn', 'No hay cargas con los filtros actuales'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  const startY = _pdfHeader(
    doc,
    'Cargas de combustible',
    `${filtered.length} carga${filtered.length===1?'':'s'}${q?` · Filtro: "${q}"`:''}${typeFilter!=='all'?` · Tipo: ${typeFilter}`:''}`
  );

  const totalLitros = filtered.reduce((a,b) => a + (b.liters||0), 0);
  const totalPesos  = filtered.reduce((a,b) => a + (b.total||0), 0);

  const tableData = filtered.map(f => {
    const veh = (App.data.vehicles||[]).find(x => x.code === f.vehicle);
    const readUnit = veh && isAutoelevador(veh) ? 'h' : 'km';
    return [
    f.date || '—',
    f.vehicle || '—',
    f.driver || '—',
    f.fuel_type === 'urea' ? 'Urea' : 'Gasoil',
    (f.liters||0).toString() + ' L',
    f.km > 0 ? f.km.toLocaleString('es-AR') + ' ' + readUnit : '—',
    '$' + (f.ppu||0).toLocaleString('es-AR'),
    '$' + (f.total||0).toLocaleString('es-AR'),
    f.place || '—',
    f.status || '—',
  ]; });

  doc.autoTable({
    startY: startY,
    head: [['Fecha','Unidad','Chofer','Tipo','Litros','Odóm./Horóm.','Precio/L','Total','Lugar','Estado']],
    body: tableData,
    ..._pdfTableStyle(),
    columnStyles: {
      0: { cellWidth: 75 },
      1: { cellWidth: 60, fontStyle: 'bold' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right', fontStyle: 'bold' },
    },
    foot: [[
      'TOTALES', '', '', '',
      Math.round(totalLitros).toLocaleString('es-AR') + ' L',
      '', '',
      '$' + Math.round(totalPesos).toLocaleString('es-AR'),
      '', '',
    ]],
  });

  doc.save(`Combustible-Biletta-${todayISO()}.pdf`);
  showToast('ok', `PDF descargado · ${filtered.length} cargas`);
}

// Ver ticket (imagen) de una carga — mejorado
function viewTicket(logId) {
  const f = (App.data.fuelLogs || []).find(x => x.id === logId);
  if (!f) { showToast('error', 'Carga no encontrada'); return; }

  if (!f.ticket_image) {
    if (_fuelIsCisternaVehicleLog(f)) {
      openFuelVehicleTicket(logId);
      return;
    }
    openModal('🧾 Ticket de carga', `
      <div style="text-align:center;padding:20px">
        <div style="font-size:36px;margin-bottom:12px">📭</div>
        <div style="font-size:14px;color:var(--text3)">Esta carga no tiene ticket adjunto.</div>
        <div style="font-size:12px;color:var(--text3);margin-top:12px">
          Fecha: <b>${f.date}</b> · Unidad: <b>${f.vehicle}</b><br>
          Litros: <b>${f.liters} L</b> · Total: <b>$${(f.total||0).toLocaleString('es-AR')}</b>
        </div>
      </div>
    `, [{ label:'Cerrar', cls:'btn-primary', fn: closeModal }]);
    return;
  }

  openModal(`🧾 Ticket — ${f.vehicle} · ${f.date}`, `
    <div style="background:var(--bg3);padding:10px;border-radius:var(--radius);margin-bottom:14px;font-size:12px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
      <div><b>Unidad</b><br>${f.vehicle}</div>
      <div><b>Chofer</b><br>${escapeHtml(f.driver || '—')}</div>
      <div><b>Litros</b><br>${f.liters} L</div>
      <div><b>Total</b><br>$${(f.total||0).toLocaleString('es-AR')}</div>
    </div>
    <div style="text-align:center;background:#000;padding:10px;border-radius:var(--radius);max-height:70vh;overflow:auto">
      <img src="${f.ticket_image}" alt="Ticket de carga"
        style="max-width:100%;max-height:65vh;border-radius:4px;display:block;margin:0 auto">
    </div>
    <div style="font-size:11px;color:var(--text3);text-align:center;margin-top:8px">
      Click derecho → "Guardar imagen como..." para descargar
    </div>
  `, [
    { label:'Cerrar', cls:'btn-primary', fn: closeModal },
  ]);
}

// ═══════════════════════════════════════════════════════════
//  HELPER DE ORDENAMIENTO DE TABLAS
//  Permite click en headers para ordenar asc/desc
// ═══════════════════════════════════════════════════════════

// Estado global de ordenamiento (una por tabla)
window._sortState = window._sortState || {};

// Ordena un array por una columna. Si ya estaba ordenado por la misma, invierte.
function sortTableData(tableKey, data, getField) {
  const currentSort = window._sortState[tableKey];
  const newDir = (currentSort?.dir === 'asc') ? 'desc' : 'asc';
  window._sortState[tableKey] = { field: getField.toString(), dir: newDir };

  return [...data].sort((a, b) => {
    const va = getField(a);
    const vb = getField(b);
    // Numérico
    if (typeof va === 'number' && typeof vb === 'number') {
      return newDir === 'asc' ? va - vb : vb - va;
    }
    // Fechas
    const da = new Date(va), db = new Date(vb);
    if (!isNaN(da) && !isNaN(db)) {
      return newDir === 'asc' ? da - db : db - da;
    }
    // Strings
    const sa = String(va || '').toLowerCase();
    const sb = String(vb || '').toLowerCase();
    if (sa < sb) return newDir === 'asc' ? -1 : 1;
    if (sa > sb) return newDir === 'asc' ? 1 : -1;
    return 0;
  });
}

// Render de icono de ordenamiento (para headers)
function sortIcon(tableKey, fieldKey) {
  const s = window._sortState[tableKey];
  if (!s || s.field !== fieldKey) return '<span style="opacity:.3">⇅</span>';
  return s.dir === 'asc' ? '<span style="color:var(--accent)">↑</span>' : '<span style="color:var(--accent)">↓</span>';
}

// Ordenamiento de la tabla de combustible por campo
function _fuelSortBy(field) {
  window._fuelSort = window._fuelSort || { field: null, dir: 'desc' };

  // Si clickean el mismo campo, invertir dirección
  if (window._fuelSort.field === field) {
    window._fuelSort.dir = window._fuelSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    window._fuelSort.field = field;
    window._fuelSort.dir = 'desc';  // Default: descendente (más nuevo primero)
  }

  // Ordenar el array maestro (para que afecte tanto a la vista como a exportación)
  App.data.fuelLogs.sort((a, b) => {
    const va = a[field];
    const vb = b[field];
    let cmp = 0;

    if (field === 'date') {
      cmp = new Date(va || 0) - new Date(vb || 0);
    } else if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb;
    } else {
      cmp = String(va || '').localeCompare(String(vb || ''));
    }

    return window._fuelSort.dir === 'asc' ? cmp : -cmp;
  });

  // Resetear todos los iconos
  ['date','vehicle','driver','liters','total'].forEach(f => {
    const el = document.getElementById('fuel-sort-' + f);
    if (el) { el.textContent = '⇅'; el.style.opacity = '.3'; el.style.color = ''; }
  });

  // Marcar el campo activo
  const icon = document.getElementById('fuel-sort-' + field);
  if (icon) {
    icon.textContent = window._fuelSort.dir === 'asc' ? '↑' : '↓';
    icon.style.opacity = '1';
    icon.style.color = 'var(--accent)';
  }

  // Re-renderizar la tabla con los filtros actuales
  _filterFuelLogs();
}
