// ════════════════════════════════════════════════════════════════════
//  STOCK Y DEPÓSITO (ES module, Fase 3) — catálogo único + saldos por
//  sucursal/área, despachos y movimientos. Migrado de stock.js.
//
//  Los helpers compartidos (stockLocationControls, stockCanManage,
//  stockBaseOptions) siguen viviendo en app.js; acá se leen por el puente.
// ════════════════════════════════════════════════════════════════════
import { need, expose } from './dom.mjs';

const App = need('App');
const apiFetch = need('apiFetch');
const afterSave = need('afterSave');
const escapeHtml = need('escapeHtml');
const escapeJsArg = need('escapeJsArg');
const openModal = need('openModal');
const closeModal = need('closeModal');
const showToast = need('showToast');
const userHasRole = need('userHasRole');
const stockCanManage = need('stockCanManage');
const stockLocationControls = need('stockLocationControls');
const stockBaseOptions = need('stockBaseOptions');

async function renderStock() {
  const page = document.getElementById('page-stock');
  if (!page) return;
  page.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">Cargando catálogo…</div>';
  let items = [], dispatches = [], movements = [];
  try {
    const [rc, rd, rm] = await Promise.all([
      apiFetch('/api/stock/catalog'),
      apiFetch('/api/stock/dispatches').catch(() => null),
      apiFetch('/api/stock/catalog/movements?limit=10').catch(() => null),
    ]);
    items = rc && rc.ok ? await rc.json() : [];
    dispatches = rd && rd.ok ? await rd.json() : [];
    movements = rm && rm.ok ? await rm.json() : [];
  } catch (e) { items = []; }
  App.data.stockCatalog = items;
  App.data.stockDispatches = dispatches;
  App.data.stockMovements = movements;
  // Estado de paginación de movimientos: offset = lo ya cargado; allLoaded si vino
  // menos de una página entera (no hay más para traer del backend).
  App.stockMov = { offset: movements.length, pageSize: 10, allLoaded: movements.length < 10 };
  _renderStockCatalog();
}

