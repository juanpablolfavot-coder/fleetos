// ═══════════════════════════════════════════
//  FleetOS — Motor de datos y lógica central
// ═══════════════════════════════════════════

// ── HELPERS DE FECHA/HORA EN ZONA HORARIA ARGENTINA ──
// Resuelve el bug de que toISOString() devuelve UTC (3h adelante).
// Todos los inputs type=date y los timestamps visibles deben usar estos helpers.

// YYYY-MM-DD en zona horaria local (Argentina)
function todayISO() {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

// YYYY-MM-DDTHH:MM para inputs datetime-local
function nowDatetimeLocal() {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

// Hora "HH:MM" en formato argentino
function nowTimeAR() {
  return new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
}

// Fecha "DD/MM/YYYY" en formato argentino
function nowDateAR() {
  return new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

// Exponer globalmente por si otros archivos las necesitan
window.todayISO = todayISO;
window.nowDatetimeLocal = nowDatetimeLocal;
window.nowTimeAR = nowTimeAR;
window.nowDateAR = nowDateAR;

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
  const t = { dashboard:'Panel general', fleet:'Flota y vehículos', workorders:'Órdenes de trabajo', fuel:'Combustible y urea', tires:'Cubiertas y neumáticos', stock:'Stock y pañol', documents:'Documentación', costs:'Costos operativos', maintenance:'Mantenimiento', chofer_panel:'Mi panel', encargado_panel:'Operativo del día', contador_panel:'Panel contable', auditor_panel:'Panel de auditoría', assets:'Activos patrimoniales' };
  return t[p] || 'FleetOS';
}
function getPageSub(p) {
  const s = { dashboard:`Vista ejecutiva · Flota ${(App.data.vehicles||[]).length} unidades`, fleet:'Administración y ficha técnica de activos', workorders:'Gestión de intervenciones técnicas', fuel:'Control de cisternas y consumo', tires:'Mapa por eje · trazabilidad', stock:'Repuestos · insumos · alertas', documents:'Vencimientos y cumplimiento', costs:'Análisis financiero por unidad', maintenance:'Preventivo · predictivo · correctivo', chofer_panel:'Novedades y cargas', encargado_panel:'Checklists · novedades · combustible', contador_panel:'Costos · reportes · KPIs', auditor_panel:'Anomalías · trazabilidad · log de acciones', assets:'Edificios · herramientas · equipos · informática' };
  return s[p] || '';
}

function renderPage(page) {
  const fns = { dashboard: renderDashboard, fleet: renderFleet, workorders: renderWorkOrders, fuel: renderFuel, tires: renderTires, stock: renderStock, documents: renderDocuments, costs: renderCosts, maintenance: renderMaintenance, chofer_panel: renderChoferPanel, encargado_panel: renderEncargadoPanel, contador_panel: renderContadorPanel, auditor_panel: renderAuditorPanel, users: renderUsers, config: renderConfig, purchase_orders: renderPurchaseOrders, suppliers: renderSuppliers, assets: renderAssets };
  if (fns[page]) fns[page]();
}

// ── DASHBOARD ──
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
    const cur = parseFloat(s.qty_current) || 0;
    const min = parseFloat(s.qty_min) || 0;
    return min > 0 && cur <= min;
  });
  const ocsRevision = (App.data.purchaseOrders||[]).filter(p => p.status === 'pendiente_cotizacion' || p.status === 'en_cotizacion');
  const ocsAprobadas = (App.data.purchaseOrders||[]).filter(p => p.status === 'aprobada_compras' || p.status === 'pagada');

  // Mantenimientos vencidos (>=95% del intervalo)
  const maintAlerts = v.map(veh => {
    const km = veh.km || 0;
    const ts = veh.tech_spec || {};
    const interval = parseInt(ts.maint_interval_km) || 15000;
    const pct = interval > 0 ? (km % interval / interval * 100) : 0;
    return { code: veh.code, pct: Math.round(pct), km, interval, nextKm: Math.ceil(km/interval)*interval };
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
      text: `OT <b>${o.id || o.code}</b> creada (${o.vehicle || '—'})`,
      action: `navigate('workorders')`,
    });
  });
  (App.data.purchaseOrders||[]).slice(0, 3).forEach(p => {
    if (!p.created_at) return;
    actividad.push({
      when: new Date(p.created_at),
      icon: '🛒',
      text: `OC <b>${p.code}</b> · ${p.proveedor || '—'} · ${p.status}`,
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

  // ═══ HTML DEL PANEL ═══
  document.getElementById('page-dashboard').innerHTML = `
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

    <!-- BLOQUE 1: PENDIENTES CRÍTICOS (6 tarjetas accionables) -->
    <div class="card" style="margin-bottom:16px;${totalPendientes > 0 ? 'border-left:4px solid var(--danger)' : 'border-left:4px solid var(--ok)'}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div class="card-title" style="margin:0">${totalPendientes > 0 ? '🔥 Requieren tu atención hoy' : '✅ Todo al día'}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">${totalPendientes > 0 ? `${totalPendientes} pendientes críticos` : 'Ningún pendiente crítico ahora mismo'}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">
        <div onclick="navigate('documents')" style="cursor:pointer;background:${dangerDocs.length>0?'rgba(239,68,68,.12)':'var(--bg3)'};border:1px solid ${dangerDocs.length>0?'rgba(239,68,68,.3)':'var(--border)'};border-radius:var(--radius);padding:12px;transition:all .15s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">📄 Docs vencidos</div>
          <div style="font-size:22px;font-weight:700;color:${dangerDocs.length>0?'var(--danger)':'var(--text3)'}">${dangerDocs.length}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">${dangerDocs.length>0?'requieren renovar':'todo al día'}</div>
        </div>
        <div onclick="navigate('workorders')" style="cursor:pointer;background:${otsUrgentes.length>0?'rgba(239,68,68,.12)':'var(--bg3)'};border:1px solid ${otsUrgentes.length>0?'rgba(239,68,68,.3)':'var(--border)'};border-radius:var(--radius);padding:12px;transition:all .15s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">🚨 OTs urgentes</div>
          <div style="font-size:22px;font-weight:700;color:${otsUrgentes.length>0?'var(--danger)':'var(--text3)'}">${otsUrgentes.length}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">${otsAbiertas.length} abiertas total</div>
        </div>
        <div onclick="navigate('maintenance')" style="cursor:pointer;background:${maintVencidos.length>0?'rgba(239,68,68,.12)':'var(--bg3)'};border:1px solid ${maintVencidos.length>0?'rgba(239,68,68,.3)':'var(--border)'};border-radius:var(--radius);padding:12px;transition:all .15s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">🔧 Mant. vencidos</div>
          <div style="font-size:22px;font-weight:700;color:${maintVencidos.length>0?'var(--danger)':'var(--text3)'}">${maintVencidos.length}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">${maintProximos.length} próximos</div>
        </div>
        <div onclick="navigate('purchase_orders')" style="cursor:pointer;background:${ocsRevision.length>0?'rgba(245,158,11,.12)':'var(--bg3)'};border:1px solid ${ocsRevision.length>0?'rgba(245,158,11,.3)':'var(--border)'};border-radius:var(--radius);padding:12px;transition:all .15s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">🛒 OCs por aprobar</div>
          <div style="font-size:22px;font-weight:700;color:${ocsRevision.length>0?'var(--warn)':'var(--text3)'}">${ocsRevision.length}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">${ocsAprobadas.length} aprobadas</div>
        </div>
        <div onclick="navigate('stock')" style="cursor:pointer;background:${stockBajo.length>0?'rgba(245,158,11,.12)':'var(--bg3)'};border:1px solid ${stockBajo.length>0?'rgba(245,158,11,.3)':'var(--border)'};border-radius:var(--radius);padding:12px;transition:all .15s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">📦 Stock bajo</div>
          <div style="font-size:22px;font-weight:700;color:${stockBajo.length>0?'var(--warn)':'var(--text3)'}">${stockBajo.length}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">${stockBajo.length>0?'necesitan reposición':'todo abastecido'}</div>
        </div>
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
  `;

  // ═══ FLEET GRID ═══
  const grid = document.getElementById('fleet-grid-mini');
  v.forEach(vc => {
    const cls = {ok:'ok',warn:'warn',taller:'danger',detenida:'danger'}[vc.status]||'ok';
    const el = document.createElement('div');
    el.className = `fleet-unit ${cls}`;
    el.textContent = vc.code;
    el.title = `${vc.code} — ${vc.brand||''} ${vc.model||''} — ${(vc.status||'').toUpperCase()}`;
    el.addEventListener('click', () => { navigate('fleet'); setTimeout(()=>filterVehicle(vc.code),100); });
    grid.appendChild(el);
  });

  // ═══ ALERTAS ═══
  const alertsEl = document.getElementById('dash-alerts');
  const detainedVehicles = v.filter(x => x.status === 'detenida');
  let html = '';
  detainedVehicles.forEach(veh => {
    html += `<div class="alert-row danger"><span>⚠</span><span class="alert-text"><b>${veh.code}</b> — Unidad detenida en base.</span></div>`;
  });
  dangerDocs.forEach(d => {
    html += `<div class="alert-row danger"><span>⚠</span><span class="alert-text"><b>${d.vehicle||d.displayName||'—'}</b> — ${d.type} vencido (${d.expiry})</span></div>`;
  });
  maintVencidos.forEach(m => {
    html += `<div class="alert-row danger"><span>🔧</span><span class="alert-text"><b>${m.code}</b> — Mantenimiento VENCIDO — ${m.km.toLocaleString('es-AR')} / ${m.nextKm.toLocaleString('es-AR')} km</span></div>`;
  });
  maintProximos.slice(0,3).forEach(m => {
    html += `<div class="alert-row warn"><span>🔧</span><span class="alert-text"><b>${m.code}</b> — Mantenimiento próximo (${m.pct}%) — faltan ${(m.nextKm-m.km).toLocaleString('es-AR')} km</span></div>`;
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
        <td class="td-mono">${(()=>{const logs=(App.data.fuelLogs||[]).filter(x=>x.vehicle===f.vehicle&&x.km>0).sort((a,b)=>a.km-b.km);if(logs.length>=2){const diff=logs[logs.length-1].km-logs[0].km;const lts=logs.reduce((a,x)=>a+x.liters,0);return diff>0&&lts>0?(diff/lts).toFixed(1)+' km/L':'—'}return '—'})()}</td>
        <td><span class="badge ${f.status==='OK'?'badge-ok':'badge-warn'}">${f.status}</span></td>
      </tr>`).join('')}
    </tbody></table>`;

  // ═══ OCs recientes ═══
  const ocEl = document.getElementById('dash-oc');
  const recentOCs = (App.data.purchaseOrders||[]).slice(0,5);
  const ocStatusBadge = {
    'pendiente_cotizacion': 'badge-warn',
    'en_cotizacion':        'badge-info',
    'aprobada_compras':     'badge-info',
    'pagada':               'badge-ok',
    'recibida':             'badge-ok',
    'rechazada':            'badge-danger',
  };
  ocEl.innerHTML = recentOCs.length === 0
    ? '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px">Sin órdenes de compra todavía</div>'
    : `<table><thead><tr><th>OC</th><th>Proveedor</th><th>Total</th><th>Estado</th></tr></thead><tbody>
      ${recentOCs.map(p => `<tr>
        <td class="td-mono"><b>${p.code}</b></td>
        <td>${(p.proveedor || '—').substring(0, 22)}</td>
        <td class="td-mono">$${Math.round(parseFloat(p.factura_monto) || parseFloat(p.total_estimado) || 0).toLocaleString('es-AR')}</td>
        <td><span class="badge ${ocStatusBadge[p.status] || 'badge-gray'}">${(p.status||'').replace('_',' ')}</span></td>
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

  const actions = [
    { label:'Nueva OT',   cls:'btn-primary',   fn: () => { closeModal(); openNewOTModal(v.code); } },
    { label:'Editar',     cls:'btn-secondary', fn: () => openEditVehicleModal(id) },
    { label:'Cerrar',     cls:'btn-secondary', fn: closeModal },
  ];
  // Solo el dueño puede dar de baja una unidad
  if (App.currentUser?.role === 'dueno') {
    actions.splice(2, 0, { label:'🗑 Dar de baja', cls:'btn-danger', fn: () => confirmBajaVehiculo(id, v.code) });
  }
  openModal(`${v.code} — ${v.brand} ${v.model}`, header + tabBar + `<div id="ficha-tab-content">${content}</div>`, actions);
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
  const ot_tipo   = window._otTipoActual || 'vehiculo';
  const target_id = document.getElementById('ot-target-select')?.value || '';
  const title      = (document.getElementById('ot-title')?.value || '').trim();
  const priority   = document.getElementById('ot-priority')?.value || 'Normal';
  const labor_cost = parseFloat(document.getElementById('ot-labor')?.value) || 0;
  const notes      = (document.getElementById('ot-notes')?.value || '').trim();

  // Repuestos — leer directo del DOM (incluye origin + stock_id si aplica)
  const parts = [];
  document.querySelectorAll('[id^="otp-name-"]').forEach(nameEl => {
    const idx   = nameEl.id.replace('otp-name-', '');
    const name  = nameEl.value.trim();
    if (!name || name.length < 2) return;

    // Leer el selector de origen (Externo / Pañol)
    const originEl = document.getElementById('otp-origin-' + idx);
    const origin = originEl?.value === 'stock' ? 'stock' : 'externo';
    // Si es del pañol, el stock_id está en dataset del input de nombre
    const stock_id = (origin === 'stock') ? (nameEl.dataset.stockId || null) : null;

    // Si eligió pañol pero no vinculó → tratar como externo (no fallar)
    const finalOrigin = (origin === 'stock' && !stock_id) ? 'externo' : origin;

    parts.push({
      name,
      qty:       parseFloat(document.getElementById('otp-qty-'  + idx)?.value) || 1,
      unit:      document.getElementById('otp-unit-' + idx)?.value || 'un',
      unit_cost: parseFloat(document.getElementById('otp-cost-' + idx)?.value) || 0,
      origin:    finalOrigin,
      stock_id:  (finalOrigin === 'stock') ? stock_id : null,
    });
  });

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
    labor_cost
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
  showToast('ok', `OT ${ot.code} creada · Repuestos: $${Math.round(ot.parts_cost||0).toLocaleString()} · MO: $${Math.round(ot.labor_cost||0).toLocaleString()}`);
  await afterSave({ page: 'workorders' });
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

    <!-- ⏱ PARTES DE TRABAJO (opción B) ──────────────────────── -->
    <div style="margin:16px 0 8px;padding-top:12px;border-top:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div>
          <label class="form-label" style="margin:0;font-weight:700">⏱️ Partes de trabajo (mano de obra propia)</label>
          <div style="font-size:11px;color:var(--text3)">Quién trabajó y cuánto. Se suma automáticamente al costo MO.</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="_labAddRow()">+ Agregar parte</button>
      </div>
      <div id="eo-labor-list" style="margin-bottom:8px">
        <div style="text-align:center;padding:12px;color:var(--text3);font-size:12px">⏳ Cargando partes...</div>
      </div>
      <div id="eo-labor-total" style="text-align:right;font-size:13px;padding:6px 10px;background:var(--bg3);border-radius:var(--radius);display:none">
        Total MO de partes: <strong id="eo-labor-total-val" style="color:var(--accent)">$0</strong>
        <span style="color:var(--text3);font-size:11px">· <span id="eo-labor-total-hours">0</span>h</span>
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
        <label class="form-label">Costo mano de obra ($)
          <span style="font-size:10px;color:var(--text3);font-weight:400">· autocalculado desde los partes</span>
        </label>
        <input class="form-input" type="number" id="eo-labor" value="${ot.labor_cost||0}" readonly style="background:var(--bg3)">
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
          <div style="font-size:11px;color:var(--text3)">Agregá repuestos del pañol o de compras externas. Se suma automáticamente al costo.</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="_partsAddRow()">+ Agregar repuesto</button>
      </div>
      <div id="eo-parts-list" style="margin-bottom:8px">
        <div style="text-align:center;padding:12px;color:var(--text3);font-size:12px">⏳ Cargando repuestos...</div>
      </div>
      <div id="eo-parts-total" style="text-align:right;font-size:13px;padding:6px 10px;background:var(--bg3);border-radius:var(--radius);display:none">
        Total repuestos: <strong id="eo-parts-total-val" style="color:var(--accent)">$0</strong>
      </div>
    </div>
  `, [
    { label:'Guardar cambios', cls:'btn-primary',   fn: () => saveEditOT(id) },
    { label:'Cancelar',        cls:'btn-secondary', fn: closeModal }
  ]);

  // Guardar el ID de la OT en una variable global del modal
  window._labCurrentOtId = ot._uuid || ot.id;
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
  const labor      = parseFloat(document.getElementById('eo-labor')?.value)  || ot.labor_cost  || 0;
  const parts_cost = parseFloat(document.getElementById('eo-parts')?.value)  || ot.parts_cost  || 0;
  const woUUID = ot._uuid || ot.id;
  const res = await apiFetch(`/api/workorders/${woUUID}`, {
    method: 'PUT',
    body: JSON.stringify({ status, mechanic_id: null, description: desc, labor_cost: labor, parts_cost, priority })
  });
  if (!res.ok) { showToast('error', 'Error al actualizar OT'); return; }
  ot.status = status; ot.desc = desc; ot.priority = priority; ot.labor_cost = labor; ot.parts_cost = parts_cost;
  closeModal();
  showToast('ok', `${id} actualizada correctamente`);
  await afterSave({ page: 'workorders' });
}


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
      ${(App.currentUser?.role === 'mecanico') ?
        '<div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--warn)">El costo de mano de obra debe ser cargado por el Jefe de Mantenimiento.</div>'
        : `<div class="form-group"><label class="form-label">Costo mano de obra ($) <span style="font-size:10px;color:var(--text3);font-weight:400">· autocalculado desde los partes</span></label><input class="form-input" type="number" id="cl-labor" value="${parseFloat(ot.labor_cost)||0}" readonly style="background:var(--bg3)"></div>`
      }
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

async function closeOTConfirmed(id) {
  const ot = App.data.workOrders.find(o=>o.id===id);
  if (!ot) return;
  const causa  = document.getElementById('cl-causa')?.value  || '—';
  const labor  = parseFloat(document.getElementById('cl-labor')?.value) || 0;

  // Descontar repuestos del modal
  const parts = [];
  let descuentos = 0;
  document.querySelectorAll('.cl-part-row').forEach(row => {
    const stockId = row.dataset.stockId;
    const qty     = parseFloat(row.dataset.qty) || 0;
    const name    = row.dataset.name || '';
    const cost    = parseFloat(row.dataset.cost) || 0;
    if (stockId && qty > 0) {
      parts.push({ stock_id: stockId, name, qty, unit_cost: cost, origin: 'stock' });
      descuentos++;
    }
  });

  const woUUID = ot._uuid || ot.id;
  const res = await apiFetch(`/api/workorders/${woUUID}/close`, {
    method: 'POST',
    body: JSON.stringify({ root_cause: causa, labor_cost: labor, close_parts: parts })
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error || 'Error al cerrar OT'); return; }

  ot.status = 'Cerrada'; ot.labor_cost = labor;
  closeModal();
  showToast('ok', `${id} cerrada${descuentos>0?' · '+descuentos+' ítems descontados del stock':''}`);
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
  const laborTotal = laborData.reduce((a, l) => a + (parseFloat(l.subtotal) || 0), 0);
  const laborHours = laborData.reduce((a, l) => a + (parseFloat(l.hours) || 0), 0);
  // labor_cost de la OT (por si es distinto del calculado, priorizamos el del backend)
  const laborCostFinal = laborTotal > 0 ? laborTotal : (parseFloat(ot.labor_cost) || 0);
  const totalCost = partsTotal + laborCostFinal;

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
        <td>${p.name || '—'}</td>
        <td style="text-align:center">${qty} ${p.unit || 'un'}</td>
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
      const rate = parseFloat(l.rate) || 0;
      const subtotal = parseFloat(l.subtotal) || (hours * rate);
      const fecha = l.work_date ? new Date(l.work_date).toLocaleDateString('es-AR') : '—';
      laborRows += `<tr>
        <td>${l.worker_name || '—'}</td>
        <td style="text-align:center">${fecha}</td>
        <td style="text-align:right">${hours.toFixed(2)} h</td>
        <td style="text-align:right">$${Math.round(rate).toLocaleString('es-AR')}/h</td>
        <td style="text-align:right;font-weight:600">$${Math.round(subtotal).toLocaleString('es-AR')}</td>
      </tr>`;
    });
  } else {
    laborRows = `<tr><td colspan="5" style="padding:10px;color:#9ca3af;text-align:center">Sin partes de trabajo registrados${laborCostFinal > 0 ? ` · Costo MO global: $${Math.round(laborCostFinal).toLocaleString('es-AR')}` : ''}</td></tr>`;
  }

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8">
    <title>Orden de Trabajo ${ot.id} — Biletta</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; padding: 32px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 3px solid #1e3a8a; }
      .logo-wrap { display: flex; align-items: center; gap: 14px; }
      .logo-square { width: 52px; height: 52px; background: #1e3a8a; color: #fff; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; letter-spacing: 1px; }
      .empresa { font-size: 20px; font-weight: 700; color: #111; }
      .empresa-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
      .ot-id { font-size: 22px; font-weight: 700; font-family: monospace; color: #1e3a8a; text-align: right; }
      .ot-date { font-size: 11px; color: #6b7280; text-align: right; margin-top: 4px; }
      .status-bar { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; margin-top: 6px; }
      .status-cerrada { background: #dcfce7; color: #166534; }
      .status-proceso { background: #dbeafe; color: #1e40af; }
      .status-pendiente { background: #fef3c7; color: #92400e; }
      .status-other { background: #f3f4f6; color: #374151; }
      .section { margin-bottom: 22px; }
      .section-title { font-size: 11px; font-weight: 700; color: #1e3a8a; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
      .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
      .field { margin-bottom: 8px; }
      .field-label { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 2px; }
      .field-value { font-size: 13px; font-weight: 500; color: #111; }
      .desc-box { background: #f9fafb; border-left: 3px solid #1e3a8a; padding: 12px; font-size: 13px; line-height: 1.6; color: #374151; border-radius: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; }
      thead tr { background: #eff6ff; }
      th { text-align: left; padding: 8px; border-bottom: 2px solid #1e3a8a; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #1e3a8a; font-weight: 700; }
      td { padding: 7px 8px; border-bottom: 1px solid #f3f4f6; }
      .total-row { background: #f9fafb; }
      .total-row td { padding: 8px; font-weight: 700; border-top: 2px solid #111; }
      .grand-total-row td { background: #1e3a8a; color: #fff; font-size: 15px; padding: 10px 8px; }
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
        <div class="logo-square">B</div>
        <div>
          <div class="empresa">Expreso Biletta S.A.</div>
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
        <div class="field"><div class="field-label">Patente</div><div class="field-value">${v?v.plate:ot.plate||'—'}</div></div>
        <div class="field"><div class="field-label">Marca / Modelo</div><div class="field-value">${v?(v.brand||'')+' '+(v.model||''):'—'}</div></div>
        <div class="field"><div class="field-label">Km al momento</div><div class="field-value">${v?(v.km||0).toLocaleString('es-AR')+' km':'—'}</div></div>
        <div class="field"><div class="field-label">Base operativa</div><div class="field-value">${v?v.base||'—':'—'}</div></div>
        <div class="field"><div class="field-label">Chofer habitual</div><div class="field-value">${v?v.driver||'—':'—'}</div></div>
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
          <th style="text-align:right">Tarifa</th>
          <th style="text-align:right">Subtotal</th>
        </tr></thead>
        <tbody>${laborRows}</tbody>
        ${laborData.length > 0 ? `<tfoot>
          <tr class="total-row">
            <td colspan="2" style="text-align:right">Totales:</td>
            <td style="text-align:right">${laborHours.toFixed(2)} h</td>
            <td></td>
            <td style="text-align:right">$${Math.round(laborCostFinal).toLocaleString('es-AR')}</td>
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
        Repuestos: $${Math.round(partsTotal).toLocaleString('es-AR')} · Mano de obra: $${Math.round(laborCostFinal).toLocaleString('es-AR')}
      </div>
    </div>

    <div class="firma-row">
      <div class="firma-box">Mecánico responsable<br><br><br></div>
      <div class="firma-box">Jefe de mantenimiento<br><br><br></div>
      <div class="firma-box">Conformidad / recepción<br><br><br></div>
    </div>

    <div style="margin-top:32px;font-size:10px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;padding-top:10px">
      Expreso Biletta S.A. · Orden de Trabajo ${ot.id} · Generado el ${nowDateAR()} ${nowTimeAR()}
    </div>

    <script>window.onload=function(){setTimeout(function(){window.print();},200);}<\/script>
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
  const today = todayISO();
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
        <div style="margin-top:16px;display:flex;gap:8px"><button class="btn btn-primary" onclick="openFuelEntryModal()">+ Registrar ingreso a cisterna</button><button class="btn btn-secondary" onclick="openEditTankCapacityModal()">⚙ Editar capacidad</button><button class="btn btn-warn" onclick="openVerificacionTickets()" style="background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.4);color:var(--warn)">🧾 Verificar tickets</button></div>
      </div>
      <div class="card">
        <div class="card-title">Consumo por unidad (últimos 30 días)</div>
        <div style="position:relative;height:180px"><canvas id="fuelChart" role="img" aria-label="Consumo de combustible por unidad"></canvas></div>
      </div>
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
        <button class="btn btn-primary" onclick="openFuelLoadModal()">+ Registrar carga</button>
      </div>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table><thead><tr>
          <th onclick="_fuelSortBy('date')" style="cursor:pointer;user-select:none">Fecha <span id="fuel-sort-date" style="opacity:.3">⇅</span></th>
          <th onclick="_fuelSortBy('vehicle')" style="cursor:pointer;user-select:none">Unidad <span id="fuel-sort-vehicle" style="opacity:.3">⇅</span></th>
          <th onclick="_fuelSortBy('driver')" style="cursor:pointer;user-select:none">Chofer <span id="fuel-sort-driver" style="opacity:.3">⇅</span></th>
          <th>Tipo</th>
          <th onclick="_fuelSortBy('liters')" style="cursor:pointer;user-select:none">Litros <span id="fuel-sort-liters" style="opacity:.3">⇅</span></th>
          <th>Odómetro</th>
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
  const vehicleOpts = (App.data.vehicles||[]).map(v=>`<option value="${v.id}">${v.code} — ${v.plate}</option>`).join('');
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
  setTimeout(() => updateFuelPlaceNote(), 100);
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

async function updateFuelPlaceNote() {
  const place  = document.getElementById('fl-place')?.value || '';
  const type   = document.getElementById('fl-type')?.value  || 'diesel';
  const noteEl = document.getElementById('fl-place-note');
  const ppuEl  = document.getElementById('fl-ppu');
  const ppuWrap     = document.getElementById('fl-ppu-wrap');
  const ticketWrap  = document.getElementById('fl-ticket-wrap');
  if (!noteEl) return;
  const descuenta = place.includes('Cisterna');

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

    const tanks = App.data.tanks || [];
    const tipoDbPrice = type === 'urea' ? 'urea' : 'fuel';
    let tank = tanks.find(t => (t.type === tipoDbPrice || (tipoDbPrice === 'fuel' && t.type === 'gasoil')) && (t.location || '').includes('Cisterna R3'));
    if (!tank) tank = tanks.find(t => t.type === tipoDbPrice || (tipoDbPrice === 'fuel' && t.type === 'gasoil'));
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
      noteEl.innerHTML = `💡 Carga desde cisterna — los litros se descontarán del stock. El precio lo gestiona compras.`;
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

  // Solo descontar de cisterna si el lugar es cisterna
  const esCisterna = place.includes('Cisterna');
  let tank_id = null;
  if (esCisterna) {
    // Matchear el tanque por TIPO + LOCATION (no solo por tipo)
    // Así si hay varios tanques del mismo tipo, elige el correcto según el dropdown
    const tanks = App.data.tanks || [];
    const tipoDb = type === 'urea' ? 'urea' : 'fuel';  // en DB se guarda 'fuel' o 'urea'
    // Primero intento match exacto por location + tipo
    let tank = tanks.find(t => (t.type === tipoDb || (tipoDb === 'fuel' && t.type === 'gasoil')) && t.location === place);
    // Si no encontró con match exacto, busca cualquier tanque del tipo correcto
    if (!tank) {
      tank = tanks.find(t => t.type === tipoDb || (tipoDb === 'fuel' && t.type === 'gasoil'));
    }
    tank_id = tank?.id || null;
    if (!tank_id) {
      showToast('error','No se encontró cisterna para ' + type + ' en ' + place);
      return;
    }
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
  await afterSave({ page: 'fuel' });
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
  const type   = document.getElementById('fe-type')?.value || 'gasoil';
  const liters = parseFloat(document.getElementById('fe-liters')?.value) || 0;
  if (liters <= 0) { showToast('error', 'Ingresá la cantidad de litros'); return; }

  const tanks = App.data.tanks || [];
  const tipoDb = type === 'urea' ? 'urea' : 'fuel';
  // Prefiere el tanque de "Cisterna R3" si existe. Si no, cualquiera del tipo correcto.
  let tank = tanks.find(t => (t.type === tipoDb || (tipoDb === 'fuel' && t.type === 'gasoil')) && (t.location || '').includes('Cisterna R3'));
  if (!tank) {
    tank = tanks.find(t => t.type === tipoDb || (tipoDb === 'fuel' && t.type === 'gasoil'));
  }

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
    body: JSON.stringify(
      _fuelPuedeVerPrecios(App.currentUser?.role)
        ? { current_l: nuevoNivel, price_per_l: parseFloat(document.getElementById('fe-ppu')?.value) || null }
        : { current_l: nuevoNivel }
    )
  });

  if (!res.ok) { showToast('error', 'Error al registrar ingreso'); return; }

  // Actualizar en memoria
  const ppu = _fuelPuedeVerPrecios(App.currentUser?.role) ? (parseFloat(document.getElementById('fe-ppu')?.value) || null) : null;
  tank.current_l = nuevoNivel;
  if (ppu) tank.price_per_l = ppu;
  closeModal();
  showToast('ok', `✅ ${liters.toLocaleString()} L de ${type} ingresados a cisterna — nuevo nivel: ${Math.round(nuevoNivel).toLocaleString()} L`);
  renderFuel();
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
// ─────────────────────────────────────────
function renderTires() {
  const mounted  = App.data.tires.filter(t=>t.vehicle!=='STOCK'&&t.vehicle!=='RECAP'&&t.vehicle!=='RECAPADO'&&t.vehicle!=='BAJA');
  const inStock  = App.data.tires.filter(t=>t.vehicle==='STOCK');
  const inRecap  = App.data.tires.filter(t=>t.vehicle==='RECAPADO');
  const inBaja   = App.data.tires.filter(t=>t.vehicle==='BAJA');
  const crit     = mounted.filter(t=>t.status==='danger').length;
  const warn     = mounted.filter(t=>t.status==='warn').length;

  const vehicleOpts = App.data.vehicles
    .filter(v=>['tractor','camion','semirremolque'].includes(v.type))
    .slice(0,12);

  document.getElementById('page-tires').innerHTML = `
    <div class="kpi-row" style="grid-template-columns:repeat(6,1fr);margin-bottom:20px">
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
      <div class="kpi-card ${inRecap.length>0?'warn':'ok'}">
        <div class="kpi-label">🔄 En recapado</div>
        <div class="kpi-value ${inRecap.length>0?'warn':'ok'}">${inRecap.length}</div>
        <div class="kpi-trend">enviadas a recapar</div>
      </div>
      <div class="kpi-card ${inBaja.length>0?'danger':'ok'}">
        <div class="kpi-label">❌ Dadas de baja</div>
        <div class="kpi-value ${inBaja.length>0?'danger':'ok'}">${inBaja.length}</div>
        <div class="kpi-trend">fuera de servicio</div>
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

   <div class="card" style="margin-bottom:16px"
      ondragover="event.preventDefault()"
      ondrop="onDropToStock(event)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">Stock de cubiertas disponibles para montar</div>
        <button class="btn btn-secondary btn-sm" onclick="openNewTireToStockModal()">+ Agregar al stock</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Serie</th><th>Marca / Modelo</th><th>Medida</th><th>Km acum.</th><th>Dibujo</th><th>Tipo</th><th>Precio compra</th><th></th></tr></thead>
          <tbody id="stock-tires-tbody">${App.data.tires.filter(t=>t.vehicle==='STOCK').map(t=>`<tr
            draggable="true"
            ondragstart="onStockTireDragStart(event,'${t.serial}')"
            style="cursor:grab"
            title="Arrastrá al mapa para montar">
            <td class="td-mono td-main">${t.serial}</td>
            <td>${t.brand}</td>
            <td class="td-mono">${t.size}</td>
            <td class="td-mono">${(t.km||0).toLocaleString()} km</td>
            <td class="td-mono" style="color:var(--ok)">${(t.depth||0)}/${(t.maxDepth||0)}mm</td>
            <td><span class="badge ${t.km===0?'badge-ok':'badge-purple'}">${t.km===0?'Nueva':'Usada/Recapada'}</span></td>
            <td class="td-mono">$${(t.purchase||0).toLocaleString()}</td>
            <td><button class="btn btn-primary btn-sm" onclick="openMountFromStockModal('${t.serial}')">Montar</button></td>
          </tr>`).join('')||'<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:16px">Sin cubiertas en stock</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">🔄 Cubiertas en recapado</div>
        <span style="font-size:12px;color:var(--text3)">${inRecap.length} cubierta${inRecap.length===1?'':'s'} enviada${inRecap.length===1?'':'s'} a recapar</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Serie</th><th>Marca / Modelo</th><th>Medida</th><th>Km acum.</th><th>Dibujo</th><th>Precio compra</th><th></th></tr></thead>
          <tbody>${inRecap.map(t=>`<tr>
            <td class="td-mono td-main">${t.serial}</td>
            <td>${t.brand||'—'}</td>
            <td class="td-mono">${t.size||'—'}</td>
            <td class="td-mono">${(t.km||0).toLocaleString()} km</td>
            <td class="td-mono" style="color:var(--warn)">${(t.tread||0)}mm</td>
            <td class="td-mono">$${(t.price||0).toLocaleString()}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="openTireDetail('${t.serial}')">Acción</button></td>
          </tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:16px">Ninguna cubierta en recapado</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">❌ Cubiertas dadas de baja</div>
        <span style="font-size:12px;color:var(--text3)">${inBaja.length} cubierta${inBaja.length===1?'':'s'} fuera de servicio</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Serie</th><th>Marca / Modelo</th><th>Medida</th><th>Km total</th><th>Último dibujo</th><th>Precio compra</th></tr></thead>
          <tbody>${inBaja.map(t=>`<tr style="opacity:0.7">
            <td class="td-mono td-main">${t.serial}</td>
            <td>${t.brand||'—'}</td>
            <td class="td-mono">${t.size||'—'}</td>
            <td class="td-mono">${(t.km||0).toLocaleString()} km</td>
            <td class="td-mono" style="color:var(--danger)">${(t.tread||0)}mm</td>
            <td class="td-mono">$${(t.price||0).toLocaleString()}</td>
          </tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:16px">Ninguna cubierta dada de baja</td></tr>'}
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
  const config  = getAxleConfig(vehicle);
  renderTireMapDnD(code, config);
  renderTireTableBody(code);
}

// ─────────────────────────────────────────
function onStockTireDragStart(event, serial) {
  _dragSerial  = serial;
  _dragFromPos = 'STOCK';
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', serial);
}

async function onDropToStock(event) {
  event.preventDefault();
  if (!_dragSerial || _dragFromPos === 'STOCK') { _dragSerial = null; _dragFromPos = null; return; }
  const tire = App.data.tires.find(t=>t.serial===_dragSerial);
  if (!tire) { _dragSerial = null; _dragFromPos = null; return; }
  const r = await apiFetch(`/api/tires/${tire.id}/move`, {
    method:'POST',
    body: JSON.stringify({ to_vehicle_id: null, to_position: 'STOCK', type: 'Desmontaje', notes: 'Desmontado al stock por drag & drop' })
  });
  if (r.ok) {
    tire.vehicle = 'STOCK'; tire.pos = null;
    showToast('ok', `${tire.serial} desmontada al stock`);
  } else { showToast('error','Error al desmontar cubierta'); }
  _dragSerial = null; _dragFromPos = null;
  renderTires();
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

async function onTireDrop(event, toPos, vehicleCode) {
  event.preventDefault();
  if (!_dragSerial) return;
  if (_dragFromPos === toPos) { _dragSerial = null; _dragFromPos = null; return; }
  // Si viene del stock, montar directamente
  if (_dragFromPos === 'STOCK') {
    const stockTire = App.data.tires.find(t=>t.serial===_dragSerial);
    const vehicle   = App.data.vehicles.find(v=>v.code===vehicleCode);
    if (!stockTire || !vehicle) { _dragSerial = null; _dragFromPos = null; return; }
    const r = await apiFetch(`/api/tires/${stockTire.id}/move`, {
      method:'POST',
      body: JSON.stringify({ to_vehicle_id: vehicle.id, to_position: toPos, type: 'Montaje', notes: 'Montado desde stock por drag & drop' })
    });
    if (r.ok) { stockTire.vehicle = vehicleCode; stockTire.pos = toPos; showToast('ok', `${stockTire.serial} montada en ${toPos}`); }
    else { showToast('error','Error al montar cubierta'); }
    _dragSerial = null; _dragFromPos = null;
    renderTires(); return;
  }
  const draggedTire = App.data.tires.find(t=>t.serial===_dragSerial);
  if (!draggedTire) return;
  const targetTire  = App.data.tires.find(t=>t.vehicle===vehicleCode && t.pos===toPos);
  const vehicle     = App.data.vehicles.find(v=>v.code===vehicleCode);

  if (targetTire) {
    // Permuta — mover ambas
    const r1 = await apiFetch(`/api/tires/${draggedTire.id}/move`, { method:'POST', body: JSON.stringify({ to_vehicle_id: vehicle?.id, to_position: toPos, type: 'Rotación (permuta)', notes: `Permuta con ${targetTire.serial}` }) });
    const r2 = await apiFetch(`/api/tires/${targetTire.id}/move`,  { method:'POST', body: JSON.stringify({ to_vehicle_id: vehicle?.id, to_position: _dragFromPos, type: 'Rotación (permuta)', notes: `Permuta con ${draggedTire.serial}` }) });
    if (r1.ok && r2.ok) {
      draggedTire.pos = toPos; targetTire.pos = _dragFromPos;
      showToast('ok', `Permuta: ${draggedTire.serial} ↔ ${targetTire.serial}`);
    } else { showToast('error','Error al registrar permuta'); }
  } else {
    const r = await apiFetch(`/api/tires/${draggedTire.id}/move`, { method:'POST', body: JSON.stringify({ to_vehicle_id: vehicle?.id, to_position: toPos, type: 'Rotación', notes: '' }) });
    if (r.ok) {
      draggedTire.pos = toPos; draggedTire.vehicle = vehicleCode;
      showToast('ok', `${draggedTire.serial}: ${_dragFromPos} → ${toPos}`);
    } else { showToast('error','Error al registrar movimiento'); }
  }

  _dragSerial = null; _dragFromPos = null;
  renderTires();
}


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
    <td class="td-mono">${(t.km||0).toLocaleString()}</td>
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
            ? stock.map(t=>`<option value="${t.serial}" ${t.serial===serial?'selected':''}>${t.serial} · ${t.brand} · ${t.km===0?'Nueva':'Usada '+(t.km||0).toLocaleString()+'km'} · ${t.depth}mm dibujo</option>`).join('')
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
        <input class="form-input" type="date" id="ms-date" value="${todayISO()}">
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

async function saveMountTire(vehicleCode) {
  const serial  = document.getElementById('ms-serial')?.value || '';
  const pos     = document.getElementById('ms-pos')?.value    || '';
  const obs     = (document.getElementById('ms-obs')?.value   || '').trim();
  if (!serial) { showToast('warn','Seleccioná una cubierta del stock'); return; }
  if (!pos)    { showToast('warn','Seleccioná la posición de montaje');  return; }
  const tire = App.data.tires.find(t=>t.serial===serial);
  if (!tire)   { showToast('warn','Cubierta no encontrada');             return; }

  const res = await apiFetch(`/api/tires/${tire.id}/move`, {
    method: 'POST',
    body: JSON.stringify({ to_vehicle_id: App.data.vehicles.find(v=>v.code===vehicleCode)?.id, to_position: pos, type: 'Montaje', notes: obs })
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error al montar cubierta'); return; }

  tire.vehicle = vehicleCode; tire.pos = pos; tire.status = 'montada';
  closeModal();
  showToast('ok', `${serial} montada en ${vehicleCode} posición ${pos}`);
  renderTires();
}


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

async function saveNewTireToStock() {
  const serial  = (document.getElementById('ns-serial')?.value  || '').trim();
  const brand   = (document.getElementById('ns-brand')?.value   || '').trim();
  const model   = (document.getElementById('ns-model')?.value   || '').trim();
  const size    = (document.getElementById('ns-size')?.value    || '295/80R22.5').trim();
  const depth   = parseFloat(document.getElementById('ns-depth')?.value)  || null;
  const km      = parseInt(document.getElementById('ns-km')?.value)        || 0;
  const price   = parseFloat(document.getElementById('ns-price')?.value)   || null;
  const supplier= (document.getElementById('ns-supplier')?.value || '').trim();

  if (!serial) { showToast('warn','El número de serie es obligatorio'); return; }
  if (!brand)  { showToast('warn','La marca es obligatoria');           return; }
  if (App.data.tires.find(t=>t.serial===serial)) { showToast('warn','Ya existe una cubierta con ese número de serie'); return; }

  const res = await apiFetch('/api/tires', {
    method: 'POST',
    body: JSON.stringify({ serial_no: serial, brand, model, size, tread_depth: depth, purchase_price: price, supplier_name: supplier })
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error al registrar cubierta'); return; }
  const t = await res.json();

  App.data.tires.push({ id: t.id, serial, brand, model, size, depth, km, price, pos:'Stock', vehicle:null, status:'stock' });
  closeModal();
  showToast('ok', `Cubierta ${serial} agregada al stock`);
  renderTires();
}


function openTireDetail(serial) {
  const t = App.data.tires.find(x=>x.serial===serial);
  if (!t) return;
  const hist     = App.data.tireHistory.filter(h=>h.serial===serial);
  const depthPct = Math.round((t.depth / t.maxDepth) * 100);
  const cpkm     = t.km > 0 ? ((t.purchase||0) / t.km).toFixed(2) : '—';

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
        <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--text)">${(t.purchase||0).toLocaleString()}</div>
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
      <tr><td style="color:var(--text3);padding:5px 0">Precio compra</td><td class="td-mono">$${(t.purchase||0).toLocaleString()}</td></tr>
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
        <input class="form-input" type="number" id="td-depth" value="${t.depth||0}" min="0" max="${t.maxDepth||20}">
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

async function saveTireAction(serial) {
  const t = App.data.tires.find(x => x.serial === serial);
  if (!t) return;

  const action = document.getElementById('td-action')?.value || '';
  const obs    = (document.getElementById('td-obs')?.value || '').trim();
  const depth  = parseFloat(document.getElementById('td-depth')?.value);
  const goStock = document.getElementById('td-stock')?.checked;

  if (!action) { showToast('warn','Seleccioná una acción'); return; }

  // Acción "depth" = solo actualizar profundidad, sin mover de posición
  if (action === 'depth') {
    if (isNaN(depth) || depth < 0) { showToast('warn','Ingresá una profundidad válida en mm'); return; }
    const res = await apiFetch(`/api/tires/${t.id}/depth`, {
      method: 'POST',
      body: JSON.stringify({ depth_mm: depth, notes: obs })
    });
    if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error al actualizar profundidad'); return; }
    // Actualizar los campos que usa el render
    t.depth = depth;
    t.depth_mm = depth;
    // Recalcular status según el porcentaje de desgaste
    if (t.maxDepth && t.maxDepth > 0) {
      const pct = (depth / t.maxDepth) * 100;
      t.status = pct < 25 ? 'danger' : (pct < 50 ? 'warn' : 'ok');
    }
    closeModal();
    showToast('ok', `${serial}: profundidad actualizada a ${depth}mm`);
    // Recargar todos los datos del sistema para reflejar cambios en todas las vistas
    try { await loadInitialData(); } catch(e) {}
    renderTires();
    return;
  }

  // Acciones que mueven la cubierta: stock / recap / baja
  const typeMap = { stock:'Desmontaje', recap:'Envío recapado', baja:'Baja definitiva' };
  const toPos   = { stock:'Stock', recap:'Recapado', baja:'Baja' }[action];

  if (!typeMap[action]) { showToast('warn','Acción no válida'); return; }

  const res = await apiFetch(`/api/tires/${t.id}/move`, {
    method: 'POST',
    body: JSON.stringify({ to_vehicle_id: null, to_position: toPos, type: typeMap[action], notes: obs })
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error al registrar acción'); return; }

  const vehicleMap = { stock: 'STOCK', recap: 'RECAPADO', baja: 'BAJA' };   t.vehicle = vehicleMap[action];
  t.pos = toPos;
  t.status = toPos.toLowerCase();

  closeModal();
  const msgs = {
    stock: `${serial} desmontada y enviada al stock`,
    recap: `${serial} enviada a recapado`,
    baja:  `${serial} dada de baja definitivamente`
  };
  showToast('ok', msgs[action]);
  // Recargar todos los datos para reflejar cambios (cubierta montada/desmontada afecta vehículos)
  try { await loadInitialData(); } catch(e) {}
  renderTires();
}


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
        <input class="form-input" type="date" id="mm-date" value="${todayISO()}">
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

async function saveManualMove(vehicleCode) {
  const serial  = document.getElementById('mm-serial')?.value || '';
  const fromPos = (document.getElementById('mm-from')?.value  || '').trim();
  const toPos   = (document.getElementById('mm-to')?.value    || '').trim();
  const obs     = (document.getElementById('mm-obs')?.value   || '').trim();
  if (!fromPos || !toPos) { showToast('warn','Completá las posiciones de origen y destino'); return; }
  const t = App.data.tires.find(x=>x.serial===serial);
  if (!t) { showToast('warn','Cubierta no encontrada'); return; }

  const res = await apiFetch(`/api/tires/${t.id}/move`, {
    method: 'POST',
    body: JSON.stringify({ to_vehicle_id: App.data.vehicles.find(v=>v.code===vehicleCode)?.id, to_position: toPos, type: 'Rotación', notes: obs })
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error al registrar movimiento'); return; }

  t.pos = toPos;
  closeModal();
  showToast('ok', `Movimiento registrado: ${serial} ${fromPos} → ${toPos}`);
  renderTires();
}


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

async function saveStockEgreso(stockId) {
  const s   = App.data.stock.find(function(x){ return x.id===stockId; });
  if (!s) return;
  const qty    = parseFloat(document.getElementById('eg-qty')?.value)    || 0;
  const reason = (document.getElementById('eg-ref')?.value || '').trim();
  if (qty <= 0)   { showToast('warn','Ingresá una cantidad'); return; }
  if (qty > s.qty){ showToast('warn','Stock insuficiente. Disponible: '+s.qty+' '+s.unit); return; }

  const res = await apiFetch(`/api/stock/${stockId}/egreso`, {
    method: 'POST',
    body: JSON.stringify({ qty, reason: reason || 'Egreso manual' })
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error al registrar egreso'); return; }

  s.qty -= qty;
  closeModal();
  showToast('ok', 'Egreso registrado: '+qty+' '+s.unit+' de '+s.name);
  renderStock();
}


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

async function saveStockBaja() {
  const role = App.currentUser?.role || '';
  if (role !== 'dueno' && role !== 'gerencia') {
    showToast('warn','Solo el dueño o gerencia puede dar de baja ítems del pañol');
    return;
  }
  const id     = document.getElementById('bj-id')?.value;
  const qty    = parseFloat(document.getElementById('bj-qty')?.value)   || 0;
  const obs    = (document.getElementById('bj-obs')?.value   || '').trim();
  const motivo = document.getElementById('bj-motivo')?.value || 'otro';
  const s      = App.data.stock.find(function(x){ return x.id===id; });
  if (!id)         { showToast('warn','Seleccioná un ítem'); return; }
  if (!obs || obs.length < 10) { showToast('warn','El motivo debe tener al menos 10 caracteres'); return; }
  if (!s)          { showToast('warn','Ítem no encontrado'); return; }
  if (qty > s.qty) { showToast('warn','Cantidad mayor al stock disponible ('+s.qty+')'); return; }

  const res = await apiFetch(`/api/stock/${id}/baja`, {
    method: 'POST',
    body: JSON.stringify({ qty, reason: obs, motive: motivo })
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error al registrar baja'); return; }

  s.qty -= qty;
  closeModal();
  showToast('ok', 'Baja registrada: '+qty+' '+s.unit+' de '+s.name+' — Motivo: '+motivo);
  renderStock();
}


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

async function saveStockAjuste() {
  const id     = document.getElementById('aj-id')?.value;
  const newQty = parseFloat(document.getElementById('aj-qty')?.value);
  const reason = (document.getElementById('aj-obs')?.value || '').trim();
  const s      = App.data.stock.find(function(x){ return x.id===id; });
  if (!s || isNaN(newQty)) { showToast('warn','Completá todos los campos'); return; }

  const res = await apiFetch(`/api/stock/${id}/ajuste`, {
    method: 'POST',
    body: JSON.stringify({ new_qty: newQty, reason: reason || 'Recuento físico' })
  });
  if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error al ajustar'); return; }

  s.qty = newQty;
  closeModal();
  showToast('ok', 'Inventario ajustado: '+s.name+' → '+newQty+' '+s.unit);
  renderStock();
}


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
  const code     = (document.getElementById('ns-code')?.value  || '').trim();
  const name     = (document.getElementById('ns-name')?.value  || '').trim();
  const category = document.getElementById('ns-cat')?.value    || 'general';
  const unit     = document.getElementById('ns-unit')?.value   || 'un';
  const qty      = parseFloat(document.getElementById('ns-qty')?.value)   || 0;
  const min_qty  = parseFloat(document.getElementById('ns-min')?.value)   || 0;
  const cost     = parseFloat(document.getElementById('ns-cost')?.value)  || 0;
  const supplier = (document.getElementById('ns-supplier')?.value || '').trim();

  if (!code) { showToast('error','Ingresá el código del ítem'); return; }
  if (!name) { showToast('error','Ingresá el nombre / descripción del ítem'); return; }

  // IMPORTANTE: el backend espera qty_current y qty_min (nombres reales de la columna),
  // no qty y min_qty. Sin este mapeo, el stock inicial quedaba en 0.
  const res = await apiFetch('/api/stock', {
    method: 'POST',
    body: JSON.stringify({
      code, name, category, unit,
      qty_current: qty,
      qty_min: min_qty,
      qty_reorder: Math.max(min_qty * 2, 1),
      unit_cost: cost,
      supplier: supplier || null
    })
  });
  if (!res.ok) { const e=await res.json(); showToast('error', e.error||'Error al guardar stock'); return; }

  closeModal();
  showToast('ok', `Ítem "${name}" creado con stock inicial de ${qty} ${unit}`);
  // El auto-refresh ya va a re-cargar la data
}


function renderDocuments() {
  const docs = App.data.documents || [];
  const expired = docs.filter(d=>d.status==='danger').length;
  const nearExp  = docs.filter(d=>d.status==='warn').length;
  const vehicleDocs = docs.filter(d => !d.isUser).length;
  const userDocs    = docs.filter(d => d.isUser).length;

  document.getElementById('page-documents').innerHTML = `
    <div class="kpi-row kpi-row-3" style="margin-bottom:20px">
      <div class="kpi-card ${expired===0?'ok':'danger'}"><div class="kpi-label">Documentos vencidos</div><div class="kpi-value ${expired===0?'ok':'danger'}">${expired}</div><div class="kpi-trend">requieren acción inmediata</div></div>
      <div class="kpi-card ${nearExp===0?'ok':'warn'}"><div class="kpi-label">Vencen en 30 días</div><div class="kpi-value ${nearExp===0?'ok':'warn'}">${nearExp}</div><div class="kpi-trend">programar renovación</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Documentos al día</div><div class="kpi-value ok">${docs.filter(d=>d.status==='ok').length}</div><div class="kpi-trend">sin vencimientos próximos</div></div>
    </div>
    <div class="section-header">
      <div>
        <div class="section-title">Control de vencimientos</div>
        <div class="section-sub">🚛 ${vehicleDocs} documento${vehicleDocs!==1?'s':''} de vehículos · 👤 ${userDocs} documento${userDocs!==1?'s':''} de choferes</div>
      </div>
      <button class="btn btn-primary" onclick="openNewDocModal()">+ Cargar documento</button>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tipo</th><th>Titular</th><th>Referencia</th><th>Documento</th><th>Vencimiento</th><th>Días restantes</th><th>Nº / Observaciones</th><th>Estado</th><th></th></tr></thead>
          <tbody>${docs.map((d,idx)=>{
            const days = Math.ceil((new Date(d.expiry)-new Date())/86400000);
            const iconoTipo = d.isUser ? '👤' : '🚛';
            const tipoLabel = d.isUser ? 'Chofer' : 'Vehículo';
            return `<tr>
              <td><span style="font-size:13px">${iconoTipo}</span> <span style="font-size:11px;color:var(--text3)">${tipoLabel}</span></td>
              <td class="td-main">${d.vehicle || '—'}</td>
              <td class="td-mono" style="color:var(--text3);font-size:11px">${d.plate||'—'}</td>
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

async function saveRenewDoc(idx) {
  const newExpiry = (document.getElementById('rn-expiry')?.value || '').trim();
  const obs       = (document.getElementById('rn-obs')?.value    || '').trim();
  const ref       = (document.getElementById('rn-ref')?.value    || '').trim();
  if (!newExpiry) { showToast('warn','Ingresá la nueva fecha de vencimiento'); return; }
  const d = App.data.documents[idx];
  if (!d) return;

  const res = await apiFetch(`/api/documents/${d.id}`, {
    method: 'PUT',
    body: JSON.stringify({ expiry_date: newExpiry, notes: obs, reference: ref })
  });
  if (!res.ok) { showToast('error','Error al renovar documento'); return; }

  d.expiry = newExpiry; d.ref = ref; d.notes = obs;
  closeModal();
  showToast('ok', `${d.type} de ${d.vehicle} renovado — nuevo vencimiento: ${newExpiry}`);
  renderDocuments();
}


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

async function saveEditDoc(idx) {
  const newExpiry = (document.getElementById('ed-expiry')?.value || '').trim();
  const obs       = (document.getElementById('ed-obs')?.value    || '').trim();
  const ref       = (document.getElementById('ed-ref')?.value    || '').trim();
  if (!newExpiry) { showToast('warn','La fecha de vencimiento es obligatoria'); return; }
  const d = App.data.documents[idx];
  if (!d) return;

  const res = await apiFetch(`/api/documents/${d.id}`, {
    method: 'PUT',
    body: JSON.stringify({ expiry_date: newExpiry, notes: obs, reference: ref })
  });
  if (!res.ok) { showToast('error','Error al actualizar documento'); return; }

  d.expiry = newExpiry; d.ref = ref; d.notes = obs;
  closeModal();
  showToast('ok', 'Documento actualizado correctamente');
  renderDocuments();
}


function openNewDocModal() {
  const choferes = (App.data.users || []).filter(u => u.role === 'chofer' || u.role === 'dueno' || u.role === 'gerencia' || u.role === 'jefe_mantenimiento' || u.role === 'mecanico');
  const vehiculos = App.data.vehicles || [];

  const vehOpts = vehiculos.map(v => `<option value="${v.id}" data-code="${v.code}" data-plate="${v.plate||''}">${v.code} — ${v.plate||'sin patente'} · ${v.brand||''} ${v.model||''}</option>`).join('');
  const userOpts = choferes.map(u => `<option value="${u.id}" data-name="${u.name}">${u.name} · ${u.role}</option>`).join('');

  openModal('Cargar nuevo documento', `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--text3)">
      💡 Cargá el documento de un <b>vehículo</b> (VTV, seguro, RTO, etc.) o de un <b>chofer</b> (registro profesional, curso CNRT, libreta sanitaria, etc.)
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Tipo de titular *</label>
        <select class="form-select" id="nd-entity-type" onchange="_docToggleEntityType()">
          <option value="vehicle">🚛 Vehículo</option>
          <option value="user">👤 Chofer / Personal</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Tipo de documento *</label>
        <select class="form-select" id="nd-type">
          <optgroup label="Vehículo" id="nd-type-vehicle">
            <option>VTV / RTO</option>
            <option>Seguro</option>
            <option>Habilitación</option>
            <option>CNRT</option>
            <option>Certificado</option>
            <option>Cédula verde</option>
            <option>Otro</option>
          </optgroup>
          <optgroup label="Chofer" id="nd-type-user" style="display:none">
            <option>Registro de conducir</option>
            <option>Registro profesional</option>
            <option>Curso CNRT</option>
            <option>Libreta sanitaria</option>
            <option>ART / Seguro accidentes</option>
            <option>Psicofísico</option>
            <option>Examen de aptitud</option>
            <option>Otro</option>
          </optgroup>
        </select>
      </div>
    </div>

    <!-- SELECTOR DE VEHÍCULO -->
    <div class="form-group" id="nd-wrap-vehicle">
      <label class="form-label">Vehículo *</label>
      <select class="form-select" id="nd-vehicle">
        <option value="">— Seleccionar vehículo —</option>
        ${vehOpts}
      </select>
      <div style="font-size:11px;color:var(--text3);margin-top:4px">${vehiculos.length} vehículos disponibles</div>
    </div>

    <!-- SELECTOR DE CHOFER -->
    <div class="form-group" id="nd-wrap-user" style="display:none">
      <label class="form-label">Chofer / Persona *</label>
      <select class="form-select" id="nd-user">
        <option value="">— Seleccionar persona —</option>
        ${userOpts}
      </select>
      <div style="font-size:11px;color:var(--text3);margin-top:4px">${choferes.length} personas disponibles en el sistema</div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Fecha de emisión</label>
        <input class="form-input" type="date" id="nd-issue">
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de vencimiento *</label>
        <input class="form-input" type="date" id="nd-expiry">
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Número / referencia</label>
      <input class="form-input" placeholder="Ej: POL-00123456, Nº de registro, etc." id="nd-ref">
    </div>

    <div class="form-group">
      <label class="form-label">Observaciones</label>
      <textarea class="form-textarea" id="nd-obs" placeholder="Notas adicionales..."></textarea>
    </div>
  `, [
    { label:'Guardar documento', cls:'btn-primary', fn: saveNewDoc },
    { label:'Cancelar',          cls:'btn-secondary', fn: closeModal }
  ]);
}

// Toggle entre vehículo / chofer en el modal
function _docToggleEntityType() {
  const type = document.getElementById('nd-entity-type')?.value || 'vehicle';
  const wrapV = document.getElementById('nd-wrap-vehicle');
  const wrapU = document.getElementById('nd-wrap-user');
  const optV  = document.getElementById('nd-type-vehicle');
  const optU  = document.getElementById('nd-type-user');

  if (type === 'vehicle') {
    if (wrapV) wrapV.style.display = '';
    if (wrapU) wrapU.style.display = 'none';
    if (optV) optV.style.display = '';
    if (optU) optU.style.display = 'none';
  } else {
    if (wrapV) wrapV.style.display = 'none';
    if (wrapU) wrapU.style.display = '';
    if (optV) optV.style.display = 'none';
    if (optU) optU.style.display = '';
  }

  // Re-seleccionar la primera opción visible del select de tipo
  const typeSel = document.getElementById('nd-type');
  if (typeSel) {
    const firstVisible = typeSel.querySelector('optgroup:not([style*="none"]) option');
    if (firstVisible) typeSel.value = firstVisible.value;
  }
}

async function saveNewDoc() {
  const entityType = document.getElementById('nd-entity-type')?.value || 'vehicle';
  const type       = (document.getElementById('nd-type')?.value   || '').trim();
  const expiry     = (document.getElementById('nd-expiry')?.value || '').trim();
  const issue      = (document.getElementById('nd-issue')?.value  || '').trim();
  const ref        = (document.getElementById('nd-ref')?.value    || '').trim();
  const obs        = (document.getElementById('nd-obs')?.value    || '').trim();

  let entityId = null;
  if (entityType === 'vehicle') {
    entityId = document.getElementById('nd-vehicle')?.value;
    if (!entityId) { showToast('warn', 'Seleccioná un vehículo'); return; }
  } else {
    entityId = document.getElementById('nd-user')?.value;
    if (!entityId) { showToast('warn', 'Seleccioná una persona'); return; }
  }

  if (!type)   { showToast('warn', 'Elegí el tipo de documento'); return; }
  if (!expiry) { showToast('warn', 'Ingresá la fecha de vencimiento'); return; }

  try {
    const res = await apiFetch('/api/documents', {
      method: 'POST',
      body: JSON.stringify({
        entity_type: entityType,
        entity_id: entityId,
        doc_type: type,
        reference: ref,
        issue_date: issue || null,
        expiry_date: expiry,
        notes: obs
      })
    });
    if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error al cargar documento'); return; }
    closeModal();
    showToast('ok', `Documento ${type} cargado correctamente`);
    // El auto-refresh ya va a re-renderizar
  } catch(err) {
    showToast('error', err.message);
  }
}


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

function exportCostPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast?.('error','jsPDF no cargado. Refrescá la página.');
    return;
  }

  const now = new Date();
  const yr = now.getFullYear(), mo = now.getMonth()+1;
  const mesStr = yr+'-'+String(mo).padStart(2,'0');
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const mesNombre = meses[mo-1];

  // Recopilar datos
  const rows = [];
  let totalCombustible = 0, totalPreventivo = 0, totalCorrectivo = 0, totalGeneral = 0, totalKm = 0;
  App.data.vehicles.forEach(v => {
    const d = getCostDetail(v.code);
    if (!d || d.totalMes === 0) return;
    const comb = Math.round(d.rubros[0].total);
    const prev = Math.round(d.rubros[1].total);
    const corr = Math.round(d.rubros[2].total);
    totalCombustible += comb;
    totalPreventivo  += prev;
    totalCorrectivo  += corr;
    totalGeneral     += Math.round(d.totalMes);
    totalKm          += d.kmMes;
    rows.push([
      v.code,
      `${v.brand||''} ${v.model||''}`.trim() || '—',
      d.kmMes.toLocaleString('es-AR'),
      '$'+comb.toLocaleString('es-AR'),
      '$'+prev.toLocaleString('es-AR'),
      '$'+corr.toLocaleString('es-AR'),
      '$'+Math.round(d.totalMes).toLocaleString('es-AR'),
      d.costKmReal>0 ? '$'+d.costKmReal.toFixed(3) : '—',
    ]);
  });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  // Encabezado
  doc.setFontSize(16);
  doc.setFont('helvetica','bold');
  doc.text('Costos Operativos — Expreso Biletta', 40, 40);
  doc.setFontSize(10);
  doc.setFont('helvetica','normal');
  doc.setTextColor(100);
  doc.text(`Período: ${mesNombre} ${yr}  ·  ${rows.length} unidades con movimientos`, 40, 58);
  doc.setFontSize(8);
  doc.text(`Generado el ${nowDateAR()} a las ${nowTimeAR()}`, 40, 72);

  // Tabla principal
  doc.autoTable({
    startY: 90,
    head: [['Unidad','Marca/Modelo','Km mes','Combustible','Preventivo','Correctivo','Total mes','$/km real']],
    body: rows,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [247, 249, 252] },
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
  doc.setTextColor(0);
  doc.text(`TOTALES DEL MES:`, 40, finalY + 25);
  doc.setFontSize(10);
  doc.setFont('helvetica','normal');
  doc.text(`Km totales: ${totalKm.toLocaleString('es-AR')}`, 40, finalY + 42);
  doc.text(`Combustible: $${totalCombustible.toLocaleString('es-AR')}`, 180, finalY + 42);
  doc.text(`Preventivo: $${totalPreventivo.toLocaleString('es-AR')}`, 340, finalY + 42);
  doc.text(`Correctivo: $${totalCorrectivo.toLocaleString('es-AR')}`, 490, finalY + 42);
  doc.setFont('helvetica','bold');
  doc.setTextColor(37, 99, 235);
  doc.setFontSize(12);
  doc.text(`TOTAL GENERAL: $${totalGeneral.toLocaleString('es-AR')}`, 40, finalY + 65);

  if (totalKm > 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica','normal');
    doc.setTextColor(100);
    doc.text(`Costo promedio de la flota: $${(totalGeneral/totalKm).toFixed(3)} / km`, 40, finalY + 82);
  }

  doc.save(`Costos-Biletta-${mesStr}.pdf`);
  showToast('ok', 'PDF de costos descargado');
}

// Wrapper para mantener compatibilidad con botones viejos que llaman exportCostCSV
function exportCostCSV() { exportCostPDF(); }

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
        <button class="btn btn-secondary btn-sm" onclick="exportCostPDF()">📄 Exportar PDF</button>
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
  window._maintenancePlans = plans; // exponer para el onclick

  root.innerHTML = `
    <div class="section-header" style="margin-bottom:20px">
      <div>
        <h2 style="font-size:18px;font-weight:700;margin:0">Plan de mantenimiento</h2>
        <p style="font-size:13px;color:var(--text3);margin:4px 0 0">Preventivo · predictivo · correctivo</p>
      </div>
    </div>
    ${vencidos>0 ? `<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--danger);display:flex;align-items:center;justify-content:space-between">
      <span>⚠ <b>${vencidos} unidad${vencidos>1?'es':''}</b> con mantenimiento vencido.</span>
      <button class="btn btn-sm" style="background:var(--danger);color:white;border:none" onclick="_crearOTsPreventivas()">Crear OTs preventivas</button>
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

async function _crearOTsPreventivas() {
  const planes = (window._maintenancePlans||[]).filter(p=>p.status==='danger');
  if (!planes.length) { showToast('warn','No hay unidades con mantenimiento vencido'); return; }
  showToast('ok', `Creando ${planes.length} OTs preventivas...`);
  let creadas = 0, errores = 0;
  for (const p of planes) {
    const v = App.data.vehicles.find(x => x.code === p.v.code);
    if (!v) { errores++; continue; }
    const res = await apiFetch('/api/workorders', {
      method: 'POST',
      body: JSON.stringify({
        vehicle_id:  v.id,
        type:        'Preventivo',
        priority:    'Normal',
        description: p.taskName || 'Mantenimiento preventivo programado',
      })
    });
    if (res.ok) { creadas++; }
    else { errores++; }
    // Pequeña pausa entre requests para no saturar el servidor
    await new Promise(r => setTimeout(r, 100));
  }
  showToast(errores > 0 ? 'warn' : 'ok',
    `${creadas} OTs creadas${errores > 0 ? ' · ' + errores + ' errores' : ''}`);
  await loadInitialData();
  renderMaintenance();
  renderWorkOrders();
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
  { value:'compras',               label:'Compras' },
  { value:'tesoreria',             label:'Tesorería' },
];

// ═══════════════════════════════════════════════════════════
//  WORKFLOW de OC — fuente única de verdad
//  Los 6 estados, sus labels, colores, íconos y transiciones
// ═══════════════════════════════════════════════════════════
const OC_ESTADOS = {
  pendiente_cotizacion: { label: 'Pendiente cotización', icon: '📝', bg: 'rgba(251,191,36,.15)', fg: '#f59e0b', border: 'rgba(251,191,36,.4)' },
  en_cotizacion:        { label: 'En cotización',        icon: '🔎', bg: 'rgba(139,92,246,.15)', fg: '#a78bfa', border: 'rgba(139,92,246,.4)' },
  aprobada_compras:     { label: 'Aprobada por compras', icon: '✅', bg: 'rgba(14,165,233,.15)', fg: '#38bdf8', border: 'rgba(14,165,233,.4)' },
  pagada:               { label: 'Pagada',               icon: '💰', bg: 'rgba(34,197,94,.15)',  fg: '#4ade80', border: 'rgba(34,197,94,.4)' },
  recibida:             { label: 'Recibida',             icon: '📦', bg: 'rgba(16,185,129,.2)',  fg: '#10b981', border: 'rgba(16,185,129,.5)' },
  rechazada:            { label: 'Rechazada',            icon: '❌', bg: 'rgba(239,68,68,.15)',  fg: '#f87171', border: 'rgba(239,68,68,.4)' }
};

// Genera el badge HTML del estado (usa el ícono + label + color)
function _ocEstadoBadge(status) {
  const e = OC_ESTADOS[status] || { label: status, icon: '❓', bg: '#333', fg: '#fff', border: '#555' };
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;background:${e.bg};color:${e.fg};border:1px solid ${e.border};font-size:11px;font-weight:600;white-space:nowrap">
    <span>${e.icon}</span><span>${e.label}</span>
  </span>`;
}

// Qué acciones puede hacer un rol sobre una OC en un estado dado
// Devuelve lista de {key, label, color} para mostrar como botones
function _ocAccionesPermitidas(oc, userRole, userId) {
  const st = oc.status;
  const esCreador = oc.requested_by === userId;
  const esAdmin = ['dueno','gerencia'].includes(userRole);
  const acciones = [];

  // COMPRAS y admin: tomar cotización
  if (st === 'pendiente_cotizacion' && (userRole === 'compras' || esAdmin)) {
    acciones.push({ key: 'tomar',    label: '🔎 Tomar cotización', color: 'primary' });
  }
  // COMPRAS y admin: aprobar con precios (desde en_cotizacion o pendiente)
  if (['pendiente_cotizacion','en_cotizacion'].includes(st) && (userRole === 'compras' || esAdmin)) {
    acciones.push({ key: 'aprobar',  label: '✅ Aprobar con precios', color: 'success' });
  }
  // TESORERÍA y admin: pagar
  if (st === 'aprobada_compras' && (userRole === 'tesoreria' || esAdmin)) {
    acciones.push({ key: 'pagar',    label: '💰 Registrar pago', color: 'primary' });
  }
  // SOLICITANTES (jefe mant, paniol, contador) y admin: recibir
  if (st === 'pagada' && ((['jefe_mantenimiento','paniol','contador'].includes(userRole) && esCreador) || esAdmin)) {
    acciones.push({ key: 'recibir',  label: '📦 Confirmar recepción', color: 'success' });
  }
  // RECHAZAR: según rol y estado
  const puedeRechazar = (
    esAdmin ||
    (['jefe_mantenimiento','paniol','contador'].includes(userRole) && esCreador && st === 'pendiente_cotizacion') ||
    (userRole === 'compras'   && ['pendiente_cotizacion','en_cotizacion'].includes(st)) ||
    (userRole === 'tesoreria' && st === 'aprobada_compras')
  );
  if (puedeRechazar && !['recibida','rechazada'].includes(st)) {
    acciones.push({ key: 'rechazar', label: '❌ Rechazar', color: 'danger' });
  }

  return acciones;
}

// ¿El rol tiene permitido ver precios de OCs?
// Los roles SOLICITANTES (jefe mant, pañol, contador) NO ven precios.
// Las cotizaciones y pagos las gestiona compras/tesorería.
function _ocPuedeVerPrecios(role) {
  return !['jefe_mantenimiento','paniol','contador'].includes(role);
}

// ¿El rol tiene permitido ver precios de combustible ($ por litro, totales)?
// El jefe mant y el chofer NO ven precios — compras los gestiona
function _fuelPuedeVerPrecios(role) {
  const rolesQueSiVen = ['dueno','gerencia','compras','contador','auditor','encargado_combustible'];
  return rolesQueSiVen.includes(role);
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
            <tr style="background:var(--bg3);border-bottom:1px solid var(--border)">
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
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:12px 16px;font-weight:600;color:var(--text)">${u.name}</td>
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
    if (k === 'cost') return (parseFloat(o.parts_cost)||0) + (parseFloat(o.labor_cost)||0);
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
    const totalCost = rows.reduce((a,o) => a + (parseFloat(o.parts_cost)||0) + (parseFloat(o.labor_cost)||0), 0);
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

  const totalCost = (parseFloat(o.parts_cost)||0) + (parseFloat(o.labor_cost)||0);
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
      <div style="font-family:var(--mono);font-size:10px;color:var(--text3)">${o.plate||'—'}</div>
    </td>

    <td style="padding:10px 12px">
      <span class="badge ${o.type==='Preventivo'?'badge-ok':'badge-gray'}" style="font-size:10px">${o.type||'—'}</span>
    </td>

    <td style="padding:10px 12px;max-width:220px;color:var(--text2);font-size:12px;line-height:1.4">
      ${(o.desc||'—').substring(0,120)}${(o.desc||'').length>120?'…':''}
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

    <td style="padding:10px 12px;min-width:120px">
      <div style="display:flex;align-items:center;gap:6px">
        <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;min-width:50px;max-width:80px">
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

  // Encabezado
  doc.setFontSize(16);
  doc.setFont('helvetica','bold');
  doc.text('Órdenes de Trabajo — Expreso Biletta', 40, 40);
  doc.setFontSize(9);
  doc.setFont('helvetica','normal');
  doc.setTextColor(100);
  const hoy = new Date().toLocaleString('es-AR');
  doc.text(`Generado: ${hoy}  ·  ${rows.length} OT${rows.length===1?'':'s'}`, 40, 58);

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
    startY: 72,
    head: [['ID','Veh','Patente','Tipo','Descripción','Mecánico','Estado','Prioridad','Costo','Apertura']],
    body: tableData,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 249, 252] },
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
  const totalCost = rows.reduce((a,o) => a + (parseFloat(o.parts_cost)||0) + (parseFloat(o.labor_cost)||0), 0);
  const finalY = doc.lastAutoTable.finalY || 90;
  doc.setFontSize(10);
  doc.setFont('helvetica','bold');
  doc.text(`TOTAL VISIBLE: $${Math.round(totalCost).toLocaleString('es-AR')}`, 40, finalY + 20);

  const fileDate = todayISO();
  doc.save(`OTs-Biletta-${fileDate}.pdf`);
  showToast?.('ok','PDF descargado');
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
          <div style="color:var(--danger);font-weight:600;font-size:14px">Reportar novedad</div>
        </button>
        <button onclick="openChoferCargaModal('diesel')" style="background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);border-radius:var(--radius);padding:24px 16px;cursor:pointer;text-align:center;transition:.2s" onmouseover="this.style.background='rgba(59,130,246,.25)'" onmouseout="this.style.background='rgba(59,130,246,.15)'">
          <div style="font-size:28px;margin-bottom:8px">⛽</div>
          <div style="color:var(--accent);font-weight:600;font-size:14px">Cargar combustible</div>
        </button>
        <button onclick="openChoferChecklistModal()" style="background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);border-radius:var(--radius);padding:24px 16px;cursor:pointer;text-align:center;transition:.2s" onmouseover="this.style.background='rgba(34,197,94,.25)'" onmouseout="this.style.background='rgba(34,197,94,.15)'">
          <div style="font-size:28px;margin-bottom:8px">✅</div>
          <div style="color:var(--ok);font-weight:600;font-size:14px">Checklist salida</div>
        </button>
        <button onclick="openChoferCargaModal('urea')" style="background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:var(--radius);padding:24px 16px;cursor:pointer;text-align:center;transition:.2s" onmouseover="this.style.background='rgba(99,102,241,.25)'" onmouseout="this.style.background='rgba(99,102,241,.15)'">
          <div style="font-size:28px;margin-bottom:8px">🔵</div>
          <div style="color:var(--info);font-weight:600;font-size:14px">Cargar urea</div>
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
              <div style="font-size:28px;font-weight:700;color:var(--text)">${lastFuel.liters}</div>
              <div style="font-size:11px;color:var(--text3)">litros</div>
            </div>
            <div>
              <div style="font-size:28px;font-weight:700;color:var(--text)">${(lastFuel.km||0).toLocaleString()}</div>
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
    // Verificar tickets pendientes
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
        <button class="btn btn-secondary btn-sm" onclick="_exportContadorPDF('${mesStr}')">📄 Exportar PDF</button>
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

function _exportContadorPDF(mesStr) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast?.('error','jsPDF no cargado. Refrescá la página.');
    return;
  }

  const [yr, mo] = mesStr.split('-').map(Number);
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const mesNombre = meses[mo-1];

  const fuelMes = (App.data.fuelLogs||[]).filter(f => { const d=new Date(f.date); return d.getFullYear()===yr && d.getMonth()+1===mo; });
  const otsMes  = (App.data.workOrders||[]).filter(o => { if(o.status!=='Cerrada') return false; const d=new Date(o.closed_at||o.date); return d.getFullYear()===yr && d.getMonth()+1===mo; });

  const byVeh = {};
  fuelMes.forEach(f => {
    if(!byVeh[f.vehicle]) byVeh[f.vehicle]={combustible:0,litros:0,mano:0,repuestos:0,ots:0};
    byVeh[f.vehicle].combustible += (f.liters||0)*(f.ppu||0);
    byVeh[f.vehicle].litros += (f.liters||0);
  });
  otsMes.forEach(o => {
    const vc = o.vehicle_code||o.vehicle||'';
    if(!byVeh[vc]) byVeh[vc]={combustible:0,litros:0,mano:0,repuestos:0,ots:0};
    byVeh[vc].mano += parseFloat(o.labor_cost)||0;
    byVeh[vc].repuestos += parseFloat(o.parts_cost)||0;
    byVeh[vc].ots++;
  });

  const entries = Object.entries(byVeh)
    .sort((a,b)=>(b[1].combustible+b[1].mano+b[1].repuestos)-(a[1].combustible+a[1].mano+a[1].repuestos))
    .filter(([,v]) => (v.combustible+v.mano+v.repuestos) > 0);

  let tCombustible=0, tLitros=0, tMano=0, tRepuestos=0, tOts=0, tTotal=0;
  const rows = entries.map(([code, v]) => {
    const total = v.combustible + v.mano + v.repuestos;
    tCombustible += v.combustible;
    tLitros      += v.litros;
    tMano        += v.mano;
    tRepuestos   += v.repuestos;
    tOts         += v.ots;
    tTotal       += total;
    return [
      code,
      v.combustible>0 ? '$'+Math.round(v.combustible).toLocaleString('es-AR') : '—',
      v.litros>0 ? Math.round(v.litros).toLocaleString('es-AR')+' L' : '—',
      v.mano>0 ? '$'+Math.round(v.mano).toLocaleString('es-AR') : '—',
      v.repuestos>0 ? '$'+Math.round(v.repuestos).toLocaleString('es-AR') : '—',
      v.ots > 0 ? String(v.ots) : '—',
      '$'+Math.round(total).toLocaleString('es-AR'),
    ];
  });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  // Encabezado
  doc.setFontSize(16);
  doc.setFont('helvetica','bold');
  doc.text('Panel Contable — Expreso Biletta', 40, 40);
  doc.setFontSize(10);
  doc.setFont('helvetica','normal');
  doc.setTextColor(100);
  doc.text(`Período: ${mesNombre} ${yr}  ·  ${rows.length} unidades con movimientos`, 40, 58);
  doc.setFontSize(8);
  doc.text(`Generado el ${nowDateAR()} a las ${nowTimeAR()}`, 40, 72);

  // Tabla
  doc.autoTable({
    startY: 90,
    head: [['Unidad','Combustible','Litros','Mano de obra','Repuestos','OTs','Total']],
    body: rows,
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 70 },
      1: { halign: 'right', cellWidth: 100 },
      2: { halign: 'right', cellWidth: 80 },
      3: { halign: 'right', cellWidth: 100 },
      4: { halign: 'right', cellWidth: 100 },
      5: { halign: 'center', cellWidth: 50 },
      6: { halign: 'right', fontStyle: 'bold', cellWidth: 100 },
    },
    foot: [[
      'TOTALES',
      '$'+Math.round(tCombustible).toLocaleString('es-AR'),
      Math.round(tLitros).toLocaleString('es-AR')+' L',
      '$'+Math.round(tMano).toLocaleString('es-AR'),
      '$'+Math.round(tRepuestos).toLocaleString('es-AR'),
      String(tOts),
      '$'+Math.round(tTotal).toLocaleString('es-AR'),
    ]],
    footStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', halign: 'right' },
  });

  doc.save(`Contable-Biletta-${mesStr}.pdf`);
  showToast('ok','PDF contable descargado');
}

// Wrapper de compatibilidad
function _exportContadorCSV(mesStr) { _exportContadorPDF(mesStr); }


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
  window._otParts = [];

  // Cargar activos si no están cargados aún
  if (!App.data.assets) loadAssetsIntoData();

  openModal('Nueva orden de trabajo', `
    <!-- Selector de tipo arriba, estilo pills -->
    <div style="margin-bottom:16px">
      <label class="form-label" style="font-weight:700;margin-bottom:8px">¿Qué estás manteniendo?</label>
      <div id="ot-tipo-pills" style="display:flex;gap:6px;flex-wrap:wrap">
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
            style="padding:7px 14px;border:1px solid var(--border2);border-radius:20px;background:${v==='vehiculo'?'var(--accent)':'var(--bg)'};color:${v==='vehiculo'?'white':'var(--text2)'};cursor:pointer;font-size:12px;font-weight:600;transition:.15s">
            ${label}
          </button>
        `).join('')}
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:6px">La OT quedará vinculada al objeto que elijas abajo</div>
    </div>

    <!-- Dropdown dinámico: cambia según el tipo -->
    <div class="form-group" id="ot-target-group">
      <label class="form-label" id="ot-target-label">Unidad</label>
      <select class="form-select" id="ot-target-select">
        <option value="">— Cargando... —</option>
      </select>
      <div style="font-size:11px;margin-top:4px" id="ot-target-hint"></div>
    </div>

    <div class="form-row">
      <div class="form-group"><label class="form-label">Tipo de trabajo</label>
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
      <div class="form-group"><label class="form-label">Mecánico / Responsable asignado</label>
        <input class="form-input" list="ot-mecanicos-list" id="ot-mechanic" placeholder="Nombre del responsable">
        <datalist id="ot-mecanicos-list">
          ${(App.data.users||[]).filter(u=>['mecanico','jefe_mantenimiento','encargado_taller'].includes(u.role)).map(u=>`<option value="${u.name}">`).join('')}
        </datalist>
      </div>
      <div class="form-group"><label class="form-label">Fecha límite</label>
        <input class="form-input" type="date" id="ot-due">
      </div>
    </div>

    <!-- Repuestos -->
    <div style="margin:12px 0 8px;display:flex;align-items:center;justify-content:space-between">
      <label class="form-label" style="margin:0;font-weight:700">🔧 Repuestos</label>
      <button class="btn btn-secondary btn-sm" type="button" onclick="addOTPart()">+ Agregar repuesto</button>
    </div>
    <div id="ot-parts-list" style="margin-bottom:8px"></div>
    <div id="ot-parts-total" style="font-size:13px;color:var(--text3);text-align:right;display:none">
      Total repuestos: <strong id="ot-parts-total-val">$0</strong>
    </div>

    <div class="form-row" style="margin-top:10px">
      <div class="form-group"><label class="form-label">Mano de obra ($)</label>
        <input class="form-input" type="number" placeholder="0" id="ot-labor" oninput="updateOTTotal()">
      </div>
      <div class="form-group"><label class="form-label">Costo total estimado</label>
        <input class="form-input" type="text" id="ot-total-display" readonly style="background:var(--bg3);font-weight:700;color:var(--accent)" value="$0">
      </div>
    </div>
    <div class="form-group"><label class="form-label">Notas adicionales</label>
      <textarea class="form-input" rows="2" placeholder="Observaciones, síntomas, instrucciones..." id="ot-notes" style="resize:vertical"></textarea>
    </div>
  `, [
    { label: 'Crear OT', cls: 'btn-primary',   fn: saveNewOT },
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
      .map(v => `<option value="${v.id||v._id}" ${preselectedVehicle===v.code?'selected':''}>${v.code} — ${v.brand||''} ${v.model||''} (${v.plate})</option>`)
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

    const opts = assets.map(a => `<option value="${a.id}">${a.code} — ${a.name}${a.location?' ('+a.location+')':''}</option>`).join('');

    if (assets.length === 0) {
      select.innerHTML = `<option value="">— No hay ${label.textContent.toLowerCase()}s registrados —</option>`;
      if (hint) hint.innerHTML = `<span style="color:var(--warn)">⚠️ Primero cargá activos en el módulo <b>Activos patrimoniales</b>. <a href="#" onclick="closeModal();navigate('assets');return false" style="color:var(--accent)">Ir al módulo →</a></span>`;
    } else {
      select.innerHTML = `<option value="">— Seleccioná un activo —</option>${opts}`;
      if (hint) hint.innerHTML = `<span style="color:var(--text3)">${assets.length} activo${assets.length===1?'':'s'} disponible${assets.length===1?'':'s'} de tipo "${tipo}"</span>`;
    }
  }
}

function addOTPart() {
  if (!window._otParts) window._otParts = [];
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
      <option value="externo">🛒 Externo</option>
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
    if (nameEl) {
      nameEl.placeholder = 'Descripción del repuesto (compra externa)';
      nameEl.style.borderLeft = '';
      nameEl.dataset.stockId = '';
    }
    if (stockInfoEl) stockInfoEl.style.display = 'none';
    if (sugEl) sugEl.style.display = 'none';
  } else {
    // Origen = stock: mostrar hint para buscar
    if (nameEl) {
      nameEl.placeholder = 'Escribí para buscar en el pañol...';
      nameEl.value = '';
      nameEl.dataset.stockId = '';
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
  if (nameEl && nameEl.dataset.stockId) {
    window._otParts[idx].stock_id = null;
    nameEl.dataset.stockId = '';
    nameEl.style.borderLeft = '';
  }

  if (!val || val.length < 2) { sugEl.style.display = 'none'; return; }
  const q = val.toLowerCase();
  const stock = (App.data.stock || []).filter(s =>
    (s.name||'').toLowerCase().includes(q) || (s.code||'').toLowerCase().includes(q)
  ).slice(0, 8);

  if (!stock.length) {
    sugEl.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:12px;text-align:center">Sin resultados en el pañol. Cambiá a "Externo" si es una compra de afuera.</div>';
    sugEl.style.display = 'block';
    return;
  }

  sugEl.innerHTML = stock.map(s => {
    const qty = parseFloat(s.qty_current || 0);
    const critical = qty <= parseFloat(s.qty_min || 0);
    const color = critical ? 'var(--danger)' : (qty > 0 ? 'var(--ok)' : 'var(--text3)');
    const safeName = String(s.name||'').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    return `<div onclick="selectOTStockItem(${idx},'${s.id}','${safeName}','${s.unit||'un'}',${parseFloat(s.unit_cost||0)},${qty})"
      style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <div>
        <div style="font-weight:600">${s.name}</div>
        <div style="color:var(--text3);font-family:monospace;font-size:11px">${s.code||'—'}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;color:var(--accent)">$${Math.round(s.unit_cost||0).toLocaleString('es-AR')}/${s.unit||'un'}</div>
        <div style="font-size:10px;color:${color};font-weight:700">Stock: ${qty} ${s.unit||'un'}</div>
      </div>
    </div>`;
  }).join('');
  sugEl.style.display = 'block';
}

// Cuando eligen un ítem del autocompletado
function selectOTStockItem(idx, stockId, name, unit, unitCost, qtyAvailable) {
  if (!window._otParts[idx]) return;
  window._otParts[idx].name = name;
  window._otParts[idx].unit = unit;
  window._otParts[idx].unit_cost = unitCost;
  window._otParts[idx].stock_id = stockId;
  window._otParts[idx].origin = 'stock';

  const nameEl = document.getElementById('otp-name-' + idx);
  const unitEl = document.getElementById('otp-unit-' + idx);
  const costEl = document.getElementById('otp-cost-' + idx);
  const qtyEl = document.getElementById('otp-qty-' + idx);
  const sugEl = document.getElementById('otp-suggestions-' + idx);
  const msgEl = document.getElementById('otp-stock-msg-' + idx);
  const infoEl = document.getElementById('otp-stock-info-' + idx);

  if (nameEl) {
    nameEl.value = name;
    nameEl.dataset.stockId = stockId;
    nameEl.dataset.stockAvailable = qtyAvailable;
    nameEl.style.borderLeft = '3px solid var(--ok)';
  }
  if (unitEl) unitEl.value = unit;
  if (costEl) { costEl.value = unitCost; costEl.readOnly = true; costEl.style.background = 'var(--bg3)'; }
  if (sugEl) sugEl.style.display = 'none';
  if (infoEl) infoEl.style.display = 'block';
  if (msgEl) {
    const color = qtyAvailable > 0 ? 'var(--ok)' : 'var(--danger)';
    msgEl.innerHTML = `<span style="color:${color}">✓ Vinculado al pañol · Disponible: <b>${qtyAvailable} ${unit}</b></span>`;
  }
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

  if (window._otParts[idx].origin === 'stock' && nameEl?.dataset.stockId) {
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
  const labor = parseFloat(document.getElementById('ot-labor')?.value) || 0;
  const total = partsTotal + labor;
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
    { label: '⚙️ Ejes', cls: 'btn-secondary', fn: () => openAxleConfigModal(id) },
    { label: 'Restaurar fábrica', cls: 'btn-secondary', fn: () => resetTechSpec(id) },
    { label: 'Cancelar',      cls: 'btn-secondary', fn: () => showVehicleFicha(id, 'tecnica') },
  ]);
}

function openAxleConfigModal(id) {
  const v = App.data.vehicles.find(x => x.id === id);
  if (!v) return;
  const currentAxles = v.tech_spec?.axles || getAxleConfig(v);
  openModal(`⚙️ Configurar ejes — ${v.code}`, `
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">
      Configurá la cantidad y tipo de ejes. Los cambios afectan el mapa de cubiertas.
    </div>
    <div id="axles-container">
      ${currentAxles.map((axle, i) => `
        <div id="axle-row-${i}" style="display:flex;align-items:center;gap:10px;margin-bottom:8px;background:var(--bg3);padding:8px 12px;border-radius:var(--radius)">
          <div style="font-size:12px;font-weight:700;min-width:50px">Eje ${i+1}</div>
          <input class="form-input" id="axle-label-${i}" value="${axle.label||axle.name?.split('—')[1]?.trim()||''}" placeholder="Ej: Dirección, Tracción, Portante" style="flex:2">
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

function renderConfig() {
  const bases  = (App.config?.bases  || ['Central','Norte','Sur']);
  const vtypes = (App.config?.vehicle_types || ['tractor','camion','semirremolque','acoplado','utilitario','autoelevador']);
  const laborRate = parseFloat(App.config?.labor_rate || 0);
  document.getElementById('page-config').innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Configuración del sistema</div>
        <div class="section-sub">Bases operativas, tipos de vehículos y costos internos</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:900px;margin-bottom:20px">

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

    </div>

    <!-- COSTO HORA DEL TALLER -->
    <div class="card" style="max-width:900px;border-left:3px solid var(--accent)">
      <div class="card-title">⏱️ Costo hora del taller (para Mano de Obra interna)</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:14px;max-width:680px">
        Este valor se usa como tarifa por defecto al cargar partes de trabajo en OTs hechas por tu taller propio.
        Incluí: sueldos + cargas sociales + herramientas + espacio + consumibles (trapos, etc.). Dividido por las horas productivas promedio del mes.
        <br><br>
        <b>No es el sueldo de nadie</b> — es un número interno para valorizar el trabajo del taller. Solo lo ve el dueño/gerencia.
      </div>
      <div style="display:grid;grid-template-columns:300px 1fr;gap:20px;align-items:start">
        <div>
          <label class="form-label">Tarifa por hora ($)</label>
          <input class="form-input" type="number" id="cfg-labor-rate" value="${laborRate}" min="0" step="100" style="font-size:14px;font-weight:700">
          <div style="font-size:11px;color:var(--text3);margin-top:6px">Ej: 4500, 5000, 7500</div>
          <button class="btn btn-primary btn-sm" onclick="saveConfig()" style="margin-top:12px">Guardar tarifa</button>
        </div>
        <div style="background:var(--bg3);padding:12px;border-radius:var(--radius);font-size:12px;color:var(--text2)">
          <div style="font-weight:700;margin-bottom:6px;color:var(--text)">💡 Cómo calcular tu tarifa real</div>
          <div style="line-height:1.6">
            Sueldos totales mensuales (todos los mecánicos): <b>$A</b><br>
            Horas productivas del mes (mecánicos × horas): <b>H</b> (ej: 3 personas × 160h = 480h)<br>
            Costo sueldos por hora: <b>$A / H</b><br>
            + Overhead 30-40% (herramientas, espacio, consumibles)<br>
            <b style="color:var(--accent)">= Tarifa realista</b>
          </div>
        </div>
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

  // labor_rate es opcional — solo aparece en la pantalla de config, no siempre está visible
  const labor_rate_el = document.getElementById('cfg-labor-rate');
  const payload = { bases, vehicle_types: vtypes };
  if (labor_rate_el) {
    const lr = parseFloat(labor_rate_el.value);
    if (!isNaN(lr) && lr >= 0) payload.labor_rate = lr;
  }

  const res = await apiFetch('/api/config', { method:'PUT', body: JSON.stringify(payload) });
  if (!res.ok) { showToast('error','Error al guardar configuración'); return; }
  App.config.bases = bases;
  App.config.vehicle_types = vtypes;
  if (payload.labor_rate !== undefined) App.config.labor_rate = payload.labor_rate;
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

// ════════════════════════════════════════════════════════════
//  PANEL DEL AUDITOR — Solo lectura, IA integrada
// ════════════════════════════════════════════════════════════

async function renderAuditorPanel() {
  const root = document.getElementById('page-auditor_panel');
  if (!root) return;

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
      <div>
        <h2 style="font-size:20px;font-weight:700;margin:0;color:var(--text)">🔍 Panel de Auditoría</h2>
        <p style="font-size:13px;color:var(--text3);margin:4px 0 0">Solo lectura · Acceso exclusivo al auditor</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" onclick="renderAuditorPanel()">↻ Actualizar</button>
        <button class="btn btn-primary btn-sm" onclick="openAuditorIA()">🤖 Consultar IA</button>
      </div>
    </div>
    <div id="auditor-tabs" style="display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid var(--border2);padding-bottom:0">
      ${[
        ['resumen',    '📊 Resumen'],
        ['visual',     '📈 Indicadores visuales'],
        ['combustible','⛽ Anomalías combustible'],
        ['ots',        '🔧 Anomalías OTs'],
        ['trazabilidad','📋 Trazabilidad'],
        ['comparativo','📈 Comparativo mensual'],
        ['log',        '🗂 Log de acciones'],
      ].map(([id,label]) => `
        <button id="atab-${id}" onclick="showAuditorTab('${id}')"
          style="padding:8px 14px;border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:var(--text3);border-bottom:2px solid transparent;transition:.15s;white-space:nowrap">
          ${label}
        </button>`).join('')}
    </div>
    <div id="auditor-content">
      <div style="text-align:center;padding:40px;color:var(--text3)">Cargando...</div>
    </div>`;

  showAuditorTab('resumen');
}

async function showAuditorTab(tab) {
  // Resaltar tab activo
  document.querySelectorAll('[id^="atab-"]').forEach(b => {
    b.style.color = 'var(--text3)';
    b.style.borderBottom = '2px solid transparent';
  });
  const activeBtn = document.getElementById('atab-' + tab);
  if (activeBtn) {
    activeBtn.style.color = 'var(--accent)';
    activeBtn.style.borderBottom = '2px solid var(--accent)';
  }

  const content = document.getElementById('auditor-content');
  if (!content) return;
  content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)">
    <div style="font-size:24px;margin-bottom:8px">⏳</div>Cargando datos...
  </div>`;

  try {
    if (tab === 'resumen')      await renderAuditorResumen(content);
    if (tab === 'visual')       await renderAuditorVisual(content);
    if (tab === 'combustible')  await renderAuditorCombustible(content);
    if (tab === 'ots')          await renderAuditorOTs(content);
    if (tab === 'trazabilidad') await renderAuditorTrazabilidad(content);
    if (tab === 'comparativo')  await renderAuditorComparativo(content);
    if (tab === 'log')          await renderAuditorLog(content);
  } catch(e) {
    content.innerHTML = `<div class="card" style="color:var(--danger);padding:24px">Error: ${e.message}</div>`;
  }
}

// ── Tab 1: Resumen ejecutivo ──────────────────────────────
async function renderAuditorResumen(el) {
  const now = new Date();
  const mes = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  const res = await apiFetch(`/api/auditor/resumen?mes=${mes}`);
  if (!res.ok) { el.innerHTML = `<div class="card" style="color:var(--danger)">Error al cargar resumen</div>`; return; }
  const d = await res.json();

  const flotaTotal = Object.values(d.flota).reduce((a,b)=>a+b,0);
  const flotaOk    = d.flota.ok || 0;

  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card info">
        <div class="kpi-label">💰 Costo total del mes</div>
        <div class="kpi-value white">$${Math.round(parseFloat(d.combustible.costo)+parseFloat(d.ordenes.mano_obra)+parseFloat(d.ordenes.repuestos)).toLocaleString('es-AR')}</div>
        <div class="kpi-trend">combustible + mantenimiento</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(59,130,246,.4)">
        <div class="kpi-label">⛽ Combustible</div>
        <div class="kpi-value" style="color:#3b82f6">$${Math.round(parseFloat(d.combustible.costo)).toLocaleString('es-AR')}</div>
        <div class="kpi-trend">${Math.round(parseFloat(d.combustible.litros)).toLocaleString()} L · ${d.combustible.cargas} cargas · ${d.combustible.sin_ticket} sin ticket</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(245,158,11,.4)">
        <div class="kpi-label">🔧 Mantenimiento</div>
        <div class="kpi-value" style="color:#f59e0b">$${Math.round(parseFloat(d.ordenes.mano_obra)+parseFloat(d.ordenes.repuestos)).toLocaleString('es-AR')}</div>
        <div class="kpi-trend">${d.ordenes.total} OTs · ${d.ordenes.abiertas} abiertas · ${d.ordenes.cerradas} cerradas</div>
      </div>
      <div class="kpi-card ${flotaOk < flotaTotal * 0.8 ? 'danger' : 'ok'}">
        <div class="kpi-label">🚛 Flota operativa</div>
        <div class="kpi-value ${flotaOk < flotaTotal * 0.8 ? 'danger' : 'ok'}">${flotaOk} / ${flotaTotal}</div>
        <div class="kpi-trend">${d.flota.taller||0} en taller · ${d.flota.detenida||0} detenidas</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <div class="card-title">📋 Checklists del mes</div>
        <div style="font-size:32px;font-weight:700;color:var(--text)">${d.checklists.total}</div>
        <div style="font-size:13px;color:${d.checklists.con_problema > 0 ? 'var(--danger)' : 'var(--ok)'}">
          ${d.checklists.con_problema > 0 ? `⚠ ${d.checklists.con_problema} con problemas reportados` : '✓ Sin problemas reportados'}
        </div>
      </div>
      <div class="card">
        <div class="card-title">👥 Usuarios activos</div>
        <div style="font-size:32px;font-weight:700;color:var(--text)">${d.usuarios_activos}</div>
        <div style="font-size:13px;color:var(--text3)">usuarios con actividad en el mes</div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// Tab "📈 Indicadores visuales" — 4 gráficos analíticos
// ═══════════════════════════════════════════════════════════
async function renderAuditorVisual(el) {
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="card">
        <div class="card-title">⏱ Timeline de OTs por vehículo</div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
          <select class="form-select" id="vis-timeline-vehicle" style="max-width:260px;padding:6px 10px;font-size:12px" onchange="renderAuditorVisualTimeline()">
            <option value="">— Seleccioná un vehículo —</option>
            ${App.data.vehicles.map(v=>`<option value="${v.code}">${v.code} · ${v.plate||'—'}</option>`).join('')}
          </select>
          <span style="font-size:11px;color:var(--text3)" id="vis-timeline-info"></span>
        </div>
        <div id="vis-timeline-wrap" style="min-height:220px">
          <div style="color:var(--text3);font-size:13px;text-align:center;padding:40px 0">Elegí un vehículo para ver su línea de tiempo</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">🎯 Cumplimiento de mantenimiento</div>
        <div id="vis-gauge-wrap" style="display:flex;align-items:center;justify-content:center;min-height:220px">
          <div style="color:var(--text3);font-size:13px">Calculando...</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">🗓 Heatmap de uso de flota — ${new Date().toLocaleString('es-AR',{month:'long',year:'numeric'})}</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:12px">
        Cada fila es un vehículo, cada columna un día del mes. El color indica nivel de actividad (checklists + cargas + OTs).
      </div>
      <div id="vis-heatmap-wrap" style="overflow-x:auto;padding-bottom:8px">
        <div style="color:var(--text3);font-size:13px;padding:20px 0;text-align:center">Cargando mapa de calor...</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">💸 Evolución mensual de costos por rubro</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:12px">
        Stacked area de los últimos 6 meses — combustible (azul) vs mantenimiento (naranja).
      </div>
      <div style="position:relative;height:280px">
        <canvas id="vis-stacked-canvas"></canvas>
      </div>
      <div id="vis-stacked-legend" style="display:flex;gap:16px;justify-content:center;margin-top:12px;font-size:12px"></div>
    </div>
  `;

  // Renderizar los 3 gráficos que no dependen de selección del usuario
  await Promise.all([
    _renderAuditorGauge(),
    _renderAuditorHeatmap(),
    _renderAuditorStacked(),
  ]);
}

// ── Gráfico 1: Timeline de OTs por vehículo ────────────────
function renderAuditorVisualTimeline() {
  const sel = document.getElementById('vis-timeline-vehicle');
  const info = document.getElementById('vis-timeline-info');
  const wrap = document.getElementById('vis-timeline-wrap');
  if (!sel || !wrap) return;

  const code = sel.value;
  if (!code) {
    wrap.innerHTML = `<div style="color:var(--text3);font-size:13px;text-align:center;padding:40px 0">Elegí un vehículo para ver su línea de tiempo</div>`;
    if (info) info.textContent = '';
    return;
  }

  const ots = (App.data.workOrders || [])
    .filter(o => o.vehicle === code)
    .map(o => ({
      id: o.id,
      opened: o.opened && o.opened !== '—' ? new Date(o.opened.replace(' ','T')) : null,
      closed: o.closed_at ? new Date(o.closed_at) : null,
      status: o.status,
      priority: o.priority,
      type: o.type,
      desc: o.desc || '',
    }))
    .filter(o => o.opened && !isNaN(o.opened))
    .sort((a,b) => a.opened - b.opened);

  if (info) info.textContent = `${ots.length} OT${ots.length===1?'':'s'} registrada${ots.length===1?'':'s'}`;

  if (!ots.length) {
    wrap.innerHTML = `<div style="color:var(--text3);font-size:13px;text-align:center;padding:40px 0">Sin OTs registradas para ${code}</div>`;
    return;
  }

  // Escala temporal: desde la primera OT hasta hoy (o última cerrada si todo está cerrado)
  const minDate = ots[0].opened;
  const maxDate = new Date(Math.max(
    Date.now(),
    ...ots.map(o => o.closed ? o.closed.getTime() : o.opened.getTime())
  ));
  const totalMs = maxDate - minDate || 1;

  // Convertir a posición % en la línea
  const toPct = d => Math.max(0, Math.min(100, ((d - minDate) / totalMs) * 100));

  const colorByPriority = {
    'Crítica': 'var(--danger)',
    'Urgente': 'var(--warn)',
    'Alta':    'var(--warn)',
    'Normal':  'var(--accent)',
    'Baja':    'var(--text3)',
  };

  const formatDate = d => d.toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'2-digit' });

  wrap.innerHTML = `
    <div style="padding:16px 8px">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:8px">
        <span>${formatDate(minDate)}</span>
        <span>${formatDate(maxDate)}</span>
      </div>
      <div style="position:relative;height:6px;background:var(--bg3);border-radius:3px;margin-bottom:24px">
        ${ots.map((o, i) => {
          const left = toPct(o.opened);
          const right = o.closed ? toPct(o.closed) : toPct(new Date());
          const width = Math.max(0.8, right - left);
          const color = colorByPriority[o.priority] || 'var(--accent)';
          return `<div title="${o.id} · ${o.type} · ${o.priority} · ${o.status}"
            style="position:absolute;left:${left}%;width:${width}%;height:6px;background:${color};border-radius:3px;cursor:pointer;opacity:.85"
            onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.85"></div>`;
        }).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;max-height:220px;overflow-y:auto">
        ${ots.slice(-12).reverse().map(o => {
          const color = colorByPriority[o.priority] || 'var(--accent)';
          const badgeCls = o.status === 'Cerrada' ? 'badge-ok' : o.status === 'En curso' ? 'badge-warn' : 'badge-info';
          return `<div style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);border-left:3px solid ${color};background:var(--bg2)">
            <div style="font-size:11px;color:var(--text3);font-family:var(--mono)">${formatDate(o.opened)}${o.closed ? ' → ' + formatDate(o.closed) : ' → (abierta)'}</div>
            <div style="font-weight:600;font-size:12px;margin:2px 0">${o.id}</div>
            <div style="font-size:11px;color:var(--text2);line-height:1.35">${(o.desc||'—').substring(0,60)}${o.desc && o.desc.length>60?'…':''}</div>
            <div style="margin-top:4px"><span class="badge ${badgeCls}">${o.status}</span> <span style="font-size:10px;color:var(--text3)">${o.priority}</span></div>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:16px;font-size:11px;color:var(--text3);margin-top:10px;flex-wrap:wrap">
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--danger);border-radius:2px;vertical-align:-1px;margin-right:4px"></span>Crítica</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--warn);border-radius:2px;vertical-align:-1px;margin-right:4px"></span>Urgente/Alta</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--accent);border-radius:2px;vertical-align:-1px;margin-right:4px"></span>Normal</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--text3);border-radius:2px;vertical-align:-1px;margin-right:4px"></span>Baja</span>
      </div>
    </div>
  `;
}

// ── Gráfico 2: Heatmap de uso de flota ─────────────────────
async function _renderAuditorHeatmap() {
  const wrap = document.getElementById('vis-heatmap-wrap');
  if (!wrap) return;

  try {
    const res = await apiFetch('/api/auditor/uso-flota');
    if (!res.ok) throw new Error('No se pudo cargar uso-flota');
    const d = await res.json();
    const dias = d.periodo.dias_mes;
    const vehiculos = d.vehiculos || [];

    if (!vehiculos.length) {
      wrap.innerHTML = `<div style="color:var(--text3);padding:20px 0;text-align:center">Sin datos de uso en el mes</div>`;
      return;
    }

    // Máximo de eventos en un día para normalizar la escala de colores
    let maxEventos = 1;
    vehiculos.forEach(v => {
      Object.values(v.dias).forEach(n => { if (n > maxEventos) maxEventos = n; });
    });

    // Color según cantidad de eventos (verde claro → verde oscuro)
    const colorFor = n => {
      if (!n) return 'var(--bg3)';
      const intensity = Math.min(1, n / maxEventos);
      // Usar --ok con opacidad creciente
      const alpha = 0.15 + intensity * 0.75;
      return `rgba(22,163,74,${alpha.toFixed(2)})`;
    };

    const hoy = new Date().getDate();
    const mesActual = new Date().getMonth() + 1 === d.periodo.mes;

    wrap.innerHTML = `
      <div style="min-width:${60 + dias*22}px">
        <div style="display:grid;grid-template-columns:100px repeat(${dias},1fr);gap:2px;font-size:9px;color:var(--text3);font-family:var(--mono);margin-bottom:4px">
          <div></div>
          ${Array.from({length:dias}, (_,i) => {
            const d1 = i+1;
            const esHoy = mesActual && d1 === hoy;
            return `<div style="text-align:center;${esHoy?'color:var(--accent);font-weight:700':''}">${d1}</div>`;
          }).join('')}
        </div>
        ${vehiculos.map(v => `
          <div style="display:grid;grid-template-columns:100px repeat(${dias},1fr);gap:2px;margin-bottom:2px;align-items:center">
            <div style="font-size:11px;font-family:var(--mono);color:var(--text);padding-right:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${v.code} · ${v.plate} · ${v.total} eventos en el mes">${v.code}</div>
            ${Array.from({length:dias}, (_,i) => {
              const dia = i+1;
              const n = v.dias[dia] || 0;
              return `<div title="${v.code} · día ${dia}: ${n} evento${n===1?'':'s'}"
                style="aspect-ratio:1;min-width:16px;background:${colorFor(n)};border-radius:3px;border:1px solid var(--border)"></div>`;
            }).join('')}
          </div>
        `).join('')}
        <div style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--text3);margin-top:14px">
          <span>Menos actividad</span>
          <div style="display:flex;gap:2px">
            ${[0, 0.25, 0.5, 0.75, 1].map(p => {
              const alpha = 0.15 + p * 0.75;
              return `<div style="width:16px;height:16px;background:rgba(22,163,74,${alpha.toFixed(2)});border-radius:3px;border:1px solid var(--border)"></div>`;
            }).join('')}
          </div>
          <span>Más actividad</span>
          <span style="margin-left:auto">Máx: ${maxEventos} eventos/día</span>
        </div>
      </div>
    `;
  } catch(err) {
    wrap.innerHTML = `<div style="color:var(--danger);padding:20px 0;text-align:center">Error: ${err.message}</div>`;
  }
}

// ── Gráfico 3: Gauge de cumplimiento de mantenimiento ──────
function _renderAuditorGauge() {
  const wrap = document.getElementById('vis-gauge-wrap');
  if (!wrap) return;

  // Calcular a partir de OTs preventivas en App.data.workOrders
  const preventivas = (App.data.workOrders || []).filter(o =>
    (o.type || '').toLowerCase().includes('preventiv')
  );

  // Estadísticas: total abiertas, cerradas, abiertas "antiguas" (>30 días) = vencidas
  const now = Date.now();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  let total = preventivas.length;
  let cerradas = 0, abiertas = 0, vencidas = 0;

  preventivas.forEach(o => {
    if (o.status === 'Cerrada') { cerradas++; return; }
    abiertas++;
    const opened = o.opened && o.opened !== '—' ? new Date(o.opened.replace(' ','T')) : null;
    if (opened && !isNaN(opened) && (now - opened.getTime()) > THIRTY_DAYS) {
      vencidas++;
    }
  });

  // % de cumplimiento = (cerradas + abiertas no vencidas) / total
  const enDia = cerradas + (abiertas - vencidas);
  const pct = total === 0 ? 100 : Math.round((enDia / total) * 100);

  // Color según % cumplimiento
  const color = pct >= 85 ? 'var(--ok)' : pct >= 60 ? 'var(--warn)' : 'var(--danger)';
  const label = pct >= 85 ? 'Excelente' : pct >= 60 ? 'Aceptable' : 'Crítico';

  // Gauge SVG (semicírculo)
  const r = 80;
  const cx = 100, cy = 100;
  const startAngle = 180, endAngle = 360;
  const sweepAngle = (endAngle - startAngle) * (pct/100);
  const toRad = a => (a - 90) * Math.PI / 180;
  const sx = cx + r * Math.cos(toRad(startAngle));
  const sy = cy + r * Math.sin(toRad(startAngle));
  const ex = cx + r * Math.cos(toRad(startAngle + sweepAngle));
  const ey = cy + r * Math.sin(toRad(startAngle + sweepAngle));
  const largeArc = sweepAngle > 180 ? 1 : 0;
  const arcPath = `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
  const bgPath  = `M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`;

  wrap.innerHTML = `
    <div style="text-align:center;width:100%">
      <svg viewBox="0 0 200 120" style="max-width:260px;width:100%;height:auto">
        <path d="${bgPath}" stroke="var(--bg3)" stroke-width="14" fill="none" stroke-linecap="round"/>
        ${pct > 0 ? `<path d="${arcPath}" stroke="${color}" stroke-width="14" fill="none" stroke-linecap="round"/>` : ''}
        <text x="100" y="92" text-anchor="middle" style="font-family:var(--mono);font-size:28px;font-weight:700;fill:var(--text)">${pct}%</text>
        <text x="100" y="110" text-anchor="middle" style="font-family:var(--font);font-size:11px;fill:${color};font-weight:600">${label}</text>
      </svg>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px;font-size:12px;max-width:320px;margin-left:auto;margin-right:auto">
        <div>
          <div style="font-weight:700;color:var(--ok);font-size:18px;font-family:var(--mono)">${cerradas}</div>
          <div style="color:var(--text3);font-size:11px">Cerradas</div>
        </div>
        <div>
          <div style="font-weight:700;color:var(--accent);font-size:18px;font-family:var(--mono)">${abiertas - vencidas}</div>
          <div style="color:var(--text3);font-size:11px">Abiertas al día</div>
        </div>
        <div>
          <div style="font-weight:700;color:var(--danger);font-size:18px;font-family:var(--mono)">${vencidas}</div>
          <div style="color:var(--text3);font-size:11px">Vencidas (&gt;30d)</div>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:10px">
        Basado en ${total} OT${total===1?'':'s'} preventiva${total===1?'':'s'} del sistema
      </div>
    </div>
  `;
}

// ── Gráfico 4: Stacked area de costos mensuales ────────────
async function _renderAuditorStacked() {
  const canvas = document.getElementById('vis-stacked-canvas');
  const legend = document.getElementById('vis-stacked-legend');
  if (!canvas) return;

  try {
    const res = await apiFetch('/api/auditor/comparativo');
    if (!res.ok) throw new Error('No se pudo cargar comparativo');
    const { meses } = await res.json();

    // Destruir chart previo si existe
    if (window._visStackedChart) {
      try { window._visStackedChart.destroy(); } catch(e){}
    }

    const ctx = canvas.getContext('2d');
    window._visStackedChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: meses.map(m => m.label),
        datasets: [
          {
            label: 'Combustible',
            data: meses.map(m => Math.round(m.costo_combustible)),
            fill: true,
            backgroundColor: 'rgba(37,99,235,0.22)',
            borderColor: 'rgba(37,99,235,1)',
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 3,
            pointBackgroundColor: 'rgba(37,99,235,1)',
          },
          {
            label: 'Mantenimiento',
            data: meses.map(m => Math.round(m.costo_mantenimiento)),
            fill: true,
            backgroundColor: 'rgba(217,119,6,0.22)',
            borderColor: 'rgba(217,119,6,1)',
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 3,
            pointBackgroundColor: 'rgba(217,119,6,1)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString('es-AR')}`,
              footer: items => {
                const total = items.reduce((a,b)=>a+b.parsed.y,0);
                return 'Total: $' + total.toLocaleString('es-AR');
              },
            },
          },
        },
        scales: {
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: {
              callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(0)+'k' : v),
              font: { family: 'JetBrains Mono' },
            },
            grid: { color: 'rgba(148,163,184,0.15)' },
          },
          x: {
            stacked: true,
            ticks: { font: { family: 'JetBrains Mono' } },
            grid: { display: false },
          },
        },
      },
    });

    if (legend) {
      const totalGeneral = meses.reduce((a,m)=>a+m.costo_combustible+m.costo_mantenimiento,0);
      legend.innerHTML = `
        <span style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;background:rgba(37,99,235,0.6);border:2px solid rgba(37,99,235,1);border-radius:2px"></span>Combustible</span>
        <span style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;background:rgba(217,119,6,0.6);border:2px solid rgba(217,119,6,1);border-radius:2px"></span>Mantenimiento</span>
        <span style="color:var(--text3);margin-left:12px">Total 6 meses: <strong style="color:var(--text);font-family:var(--mono)">$${Math.round(totalGeneral).toLocaleString('es-AR')}</strong></span>
      `;
    }
  } catch(err) {
    if (canvas.parentElement) {
      canvas.parentElement.innerHTML = `<div style="color:var(--danger);padding:20px 0;text-align:center">Error: ${err.message}</div>`;
    }
  }
}

