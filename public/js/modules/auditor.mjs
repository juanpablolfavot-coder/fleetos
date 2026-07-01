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
    </div>
    ${(() => {
      const c = d.compras || {};
      const fmtAr = n => '$' + Math.round(Number(n)||0).toLocaleString('es-AR');
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
          <div style="font-size:12px;color:var(--text3)">${escapeHtml(a.descripcion)}</div>
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
          <div style="font-size:12px;color:var(--text3)">${escapeHtml(a.descripcion)}</div>
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
              <td style="font-size:12px">${escapeHtml(e.detalle)}</td>
              <td style="font-size:12px;color:var(--text3)">${escapeHtml(e.usuario||'—')}</td>
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
            <th>Km</th>
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
            const kmCell = km > 0 ? Math.round(km).toLocaleString('es-AR') + ' km' : '—';
            const rendCell = (km > 0 && l > 0)
              ? `${f1(km / l)} km/L<div style="font-size:10px;color:var(--text3)">${f1(l / km * 100)} L/100km</div>`
              : '—';
            const litrosBreak = (l > 0 && ((m.litros_cisterna || 0) > 0 || (m.litros_estacion || 0) > 0))
              ? `<div style="font-size:10px;color:var(--text3)">cist. ${Math.round(m.litros_cisterna || 0).toLocaleString()} · est. ${Math.round(m.litros_estacion || 0).toLocaleString()}</div>`
              : '';
            return `<tr>
              <td class="td-mono" style="font-weight:600">${m.label.toUpperCase()}</td>
              <td class="td-mono" style="color:#3b82f6">${m.costo_combustible>0?'$'+Math.round(m.costo_combustible).toLocaleString('es-AR'):'—'}</td>
              <td class="td-mono" style="color:#3b82f6">${m.litros>0?Math.round(m.litros).toLocaleString()+' L':'—'}${litrosBreak}</td>
              <td class="td-mono">${kmCell}</td>
              <td class="td-mono">${rendCell}</td>
              <td class="td-mono" style="color:#06b6d4">${m.costo_urea>0?'$'+Math.round(m.costo_urea).toLocaleString('es-AR'):'—'}</td>
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
expose('renderAuditorLog', renderAuditorLog);
expose('cargarMasAuditLog', cargarMasAuditLog);
expose('openAuditorIA', openAuditorIA);
expose('sendAuditorIA', sendAuditorIA);