function _renderStockCatalog() {
  const page = document.getElementById('page-stock');
  if (!page) return;
  const all = App.data.stockCatalog || [];
  const f = (App.stockCatFilter = App.stockCatFilter || { cat: 'all', q: '', suc: 'all', area: 'all' });
  // Compatibilidad con estados viejos sin suc/area.
  if (f.suc === undefined) f.suc = 'all';
  if (f.area === undefined) f.area = 'all';
  const num = (v) => parseFloat(v) || 0;
  const cats = [...new Set(all.map((a) => a.category).filter(Boolean))].sort();

  // Sucursales y áreas disponibles (derivadas de los saldos que el usuario ve).
  // El backend ya scopea por rol; acá solo armamos las opciones del filtro visual.
  const sucs = [...new Set(all.flatMap((a) => (a.balances || []).map((b) => b.base_location)).filter(Boolean))].sort();
  const areasForSel = [...new Set(all.flatMap((a) => (a.balances || [])
    .filter((b) => f.suc === 'all' || b.base_location === f.suc)
    .map((b) => b.area)).filter(Boolean))].sort();

  // Filtro por ubicación: ¿este saldo entra en la sucursal/área elegida?
  const matchLoc = (b) => {
    if (f.suc !== 'all' && b.base_location !== f.suc) return false;
    if (f.area !== 'all' && b.area !== f.area) return false;
    return true;
  };
  const locActive = f.suc !== 'all' || f.area !== 'all';
  // Stock dentro del scope elegido (cuando hay filtro de ubicación); si no, el total global.
  const scopedTotalOf = (a) => locActive
    ? (a.balances || []).filter(matchLoc).reduce((s, b) => s + num(b.qty_current), 0)
    : num(a.total);

  const items = all.filter((a) => {
    if (f.cat !== 'all' && a.category !== f.cat) return false;
    if (f.q) { const q = f.q.toLowerCase(); if (!((a.code || '').toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q) || (a.supplier || '').toLowerCase().includes(q))) return false; }
    // Con filtro de ubicación, solo se listan los artículos que TIENEN stock ahí.
    if (locActive && !(a.balances || []).some((b) => matchLoc(b) && num(b.qty_current) > 0)) return false;
    return true;
  });
  const criticos = items.filter((a) => a.is_critical).length;
  const valor = items.reduce((s, a) => s + scopedTotalOf(a) * num(a.unit_cost), 0);
  const canManage = typeof stockCanManage === 'function' ? stockCanManage() : userHasRole('dueno', 'gerencia', 'jefe_mantenimiento', 'paniol', 'contador', 'gerente_sucursal');

  const rows = items.length === 0
    ? '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text3)">Sin artículos con esos filtros.' + (canManage ? ' Usá <b>+ Nuevo artículo</b>.' : '') + '</td></tr>'
    : items.map((a) => {
        // El badge de Estado refleja la salud GLOBAL del artículo (vs su mínimo),
        // no la del área filtrada — así no aparecen falsos "Crítico" por área.
        const st = a.is_critical ? 'danger' : (num(a.qty_min) > 0 && num(a.total) <= num(a.qty_min) * 1.5 ? 'warn' : 'ok');
        const stLbl = st === 'danger' ? 'Crítico' : st === 'warn' ? 'Bajo' : 'Normal';
        const total = scopedTotalOf(a);
        // Con filtro de ubicación el número es "lo que hay acá" → color neutro;
        // sin filtro, el total global se colorea según el estado.
        const totalColor = locActive ? 'var(--text1)' : `var(--${st})`;
        const ubis = _stockBalChips(a, num, locActive ? matchLoc : null);
        return `<tr class="sc-row sc-${st}">
          <td><span class="sc-code">${escapeHtml(a.code)}</span></td>
          <td><span class="sc-name">${escapeHtml(a.name)}</span></td>
          <td><span class="tag" style="background:var(--bg4);color:var(--text2)">${escapeHtml(a.category)}</span></td>
          <td><span class="sc-qty" style="color:${totalColor}">${total}<small>${escapeHtml(a.unit)}</small></span></td>
          <td>${ubis}</td>
          <td><span class="badge badge-${st}">${stLbl}</span></td>
          <td style="white-space:nowrap"><button class="btn btn-secondary btn-sm" onclick="_toggleCatDetail('${a.id}')">Mover ▾</button></td>
        </tr>
        <tr id="cat-detail-${a.id}" style="display:none"><td colspan="7" style="padding:0 8px 10px">${_catDetailHtml(a)}</td></tr>`;
      }).join('');

  const catOpts = [`<option value="all"${f.cat === 'all' ? ' selected' : ''}>Categoría: todas</option>`]
    .concat(cats.map((c) => `<option value="${escapeHtml(c)}"${f.cat === c ? ' selected' : ''}>${escapeHtml(c)}</option>`)).join('');

  // Filtros de Sucursal y Área: solo se muestran si hay más de una opción
  // (un pañolero que ve una sola área no necesita el desplegable).
  const sucSelect = sucs.length > 1
    ? `<select class="form-select" style="width:180px" onchange="App.stockCatFilter.suc=this.value;App.stockCatFilter.area='all';_renderStockCatalog()">
        <option value="all"${f.suc === 'all' ? ' selected' : ''}>Sucursal: todas</option>
        ${sucs.map((s) => `<option value="${escapeHtml(s)}"${f.suc === s ? ' selected' : ''}>${escapeHtml(_stockShortLoc(s))}</option>`).join('')}
      </select>` : '';
  const areaSelect = areasForSel.length > 1
    ? `<select class="form-select" style="width:160px" onchange="App.stockCatFilter.area=this.value;_renderStockCatalog()">
        <option value="all"${f.area === 'all' ? ' selected' : ''}>Área: todas</option>
        ${areasForSel.map((s) => `<option value="${escapeHtml(s)}"${f.area === s ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}
      </select>` : '';
  // Texto del scope activo, para el subtítulo (ej. "Río Tercero · Taller").
  const scopeLabel = [f.suc !== 'all' ? _stockShortLoc(f.suc) : null, f.area !== 'all' ? f.area : null].filter(Boolean).join(' · ');

  // Vista activa: catálogo (por artículo) o por sucursal (cada sucursal con su stock).
  const view = (App.stockView === 'sucursal') ? 'sucursal' : 'catalogo';
  const tabBtn = (id, label) => `<button onclick="App.stockView='${id}';_renderStockCatalog()" style="padding:6px 14px;border:none;cursor:pointer;font-size:13px;font-weight:600;background:${view === id ? 'var(--accent)' : 'transparent'};color:${view === id ? '#fff' : 'var(--text3)'}">${label}</button>`;
  const toggle = `<div style="display:inline-flex;border:1px solid var(--border2);border-radius:8px;overflow:hidden">${tabBtn('catalogo', 'Catálogo')}${tabBtn('sucursal', 'Por sucursal')}</div>`;

  page.innerHTML = `
    <div class="kpi-row kpi-row-3" style="margin-bottom:20px">
      <div class="kpi-card ${criticos ? 'danger' : 'ok'}"><div class="kpi-label">Críticos</div><div class="kpi-value ${criticos ? 'danger' : 'ok'}">${criticos}</div><div class="kpi-trend">debajo del mínimo</div></div>
      <div class="kpi-card info"><div class="kpi-label">Artículos</div><div class="kpi-value white">${items.length}</div><div class="kpi-trend">en el catálogo</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Valorización</div><div class="kpi-value ok">$${Math.round(valor).toLocaleString('es-AR')}</div><div class="kpi-trend">al costo actual</div></div>
    </div>
    <div class="section-header">
      <div><div class="section-title">${view === 'sucursal' ? 'Stock por sucursal' : 'Catálogo de artículos'}</div><div class="section-sub">${view === 'sucursal' ? 'Cada sucursal con su stock' : (locActive ? 'Mostrando solo: ' + escapeHtml(scopeLabel) : 'Un artículo = un código único · saldo por sucursal/área')}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${toggle}
        ${view === 'catalogo' ? `${sucSelect}${areaSelect}<select class="form-select" style="width:200px" onchange="App.stockCatFilter.cat=this.value;_renderStockCatalog()">${catOpts}</select>
        <input class="form-input" style="max-width:240px" placeholder="Buscar código, artículo…" value="${escapeHtml(f.q || '')}" oninput="App.stockCatFilter.q=this.value;_renderStockCatalog()">` : ''}
        ${_stockCanSend() ? '<button class="btn btn-secondary btn-sm" onclick="openDispatchNew()">🚚 Despachar</button>' : ''}
        ${canManage ? '<button class="btn btn-primary btn-sm" onclick="openNewCatalogItem()">+ Nuevo artículo</button>' : ''}
      </div>
    </div>
    ${view === 'sucursal'
      ? _renderStockPorSucursal(all, num)
      : `<div class="card" style="padding:0"><div class="table-wrap"><table class="stock-cat-table">
      <thead><tr><th>Código</th><th>Artículo</th><th>Categoría</th><th>${locActive ? 'Stock acá' : 'Stock total'}</th><th>Por sucursal/área</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`}
    ${_stockInlinePanels()}`;
}

// Vista "Por sucursal": agrupa los saldos del catálogo por sucursal (base_location),
// mostrando cada sucursal con sus artículos. Respeta el scope del rol (la API ya
// devuelve solo lo que el usuario puede ver, p. ej. su área).
function _renderStockPorSucursal(all, num) {
  const bySuc = {};
  (all || []).forEach((a) => {
    (a.balances || []).forEach((b) => {
      const qty = num(b.qty_current);
      if (qty <= 0) return;
      const suc = b.base_location || '—';
      (bySuc[suc] = bySuc[suc] || []).push({ code: a.code, name: a.name, area: b.area, qty, unit: a.unit, unit_cost: num(a.unit_cost) });
    });
  });
  const sucs = Object.keys(bySuc).sort();
  if (!sucs.length) return '<div class="card" style="padding:24px;text-align:center;color:var(--text3)">Sin stock cargado por sucursal.</div>';
  return sucs.map((suc) => {
    const rows = bySuc[suc].sort((x, y) => String(x.code || '').localeCompare(String(y.code || '')));
    const totalVal = rows.reduce((s, r) => s + r.qty * r.unit_cost, 0);
    return `<div class="card" style="padding:0;margin-bottom:16px">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center">
        <div class="section-title" style="font-size:15px;margin:0">🏢 ${escapeHtml(suc)}</div>
        <div style="font-size:12px;color:var(--text3)">${rows.length} artículo${rows.length === 1 ? '' : 's'} · $${Math.round(totalVal).toLocaleString('es-AR')}</div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Código</th><th>Artículo</th><th>Área</th><th style="text-align:right">Cantidad</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="td-mono td-main">${escapeHtml(r.code)}</td>
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.area || '—')}</td>
          <td class="td-mono" style="text-align:right;font-weight:600">${r.qty} ${escapeHtml(r.unit || '')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }).join('');
}

// Paneles que se ven directo al entrar a la página (no atrás de un botón):
// despachos (en tránsito + recientes, con sus acciones) e historial (últimos 10).
function _stockInlinePanels() {
  return `<div class="stock-panels" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;margin-top:20px">
    <div class="card" style="padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="section-title" style="font-size:15px">🚚 Despachos entre sucursales</div>
        ${_stockCanSend() ? '<button class="btn btn-secondary btn-sm" onclick="openDispatchNew()">+ Nuevo</button>' : ''}
      </div>
      <div id="stock-disp-inline">${_renderDispatchesInline(App.data.stockDispatches || [])}</div>
    </div>
    <div class="card" style="padding:14px 16px">
      <div class="section-title" style="font-size:15px;margin-bottom:10px">🕑 Movimientos recientes</div>
      <div id="stock-mov-section">${_renderMovementsSection()}</div>
    </div>
  </div>`;
}

// Lista de movimientos + enlace "Cargar más" (trae la próxima página del backend).
function _renderMovementsSection() {
  const st = App.stockMov || { allLoaded: true };
  const cargarMas = !st.allLoaded
    ? `<div style="padding:10px;text-align:center"><a onclick="cargarMasStockMov()" style="color:var(--accent);cursor:pointer;font-weight:600">Cargar más →</a></div>`
    : '';
  return `<div id="stock-mov-inline">${_renderMovementsInline(App.data.stockMovements || [])}</div>${cargarMas}`;
}

