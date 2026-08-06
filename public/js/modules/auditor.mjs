// ════════════════════════════════════════════════════════════════════
//  PANEL DEL AUDITOR (ES module, Fase 3) — solo lectura, tabs, gráficos
//  (Chart.js) y asistente IA. Migrado de auditor.js.
//
//  Chart viene de CDN: NO se declara con need() (si el CDN falla no debe
//  tumbar el boot); se referencia como global lazy (resuelve a window.Chart)
//  y su uso ya está protegido con try/catch.
// ════════════════════════════════════════════════════════════════════
import { need, expose } from './dom.mjs';

const App = need('App');
const apiFetch = need('apiFetch');
const escapeHtml = need('escapeHtml');
const openModal = need('openModal');
const closeModal = need('closeModal');

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
    <div id="auditor-tabs" style="display:flex;flex-wrap:wrap;gap:4px 2px;margin-bottom:20px;border-bottom:1px solid var(--border2);padding-bottom:0">
      ${[
        ['resumen',    '📊 Resumen'],
        ['visual',     '📈 Indicadores visuales'],
        ['combustible','⛽ Anomalías combustible'],
        ['ots',        '🔧 Anomalías OTs'],
        ['trazabilidad','📋 Trazabilidad'],
        ['comparativo','📈 Comparativo mensual'],
        ['eficiencia', '⚡ Rendimiento por unidad'],
        ['historial',  '🧾 Cargas por unidad'],
        ['excesos',    '🚨 Excesos de velocidad'],
        ['ralenti',    '🕒 Ralentí'],
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
    if (tab === 'eficiencia')   await renderAuditorEficiencia(content);
    if (tab === 'historial')    await renderAuditorHistorial(content);
    if (tab === 'excesos')      await renderAuditorExcesos(content);
    if (tab === 'ralenti')      await renderAuditorRalenti(content);
    if (tab === 'log')          await renderAuditorLog(content);
    _applyTableLabels(content);
  } catch(e) {
    content.innerHTML = `<div class="card" style="color:var(--danger);padding:24px">Error: ${e.message}</div>`;
  }
}