// ── Tab 2: Anomalías combustible ─────────────────────────
async function renderAuditorCombustible(el) {
  const res = await apiFetch('/api/auditor/anomalias-combustible');
  if (!res.ok) { el.innerHTML = `<div class="card" style="color:var(--danger)">Error</div>`; return; }
  const d = await res.json();

  if (d.total_anomalias === 0) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:40px">
      <div style="font-size:32px;margin-bottom:12px">✅</div>
      <div style="font-weight:600;color:var(--ok)">Sin anomalías detectadas</div>
      <div style="font-size:13px;color:var(--text3);margin-top:8px">No se encontraron irregularidades en las cargas de combustible</div>
    </div>`; return;
  }

  el.innerHTML = d.anomalias.map(a => `
    <div class="card" style="margin-bottom:16px;border-left:4px solid var(--${a.severidad==='alta'?'danger':'warn'})">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="font-size:20px">${a.severidad==='alta'?'🔴':'🟡'}</span>
        <div>
          <div style="font-weight:700;font-size:14px">${a.titulo}</div>
          <div style="font-size:12px;color:var(--text3)">${a.descripcion}</div>
        </div>
      </div>
      <div class="table-wrap">
        <table style="font-size:12px">
          <thead><tr>${Object.keys(a.registros[0]||{}).map(k=>`<th>${k}</th>`).join('')}</tr></thead>
          <tbody>${a.registros.slice(0,10).map(r=>`<tr>${Object.values(r).map(v=>`<td>${v||'—'}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
      ${a.registros.length > 10 ? `<div style="font-size:11px;color:var(--text3);margin-top:8px;padding:4px">... y ${a.registros.length-10} más</div>` : ''}
    </div>`).join('');
}

// ── Tab 3: Anomalías OTs ──────────────────────────────────
async function renderAuditorOTs(el) {
  const res = await apiFetch('/api/auditor/anomalias-ots');
  if (!res.ok) { el.innerHTML = `<div class="card" style="color:var(--danger)">Error</div>`; return; }
  const d = await res.json();

  if (d.total_anomalias === 0) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:40px">
      <div style="font-size:32px;margin-bottom:12px">✅</div>
      <div style="font-weight:600;color:var(--ok)">Sin anomalías en OTs</div>
      <div style="font-size:13px;color:var(--text3);margin-top:8px">No se detectaron irregularidades en órdenes de trabajo. A medida que haya más historial, el análisis será más preciso.</div>
    </div>`; return;
  }

  el.innerHTML = d.anomalias.map(a => `
    <div class="card" style="margin-bottom:16px;border-left:4px solid var(--${a.severidad==='alta'?'danger':'warn'})">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="font-size:20px">${a.severidad==='alta'?'🔴':'🟡'}</span>
        <div>
          <div style="font-weight:700;font-size:14px">${a.titulo}</div>
          <div style="font-size:12px;color:var(--text3)">${a.descripcion}</div>
        </div>
      </div>
      <div class="table-wrap">
        <table style="font-size:12px">
          <thead><tr>${Object.keys(a.registros[0]||{}).map(k=>`<th>${k}</th>`).join('')}</tr></thead>
          <tbody>${a.registros.slice(0,10).map(r=>`<tr>${Object.values(r).map(v=>`<td class="td-mono">${typeof v === 'number' ? '$'+Math.round(v).toLocaleString('es-AR') : (v||'—')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`).join('');
}

// ── Tab 4: Trazabilidad por unidad ───────────────────────
async function renderAuditorTrazabilidad(el) {
  const vehicleOpts = (App.data.vehicles||[]).map(v =>
    `<option value="${v.id}">${v.code} — ${v.plate}</option>`).join('');

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Seleccionar unidad</div>
      <div style="display:flex;gap:8px">
        <select class="form-select" id="traz-vehicle" style="max-width:300px">${vehicleOpts}</select>
        <button class="btn btn-primary" onclick="loadAuditorTrazabilidad()">Ver trazabilidad completa</button>
      </div>
    </div>
    <div id="traz-result"></div>`;
}

async function loadAuditorTrazabilidad() {
  const id = document.getElementById('traz-vehicle')?.value;
  if (!id) return;
  const el = document.getElementById('traz-result');
  el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3)">Cargando...</div>';

  const res = await apiFetch(`/api/auditor/trazabilidad/${id}`);
  if (!res.ok) { el.innerHTML = `<div class="card" style="color:var(--danger)">Error</div>`; return; }
  const d = await res.json();

  const costTotal = d.resumen.costo_combustible + d.resumen.costo_mantenimiento;

  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:16px">
      <div class="kpi-card info"><div class="kpi-label">Costo total histórico</div><div class="kpi-value white">$${Math.round(costTotal).toLocaleString('es-AR')}</div></div>
      <div class="kpi-card" style="border-color:rgba(59,130,246,.4)"><div class="kpi-label">Cargas combustible</div><div class="kpi-value" style="color:#3b82f6">${d.resumen.total_cargas}</div></div>
      <div class="kpi-card" style="border-color:rgba(245,158,11,.4)"><div class="kpi-label">Órdenes de trabajo</div><div class="kpi-value" style="color:#f59e0b">${d.resumen.total_ots}</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Checklists</div><div class="kpi-value ok">${d.resumen.total_checklists}</div></div>
    </div>
    <div class="card" style="padding:0">
      <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border2)">
        <div class="card-title" style="margin:0">Línea de tiempo completa — ${d.timeline.length} eventos</div>
      </div>
      <div class="table-wrap" style="max-height:500px;overflow-y:auto">
        <table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Usuario</th><th>Monto</th></tr></thead>
          <tbody>${d.timeline.map(e => {
            const iconos = { combustible:'⛽', ot_apertura:'🔧', ot_cierre:'✅', checklist:'📋' };
            const colores = { combustible:'#3b82f6', ot_apertura:'#f59e0b', ot_cierre:'#22c55e', checklist:'#94a3b8' };
            return `<tr>
              <td class="td-mono" style="font-size:11px">${new Date(e.fecha).toLocaleString('es-AR')}</td>
              <td><span style="color:${colores[e.tipo]||'var(--text3)'};">${iconos[e.tipo]||'•'} ${e.tipo.replace(/_/g,' ')}</span></td>
              <td style="font-size:12px">${e.detalle}</td>
              <td style="font-size:12px;color:var(--text3)">${e.usuario||'—'}</td>
              <td class="td-mono" style="font-size:12px;color:${e.monto>0?'var(--danger)':'var(--text3)'}">${e.monto>0?'$'+Math.round(e.monto).toLocaleString('es-AR'):'—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Tab 5: Comparativo mensual ────────────────────────────
async function renderAuditorComparativo(el) {
  const res = await apiFetch('/api/auditor/comparativo');
  if (!res.ok) { el.innerHTML = `<div class="card" style="color:var(--danger)">Error</div>`; return; }
  const d = await res.json();

  const hayDatos = d.meses.some(m => m.total > 0);

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px;padding:0">
      <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border2)">
        <div class="card-title" style="margin:0">Comparativo últimos 6 meses</div>
      </div>
      ${!hayDatos ? `<div style="padding:32px;text-align:center;color:var(--text3)">Sin datos suficientes aún — se completará a medida que se operen los meses</div>` : `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Período</th>
            <th style="color:#3b82f6">Combustible</th>
            <th style="color:#3b82f6">Litros</th>
            <th style="color:#f59e0b">Mantenimiento</th>
            <th style="color:#f59e0b">OTs</th>
            <th style="font-weight:700">Total</th>
            <th>Var. vs anterior</th>
          </tr></thead>
          <tbody>${d.meses.map((m, i) => {
            const prev = i > 0 ? d.meses[i-1].total : null;
            const varPct = prev && prev > 0 ? ((m.total - prev) / prev * 100).toFixed(1) : null;
            const varColor = varPct === null ? 'var(--text3)' : parseFloat(varPct) > 10 ? 'var(--danger)' : parseFloat(varPct) > 0 ? 'var(--warn)' : 'var(--ok)';
            return `<tr>
              <td class="td-mono" style="font-weight:600">${m.label.toUpperCase()}</td>
              <td class="td-mono" style="color:#3b82f6">${m.costo_combustible>0?'$'+Math.round(m.costo_combustible).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="color:#3b82f6">${m.litros>0?Math.round(m.litros).toLocaleString()+' L':'—'}</td>
              <td class="td-mono" style="color:#f59e0b">${m.costo_mantenimiento>0?'$'+Math.round(m.costo_mantenimiento).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono">${m.ots||'—'}</td>
              <td class="td-mono" style="font-weight:700">${m.total>0?'$'+Math.round(m.total).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="color:${varColor}">${varPct !== null ? (parseFloat(varPct)>0?'+':'')+varPct+'%' : '—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`}
    </div>`;
}

// ── Tab 6: Log de acciones ────────────────────────────────
async function renderAuditorLog(el) {
  const res = await apiFetch('/api/auditor/log-acciones?limit=100');
  if (!res.ok) { el.innerHTML = `<div class="card" style="color:var(--danger)">Error</div>`; return; }
  const d = await res.json();

  if (d.nota) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:32px">
      <div style="font-size:24px;margin-bottom:12px">🗂</div>
      <div style="font-weight:600">${d.nota}</div>
      <div style="font-size:13px;color:var(--text3);margin-top:8px">Las acciones críticas (crear/cerrar OTs, bajas de stock, dar de baja vehículos) quedan registradas con usuario y timestamp.</div>
    </div>`; return;
  }

  el.innerHTML = `
    <div class="card" style="padding:0">
      <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border2)">
        <div class="card-title" style="margin:0">Log de acciones — últimas ${d.log.length}</div>
      </div>
      <div class="table-wrap">
        <table style="font-size:12px">
          <thead><tr><th>Fecha/Hora</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Tabla</th><th>Registro</th></tr></thead>
          <tbody>${d.log.map(l=>`<tr>
            <td class="td-mono">${new Date(l.created_at).toLocaleString('es-AR')}</td>
            <td>${l.user_name||'—'}</td>
            <td><span class="badge role-${l.user_role}">${l.user_role||'—'}</span></td>
            <td style="color:${l.action==='DELETE'||l.action==='DEACTIVATE'?'var(--danger)':l.action==='CREATE'?'var(--ok)':'var(--text)'}">${l.action}</td>
            <td class="td-mono">${l.table_name||'—'}</td>
            <td class="td-mono" style="color:var(--text3)">${l.record_id?.slice(0,8)||'—'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Asistente IA del auditor ──────────────────────────────
function openAuditorIA() {
  openModal('🤖 Asistente IA — Auditoría', `
    <div style="background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.2);border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;font-size:12px;color:var(--text3)">
      Consultá al asistente sobre cualquier aspecto de la operación. Tiene acceso a todos los datos del sistema.
    </div>
    <div id="ia-chat" style="min-height:200px;max-height:350px;overflow-y:auto;margin-bottom:12px;display:flex;flex-direction:column;gap:8px"></div>
    <div style="display:flex;gap:8px">
      <input class="form-input" id="ia-input" placeholder="Ej: ¿Hay alguna unidad con consumo inusual este mes?" style="flex:1"
        onkeydown="if(event.key==='Enter'){sendAuditorIA();}">
      <button class="btn btn-primary" onclick="sendAuditorIA()">Enviar</button>
    </div>
  `, [
    { label:'Cerrar', cls:'btn-secondary', fn: closeModal }
  ]);
}

async function sendAuditorIA() {
  const input  = document.getElementById('ia-input');
  const chat   = document.getElementById('ia-chat');
  const pregunta = (input?.value || '').trim();
  if (!pregunta) return;

  // Mostrar mensaje del usuario
  chat.innerHTML += `<div style="align-self:flex-end;background:var(--accent);color:white;padding:8px 12px;border-radius:12px 12px 2px 12px;font-size:13px;max-width:80%">${pregunta}</div>`;
  input.value = '';
  chat.scrollTop = chat.scrollHeight;

  // Indicador de carga
  chat.innerHTML += `<div id="ia-loading" style="align-self:flex-start;background:var(--bg3);padding:8px 12px;border-radius:12px 12px 12px 2px;font-size:13px;color:var(--text3)">⏳ Analizando...</div>`;
  chat.scrollTop = chat.scrollHeight;

  try {
    // Recopilar contexto del sistema para la IA
    const [resumen, anomFuel, anomOT, comparativo, gpsHoy] = await Promise.all([
      apiFetch('/api/auditor/resumen').then(r=>r.json()).catch(()=>({})),
      apiFetch('/api/auditor/anomalias-combustible').then(r=>r.json()).catch(()=>({})),
      apiFetch('/api/auditor/anomalias-ots').then(r=>r.json()).catch(()=>({})),
      apiFetch('/api/auditor/comparativo').then(r=>r.json()).catch(()=>({})),
      apiFetch('/api/auditor/gps-hoy').then(r=>r.json()).catch(()=>({})),
    ]);

    const contexto = `
Sos un auditor experto en empresas de transporte de cargas de Argentina.
Tenés acceso a los datos en tiempo real del sistema FleetOS de Expreso Biletta.
Hoy es ${new Date().toLocaleDateString('es-AR', {weekday:'long', day:'numeric', month:'long', year:'numeric'})}.

FLOTA HOY (GPS en tiempo real):
- Total unidades: ${gpsHoy.total_unidades||0}
- En movimiento ahora: ${gpsHoy.en_movimiento||0}
- Detenidas: ${gpsHoy.detenidas||0}
- Unidades y km actuales: ${JSON.stringify(gpsHoy.unidades?.map(v=>({codigo:v.codigo,patente:v.patente,km:v.km_total,velocidad:v.velocidad_actual,estado:v.estado}))||[])}
- Cargas de combustible hoy: ${JSON.stringify(gpsHoy.cargas_hoy||[])}

RESUMEN DEL MES:
- Flota: ${JSON.stringify(resumen.flota||{})}
- Combustible: ${JSON.stringify(resumen.combustible||{})}
- OTs: ${JSON.stringify(resumen.ordenes||{})}
- Checklists: ${JSON.stringify(resumen.checklists||{})}

ANOMALÍAS DETECTADAS:
- Combustible (${anomFuel.total_anomalias||0} anomalías): ${anomFuel.anomalias?.map(a=>`${a.titulo}: ${a.descripcion}`).join(' | ')||'Ninguna'}
- OTs (${anomOT.total_anomalias||0} anomalías): ${anomOT.anomalias?.map(a=>`${a.titulo}: ${a.descripcion}`).join(' | ')||'Ninguna'}

COMPARATIVO ÚLTIMOS 6 MESES:
${JSON.stringify(comparativo.meses?.map(m=>({periodo:m.periodo,combustible:Math.round(m.costo_combustible),mantenimiento:Math.round(m.costo_mantenimiento),total:Math.round(m.total)}))||[])}

Respondé en español, de forma concisa y profesional.
Para preguntas sobre km del día, usá los datos de GPS de cada unidad.
Si no hay datos suficientes, indicalo claramente. Si detectás algo preocupante, mencionalo.`;

    // Llamar a Claude via proxy del backend (protege la API key)
    const resp = await apiFetch('/api/auditor/ia', {
      method: 'POST',
      body: JSON.stringify({ pregunta, contexto })
    });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Error del servidor');
    }
    const data = await resp.json();
    const respuesta = data.respuesta || 'Sin respuesta';

    document.getElementById('ia-loading')?.remove();
    chat.innerHTML += `<div style="align-self:flex-start;background:var(--bg3);padding:10px 14px;border-radius:12px 12px 12px 2px;font-size:13px;max-width:85%;line-height:1.5">${respuesta.replace(/\n/g,'<br>')}</div>`;
    chat.scrollTop = chat.scrollHeight;

  } catch(e) {
    document.getElementById('ia-loading')?.remove();
    chat.innerHTML += `<div style="align-self:flex-start;background:rgba(239,68,68,.1);color:var(--danger);padding:8px 12px;border-radius:12px;font-size:12px">Error al consultar la IA: ${e.message}</div>`;
  }
}

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
            📍 ${t.location||'—'}
          </div>
          <div class="form-group">
            <label class="form-label">Observación (si rechazás)</label>
            <textarea class="form-textarea" id="tick-obs" placeholder="Ej: Precio no coincide, ticket ilegible..." rows="3"></textarea>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-primary" style="flex:1" onclick="verificarTicket('${t.id}','aprobar')">✅ Aprobar y borrar foto</button>
            <button class="btn btn-danger" style="flex:1" onclick="verificarTicket('${t.id}','observar')">⚠ Observar</button>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:8px;text-align:center">
            Al aprobar, la foto se borra de la DB para ahorrar espacio
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
  showToast('ok', accion === 'aprobar' ? `✅ Aprobado · foto eliminada · ${restantes} pendientes` : `⚠ Observado · ${restantes} pendientes`);

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
            📍 ${next.location||'—'}
          </div>
          <div class="form-group">
            <label class="form-label">Observación (si rechazás)</label>
            <textarea class="form-textarea" id="tick-obs" placeholder="Ej: Precio no coincide, ticket ilegible..." rows="3"></textarea>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-primary" style="flex:1" onclick="verificarTicket('${next.id}','aprobar')">✅ Aprobar y borrar foto</button>
            <button class="btn btn-danger" style="flex:1" onclick="verificarTicket('${next.id}','observar')">⚠ Observar</button>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:8px;text-align:center">
            Al aprobar, la foto se borra de la DB para ahorrar espacio
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
};

async function renderPurchaseOrders() {
  try { await loadSucursalesFromAPI(); } catch(e){}
  const root = document.getElementById('page-purchase_orders');
  if (!root) return;

  const role = App.currentUser?.role;
  const canCreate = ['dueno','gerencia','jefe_mantenimiento','compras','paniol','contador'].includes(role);

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div>
        <h2 style="font-size:20px;font-weight:700;margin:0;color:var(--text)">📋 Órdenes de Compra</h2>
        <p style="font-size:13px;color:var(--text3);margin:4px 0 0">Workflow: pendiente → cotización → aprobada → pagada → recibida</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${userHasRole('dueno','gerencia') ? `<button class="btn btn-secondary btn-sm" onclick="openAreasConfigModal()">⚙ Áreas</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="_poExportPDF()" title="Descargar PDF con las OCs visibles">📄 PDF</button>
        ${canCreate ? `<button class="btn btn-primary" onclick="openNewPOModal()">+ Nueva OC</button>` : ''}
      </div>
    </div>

    <div id="po-kpi-row" class="kpi-row" style="margin-bottom:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
      <div class="kpi-card"><div class="kpi-label">Pendiente cotizar</div><div class="kpi-value" style="color:#f59e0b" id="po-kpi-pend">—</div><div class="kpi-trend">📝 Compras debe cotizar</div></div>
      <div class="kpi-card"><div class="kpi-label">En cotización / Aprobadas</div><div class="kpi-value" style="color:#38bdf8" id="po-kpi-curso">—</div><div class="kpi-trend">🔎 en proceso</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Pagadas (por recibir)</div><div class="kpi-value ok" id="po-kpi-pag">—</div><div class="kpi-trend">💰 esperando mercadería</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Recibidas</div><div class="kpi-value" style="color:#10b981" id="po-kpi-rec">—</div><div class="kpi-trend">📦 proceso completado</div></div>
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <input id="po-search" type="text" placeholder="🔍 Buscar código, proveedor, factura..." value="${App.poTable.search}"
        oninput="App.poTable.search=this.value;_poRenderRows()"
        style="flex:1;min-width:200px;max-width:320px;padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-family:inherit;font-size:13px">

      <select id="po-f-status" onchange="App.poTable.status=this.value;_poRenderRows()"
        style="padding:7px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-family:inherit;font-size:12px">
        <option value="all">Estado: Todos</option>
        <option value="pendiente_cotizacion">📝 Pendiente cotización</option>
        <option value="en_cotizacion">🔎 En cotización</option>
        <option value="aprobada_compras">✅ Aprobada por compras</option>
        <option value="pagada">💰 Pagada</option>
        <option value="recibida">📦 Recibida</option>
        <option value="rechazada">❌ Rechazada</option>
      </select>

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
        <table id="po-table" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead id="po-thead"></thead>
          <tbody id="po-tbody"><tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text3)">⏳ Cargando...</td></tr></tbody>
        </table>
      </div>
      <div id="po-footer" style="padding:10px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text3);display:flex;justify-content:space-between;align-items:center;background:var(--bg2)"></div>
    </div>
  `;

  await loadPOList();
}

// Mantener filterPO para compatibilidad con otras partes del código
async function filterPO(status) {
  App.poTable.status = status || 'all';
  const sel = document.getElementById('po-f-status');
  if (sel) sel.value = App.poTable.status;
  _poRenderRows();
}

async function loadPOList() {
  try {
    // Cache-busting para que el navegador siempre traiga datos frescos del server
    const ts = Date.now();
    const res = await apiFetch('/api/purchase-orders?_t=' + ts);
    if (!res.ok) {
      const tbody = document.getElementById('po-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--danger)">Error al cargar OCs</td></tr>`;
      return;
    }
    App.poTable.rawData = await res.json();

    // Populate los filtros de sucursal y área con valores reales
    const sucs = [...new Set(App.poTable.rawData.map(p=>p.sucursal).filter(Boolean))];
    const areas = [...new Set(App.poTable.rawData.map(p=>p.area).filter(Boolean))];
    const sucSel = document.getElementById('po-f-sucursal');
    const areaSel = document.getElementById('po-f-area');
    if (sucSel) sucSel.innerHTML = `<option value="all">Sucursal: Todas</option>` + sucs.map(s=>`<option value="${s}">${s}</option>`).join('');
    if (areaSel) areaSel.innerHTML = `<option value="all">Área: Todas</option>` + areas.map(a=>`<option value="${a}">${a}</option>`).join('');

    _poRenderKPIs();
    _poRenderRows();
  } catch(err) {
    const tbody = document.getElementById('po-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--danger)">Error: ${err.message}</td></tr>`;
  }
}

function _poRenderKPIs() {
  const data = App.poTable.rawData || [];
  const set = (id, val, color) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = val; if (color) el.style.color = color; }
  };
  set('po-kpi-pend',  data.filter(p => p.status === 'pendiente_cotizacion').length);
  set('po-kpi-curso', data.filter(p => p.status === 'en_cotizacion' || p.status === 'aprobada_compras').length);
  set('po-kpi-pag',   data.filter(p => p.status === 'pagada').length);
  set('po-kpi-rec',   data.filter(p => p.status === 'recibida').length);
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
    footer.innerHTML = `
      <span>Mostrando <b style="color:var(--text)">${rows.length}</b> de ${all.length} OCs</span>
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

function _poRenderRow(po) {
  const role = App.currentUser?.role;
  const puedeVerPrecios = _ocPuedeVerPrecios(role);
  const progress = _poProgress(po.status);

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

    <td style="padding:10px 12px;font-family:var(--mono);font-weight:700;color:var(--accent);white-space:nowrap">${origenIcon}${po.code||'—'}</td>

    <td style="padding:10px 12px">
      ${_ocEstadoBadge(po.status)}
    </td>

    <td style="padding:10px 12px;font-size:12px">
      ${po.sucursal ? `<span style='background:rgba(37,99,235,.15);color:var(--accent);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;font-family:var(--mono)'>${po.sucursal}</span>` : '<span style="color:var(--text3)">—</span>'}
    </td>

    <td style="padding:10px 12px;font-size:12px;color:var(--text3)">${po.area||'—'}</td>

    <td style="padding:10px 12px;font-size:12px;color:var(--text2)">${po.solicitante_nombre||'—'}</td>

    <td style="padding:10px 12px;font-size:12px;color:var(--text2)">${po.proveedor || '<span style="color:var(--text3)">Sin asignar</span>'}</td>

    <td style="padding:10px 12px;font-size:11px;font-family:var(--mono);color:var(--text2)">${po.factura_nro || '<span style="color:var(--text3)">—</span>'}</td>

    <td style="padding:10px 12px;min-width:120px">
      <div style="display:flex;align-items:center;gap:6px">
        <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;min-width:50px;max-width:80px">
          <div style="height:100%;background:${sideColor};width:${progress}%;transition:width .3s"></div>
        </div>
        <span style="font-size:10px;font-family:var(--mono);color:var(--text3);min-width:30px">${progress}%</span>
      </div>
    </td>

    <td style="padding:10px 12px;font-family:var(--mono);font-weight:700;font-size:12px;color:var(--text);text-align:right">
      ${puedeVerPrecios
        ? `$${Math.round(total).toLocaleString('es-AR')}${parseFloat(po.iva_pct||0) > 0 ? `<div style="font-size:9px;color:var(--text3);font-weight:400">IVA ${po.iva_pct}%</div>` : ''}`
        : `<span style="color:var(--text3)" title="Solo compras/tesorería ven los precios">—</span>`
      }
    </td>

    <td style="padding:10px 12px;font-family:var(--mono);font-size:10px;color:var(--text3);white-space:nowrap">
      ${po.created_at ? new Date(po.created_at).toLocaleDateString('es-AR') : '—'}
    </td>

    <td style="padding:10px 12px;white-space:nowrap;text-align:right">
      <button class="btn btn-secondary btn-sm" onclick="openPODetail('${po.id}')">Ver</button>
      <button class="btn btn-secondary btn-sm" onclick="printPO('${po.id}')" title="Imprimir" style="margin-left:4px">🖨</button>
      ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="deletePO('${po.id}')" style="margin-left:4px">✕</button>` : ''}
    </td>
  </tr>`;
}

function _poProgress(status) {
  const map = {
    'pendiente_cotizacion': 15,
    'en_cotizacion':        35,
    'aprobada_compras':     60,
    'pagada':               85,
    'recibida':             100,
    'rechazada':            0,
  };
  return map[status] ?? 10;
}

// Inline edit de estado de OC
async function _poInlineEdit(id, field, newValue) {
  const po = (App.poTable.rawData || []).find(p => p.id === id);
  if (!po) { showToast?.('error','OC no encontrada'); return; }

  const oldValue = po[field];
  po[field] = newValue;

  try {
    const res = await apiFetch(`/api/purchase-orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [field]: newValue })
    });
    if (!res.ok) throw new Error('Error HTTP');
    showToast?.('ok', `OC actualizada: ${newValue}`);
    _poRenderKPIs();
    _poRenderRows();
  } catch(err) {
    po[field] = oldValue; // revertir
    showToast?.('error', 'No se pudo actualizar. Revisá permisos.');
    _poRenderRows();
  }
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

  doc.setFontSize(16);
  doc.setFont('helvetica','bold');
  doc.text('Órdenes de Compra — Expreso Biletta', 40, 40);
  doc.setFontSize(9);
  doc.setFont('helvetica','normal');
  doc.setTextColor(100);
  doc.text(`Generado: ${new Date().toLocaleString('es-AR')}  ·  ${rows.length} OC${rows.length===1?'':'s'}`, 40, 58);

  const statusLabels = {
    pendiente_cotizacion: 'Pendiente cotización',
    en_cotizacion:        'En cotización',
    aprobada_compras:     'Aprobada compras',
    pagada:               'Pagada',
    recibida:             'Recibida',
    rechazada:            'Rechazada',
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
    startY: 72,
    head: [['Código','Estado','Sucursal','Área','Solicitante','Proveedor','Factura','Total','Fecha']],
    body: tableData,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles: {
      0: { cellWidth: 70, fontStyle: 'bold' },
      7: { halign: 'right', fontStyle: 'bold' },
    },
  });

  const totalMonto = rows.reduce((a,p) => { const tr = parseFloat(p.total_real||0); return a + (tr > 0 ? tr : parseFloat(p.total_estimado||0)); }, 0);
  const finalY = doc.lastAutoTable.finalY || 90;
  doc.setFontSize(10);
  doc.setFont('helvetica','bold');
  doc.text(`TOTAL VISIBLE: $${Math.round(totalMonto).toLocaleString('es-AR')}`, 40, finalY + 20);

  doc.save(`OCs-Biletta-${todayISO()}.pdf`);
  showToast?.('ok','PDF descargado');
}

// ── Modal nueva OC ────────────────────────────────────────
async function openNewPOModal() {
  // Roles solicitantes (jefe mant, pañol/depósito, contador/administración)
  // usan un modal específico SIN precios / proveedor.
  // Ese workflow lo completa compras después.
  if (['jefe_mantenimiento','paniol','contador'].includes(App.currentUser?.role)) {
    return openNewPOModalJefe();
  }

  try { await loadSucursalesFromAPI(); } catch(e){}
  window._poTipo = 'flota';
  window._poIvaPct = 0;
  window._poSupplierId = null; // para guardar el ID del proveedor del catálogo si se elige uno

  // Proveedores del catálogo nuevo (módulo Proveedores)
  const catalogoProveedores = (App.data.suppliers || []).filter(s => s.status === 'activo');

  // Fallback: si no hay catálogo cargado, traer los nombres históricos usados en OCs anteriores
  var proveedoresPrev = [];
  try {
    const rp = await apiFetch('/api/purchase-orders/aux/proveedores');
    if (rp.ok) proveedoresPrev = await rp.json();
  } catch(e) {}

  var solicitante = App.currentUser?.name || App.currentUser?.email || '—';

  openModal('📋 Nueva Orden de Compra', `
    <!-- ORIGEN -->
    <div class="card" style="padding:12px 16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">🏢 Origen</div>
        <div style="font-size:11px;color:var(--text3)">👤 Solicita: <span style="font-weight:700;color:var(--accent)">${solicitante}</span></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
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

    <!-- DESTINO -->
    <div class="card" style="padding:12px 16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">🚛 Destino</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div class="form-group" style="margin:0">
          <label class="form-label">Tipo de orden</label>
          <select class="form-select" id="po-tipo-select" onchange="setPOTipo(this.value)">
            <option value="flota">🚛 Flota</option>
            <option value="mantenimiento">🏪 Mantenimiento edilicio</option>
            <option value="otro">📋 Otro</option>
          </select>
        </div>
        <div class="form-group" style="margin:0" id="po-vehicle-field">
          <label class="form-label">Vehículo (opcional)</label>
          <select class="form-select" id="po-vehicle">
            <option value="">— Sin vehículo asignado —</option>
            ${(App.data.vehicles||[]).map(v => `<option value="${v.id}">${v.code} · ${v.plate}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">Proveedor <span style="color:var(--danger)">*</span></label>
        ${catalogoProveedores.length > 0 ? `
          <select class="form-select" id="po-supplier-select" onchange="_poOnSupplierChange(this.value)">
            <option value="">— Seleccioná del catálogo —</option>
            ${catalogoProveedores.map(s => `<option value="${s.id}" data-name="${s.name}" data-fpago="${s.forma_pago||''}" data-ccdias="${s.cc_dias||''}" data-moneda="${s.moneda||'ARS'}">${s.name}${s.cuit ? ' · ' + s.cuit : ''}</option>`).join('')}
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
    </div>

    <!-- PAGO Y MONEDA -->
    <div class="card" style="padding:12px 16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">💳 Pago y moneda</div>
      <div id="po-extra-fields"></div>
    </div>

    <!-- ARTÍCULOS -->
    <div class="card" style="padding:12px 16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">🛒 Artículos</div>
        <button class="btn btn-secondary btn-sm" onclick="addPOItem()">+ Agregar artículo</button>
      </div>
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

    <!-- OBSERVACIONES -->
    <div class="card" style="padding:12px 16px;margin-bottom:4px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">📝 Observaciones (opcional)</div>
      <textarea class="form-textarea" id="po-notes" rows="2" placeholder="Ej: Repuestos para preventivo INT-08"></textarea>
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
          <select class="form-select" id="poj-sucursal" onchange="updatePOJefeAreaSelect()">
            <option value="">— Seleccionar sucursal —</option>
            ${(App.config?.bases||[]).map(b => `<option value="${b}">${b}</option>`).join('')}
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
            ${(App.data.vehicles||[]).map(v => `<option value="${v.id}">${v.code} · ${v.plate}</option>`).join('')}
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

    <!-- NOTAS -->
    <div class="card" style="padding:12px 16px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">🗒️ Notas / problema</div>
      <textarea class="form-textarea" id="poj-notes" rows="3" placeholder="Describí el problema o contexto de la compra (opcional pero recomendado)"></textarea>
    </div>
  `, [
    { label:'Cancelar',        cls:'btn-secondary', fn: closeModal },
    { label:'Enviar solicitud', cls:'btn-primary',   fn: saveNewPOJefe },
  ]);

  // Agregar 1 ítem inicial
  setTimeout(() => addPOJefeItem(), 50);
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
           <div style="font-size:12px;color:var(--text)">${file.name}</div>
           <div style="font-size:10px;color:var(--text3);margin-top:4px">PDF subido (${Math.round(file.size/1024)}KB) · click para cambiar</div>`
        : `<img src="${e.target.result}" style="max-width:120px;max-height:100px;border-radius:6px;margin-bottom:4px">
           <div style="font-size:11px;color:var(--text3)">${file.name} · click para cambiar</div>`;
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
    sucursal, area, notes,
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
      body: JSON.stringify({ notes, sucursal, area, proveedor, supplier_id, tipo, vehicle_id: vehicle_id||null, ...extra, iva_pct: ivaPct, items })
    });
    window._poIvaPct = 0;
    window._poSupplierId = null;
    if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error'); return; }
    const po = await res.json();
    closeModal();
    showToast('ok', `OC ${po.code} creada`);
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

  // Autocompletar si los campos existen (se renderizan por setPOTipo -> getPOExtraFields)
  setTimeout(() => {
    const fpagoEl  = document.getElementById('po-forma-pago');
    const ccdiasEl = document.getElementById('po-cc-dias');
    const monedaEl = document.getElementById('po-moneda');

    if (fpagoEl && fpago)  fpagoEl.value = fpago;
    if (ccdiasEl && ccdias) ccdiasEl.value = ccdias;
    if (monedaEl && moneda) monedaEl.value = moneda;

    if (fpagoEl && fpago && typeof updatePOCCVisibility === 'function') {
      updatePOCCVisibility();
    }
  }, 50);

  showToast?.('ok', 'Condiciones del proveedor cargadas automáticamente');
}

// ── Ver detalle de OC ────────────────────────────────────
async function openPODetail(id) {
  try {
    // Cache-busting: siempre datos frescos al abrir el detalle
    const ts = Date.now();
    const res = await apiFetch(`/api/purchase-orders/${id}?_t=${ts}`);
    if (!res.ok) { showToast('error','Error al cargar OC'); return; }
    const po = await res.json();

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
      if (po.status === 'aprobada_compras') {
        canEdit = true;
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
      rechazada:            { label:'RECHAZADA',            color:'#ef4444', icon:'❌' }
    };
    const st = estadoInfo[po.status] || { label:(po.status||'').toUpperCase(), color:'#6b7280', icon:'📋' };
    const esTerminal = ['recibida','rechazada'].includes(po.status);
    window._ocEditValues = { forma_pago: po.forma_pago, cc_dias: po.cc_dias, moneda: po.moneda };

    const totalReal = po.items.reduce((a,i) => a + parseFloat(i.subtotal||0), 0);
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

    openModal(`${st.icon} ${po.code} — ${po.sucursal||'—'} · ${po.area||'—'}`, `
      <div style="background:${st.color}22;border:1px solid ${st.color};border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="background:${st.color};color:white;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700">${st.label}</span>
          <span style="font-size:13px;color:var(--text2)">${po.moneda==='USD'?'US$':'$'} ${po.forma_pago==='cuenta_corriente'?'Cuenta corriente a '+(po.cc_dias||0)+' días':(po.forma_pago==='contado'?'Contado':'—')}</span>
        </div>
        <div style="font-size:11px;color:var(--text3)">Creada ${fmt(po.created_at)}</div>
      </div>

      ${(!canEdit && bloqueoMensaje && !esTerminal) ? `
      <div style="background:rgba(107,114,128,.12);border:1px solid rgba(107,114,128,.4);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text2)">
        <span style="font-size:18px">🔒</span>
        <span>${bloqueoMensaje}</span>
      </div>` : ''}
      ${esTerminal ? `
      <div style="background:rgba(107,114,128,.12);border:1px solid rgba(107,114,128,.4);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text2)">
        <span style="font-size:18px">🔒</span>
        <span>Esta OC está en estado final (${po.status === 'recibida' ? 'Recibida' : 'Rechazada'}) y ya no se puede modificar.</span>
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
        <div style="font-size:13px;color:var(--text)">${po.motivo_devolucion}</div>
      </div>` : ''}

      ${po.vehicle_id ? `
      <div class="card" style="padding:12px 16px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">🚛 Vehículo</div>
        <div style="font-size:15px;font-weight:700;color:var(--accent)">${vehInfoDet.code || '—'} · ${vehInfoDet.plate || '—'}</div>
        ${po.ot_id ? `<div style="font-size:11px;margin-top:4px">✅ OT generada: <a onclick="closeModal();navigate('workorders')" style="color:var(--accent);cursor:pointer;text-decoration:underline">Ver en OTs</a></div>` :
          (po.status==='aprobada_compras' ? '<div style="font-size:11px;color:var(--text3);margin-top:3px">💡 Al recibir se generará automáticamente una OT con el costo de la factura</div>' : '')}
      </div>` : ''}

      ${puedeVerPrecios ? `
      <div class="card" style="padding:12px 16px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">💰 Datos de factura</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Proveedor</label>
            <input class="form-input" id="pod-proveedor" value="${po.proveedor||''}" placeholder="Nombre del proveedor" ${canEdit && !esTerminal?'':'readonly'}>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Nro. Factura</label>
            <input class="form-input" id="pod-factura-nro" value="${po.factura_nro||''}" placeholder="0001-00012345" ${canEdit && !esTerminal?'':'readonly'}>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Fecha factura</label>
            <input class="form-input" type="date" id="pod-factura-fecha" value="${po.factura_fecha?.slice(0,10)||''}" ${canEdit && !esTerminal?'':'readonly'}>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Monto factura</label>
            <input class="form-input" type="number" id="pod-factura-monto" value="${po.factura_monto||''}" placeholder="0" ${canEdit && !esTerminal?'':'readonly'}>
          </div>
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
        <div style="padding:10px 16px;border-bottom:1px solid var(--border2);font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">🛒 Artículos</div>
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
              <td>${i.descripcion}</td>
              <td style="text-align:center">${parseFloat(i.cantidad)}</td>
              <td style="text-align:center">${i.unidad}</td>
              ${puedeVerPrecios ? `
                <td style="text-align:right;font-family:monospace">${po.moneda==='USD'?'US$':'$'}${parseFloat(i.precio_unit||0).toLocaleString('es-AR')}</td>
                <td style="text-align:right;font-family:monospace;font-weight:600">${po.moneda==='USD'?'US$':'$'}${Math.round(parseFloat(i.subtotal||0)).toLocaleString('es-AR')}</td>
              ` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
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

      <div class="card" style="padding:12px 16px;margin-bottom:4px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">📝 Observaciones</div>
        <textarea class="form-textarea" id="pod-notes" rows="2" ${canEdit && !esTerminal?'':'readonly'} placeholder="—">${po.notes||''}</textarea>
      </div>`,
      [
        { label:'Cerrar', cls:'btn-secondary', fn: closeModal },
        { label:'🖨 Imprimir', cls:'btn-secondary', fn: () => { closeModal(); printPO(id); } },
        // Botones de EDICIÓN: solo compras/tesorería/dueño/gerencia (NO jefe mant)
        ...(canEdit && !esTerminal ? [
          { label:'✏️ Editar artículos', cls:'btn-secondary', fn: () => { closeModal(); openEditPOItemsModal(id); } },
          { label:'💾 Guardar cambios', cls:'btn-secondary', fn: () => savePODetail(id) },
        ] : []),
        // Acciones del workflow según rol y estado actual (disponibles para TODOS los roles según el flow)
        ...(!esTerminal ? [
          ...((po.status==='pendiente_cotizacion' && (role==='compras' || ['dueno','gerencia'].includes(role))) ? [
            { label:'🔎 Tomar cotización', cls:'btn-primary', fn: () => tomarCotizacionOC(id) },
          ] : []),
          ...((['pendiente_cotizacion','en_cotizacion'].includes(po.status) && (role==='compras' || ['dueno','gerencia'].includes(role))) ? [
            { label:'✅ Aprobar con precios', cls:'btn-primary', fn: () => aprobarOC(id) },
          ] : []),
          ...((po.status==='aprobada_compras' && (role==='tesoreria' || ['dueno','gerencia'].includes(role))) ? [
            { label:'💰 Registrar pago', cls:'btn-primary', fn: () => pagarOC(id) },
          ] : []),
          ...((po.status==='pagada' && ((['jefe_mantenimiento','paniol','contador','compras'].includes(role) && esCreador) || ['dueno','gerencia'].includes(role))) ? [
            { label:'📦 Confirmar recepción', cls:'btn-primary', fn: () => recibirOC(id) },
          ] : []),
          // Devolver a etapa anterior (si corresponde al rol y estado)
          ...(((role==='compras' && po.status==='en_cotizacion') ||
               (role==='tesoreria' && po.status==='aprobada_compras') ||
               (['jefe_mantenimiento','paniol','contador'].includes(role) && esCreador && po.status==='pagada') ||
               (['dueno','gerencia'].includes(role) && ['en_cotizacion','aprobada_compras','pagada'].includes(po.status))) ? [
            { label:'⏪ Devolver', cls:'btn-warn', fn: () => devolverOC(id, po.status) },
          ] : []),
          // Rechazar: según rol + estado (controlado por backend también)
          ...(((['jefe_mantenimiento','paniol','contador'].includes(role) && esCreador && po.status==='pendiente_cotizacion') ||
               (role==='compras' && ['pendiente_cotizacion','en_cotizacion'].includes(po.status)) ||
               (role==='tesoreria' && po.status==='aprobada_compras') ||
               ['dueno','gerencia'].includes(role)) ? [
            { label:'❌ Rechazar', cls:'btn-danger', fn: () => rechazarOC(id) },
          ] : []),
        ] : [])
      ]
    );

    if (typeof renderPOExtraFields === 'function') {
      renderPOExtraFields(po.tipo, 'pod-extra-fields');
    }
  } catch(err) { showToast('error', err.message); }
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

    // Proveedor (solo si existe el input y tiene valor)
    const provEl = document.getElementById('pod-proveedor');
    if (provEl && provEl.value !== undefined) body.proveedor = provEl.value.trim() || null;

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

    // NO mandamos sucursal, area, vehicle_id porque NO existen esos inputs en el modal detalle.
    // Esos campos solo se pueden editar al crear la OC.

    if (Object.keys(body).length === 0) {
      showToast('warn', 'Nada para guardar');
      return;
    }

    const res = await apiFetch(`/api/purchase-orders/${id}`, { method:'PATCH', body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error al guardar'); return; }
    closeModal();
    showToast('ok','✅ Cambios guardados');
    await loadPOList(_poCurrentFilter);
  } catch(err) { showToast('error', err.message); }
}

async function deletePO(id) {
  if (!confirm('¿Eliminar esta OC? Esta acción no se puede deshacer.')) return;
  try {
    const res = await apiFetch(`/api/purchase-orders/${id}`, { method:'DELETE' });
    if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error'); return; }
    showToast('ok','OC eliminada');
    await loadPOList(_poCurrentFilter);
  } catch(err) { showToast('error', err.message); }
}

// ── Impresión de OC ──────────────────────────────────────
async function printPO(id) {
  try {
    // Cache-busting para traer datos FRESCOS del servidor (no cache del browser)
    const ts = Date.now();
    const res = await apiFetch(`/api/purchase-orders/${id}?_t=${ts}`);
    if (!res.ok) { showToast('error','Error al cargar OC'); return; }
    const po = await res.json();
    const totalReal = po.items.reduce((a,i) => a + parseFloat(i.subtotal||0), 0);
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
      <title>OC ${po.code} — Biletta</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size:13px; color:#111; padding:32px; background:#fff; }
        .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28px; padding-bottom:20px; border-bottom:3px solid #1e3a8a; }
        .logo-wrap { display:flex; align-items:center; gap:14px; }
        .logo-square { width:52px; height:52px; background:#1e3a8a; color:#fff; border-radius:8px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:18px; letter-spacing:1px; }
        .empresa { font-size:20px; font-weight:700; color:#111; }
        .empresa-sub { font-size:11px; color:#6b7280; margin-top:2px; }
        .doc-code { font-size:22px; font-weight:700; font-family:monospace; color:#1e3a8a; text-align:right; }
        .doc-sub { font-size:11px; color:#6b7280; text-align:right; margin-top:4px; }
        .status-pill { display:inline-block; padding:4px 12px; border-radius:20px; font-size:11px; font-weight:700; margin-top:6px; text-transform:uppercase; letter-spacing:.5px; }
        .section { margin-bottom:22px; }
        .section-title { font-size:11px; font-weight:700; color:#1e3a8a; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px; border-bottom:1px solid #e5e7eb; padding-bottom:6px; }
        .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }
        .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        .field { margin-bottom:8px; }
        .field-label { font-size:10px; color:#9ca3af; text-transform:uppercase; letter-spacing:.5px; margin-bottom:2px; }
        .field-value { font-size:13px; font-weight:500; color:#111; }
        table { width:100%; border-collapse:collapse; font-size:12px; }
        thead tr { background:#eff6ff; }
        th { text-align:left; padding:8px; border-bottom:2px solid #1e3a8a; font-size:10px; text-transform:uppercase; letter-spacing:.5px; color:#1e3a8a; font-weight:700; }
        td { padding:7px 8px; border-bottom:1px solid #f3f4f6; }
        .total-row td { background:#f9fafb; font-weight:700; }
        .grand-total td { background:#1e3a8a; color:#fff; font-size:14px; font-weight:700; padding:10px 8px; }
        .firma-section { display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px; margin-top:40px; }
        .firma-box { border-top:1px solid #333; padding-top:8px; text-align:center; font-size:11px; color:#6b7280; }
        .observ-box { background:#f9fafb; border-left:3px solid #1e3a8a; padding:10px 14px; font-size:12px; border-radius:4px; margin-top:6px; }
        @media print { body { padding:16px; } @page { margin:12mm; } }
      </style>
    </head><body>
      <div class="header">
        <div class="logo-wrap">
          <div class="logo-square">B</div>
          <div>
            <div class="empresa">Expreso Biletta S.A.</div>
            <div class="empresa-sub">Sistema de gestión de flota y taller</div>
          </div>
        </div>
        <div>
          <div class="doc-code">${po.code}</div>
          <div class="doc-sub">ORDEN DE COMPRA</div>
          <div class="doc-sub">Fecha: ${new Date(po.created_at).toLocaleDateString('es-AR')}</div>
          <div style="margin-top:6px;text-align:right">
            <span class="status-pill" style="${statusBadge}">${(po.status||'').replace('_',' ')}</span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">📋 Datos del pedido</div>
        <div class="grid3">
          <div class="field"><div class="field-label">Sucursal</div><div class="field-value">${po.sucursal||'—'}</div></div>
          <div class="field"><div class="field-label">Área</div><div class="field-value">${po.area||'—'}</div></div>
          <div class="field"><div class="field-label">Solicitado por</div><div class="field-value">${po.solicitante_nombre||'—'}</div></div>
          <div class="field"><div class="field-label">Proveedor</div><div class="field-value">${po.proveedor||'—'}</div></div>
          <div class="field"><div class="field-label">Vehículo asociado</div><div class="field-value">${vehInfo.code || '—'}${vehInfo.plate ? ' ('+vehInfo.plate+')' : ''}</div></div>
          <div class="field"><div class="field-label">Moneda</div><div class="field-value">${po.moneda==="USD" ? "Dólares (USD)" : "Pesos (ARS)"}</div></div>
        </div>
      </div>

      ${po.factura_nro || po.factura_fecha || po.factura_monto ? `
      <div class="section">
        <div class="section-title">💰 Datos de facturación</div>
        <div class="grid3">
          <div class="field"><div class="field-label">Nº Factura</div><div class="field-value">${po.factura_nro||'—'}</div></div>
          <div class="field"><div class="field-label">Fecha Factura</div><div class="field-value">${po.factura_fecha ? new Date(po.factura_fecha).toLocaleDateString('es-AR') : '—'}</div></div>
          <div class="field"><div class="field-label">Monto Factura</div><div class="field-value">${po.factura_monto ? '$'+parseFloat(po.factura_monto).toLocaleString('es-AR') : '—'}</div></div>
          <div class="field"><div class="field-label">IVA</div><div class="field-value">${po.iva_pct ? po.iva_pct+'%' : '—'}</div></div>
          <div class="field"><div class="field-label">Forma de pago</div><div class="field-value">${po.forma_pago==="contado" ? "Contado" : (po.forma_pago==="cuenta_corriente" ? ("Cta. cte. a "+(po.cc_dias||0)+" días") : "—")}</div></div>
          <div class="field"><div class="field-label">Estado</div><div class="field-value">${(po.status||'').replace('_',' ')}</div></div>
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
              <td>${i.descripcion}</td>
              <td style="text-align:center">${parseFloat(i.cantidad)}</td>
              <td style="text-align:center">${i.unidad||'un'}</td>
              <td style="text-align:right">$${parseFloat(i.precio_unit).toLocaleString('es-AR')}</td>
              <td style="text-align:right;font-weight:600">$${Math.round(parseFloat(i.subtotal||0)).toLocaleString('es-AR')}</td>
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
        <div class="observ-box">${po.observaciones}</div>
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
            <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:8px">Pagó tesorería</td><td style="padding:8px">${po.pagador_nombre ? '<b>'+po.pagador_nombre+'</b>' : '—'}</td><td style="padding:8px">${po.pagado_at ? new Date(po.pagado_at).toLocaleString('es-AR') : '—'}</td></tr>
            <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:8px">Recibió mercadería</td><td style="padding:8px">${po.receptor_nombre ? '<b>'+po.receptor_nombre+'</b>' : '—'}</td><td style="padding:8px">${po.recibido_at ? new Date(po.recibido_at).toLocaleString('es-AR') : '—'}</td></tr>
            ${po.status === 'rechazada' ? `<tr style="background:#fee2e2"><td style="padding:8px">Rechazada</td><td style="padding:8px"><b>${po.rechazador_nombre||'—'}</b></td><td style="padding:8px">${po.rechazado_at ? new Date(po.rechazado_at).toLocaleString('es-AR') : '—'}</td></tr>` : ''}
          </tbody>
        </table>
        ${po.motivo_devolucion ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;padding:8px 10px;margin-top:10px;font-size:11px"><b>⏪ Devuelta por:</b> ${po.motivo_devolucion}</div>` : ''}
        ${po.motivo_rechazo ? `<div style="background:#fee2e2;border:1px solid #ef4444;border-radius:4px;padding:8px 10px;margin-top:10px;font-size:11px"><b>❌ Motivo de rechazo:</b> ${po.motivo_rechazo}</div>` : ''}
        <div style="margin-top:12px;padding:10px;background:#eff6ff;border:1px solid #3b82f6;border-radius:4px;font-size:12px">
          <b>📍 Estado actual:</b> <span style="${statusBadge};padding:2px 8px;border-radius:4px;font-weight:700">${po.status.toUpperCase()}</span>
        </div>
      </div>

      <div class="firma-section">
        <div class="firma-box">Solicitado por<br><br><br></div>
        <div class="firma-box">Autorizado por<br><br><br></div>
        <div class="firma-box">Recibido / Conforme<br><br><br></div>
      </div>

      <div style="margin-top:32px;font-size:10px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;padding-top:10px">
        Expreso Biletta S.A. · Orden de Compra ${po.code} · Generado el ${nowDateAR()} ${nowTimeAR()}
      </div>
    </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 500);
  } catch(err) { showToast('error', err.message); }
}


// ── Editar ítems de una OC existente ─────────────────────
async function openEditPOItemsModal(id) {
  try {
    const res = await apiFetch(`/api/purchase-orders/${id}`);
    if (!res.ok) { showToast('error','Error al cargar OC'); return; }
    const po = await res.json();

    const itemRows = po.items.map((item, idx) => buildEditPOItemRow(idx, item)).join('');

    openModal(`✏️ Editar artículos — ${po.code}`, `
      <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--warn);margin-bottom:14px">
        ⚠️ Al guardar se reemplazarán todos los artículos actuales por los que estén en esta lista.
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <label class="form-label" style="margin:0;font-weight:700">Artículos</label>
        <button class="btn btn-secondary btn-sm" onclick="addEditPOItem()">+ Agregar artículo</button>
      </div>
      <div id="epo-items">${itemRows}</div>
      <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 14px;font-size:13px;display:flex;justify-content:space-between;align-items:center;margin-top:12px">
        <span style="color:var(--text3)">Total estimado</span>
        <span id="epo-total" style="font-weight:700;font-size:16px;font-family:monospace">
          $${Math.round(po.items.reduce((a,i) => a + parseFloat(i.subtotal||0), 0)).toLocaleString('es-AR')}
        </span>
      </div>`,
      [
        { label:'Cancelar',          cls:'btn-secondary', fn: closeModal },
        { label:'Guardar artículos', cls:'btn-primary',   fn: () => saveEditPOItems(id) },
      ]
    );
    window._editPOItemCount = po.items.length;
  } catch(err) { showToast('error', err.message); }
}

function buildEditPOItemRow(idx, item = {}) {
  return `<div id="epo-item-${idx}" style="display:grid;grid-template-columns:1fr 80px 80px 120px 32px;gap:6px;margin-bottom:6px;align-items:center">
    <input class="form-input" placeholder="Descripción" id="epoi-desc-${idx}" value="${(item.descripcion||'').replace(/"/g,'&quot;')}" oninput="updateEditPOTotal()" style="font-size:13px">
    <input class="form-input" type="number" placeholder="Cant." id="epoi-qty-${idx}" value="${parseFloat(item.cantidad||1)}" min="0.01" step="0.01" oninput="updateEditPOTotal()" style="font-size:13px;text-align:center">
    <input class="form-input" placeholder="Unid." id="epoi-unit-${idx}" value="${item.unidad||'un'}" style="font-size:13px;text-align:center">
    <input class="form-input" type="number" placeholder="Precio unit." id="epoi-price-${idx}" value="${parseFloat(item.precio_unit||0)}" min="0" oninput="updateEditPOTotal()" style="font-size:13px;text-align:right">
    <button style="background:none;border:1px solid var(--border2);border-radius:6px;cursor:pointer;color:var(--danger);font-size:16px;padding:0 6px;height:36px" onclick="removeEditPOItem(${idx})">✕</button>
  </div>`;
}

function addEditPOItem() {
  const container = document.getElementById('epo-items');
  if (!container) return;
  const div = document.createElement('div');
  div.innerHTML = buildEditPOItemRow(window._editPOItemCount || 99);
  container.appendChild(div.firstElementChild);
  window._editPOItemCount = (window._editPOItemCount || 99) + 1;
}

function removeEditPOItem(idx) {
  document.getElementById(`epo-item-${idx}`)?.remove();
  updateEditPOTotal();
}

function updateEditPOTotal() {
  let total = 0;
  document.querySelectorAll('[id^="epoi-qty-"]').forEach(qtyEl => {
    const idx   = qtyEl.id.replace('epoi-qty-', '');
    const qty   = parseFloat(qtyEl.value) || 0;
    const price = parseFloat(document.getElementById(`epoi-price-${idx}`)?.value) || 0;
    total += qty * price;
  });
  const el = document.getElementById('epo-total');
  if (el) el.textContent = '$' + Math.round(total).toLocaleString('es-AR');
}

async function saveEditPOItems(id) {
  try {
    const items = [];
    document.querySelectorAll('[id^="epoi-desc-"]').forEach(descEl => {
      const idx   = descEl.id.replace('epoi-desc-', '');
      const desc  = descEl.value.trim();
      if (!desc) return;
      items.push({
        descripcion: desc,
        cantidad:    parseFloat(document.getElementById(`epoi-qty-${idx}`)?.value)   || 1,
        unidad:      document.getElementById(`epoi-unit-${idx}`)?.value              || 'un',
        precio_unit: parseFloat(document.getElementById(`epoi-price-${idx}`)?.value) || 0,
      });
    });
    if (!items.length) { showToast('warn','Agregá al menos un artículo'); return; }

    const res = await apiFetch(`/api/purchase-orders/${id}/items`, {
      method: 'PUT',
      body: JSON.stringify({ items })
    });
    if (!res.ok) { const e = await res.json(); showToast('error', e.error||'Error'); return; }

    showToast('ok', '✅ Artículos actualizados');

    // Cerrar modal de edición
    closeModal();

    // Esperar un tick y volver a abrir el modal de detalle con datos frescos
    // así el usuario sigue en el contexto de la OC
    setTimeout(async () => {
      await openPODetail(id);
    }, 100);

    // Refrescar listado en paralelo (no esperamos)
    loadPOList(_poCurrentFilter);
  } catch(err) { showToast('error', err.message||'Error al guardar'); }
}

// funciones auxiliares OC
function getPODetailExtraFields() {
  var tipo = document.getElementById('pod-tipo')?.value || 'flota';
  if (tipo === 'flota') return { tipo };
  var prefix = 'pod-x';
  return {
    tipo,
    urgencia:      document.getElementById(prefix+'-urgencia')?.value || 'normal',
    local_sector:  document.getElementById(prefix+'-local')?.value?.trim() || null,
    sector_detalle:document.getElementById(prefix+'-sector')?.value || null,
    equipo:        document.getElementById(prefix+'-equipo')?.value?.trim() || null,
    activo_serie:  document.getElementById(prefix+'-serie')?.value?.trim() || null,
    problema_desc: document.getElementById(prefix+'-problema')?.value?.trim() || null,
  };
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

async function recibirOC(id) {
  try {
    // Primero ver datos de la OC
    const res = await apiFetch('/api/purchase-orders/' + id);
    if (!res.ok) { showToast('error','Error al cargar OC'); return; }
    const po = await res.json();

    var vehiculo = po.vehicle_id
      ? (App.data.vehicles||[]).find(function(v){ return v.id === po.vehicle_id; })
      : null;

    // Contar cuántos ítems están vinculados al stock (para el mensaje de confirmación)
    const itemsVinculados = (po.items || []).filter(i => i.stock_item_id).length;
    const itemsTotal = (po.items || []).length;

    var partes = ['Vas a marcar la OC ' + po.code + ' como RECIBIDA.\n'];
    if (itemsVinculados > 0) {
      partes.push('📦 ' + itemsVinculados + ' de ' + itemsTotal + ' ítems se INGRESARÁN automáticamente al stock.');
    }
    if (itemsTotal - itemsVinculados > 0) {
      partes.push('⚠️  ' + (itemsTotal - itemsVinculados) + ' ítems NO están vinculados al stock (no ingresan).');
    }
    if (vehiculo) {
      partes.push('\n🚛 Se generará OT para ' + vehiculo.code + ' (' + vehiculo.plate + ') con el costo de la factura.');
    }
    partes.push('\n¿Confirmás?');

    if (!confirm(partes.join('\n'))) return;

    const r = await apiFetch('/api/purchase-orders/' + id + '/recibir', { method: 'POST' });
    if (!r.ok) { var e = await r.json(); showToast('error', e.error||'Error'); return; }
    var data = await r.json();

    // Armar mensaje de resumen según lo que haya pasado
    const ingresos = data.stock_ingresos || [];
    const warnings = data.stock_warnings || [];
    let toastMsg = '✅ OC recibida';
    if (ingresos.length > 0) {
      toastMsg += ' · ' + ingresos.length + ' ítem' + (ingresos.length===1?'':'s') + ' ingresado' + (ingresos.length===1?'':'s') + ' al stock';
    }
    if (data.ot_generada) {
      toastMsg += ' · OT ' + data.ot_code + ' generada';
    }
    showToast('ok', toastMsg);

    // Si hubo ingresos al stock, mostrar un modal informativo con detalle
    if (ingresos.length > 0 || warnings.length > 0) {
      setTimeout(() => {
        const ingresosHTML = ingresos.length > 0 ? `
          <div style="font-size:11px;color:var(--ok);font-weight:700;margin-top:12px;margin-bottom:8px">📦 INGRESADO AL STOCK</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:var(--bg3)">
                <th style="text-align:left;padding:6px">Código</th>
                <th style="text-align:left;padding:6px">Nombre</th>
                <th style="text-align:right;padding:6px">Cant.</th>
                <th style="text-align:right;padding:6px">Nuevo precio</th>
                <th style="text-align:right;padding:6px">Stock total</th>
              </tr>
            </thead>
            <tbody>
              ${ingresos.map(it => `<tr style="border-bottom:1px solid var(--border)">
                <td style="padding:6px;font-family:var(--mono);font-size:11px">${it.codigo}</td>
                <td style="padding:6px">${it.nombre}</td>
                <td style="padding:6px;text-align:right;font-weight:700">+${it.cantidad}</td>
                <td style="padding:6px;text-align:right;color:var(--accent)">$${Math.round(it.precio_nuevo).toLocaleString('es-AR')}</td>
                <td style="padding:6px;text-align:right;font-weight:700;color:var(--ok)">${it.nuevo_stock}</td>
              </tr>`).join('')}
            </tbody>
          </table>` : '';

        const warningsHTML = warnings.length > 0 ? `
          <div style="font-size:11px;color:var(--warn);font-weight:700;margin-top:16px;margin-bottom:8px">⚠️ ÍTEMS NO INGRESADOS AL STOCK</div>
          <div style="background:rgba(217,119,6,.10);border-left:3px solid var(--warn);padding:10px;border-radius:var(--radius);font-size:12px">
            ${warnings.map(w => '• ' + w).join('<br>')}
            <div style="margin-top:8px;color:var(--text3);font-size:11px">
              Estos ítems no tenían un ítem de stock vinculado al crear la OC.
              Si querés que entren al stock, cargalos manualmente desde el módulo <b>Stock y pañol</b>.
            </div>
          </div>` : '';

        openModal(
          '📥 OC ' + po.code + ' recibida',
          `<div style="max-height:70vh;overflow-y:auto">
            <p style="font-size:13px;color:var(--text2)">La orden de compra quedó registrada como recibida. ${ingresos.length > 0 ? 'El stock se actualizó automáticamente con los nuevos ingresos y precios.' : ''}</p>
            ${ingresosHTML}
            ${warningsHTML}
            ${data.ot_generada ? `<div style="font-size:11px;color:var(--accent);font-weight:700;margin-top:16px">🔧 OT GENERADA: ${data.ot_code}</div>` : ''}
          </div>`,
          [
            { label: 'Cerrar', cls: 'btn-secondary', fn: closeModal },
            ...(data.ot_generada ? [{ label: 'Ver OT', cls: 'btn-primary', fn: () => { closeModal(); navigate('workorders'); } }] : []),
          ]
        );
      }, 300);
    }

    // Refrescar listado y data
    try { await loadInitialData(); } catch(e) {}
    await loadPOList();
  } catch(err) { showToast('error', err.message||'Error'); }
}

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

  // Recalcular en vivo: Subtotal, IVA, Total según el nuevo porcentaje
  const subEl = document.getElementById('pod-subtotal-display');
  const ivaRowEl = document.getElementById('pod-iva-row');
  const ivaRowLabelEl = document.getElementById('pod-iva-row-label');
  const ivaRowMontoEl = document.getElementById('pod-iva-row-monto');
  const totEl = document.getElementById('pod-total-display');
  if (!subEl || !totEl) return;

  // Leer el subtotal actual (está como "$15.000" o "US$15.000")
  // OJO: el punto es separador de miles en es-AR, no decimal
  const subTxt = subEl.textContent || '';
  const isUSD = subTxt.startsWith('US$');
  const prefix = isUSD ? 'US$' : '$';
  // Quitar símbolo de moneda y puntos de miles. Convertir coma decimal a punto.
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
    return '<div onclick="selectPOStockItem('+idx+',\''+s.id+'\',\''+s.name.replace(/'/g,"\\'").replace(/"/g,'&quot;')+'\',\''+s.unit+'\','+parseFloat(s.unit_cost||0)+','+parseFloat(s.qty_current||0)+')"'
      +' style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center"'
      +' onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'">'
      +'<div><span style="font-weight:600">'+s.name+'</span>'
      +'<span style="color:var(--text3);margin-left:8px;font-family:monospace;font-size:11px">'+s.code+'</span>'
      +sucLabel+'</div>'
      +'<div style="text-align:right">'
      +'<div style="font-weight:700;color:var(--accent)">$'+Math.round(s.unit_cost||0).toLocaleString('es-AR')+'/'+s.unit+'</div>'
      +'<div style="font-size:10px;color:'+critColor+'">Stock: '+parseFloat(s.qty_current||0)+' '+s.unit+'</div>'
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
  } catch(err) {
    showToast('error', err.message || 'Error al guardar');
  }
}

/* ═══════════════════════════════════════════════════════════
   OC EXTRAS v1 — forma de pago, cc_dias, moneda + sucursales API
   ═══════════════════════════════════════════════════════════ */

async function loadSucursalesFromAPI() {
  try {
    const res = await apiFetch('/api/sucursales');
    if (res.ok === false) return;
    const rows = await res.json();
    if (Array.isArray(rows) === false) return;
    App.config = App.config || {};
    App.config.bases = rows.map(function(r){ return r.nombre; });
    App.config.areas = {};
    rows.forEach(function(r){
      App.config.areas[r.nombre] = Array.isArray(r.areas) ? r.areas : [];
    });
  } catch(e) { console.warn('loadSucursalesFromAPI', e); }
}

function _ocToggleCC(prefix) {
  var sel = document.getElementById(prefix + '-forma-pago');
  var fld = document.getElementById(prefix + '-cc-dias-field');
  if (sel == null || fld == null) return;
  fld.style.display = (sel.value === 'cuenta_corriente') ? '' : 'none';
}

function _ocExtrasHTML(prefix, values) {
  values = values || {};
  var fp  = values.forma_pago || '';
  var ccd = (values.cc_dias == null) ? '' : values.cc_dias;
  var mon = values.moneda || 'ARS';
  var ccDisplay = (fp === 'cuenta_corriente') ? '' : 'display:none';
  var html = ''
    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">'
    +   '<div class="form-group">'
    +     '<label class="form-label">Forma de pago</label>'
    +     '<select class="form-select" id="' + prefix + '-forma-pago" onchange="_ocToggleCC(\'' + prefix + '\')">'
    +       '<option value="">-- Seleccionar --</option>'
    +       '<option value="contado">Contado</option>'
    +       '<option value="cuenta_corriente">Cuenta corriente</option>'
    +     '</select>'
    +   '</div>'
    +   '<div class="form-group" id="' + prefix + '-cc-dias-field" style="' + ccDisplay + '">'
    +     '<label class="form-label">Dias CC</label>'
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
  if (out.forma_pago === 'cuenta_corriente') {
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

// COMPRAS toma la OC para empezar a cotizar
async function tomarCotizacionOC(id) {
  if (!confirm('¿Tomar esta OC para cotizar? Quedará marcada como "en cotización".')) return;
  try {
    const r = await apiFetch('/api/purchase-orders/' + id + '/tomar-cotizacion', { method: 'POST' });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error al tomar la OC'); return; }
    showToast('ok', '🔎 OC tomada para cotizar');
    closeModal();
    await loadPOList(_poCurrentFilter);
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

  // Forma de pago y moneda vienen del helper
  let pod_fp = null, pod_cc = null, pod_mon = 'ARS';
  try {
    const extra = (typeof getPODetailExtraFields === 'function') ? getPODetailExtraFields() : {};
    if (extra.forma_pago) pod_fp = extra.forma_pago;
    if (extra.cc_dias != null) pod_cc = extra.cc_dias;
    if (extra.moneda) pod_mon = extra.moneda;
  } catch(e) {}

  if (!pod_prov) {
    if (!confirm('⚠️ No cargaste proveedor. ¿Aprobar sin proveedor?')) return;
  } else {
    if (!confirm('¿Aprobar esta OC con los precios y proveedor cargados? Pasará a tesorería para pagar.')) return;
  }

  try {
    const r = await apiFetch('/api/purchase-orders/' + id + '/aprobar-compras', {
      method: 'POST',
      body: JSON.stringify({
        proveedor: pod_prov,
        forma_pago: pod_fp,
        cc_dias: pod_cc,
        moneda: pod_mon,
        iva_pct: (pod_iva != null && !isNaN(pod_iva)) ? pod_iva : null
      })
    });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error al aprobar'); return; }
    showToast('ok', '✅ OC aprobada — pasa a tesorería');
    closeModal();
    await loadPOList(_poCurrentFilter);
  } catch(err) { showToast('error', err.message || 'Error'); }
}

// Rechazo (cualquier rol, según estado)
async function rechazarOC(id) {
  var motivo = prompt('Motivo del rechazo (mínimo 5 caracteres):');
  if (motivo == null) return;
  motivo = motivo.trim();
  if (motivo.length < 5) { showToast('warn', 'El motivo debe tener al menos 5 caracteres'); return; }
  try {
    const r = await apiFetch('/api/purchase-orders/' + id + '/rechazar', {
      method: 'POST',
      body: JSON.stringify({ motivo: motivo })
    });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error al rechazar'); return; }
    showToast('ok', '❌ OC rechazada');
    closeModal();
    await loadPOList(_poCurrentFilter);
  } catch(err) { showToast('error', err.message || 'Error'); }
}

// Devolver la OC a la etapa anterior (en vez de rechazarla definitivamente)
async function devolverOC(id, estadoActual) {
  // Mensaje dinámico según de dónde devuelve
  const mapMsg = {
    'en_cotizacion':    'Devolver al solicitante para que corrija. ',
    'aprobada_compras': 'Devolver a compras para que corrija la cotización. ',
    'pagada':           'Devolver a tesorería para revisar el pago. '
  };
  const msg = (mapMsg[estadoActual] || 'Devolver a la etapa anterior. ') + 'Motivo (mín. 5 caracteres):';
  var motivo = prompt(msg);
  if (motivo == null) return;
  motivo = motivo.trim();
  if (motivo.length < 5) { showToast('warn', 'El motivo debe tener al menos 5 caracteres'); return; }
  try {
    const r = await apiFetch('/api/purchase-orders/' + id + '/devolver', {
      method: 'POST',
      body: JSON.stringify({ motivo: motivo })
    });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error al devolver'); return; }
    showToast('ok', '⏪ OC devuelta a la etapa anterior');
    closeModal();
    await loadPOList(_poCurrentFilter);
  } catch(err) { showToast('error', err.message || 'Error'); }
}

// TESORERÍA registra el pago
async function pagarOC(id) {
  // Leer los elementos (no el value todavía)
  const fnEl = document.getElementById('pod-factura-nro');
  const ffEl = document.getElementById('pod-factura-fecha');
  const fmEl = document.getElementById('pod-factura-monto');
  const ivEl = document.getElementById('pod-iva-pct');
  const prEl = document.getElementById('pod-proveedor');

  // Verificar que los inputs existen y están editables
  if (!fnEl || fnEl.readOnly) { showToast('error', 'Input Nº factura no editable. Refrescá la página.'); return; }
  if (!fmEl || fmEl.readOnly) { showToast('error', 'Input Monto factura no editable. Refrescá la página.'); return; }

  // Leer los valores ahora sí
  const pod_fact_nro   = (fnEl.value || '').trim() || null;
  const pod_fact_fch   = ffEl ? (ffEl.value || null) : null;
  const pod_fact_mnt   = fmEl ? (fmEl.value || null) : null;
  const pod_iva_pct    = ivEl ? ivEl.value : null;
  const pod_prov       = prEl ? ((prEl.value || '').trim() || null) : null;

  // Log para debug — mirá en F12 → Console cuando clickees "Registrar pago"
  console.log('[pagarOC] Datos leídos:', {
    factura_nro: pod_fact_nro,
    factura_fecha: pod_fact_fch,
    factura_monto: pod_fact_mnt,
    iva_pct: pod_iva_pct,
    proveedor: pod_prov
  });

  // Validar datos mínimos — sin factura no se paga
  if (!pod_fact_nro && !pod_fact_mnt) {
    if (!confirm('⚠️ No cargaste número ni monto de factura. ¿Querés pagar igual sin esos datos?')) return;
  } else if (!pod_fact_nro) {
    if (!confirm('⚠️ No cargaste número de factura. ¿Seguir?')) return;
  } else if (!pod_fact_mnt) {
    if (!confirm('⚠️ No cargaste monto de factura. ¿Seguir?')) return;
  } else {
    if (!confirm('¿Registrar el pago de esta OC? Esta acción es definitiva y la OC pasará a estado "Pagada".')) return;
  }

  try {
    // 1) Primero PATCH para guardar campos actualizados (IVA, proveedor si cambió)
    if (pod_iva_pct !== undefined && pod_iva_pct !== null && pod_iva_pct !== '') {
      try {
        const patchBody = {
          iva_pct: parseFloat(pod_iva_pct) || 0
        };
        if (pod_prov !== null) patchBody.proveedor = pod_prov;
        console.log('[pagarOC] PATCH body:', patchBody);
        const pr = await apiFetch('/api/purchase-orders/' + id, {
          method: 'PATCH',
          body: JSON.stringify(patchBody)
        });
        const pj = await pr.json();
        console.log('[pagarOC] PATCH response:', pj);
      } catch(e) {
        console.warn('[pagarOC] PATCH error:', e.message);
      }
    }

    // 2) Disparar el endpoint de pagar con los datos de factura
    const payBody = {
      factura_nro:   pod_fact_nro,
      factura_fecha: pod_fact_fch,
      factura_monto: pod_fact_mnt ? parseFloat(pod_fact_mnt) : null
    };
    console.log('[pagarOC] POST /pagar body:', payBody);

    const r = await apiFetch('/api/purchase-orders/' + id + '/pagar', {
      method: 'POST',
      body: JSON.stringify(payBody)
    });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error al registrar el pago'); return; }
    const resultado = await r.json();
    console.log('[pagarOC] Resultado DB después del pago:', {
      factura_nro: resultado.factura_nro,
      factura_fecha: resultado.factura_fecha,
      factura_monto: resultado.factura_monto,
      iva_pct: resultado.iva_pct
    });

    showToast('ok', '💰 Pago registrado — esperando recepción');
    closeModal();
    await loadPOList(_poCurrentFilter);
  } catch(err) { showToast('error', err.message || 'Error'); }
}

// JEFE MANT confirma la recepción
async function recibirOC(id) {
  if (!confirm('¿Confirmás que recibiste la mercadería? Esta acción cierra la OC.')) return;
  try {
    const r = await apiFetch('/api/purchase-orders/' + id + '/recibir', { method: 'POST' });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error al recibir'); return; }
    showToast('ok', '📦 OC recibida — proceso completado');
    closeModal();
    await loadPOList(_poCurrentFilter);
  } catch(err) { showToast('error', err.message || 'Error'); }
}

// Alias de compatibilidad — "cancelar" en el nuevo workflow es "rechazar"
async function cancelarOC(id, statusActual) {
  return rechazarOC(id);
}

/* FIN OC WORKFLOW ACTIONS v2 */
// ════════════════════════════════════════════════════════════
//  BACKUP DE DB — Solo accesible por rol 'dueno'
// ════════════════════════════════════════════════════════════

async function downloadBackupDB() {
  if (!userHasRole('dueno')) {
    showToast('error', 'Solo el dueño puede descargar el backup');
    return;
  }

  openModal('🔒 Backup de base de datos', `
    <div style="background:var(--bg3);border-radius:var(--radius-lg);padding:18px;margin-bottom:14px">
      <div style="font-size:13px;color:var(--text2);line-height:1.6">
        Vas a descargar un <strong>backup completo</strong> de toda la base de datos de FleetOS (Expreso Biletta) en formato comprimido (<code>.sql.gz</code>).
      </div>
      <div style="margin-top:14px;padding:12px;background:var(--bg2);border-radius:var(--radius);border-left:3px solid var(--accent)">
        <div style="font-size:12px;color:var(--text3);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">📦 Qué incluye</div>
        <div style="font-size:12px;color:var(--text2);line-height:1.7">
          ✓ Todos los vehículos y ficha técnica<br>
          ✓ Órdenes de trabajo con repuestos y costos<br>
          ✓ Cargas de combustible y cisternas<br>
          ✓ Cubiertas con historial<br>
          ✓ Stock y movimientos<br>
          ✓ Órdenes de compra<br>
          ✓ Usuarios, documentos y configuración
        </div>
      </div>
      <div style="margin-top:12px;padding:10px 14px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:var(--radius);font-size:12px;color:var(--warn)">
        💡 <strong>Recomendación:</strong> guardá el archivo en 3 lugares (compu + Google Drive + email).
      </div>
    </div>
  `, [
    { label: '📥 Descargar ahora', cls: 'btn-primary', fn: _executeBackupDownload },
    { label: 'Cancelar', cls: 'btn-secondary', fn: closeModal }
  ]);
}

async function _executeBackupDownload() {
  const btns = document.querySelectorAll('#modal-footer button');
  btns.forEach(b => { b.disabled = true; });
  const primaryBtn = btns[0];
  if (primaryBtn) primaryBtn.textContent = '⏳ Generando backup...';

  try {
    const token = window._getToken ? window._getToken() : null;
    if (!token) {
      showToast('error', 'Sesión expirada. Volvé a loguearte.');
      return;
    }

    const res = await fetch('/api/admin/backup', {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => 'Error');
      showToast('error', 'Error ' + res.status + ': ' + txt);
      if (primaryBtn) { primaryBtn.textContent = '📥 Descargar ahora'; primaryBtn.disabled = false; }
      btns.forEach(b => { b.disabled = false; });
      return;
    }

    const blob = await res.blob();
    const sizeKB = (blob.size / 1024).toFixed(1);

    const fecha = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    const filename = `biletta-backup-${fecha}.sql.gz`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    closeModal();
    showToast('ok', `✅ Backup descargado: ${filename} (${sizeKB} KB)`);

  } catch (err) {
    console.error('[BACKUP]', err);
    showToast('error', 'Error al descargar: ' + (err.message || 'desconocido'));
    if (primaryBtn) { primaryBtn.textContent = '📥 Descargar ahora'; primaryBtn.disabled = false; }
    btns.forEach(b => { b.disabled = false; });
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

  const canCreate = ['dueno','gerencia','jefe_mantenimiento','paniol'].includes(App.currentUser?.role);

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div>
        <h2 style="font-size:20px;font-weight:700;margin:0;color:var(--text)">🏢 Proveedores</h2>
        <p style="font-size:13px;color:var(--text3);margin:4px 0 0">Catálogo de proveedores con datos fiscales y condiciones comerciales</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" onclick="_supExportPDF()">📄 PDF</button>
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

  const formaPagoLabel = { contado: 'Contado', cuenta_corriente: `CC ${s.cc_dias||'—'}d`, cheque: 'Cheque', transferencia: 'Transf.' }[s.forma_pago] || '—';

  return `<tr style="border-left:3px solid ${sideColor};border-bottom:1px solid var(--border);transition:background .1s"
    onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='transparent'">

    <td style="padding:10px 12px">
      <div style="font-weight:600;color:var(--text)">${s.name}</div>
      ${s.razon_social ? `<div style="font-size:10px;color:var(--text3)">${s.razon_social}</div>` : ''}
    </td>

    <td style="padding:10px 12px;font-family:var(--mono);font-size:12px;color:var(--text2)">${s.cuit || '—'}</td>

    <td style="padding:10px 12px">${rubros || '<span style="color:var(--text3);font-size:10px">—</span>'}${extraRubros}</td>

    <td style="padding:10px 12px;font-size:12px">
      <div>${s.contact_person || '—'}</div>
      ${s.email ? `<div style="font-size:10px;color:var(--text3)">${s.email}</div>` : ''}
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
      ${['dueno','gerencia','jefe_mantenimiento','paniol'].includes(App.currentUser?.role) ?
        `<button class="btn btn-secondary btn-sm" onclick="openEditSupplierModal('${s.id}')" style="margin-left:4px">Editar</button>` : ''}
    </td>
  </tr>`;
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

  const body = `
    <div style="max-height:70vh;overflow-y:auto;padding-right:8px">

      <div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:10px;letter-spacing:.5px">🏢 DATOS GENERALES</div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:16px">
        <div>
          <label class="form-label">Nombre comercial *</label>
          <input id="sup-name" class="form-input" value="${s.name||''}" placeholder="Ej: Distribuidora ABC">
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
        <input id="sup-razon" class="form-input" value="${s.razon_social||''}" placeholder="Ej: Distribuidora ABC S.R.L.">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
        <div>
          <label class="form-label">CUIT</label>
          <input id="sup-cuit" class="form-input" value="${s.cuit||''}" placeholder="30-12345678-9">
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
          <input id="sup-email" class="form-input" type="email" value="${s.email||''}" placeholder="contacto@proveedor.com">
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
        <textarea id="sup-notes" class="form-input" rows="2" placeholder="Notas internas...">${s.notes||''}</textarea>
      </div>

      <div id="sup-blacklist-row" style="display:${s.status==='blacklist'?'block':'none'};margin-bottom:10px">
        <label class="form-label" style="color:var(--danger)">Razón de blacklist</label>
        <textarea id="sup-blreason" class="form-input" rows="2">${s.blacklist_reason||''}</textarea>
      </div>
    </div>
  `;

  openModal(
    isEdit ? `Editar proveedor — ${s.name}` : 'Nuevo proveedor',
    body,
    [
      ...(isEdit ? [{ label: '🗑 Eliminar', cls: 'btn-danger', fn: () => _supDelete(s.id) }] : []),
      { label: 'Cancelar', cls: 'btn-secondary', fn: closeModal },
      { label: isEdit ? 'Guardar cambios' : 'Crear proveedor', cls: 'btn-primary', fn: () => _supSave(isEdit ? s.id : null) },
    ]
  );

  // Toggle del campo razón de blacklist según status elegido
  setTimeout(() => {
    const statusSel = document.getElementById('sup-status');
    const blRow     = document.getElementById('sup-blacklist-row');
    if (statusSel && blRow) {
      statusSel.addEventListener('change', () => {
        blRow.style.display = statusSel.value === 'blacklist' ? 'block' : 'none';
      });
    }
  }, 100);
}

async function _supSave(id) {
  const val = (x) => document.getElementById(x)?.value?.trim() || '';
  const numOrNull = (x) => {
    const v = document.getElementById(x)?.value;
    return (v === '' || v == null) ? null : parseFloat(v);
  };

  const payload = {
    name:          val('sup-name'),
    razon_social:  val('sup-razon'),
    cuit:          val('sup-cuit'),
    iva_condition: val('sup-iva') || null,
    contact_person:val('sup-contact'),
    phone:         val('sup-phone'),
    email:         val('sup-email'),
    website:       val('sup-website'),
    address:       val('sup-address'),
    city:          val('sup-city'),
    province:      val('sup-province'),
    postal_code:   val('sup-cp'),
    rubros:        val('sup-rubros').split(',').map(r => r.trim().toLowerCase()).filter(Boolean),
    forma_pago:    val('sup-fpago') || null,
    cc_dias:       numOrNull('sup-ccdias'),
    moneda:        val('sup-moneda') || 'ARS',
    discount_pct:  numOrNull('sup-disc'),
    delivery_time_days: numOrNull('sup-deliv'),
    rating:        (() => { const v = numOrNull('sup-rating'); if (v == null) return null; if (v > 5) return 5; if (v < 0) return 0; return v; })(),
    bank_name:     val('sup-bank'),
    bank_cbu:      val('sup-cbu'),
    bank_alias:    val('sup-alias'),
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
    showToast('ok', id ? `Proveedor actualizado: ${payload.name}` : `Proveedor creado: ${payload.name}`);
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

  const formaPagoLabel = { contado: 'Contado', cuenta_corriente: `CC a ${sup.cc_dias||'—'} días`, cheque: 'Cheque', transferencia: 'Transferencia' }[sup.forma_pago] || '—';
  const ivaLabel = { responsable_inscripto: 'Responsable Inscripto', monotributo: 'Monotributo', exento: 'Exento', consumidor_final: 'Consumidor final' }[sup.iva_condition] || '—';
  const statusBadge = { activo: '✅ Activo', suspendido: '⏸ Suspendido', blacklist: '🚫 Blacklist' }[sup.status] || sup.status;

  const body = `
    <div style="max-height:70vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--text)">${sup.name}</div>
          <div style="font-size:12px;color:var(--text3)">${sup.razon_social||'—'}</div>
        </div>
        <span style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;font-family:var(--mono);background:var(--bg3)">${statusBadge}</span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px;margin-bottom:16px">
        <div>
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700;margin-bottom:8px">🏢 Fiscal</div>
          <div style="padding:8px 0"><b>CUIT:</b> <span style="font-family:var(--mono)">${sup.cuit||'—'}</span></div>
          <div style="padding:4px 0"><b>IVA:</b> ${ivaLabel}</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700;margin-bottom:8px">📞 Contacto</div>
          <div style="padding:4px 0"><b>Persona:</b> ${sup.contact_person||'—'}</div>
          <div style="padding:4px 0"><b>Tel:</b> <span style="font-family:var(--mono)">${sup.phone||'—'}</span></div>
          <div style="padding:4px 0"><b>Email:</b> ${sup.email||'—'}</div>
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
        ${sup.notes}
      </div>` : ''}

      ${sup.blacklist_reason ? `
      <div style="padding:12px;background:rgba(220,38,38,.10);border-left:3px solid var(--danger);border-radius:var(--radius);font-size:13px">
        <div style="font-size:10px;color:var(--danger);text-transform:uppercase;font-weight:700;margin-bottom:4px">🚫 Razón blacklist</div>
        ${sup.blacklist_reason}
      </div>` : ''}
    </div>
  `;

  openModal(
    `Proveedor: ${sup.name}`,
    body,
    [
      { label: 'Cerrar', cls: 'btn-secondary', fn: closeModal },
      ...(['dueno','gerencia','jefe_mantenimiento','paniol'].includes(App.currentUser?.role) ?
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
  doc.setFontSize(16); doc.setFont('helvetica','bold');
  doc.text('Proveedores — Expreso Biletta', 40, 40);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(100);
  doc.text(`Generado: ${new Date().toLocaleString('es-AR')} · ${rows.length} proveedor${rows.length===1?'':'es'}`, 40, 58);
  const tableData = rows.map(s => [
    s.name || '—', s.cuit || '—',
    (s.rubros||[]).join(', ') || '—',
    s.contact_person || '—', s.phone || '—', s.email || '—',
    s.forma_pago || '—',
    s.status || '—',
  ]);
  doc.autoTable({
    startY: 72,
    head: [['Nombre','CUIT','Rubros','Contacto','Tel','Email','Pago','Estado']],
    body: tableData,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 249, 252] },
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
  const totalVal  = document.getElementById('eo-labor-total-val');
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
    const rate     = parseFloat(p.rate || 0);
    const subtotal = parseFloat(p.subtotal || 0);
    const fecha    = p.work_date ? new Date(p.work_date).toLocaleDateString('es-AR') : '—';
    return `<div style="display:grid;grid-template-columns:1fr 60px 90px 100px 32px;gap:6px;margin-bottom:6px;align-items:center;padding:6px 10px;background:var(--bg3);border-radius:var(--radius);font-size:12px">
      <div>
        <div style="font-weight:600">${p.worker_name}</div>
        <div style="color:var(--text3);font-size:10px">${fecha}${p.notes ? ' · ' + p.notes.substring(0,50) : ''}</div>
      </div>
      <div style="text-align:center;font-family:var(--mono)">${hours}h</div>
      <div style="text-align:right;font-family:var(--mono);color:var(--text3)">$${Math.round(rate).toLocaleString('es-AR')}/h</div>
      <div style="text-align:right;font-weight:700;color:var(--accent);font-family:var(--mono)">$${Math.round(subtotal).toLocaleString('es-AR')}</div>
      <button type="button" onclick="_labDelete('${p.id}')"
        title="Eliminar este parte"
        style="background:none;border:1px solid var(--border2);border-radius:6px;cursor:pointer;color:var(--danger);font-size:14px;padding:0 6px;height:28px">✕</button>
    </div>`;
  }).join('');

  const totalH = partes.reduce((a,p) => a + parseFloat(p.hours||0), 0);
  const totalM = partes.reduce((a,p) => a + parseFloat(p.subtotal||0), 0);
  if (totalDiv) totalDiv.style.display = 'block';
  if (totalVal) totalVal.textContent = '$' + Math.round(totalM).toLocaleString('es-AR');
  if (totalHrs) totalHrs.textContent = totalH.toFixed(1);
  if (eoLabor)  eoLabor.value = totalM.toFixed(2);
}

// Modal para agregar un parte nuevo
function _labAddRow() {
  if (!window._labCurrentOtId) return showToast('error', 'Abrí una OT primero');

  // Lista de mecánicos del sistema (users con rol mecanico, jefe_mantenimiento o el que sea)
  const mechanics = (App.data.users || []).filter(u =>
    ['mecanico','jefe_mantenimiento','dueno','gerencia'].includes(u.role)
  );
  const mechOpts = mechanics.map(u => `<option value="${u.id}" data-name="${u.name}">${u.name} (${u.role})</option>`).join('');

  // Rate default: traer labor_rate del config
  const defaultRate = parseFloat(App.config?.labor_rate || 0);

  const body = `
    <div style="margin-bottom:14px;padding:10px;background:var(--bg3);border-radius:var(--radius);font-size:12px;color:var(--text3)">
      💡 <b>Parte de trabajo:</b> registrá quién trabajó, cuántas horas y a qué tarifa.
      El costo se calcula solo y se suma al total MO de la OT.
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
        <label class="form-label">Tarifa por hora ($)</label>
        <input class="form-input" type="number" id="lab-rate" min="0" value="${defaultRate}" oninput="_labRecalc()">
        <div style="font-size:10px;color:var(--text3);margin-top:3px">Default: ${defaultRate > 0 ? '$' + defaultRate.toLocaleString('es-AR') + ' (configuración)' : 'Configurala en Config.'}</div>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Fecha del trabajo</label>
        <input class="form-input" type="date" id="lab-date" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label">Total calculado</label>
        <input class="form-input" id="lab-subtotal" readonly style="background:var(--bg3);font-weight:700;color:var(--accent);font-size:14px" value="$0">
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
  const rate  = parseFloat(document.getElementById('lab-rate')?.value)  || 0;
  const subtotalEl = document.getElementById('lab-subtotal');
  if (subtotalEl) subtotalEl.value = '$' + Math.round(hours * rate).toLocaleString('es-AR');
}

// Guardar el parte
async function _labSave() {
  const otId  = window._labCurrentOtId;
  if (!otId) { showToast('error', 'No hay OT seleccionada'); return; }

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
  const rate  = parseFloat(document.getElementById('lab-rate')?.value) || 0;
  const work_date = document.getElementById('lab-date')?.value || null;
  const notes = (document.getElementById('lab-notes')?.value || '').trim() || null;

  if (!hours || hours <= 0) { showToast('error', 'Ingresá las horas trabajadas'); return; }

  try {
    const r = await apiFetch(`/api/workorders/${otId}/labor`, {
      method: 'POST',
      body: JSON.stringify({ user_id, worker_name, hours, rate, work_date, notes })
    });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error'); return; }
    showToast('ok', `Parte agregado: ${worker_name} · ${hours}h · $${Math.round(hours*rate).toLocaleString('es-AR')}`);
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
    const r = await apiFetch(`/api/workorders/${otId}/parts`);
    if (!r.ok) {
      container.innerHTML = `<div style="padding:10px;color:var(--danger);font-size:12px">Error al cargar repuestos</div>`;
      return;
    }
    const parts = await r.json();
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
    const origenLabel = p.origin === 'stock' ? '📦 Pañol' : '🛒 Externo';
    const origenColor = p.origin === 'stock' ? 'var(--ok)' : 'var(--text3)';
    const stockCode = p.stock_code ? ` · <span style="font-family:var(--mono);font-size:10px">${p.stock_code}</span>` : '';
    return `<div style="display:grid;grid-template-columns:70px 1fr 70px 90px 100px 32px;gap:6px;margin-bottom:6px;align-items:center;padding:6px 10px;background:var(--bg3);border-radius:var(--radius);font-size:12px">
      <div style="color:${origenColor};font-weight:600;font-size:11px">${origenLabel}</div>
      <div>
        <div style="font-weight:600">${p.name}</div>
        <div style="color:var(--text3);font-size:10px">${(p.unit||'un')}${stockCode}</div>
      </div>
      <div style="text-align:center;font-family:var(--mono)">${qty}</div>
      <div style="text-align:right;font-family:var(--mono);color:var(--text3)">$${Math.round(cost).toLocaleString('es-AR')}</div>
      <div style="text-align:right;font-weight:700;color:var(--accent);font-family:var(--mono)">$${Math.round(subtotal).toLocaleString('es-AR')}</div>
      <button type="button" onclick="_partsDelete('${p.id}', ${p.origin === 'stock' ? 'true' : 'false'})"
        title="${p.origin === 'stock' ? 'Eliminar y devolver al stock' : 'Eliminar repuesto'}"
        style="background:none;border:1px solid var(--border2);border-radius:6px;cursor:pointer;color:var(--danger);font-size:14px;padding:0 6px;height:28px">✕</button>
    </div>`;
  }).join('');

  const totalM = parts.reduce((a,p) => a + parseFloat(p.subtotal || (p.qty * p.unit_cost) || 0), 0);
  if (totalDiv) totalDiv.style.display = 'block';
  if (totalVal) totalVal.textContent = '$' + Math.round(totalM).toLocaleString('es-AR');
  if (eoParts)  eoParts.value = totalM.toFixed(2);
}

function _partsAddRow() {
  if (!window._labCurrentOtId) return showToast('error', 'Abrí una OT primero');

  const body = `
    <div style="margin-bottom:14px;padding:10px;background:var(--bg3);border-radius:var(--radius);font-size:12px;color:var(--text3)">
      💡 Elegí el origen del repuesto: 📦 Pañol (descuenta stock) o 🛒 Externo (compra afuera).
    </div>

    <div class="form-group">
      <label class="form-label">Origen *</label>
      <select class="form-select" id="pnew-origin" onchange="_partsOriginChanged()">
        <option value="externo">🛒 Externo (compra afuera)</option>
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
      <div class="form-group">
        <label class="form-label">Precio unitario ($)</label>
        <input class="form-input" type="number" id="pnew-cost" min="0" value="0"
          oninput="_partsRecalc()" style="font-size:14px">
      </div>
      <div class="form-group">
        <label class="form-label">Total calculado</label>
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
  window._pnewStockAvailable = 0;
}

function _partsOriginChanged() {
  const origin = document.getElementById('pnew-origin')?.value;
  const nameEl = document.getElementById('pnew-name');
  const costEl = document.getElementById('pnew-cost');
  const sugEl = document.getElementById('pnew-suggestions');
  const infoEl = document.getElementById('pnew-stock-info');

  if (origin === 'externo') {
    if (nameEl) { nameEl.placeholder = 'Descripción del repuesto (compra externa)'; nameEl.value = ''; nameEl.style.borderLeft = ''; }
    if (costEl) { costEl.readOnly = false; costEl.style.background = ''; costEl.value = 0; }
    if (sugEl)  sugEl.style.display = 'none';
    if (infoEl) infoEl.style.display = 'none';
    window._pnewStockId = null;
    window._pnewStockAvailable = 0;
  } else {
    if (nameEl) { nameEl.placeholder = 'Escribí para buscar en el pañol...'; nameEl.value = ''; nameEl.style.borderLeft = ''; }
    if (costEl) { costEl.value = 0; costEl.readOnly = false; costEl.style.background = ''; }
    if (infoEl) { infoEl.style.display = 'block'; infoEl.innerHTML = '<span style="color:var(--accent)">📦 Elegí un ítem del pañol</span>'; }
    window._pnewStockId = null;
  }
  _partsRecalc();
}

function _partsNameInput(val) {
  const origin = document.getElementById('pnew-origin')?.value;
  const sugEl = document.getElementById('pnew-suggestions');
  if (!sugEl) return;

  if (origin !== 'stock') { sugEl.style.display = 'none'; return; }

  // Si el usuario edita después de haber seleccionado, desvincular
  if (window._pnewStockId) {
    window._pnewStockId = null;
    window._pnewStockAvailable = 0;
    const nameEl = document.getElementById('pnew-name');
    if (nameEl) nameEl.style.borderLeft = '';
  }

  if (!val || val.length < 2) { sugEl.style.display = 'none'; return; }
  const q = val.toLowerCase();
  const stock = (App.data.stock || []).filter(s =>
    (s.name||'').toLowerCase().includes(q) || (s.code||'').toLowerCase().includes(q)
  ).slice(0, 8);

  if (!stock.length) {
    sugEl.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:12px;text-align:center">Sin resultados en el pañol. Cambiá a "Externo" si es compra de afuera.</div>';
    sugEl.style.display = 'block';
    return;
  }

  sugEl.innerHTML = stock.map(s => {
    const qty = parseFloat(s.qty_current || 0);
    const color = qty <= parseFloat(s.qty_min || 0) ? 'var(--danger)' : (qty > 0 ? 'var(--ok)' : 'var(--text3)');
    const safeName = String(s.name||'').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    return `<div onclick="_partsSelectStock('${s.id}','${safeName}','${s.unit||'un'}',${parseFloat(s.unit_cost||0)},${qty})"
      style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <div>
        <div style="font-weight:600">${s.name}</div>
        <div style="color:var(--text3);font-family:monospace;font-size:11px">${s.code||'—'}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;color:var(--accent)">$${Math.round(s.unit_cost||0).toLocaleString('es-AR')}/${s.unit||'un'}</div>
        <div style="font-size:10px;color:${color};font-weight:700">Stock: ${qty} ${s.unit||'un'}</div>
      </div>
    </div>`;
  }).join('');
  sugEl.style.display = 'block';
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

  if (origin === 'stock' && window._pnewStockId) {
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
  const qty = parseFloat(document.getElementById('pnew-qty')?.value) || 0;
  const cost = parseFloat(document.getElementById('pnew-cost')?.value) || 0;
  const subtotalEl = document.getElementById('pnew-subtotal');
  if (subtotalEl) subtotalEl.value = '$' + Math.round(qty * cost).toLocaleString('es-AR');
}

async function _partsSave() {
  const otId = window._labCurrentOtId;
  if (!otId) { showToast('error', 'No hay OT seleccionada'); return; }

  const origin = document.getElementById('pnew-origin')?.value || 'externo';
  const name = (document.getElementById('pnew-name')?.value || '').trim();
  const qty = parseFloat(document.getElementById('pnew-qty')?.value);
  const unit = document.getElementById('pnew-unit')?.value || 'un';
  const unit_cost = parseFloat(document.getElementById('pnew-cost')?.value) || 0;

  if (!name || name.length < 2) { showToast('error', 'Ingresá el nombre del repuesto'); return; }
  if (!qty || qty <= 0) { showToast('error', 'Cantidad inválida'); return; }
  if (origin === 'stock' && !window._pnewStockId) { showToast('error', 'Seleccioná un ítem del pañol o cambiá a Externo'); return; }
  if (origin === 'stock' && qty > window._pnewStockAvailable) { showToast('error', `Cantidad mayor al stock disponible (${window._pnewStockAvailable})`); return; }

  const payload = { name, origin, qty, unit, unit_cost };
  if (origin === 'stock') payload.stock_id = window._pnewStockId;

  try {
    const r = await apiFetch(`/api/workorders/${otId}/parts`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (!r.ok) { const e = await r.json(); showToast('error', e.error || 'Error'); return; }
    showToast('ok', `Repuesto agregado: ${name} · $${Math.round(qty*unit_cost).toLocaleString('es-AR')}`);
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
//  ACTIVOS PATRIMONIALES (edificios, herramientas, equipos, etc.)
// ═══════════════════════════════════════════════════════════

function renderAssets() {
  const assets = App.data.assets || [];
  const typeLabels = {
    edilicio: '🏢 Edificio',
    herramienta: '🔧 Herramienta',
    equipo: '⚙️ Equipo',
    informatica: '💻 Informática',
    instalacion: '🏗️ Instalación',
    otro: '📦 Otro',
  };
  const statusLabels = {
    operativo: 'Operativo',
    en_reparacion: 'En reparación',
    fuera_servicio: 'Fuera de servicio',
    baja: 'De baja',
  };
  const statusColors = {
    operativo: 'var(--ok)',
    en_reparacion: 'var(--warn)',
    fuera_servicio: 'var(--danger)',
    baja: 'var(--text3)',
  };

  // KPIs por tipo
  const byType = {};
  assets.forEach(a => { byType[a.type] = (byType[a.type] || 0) + 1; });

  const canEdit = userHasRole('dueno', 'gerencia', 'jefe_mantenimiento');
  const canDelete = userHasRole('dueno', 'gerencia');

  const pageEl = document.getElementById('page-assets');
  if (!pageEl) return;

  pageEl.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Activos patrimoniales</div>
        <div class="section-sub">Edificios, herramientas, equipos — todo lo que NO es vehículo de la flota pero se mantiene</div>
      </div>
      <div style="display:flex;gap:8px">
        ${canEdit ? `<button class="btn btn-primary" onclick="openNewAssetModal()">+ Registrar activo</button>` : ''}
      </div>
    </div>

    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card info">
        <div class="kpi-label">Total activos</div>
        <div class="kpi-value info">${assets.length}</div>
        <div class="kpi-trend">registrados en el sistema</div>
      </div>
      <div class="kpi-card ok">
        <div class="kpi-label">Operativos</div>
        <div class="kpi-value ok">${assets.filter(a => a.status === 'operativo').length}</div>
        <div class="kpi-trend">funcionando</div>
      </div>
      <div class="kpi-card warn">
        <div class="kpi-label">En reparación</div>
        <div class="kpi-value warn">${assets.filter(a => a.status === 'en_reparacion').length}</div>
        <div class="kpi-trend">con OT abierta</div>
      </div>
      <div class="kpi-card danger">
        <div class="kpi-label">Fuera de servicio</div>
        <div class="kpi-value danger">${assets.filter(a => a.status === 'fuera_servicio').length}</div>
        <div class="kpi-trend">requieren atención</div>
      </div>
    </div>

    <!-- Filtros -->
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <button class="btn btn-secondary btn-sm" onclick="_filterAssets('all')" id="af-all" style="background:var(--accent);color:white">Todos (${assets.length})</button>
      ${Object.entries(typeLabels).map(([type, label]) => {
        const count = byType[type] || 0;
        if (count === 0) return '';
        return `<button class="btn btn-secondary btn-sm" onclick="_filterAssets('${type}')" id="af-${type}">${label} (${count})</button>`;
      }).join('')}
    </div>

    <div class="card">
      ${assets.length === 0 ? `
        <div style="text-align:center;padding:40px 20px;color:var(--text3)">
          <div style="font-size:48px;margin-bottom:12px">📦</div>
          <div style="font-size:15px;font-weight:600;margin-bottom:6px">Todavía no hay activos cargados</div>
          <div style="font-size:12px;margin-bottom:20px">Los activos incluyen herramientas, equipos, edificios, informática e instalaciones del taller y la empresa</div>
          ${canEdit ? `<button class="btn btn-primary" onclick="openNewAssetModal()">+ Registrar el primer activo</button>` : ''}
        </div>
      ` : `
        <table class="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Ubicación</th>
              <th>Estado</th>
              <th>Marca / Modelo</th>
              <th style="text-align:right">Precio compra</th>
              <th style="width:120px">Acciones</th>
            </tr>
          </thead>
          <tbody id="assets-tbody">
            ${_renderAssetsRows(assets, typeLabels, statusLabels, statusColors, canEdit, canDelete)}
          </tbody>
        </table>
      `}
    </div>
  `;
}

function _renderAssetsRows(assets, typeLabels, statusLabels, statusColors, canEdit, canDelete) {
  if (assets.length === 0) {
    return `<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:30px">No hay activos de este tipo</td></tr>`;
  }
  return assets.map(a => `
    <tr>
      <td class="td-mono"><a onclick="openAssetDetailModal('${a.id}')" style="color:var(--accent);cursor:pointer;text-decoration:underline;font-weight:600">${a.code}</a></td>
      <td><b>${a.name}</b></td>
      <td>${typeLabels[a.type] || a.type}</td>
      <td>${a.location || '<span style="color:var(--text3)">—</span>'}</td>
      <td><span style="color:${statusColors[a.status]};font-weight:600">● ${statusLabels[a.status] || a.status}</span></td>
      <td>${a.brand || a.model ? `${a.brand || ''} ${a.model || ''}`.trim() : '<span style="color:var(--text3)">—</span>'}</td>
      <td style="text-align:right;font-family:var(--mono)">${a.purchase_price ? '$' + Math.round(parseFloat(a.purchase_price)).toLocaleString('es-AR') : '<span style="color:var(--text3)">—</span>'}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-secondary btn-sm" onclick="openAssetDetailModal('${a.id}')" title="Ver detalle">👁️</button>
          ${canEdit ? `<button class="btn btn-secondary btn-sm" onclick="openEditAssetModal('${a.id}')" title="Editar">✏️</button>` : ''}
          ${canDelete ? `<button class="btn btn-secondary btn-sm" onclick="deleteAsset('${a.id}')" title="Eliminar" style="color:var(--danger)">🗑️</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function _filterAssets(type) {
  // Toggle visual de botones
  document.querySelectorAll('[id^="af-"]').forEach(btn => {
    btn.style.background = '';
    btn.style.color = '';
  });
  const activeBtn = document.getElementById('af-' + type);
  if (activeBtn) {
    activeBtn.style.background = 'var(--accent)';
    activeBtn.style.color = 'white';
  }

  const allAssets = App.data.assets || [];
  const filtered = type === 'all' ? allAssets : allAssets.filter(a => a.type === type);

  const typeLabels = { edilicio:'🏢 Edificio', herramienta:'🔧 Herramienta', equipo:'⚙️ Equipo', informatica:'💻 Informática', instalacion:'🏗️ Instalación', otro:'📦 Otro' };
  const statusLabels = { operativo:'Operativo', en_reparacion:'En reparación', fuera_servicio:'Fuera de servicio', baja:'De baja' };
  const statusColors = { operativo:'var(--ok)', en_reparacion:'var(--warn)', fuera_servicio:'var(--danger)', baja:'var(--text3)' };
  const canEdit = userHasRole('dueno', 'gerencia', 'jefe_mantenimiento');
  const canDelete = userHasRole('dueno', 'gerencia');

  const tbody = document.getElementById('assets-tbody');
  if (tbody) tbody.innerHTML = _renderAssetsRows(filtered, typeLabels, statusLabels, statusColors, canEdit, canDelete);
}

function openNewAssetModal(preset) {
  const today = new Date().toISOString().slice(0, 10);
  openModal('+ Registrar activo patrimonial', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Código *</label>
        <input class="form-input" id="na-code" placeholder="Ej: HER-001, EQU-COMP-5" autofocus>
        <div style="font-size:10px;color:var(--text3);margin-top:3px">Código único identificador</div>
      </div>
      <div class="form-group">
        <label class="form-label">Tipo *</label>
        <select class="form-select" id="na-type">
          <option value="herramienta">🔧 Herramienta</option>
          <option value="equipo">⚙️ Equipo</option>
          <option value="edilicio">🏢 Edificio / Oficina</option>
          <option value="informatica">💻 Equipo informático</option>
          <option value="instalacion">🏗️ Instalación</option>
          <option value="otro">📦 Otro</option>
        </select>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Nombre / Descripción *</label>
      <input class="form-input" id="na-name" placeholder="Ej: Compresor de aire 50L, Elevador de columna, Oficina administración">
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Ubicación</label>
        <input class="form-input" id="na-location" placeholder="Ej: Taller central, Oficina, Pañol">
      </div>
      <div class="form-group">
        <label class="form-label">Categoría</label>
        <input class="form-input" id="na-category" placeholder="Ej: Neumática, Elevación, Administración">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Marca</label>
        <input class="form-input" id="na-brand" placeholder="Ej: Michelin, Bosch, Dell">
      </div>
      <div class="form-group">
        <label class="form-label">Modelo</label>
        <input class="form-input" id="na-model" placeholder="Ej: TL-2000">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">N° de serie</label>
        <input class="form-input" id="na-serial" placeholder="Opcional">
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de compra</label>
        <input class="form-input" type="date" id="na-purchase-date">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Precio de compra ($)</label>
        <input class="form-input" type="number" id="na-price" min="0" value="0">
      </div>
      <div class="form-group">
        <label class="form-label">Garantía hasta</label>
        <input class="form-input" type="date" id="na-warranty">
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Notas</label>
      <textarea class="form-textarea" id="na-notes" placeholder="Cualquier observación relevante..."></textarea>
    </div>
  `, [
    { label: 'Cancelar', cls: 'btn-secondary', fn: closeModal },
    { label: 'Registrar activo', cls: 'btn-primary', fn: saveNewAsset },
  ]);
}

async function saveNewAsset() {
  const code = document.getElementById('na-code')?.value.trim();
  const name = document.getElementById('na-name')?.value.trim();
  const type = document.getElementById('na-type')?.value || 'otro';

  if (!code) { showToast('warn', 'El código es obligatorio'); return; }
  if (!name) { showToast('warn', 'El nombre es obligatorio'); return; }

  const payload = {
    code, name, type,
    category: document.getElementById('na-category')?.value.trim() || null,
    location: document.getElementById('na-location')?.value.trim() || null,
    brand: document.getElementById('na-brand')?.value.trim() || null,
    model: document.getElementById('na-model')?.value.trim() || null,
    serial_no: document.getElementById('na-serial')?.value.trim() || null,
    purchase_date: document.getElementById('na-purchase-date')?.value || null,
    purchase_price: parseFloat(document.getElementById('na-price')?.value) || null,
    warranty_until: document.getElementById('na-warranty')?.value || null,
    notes: document.getElementById('na-notes')?.value.trim() || null,
  };

  try {
    const res = await apiFetch('/api/assets', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) { const e = await res.json(); showToast('error', e.error || 'Error al crear activo'); return; }
    closeModal();
    showToast('ok', `Activo ${code} registrado correctamente`);
    // El auto-refresh ya va a re-cargar la data
  } catch(err) {
    showToast('error', err.message);
  }
}

function openEditAssetModal(id) {
  const a = (App.data.assets || []).find(x => x.id === id);
  if (!a) { showToast('error', 'Activo no encontrado'); return; }

  openModal(`Editar activo — ${a.code}`, `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Código</label>
        <input class="form-input" id="ea-code" value="${a.code}" readonly style="background:var(--bg3)">
        <div style="font-size:10px;color:var(--text3);margin-top:3px">El código no se puede modificar</div>
      </div>
      <div class="form-group">
        <label class="form-label">Tipo *</label>
        <select class="form-select" id="ea-type">
          <option value="herramienta" ${a.type==='herramienta'?'selected':''}>🔧 Herramienta</option>
          <option value="equipo" ${a.type==='equipo'?'selected':''}>⚙️ Equipo</option>
          <option value="edilicio" ${a.type==='edilicio'?'selected':''}>🏢 Edificio / Oficina</option>
          <option value="informatica" ${a.type==='informatica'?'selected':''}>💻 Equipo informático</option>
          <option value="instalacion" ${a.type==='instalacion'?'selected':''}>🏗️ Instalación</option>
          <option value="otro" ${a.type==='otro'?'selected':''}>📦 Otro</option>
        </select>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Nombre / Descripción *</label>
      <input class="form-input" id="ea-name" value="${(a.name||'').replace(/"/g,'&quot;')}">
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Estado *</label>
        <select class="form-select" id="ea-status">
          <option value="operativo" ${a.status==='operativo'?'selected':''}>Operativo</option>
          <option value="en_reparacion" ${a.status==='en_reparacion'?'selected':''}>En reparación</option>
          <option value="fuera_servicio" ${a.status==='fuera_servicio'?'selected':''}>Fuera de servicio</option>
          <option value="baja" ${a.status==='baja'?'selected':''}>De baja</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Ubicación</label>
        <input class="form-input" id="ea-location" value="${(a.location||'').replace(/"/g,'&quot;')}">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Marca</label>
        <input class="form-input" id="ea-brand" value="${(a.brand||'').replace(/"/g,'&quot;')}">
      </div>
      <div class="form-group">
        <label class="form-label">Modelo</label>
        <input class="form-input" id="ea-model" value="${(a.model||'').replace(/"/g,'&quot;')}">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">N° de serie</label>
        <input class="form-input" id="ea-serial" value="${(a.serial_no||'').replace(/"/g,'&quot;')}">
      </div>
      <div class="form-group">
        <label class="form-label">Categoría</label>
        <input class="form-input" id="ea-category" value="${(a.category||'').replace(/"/g,'&quot;')}">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Precio de compra ($)</label>
        <input class="form-input" type="number" id="ea-price" min="0" value="${parseFloat(a.purchase_price)||0}">
      </div>
      <div class="form-group">
        <label class="form-label">Garantía hasta</label>
        <input class="form-input" type="date" id="ea-warranty" value="${a.warranty_until ? a.warranty_until.slice(0,10) : ''}">
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Notas</label>
      <textarea class="form-textarea" id="ea-notes">${a.notes||''}</textarea>
    </div>
  `, [
    { label: 'Cancelar', cls: 'btn-secondary', fn: closeModal },
    { label: 'Guardar cambios', cls: 'btn-primary', fn: () => saveEditAsset(id) },
  ]);
}

async function saveEditAsset(id) {
  const payload = {
    name: document.getElementById('ea-name')?.value.trim(),
    type: document.getElementById('ea-type')?.value,
    status: document.getElementById('ea-status')?.value,
    category: document.getElementById('ea-category')?.value.trim() || null,
    location: document.getElementById('ea-location')?.value.trim() || null,
    brand: document.getElementById('ea-brand')?.value.trim() || null,
    model: document.getElementById('ea-model')?.value.trim() || null,
    serial_no: document.getElementById('ea-serial')?.value.trim() || null,
    purchase_price: parseFloat(document.getElementById('ea-price')?.value) || null,
    warranty_until: document.getElementById('ea-warranty')?.value || null,
    notes: document.getElementById('ea-notes')?.value.trim() || null,
  };

  if (!payload.name) { showToast('warn', 'El nombre es obligatorio'); return; }

  try {
    const res = await apiFetch(`/api/assets/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    if (!res.ok) { const e = await res.json(); showToast('error', e.error || 'Error'); return; }
    closeModal();
    showToast('ok', 'Activo actualizado');
  } catch(err) {
    showToast('error', err.message);
  }
}

async function deleteAsset(id) {
  const a = (App.data.assets || []).find(x => x.id === id);
  if (!a) return;
  if (!confirm(`¿Eliminar el activo "${a.name}" (${a.code})?\n\nEsta acción lo desactiva. Si tiene OTs asociadas, se conservan en el historial.`)) return;

  try {
    const res = await apiFetch(`/api/assets/${id}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json(); showToast('error', e.error || 'Error'); return; }
    showToast('ok', `Activo ${a.code} eliminado`);
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

  openModal(`📋 Historial completo — ${v.code} (${v.plate || '—'})`, `
    <div style="background:var(--bg3);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;font-size:12px">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        <div><b>${v.brand || '—'} ${v.model || ''}</b></div>
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
              <td style="padding:8px;font-family:var(--mono);font-weight:600"><a onclick="closeModal();navigate('workorders');setTimeout(()=>{const ot=(App.data.workOrders||[]).find(x=>x.id==='${o.id}'||x.code==='${o.code || o.id}');if(ot)openEditOTModal(ot.id);},200)" style="color:var(--accent);cursor:pointer">${o.code || o.id}</a></td>
              <td style="padding:8px">${(o.opened || o.created_at || '—').toString().slice(0,10)}</td>
              <td style="padding:8px">${o.type || '—'}</td>
              <td style="padding:8px">${(o.desc || o.description || '—').substring(0, 50)}</td>
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
              <td style="padding:8px;font-family:var(--mono);font-weight:600">${p.code || '—'}</td>
              <td style="padding:8px">${(p.created_at || '—').toString().slice(0,10)}</td>
              <td style="padding:8px">${p.proveedor || '—'}</td>
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
              <td style="padding:8px;text-align:right;font-family:var(--mono)">$${Math.round(f.price_per_l || 0).toLocaleString('es-AR')}</td>
              <td style="padding:8px;text-align:right;font-family:var(--mono);color:var(--accent);font-weight:600">$${Math.round((f.liters||0)*(f.price_per_l||0)).toLocaleString('es-AR')}</td>
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

// Render de una fila de la tabla de combustible (refactorizada para poder filtrar)
function _renderFuelLogRows(logs) {
  const verPrecios = _fuelPuedeVerPrecios(App.currentUser?.role);
  const colspan = verPrecios ? 11 : 9;
  if (!logs || logs.length === 0) {
    return `<tr><td colspan="${colspan}" style="text-align:center;color:var(--text3);padding:24px">Sin cargas registradas con los filtros actuales</td></tr>`;
  }
  return logs.map(f => `<tr>
    <td class="td-mono" style="font-size:11px">${f.date || '—'}</td>
    <td class="td-main">${f.vehicle || '—'}</td>
    <td>${f.driver || '—'}</td>
    <td><span class="badge ${f.fuel_type==='urea'?'badge-info':'badge-ok'}" style="font-size:10px">${f.fuel_type==='urea'?'🔵 Urea':'🟡 Gasoil'}</span></td>
    <td class="td-mono">${f.liters || 0} L</td>
    <td class="td-mono">${f.km > 0 ? f.km.toLocaleString('es-AR')+' km' : '—'}</td>
    ${verPrecios ? `
      <td class="td-mono">$${(f.ppu||0).toLocaleString('es-AR')}</td>
      <td class="td-mono" style="font-weight:600;color:var(--accent)">$${(f.total||0).toLocaleString('es-AR')}</td>
    ` : ''}
    <td>${f.place || '—'}</td>
    <td><span class="badge ${f.status==='OK'?'badge-ok':'badge-warn'}">${f.status||'—'}</span></td>
    <td>
      <div style="display:flex;gap:4px">
        ${f.ticket_image
          ? `<button class="btn btn-secondary btn-sm" onclick="viewTicket('${f.id}')" title="Ver ticket">🧾 Ver</button>`
          : '<span style="color:var(--text3);font-size:11px">sin ticket</span>'}
        ${App.currentUser?.role === 'dueno' ? `<button class="btn btn-danger btn-sm" onclick="deleteFuelLog('${f.id}','${f.vehicle}',${f.liters})" title="Eliminar" style="padding:4px 8px">🗑</button>` : ''}
      </div>
    </td>
  </tr>`).join('');
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
    const verMasBtn = (filtered.length > window._fuelPageSize)
      ? ` · <a onclick="_fuelLoadMore()" style="color:var(--accent);cursor:pointer;font-weight:600">Ver ${Math.min(10, filtered.length - window._fuelPageSize)} más →</a>`
      : '';

    if (filtered.length === total) {
      countInfo.innerHTML = `Mostrando <b>${shown.length}</b> de ${total} cargas · <b>${Math.round(totalLitros).toLocaleString('es-AR')}</b> L · $${Math.round(totalPesos).toLocaleString('es-AR')}${verMasBtn}`;
    } else {
      countInfo.innerHTML = `Mostrando <b>${shown.length}</b> de ${filtered.length} filtrados (${total} total) · <b>${Math.round(totalLitros).toLocaleString('es-AR')}</b> L · $${Math.round(totalPesos).toLocaleString('es-AR')}${verMasBtn}`;
    }
  }
}

// Cargar 10 más en la tabla de combustible
function _fuelLoadMore() {
  window._fuelPageSize = (window._fuelPageSize || 10) + 10;
  _filterFuelLogs();
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

  doc.setFontSize(16);
  doc.setFont('helvetica','bold');
  doc.text('Cargas de combustible — Expreso Biletta', 40, 40);
  doc.setFontSize(10);
  doc.setFont('helvetica','normal');
  doc.setTextColor(100);
  doc.text(`${filtered.length} carga${filtered.length===1?'':'s'}${q?` · Filtro: "${q}"`:''}${typeFilter!=='all'?` · Tipo: ${typeFilter}`:''}`, 40, 58);
  doc.setFontSize(8);
  doc.text(`Generado el ${nowDateAR()} a las ${nowTimeAR()}`, 40, 72);

  const totalLitros = filtered.reduce((a,b) => a + (b.liters||0), 0);
  const totalPesos  = filtered.reduce((a,b) => a + (b.total||0), 0);

  const tableData = filtered.map(f => [
    f.date || '—',
    f.vehicle || '—',
    f.driver || '—',
    f.fuel_type === 'urea' ? 'Urea' : 'Gasoil',
    (f.liters||0).toString() + ' L',
    f.km > 0 ? f.km.toLocaleString('es-AR') : '—',
    '$' + (f.ppu||0).toLocaleString('es-AR'),
    '$' + (f.total||0).toLocaleString('es-AR'),
    f.place || '—',
    f.status || '—',
  ]);

  doc.autoTable({
    startY: 88,
    head: [['Fecha','Unidad','Chofer','Tipo','Litros','Odómetro','Precio/L','Total','Lugar','Estado']],
    body: tableData,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 249, 252] },
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
    footStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
  });

  doc.save(`Combustible-Biletta-${todayISO()}.pdf`);
  showToast('ok', `PDF descargado · ${filtered.length} cargas`);
}

// Ver ticket (imagen) de una carga — mejorado
function viewTicket(logId) {
  const f = (App.data.fuelLogs || []).find(x => x.id === logId);
  if (!f) { showToast('error', 'Carga no encontrada'); return; }

  if (!f.ticket_image) {
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
      <div><b>Chofer</b><br>${f.driver || '—'}</div>
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

// ═══════════════════════════════════════════════════════════
//  DETALLE DE ACTIVOS PATRIMONIALES (ficha completa)
// ═══════════════════════════════════════════════════════════

function openAssetDetailModal(id) {
  const a = (App.data.assets || []).find(x => x.id === id);
  if (!a) { showToast('error', 'Activo no encontrado'); return; }

  const typeLabels = {
    edilicio: '🏢 Edificio / Oficina',
    herramienta: '🔧 Herramienta',
    equipo: '⚙️ Equipo',
    informatica: '💻 Equipo informático',
    instalacion: '🏗️ Instalación',
    otro: '📦 Otro activo',
  };

  const statusLabels = {
    operativo: 'Operativo',
    en_reparacion: 'En reparación',
    fuera_servicio: 'Fuera de servicio',
    baja: 'De baja',
  };

  const statusColors = {
    operativo: 'var(--ok)',
    en_reparacion: 'var(--warn)',
    fuera_servicio: 'var(--danger)',
    baja: 'var(--text3)',
  };

  // Antigüedad del activo
  let antiguedad = '—';
  if (a.purchase_date) {
    const pd = new Date(a.purchase_date);
    const hoy = new Date();
    const anios = ((hoy - pd) / (365.25 * 24 * 60 * 60 * 1000));
    if (anios >= 1) antiguedad = `${anios.toFixed(1)} años`;
    else antiguedad = `${Math.round(anios * 12)} meses`;
  }

  // Garantía
  let garantiaStatus = '—';
  let garantiaColor = 'var(--text3)';
  if (a.warranty_until) {
    const w = new Date(a.warranty_until);
    const hoy = new Date();
    const diasRestantes = Math.ceil((w - hoy) / (24 * 60 * 60 * 1000));
    if (diasRestantes > 0) {
      garantiaStatus = `${diasRestantes} días restantes (hasta ${a.warranty_until.slice(0,10)})`;
      garantiaColor = diasRestantes < 30 ? 'var(--warn)' : 'var(--ok)';
    } else {
      garantiaStatus = `Vencida hace ${Math.abs(diasRestantes)} días`;
      garantiaColor = 'var(--danger)';
    }
  }

  // Buscar OTs asociadas a este activo (si hay)
  const otsDelActivo = (App.data.workOrders || []).filter(o =>
    o.asset_id === a.id || o.asset_code === a.code
  );

  const canEdit = userHasRole('dueno', 'gerencia', 'jefe_mantenimiento');

  openModal(`🏗️ ${a.code} — ${a.name}`, `
    <!-- Header con foto placeholder + info principal -->
    <div style="display:grid;grid-template-columns:auto 1fr;gap:20px;margin-bottom:20px">
      <div style="width:120px;height:120px;background:var(--bg3);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:52px">
        ${(typeLabels[a.type] || '📦').split(' ')[0]}
      </div>
      <div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${typeLabels[a.type] || 'Activo'}</div>
        <div style="font-size:20px;font-weight:700;color:var(--text);margin-bottom:4px">${a.name}</div>
        <div style="font-size:13px;color:var(--text3);margin-bottom:10px">
          ${a.brand || ''} ${a.model || ''} ${a.serial_no ? ` · S/N: ${a.serial_no}` : ''}
        </div>
        <div>
          <span style="display:inline-block;padding:4px 12px;background:${statusColors[a.status]};color:white;border-radius:20px;font-size:11px;font-weight:700">
            ● ${statusLabels[a.status] || a.status}
          </span>
        </div>
      </div>
    </div>

    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
      <div class="kpi-card info" style="padding:12px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Antigüedad</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px">${antiguedad}</div>
      </div>
      <div class="kpi-card info" style="padding:12px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Precio compra</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px">${a.purchase_price ? '$'+Math.round(parseFloat(a.purchase_price)).toLocaleString('es-AR') : '—'}</div>
      </div>
      <div class="kpi-card info" style="padding:12px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Ubicación</div>
        <div style="font-size:14px;font-weight:700;margin-top:4px">${a.location || '—'}</div>
      </div>
      <div class="kpi-card info" style="padding:12px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">OTs asociadas</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px">${otsDelActivo.length}</div>
      </div>
    </div>

    <!-- Ficha técnica -->
    <div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border)">📋 Ficha técnica</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;font-size:13px">
        <div><span style="color:var(--text3);font-size:11px">Código interno:</span> <b>${a.code}</b></div>
        <div><span style="color:var(--text3);font-size:11px">Categoría:</span> ${a.category || '—'}</div>
        <div><span style="color:var(--text3);font-size:11px">Marca:</span> ${a.brand || '—'}</div>
        <div><span style="color:var(--text3);font-size:11px">Modelo:</span> ${a.model || '—'}</div>
        <div><span style="color:var(--text3);font-size:11px">N° de serie:</span> <span class="td-mono">${a.serial_no || '—'}</span></div>
        <div><span style="color:var(--text3);font-size:11px">Fecha de compra:</span> ${a.purchase_date ? a.purchase_date.slice(0,10) : '—'}</div>
        <div style="grid-column:span 2"><span style="color:var(--text3);font-size:11px">Garantía:</span> <span style="color:${garantiaColor};font-weight:600">${garantiaStatus}</span></div>
      </div>
    </div>

    ${a.notes ? `
      <div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">📝 Notas</div>
        <div style="background:var(--bg3);padding:10px 14px;border-radius:var(--radius);font-size:13px;color:var(--text)">
          ${a.notes}
        </div>
      </div>
    ` : ''}

    <!-- Historial de OTs -->
    <div style="margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">🔧 Historial de mantenimiento</div>
      ${otsDelActivo.length === 0 ? `
        <div style="background:var(--bg3);padding:16px;text-align:center;color:var(--text3);font-size:12px;border-radius:var(--radius)">
          Este activo no tiene órdenes de trabajo asociadas todavía.
        </div>
      ` : `
        <table style="width:100%;font-size:12px">
          <thead>
            <tr style="color:var(--text3);font-size:11px">
              <th style="text-align:left;padding:6px">Código</th>
              <th style="text-align:left;padding:6px">Fecha</th>
              <th style="text-align:left;padding:6px">Descripción</th>
              <th style="text-align:right;padding:6px">Costo</th>
              <th style="text-align:left;padding:6px">Estado</th>
            </tr>
          </thead>
          <tbody>
            ${otsDelActivo.slice(0, 10).map(o => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:6px;font-family:var(--mono);font-weight:600">${o.code || o.id.substring(0,8)}</td>
                <td style="padding:6px">${(o.opened || '—').toString().slice(0,10)}</td>
                <td style="padding:6px">${((o.desc || o.description || '—')+'').substring(0,40)}</td>
                <td style="padding:6px;text-align:right;font-family:var(--mono)">$${Math.round((parseFloat(o.parts_cost)||0)+(parseFloat(o.labor_cost)||0)).toLocaleString('es-AR')}</td>
                <td style="padding:6px">${o.status || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${otsDelActivo.length > 10 ? `<div style="font-size:10px;color:var(--text3);text-align:center;padding:6px">Mostrando 10 de ${otsDelActivo.length} OTs</div>` : ''}
      `}
    </div>
  `, [
    ...(canEdit ? [{ label: '✏️ Editar activo', cls: 'btn-secondary', fn: () => { closeModal(); openEditAssetModal(id); } }] : []),
    { label: 'Cerrar', cls: 'btn-primary', fn: closeModal },
  ]);
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