async function cargarMasStockMov() {
  const st = App.stockMov = App.stockMov || { offset: 0, pageSize: 10, allLoaded: false };
  try {
    const res = await apiFetch(`/api/stock/catalog/movements?limit=${st.pageSize}&offset=${st.offset}`);
    if (!res.ok) { st.allLoaded = true; }
    else {
      const more = await res.json();
      if (!Array.isArray(more) || more.length < st.pageSize) st.allLoaded = true;
      if (Array.isArray(more) && more.length) {
        App.data.stockMovements = (App.data.stockMovements || []).concat(more);
        st.offset += more.length;
      }
    }
  } catch (e) { st.allLoaded = true; }
  const cont = document.getElementById('stock-mov-section');
  if (cont) cont.innerHTML = _renderMovementsSection();
}

// Lista de despachos para el panel inline: en tránsito arriba (con Recibir/Cancelar),
// luego los últimos recibidos/cancelados. Reusa el mismo formato de tarjeta.
function _renderDispatchesInline(list) {
  const num = (v) => parseFloat(v) || 0;
  const fmtDate = (s) => { try { return s ? new Date(s).toLocaleDateString('es-AR') : ''; } catch (e) { return ''; } };
  const canRecv = _stockCanReceive();
  const canSend = _stockCanSend();
  const sideColor = (st) => st === 'en_transito' ? 'warn' : st === 'recibido' ? 'ok' : 'danger';
  const card = (d) => {
    const badge = d.status === 'en_transito' ? '<span class="badge badge-warn">🚚 En tránsito</span>'
      : d.status === 'recibido' ? '<span class="badge badge-ok">✓ Recibido</span>'
      : '<span class="badge badge-danger">Cancelado</span>';
    // Los botones de acción cortan la propagación para que su click no abra el
    // detalle de la tarjeta (que también es clickeable).
    const recvBtn = (d.status === 'en_transito' && canRecv) ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();receiveDispatch('${d.id}',${num(d.qty_sent)})">✓ Recibir</button>` : '';
    const cancBtn = (d.status === 'en_transito' && canSend) ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();cancelDispatch('${d.id}')">Cancelar</button>` : '';
    const when = fmtDate(d.dispatched_at);
    const clickAttr = (d.id != null) ? `class="stock-disp-card" onclick="openDispatchDetail('${escapeJsArg(String(d.id))}')" title="Ver detalle e imprimir" style="cursor:pointer;` : `style="`;
    return `<div ${clickAttr}border:1px solid var(--border);border-left:3px solid var(--${sideColor(d.status)});border-radius:var(--radius);padding:9px 11px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:7px">
        <div style="font-weight:600;font-size:13px"><span class="td-mono" style="font-size:11px">${escapeHtml(d.code)}</span> · ${escapeHtml(d.name)}</div>${badge}
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;flex-wrap:wrap">
        <span style="background:var(--bg3);padding:3px 8px;border-radius:8px">${escapeHtml(_stockShortLoc(d.from_location))} · ${escapeHtml(d.from_area)}</span>
        <span style="color:var(--accent);font-weight:700;white-space:nowrap">→ ${num(d.qty_sent)} ${escapeHtml(d.unit)} →</span>
        <span style="background:var(--bg3);padding:3px 8px;border-radius:8px">${escapeHtml(_stockShortLoc(d.to_location))} · ${escapeHtml(d.to_area)}</span>
      </div>
      <div style="color:var(--text3);font-size:11px;margin-top:5px">${when}${d.dispatched_by_name ? ' · ' + escapeHtml(d.dispatched_by_name) : ''}${d.status === 'recibido' ? ` · recibido <b>${num(d.qty_received)}</b>` : ''}</div>
      ${(recvBtn || cancBtn) ? `<div style="display:flex;gap:6px;margin-top:7px">${recvBtn}${cancBtn}</div>` : ''}
    </div>`;
  };
  const enTransito = (list || []).filter((d) => d.status === 'en_transito');
  const otros = (list || []).filter((d) => d.status !== 'en_transito').slice(0, 5);
  if (!enTransito.length && !otros.length) return '<div style="color:var(--text3);font-size:12px;text-align:center;padding:14px">No hay despachos.</div>';
  return `${enTransito.length ? `<div style="font-size:12px;font-weight:600;color:var(--warn);margin-bottom:6px">En tránsito (${enTransito.length})</div>${enTransito.map(card).join('')}` : ''}
    ${otros.length ? `<div style="font-size:12px;font-weight:600;color:var(--text2);margin:10px 0 6px">Recientes</div>${otros.map(card).join('')}` : ''}`;
}

// Busca un despacho ya cargado en memoria por su id.
function _findDispatch(id) {
  return (App.data.stockDispatches || []).find((d) => String(d.id) === String(id));
}

// Etiqueta legible del estado de un despacho.
function _dispatchStatusInfo(status) {
  if (status === 'en_transito') return { color: 'warn', label: '🚚 En tránsito', plain: 'En tránsito' };
  if (status === 'recibido') return { color: 'ok', label: '✓ Recibido', plain: 'Recibido' };
  return { color: 'danger', label: 'Cancelado', plain: 'Cancelado' };
}

