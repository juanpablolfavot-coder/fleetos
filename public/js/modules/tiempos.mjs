// ════════════════════════════════════════════════════════════════════
//  TIEMPOS DE RESPUESTA (ES module) — cuánto tarda cada área desde que
//  se abre algo hasta que se termina, contra plazos objetivo configurables.
//
//  Datos: GET /api/tiempos?from&to (ver routes/tiempos.js). Plazos: se editan
//  en Configuración → "Plazos objetivo" (app_config.sla_plazos).
// ════════════════════════════════════════════════════════════════════
import { need, expose } from './dom.mjs';

const App = need('App');
const apiFetch = need('apiFetch');
const escapeHtml = need('escapeHtml');

let _data = null;
let _tab = 'resumen';
let _rango = '90';   // '30' | '90' | '365' | 'custom'

const AR = 'America/Argentina/Buenos_Aires';
const fecha = d => d ? new Date(d).toLocaleDateString('es-AR', { timeZone: AR, day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
const fechaHora = d => d ? new Date(d).toLocaleString('es-AR', { timeZone: AR, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const ymd = d => d.toLocaleDateString('sv-SE', { timeZone: AR });

// "2.5" → "2,5 d" · < 1 día → horas
function dur(d) {
  if (d === null || d === undefined || !Number.isFinite(d)) return '—';
  if (d < 1) return Math.round(d * 24) + ' h';
  return d.toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' d';
}

// Semáforo por % cumplido: ≥85 verde, ≥60 amarillo, resto rojo.
function semaforo(pct) {
  if (pct === null || pct === undefined) return { cls: 'badge-gray', txt: 'sin plazo' };
  if (pct >= 85) return { cls: 'badge-ok', txt: pct + '% en plazo' };
  if (pct >= 60) return { cls: 'badge-warn', txt: pct + '% en plazo' };
  return { cls: 'badge-danger', txt: pct + '% en plazo' };
}
// Color de un promedio contra su plazo.
function colorProm(prom, plazo) {
  if (prom === null || !plazo) return 'var(--text)';
  return prom <= plazo ? 'var(--ok)' : prom <= plazo * 1.5 ? 'var(--warn)' : 'var(--danger)';
}

function _fechasRango() {
  const to = ymd(new Date());
  if (_rango === 'custom') {
    return { from: document.getElementById('tr-from')?.value || to, to: document.getElementById('tr-to')?.value || to };
  }
  const from = ymd(new Date(Date.now() - parseInt(_rango, 10) * 86400000));
  return { from, to };
}

async function renderTiemposPanel() {
  const root = document.getElementById('page-tiempos_panel');
  if (!root) return;
  root.innerHTML = `
    <div class="section-header" style="margin-bottom:16px">
      <div>
        <div class="section-title">⏱ Tiempos de respuesta por área</div>
        <div class="section-sub">Cuánto tarda cada área desde que se abre algo hasta que se termina · contra plazos objetivo</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select class="form-select" id="tr-rango" onchange="tiemposCambiarRango(this.value)" style="width:auto">
          <option value="30" ${_rango === '30' ? 'selected' : ''}>Últimos 30 días</option>
          <option value="90" ${_rango === '90' ? 'selected' : ''}>Últimos 90 días</option>
          <option value="365" ${_rango === '365' ? 'selected' : ''}>Último año</option>
          <option value="custom" ${_rango === 'custom' ? 'selected' : ''}>Elegir fechas…</option>
        </select>
        <span id="tr-custom" style="display:${_rango === 'custom' ? 'flex' : 'none'};gap:6px;align-items:center">
          <input class="form-input" type="date" id="tr-from" style="width:auto"> <span style="color:var(--text3)">a</span>
          <input class="form-input" type="date" id="tr-to" style="width:auto">
          <button class="btn btn-secondary btn-sm" onclick="tiemposCargar()">Aplicar</button>
        </span>
        <button class="btn btn-secondary btn-sm" onclick="tiemposCargar()">↻ Actualizar</button>
        ${(App.currentUser?.role === 'dueno' || App.currentUser?.role === 'gerencia') ? `<button class="btn btn-secondary btn-sm" onclick="navigate('config')" title="Cambiar los días objetivo por etapa">⚙ Plazos objetivo</button>` : ''}
      </div>
    </div>
    <div id="tiempos-tabs" style="display:flex;flex-wrap:wrap;gap:4px 2px;margin-bottom:16px;border-bottom:1px solid var(--border2)">
      ${[['resumen', '📊 Resumen'], ['oc', '🛒 Órdenes de compra'], ['ot', '🔧 Taller (OT)'], ['cadena', '🔗 OT con compra: cadena completa'], ['pendientes', '⏳ Pendiente ahora'], ['otros', '⛽ Combustible y despachos']]
        .map(([id, label]) => `<button id="ttab-${id}" onclick="tiemposTab('${id}')" style="padding:8px 14px;border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:var(--text3);border-bottom:2px solid transparent;white-space:nowrap">${label}</button>`).join('')}
    </div>
    <div id="tiempos-content"><div style="text-align:center;padding:40px;color:var(--text3)">⏳ Calculando tiempos…</div></div>`;
  await tiemposCargar();
}

function tiemposCambiarRango(v) {
  _rango = v;
  const c = document.getElementById('tr-custom');
  if (c) c.style.display = v === 'custom' ? 'flex' : 'none';
  if (v !== 'custom') tiemposCargar();
}

async function tiemposCargar() {
  const content = document.getElementById('tiempos-content');
  if (!content) return;
  const { from, to } = _fechasRango();
  content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)">⏳ Calculando tiempos…</div>`;
  const res = await apiFetch(`/api/tiempos?from=${from}&to=${to}`);
  if (!res.ok) {
    let e = {}; try { e = await res.json(); } catch (_) {}
    content.innerHTML = `<div class="card" style="color:var(--danger)">No se pudieron calcular los tiempos de respuesta.${e.detail ? `<div style="font-size:11px;color:var(--text3);margin-top:6px;font-family:var(--mono)">${escapeHtml(e.detail)}</div>` : ''}</div>`;
    return;
  }
  _data = await res.json();
  tiemposTab(_tab);
}

function tiemposTab(tab) {
  _tab = tab;
  document.querySelectorAll('[id^="ttab-"]').forEach(b => { b.style.color = 'var(--text3)'; b.style.borderBottom = '2px solid transparent'; });
  const b = document.getElementById('ttab-' + tab);
  if (b) { b.style.color = 'var(--accent)'; b.style.borderBottom = '2px solid var(--accent)'; }
  const el = document.getElementById('tiempos-content');
  if (!el || !_data) return;
  const fns = { resumen: _resumen, oc: _oc, ot: _ot, cadena: _cadena, pendientes: _pendientes, otros: _otros };
  el.innerHTML = (fns[tab] || _resumen)(_data);
  _labels(el);
}

// Tabla de etapas: Etapa | Área | Plazo | Cant. | Promedio | Mediana | Máximo | En plazo
function _tablaEtapas(etapas) {
  return `<div class="table-wrap"><table>
    <thead><tr><th>Etapa</th><th>Área responsable</th><th>Plazo</th><th>Cant.</th><th>Promedio</th><th>Mediana</th><th>Máximo</th><th>Cumplimiento</th></tr></thead>
    <tbody>${etapas.map(e => { const s = semaforo(e.cumple_pct); return `<tr>
      <td><b>${escapeHtml(e.label)}</b></td>
      <td>${escapeHtml(e.area)}</td>
      <td class="td-mono">${e.plazo ? e.plazo + ' d' : '—'}</td>
      <td class="td-mono">${e.n}</td>
      <td class="td-mono" style="font-weight:700;color:${colorProm(e.prom, e.plazo)}">${dur(e.prom)}</td>
      <td class="td-mono">${dur(e.mediana)}</td>
      <td class="td-mono">${dur(e.max)}</td>
      <td>${e.n ? `<span class="badge ${s.cls}">${s.txt}</span>` : '<span style="color:var(--text3)">sin datos</span>'}</td>
    </tr>`; }).join('')}</tbody></table></div>`;
}

// Tabla por grupo (mecánico, área solicitante, sucursal…)
function _tablaGrupos(titulo, filas, colGrupo) {
  if (!filas.length) return '';
  return `<div class="card" style="margin-top:16px"><div class="card-title">${titulo}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>${colGrupo}</th><th>Cant.</th><th>Promedio</th><th>Mediana</th><th>Máximo</th><th>Cumplimiento</th></tr></thead>
      <tbody>${filas.map(f => { const s = semaforo(f.cumple_pct); return `<tr>
        <td><b>${escapeHtml(f.grupo)}</b></td><td class="td-mono">${f.n}</td>
        <td class="td-mono" style="font-weight:700;color:${colorProm(f.prom, f.plazo)}">${dur(f.prom)}</td>
        <td class="td-mono">${dur(f.mediana)}</td><td class="td-mono">${dur(f.max)}</td>
        <td><span class="badge ${s.cls}">${s.txt}</span></td></tr>`; }).join('')}</tbody></table></div></div>`;
}

// Barras mensuales simples (sin librería): promedio por mes contra el plazo.
function _mensual(titulo, serie, plazo) {
  if (!serie.length) return '';
  const max = Math.max(plazo || 0, ...serie.map(s => s.prom || 0)) || 1;
  return `<div class="card" style="margin-top:16px"><div class="card-title">${titulo}</div>
    <div style="display:flex;align-items:flex-end;gap:10px;height:140px;padding:8px 4px 0;border-bottom:1px solid var(--border);position:relative">
      ${plazo ? `<div style="position:absolute;left:0;right:0;bottom:${Math.round(plazo / max * 120)}px;border-top:1px dashed var(--warn);font-size:10px;color:var(--warn);text-align:right;padding-right:4px">plazo ${plazo} d</div>` : ''}
      ${serie.map(s => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:36px">
        <div style="font-size:11px;font-family:var(--mono);color:${colorProm(s.prom, plazo)}">${dur(s.prom)}</div>
        <div style="width:70%;height:${Math.max(3, Math.round((s.prom || 0) / max * 120))}px;background:${colorProm(s.prom, plazo)};border-radius:4px 4px 0 0;opacity:.85" title="${s.n} en ${s.mes}"></div>
      </div>`).join('')}
    </div>
    <div style="display:flex;gap:10px;padding-top:6px">${serie.map(s => `<div style="flex:1;text-align:center;font-size:10px;color:var(--text3);font-family:var(--mono);min-width:36px">${s.mes.slice(5)}/${s.mes.slice(2, 4)}<br>${s.n}</div>`).join('')}</div>
  </div>`;
}

function _kpi(label, value, sub, cls) {
  return `<div class="kpi-card ${cls || 'info'}"><div class="kpi-label">${label}</div><div class="kpi-value ${cls || ''}">${value}</div><div class="kpi-trend">${sub || ''}</div></div>`;
}

// ── Tabs ─────────────────────────────────────────────────────────────
function _resumen(d) {
  const ocT = d.oc.etapas.find(e => e.key === 'total');
  const otT = d.ot.etapas.find(e => e.key === 'total');
  const vencidas = d.oc.vencidas + d.ot.vencidas + d.combustible.vencidas + d.despachos.vencidas;
  const kpiCls = (prom, plazo) => prom === null ? 'info' : prom <= plazo ? 'ok' : prom <= plazo * 1.5 ? 'warn' : 'danger';
  const resumenEtapas = [
    ...d.oc.etapas.filter(e => e.key !== 'total').map(e => ({ ...e, proceso: 'Órdenes de compra' })),
    ...d.ot.etapas.filter(e => e.key !== 'total' && e.key !== 'repuestos').map(e => ({ ...e, proceso: 'Taller' })),
    { ...d.combustible.etapa, proceso: 'Combustible' },
    { ...d.despachos.etapa, proceso: 'Despachos' },
  ];
  return `
    <div class="kpi-row" style="margin-bottom:16px">
      ${_kpi('OC: pedido → recibida', dur(ocT.prom), `${ocT.n} órdenes · plazo ${ocT.plazo} d`, kpiCls(ocT.prom, ocT.plazo))}
      ${_kpi('OT: abierta → cerrada', dur(otT.prom), `${otT.n} órdenes · plazo ${otT.plazo} d`, kpiCls(otT.prom, otT.plazo))}
      ${_kpi('Pendiente ahora', d.oc.abiertas.length + d.ot.abiertas.length + d.combustible.pendientes.length + d.despachos.pendientes.length, `${d.oc.abiertas.length} OC · ${d.ot.abiertas.length} OT · ${d.combustible.pendientes.length} tickets · ${d.despachos.pendientes.length} despachos`, 'info')}
      ${_kpi('Fuera de plazo', vencidas, vencidas ? 'ver pestaña "Pendiente ahora"' : 'todo dentro del plazo', vencidas ? 'danger' : 'ok')}
    </div>
    <div class="card"><div class="card-title">Semáforo por área y etapa · ${fecha(d.from)} a ${fecha(d.to)}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Proceso</th><th>Etapa</th><th>Área responsable</th><th>Plazo</th><th>Cant.</th><th>Promedio</th><th>Cumplimiento</th></tr></thead>
        <tbody>${resumenEtapas.map(e => { const s = semaforo(e.cumple_pct); return `<tr>
          <td>${e.proceso}</td><td><b>${escapeHtml(e.label)}</b></td><td>${escapeHtml(e.area)}</td>
          <td class="td-mono">${e.plazo ? e.plazo + ' d' : '—'}</td><td class="td-mono">${e.n}</td>
          <td class="td-mono" style="font-weight:700;color:${colorProm(e.prom, e.plazo)}">${dur(e.prom)}</td>
          <td>${e.n ? `<span class="badge ${s.cls}">${s.txt}</span>` : '<span style="color:var(--text3)">sin datos</span>'}</td></tr>`; }).join('')}
        </tbody></table></div>
      <div style="font-size:11px;color:var(--text3);margin-top:10px">Promedio en días corridos desde que empieza la etapa hasta que termina. "Cumplimiento" = % de casos que terminaron dentro del plazo objetivo. Los plazos se cambian en Configuración.</div>
    </div>`;
}

function _oc(d) {
  const t = d.oc.etapas.find(e => e.key === 'total');
  return `
    <div class="card"><div class="card-title">Órdenes de compra · por etapa y área responsable</div>${_tablaEtapas(d.oc.etapas)}</div>
    ${_mensual('Evolución mensual · pedido → recibida (promedio)', d.oc.mensual, t.plazo)}
    ${_tablaGrupos('Por área solicitante (pedido → recibida)', d.oc.por_area_solicitante, 'Área que pidió')}
    ${_tablaGrupos('Por sucursal (pedido → recibida)', d.oc.por_sucursal, 'Sucursal')}`;
}

function _ot(d) {
  const t = d.ot.etapas.find(e => e.key === 'total');
  return `
    <div class="card"><div class="card-title">Órdenes de trabajo · por etapa</div>${_tablaEtapas(d.ot.etapas)}
      <div style="font-size:11px;color:var(--text3);margin-top:10px">"Abierta → En proceso" solo tiene datos desde que el sistema empezó a guardar el inicio (OT nuevas). "OC pedida → OC recibida" mide cuánto esperó el taller por repuestos/servicios externos.</div>
    </div>
    ${_mensual('Evolución mensual · abierta → cerrada (promedio)', d.ot.mensual, t.plazo)}
    ${_tablaGrupos('Por mecánico (abierta → cerrada)', d.ot.por_mecanico, 'Mecánico')}
    ${_tablaGrupos('Por tipo', d.ot.por_tipo, 'Tipo')}
    ${_tablaGrupos('Por prioridad', d.ot.por_prioridad, 'Prioridad')}`;
}

function _cadena(d) {
  if (!d.ot.cadena.length) return `<div class="card" style="color:var(--text3)">No hay órdenes de trabajo con orden de compra asociada en el período.</div>`;
  const hitos = d.ot.cadena[0].hitos.map(h => h.label);
  return `<div class="card"><div class="card-title">OT con compra · días acumulados desde que se abrió la OT hasta cada hito</div>
    <div class="table-wrap"><table>
      <thead><tr><th>OT</th><th>Unidad</th>${hitos.slice(1).map(h => `<th>${h}</th>`).join('')}<th>Total</th></tr></thead>
      <tbody>${d.ot.cadena.map(c => `<tr>
        <td><b>${escapeHtml(c.code)}</b><br><span style="font-size:10px;color:var(--text3)">${fecha(c.opened_at)} · ${escapeHtml(c.po_code)}</span></td>
        <td>${escapeHtml(c.vehicle_code || '—')}</td>
        ${c.hitos.slice(1).map(h => `<td class="td-mono" title="${fechaHora(h.at)}">${h.at ? '+' + dur(h.dias) : '<span style="color:var(--text3)">—</span>'}</td>`).join('')}
        <td class="td-mono" style="font-weight:700;color:${colorProm(c.total, d.plazos.ot_total)}">${dur(c.total)}${c.status !== 'Cerrada' ? ' <span class="badge badge-warn" style="font-size:9px">abierta</span>' : ''}</td>
      </tr>`).join('')}</tbody></table></div>
    <div style="font-size:11px;color:var(--text3);margin-top:10px">Cada columna es el tiempo acumulado desde la apertura de la OT. La diferencia entre dos columnas es lo que tardó esa área. "—" = ese paso todavía no ocurrió (o no aplica).</div>
  </div>`;
}

function _pendientes(d) {
  const fila = (cols, vencida) => `<tr style="${vencida ? 'background:var(--danger-bg)' : ''}">${cols}</tr>`;
  const badgeDias = (dias, plazo, vencida) => `<span class="badge ${vencida ? 'badge-danger' : dias > plazo * 0.7 ? 'badge-warn' : 'badge-ok'}">${dur(dias)}${plazo ? ' / ' + plazo + ' d' : ''}</span>`;
  const oc = d.oc.abiertas, ot = d.ot.abiertas, fu = d.combustible.pendientes, de = d.despachos.pendientes;
  return `
    <div class="card"><div class="card-title">🛒 Órdenes de compra abiertas (${oc.length}) · ${d.oc.vencidas} fuera de plazo</div>
      ${oc.length ? `<div class="table-wrap"><table><thead><tr><th>OC</th><th>Etapa actual</th><th>Área que la tiene</th><th>En esta etapa</th><th>Total abierta</th><th>Pidió</th><th>Proveedor</th></tr></thead>
      <tbody>${oc.map(o => fila(`<td><b>${escapeHtml(o.code)}</b>${o.ot_code ? `<br><span style="font-size:10px;color:var(--text3)">${escapeHtml(o.ot_code)}</span>` : ''}</td>
        <td>${escapeHtml(o.etapa)}</td><td>${escapeHtml(o.area)}</td>
        <td>${badgeDias(o.dias_en_etapa, o.plazo, o.vencida)}</td><td class="td-mono">${dur(o.dias_total)}</td>
        <td>${escapeHtml(o.solicitante || '—')}<br><span style="font-size:10px;color:var(--text3)">${escapeHtml(o.area_solicitante || '')} ${escapeHtml(o.sucursal || '')}</span></td>
        <td>${escapeHtml(o.proveedor || '—')}</td>`, o.vencida)).join('')}</tbody></table></div>` : '<div style="color:var(--text3);font-size:12px">Nada pendiente.</div>'}
    </div>
    <div class="card" style="margin-top:16px"><div class="card-title">🔧 Órdenes de trabajo abiertas (${ot.length}) · ${d.ot.vencidas} fuera de plazo</div>
      ${ot.length ? `<div class="table-wrap"><table><thead><tr><th>OT</th><th>Unidad</th><th>Etapa actual</th><th>Área</th><th>En esta etapa</th><th>Total abierta</th><th>Mecánico</th><th>Prioridad</th></tr></thead>
      <tbody>${ot.map(o => fila(`<td><b>${escapeHtml(o.code)}</b><br><span style="font-size:10px;color:var(--text3)">${escapeHtml((o.title || '').slice(0, 40))}</span></td>
        <td>${escapeHtml(o.vehicle_code || '—')}</td><td>${escapeHtml(o.etapa)}</td><td>${escapeHtml(o.area)}</td>
        <td>${badgeDias(o.dias_en_etapa, o.plazo, o.vencida)}</td><td class="td-mono">${dur(o.dias_total)}</td>
        <td>${escapeHtml(o.mecanico || '—')}</td><td>${escapeHtml(o.priority || '—')}</td>`, o.vencida)).join('')}</tbody></table></div>` : '<div style="color:var(--text3);font-size:12px">Nada pendiente.</div>'}
    </div>
    <div class="card" style="margin-top:16px"><div class="card-title">⛽ Tickets de combustible sin verificar (${fu.length}) · ${d.combustible.vencidas} fuera de plazo</div>
      ${fu.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Unidad</th><th>Chofer</th><th>Litros</th><th>Esperando</th></tr></thead>
      <tbody>${fu.map(f => fila(`<td>${fechaHora(f.logged_at)}</td><td>${escapeHtml(f.vehicle_code)}</td><td>${escapeHtml(f.driver || '—')}</td><td class="td-mono">${Math.round(f.liters)} L</td><td>${badgeDias(f.dias_en_etapa, f.plazo, f.vencida)}</td>`, f.vencida)).join('')}</tbody></table></div>` : '<div style="color:var(--text3);font-size:12px">Nada pendiente.</div>'}
    </div>
    <div class="card" style="margin-top:16px"><div class="card-title">🚚 Despachos sin confirmar recepción (${de.length}) · ${d.despachos.vencidas} fuera de plazo</div>
      ${de.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Destino</th><th>Litros</th><th>Esperando</th></tr></thead>
      <tbody>${de.map(x => fila(`<td>${fechaHora(x.created_at)}</td><td>${escapeHtml(x.destination)}</td><td class="td-mono">${Math.round(x.liters)} L</td><td>${badgeDias(x.dias_en_etapa, x.plazo, x.vencida)}</td>`, x.vencida)).join('')}</tbody></table></div>` : '<div style="color:var(--text3);font-size:12px">Nada pendiente.</div>'}
    </div>`;
}

function _otros(d) {
  return `
    <div class="card"><div class="card-title">⛽ Verificación de tickets de combustible</div>${_tablaEtapas([d.combustible.etapa])}
      <div style="font-size:11px;color:var(--text3);margin-top:10px">Desde que el chofer registra la carga con foto hasta que alguien aprueba u observa el ticket.</div></div>
    <div class="card" style="margin-top:16px"><div class="card-title">🚚 Despachos internos de combustible</div>${_tablaEtapas([d.despachos.etapa])}
      <div style="font-size:11px;color:var(--text3);margin-top:10px">Desde que sale de la cisterna hasta que la sucursal confirma la recepción.</div></div>`;
}

// Para el celular: etiqueta de columna en cada celda (misma técnica que el auditor).
function _labels(root) {
  root.querySelectorAll('table').forEach(table => {
    const heads = [...table.querySelectorAll('thead th')].map(th => (th.textContent || '').trim());
    table.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (heads[i]) td.setAttribute('data-label', heads[i]); }));
  });
}

expose('renderTiemposPanel', renderTiemposPanel);
expose('tiemposCargar', tiemposCargar);
expose('tiemposTab', tiemposTab);
expose('tiemposCambiarRango', tiemposCambiarRango);