// Para el celular: copia el título de cada columna a un data-label en cada celda,
// así el CSS puede mostrar las tablas como tarjetas (etiqueta: valor) sin scroll
// horizontal. Se llama cada vez que se (re)dibuja una tabla del auditor.
function _applyTableLabels(root) {
  if (!root) return;
  root.querySelectorAll('table').forEach(table => {
    const heads = [...table.querySelectorAll('thead th')].map(th => (th.textContent || '').replace(/[▲▼]/g, '').trim());
    if (!heads.length) return;
    table.querySelectorAll('tbody tr').forEach(tr => {
      [...tr.children].forEach((td, i) => { if (heads[i]) td.setAttribute('data-label', heads[i]); });
    });
  });
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
        <div class="kpi-value white">$${(parseFloat(d.combustible.costo)+parseFloat(d.ordenes.mano_obra)+parseFloat(d.ordenes.repuestos)).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        <div class="kpi-trend">combustible + mantenimiento</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(59,130,246,.4)">
        <div class="kpi-label">⛽ Combustible</div>
        <div class="kpi-value" style="color:#3b82f6">$${(parseFloat(d.combustible.costo)).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        <div class="kpi-trend">${Math.round(parseFloat(d.combustible.litros)).toLocaleString()} L · ${d.combustible.cargas} cargas · ${d.combustible.sin_ticket} sin ticket</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(245,158,11,.4)">
        <div class="kpi-label">🔧 Mantenimiento</div>
        <div class="kpi-value" style="color:#f59e0b">$${(parseFloat(d.ordenes.mano_obra)+parseFloat(d.ordenes.repuestos)).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
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
    </div>
    ${(() => {
      const c = d.compras || {};
      const fmtAr = n => '$' + (Number(n)||0).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
      const deudaColor = (c.deuda_vencida||0) > 0 ? 'danger' : (c.deuda_total||0) > 0 ? 'warn' : 'ok';
      return `
      <div style="margin-top:22px;font-size:13px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">🛒 Compras y pagos</div>
      <div class="kpi-row">
        <div class="kpi-card" style="border-color:rgba(99,102,241,.4)">
          <div class="kpi-label">🛒 Compras del mes</div>
          <div class="kpi-value white">${c.ocs_total||0}</div>
          <div class="kpi-trend">${c.ocs_pendientes||0} pend. · ${c.ocs_aprobadas||0} aprob. · ${c.ocs_recibidas||0} recibidas</div>
        </div>
        <div class="kpi-card" style="border-color:rgba(6,182,212,.4)">
          <div class="kpi-label">🧾 Facturado (mes, c/IVA)</div>
          <div class="kpi-value" style="color:#06b6d4">${fmtAr(c.facturado_mes)}</div>
          <div class="kpi-trend">${c.facturas_mes||0} facturas cargadas</div>
        </div>
        <div class="kpi-card ok">
          <div class="kpi-label">✅ Pagado en el mes</div>
          <div class="kpi-value ok">${fmtAr(c.pagado_mes)}</div>
          <div class="kpi-trend">${c.pagos_mes||0} pagos registrados</div>
        </div>
        <div class="kpi-card ${deudaColor}">
          <div class="kpi-label">📌 Deuda pendiente</div>
          <div class="kpi-value ${deudaColor}">${fmtAr(c.deuda_total)}</div>
          <div class="kpi-trend">${(c.deuda_vencida||0)>0 ? '⚠ '+fmtAr(c.deuda_vencida)+' vencido ('+(c.facturas_vencidas||0)+')' : 'sin deuda vencida'}${(c.deuda_por_vencer||0)>0 ? ' · '+fmtAr(c.deuda_por_vencer)+' por vencer' : ''}</div>
        </div>
      </div>
      ${(() => {
        const cats = (c.por_categoria || []);
        if (!cats.length) return '';
        const totalCat = cats.reduce((s,x)=>s+(x.monto||0),0);
        return `
          <div style="margin-top:18px;font-size:13px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">📦 Compras del mes por categoría</div>
          <div class="card" style="padding:0"><div class="table-wrap"><table>
            <thead><tr><th>Categoría</th><th style="text-align:center">OCs</th><th style="text-align:right">Monto</th><th style="text-align:right">% del total</th></tr></thead>
            <tbody>${cats.map(x => {
              const pct = totalCat>0 ? (x.monto/totalCat*100) : 0;
              return '<tr><td>'+(x.categoria||'—')+'</td><td class="td-mono" style="text-align:center">'+x.ocs+'</td><td class="td-mono" style="text-align:right">'+fmtAr(x.monto)+'</td><td class="td-mono" style="text-align:right;color:var(--text3)">'+pct.toFixed(1)+'%</td></tr>';
            }).join('')}</tbody>
          </table></div></div>
          <div style="font-size:11px;color:var(--text3);margin-top:6px">El monto sale de los artículos cotizados de cada OC. Los ítems de texto libre (sin vínculo al stock) aparecen como "Sin categoría".</div>`;
      })()}`;
    })()}`;
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
            ${App.data.vehicles.map(v=>`<option value="${escapeHtml(v.code)}">${escapeHtml(v.code)} · ${escapeHtml(v.plate||'—')}</option>`).join('')}
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
            <div style="font-size:11px;font-family:var(--mono);color:var(--text);padding-right:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(v.code)} · ${escapeHtml(v.plate)} · ${v.total} eventos en el mes">${escapeHtml(v.code)}</div>
            ${Array.from({length:dias}, (_,i) => {
              const dia = i+1;
              const n = v.dias[dia] || 0;
              return `<div title="${escapeHtml(v.code)} · día ${dia}: ${n} evento${n===1?'':'s'}"
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
        <span style="color:var(--text3);margin-left:12px">Total 6 meses: <strong style="color:var(--text);font-family:var(--mono)">$${(totalGeneral).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></span>
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

  // Encabezados legibles y formato por tipo de dato. Sin esto la tabla salía con
  // los nombres crudos de la base ("km_del_tramo", "logged_at") y las fechas con
  // microsegundos, que es la mitad de por qué el panel se leía como un revoltijo.
  const ROTULO = {
    fecha:'Fecha', unidad:'Unidad', chofer:'Chofer', litros:'Litros', precio:'Precio/L',
    lugar:'Lugar', km_del_tramo:'Km del tramo', rinde:'Rindió', lo_normal_suyo:'Lo normal suyo',
    litros_de_mas:'Litros de más', km_esperado:'Km esperado',
    desvio:'Desvío', que_mirar:'Qué mirar', primera:'Primera', segunda:'Segunda',
    litros_1:'Litros 1ª', litros_2:'Litros 2ª', minutos_entre:'Minutos entre',
  };
  const esFecha = k => ['fecha','primera','segunda'].includes(k);
  const celda = (k, v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (esFecha(k)) return new Date(v).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
    if (k === 'precio')  return '$' + Number(v).toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 });
    if (k === 'rinde' || k === 'lo_normal_suyo') return Number(v).toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' km/L';
    if (k === 'km_del_tramo' || k === 'km_esperado') return Math.round(v).toLocaleString('es-AR') + ' km';
    if (k === 'litros_de_mas') return '+' + Number(v).toLocaleString('es-AR') + ' L';
    if (/^litros/.test(k)) return Number(v).toLocaleString('es-AR') + ' L';
    if (k === 'minutos_entre') return v + ' min';
    return escapeHtml(String(v));
  };

  el.innerHTML = d.anomalias.map(a => {
    const cols = Object.keys(a.registros[0] || {});
    return `
    <div class="card" style="margin-bottom:16px;border-left:4px solid var(--${a.severidad==='alta'?'danger':a.severidad==='baja'?'text3':'warn'})">
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
        <span style="font-size:20px;line-height:1.2">${a.severidad==='alta'?'🔴':a.severidad==='baja'?'⚪':'🟡'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px">${escapeHtml(a.titulo)}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px">${escapeHtml(a.descripcion)}</div>
          ${a.criterio ? `<div style="font-size:11px;color:var(--text3);margin-top:8px;padding:8px 10px;background:var(--bg3);border-radius:6px;line-height:1.5">
            <b>Cómo se detecta:</b> ${escapeHtml(a.criterio)}</div>` : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table style="font-size:12px">
          <thead><tr>${cols.map(k=>`<th>${ROTULO[k] || k.replace(/_/g,' ')}</th>`).join('')}</tr></thead>
          <tbody>${a.registros.slice(0,10).map(r=>`<tr>${cols.map(k=>`<td${['precio','km_del_tramo','km_esperado','rinde','lo_normal_suyo','minutos_entre'].includes(k)||/^litros/.test(k)?' class="td-mono"':''}${k==='litros_de_mas'?' style="color:var(--danger);font-weight:600"':''}>${celda(k, r[k])}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
      ${a.registros.length > 10 ? `<div style="font-size:11px;color:var(--text3);margin-top:8px;padding:4px">… y ${a.registros.length-10} más</div>` : ''}
    </div>`;
  }).join('');
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
          <div style="font-size:12px;color:var(--text3)">${escapeHtml(a.descripcion)}</div>
        </div>
      </div>
      <div class="table-wrap">
        <table style="font-size:12px">
          <thead><tr>${Object.keys(a.registros[0]||{}).map(k=>`<th>${k}</th>`).join('')}</tr></thead>
          <tbody>${a.registros.slice(0,10).map(r=>`<tr>${Object.values(r).map(v=>`<td class="td-mono">${typeof v === 'number' ? '$'+(v).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}) : (v||'—')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`).join('');
}

// ── Tab 4: Trazabilidad por unidad ───────────────────────
async function renderAuditorTrazabilidad(el) {
  const vehicleOpts = (App.data.vehicles||[]).map(v =>
    `<option value="${v.id}">${escapeHtml(v.code)} — ${escapeHtml(v.plate)}</option>`).join('');

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
      <div class="kpi-card info"><div class="kpi-label">Costo total histórico</div><div class="kpi-value white">$${(costTotal).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
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
              <td style="font-size:12px">${escapeHtml(e.detalle)}</td>
              <td style="font-size:12px;color:var(--text3)">${escapeHtml(e.usuario||'—')}</td>
              <td class="td-mono" style="font-size:12px;color:${e.monto>0?'var(--danger)':'var(--text3)'}">${e.monto>0?'$'+(e.monto).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Tab 5: Comparativo mensual ────────────────────────────
async function renderAuditorComparativo(el) {
  const [res, resGps] = await Promise.all([
    apiFetch('/api/auditor/comparativo'),
    apiFetch('/api/auditor/km-gps').catch(() => null),
  ]);
  if (!res.ok) { el.innerHTML = `<div class="card" style="color:var(--danger)">Error</div>`; return; }
  const d = await res.json();
  const gps = (resGps && resGps.ok) ? await resGps.json().catch(() => null) : null;

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
            <th>Km ${gps && gps.periodos?.length ? '<span style="font-weight:400;color:var(--text3)">(GPS)</span>' : ''}</th>
            <th>Rendimiento</th>
            <th style="color:#06b6d4">Urea</th>
            <th style="color:#f59e0b">Mantenimiento</th>
            <th style="color:#f59e0b">OTs</th>
            <th style="font-weight:700">Total</th>
            <th>Var. vs anterior</th>
          </tr></thead>
          <tbody>${d.meses.map((m, i) => {
            const prev = i > 0 ? d.meses[i-1].total : null;
            const varPct = prev && prev > 0 ? ((m.total - prev) / prev * 100).toFixed(1) : null;
            const varColor = varPct === null ? 'var(--text3)' : parseFloat(varPct) > 10 ? 'var(--danger)' : parseFloat(varPct) > 0 ? 'var(--warn)' : 'var(--ok)';
            const km = m.km || 0, l = m.litros || 0;
            const f1 = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
            const f0 = (n) => Math.round(n).toLocaleString('es-AR');
            // ── Km: manda el GPS ──────────────────────────────────────────────
            // Mide el mes calendario exacto y no depende de cuándo cargó cada unidad
            // (el odómetro de las cargas reparte los km del que tanquea a fin de mes
            // entre dos meses; eso fue lo que hizo ver un faltante que no existía).
            // El de odómetro queda abajo, como referencia de contraste.
            const kmG = m.km_gps || 0, kmGr = m.km_gps_rend || 0, lGr = m.litros_gps_rend || 0;
            const cob = (m.gps_parcial && m.gps_desde && m.gps_hasta)
              ? ` · parcial ${m.gps_desde.slice(8)}/${m.gps_desde.slice(5,7)}→${m.gps_hasta.slice(8)}/${m.gps_hasta.slice(5,7)}`
              : '';
            const kmCell = kmG > 0
              ? `<span style="font-weight:600" title="Odómetro del GPS: última lectura del mes menos la del mes anterior">${f0(kmG)} km</span>
                 <div style="font-size:10px;color:${m.gps_parcial ? 'var(--warn)' : 'var(--text3)'}">🛰 GPS · ${m.gps_unidades} unid.${cob}</div>
                 ${m.gps_sin_litros > 0 ? `<div style="font-size:10px;color:var(--text3)" title="Unidades con km del GPS pero sin combustible registrado en FleetOS: su km no entra al rendimiento">para rendimiento: ${f0(kmGr)} km (${m.gps_sin_litros} unid. sin cargas afuera)</div>` : ''}
                 <div style="font-size:10px;color:var(--text3)">odómetro cargas: ${km > 0 ? f0(km) : '—'}</div>`
              : (km > 0 ? `${f0(km)} km<div style="font-size:10px;color:var(--text3)">odómetro cargas</div>` : '—');
            // ── Rendimiento ───────────────────────────────────────────────────
            // Con GPS: km exactos del mes ÷ litros de ESAS MISMAS unidades. Sin GPS,
            // el cálculo por TRAMOS (asigna cada carga al período en que ese gasoil se
            // quemó, prorrateando los tramos que cruzan el cambio de mes). El de
            // calendario por odómetro queda último: se distorsiona cuando los camiones
            // tanquean a la vuelta del viaje cruzando el cambio de mes.
            const kmT = m.km_tramos || 0, lT = m.litros_tramos || 0;
            const refs = [
              (kmT > 0 && lT > 0) ? `tramos: ${f1(kmT / lT)}` : null,
              (km > 0 && l > 0)   ? `calendario: ${f1(km / l)}` : null,
            ].filter(Boolean).join(' · ');
            const rendCell = (kmGr > 0 && lGr > 0)
              ? `<span style="font-weight:600" title="Km del GPS de las unidades que registran combustible ÷ los litros que cargaron ese mes">${f1(kmGr / lGr)} km/L</span>
                 <div style="font-size:10px;color:var(--text3)">🛰 ${f1(lGr / kmGr * 100)} L/100km${refs ? ' · ' + refs : ''}</div>`
              : (kmT > 0 && lT > 0)
                ? `<span title="Por tramos: el gasoil se asigna al mes en que se quemó">${f1(kmT / lT)} km/L</span><div style="font-size:10px;color:var(--text3)">${f1(lT / kmT * 100)} L/100km · calendario: ${(km > 0 && l > 0) ? f1(km / l) : '—'}</div>`
                : (km > 0 && l > 0)
                  ? `${f1(km / l)} km/L<div style="font-size:10px;color:var(--text3)">${f1(l / km * 100)} L/100km</div>`
                  : '—';
            const litrosBreak = (l > 0 && ((m.litros_cisterna || 0) > 0 || (m.litros_estacion || 0) > 0))
              ? `<div style="font-size:10px;color:var(--text3)">cist. ${Math.round(m.litros_cisterna || 0).toLocaleString()} · est. ${Math.round(m.litros_estacion || 0).toLocaleString()}</div>`
              : '';
            return `<tr>
              <td class="td-mono" style="font-weight:600">${m.label.toUpperCase()}</td>
              <td class="td-mono" style="color:#3b82f6">${m.costo_combustible>0?'$'+(m.costo_combustible).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
              <td class="td-mono" style="color:#3b82f6">${m.litros>0?Math.round(m.litros).toLocaleString()+' L':'—'}${litrosBreak}</td>
              <td class="td-mono">${kmCell}</td>
              <td class="td-mono">${rendCell}</td>
              <td class="td-mono" style="color:#06b6d4">${m.costo_urea>0?'$'+(m.costo_urea).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
              <td class="td-mono" style="color:#f59e0b">${m.costo_mantenimiento>0?'$'+(m.costo_mantenimiento).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
              <td class="td-mono">${m.ots||'—'}</td>
              <td class="td-mono" style="font-weight:700">${m.total>0?'$'+(m.total).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td>
              <td class="td-mono" style="color:${varColor}">${varPct !== null ? (parseFloat(varPct)>0?'+':'')+varPct+'%' : '—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <div style="padding:10px 20px;font-size:11px;color:var(--text3);border-top:1px solid var(--border2);line-height:1.6">
        <b>🛰 Km del GPS:</b> odómetro satelital del último día del mes menos el del último día del mes anterior. Mide el mes
        calendario exacto y no depende de cuándo tanqueó cada unidad — es el mismo número que ve el satelital.
        <b>Km "odómetro cargas"</b> es el cálculo anterior (diferencia entre la primera y la última lectura anotada en las cargas):
        queda como contraste, y difiere del GPS porque los km del camión que carga a fin de mes se reparten entre dos meses.<br>
        <b>Rendimiento:</b> km del GPS ÷ litros, tomando <u>sólo las unidades que registran combustible en FleetOS</u>. Las que
        tienen km del satelital pero todavía no cargan en el sistema quedan afuera del km/L (si entraran, el rendimiento de la
        flota daría falsamente bueno). <b>"tramos"</b> y <b>"calendario"</b> son los cálculos por odómetro de cargas, de referencia.
      </div>`}
    </div>
    ${renderKmGpsPorUnidad(gps)}`;
}

// ── Respaldo del número: km del GPS unidad por unidad y mes ──────────
// Es la tabla que se muestra cuando alguien pregunta "¿de dónde sale ese km?".
// Cada fila es una unidad; cada mes, sus km del satelital y el km/L contra los
// litros que cargó. La unidad sin cargas registradas se marca y no promedia.
function renderKmGpsPorUnidad(gps) {
  if (!gps || !gps.periodos || !gps.periodos.length) return '';
  const P = gps.periodos, fmt = n => Math.round(n || 0).toLocaleString('es-AR');
  const f1 = n => n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const label = p => {
    const [y, m] = p.split('-');
    return new Date(+y, +m - 1, 1).toLocaleString('es-AR', { month: 'short', year: '2-digit' }).toUpperCase();
  };
  const cel = m => {
    if (!m) return `<td class="td-mono" style="text-align:right;color:var(--text3)">—</td>`;
    return `<td class="td-mono" style="text-align:right">
      ${fmt(m.km)}<div style="font-size:10px;color:${m.sin_cargas ? 'var(--warn)' : 'var(--text3)'}">${
        m.sin_cargas ? '⚠ sin cargas' : (m.km_l ? f1(m.km_l) + ' km/L' : '—')}</div></td>`;
  };
  const sinCargas = gps.unidades.filter(u => P.some(p => u.meses[p] && u.meses[p].sin_cargas));

  return `
    <div class="card" style="padding:0">
      <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <div class="card-title" style="margin:0">🛰 Km del GPS por unidad</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">El respaldo del km de arriba, unidad por unidad</div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="exportKmGpsPDF()">📄 Descargar PDF</button>
      </div>
      <div class="table-wrap" style="max-height:600px;overflow:auto">
        <table>
          <thead><tr>
            <th>Unidad</th><th>Base</th>
            ${P.map(p => `<th style="text-align:right">${label(p)}${
              (gps.cobertura?.[p]?.desde && gps.cobertura[p].hasta) ? `<div style="font-size:10px;font-weight:400;color:var(--text3)">${gps.cobertura[p].desde.slice(8)}/${gps.cobertura[p].desde.slice(5,7)}→${gps.cobertura[p].hasta.slice(8)}/${gps.cobertura[p].hasta.slice(5,7)}</div>` : ''
            }</th>`).join('')}
          </tr></thead>
          <tbody>
            ${gps.unidades.map(u => `<tr>
              <td class="td-mono" style="font-weight:600">${escapeHtml(u.unidad)}</td>
              <td style="font-size:12px;color:var(--text3)">${escapeHtml(u.base || '—')}</td>
              ${P.map(p => cel(u.meses[p])).join('')}
            </tr>`).join('')}
          </tbody>
          <tfoot><tr style="border-top:2px solid var(--border2);font-weight:700">
            <td colspan="2">TOTAL</td>
            ${P.map(p => {
              const t = gps.totales?.[p] || {};
              return `<td class="td-mono" style="text-align:right">${fmt(t.km)}
                <div style="font-size:10px;font-weight:400;color:var(--text3)">${
                  t.sin_cargas ? `rend.: ${fmt(t.km_rend)} km · ` : ''}${t.km_l ? f1(t.km_l) + ' km/L' : '—'}</div></td>`;
            }).join('')}
          </tr></tfoot>
        </table>
      </div>
      <div style="padding:10px 20px;font-size:11px;color:var(--text3);border-top:1px solid var(--border2);line-height:1.6">
        Cada celda: km del satelital en ese mes y, abajo, el km/L contra los litros que esa unidad cargó en FleetOS.
        ${sinCargas.length ? `<b style="color:var(--warn)">⚠ ${sinCargas.length} unidad(es) con km del GPS y sin combustible registrado</b>
          (${sinCargas.map(u => escapeHtml(u.unidad)).join(', ')}): sus km se guardan —sirven para medir utilización— pero
          quedan afuera del rendimiento hasta que esas bases empiecen a registrar las cargas.` : ''}
      </div>
    </div>`;
}

// PDF de respaldo: la misma tabla, para adjuntar al informe mensual.
async function exportKmGpsPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) { window.showToast?.('error', 'jsPDF no cargado. Refrescá la página.'); return; }
  const res = await apiFetch('/api/auditor/km-gps');
  if (!res.ok) { window.showToast?.('error', 'No se pudo obtener el detalle'); return; }
  const g = await res.json();
  if (!g.periodos?.length) { window.showToast?.('error', 'Todavía no hay km del GPS cargados'); return; }
  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const fmt = n => Math.round(n || 0).toLocaleString('es-AR');
  const f1 = n => n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const lbl = p => { const [y, m] = p.split('-'); return new Date(+y, +m - 1, 1).toLocaleString('es-AR', { month: 'short', year: '2-digit' }).toUpperCase(); };

  doc.setFontSize(15); doc.text('Km recorridos según GPS — por unidad', 40, 40);
  doc.setFontSize(9); doc.setTextColor(110);
  doc.text('Odómetro satelital: última lectura del mes menos la del mes anterior. El km/L usa los litros cargados en FleetOS.', 40, 56);
  doc.text(`Generado ${new Date().toLocaleString('es-AR')}`, 40, 68);
  doc.setTextColor(0);

  doc.autoTable({
    startY: 84,
    head: [['Unidad', 'Base', ...g.periodos.flatMap(p => [`${lbl(p)} km`, `${lbl(p)} km/L`])]],
    body: [
      ...g.unidades.map(u => [u.unidad, u.base || '—',
        ...g.periodos.flatMap(p => {
          const m = u.meses[p];
          return m ? [fmt(m.km), m.sin_cargas ? 'sin cargas' : (m.km_l ? f1(m.km_l) : '—')] : ['—', '—'];
        })]),
      ['TOTAL', '', ...g.periodos.flatMap(p => {
        const t = g.totales?.[p] || {};
        return [fmt(t.km), t.km_l ? f1(t.km_l) : '—'];
      })],
    ],
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: [30, 41, 59], fontSize: 7.5 },
    columnStyles: Object.fromEntries(g.periodos.flatMap((_, i) => [[2 + i * 2, { halign: 'right' }], [3 + i * 2, { halign: 'right' }]])),
    didParseCell: d => { if (d.row.index === g.unidades.length && d.section === 'body') d.cell.styles.fontStyle = 'bold'; },
  });

  const sin = g.unidades.filter(u => g.periodos.some(p => u.meses[p]?.sin_cargas)).map(u => u.unidad);
  if (sin.length) {
    doc.setFontSize(8); doc.setTextColor(150, 90, 0);
    doc.text(`Unidades con km del GPS y sin combustible registrado en FleetOS (excluidas del km/L): ${sin.join(', ')}`,
      40, doc.lastAutoTable.finalY + 18, { maxWidth: 760 });
  }
  doc.save(`km-gps-por-unidad-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ── Tab: Rendimiento por unidad (km/L, L/100km, $/km histórico) ──
// Estado del período elegido y última respuesta (para ordenar/exportar sin re-pedir).
let _efi = { meses: 0, unidades: [], resumen: {}, sortKey: 'code', sortDir: 1 };

const _EFI_PERIODOS = [
  [0,  'Histórico completo'],
  [12, 'Últimos 12 meses'],
  [6,  'Últimos 6 meses'],
  [3,  'Últimos 3 meses'],
];

async function renderAuditorEficiencia(el) {
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:600;color:var(--text3)">Período</span>
          <select class="form-select" id="efi-periodo" style="max-width:220px;padding:6px 10px;font-size:12px" onchange="loadAuditorEficiencia()">
            ${_EFI_PERIODOS.map(([v,l]) => `<option value="${v}" ${v===_efi.meses?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="exportEficienciaPDF()">📄 Descargar PDF</button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:10px;line-height:1.5">
        Rendimiento por unidad calculado con las cargas de combustible. Los km surgen de la diferencia de odómetro
        (primera y última lectura del período, ≥2 cargas). Se excluye la urea. Las autoelevadoras operan por horas,
        por eso no muestran km/L.<br>
        🛰 <b>Los km medidos por el satelital</b> (mes calendario exacto, unidad por unidad) están en
        <b>Comparativo mensual → Km del GPS por unidad</b>. Difieren de estos porque acá el corte lo pone la fecha de
        cada carga, no el fin de mes.
      </div>
    </div>
    <div id="efi-result"><div style="text-align:center;padding:40px;color:var(--text3)">⏳ Cargando…</div></div>`;
  await loadAuditorEficiencia();
}

async function loadAuditorEficiencia() {
  const sel = document.getElementById('efi-periodo');
  _efi.meses = sel ? (parseInt(sel.value, 10) || 0) : _efi.meses;
  const wrap = document.getElementById('efi-result');
  if (wrap) wrap.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)">⏳ Cargando…</div>`;

  const res = await apiFetch(`/api/auditor/eficiencia-unidades?meses=${_efi.meses}`);
  if (!res.ok) { if (wrap) wrap.innerHTML = `<div class="card" style="color:var(--danger)">Error al cargar rendimiento</div>`; return; }
  const d = await res.json();
  _efi.unidades = d.unidades || [];
  _efi.resumen  = d.resumen || {};
  _renderEficienciaTable();
}

function sortAuditorEficiencia(key) {
  if (_efi.sortKey === key) { _efi.sortDir *= -1; }
  else { _efi.sortKey = key; _efi.sortDir = (key === 'code') ? 1 : -1; }
  _renderEficienciaTable();
}

function _renderEficienciaTable() {
  const wrap = document.getElementById('efi-result');
  if (!wrap) return;

  if (!_efi.unidades.length) {
    wrap.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--text3)">
      <div style="font-size:32px;margin-bottom:12px">⛽</div>
      Sin cargas de combustible en el período seleccionado.
    </div>`;
    return;
  }

  const r = _efi.resumen;
  const f1 = n => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fAr = n => '$' + (Number(n)||0).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});

  // Orden
  const k = _efi.sortKey, dir = _efi.sortDir;
  const rows = [..._efi.unidades].sort((a,b) => {
    let va = a[k], vb = b[k];
    if (k === 'code' || k === 'base') { va = (va||''); vb = (vb||''); return va.localeCompare(vb) * dir; }
    // nulls al final siempre
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir;
  });

  const arrow = key => _efi.sortKey === key ? (_efi.sortDir === 1 ? ' ▲' : ' ▼') : '';
  const th = (key, label, extra='') => `<th class="efi-th" style="cursor:pointer;white-space:nowrap;${extra}" onclick="sortAuditorEficiencia('${key}')">${label}${arrow(key)}</th>`;

  // Color del km/L: bueno (>=3), medio (2-3), malo (<2) — referencia camión pesado
  const rendColor = v => v == null ? 'var(--text3)' : v >= 3 ? 'var(--ok)' : v >= 2 ? 'var(--warn)' : 'var(--danger)';

  wrap.innerHTML = `
    <div class="kpi-row" style="margin-bottom:16px">
      <div class="kpi-card info">
        <div class="kpi-label">🛣 Km recorridos (flota)</div>
        <div class="kpi-value white">${Math.round(r.km_total||0).toLocaleString('es-AR')}</div>
        <div class="kpi-trend">${r.unidades_con_km||0} unidades con km calculable</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(59,130,246,.4)">
        <div class="kpi-label">⚡ Rendimiento promedio</div>
        <div class="kpi-value" style="color:#3b82f6">${r.km_l!=null?f1(r.km_l)+' km/L':'—'}</div>
        <div class="kpi-trend">${r.l_100km!=null?f1(r.l_100km)+' L/100km':'—'}</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(245,158,11,.4)">
        <div class="kpi-label">💵 Costo por km (flota)</div>
        <div class="kpi-value" style="color:#f59e0b">${r.costo_km!=null?fAr(r.costo_km):'—'}</div>
        <div class="kpi-trend">${fAr(r.costo_total)} en combustible</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(6,182,212,.4)">
        <div class="kpi-label">⛽ Litros consumidos</div>
        <div class="kpi-value" style="color:#06b6d4">${Math.round(r.litros_total||0).toLocaleString('es-AR')} L</div>
        <div class="kpi-trend">unidades con recorrido medible</div>
      </div>
    </div>
    <div class="card" style="padding:0">
      <div style="padding:14px 20px 10px;border-bottom:1px solid var(--border2)">
        <div class="card-title" style="margin:0">Rendimiento por unidad — ${_efi.unidades.length} unidades</div>
      </div>
      <div class="table-wrap">
        <table style="font-size:12px">
          <thead><tr>
            ${th('code','Unidad')}
            ${th('base','Base')}
            ${th('cargas','Cargas','text-align:right')}
            ${th('recorrido','Km / Hs','text-align:right')}
            ${th('litros','Litros','text-align:right')}
            ${th('costo','Combustible','text-align:right')}
            ${th('km_l','Rendimiento','text-align:right')}
            ${th('l_100km','L/100km','text-align:right')}
            ${th('costo_km','$/km · $/h','text-align:right')}
          </tr></thead>
          <tbody>${rows.map(u => {
            const chico = 'font-size:9px;color:var(--text3)';
            // Km/Hs
            const recCell = u.recorrido > 0
              ? `${u.recorrido.toLocaleString('es-AR')}${u.es_autoelev ? ` <span style="${chico}">hs</span>` : ''}`
              : '—';
            // Rendimiento: vehículos km/L (con semáforo); autoelevadoras L/h
            const rendCell = u.es_autoelev
              ? (u.l_hora != null ? `${f1(u.l_hora)} <span style="${chico}">L/h</span>` : '—')
              : `<span style="font-weight:700;color:${rendColor(u.km_l)}">${u.km_l != null ? f1(u.km_l) : '—'}</span>${u.km_l != null ? ` <span style="${chico}">km/L</span>` : ''}`;
            // $/km (vehículos) o $/h (autoelevadoras)
            const costoRec = u.es_autoelev
              ? (u.costo_hora != null ? `${fAr(u.costo_hora)} <span style="${chico}">/h</span>` : '—')
              : (u.costo_km != null ? fAr(u.costo_km) : '—');
            return `<tr>
            <td class="td-mono" style="font-weight:600">${escapeHtml(u.code)}${u.es_autoelev?' <span style="font-size:9px;color:var(--text3)">(hs)</span>':''}</td>
            <td style="color:var(--text3)">${escapeHtml(u.base||'—')}</td>
            <td class="td-mono" style="text-align:right">${u.cargas}</td>
            <td class="td-mono" style="text-align:right">${recCell}</td>
            <td class="td-mono" style="text-align:right">${Math.round(u.litros).toLocaleString('es-AR')} L</td>
            <td class="td-mono" style="text-align:right">${fAr(u.costo)}</td>
            <td class="td-mono" style="text-align:right">${rendCell}</td>
            <td class="td-mono" style="text-align:right">${u.es_autoelev ? '—' : (u.l_100km!=null?f1(u.l_100km):'—')}</td>
            <td class="td-mono" style="text-align:right">${costoRec}</td>
          </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <div style="padding:10px 20px;font-size:11px;color:var(--text3);border-top:1px solid var(--border2)">
        Tocá cualquier encabezado para ordenar. Rendimiento en km/L: <span style="color:var(--ok)">verde</span> ≥ 3 ·
        <span style="color:var(--warn)">amarillo</span> 2–3 · <span style="color:var(--danger)">rojo</span> &lt; 2.
        Las autoelevadoras <b>(hs)</b> van por horas: muestran <b>L/h</b> y <b>$/h</b> en vez de km/L.
        "—" = sin recorrido medible (falta ≥2 lecturas del contador).
      </div>
    </div>`;
  _applyTableLabels(wrap);
}

function exportEficienciaPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) { window.showToast?.('error', 'jsPDF no cargado. Refrescá la página.'); return; }
  if (!_efi.unidades.length) { window.showToast?.('warn', 'No hay datos para exportar'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const periodoLabel = (_EFI_PERIODOS.find(p => p[0] === _efi.meses) || [0,'Histórico'])[1];
  const startY = (window._pdfHeader
    ? window._pdfHeader(doc, 'Rendimiento por unidad', periodoLabel + ' · Expreso Biletta SRL')
    : 60);

  const f1 = n => n == null ? '—' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fAr = n => '$' + (Number(n)||0).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});

  // Mismo orden que se ve en pantalla
  const k = _efi.sortKey, dir = _efi.sortDir;
  const rows = [..._efi.unidades].sort((a,b) => {
    let va = a[k], vb = b[k];
    if (k === 'code' || k === 'base') return String(va||'').localeCompare(String(vb||'')) * dir;
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir;
  });

  const body = rows.map(u => [
    u.code + (u.es_autoelev ? ' (hs)' : ''),
    u.base || '—',
    String(u.cargas),
    u.recorrido > 0 ? (u.recorrido.toLocaleString('es-AR') + (u.es_autoelev ? ' hs' : '')) : '—',
    Math.round(u.litros).toLocaleString('es-AR') + ' L',
    fAr(u.costo),
    u.es_autoelev ? (u.l_hora != null ? f1(u.l_hora) + ' L/h' : '—') : f1(u.km_l),
    u.es_autoelev ? '—' : f1(u.l_100km),
    u.es_autoelev ? (u.costo_hora != null ? fAr(u.costo_hora) + '/h' : '—') : (u.costo_km != null ? fAr(u.costo_km) : '—'),
  ]);
  const r = _efi.resumen || {};
  const style = window._pdfTableStyle ? window._pdfTableStyle() : {};
  doc.autoTable({
    startY,
    head: [['Unidad','Base','Cargas','Km / Hs','Litros','Combustible','Rend.','L/100km','$/km · $/h']],
    body,
    ...style,
    columnStyles: { 0:{fontStyle:'bold'}, 2:{halign:'right'}, 3:{halign:'right'}, 4:{halign:'right'}, 5:{halign:'right'}, 6:{halign:'right'}, 7:{halign:'right'}, 8:{halign:'right'} },
    foot: [[
      'FLOTA', '', '',
      Math.round(r.km_total||0).toLocaleString('es-AR'),
      Math.round(r.litros_total||0).toLocaleString('es-AR') + ' L',
      fAr(r.costo_total),
      f1(r.km_l), f1(r.l_100km),
      r.costo_km != null ? fAr(r.costo_km) : '—',
    ]],
  });
  doc.save(`Rendimiento-por-unidad-Biletta-${_efi.meses || 'historico'}.pdf`);
  window.showToast?.('ok', 'PDF descargado');
}

// ── Tab: Excesos de velocidad (historial de eventos) ──────
function _fmtDur(seg) {
  const s = Math.max(0, parseInt(seg) || 0);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m${r ? ' ' + r + 's' : ''}`;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}h${mm ? ' ' + mm + 'm' : ''}`;
}

// ── Tab: Cargas por unidad (historial completo con rendimiento por tramo) ──
// Para auditoría general: TODAS las cargas de gasoil de una unidad, de la
// primera a la última, con los km del tramo desde la carga anterior y el km/L.
async function renderAuditorHistorial(el) {
  const res = await apiFetch('/api/auditor/historial-cargas');
  if (!res.ok) { el.innerHTML = `<div class="card" style="color:var(--danger)">Error al cargar el historial</div>`; return; }
  const d = await res.json();
  const unidades = d.unidades || [];
  const fmt = n => Math.round(n || 0).toLocaleString('es-AR');
  const fecha = ts => ts ? String(ts).slice(0, 10) : '—';
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px;padding:0">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:16px 20px 12px;border-bottom:1px solid var(--border2);flex-wrap:wrap">
        <div>
          <div class="card-title" style="margin:0">Cargas por unidad — auditoría general</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">Tocá una unidad (o elegila en el selector) para ver TODAS sus cargas de gasoil, de la primera a la última, con los km y el rendimiento de cada tramo.</div>
        </div>
        <select class="form-select" id="aud-hist-unidad" onchange="loadAuditorHistorialUnidad(this.value)" style="width:180px;font-size:13px">
          <option value="">— Elegir unidad —</option>
          ${unidades.map(u => `<option value="${escapeHtml(u.unidad)}">${escapeHtml(u.unidad)}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap">
        <table><thead><tr>
          <th>Unidad</th><th style="text-align:right">Cargas</th><th>Primera</th><th>Última</th>
          <th style="text-align:right">Litros</th><th style="text-align:right">Costo</th>
          <th style="text-align:right">Km (tramos)</th><th style="text-align:right">Rend.</th>
          <th style="text-align:right" title="Costo de las cargas con tramo sano ÷ km de esos tramos (numerador y denominador apareados)">$/km</th>
          <th style="text-align:right" title="% de cargas con respaldo: ticket interno de cisterna o foto de ticket">Ticket</th>
          <th style="text-align:right" title="Tramos a revisar: consumo &gt; 1,5× la mediana de la unidad (posible faltante) o &lt; 0,5× (rendimiento irreal: salto de odómetro)">⚠</th>
        </tr></thead>
        <tbody>${(() => {
          // Agrupar por base, con subtotales por base (rend. sobre tramos sanos).
          const grupos = new Map();
          unidades.forEach(u => {
            const b = u.base || 'Sin base';
            if (!grupos.has(b)) grupos.set(b, []);
            grupos.get(b).push(u);
          });
          const fAr = n => '$' + Math.round(n || 0).toLocaleString('es-AR');
          return [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([baseNombre, us]) => {
            const cargas = us.reduce((a, u) => a + u.cargas, 0);
            const litros = us.reduce((a, u) => a + u.litros, 0);
            const costo = us.reduce((a, u) => a + (u.costo || 0), 0);
            const sosp = us.reduce((a, u) => a + (u.sospechosos || 0) + (u.irreales || 0), 0);
            const camiones = us.filter(u => !u.es_autoelev);
            const km = camiones.reduce((a, u) => a + (u.km_tramos || 0), 0);
            const litT = camiones.reduce((a, u) => a + (u.litros_tramos || 0), 0);
            const rend = (km > 0 && litT > 0) ? (km / litT).toFixed(2) + ' km/L' : '—';
            const header = `
              <tr style="background:var(--bg2, rgba(59,130,246,.06))">
                <td colspan="4" style="font-weight:700;font-size:12px;padding:8px 12px">📍 ${escapeHtml(baseNombre)} <span style="font-weight:400;color:var(--text3)">· ${us.length} unidad${us.length !== 1 ? 'es' : ''} · ${cargas} cargas</span></td>
                <td class="td-mono" style="text-align:right;font-weight:700">${fmt(litros)} L</td>
                <td class="td-mono" style="text-align:right;font-weight:700">${fAr(costo)}</td>
                <td class="td-mono" style="text-align:right;font-weight:700">${km > 0 ? fmt(km) + ' km' : '—'}</td>
                <td class="td-mono" style="text-align:right;font-weight:700">${rend}</td>
                <td class="td-mono" style="text-align:right;font-weight:700">${(km > 0 && costo > 0) ? fAr(costo / km) : '—'}</td>
                <td></td>
                <td class="td-mono" style="text-align:right;font-weight:700;color:${sosp > 0 ? 'var(--warn)' : 'var(--text3)'}">${sosp > 0 ? '⚠ ' + sosp : '—'}</td>
              </tr>`;
            const filas = us.map(u => `
              <tr onclick="loadAuditorHistorialUnidad('${escapeHtml(u.unidad)}')" style="cursor:pointer">
                <td class="td-mono" style="font-weight:600;color:var(--accent);padding-left:24px">${escapeHtml(u.unidad)}${u.es_autoelev ? ' <span style="font-size:10px;color:var(--text3)">(hs)</span>' : ''}</td>
                <td class="td-mono" style="text-align:right">${u.cargas}</td>
                <td class="td-mono" style="font-size:11px">${fecha(u.desde)}</td>
                <td class="td-mono" style="font-size:11px">${fecha(u.hasta)}</td>
                <td class="td-mono" style="text-align:right">${fmt(u.litros)} L</td>
                <td class="td-mono" style="text-align:right">${u.costo > 0 ? fAr(u.costo) : '—'}</td>
                <td class="td-mono" style="text-align:right">${u.km_tramos > 0 ? fmt(u.km_tramos) + (u.es_autoelev ? ' h' : ' km') : '—'}</td>
                <td class="td-mono" style="text-align:right;font-weight:600">${u.km_l != null ? (u.es_autoelev ? (1 / u.km_l).toFixed(1) + ' L/h' : u.km_l.toFixed(2) + ' km/L') : '—'}</td>
                <td class="td-mono" style="text-align:right">${u.costo_km != null ? fAr(u.costo_km) : '—'}</td>
                <td class="td-mono" style="text-align:right;color:${u.respaldo_pct >= 90 ? 'var(--ok)' : (u.respaldo_pct >= 60 ? 'var(--warn)' : 'var(--danger)')}">${u.respaldo_pct}%</td>
                <td class="td-mono" style="text-align:right;color:${(u.sospechosos + (u.irreales||0)) > 0 ? 'var(--warn)' : 'var(--text3)'}">${(u.sospechosos + (u.irreales||0)) > 0 ? '⚠ ' + (u.sospechosos + (u.irreales||0)) : '—'}</td>
              </tr>`).join('');
            return header + filas;
          }).join('');
        })()}</tbody></table>
      </div>
      <div style="padding:8px 14px;font-size:11px;color:var(--text3);border-top:1px solid var(--border)">
        Km (tramos) = suma de los tramos entre cargas con odómetro válido (se descartan retrocesos y saltos &gt; 20.000). Urea excluida.
        · <b>Ticket</b> = % de cargas con respaldo (ticket interno de cisterna o foto). · <b>⚠</b> = tramos a revisar: consumo &gt; 1,5× la mediana de la unidad (posible faltante) o &lt; 0,5× (rendimiento irreal por salto de odómetro). · <b>Rend. y $/km</b> se calculan solo sobre tramos sanos, con numerador y denominador apareados.
      </div>
    </div>
    <div id="aud-hist-detalle"></div>`;
}

// Última unidad cargada en la solapa (para exportar a PDF sin re-pedir).
let _hist = { unidad: null, es_autoelev: false, cargas: [] };

async function loadAuditorHistorialUnidad(unidad) {
  if (!unidad) return;
  const sel = document.getElementById('aud-hist-unidad');
  if (sel && sel.value !== unidad) sel.value = unidad;
  const box = document.getElementById('aud-hist-detalle');
  if (!box) return;
  box.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text3)">⏳ Cargando historial de ${escapeHtml(unidad)}...</div>`;
  const res = await apiFetch(`/api/auditor/historial-cargas?unidad=${encodeURIComponent(unidad)}`);
  if (!res.ok) { box.innerHTML = `<div class="card" style="color:var(--danger)">Error al cargar ${escapeHtml(unidad)}</div>`; return; }
  const d = await res.json();
  const cargas = d.cargas || [];
  _hist = { unidad: d.unidad || unidad, es_autoelev: !!d.es_autoelev, cargas };
  const unit = d.es_autoelev ? 'h' : 'km';
  const fmt = n => Math.round(n || 0).toLocaleString('es-AR');
  const fechaHora = ts => ts ? String(ts).replace('T', ' ').slice(0, 16) : '—';
  const rendCell = c => {
    if (c.km_tramo == null) return '—';
    if (c.km_tramo <= 0) return `<span style="color:var(--danger)" title="El odómetro es menor o igual al de la carga anterior: revisar la lectura">⚠ odóm.</span>`;
    if (c.km_tramo > 20000) return `<span style="color:var(--warn)" title="Salto de odómetro inusualmente grande: revisar la lectura">⚠ salto</span>`;
    if (d.es_autoelev) return `${(c.litros / c.km_tramo).toFixed(1)} L/h`;
    if (!c.km_l) return '—';
    const color = c.km_l >= 3 ? 'var(--ok)' : (c.km_l >= 2 ? 'var(--warn)' : 'var(--danger)');
    const sosp = c.sospechoso ? ` <span title="Consumo &gt; 1,5× la mediana histórica de esta unidad: revisar carga/ticket">⚠</span>`
      : (c.irreal ? ` <span style="color:#3b82f6" title="Rendimiento irrealmente bueno (&lt; 0,5× la mediana): probable salto de odómetro — la carga anterior tenía un km viejo">⚠</span>` : '');
    return `<span style="font-weight:600;color:${color}">${c.km_l.toFixed(2)} km/L</span>${sosp}<div style="font-size:10px;color:var(--text3)">${(c.litros / c.km_tramo * 100).toFixed(1)} L/100km</div>`;
  };
  const ticketBadge = c => {
    if (c.respaldo === 'interno') return `<span class="badge badge-info" style="font-size:10px">interno</span>`;
    if (c.respaldo === 'sin ticket') return `<span style="color:var(--danger);font-size:11px">sin ticket</span>`;
    const cls = c.respaldo === 'verificado' ? 'badge-ok' : (c.respaldo === 'observado' || c.respaldo === 'rechazado' ? 'badge-danger' : 'badge-warn');
    return `<span class="badge ${cls}" style="font-size:10px">${escapeHtml(c.respaldo)}</span>`;
  };
  const fAr = n => '$' + Math.round(n || 0).toLocaleString('es-AR');
  box.innerHTML = `
    <div class="card" style="padding:0">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 20px 10px;border-bottom:1px solid var(--border2);flex-wrap:wrap">
        <div class="card-title" style="margin:0">${escapeHtml(unidad)} — ${cargas.length} cargas de gasoil (primera → última)</div>
        <button class="btn btn-secondary btn-sm" onclick="exportHistorialPDF()">📄 Exportar PDF</button>
      </div>
      <div class="table-wrap">
        <table><thead><tr>
          <th>#</th><th>Fecha</th><th style="text-align:right">Litros</th>
          <th style="text-align:right">Costo</th>
          <th style="text-align:right">${d.es_autoelev ? 'Horómetro' : 'Odómetro'}</th>
          <th style="text-align:right">${d.es_autoelev ? 'Hs tramo' : 'Km tramo'}</th>
          <th>Rendimiento</th><th>Lugar</th><th>Chofer</th><th>Ticket</th>
        </tr></thead>
        <tbody>${cargas.map((c, i) => `
          <tr${c.sospechoso ? ' style="background:rgba(245,158,11,.07)"' : (c.irreal ? ' style="background:rgba(59,130,246,.06)"' : '')}>
            <td class="td-mono" style="color:var(--text3)">${i + 1}</td>
            <td class="td-mono" style="font-size:11px">${fechaHora(c.fecha)}</td>
            <td class="td-mono" style="text-align:right">${fmt(c.litros)} L</td>
            <td class="td-mono" style="text-align:right">${c.costo != null ? fAr(c.costo) : '—'}${(c.costo != null && c.km_tramo > 0 && c.km_tramo <= 20000) ? `<div style="font-size:10px;color:var(--text3)">${fAr(c.costo / c.km_tramo)}/${unit}</div>` : ''}</td>
            <td class="td-mono" style="text-align:right">${c.odometro ? fmt(c.odometro) + ' ' + unit : '—'}</td>
            <td class="td-mono" style="text-align:right">${c.km_tramo != null ? (c.km_tramo > 0 ? '+' : '') + fmt(c.km_tramo) : '—'}</td>
            <td class="td-mono">${rendCell(c)}</td>
            <td style="color:var(--text3);font-size:12px">${escapeHtml(c.lugar || '—')}</td>
            <td style="font-size:12px">${escapeHtml(c.chofer || '—')}${c.cargado_por && c.cargado_por !== c.chofer ? `<div style="font-size:10px;color:var(--text3)">cargó: ${escapeHtml(c.cargado_por)}</div>` : ''}</td>
            <td>${ticketBadge(c)}</td>
          </tr>`).join('')}</tbody></table>
      </div>
      ${(() => {
        // Totales ROTULADOS con numeradores y denominadores apareados (auditoría CALC-01):
        // los tramos con ⚠ no entran al rendimiento, y se muestra también la diferencia
        // primer→último odómetro para que ninguna cifra quede implícita.
        const litrosTotal = cargas.reduce((a, c) => a + (c.litros || 0), 0);
        const costoTotal = cargas.reduce((a, c) => a + (c.costo || 0), 0);
        let kmS = 0, litS = 0, cosS = 0;
        cargas.forEach(c => { if (c.km_tramo > 0 && c.km_tramo < 20000) { kmS += c.km_tramo; litS += c.litros || 0; cosS += c.costo || 0; } });
        const odos = cargas.filter(c => c.odometro > 0).map(c => c.odometro);
        const delta = odos.length >= 2 ? odos[odos.length - 1] - odos[0] : null;
        const nAlertas = cargas.filter(c => c.sospechoso || c.irreal || (c.km_tramo != null && (c.km_tramo <= 0 || c.km_tramo >= 20000))).length;
        return `<div style="padding:10px 14px;font-size:11.5px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;gap:6px 18px">
          <span><b>Total cargado:</b> ${fmt(litrosTotal)} L · ${fAr(costoTotal)}</span>
          <span><b>Σ tramos sanos:</b> ${kmS > 0 ? '+' + fmt(kmS) + ' ' + unit : '—'} <span style="color:var(--text3)">(${fmt(litS)} L · ${fAr(cosS)})</span></span>
          <span><b>Δ primer→último odómetro:</b> ${delta != null ? fmt(delta) + ' ' + unit : '—'}</span>
          <span><b>Rendimiento (tramos sanos):</b> ${(kmS > 0 && litS > 0) ? (d.es_autoelev ? (litS / kmS).toFixed(1) + ' L/h' : (kmS / litS).toFixed(2) + ' km/L · ' + (litS / kmS * 100).toFixed(1) + ' L/100km') : '—'}</span>
          <span><b>$/km (apareado):</b> ${(kmS > 0 && cosS > 0) ? fAr(cosS / kmS) + '/' + unit : '—'}</span>
          ${nAlertas > 0 ? `<span style="color:var(--warn)"><b>⚠ ${nAlertas} carga${nAlertas !== 1 ? 's' : ''} fuera del cálculo o a revisar</b></span>` : ''}
        </div>`;
      })()}
    </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Exporta a PDF el historial de la unidad actualmente cargada en la solapa.
function exportHistorialPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) { window.showToast?.('error', 'jsPDF no cargado. Refrescá la página.'); return; }
  if (!_hist.unidad || !_hist.cargas.length) { window.showToast?.('warn', 'Elegí una unidad primero'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const unit = _hist.es_autoelev ? 'h' : 'km';
  const startY = (window._pdfHeader
    ? window._pdfHeader(doc, `Historial de cargas — ${_hist.unidad}`, `${_hist.cargas.length} cargas de gasoil (primera → última) · Expreso Biletta SRL`)
    : 60);
  const fmt = n => Math.round(n || 0).toLocaleString('es-AR');
  const fechaHora = ts => ts ? String(ts).replace('T', ' ').slice(0, 16) : '—';
  const rend = c => {
    if (c.km_tramo == null) return '—';
    if (c.km_tramo <= 0) return '⚠ odómetro';
    if (c.km_tramo > 20000) return '⚠ salto';
    if (_hist.es_autoelev) return (c.litros / c.km_tramo).toFixed(1) + ' L/h';
    return c.km_l != null ? c.km_l.toFixed(2) + ' km/L' : '—';
  };
  const fAr = n => '$' + Math.round(n || 0).toLocaleString('es-AR');
  const body = _hist.cargas.map((c, i) => [
    String(i + 1), fechaHora(c.fecha), fmt(c.litros) + ' L',
    c.costo != null ? fAr(c.costo) : '—',
    c.odometro ? fmt(c.odometro) + ' ' + unit : '—',
    c.km_tramo != null ? (c.km_tramo > 0 ? '+' : '') + fmt(c.km_tramo) : '—',
    rend(c) + (c.sospechoso ? ' ⚠ alto' : (c.irreal ? ' ⚠ irreal' : '')),
    (!_hist.es_autoelev && c.km_l != null && c.km_tramo > 0 && c.km_tramo <= 20000) ? (c.litros / c.km_tramo * 100).toFixed(1) : '—',
    c.lugar || '—', c.chofer || '—',
    c.respaldo || '—',
  ]);
  // Totales: litros y costo de todo el historial + km/L y $/km sobre tramos sanos.
  const litrosTotal = _hist.cargas.reduce((a, c) => a + (c.litros || 0), 0);
  const costoTotal = _hist.cargas.reduce((a, c) => a + (c.costo || 0), 0);
  let kmSanos = 0, litrosSanos = 0;
  _hist.cargas.forEach(c => { if (c.km_tramo > 0 && c.km_tramo <= 20000) { kmSanos += c.km_tramo; litrosSanos += c.litros || 0; } });
  const costoSanos = (() => { let s = 0; _hist.cargas.forEach(c => { if (c.km_tramo > 0 && c.km_tramo <= 20000) s += c.costo || 0; }); return s; })();
  const nSosp = _hist.cargas.filter(c => c.sospechoso || c.irreal).length;
  const style = window._pdfTableStyle ? window._pdfTableStyle() : {};
  doc.autoTable({
    startY,
    head: [['#', 'Fecha', 'Litros', 'Costo', _hist.es_autoelev ? 'Horómetro' : 'Odómetro', (_hist.es_autoelev ? 'Hs' : 'Km') + ' tramo', 'Rendimiento', 'L/100km', 'Lugar', 'Chofer', 'Ticket']],
    body,
    ...style,
    columnStyles: { 0:{halign:'right'}, 2:{halign:'right'}, 3:{halign:'right'}, 4:{halign:'right'}, 5:{halign:'right'}, 6:{halign:'right'}, 7:{halign:'right'} },
    foot: [[
      '', 'TOTAL', fmt(litrosTotal) + ' L', fAr(costoTotal), '',
      kmSanos > 0 ? '+' + fmt(kmSanos) : '—',
      (kmSanos > 0 && litrosSanos > 0) ? (_hist.es_autoelev ? (litrosSanos / kmSanos).toFixed(1) + ' L/h' : (kmSanos / litrosSanos).toFixed(2) + ' km/L') : '—',
      (kmSanos > 0 && litrosSanos > 0 && !_hist.es_autoelev) ? (litrosSanos / kmSanos * 100).toFixed(1) : '—',
      (kmSanos > 0 && costoSanos > 0) ? fAr(costoSanos / kmSanos) + '/' + unit : 'tramos sanos',
      nSosp > 0 ? nSosp + ' ⚠' : '', '',
    ]],
  });
  try {
    const odos = _hist.cargas.filter(c => c.odometro > 0).map(c => c.odometro);
    const delta = odos.length >= 2 ? odos[odos.length - 1] - odos[0] : null;
    const y = (doc.lastAutoTable?.finalY || 500) + 14;
    doc.setFontSize(8); doc.setTextColor(100);
    doc.text(`Los totales de rendimiento y $/km usan SOLO tramos sanos (sin alertas): ${fmt(kmSanos)} ${unit} / ${fmt(litrosSanos)} L / ${fAr(costoSanos)}. ` +
      `Total cargado (todas las cargas): ${fmt(litrosTotal)} L / ${fAr(costoTotal)}. ` +
      (delta != null ? `Diferencia primer-ultimo odometro: ${fmt(delta)} ${unit}.` : ''), 40, y, { maxWidth: 760 });
  } catch (_) {}
  doc.save(`Historial-cargas-${_hist.unidad}-Biletta.pdf`);
  window.showToast?.('ok', 'PDF descargado');
}

async function renderAuditorExcesos(el) {
  const res = await apiFetch('/api/auditor/excesos-velocidad');
  if (!res.ok) { el.innerHTML = `<div class="card" style="color:var(--danger)">Error al cargar excesos</div>`; return; }
  const { eventos } = await res.json();

  if (!eventos || !eventos.length) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:40px">
      <div style="font-size:32px;margin-bottom:12px">✅</div>
      <div style="font-weight:600;color:var(--ok)">Sin excesos de velocidad registrados</div>
      <div style="font-size:13px;color:var(--text3);margin-top:8px">Se registran automáticamente cuando una unidad supera el límite. Requiere las alertas de velocidad configuradas.</div>
    </div>`;
    return;
  }

  const enCurso = eventos.filter(e => e.en_curso).length;
  const unidades = new Set(eventos.map(e => e.vehicle_code)).size;
  const maxVel = Math.max(...eventos.map(e => parseFloat(e.max_speed) || 0));
  const fecha = d => new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:16px">
      <div class="kpi-card ${enCurso ? 'danger' : 'info'}">
        <div class="kpi-label">🚨 Excesos registrados</div>
        <div class="kpi-value ${enCurso ? 'danger' : 'white'}">${eventos.length}</div>
        <div class="kpi-trend">${enCurso ? enCurso + ' en curso ahora' : 'ninguno en curso'}</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(59,130,246,.4)">
        <div class="kpi-label">🚛 Unidades involucradas</div>
        <div class="kpi-value" style="color:#3b82f6">${unidades}</div>
        <div class="kpi-trend">distintas</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(245,158,11,.4)">
        <div class="kpi-label">⏱ Velocidad máxima</div>
        <div class="kpi-value" style="color:#f59e0b">${Math.round(maxVel)} km/h</div>
        <div class="kpi-trend">pico registrado</div>
      </div>
    </div>
    <div class="card" style="padding:0">
      <div style="padding:14px 20px 10px;border-bottom:1px solid var(--border2)">
        <div class="card-title" style="margin:0">Historial de excesos — ${eventos.length}</div>
      </div>
      <div class="table-wrap">
        <table style="font-size:12px">
          <thead><tr>
            <th>Unidad</th><th>Base</th><th>Inicio</th>
            <th style="text-align:right">Duración</th>
            <th style="text-align:right">Vel. máx</th>
            <th style="text-align:right">Límite</th>
            <th>Estado</th>
            <th>Enviar</th>
          </tr></thead>
          <tbody>${eventos.map(e => {
            const kmh = Math.round(parseFloat(e.max_speed) || 0);
            return `<tr>
            <td class="td-mono" style="font-weight:600">${escapeHtml(e.vehicle_code || '—')}</td>
            <td style="color:var(--text3)">${escapeHtml(e.base || '—')}</td>
            <td class="td-mono">${fecha(e.started_at)}</td>
            <td class="td-mono" style="text-align:right">${_fmtDur(e.duration_seconds)}</td>
            <td class="td-mono" style="text-align:right;font-weight:700;color:var(--danger)">${kmh} km/h</td>
            <td class="td-mono" style="text-align:right;color:var(--text3)">${e.limit_kmh}</td>
            <td>${e.en_curso ? '<span class="badge badge-warn">🔴 en curso</span>' : '<span class="badge badge-ok">finalizado</span>'}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="compartirExceso('${escapeHtml(e.vehicle_code || '')}',${kmh},'${e.started_at}')" title="Enviar aviso al chofer">📲 Enviar</button></td>
          </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <div style="padding:10px 20px;font-size:11px;color:var(--text3);border-top:1px solid var(--border2)">
        Cada fila es un exceso desde que la unidad cruzó el límite hasta que bajó. La duración es aproximada
        (según la frecuencia del GPS). "En curso" = la unidad todavía va excedida en el último reporte.
      </div>
    </div>`;
}

// Genera un "cartelito" (imagen) del exceso y lo comparte por el menú del celular
// (WhatsApp, etc.). Si el equipo no soporta compartir archivos, descarga la imagen.
async function compartirExceso(code, kmh, isoFecha) {
  try {
    const fecha = new Date(isoFecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const W = 680, H = 420;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    // Fondo
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);
    // Header naranja Biletta
    ctx.fillStyle = '#ea580c'; ctx.fillRect(0, 0, W, 96);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px Arial'; ctx.fillText('EB', 28, 64);
    ctx.font = 'bold 28px Arial'; ctx.fillText('Expreso Biletta', 96, 44);
    ctx.font = '17px Arial'; ctx.fillText('Aviso de velocidad', 96, 74);
    // Cuerpo
    ctx.fillStyle = '#b91c1c'; ctx.font = 'bold 34px Arial';
    ctx.fillText('EXCESO DE VELOCIDAD', 30, 165);
    ctx.fillStyle = '#111827'; ctx.font = '26px Arial';
    ctx.fillText('Unidad: ' + code, 30, 222);
    ctx.fillStyle = '#dc2626'; ctx.font = 'bold 40px Arial';
    ctx.fillText(kmh + ' km/h', 30, 278);
    ctx.fillStyle = '#4b5563'; ctx.font = '21px Arial';
    ctx.fillText('Fecha: ' + fecha, 30, 320);
    ctx.fillStyle = '#111827'; ctx.font = '21px Arial';
    ctx.fillText('Por favor, respetá el límite de velocidad.', 30, 362);
    ctx.fillStyle = '#9ca3af'; ctx.font = '14px Arial';
    ctx.fillText('Generado por FleetOS — Expreso Biletta', 30, 398);

    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const texto = `Expreso Biletta - Aviso de velocidad\nUnidad ${code} registró ${kmh} km/h el ${fecha}.\nPor favor, moderá la velocidad. Gracias.`;
    const file = blob ? new File([blob], `aviso-velocidad-${code}.png`, { type: 'image/png' }) : null;

    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Aviso de velocidad', text: texto });
    } else if (navigator.share) {
      await navigator.share({ title: 'Aviso de velocidad', text: texto });
    } else if (blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `aviso-velocidad-${code}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      window.showToast?.('info', 'Imagen descargada — adjuntala en WhatsApp');
    }
  } catch (e) {
    if (String(e && e.name) !== 'AbortError') window.showToast?.('error', 'No se pudo compartir: ' + (e.message || e));
  }
}

// ── Tab: Ralentí (historial + estadísticas del mes) ───────
async function renderAuditorRalenti(el) {
  const now = new Date();
  const mes = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const res = await apiFetch(`/api/auditor/ralenti?mes=${mes}`);
  if (!res.ok) { el.innerHTML = `<div class="card" style="color:var(--danger)">Error al cargar ralentí</div>`; return; }
  const d = await res.json();
  const r = d.resumen || {};
  const fAr = n => '$' + (Number(n) || 0).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const nombreMes = new Date(d.periodo.anio, d.periodo.mes - 1, 1).toLocaleString('es-AR', { month: 'long', year: 'numeric' });

  if (!d.por_unidad || !d.por_unidad.length) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:40px">
      <div style="font-size:32px;margin-bottom:12px">🕒</div>
      <div style="font-weight:600;color:var(--ok)">Sin ralentí registrado en ${nombreMes}</div>
      <div style="font-size:13px;color:var(--text3);margin-top:8px">Se registra automáticamente cuando una unidad queda con el motor encendido y detenida más de ${d.umbral_min} min. Requiere el dato de ignición del GPS.</div>
    </div>`;
    return;
  }

  const maxTot = Math.max(...d.por_unidad.map(u => u.total_seconds), 1);

  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:16px">
      <div class="kpi-card info">
        <div class="kpi-label">🕒 Tiempo total en ralentí</div>
        <div class="kpi-value white">${_fmtDur(r.total_seconds)}</div>
        <div class="kpi-trend">${r.episodios || 0} episodios · ${r.unidades || 0} unidades</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(239,68,68,.4)">
        <div class="kpi-label">⛽ Gasoil desperdiciado (est.)</div>
        <div class="kpi-value" style="color:var(--danger)">${(Number(r.litros_estimados) || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L</div>
        <div class="kpi-trend">según el consumo de ralentí de cada modelo</div>
      </div>
      <div class="kpi-card" style="border-color:rgba(245,158,11,.4)">
        <div class="kpi-label">💸 Costo estimado</div>
        <div class="kpi-value" style="color:#f59e0b">${fAr(r.costo_estimado)}</div>
        <div class="kpi-trend">${r.precio_litro ? '~' + fAr(r.precio_litro) + '/L' : 'sin precio de referencia'}</div>
      </div>
    </div>
    <div class="card" style="padding:0;margin-bottom:16px">
      <div style="padding:14px 20px 10px;border-bottom:1px solid var(--border2)">
        <div class="card-title" style="margin:0">Ranking por unidad — ${nombreMes}</div>
      </div>
      <div class="table-wrap">
        <table style="font-size:12px">
          <thead><tr>
            <th>Unidad</th><th>Base</th>
            <th style="text-align:right">Episodios</th>
            <th style="text-align:right">Tiempo total</th>
            <th style="text-align:right">L/h</th>
            <th style="text-align:right">Gasoil est.</th>
            <th style="width:120px">&nbsp;</th>
          </tr></thead>
          <tbody>${d.por_unidad.map(u => `<tr>
            <td class="td-mono" style="font-weight:600">${escapeHtml(u.vehicle_code || '—')}</td>
            <td style="color:var(--text3)">${escapeHtml(u.base || '—')}</td>
            <td class="td-mono" style="text-align:right">${u.episodios}</td>
            <td class="td-mono" style="text-align:right;font-weight:700">${_fmtDur(u.total_seconds)}</td>
            <td class="td-mono" style="text-align:right;color:var(--text3)">${(u.litros_por_hora ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
            <td class="td-mono" style="text-align:right">${(Number(u.litros_estimados) || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L</td>
            <td><div style="background:var(--bg3);border-radius:4px;height:8px;overflow:hidden"><div style="width:${Math.round(u.total_seconds / maxTot * 100)}%;height:100%;background:var(--warn)"></div></div></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div style="padding:10px 20px;font-size:11px;color:var(--text3);border-top:1px solid var(--border2)">
        Ralentí = motor encendido y unidad detenida más de ${d.umbral_min} min. El gasoil se estima con el
        consumo de ralentí de cada modelo (columna L/h) × el tiempo. No incluye semirremolques ni autoelevadoras.
      </div>
    </div>
    <div class="card" style="padding:0">
      <div style="padding:14px 20px 10px;border-bottom:1px solid var(--border2)">
        <div class="card-title" style="margin:0">Últimos episodios</div>
      </div>
      <div class="table-wrap">
        <table style="font-size:12px">
          <thead><tr><th>Unidad</th><th>Base</th><th>Inicio</th><th style="text-align:right">Duración</th><th>Estado</th></tr></thead>
          <tbody>${(d.eventos || []).slice(0, 50).map(e => `<tr>
            <td class="td-mono" style="font-weight:600">${escapeHtml(e.vehicle_code || '—')}</td>
            <td style="color:var(--text3)">${escapeHtml(e.base || '—')}</td>
            <td class="td-mono">${new Date(e.started_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
            <td class="td-mono" style="text-align:right;font-weight:700">${_fmtDur(e.duration_seconds)}</td>
            <td>${e.en_curso ? '<span class="badge badge-warn">🟡 en curso</span>' : '<span class="badge badge-ok">finalizado</span>'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Tab 6: Log de acciones ────────────────────────────────
// Estado de paginación del log (trae de a páginas del backend con "Cargar más").
let _auditLog = { rows: [], offset: 0, pageSize: 100, allLoaded: false, el: null, nota: null, error: false };

async function renderAuditorLog(el) {
  _auditLog = { rows: [], offset: 0, pageSize: 100, allLoaded: false, el, nota: null, error: false };
  el.innerHTML = `<div class="card" style="padding:24px;text-align:center;color:var(--text3)">⏳ Cargando…</div>`;
  await _auditLogFetch();
  _auditLogRender();
}

async function _auditLogFetch() {
  try {
    const res = await apiFetch(`/api/auditor/log-acciones?limit=${_auditLog.pageSize}&offset=${_auditLog.offset}`);
    if (!res.ok) { _auditLog.error = true; return; }
    const d = await res.json();
    if (d.nota) { _auditLog.nota = d.nota; _auditLog.allLoaded = true; return; }
    const log = d.log || [];
    if (log.length < _auditLog.pageSize) _auditLog.allLoaded = true;
    _auditLog.rows = _auditLog.rows.concat(log);
    _auditLog.offset += log.length;
  } catch (e) { _auditLog.error = true; }
}

async function cargarMasAuditLog() {
  await _auditLogFetch();
  _auditLogRender();
}

// Formatea la columna "Cambio": valor anterior → posterior (auditoría fuerte),
// o solo el nuevo valor si no hay anterior (auditoría global).
function _auditCambio(l) {
  const fmt = (v) => {
    if (v == null) return '';
    let o = v;
    if (typeof v === 'string') { try { o = JSON.parse(v); } catch (e) { return escapeHtml(v); } }
    if (o && typeof o === 'object') {
      return Object.entries(o).map(([k, val]) => `${escapeHtml(k)}: ${escapeHtml(String(val))}`).join(', ');
    }
    return escapeHtml(String(o));
  };
  const oldV = l.old_value, newV = l.new_value;
  if (oldV != null && newV != null) {
    return `<span style="color:var(--text3)">${fmt(oldV)}</span> → <span style="color:var(--text)">${fmt(newV)}</span>`;
  }
  if (newV != null) return fmt(newV);
  return '—';
}

function _auditLogRender() {
  const el = _auditLog.el;
  if (!el) return;

  if (_auditLog.nota) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:32px">
      <div style="font-size:24px;margin-bottom:12px">🗂</div>
      <div style="font-weight:600">${escapeHtml(_auditLog.nota)}</div>
      <div style="font-size:13px;color:var(--text3);margin-top:8px">Las acciones críticas (crear/cerrar OTs, bajas de stock, dar de baja vehículos) quedan registradas con usuario y timestamp.</div>
    </div>`; return;
  }
  if (_auditLog.error && !_auditLog.rows.length) {
    el.innerHTML = `<div class="card" style="color:var(--danger)">Error</div>`; return;
  }

  const rows = _auditLog.rows;
  const cargarMas = !_auditLog.allLoaded
    ? `<div style="padding:12px;text-align:center;border-top:1px solid var(--border2)"><a onclick="cargarMasAuditLog()" style="color:var(--accent);cursor:pointer;font-weight:600">Cargar más →</a></div>`
    : '';

  el.innerHTML = `
    <div class="card" style="padding:0">
      <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border2)">
        <div class="card-title" style="margin:0">Log de acciones — ${rows.length} cargadas${_auditLog.allLoaded ? '' : '+'}</div>
      </div>
      <div class="table-wrap">
        <table style="font-size:12px">
          <thead><tr><th>Fecha/Hora</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Tabla</th><th>Registro</th><th>Cambio</th></tr></thead>
          <tbody>${rows.map(l=>`<tr>
            <td class="td-mono">${new Date(l.created_at).toLocaleString('es-AR')}</td>
            <td>${escapeHtml(l.user_name||'—')}</td>
            <td><span class="badge role-${l.user_role}">${l.user_role||'—'}</span></td>
            <td style="color:${l.action==='DELETE'||l.action==='DEACTIVATE'?'var(--danger)':l.action==='CREATE'?'var(--ok)':'var(--text)'}">${l.action}</td>
            <td class="td-mono">${l.table_name||'—'}</td>
            <td class="td-mono" style="color:var(--text3)">${l.record_id?.slice(0,8)||'—'}</td>
            <td style="font-size:11px;color:var(--text2);max-width:340px">${_auditCambio(l)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      ${cargarMas}
    </div>`;
  _applyTableLabels(el);
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
Tenés acceso a los datos en tiempo real del sistema FleetOS de Expreso Biletta SRL.
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
${JSON.stringify(comparativo.meses?.map(m=>({periodo:m.periodo,combustible:Math.round(m.costo_combustible),litros:Math.round(m.litros),mantenimiento:Math.round(m.costo_mantenimiento),total:Math.round(m.total),km_gps:Math.round(m.km_gps||0),km_gps_unidades_que_cargan:Math.round(m.km_gps_rend||0),litros_de_esas_unidades:Math.round(m.litros_gps_rend||0),km_odometro_cargas:Math.round(m.km||0),gps_parcial:!!m.gps_parcial}))||[])}

Respondé en español, de forma concisa y profesional.
Para preguntas sobre km del día, usá los datos de GPS de cada unidad.
Para km de un MES, usá km_gps (odómetro satelital, mes calendario exacto), no km_odometro_cargas
(ese depende de cuándo tanqueó cada unidad y por eso difiere del satelital). El rendimiento del mes
se calcula km_gps_unidades_que_cargan ÷ litros_de_esas_unidades: las unidades con km del GPS pero sin
cargas registradas en FleetOS quedan afuera del km/L. Si gps_parcial es true, el mes no está cubierto entero.
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
    // La respuesta se ESCAPA antes de entrar al innerHTML, y recién después se
    // convierten los saltos de línea. Al revés no sirve: escapar después
    // convertiría los <br> en texto.
    //
    // No es paranoia por venir de un modelo. El prompt que se manda arriba
    // incluye descripciones de anomalías cargadas por usuarios; si alguien
    // escribe una etiqueta en la observación de un ticket y la IA la repite en
    // su respuesta, sin escapar se ejecutaba en el navegador de quien abre el
    // panel — que son dueño y gerencia, los dos roles con más permisos.
    chat.innerHTML += `<div style="align-self:flex-start;background:var(--bg3);padding:10px 14px;border-radius:12px 12px 12px 2px;font-size:13px;max-width:85%;line-height:1.5">${escapeHtml(respuesta).replace(/\n/g, '<br>')}</div>`;
    chat.scrollTop = chat.scrollHeight;

  } catch(e) {
    document.getElementById('ia-loading')?.remove();
    chat.innerHTML += `<div style="align-self:flex-start;background:rgba(239,68,68,.1);color:var(--danger);padding:8px 12px;border-radius:12px;font-size:12px">Error al consultar la IA: ${escapeHtml(e.message)}</div>`;
  }
}

// Puente con el mundo legacy (dispatcher renderPage + onclick).
expose('renderAuditorPanel', renderAuditorPanel);
expose('showAuditorTab', showAuditorTab);
expose('renderAuditorResumen', renderAuditorResumen);
expose('renderAuditorVisual', renderAuditorVisual);
expose('renderAuditorVisualTimeline', renderAuditorVisualTimeline);
expose('_renderAuditorHeatmap', _renderAuditorHeatmap);
expose('_renderAuditorGauge', _renderAuditorGauge);
expose('_renderAuditorStacked', _renderAuditorStacked);
expose('renderAuditorCombustible', renderAuditorCombustible);
expose('renderAuditorOTs', renderAuditorOTs);
expose('renderAuditorTrazabilidad', renderAuditorTrazabilidad);
expose('loadAuditorTrazabilidad', loadAuditorTrazabilidad);
expose('renderAuditorComparativo', renderAuditorComparativo);
expose('exportKmGpsPDF', exportKmGpsPDF);
expose('renderAuditorEficiencia', renderAuditorEficiencia);
expose('loadAuditorEficiencia', loadAuditorEficiencia);
expose('sortAuditorEficiencia', sortAuditorEficiencia);
expose('exportEficienciaPDF', exportEficienciaPDF);
expose('renderAuditorHistorial', renderAuditorHistorial);
expose('loadAuditorHistorialUnidad', loadAuditorHistorialUnidad);
expose('exportHistorialPDF', exportHistorialPDF);
expose('renderAuditorExcesos', renderAuditorExcesos);
expose('compartirExceso', compartirExceso);
expose('renderAuditorRalenti', renderAuditorRalenti);
expose('renderAuditorLog', renderAuditorLog);
expose('cargarMasAuditLog', cargarMasAuditLog);
expose('openAuditorIA', openAuditorIA);
expose('sendAuditorIA', sendAuditorIA);