// Detalle completo de un despacho en un modal, con botón para imprimir el
// remito. Reusa los datos que ya trajo la lista (no re-consulta el backend).
function openDispatchDetail(id) {
  const d = _findDispatch(id);
  if (!d) { showToast('error', 'No se encontró el despacho'); return; }
  const num = (v) => parseFloat(v) || 0;
  const info = _dispatchStatusInfo(d.status);
  const fechaHora = (s) => { try { return s ? new Date(s).toLocaleString('es-AR') : '—'; } catch (e) { return '—'; } };
  const row = (k, v) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid var(--border)">
    <span style="color:var(--text3)">${k}</span><span style="font-weight:600;text-align:right">${v}</span></div>`;
  const body = `
    <div style="text-align:center;margin-bottom:14px">
      <span class="badge badge-${info.color}" style="font-size:14px;padding:6px 14px">${info.label}</span>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;margin-top:10px;flex-wrap:wrap">
        <span style="background:var(--bg3);padding:3px 8px;border-radius:8px">${escapeHtml(_stockShortLoc(d.from_location) || '—')}${d.from_area ? ' · ' + escapeHtml(d.from_area) : ''}</span>
        <span style="color:var(--accent);font-weight:700;white-space:nowrap">→ ${num(d.qty_sent)} ${escapeHtml(d.unit || '')} →</span>
        <span style="background:var(--bg3);padding:3px 8px;border-radius:8px">${escapeHtml(_stockShortLoc(d.to_location) || '—')}${d.to_area ? ' · ' + escapeHtml(d.to_area) : ''}</span>
      </div>
    </div>
    <div style="font-size:13px">
      ${row('Artículo', `<span class="td-mono" style="font-size:11px">${escapeHtml(d.code)}</span> · ${escapeHtml(d.name)}`)}
      ${row('Cantidad enviada', `${num(d.qty_sent)} ${escapeHtml(d.unit || '')}`)}
      ${row('Origen', `${escapeHtml(_stockShortLoc(d.from_location) || '—')}${d.from_area ? ' · ' + escapeHtml(d.from_area) : ''}`)}
      ${row('Destino', `${escapeHtml(_stockShortLoc(d.to_location) || '—')}${d.to_area ? ' · ' + escapeHtml(d.to_area) : ''}`)}
      ${row('Estado', escapeHtml(info.plain))}
      ${row('Despachado por', escapeHtml(d.dispatched_by_name || '—'))}
      ${row('Fecha de despacho', fechaHora(d.dispatched_at))}
      ${d.status === 'recibido' ? row('Cantidad recibida', `${num(d.qty_received)} ${escapeHtml(d.unit || '')}`) : ''}
      ${d.status === 'recibido' && d.received_by_name ? row('Recibido por', escapeHtml(d.received_by_name)) : ''}
      ${d.status === 'recibido' && d.received_at ? row('Fecha de recepción', fechaHora(d.received_at)) : ''}
      ${d.notes ? row('Nota', escapeHtml(d.notes)) : ''}
      ${d.receive_notes ? row('Nota de recepción', escapeHtml(d.receive_notes)) : ''}
    </div>`;
  openModal('Detalle del despacho', body, [
    { label: '🖨 Imprimir', cls: 'btn-primary', fn: () => printDispatch(id) },
    { label: 'Cerrar', cls: 'btn-secondary', fn: () => closeModal() },
  ]);
}

// Genera un remito imprimible del despacho (patrón de ticket del sistema).
function printDispatch(id) {
  const d = _findDispatch(id);
  if (!d) { showToast('error', 'No se encontró el despacho'); return; }
  const w = window.open('', '_blank');
  if (!w) { showToast('error', 'Habilitá las ventanas emergentes para imprimir'); return; }
  w.document.write(_dispatchComprobanteHtml(d));
  w.document.close();
}

// HTML del remito de despacho (mismo estilo que los demás tickets).
function _dispatchComprobanteHtml(d) {
  const num = (v) => parseFloat(v) || 0;
  const esc = escapeHtml;
  const info = _dispatchStatusInfo(d.status);
  const fechaHora = (s) => { try { return s ? new Date(s).toLocaleString('es-AR') : '—'; } catch (e) { return '—'; } };
  const rows = [
    ['Artículo', `${esc(d.code || '')} · ${esc(d.name || '')}`],
    ['Cantidad enviada', `${num(d.qty_sent)} ${esc(d.unit || '')}`],
    ['Origen', `${esc(_stockShortLoc(d.from_location) || '—')}${d.from_area ? ' · ' + esc(d.from_area) : ''}`],
    ['Destino', `${esc(_stockShortLoc(d.to_location) || '—')}${d.to_area ? ' · ' + esc(d.to_area) : ''}`],
    ['Estado', esc(info.plain)],
    ['Despachado por', esc(d.dispatched_by_name || '—')],
    ['Fecha de despacho', fechaHora(d.dispatched_at)],
  ];
  if (d.status === 'recibido') {
    rows.push(['Cantidad recibida', `${num(d.qty_received)} ${esc(d.unit || '')}`]);
    if (d.received_by_name) rows.push(['Recibido por', esc(d.received_by_name)]);
    if (d.received_at) rows.push(['Fecha de recepción', fechaHora(d.received_at)]);
  }
  if (d.notes) rows.push(['Nota', esc(d.notes)]);
  if (d.receive_notes) rows.push(['Nota de recepción', esc(d.receive_notes)]);
  const filas = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Remito de despacho — ${esc(d.code || '')}</title>
    <style>
      * { box-sizing:border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color:#1f2937; margin:0; padding:32px; }
      .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #ea580c; padding-bottom:12px; margin-bottom:18px; }
      .brand { font-size:22px; font-weight:800; color:#ea580c; }
      .brand small { display:block; font-size:11px; color:#6b7280; font-weight:400; margin-top:2px; }
      .doc { text-align:right; }
      .doc h1 { font-size:16px; margin:0; letter-spacing:.5px; }
      .doc .qty { color:#ea580c; font-weight:700; font-size:18px; margin-top:4px; }
      .doc .date { color:#6b7280; font-size:11px; margin-top:2px; }
      .route { text-align:center; font-size:14px; margin:0 0 16px; padding:10px; background:#f9fafb; border-radius:8px; }
      .route b { color:#ea580c; }
      table { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:14px; }
      th { background:#f3f4f6; text-align:left; padding:9px 10px; width:180px; color:#374151; vertical-align:top; }
      td { padding:9px 10px; border-bottom:1px solid #f0f0f0; vertical-align:top; }
      tr th { border-bottom:1px solid #f0f0f0; }
      .sign { display:flex; gap:40px; margin-top:40px; }
      .sign > div { flex:1; border-top:1px solid #9ca3af; padding-top:6px; font-size:11px; color:#6b7280; text-align:center; }
      .foot { margin-top:28px; color:#6b7280; font-size:10px; text-align:center; border-top:1px solid #e5e7eb; padding-top:8px; }
      @media print { body { padding:12px; } }
    </style></head><body>
    <div class="head">
      <div class="brand">Expreso Biletta<small>Sistema de gestión de flota — FleetOS</small></div>
      <div class="doc">
        <h1>REMITO DE DESPACHO</h1>
        <div class="qty">${num(d.qty_sent)} ${esc(d.unit || '')}</div>
        <div class="date">Emitido: ${fechaHora(new Date())}</div>
      </div>
    </div>
    <div class="route"><b>${esc(_stockShortLoc(d.from_location) || '—')}${d.from_area ? ' · ' + esc(d.from_area) : ''}</b> &nbsp;→&nbsp; <b>${esc(_stockShortLoc(d.to_location) || '—')}${d.to_area ? ' · ' + esc(d.to_area) : ''}</b></div>
    <table><tbody>${filas}</tbody></table>
    <div class="sign"><div>Firma / aclaración — Entrega</div><div>Firma / aclaración — Recepción</div></div>
    <div class="foot">Comprobante generado por FleetOS · Expreso Biletta S.R.L. · ${fechaHora(new Date())}</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
  </body></html>`;
}

// Historial: últimos movimientos del catálogo (ingreso/egreso/ajuste).
function _renderMovementsInline(list) {
  const num = (v) => parseFloat(v) || 0;
  const fmt = (s) => { try { return s ? new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; } catch (e) { return ''; } };
  if (!list || !list.length) return '<div style="color:var(--text3);font-size:12px;text-align:center;padding:14px">Sin movimientos todavía.</div>';
  const color = (t) => t === 'Ingreso' ? 'ok' : t === 'Egreso' ? 'danger' : 'warn';
  const sign = (t) => t === 'Ingreso' ? '+' : t === 'Egreso' ? '−' : '±';
  return list.map((m) => {
    // Detalle del movimiento: a dónde fue (OT vinculada o motivo del despacho/egreso)
    // y el valor al costo actual. Así el historial dice "qué pasó" de un vistazo.
    const cost = num(m.qty) * num(m.unit_cost);
    const dest = m.wo_code ? ('🔧 OT ' + escapeHtml(m.wo_code)) : (m.reason ? escapeHtml(m.reason) : '');
    const costStr = cost > 0 ? ('$' + Math.round(cost).toLocaleString('es-AR')) : '';
    const detail = [dest, costStr].filter(Boolean).join(' · ');
    // Fila clickeable: abre el detalle del movimiento (con opción de imprimir).
    const idAttr = (m.id != null) ? `onclick="openMovementDetail('${escapeJsArg(String(m.id))}')" title="Ver detalle e imprimir" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:7px 2px;border-bottom:1px solid var(--border);font-size:12px"` : `style="display:flex;align-items:center;gap:10px;padding:7px 2px;border-bottom:1px solid var(--border);font-size:12px"`;
    return `<div class="stock-mov-row" ${idAttr}>
      <span class="badge badge-${color(m.type)}" style="min-width:62px;text-align:center">${sign(m.type)} ${num(m.qty)} ${escapeHtml(m.unit || '')}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span class="td-mono" style="font-size:11px">${escapeHtml(m.code)}</span> · ${escapeHtml(m.name)}</div>
        <div style="color:var(--text3);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(_stockShortLoc(m.base_location))} · ${escapeHtml(m.area)}${m.user_name ? ' · ' + escapeHtml(m.user_name) : ''}</div>
        ${detail ? `<div style="color:var(--text2);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${detail}</div>` : ''}
      </div>
      <span style="color:var(--text3);font-size:11px;white-space:nowrap">${fmt(m.created_at)}</span>
    </div>`;
  }).join('');
}

// Busca un movimiento ya cargado en memoria por su id.
function _findMovement(id) {
  return (App.data.stockMovements || []).find((m) => String(m.id) === String(id));
}

// Etiquetas legibles para el tipo de movimiento (con el signo/dirección).
function _movTypeInfo(type) {
  if (type === 'Ingreso') return { color: 'ok', sign: '+', dir: 'Entrada de stock' };
  if (type === 'Egreso') return { color: 'danger', sign: '−', dir: 'Salida de stock' };
  return { color: 'warn', sign: '±', dir: 'Ajuste de inventario' };
}

// Detalle completo de un movimiento en un modal, con botón para imprimir el
// comprobante. Reusa los datos que ya trajo la lista (no re-consulta el backend).
function openMovementDetail(id) {
  const m = _findMovement(id);
  if (!m) { showToast('error', 'No se encontró el movimiento'); return; }
  const num = (v) => parseFloat(v) || 0;
  const info = _movTypeInfo(m.type);
  const fechaHora = (s) => { try { return s ? new Date(s).toLocaleString('es-AR') : '—'; } catch (e) { return '—'; } };
  const cost = num(m.qty) * num(m.unit_cost);
  const row = (k, v) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid var(--border)">
    <span style="color:var(--text3)">${k}</span><span style="font-weight:600;text-align:right">${v}</span></div>`;
  const dest = m.wo_code ? ('🔧 OT ' + escapeHtml(m.wo_code)) : (m.reason ? escapeHtml(m.reason) : '—');
  const body = `
    <div style="text-align:center;margin-bottom:14px">
      <span class="badge badge-${info.color}" style="font-size:16px;padding:6px 14px">${info.sign} ${num(m.qty)} ${escapeHtml(m.unit || '')}</span>
      <div style="color:var(--text3);font-size:12px;margin-top:6px">${escapeHtml(info.dir)}</div>
    </div>
    <div style="font-size:13px">
      ${row('Artículo', `<span class="td-mono" style="font-size:11px">${escapeHtml(m.code)}</span> · ${escapeHtml(m.name)}`)}
      ${row('Tipo', escapeHtml(m.type || '—'))}
      ${row('Cantidad', `${num(m.qty)} ${escapeHtml(m.unit || '')}`)}
      ${row('Ubicación', `${escapeHtml(_stockShortLoc(m.base_location) || '—')}${m.area ? ' · ' + escapeHtml(m.area) : ''}`)}
      ${row('Motivo / destino', dest)}
      ${cost > 0 ? row('Valor al costo', '$' + Math.round(cost).toLocaleString('es-AR') + ` <span style="color:var(--text3);font-weight:400">(costo unit. $${num(m.unit_cost).toLocaleString('es-AR')})</span>`) : ''}
      ${row('Registrado por', escapeHtml(m.user_name || '—'))}
      ${row('Fecha y hora', fechaHora(m.created_at))}
    </div>`;
  openModal('Detalle del movimiento', body, [
    { label: '🖨 Imprimir', cls: 'btn-primary', fn: () => printStockMovement(id) },
    { label: 'Cerrar', cls: 'btn-secondary', fn: () => closeModal() },
  ]);
}

// Genera un comprobante imprimible del movimiento (patrón de ticket del sistema:
// abre una ventana con el HTML y dispara window.print()).
function printStockMovement(id) {
  const m = _findMovement(id);
  if (!m) { showToast('error', 'No se encontró el movimiento'); return; }
  const w = window.open('', '_blank');
  if (!w) { showToast('error', 'Habilitá las ventanas emergentes para imprimir'); return; }
  w.document.write(_movComprobanteHtml(m));
  w.document.close();
}

// HTML del comprobante de movimiento de stock (mismo estilo que los demás tickets).
function _movComprobanteHtml(m) {
  const num = (v) => parseFloat(v) || 0;
  const esc = escapeHtml;
  const info = _movTypeInfo(m.type);
  const fechaHora = (s) => { try { return s ? new Date(s).toLocaleString('es-AR') : '—'; } catch (e) { return '—'; } };
  const cost = num(m.qty) * num(m.unit_cost);
  const dest = m.wo_code ? ('OT ' + m.wo_code) : (m.reason || '—');
  const rows = [
    ['Artículo', `${esc(m.code || '')} · ${esc(m.name || '')}`],
    ['Tipo de movimiento', `${esc(m.type || '—')} (${esc(info.dir)})`],
    ['Cantidad', `${info.sign} ${num(m.qty)} ${esc(m.unit || '')}`],
    ['Ubicación', `${esc(_stockShortLoc(m.base_location) || '—')}${m.area ? ' · ' + esc(m.area) : ''}`],
    ['Motivo / destino', esc(dest)],
  ];
  if (cost > 0) rows.push(['Valor al costo', `$${Math.round(cost).toLocaleString('es-AR')} (costo unit. $${num(m.unit_cost).toLocaleString('es-AR')})`]);
  rows.push(['Registrado por', esc(m.user_name || '—')]);
  rows.push(['Fecha y hora', fechaHora(m.created_at)]);
  const filas = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Comprobante de movimiento — ${esc(m.code || '')}</title>
    <style>
      * { box-sizing:border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color:#1f2937; margin:0; padding:32px; }
      .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #ea580c; padding-bottom:12px; margin-bottom:18px; }
      .brand { font-size:22px; font-weight:800; color:#ea580c; }
      .brand small { display:block; font-size:11px; color:#6b7280; font-weight:400; margin-top:2px; }
      .doc { text-align:right; }
      .doc h1 { font-size:16px; margin:0; letter-spacing:.5px; }
      .doc .qty { color:#ea580c; font-weight:700; font-size:18px; margin-top:4px; }
      .doc .date { color:#6b7280; font-size:11px; margin-top:2px; }
      table { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:14px; }
      th { background:#f3f4f6; text-align:left; padding:9px 10px; width:180px; color:#374151; vertical-align:top; }
      td { padding:9px 10px; border-bottom:1px solid #f0f0f0; vertical-align:top; }
      tr th { border-bottom:1px solid #f0f0f0; }
      .foot { margin-top:28px; color:#6b7280; font-size:10px; text-align:center; border-top:1px solid #e5e7eb; padding-top:8px; }
      @media print { body { padding:12px; } }
    </style></head><body>
    <div class="head">
      <div class="brand">Expreso Biletta<small>Sistema de gestión de flota — FleetOS</small></div>
      <div class="doc">
        <h1>MOVIMIENTO DE STOCK</h1>
        <div class="qty">${info.sign} ${num(m.qty)} ${esc(m.unit || '')}</div>
        <div class="date">Emitido: ${fechaHora(new Date())}</div>
      </div>
    </div>
    <table><tbody>${filas}</tbody></table>
    <div class="foot">Comprobante generado por FleetOS · Expreso Biletta S.R.L. · ${fechaHora(new Date())}</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
  </body></html>`;
}

// Chips compactos con el saldo por ubicación para la columna "Por sucursal/área".
// Muestra solo las ubicaciones CON stock (las que están en 0 son ruido); si no
// hay stock en ningún lado, muestra "sin stock". El nombre largo de la sucursal
// (ej. "Río Tercero (Casa Central)") se abrevia sacando el paréntesis.
function _stockShortLoc(s) {
  return String(s || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim() || String(s || '');
}
function _stockBalChips(a, num, locFilter) {
  let conStock = (a.balances || []).filter((b) => num(b.qty_current) > 0);
  // Con filtro de ubicación activo, mostrar solo los chips que entran en el scope.
  if (typeof locFilter === 'function') conStock = conStock.filter(locFilter);
  conStock = conStock.sort((x, y) => num(y.qty_current) - num(x.qty_current));
  if (!conStock.length) return '<span class="sc-nostock">sin stock</span>';
  const chips = conStock.map((b) => `<span class="sc-chip">
      <span style="color:var(--text3)">${escapeHtml(_stockShortLoc(b.base_location))} · ${escapeHtml(b.area)}</span>
      <b>${num(b.qty_current)}</b>
    </span>`).join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:6px">${chips}</div>`;
}

// Detalle por sucursal/área (saldos + acciones) que se despliega INLINE en la
// fila del artículo, para no tener que entrar a un modal.
function _catDetailHtml(a) {
  const num = (v) => parseFloat(v) || 0;
  const canManage = typeof stockCanManage === 'function' ? stockCanManage() : userHasRole('dueno', 'gerencia', 'jefe_mantenimiento', 'paniol', 'contador', 'gerente_sucursal');
  const canSend = _stockCanSend();
  const balRows = (a.balances || []).length
    ? a.balances.map((b) => `<tr>
        <td>${escapeHtml(b.base_location)}</td><td>${escapeHtml(b.area)}</td>
        <td class="td-mono">${num(b.qty_current)} ${escapeHtml(a.unit)}</td>
        ${canManage ? `<td style="white-space:nowrap">
          <button class="btn btn-secondary btn-sm" onclick="openCatalogMov('${a.id}','Ingreso','${escapeJsArg(b.base_location)}','${escapeJsArg(b.area)}')">+ Ingreso</button>
          <button class="btn btn-secondary btn-sm" onclick="openCatalogMov('${a.id}','Egreso','${escapeJsArg(b.base_location)}','${escapeJsArg(b.area)}')">− Egreso</button>
          <button class="btn btn-secondary btn-sm" onclick="openCatalogMov('${a.id}','Ajuste','${escapeJsArg(b.base_location)}','${escapeJsArg(b.area)}')">± Ajuste</button>
          ${canSend && num(b.qty_current) > 0 ? `<button class="btn btn-secondary btn-sm" onclick="openDispatchModal('${a.id}','${escapeJsArg(b.base_location)}','${escapeJsArg(b.area)}',${num(b.qty_current)})">🚚 Despachar</button>` : ''}
        </td>` : '<td></td>'}</tr>`).join('')
    : '<tr><td colspan="4" style="color:var(--text3);padding:8px">Sin stock en ninguna ubicación.</td></tr>';
  return `<div style="padding:10px 14px;background:var(--bg3);border-radius:var(--radius)">
    <div style="font-size:12px;color:var(--text3);margin-bottom:8px">${escapeHtml(a.category)} · ${escapeHtml(a.unit)} · mín ${num(a.qty_min)} · costo $${num(a.unit_cost).toLocaleString('es-AR')}${a.supplier ? ' · ' + escapeHtml(a.supplier) : ''}</div>
    <table style="width:100%;font-size:13px"><thead><tr><th style="text-align:left">Sucursal</th><th style="text-align:left">Área</th><th style="text-align:left">Stock</th><th></th></tr></thead><tbody>${balRows}</tbody></table>
    ${canManage ? `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-secondary btn-sm" onclick="openCatalogMov('${a.id}','Ingreso','','')">+ Ingreso en otra ubicación</button>
      <button class="btn btn-secondary btn-sm" onclick="openEditCatalogItem('${a.id}')">Editar ficha</button>
    </div>` : ''}
  </div>`;
}

function _toggleCatDetail(id) {
  const el = document.getElementById('cat-detail-' + id);
  // La fila arranca con display:none. Si está oculta la mostramos; si está
  // visible (display === '') la ocultamos. No usar !el.style.display porque
  // '' es falsy y volvería a abrirla en vez de cerrarla.
  if (el) el.style.display = (el.style.display === 'none') ? '' : 'none';
}

function openCatalogMov(id, type, base_location, area) {
  const a = (App.data.stockCatalog || []).find((x) => String(x.id) === String(id));
  if (!a) return;
  const needLoc = !base_location;
  const locHtml = needLoc
    ? (typeof stockLocationControls === 'function' ? stockLocationControls('cm', '', '') : '')
    : `<input type="hidden" id="cm-sucursal" value="${escapeHtml(base_location)}"><input type="hidden" id="cm-area" value="${escapeHtml(area)}"><div style="font-size:12px;color:var(--text3)">Ubicación: <b>${escapeHtml(base_location)} / ${escapeHtml(area)}</b></div>`;
  const isAjuste = type === 'Ajuste';
  openModal(`${type} — ${escapeHtml(a.code)} ${escapeHtml(a.name)}`, `
    ${locHtml}
    <div class="form-group" style="margin-top:10px"><label class="form-label">${isAjuste ? 'Cantidad final (stock real contado)' : 'Cantidad'} *</label>
      <input class="form-input" id="cm-qty" type="number" min="0" step="any" placeholder="0"></div>
    <div class="form-group"><label class="form-label">Motivo / nota</label><input class="form-input" id="cm-reason" placeholder="${isAjuste ? 'Ej: conteo físico' : 'Ej: compra / consumo'}"></div>
    <input type="hidden" id="cm-type" value="${type}">
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveCatalogMov('${a.id}')">Confirmar ${type}</button>
    </div>`);
}

async function saveCatalogMov(id) {
  const type = document.getElementById('cm-type')?.value;
  const qty = parseFloat(document.getElementById('cm-qty')?.value);
  if (!(qty >= 0) || (type !== 'Ajuste' && !(qty > 0))) { showToast('warn', 'Ingresá una cantidad válida'); return; }
  const base_location = document.getElementById('cm-sucursal')?.value || 'Central';
  const area = document.getElementById('cm-area')?.value || 'Depósito';
  const reason = document.getElementById('cm-reason')?.value || '';
  try {
    const res = await apiFetch(`/api/stock/catalog/${id}/mov`, { method: 'POST', body: JSON.stringify({ type, qty, base_location, area, reason }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); showToast('error', e.error || 'Error en el movimiento'); return; }
    closeModal();
    showToast('ok', `${type} registrado`);
    await afterSave({ page: 'stock' });
  } catch (err) { showToast('error', err.message); }
}

function openNewCatalogItem() {
  const cats = [...new Set((App.data.stockCatalog || []).map((a) => a.category).filter(Boolean))].sort();
  const catOpts = cats.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
  openModal('Nuevo artículo', `
    <div class="form-group"><label class="form-label">Nombre *</label><input class="form-input" id="nc-name" placeholder="Ej: Filtro de aceite"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Categoría</label><input class="form-input" id="nc-category" list="nc-cats" value="General"><datalist id="nc-cats">${catOpts}</datalist></div>
      <div class="form-group"><label class="form-label">Unidad</label><input class="form-input" id="nc-unit" value="un"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Stock mínimo</label><input class="form-input" id="nc-min" type="number" min="0" value="0"></div>
      <div class="form-group"><label class="form-label">Punto de pedido</label><input class="form-input" id="nc-reorder" type="number" min="0" value="0"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Costo unitario</label><input class="form-input" id="nc-cost" type="number" min="0" value="0"></div>
      <div class="form-group"><label class="form-label">Proveedor</label><input class="form-input" id="nc-supplier" placeholder="Opcional"></div>
    </div>
    <div style="border-top:1px solid var(--border);margin:12px 0;padding-top:10px;font-size:12px;color:var(--text3)">Stock inicial (opcional)</div>
    ${typeof stockLocationControls === 'function' ? stockLocationControls('nc', '', '') : ''}
    <div class="form-group"><label class="form-label">Cantidad inicial</label><input class="form-input" id="nc-qty" type="number" min="0" value="0"></div>
    <div style="font-size:11px;color:var(--text3)">El código se genera solo según la categoría (ej. FIL-005).</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveNewCatalogItem()">Crear artículo</button>
    </div>`);
}

async function saveNewCatalogItem() {
  const name = (document.getElementById('nc-name')?.value || '').trim();
  if (!name) { showToast('warn', 'El nombre es obligatorio'); return; }
  const payload = {
    name,
    category: (document.getElementById('nc-category')?.value || 'General').trim() || 'General',
    unit: (document.getElementById('nc-unit')?.value || 'un').trim() || 'un',
    qty_min: parseFloat(document.getElementById('nc-min')?.value) || 0,
    qty_reorder: parseFloat(document.getElementById('nc-reorder')?.value) || 0,
    unit_cost: parseFloat(document.getElementById('nc-cost')?.value) || 0,
    supplier: (document.getElementById('nc-supplier')?.value || '').trim() || null,
    qty_current: parseFloat(document.getElementById('nc-qty')?.value) || 0,
    base_location: document.getElementById('nc-sucursal')?.value || 'Central',
    area: document.getElementById('nc-area')?.value || 'Depósito',
  };
  try {
    const res = await apiFetch('/api/stock/catalog', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); showToast('error', e.error || 'Error al crear'); return; }
    const created = await res.json();
    closeModal();
    showToast('ok', `Artículo ${created.code} creado`);
    await afterSave({ page: 'stock' });
  } catch (err) { showToast('error', err.message); }
}

function openEditCatalogItem(id) {
  const a = (App.data.stockCatalog || []).find((x) => String(x.id) === String(id));
  if (!a) return;
  const num = (v) => parseFloat(v) || 0;
  openModal(`Editar ${escapeHtml(a.code)}`, `
    <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="ec-name" value="${escapeHtml(a.name)}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Categoría</label><input class="form-input" id="ec-category" value="${escapeHtml(a.category)}"></div>
      <div class="form-group"><label class="form-label">Unidad</label><input class="form-input" id="ec-unit" value="${escapeHtml(a.unit)}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Stock mínimo</label><input class="form-input" id="ec-min" type="number" min="0" value="${num(a.qty_min)}"></div>
      <div class="form-group"><label class="form-label">Punto de pedido</label><input class="form-input" id="ec-reorder" type="number" min="0" value="${num(a.qty_reorder)}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Costo unitario</label><input class="form-input" id="ec-cost" type="number" min="0" value="${num(a.unit_cost)}"></div>
      <div class="form-group"><label class="form-label">Proveedor</label><input class="form-input" id="ec-supplier" value="${escapeHtml(a.supplier || '')}"></div>
    </div>
    <div style="font-size:11px;color:var(--text3)">El código (${escapeHtml(a.code)}) no se cambia.</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveEditCatalogItem('${a.id}')">Guardar</button>
    </div>`);
}

async function saveEditCatalogItem(id) {
  const payload = {
    name: (document.getElementById('ec-name')?.value || '').trim(),
    category: (document.getElementById('ec-category')?.value || 'General').trim() || 'General',
    unit: (document.getElementById('ec-unit')?.value || 'un').trim() || 'un',
    qty_min: parseFloat(document.getElementById('ec-min')?.value) || 0,
    qty_reorder: parseFloat(document.getElementById('ec-reorder')?.value) || 0,
    unit_cost: parseFloat(document.getElementById('ec-cost')?.value) || 0,
    supplier: (document.getElementById('ec-supplier')?.value || '').trim() || null,
  };
  if (!payload.name) { showToast('warn', 'El nombre es obligatorio'); return; }
  try {
    const res = await apiFetch(`/api/stock/catalog/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); showToast('error', e.error || 'Error'); return; }
    closeModal();
    showToast('ok', 'Artículo actualizado');
    await afterSave({ page: 'stock' });
  } catch (err) { showToast('error', err.message); }
}

// ── Despacho Central → Sucursal con recepción (Fase 3) ──
function _stockCanSend() { return userHasRole('dueno', 'gerencia', 'jefe_mantenimiento', 'paniol', 'gerente_sucursal', 'contador'); }
function _stockCanReceive() { return userHasRole('dueno', 'gerencia', 'gerente_sucursal', 'paniol'); }

function openDispatchModal(catalogId, fromLoc, fromArea, available) {
  const a = (App.data.stockCatalog || []).find((x) => String(x.id) === String(catalogId));
  if (!a) return;
  openModal(`🚚 Despachar — ${escapeHtml(a.code)} ${escapeHtml(a.name)}`, `
    <div style="font-size:12px;color:var(--text3);margin-bottom:10px">Origen: <b>${escapeHtml(fromLoc)} / ${escapeHtml(fromArea)}</b> · Disponible: <b>${available} ${escapeHtml(a.unit)}</b></div>
    <div class="form-group"><label class="form-label">Cantidad a despachar *</label><input class="form-input" id="disp-qty" type="number" min="0" step="any" placeholder="0"></div>
    <div style="font-size:12px;color:var(--text3);margin:8px 0 4px">Destino</div>
    ${typeof stockLocationControls === 'function' ? stockLocationControls('disp-to', '', '') : ''}
    <div class="form-group"><label class="form-label">Nota (opcional)</label><input class="form-input" id="disp-notes" placeholder="Ej: transportado por Juan"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveDispatch('${a.id}','${escapeJsArg(fromLoc)}','${escapeJsArg(fromArea)}')">Despachar</button>
    </div>`);
}

async function saveDispatch(catalogId, fromLoc, fromArea) {
  const qty = parseFloat(document.getElementById('disp-qty')?.value);
  if (!(qty > 0)) { showToast('warn', 'Ingresá la cantidad'); return; }
  const to_location = document.getElementById('disp-to-sucursal')?.value;
  const to_area = document.getElementById('disp-to-area')?.value || 'Depósito';
  if (!to_location) { showToast('warn', 'Elegí la sucursal destino'); return; }
  if (to_location === fromLoc && to_area === fromArea) { showToast('warn', 'El destino debe ser distinto del origen'); return; }
  const notes = document.getElementById('disp-notes')?.value || '';
  try {
    const res = await apiFetch('/api/stock/dispatches', { method: 'POST', body: JSON.stringify({ catalog_id: catalogId, qty, from_location: fromLoc, from_area: fromArea, to_location, to_area, notes }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); showToast('error', e.error || 'Error al despachar'); return; }
    closeModal();
    showToast('ok', 'Despacho creado — en tránsito hacia la sucursal');
    await afterSave({ page: 'stock' });
  } catch (err) { showToast('error', err.message); }
}

// Nuevo despacho "desde arriba": elegir artículo + origen + destino sin entrar a la ficha.
function openDispatchNew() {
  const arts = (App.data.stockCatalog || []).filter((a) => (a.balances || []).some((b) => parseFloat(b.qty_current) > 0));
  if (!arts.length) { showToast('info', 'No hay artículos con stock para despachar'); return; }
  const artOpts = arts.map((a) => `<option value="${a.id}">${escapeHtml(a.code)} — ${escapeHtml(a.name)}</option>`).join('');
  openModal('🚚 Nuevo despacho', `
    <div class="form-group"><label class="form-label">Artículo *</label>
      <select class="form-select" id="dn-article" onchange="_dispatchNewArticleChanged()">${artOpts}</select></div>
    <div class="form-group"><label class="form-label">Origen — de dónde sale *</label>
      <select class="form-select" id="dn-origin"></select></div>
    <div class="form-group"><label class="form-label">Cantidad *</label>
      <input class="form-input" id="dn-qty" type="number" min="0" step="any" placeholder="0"></div>
    <div style="font-size:12px;color:var(--text3);margin:8px 0 4px">Destino</div>
    ${typeof stockLocationControls === 'function' ? stockLocationControls('dn-to', '', '') : ''}
    <div class="form-group"><label class="form-label">Nota (opcional)</label><input class="form-input" id="dn-notes" placeholder="Ej: transportado por Juan"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="_dispatchNewSave()">Despachar</button>
    </div>`);
  setTimeout(_dispatchNewArticleChanged, 30);
}

function _dispatchNewArticleChanged() {
  const id = document.getElementById('dn-article')?.value;
  const a = (App.data.stockCatalog || []).find((x) => String(x.id) === String(id));
  const sel = document.getElementById('dn-origin');
  if (!a || !sel) return;
  const bals = (a.balances || []).filter((b) => parseFloat(b.qty_current) > 0);
  window._dnBalances = bals;
  sel.innerHTML = bals.length
    ? bals.map((b, i) => `<option value="${i}">${escapeHtml(b.base_location)} / ${escapeHtml(b.area)} — ${parseFloat(b.qty_current)} ${escapeHtml(a.unit || 'un')}</option>`).join('')
    : '<option value="">Sin stock en ninguna ubicación</option>';
}

async function _dispatchNewSave() {
  const id = document.getElementById('dn-article')?.value;
  if (!id) { showToast('warn', 'Elegí un artículo'); return; }
  const b = (window._dnBalances || [])[parseInt(document.getElementById('dn-origin')?.value, 10)];
  if (!b) { showToast('warn', 'Elegí el origen'); return; }
  const qty = parseFloat(document.getElementById('dn-qty')?.value);
  if (!(qty > 0)) { showToast('warn', 'Ingresá la cantidad'); return; }
  const to_location = document.getElementById('dn-to-sucursal')?.value;
  const to_area = document.getElementById('dn-to-area')?.value || 'Depósito';
  if (!to_location) { showToast('warn', 'Elegí la sucursal destino'); return; }
  if (to_location === b.base_location && to_area === b.area) { showToast('warn', 'El destino debe ser distinto del origen'); return; }
  const notes = document.getElementById('dn-notes')?.value || '';
  try {
    const res = await apiFetch('/api/stock/dispatches', { method: 'POST', body: JSON.stringify({ catalog_id: id, qty, from_location: b.base_location, from_area: b.area, to_location, to_area, notes }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); showToast('error', e.error || 'Error al despachar'); return; }
    closeModal();
    showToast('ok', 'Despacho creado — en tránsito hacia la sucursal');
    await afterSave({ page: 'stock' });
  } catch (err) { showToast('error', err.message); }
}

async function receiveDispatch(id, qtySent) {
  const v = prompt(`Cantidad recibida (enviado: ${qtySent}). Dejá el mismo número si llegó todo:`, qtySent);
  if (v === null) return;
  const qty_received = parseFloat(v);
  if (!(qty_received >= 0)) { showToast('warn', 'Cantidad inválida'); return; }
  try {
    const res = await apiFetch(`/api/stock/dispatches/${id}/recibir`, { method: 'POST', body: JSON.stringify({ qty_received }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); showToast('error', e.error || 'Error al recibir'); return; }
    closeModal();
    showToast('ok', 'Recepción confirmada — stock sumado a la sucursal');
    await afterSave({ page: 'stock' });
  } catch (err) { showToast('error', err.message); }
}

async function cancelDispatch(id) {
  if (!confirm('¿Cancelar el despacho y devolver el stock al origen?')) return;
  try {
    const res = await apiFetch(`/api/stock/dispatches/${id}/cancelar`, { method: 'POST', body: JSON.stringify({}) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); showToast('error', e.error || 'Error al cancelar'); return; }
    closeModal();
    showToast('ok', 'Despacho cancelado — stock devuelto al origen');
    await afterSave({ page: 'stock' });
  } catch (err) { showToast('error', err.message); }
}

// Puente con el mundo legacy (dispatcher renderPage + onclick).
expose('renderStock', renderStock);
expose('_renderStockCatalog', _renderStockCatalog);
expose('_stockInlinePanels', _stockInlinePanels);
expose('_renderDispatchesInline', _renderDispatchesInline);
expose('_renderMovementsInline', _renderMovementsInline);
expose('_renderMovementsSection', _renderMovementsSection);
expose('cargarMasStockMov', cargarMasStockMov);
expose('openMovementDetail', openMovementDetail);
expose('printStockMovement', printStockMovement);
expose('openDispatchDetail', openDispatchDetail);
expose('printDispatch', printDispatch);
expose('_stockShortLoc', _stockShortLoc);
expose('_stockBalChips', _stockBalChips);
expose('_catDetailHtml', _catDetailHtml);
expose('_toggleCatDetail', _toggleCatDetail);
expose('openCatalogMov', openCatalogMov);
expose('saveCatalogMov', saveCatalogMov);
expose('openNewCatalogItem', openNewCatalogItem);
expose('saveNewCatalogItem', saveNewCatalogItem);
expose('openEditCatalogItem', openEditCatalogItem);
expose('saveEditCatalogItem', saveEditCatalogItem);
expose('_stockCanSend', _stockCanSend);
expose('_stockCanReceive', _stockCanReceive);
expose('openDispatchModal', openDispatchModal);
expose('saveDispatch', saveDispatch);
expose('openDispatchNew', openDispatchNew);
expose('_dispatchNewArticleChanged', _dispatchNewArticleChanged);
expose('_dispatchNewSave', _dispatchNewSave);
expose('receiveDispatch', receiveDispatch);
expose('cancelDispatch', cancelDispatch);
