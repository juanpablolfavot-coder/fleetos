// ════════════════════════════════════════════════════════════════════
//  NEUMÁTICOS (ES module, Fase 3) — mapa de cubiertas por eje (drag & drop),
//  stock, recapado, baja e historial de movimientos.
//
//  Migrado de tires.js. Dependencias legacy declaradas con need(). OJO:
//   - getAxleConfig y AXLE_CONFIGS viven en app.js (los comparte la edición
//     de vehículos); AXLE_CONFIGS es const, por eso app.js lo expone en window.
//   - _dragSerial/_dragFromPos eran globales implícitos en el script clásico;
//     como un módulo es strict mode, acá se declaran module-local.
// ════════════════════════════════════════════════════════════════════
import { need, expose } from './dom.mjs';

const App = need('App');
const escapeHtml = need('escapeHtml');
const escapeJsArg = need('escapeJsArg');
const apiFetch = need('apiFetch');
const openModal = need('openModal');
const closeModal = need('closeModal');
const showToast = need('showToast');
const loadInitialData = need('loadInitialData');
const getAxleConfig = need('getAxleConfig');
const AXLE_CONFIGS = need('AXLE_CONFIGS');
const todayISO = need('todayISO');

// Estado del drag & drop (eran globales implícitos en el script clásico).
let _dragSerial = null;
let _dragFromPos = null;

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
            ${vehicleOpts.map(v=>`<option value="${escapeHtml(v.code)}">${escapeHtml(v.code)} · ${escapeHtml(v.brand.split('-')[0])} · ${v.type}</option>`).join('')}
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
            ondragstart="onStockTireDragStart(event,'${escapeHtml(t.serial)}')"
            style="cursor:grab"
            title="Arrastrá al mapa para montar">
            <td class="td-mono td-main">${escapeHtml(t.serial)}</td>
            <td>${escapeHtml(t.brand)}</td>
            <td class="td-mono">${t.size}</td>
            <td class="td-mono">${(t.km||0).toLocaleString()} km</td>
            <td class="td-mono" style="color:var(--ok)">${(t.tread||0)}/20mm</td>
            <td><span class="badge ${t.km===0?'badge-ok':'badge-purple'}">${t.km===0?'Nueva':'Usada/Recapada'}</span></td>
            <td class="td-mono">$${(t.price||0).toLocaleString()}</td>
            <td><button class="btn btn-primary btn-sm" onclick="openMountFromStockModal('${escapeJsArg(t.serial)}')">Montar</button></td>
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
            <td class="td-mono td-main">${escapeHtml(t.serial)}</td>
            <td>${escapeHtml(t.brand||'—')}</td>
            <td class="td-mono">${t.size||'—'}</td>
            <td class="td-mono">${(t.km||0).toLocaleString()} km</td>
            <td class="td-mono" style="color:var(--warn)">${(t.tread||0)}mm</td>
            <td class="td-mono">$${(t.price||0).toLocaleString()}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="openTireDetail('${escapeJsArg(t.serial)}')">Acción</button></td>
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
            <td class="td-mono td-main">${escapeHtml(t.serial)}</td>
            <td>${escapeHtml(t.brand||'—')}</td>
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
            ${App.data.tires.map(t=>`<option value="${escapeHtml(t.serial)}">${escapeHtml(t.serial)}</option>`).join('')}
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
    showToast('ok', `${escapeHtml(tire.serial)} desmontada al stock`);
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
          data-pos="${escapeHtml(pos)}" data-serial="${escapeHtml(t.serial)}" data-vehicle="${escapeHtml(vehicleCode)}"
          draggable="true"
          ondragstart="onTireDragStart(event,'${escapeHtml(t.serial)}','${pos}')"
          ondragover="onTireDragOver(event)"
          ondragleave="onTireDragLeave(event)"
          ondrop="onTireDrop(event,'${pos}','${vehicleCode}')"
          onclick="openTireDetail('${escapeJsArg(t.serial)}')"
          style="background:${bg};border-color:${bc};cursor:grab"
          title="${escapeHtml(t.serial)} · ${escapeHtml(t.brand)} · Clic: detalle · Arrastrar: cambiar posición">
          <span style="font-size:13px;font-weight:700;font-family:var(--mono);color:${c}">${t.tread||0}mm</span>
          <span style="font-size:8px;font-family:var(--mono);color:${c};text-align:center;line-height:1.3;word-break:break-all">${escapeHtml(t.serial)}</span>
          <span style="font-size:9px;font-family:var(--mono);background:rgba(0,0,0,.2);padding:1px 4px;border-radius:3px;color:${c}">${pos}</span>
        </div>`;
      } else {
        return `<div class="tire-dnd-slot empty"
          data-pos="${pos}" data-vehicle="${vehicleCode}"
          ondragover="onTireDragOver(event)"
          ondragleave="onTireDragLeave(event)"
          ondrop="onTireDrop(event,'${pos}','${vehicleCode}')"
          onclick="openMountFromStockModal('',\'${escapeJsArg(vehicleCode)}\',\'${escapeJsArg(pos)}\')"
          title="Posición vacía — clic o soltá una cubierta aquí">
          <span style="font-size:20px;color:var(--text3);line-height:1">+</span>
          <span style="font-size:9px;font-family:var(--mono);color:var(--text3)">${pos}</span>
          <span style="font-size:9px;color:var(--text3)">vacío</span>
        </div>`;
      }
    };
    return `<div style="background:var(--bg3);border-radius:var(--radius);padding:12px 14px;border:1px solid var(--border);margin-bottom:8px">
      <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">${escapeHtml(axle.name)}</div>
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
    if (r.ok) { stockTire.vehicle = vehicleCode; stockTire.pos = toPos; showToast('ok', `${escapeHtml(stockTire.serial)} montada en ${toPos}`); }
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
    const r1 = await apiFetch(`/api/tires/${draggedTire.id}/move`, { method:'POST', body: JSON.stringify({ to_vehicle_id: vehicle?.id, to_position: toPos, type: 'Rotación (permuta)', notes: `Permuta con ${escapeHtml(targetTire.serial)}` }) });
    const r2 = await apiFetch(`/api/tires/${targetTire.id}/move`,  { method:'POST', body: JSON.stringify({ to_vehicle_id: vehicle?.id, to_position: _dragFromPos, type: 'Rotación (permuta)', notes: `Permuta con ${escapeHtml(draggedTire.serial)}` }) });
    if (r1.ok && r2.ok) {
      draggedTire.pos = toPos; targetTire.pos = _dragFromPos;
      showToast('ok', `Permuta: ${escapeHtml(draggedTire.serial)} ↔ ${escapeHtml(targetTire.serial)}`);
    } else { showToast('error','Error al registrar permuta'); }
  } else {
    const r = await apiFetch(`/api/tires/${draggedTire.id}/move`, { method:'POST', body: JSON.stringify({ to_vehicle_id: vehicle?.id, to_position: toPos, type: 'Rotación', notes: '' }) });
    if (r.ok) {
      draggedTire.pos = toPos; draggedTire.vehicle = vehicleCode;
      showToast('ok', `${escapeHtml(draggedTire.serial)}: ${_dragFromPos} → ${toPos}`);
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
    <td class="td-mono td-main" style="cursor:pointer;text-decoration:underline" onclick="openTireDetail('${escapeJsArg(t.serial)}')">${escapeHtml(t.serial)}</td>
    <td class="td-mono">${t.pos}</td>
    <td style="font-size:12px">${escapeHtml(t.brand.split(' ')[0])} ${escapeHtml(t.brand.split(' ')[1]||'')}</td>
    <td class="td-mono">${(t.km||0).toLocaleString()}</td>
    <td class="td-mono" style="color:var(--${t.status==='danger'?'danger':t.status==='warn'?'warn':'ok'})">${t.tread||0}/20mm</td>
    <td><span class="badge ${t.status==='ok'?'badge-ok':t.status==='warn'?'badge-warn':'badge-danger'}">${t.status==='ok'?'OK':t.status==='warn'?'Revisar':'Crítica'}</span></td>
    <td><button class="btn btn-secondary btn-sm" onclick="openTireDetail('${escapeJsArg(t.serial)}')">Ver</button></td>
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
      <td class="td-mono td-main" style="cursor:pointer;text-decoration:underline" onclick="openTireDetail('${escapeJsArg(h.serial)}')">${escapeHtml(h.serial)}</td>
      <td class="td-mono" style="color:var(--text3)">${h.fromPos}</td>
      <td class="td-mono" style="color:var(--accent)">→ ${h.toPos}</td>
      <td><span class="badge ${h.type.includes('Rotación')?'badge-info':h.type==='Montaje'?'badge-ok':h.type.includes('Baja')?'badge-danger':'badge-gray'}">${h.type}</span></td>
      <td class="td-mono">${h.vehicle}</td>
      <td class="td-mono">${h.km.toLocaleString()}</td>
      <td style="font-size:12px">${h.user}</td>
      <td style="font-size:11px;color:var(--text3);max-width:160px">${escapeHtml(h.obs||'')}</td>
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
            ? stock.map(t=>`<option value="${escapeHtml(t.serial)}" ${t.serial===serial?'selected':''}>${escapeHtml(t.serial)} · ${escapeHtml(t.brand)} · ${t.km===0?'Nueva':'Usada '+(t.km||0).toLocaleString()+'km'} · ${t.tread||0}mm dibujo</option>`).join('')
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
  // Profundidad típica de un neumático nuevo de camión: 20mm
  const MAX_DEPTH = 20;
  const tread    = parseFloat(t.tread) || 0;
  const km       = parseFloat(t.km) || 0;
  const price    = parseFloat(t.price) || 0;
  const depthPct = Math.min(100, Math.round((tread / MAX_DEPTH) * 100));
  const cpkm     = km > 0 && price > 0 ? (price / km).toFixed(2) : '—';

  openModal('Cubierta — ' + serial, `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
      <div style="background:var(--bg3);border-radius:var(--radius);padding:12px;border:1px solid var(--border);text-align:center">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">Dibujo</div>
        <div style="font-size:26px;font-weight:700;font-family:var(--mono);color:var(--${t.status==='danger'?'danger':t.status==='warn'?'warn':'ok'})">${tread}mm</div>
        <div style="font-size:10px;color:var(--text3)">prof. actual</div>
        <div style="height:4px;background:var(--bg4);border-radius:2px;margin-top:5px;overflow:hidden">
          <div style="height:4px;width:${depthPct}%;background:var(--${t.status==='danger'?'danger':t.status==='warn'?'warn':'ok'});border-radius:2px"></div>
        </div>
      </div>
      <div style="background:var(--bg3);border-radius:var(--radius);padding:12px;border:1px solid var(--border);text-align:center">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">Km acumulados</div>
        <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--text)">${km.toLocaleString()}</div>
        <div style="font-size:10px;color:var(--text3)">km totales</div>
      </div>
      <div style="background:var(--bg3);border-radius:var(--radius);padding:12px;border:1px solid var(--border);text-align:center">
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px">Costo/km</div>
        <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--text)">${cpkm==='—'?'—':'$'+cpkm}</div>
        <div style="font-size:10px;color:var(--text3)">costo acumulado</div>
      </div>
    </div>

    <table style="width:100%;font-size:13px;margin-bottom:16px">
      <tr><td style="color:var(--text3);padding:5px 0;width:38%">Marca / Modelo</td><td style="font-weight:500">${escapeHtml(t.brand || '—')}${t.model ? ' ' + escapeHtml(t.model) : ''}</td></tr>
      <tr><td style="color:var(--text3);padding:5px 0">Medida</td><td class="td-mono">${t.size || '—'}</td></tr>
      <tr><td style="color:var(--text3);padding:5px 0">Posición actual</td><td class="td-mono" style="color:var(--accent)">${t.pos || '—'} · ${t.vehicle || '—'}</td></tr>
      <tr><td style="color:var(--text3);padding:5px 0">Estado</td><td><span class="badge ${t.status==='ok'?'badge-ok':t.status==='warn'?'badge-warn':'badge-danger'}">${t.status==='ok'?'OK':t.status==='warn'?'Revisar':'Crítica'}</span></td></tr>
      <tr><td style="color:var(--text3);padding:5px 0">Precio compra</td><td class="td-mono">$${price.toLocaleString()}</td></tr>
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
              <td style="padding:6px 8px;font-family:var(--mono)">${(h.km||0).toLocaleString()}</td>
              <td style="padding:6px 8px;color:var(--text3);font-size:11px">${escapeHtml(h.obs||'')}</td>
            </tr>`).join('')}</tbody>
          </table>`
        : '<div style="color:var(--text3);font-size:13px;padding:8px 0">Sin movimientos previos registrados.</div>'
      }
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div class="form-group" style="margin:0">
        <label class="form-label">Actualizar profundidad (mm)</label>
        <input class="form-input" type="number" id="td-depth" value="${tread}" min="0" max="${MAX_DEPTH}">
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
    // Actualizar el campo real del mapper (t.tread) más alias por compat
    t.tread = depth;
    t.depth = depth;
    t.depth_mm = depth;
    // Recalcular status según el porcentaje de desgaste (neumático nuevo ≈ 20mm)
    const MAX_DEPTH = 20;
    const pct = (depth / MAX_DEPTH) * 100;
    t.status = pct < 25 ? 'danger' : (pct < 50 ? 'warn' : 'ok');
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
            .map(t=>`<option value="${escapeHtml(t.serial)}">${escapeHtml(t.serial)} — ${t.pos} — ${escapeHtml(t.brand.split(' ')[0])}</option>`).join('')}
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

// Puente con el mundo legacy (dispatcher renderPage + onclick/ondrag).
expose('renderTires', renderTires);
expose('getSelectedVehicle', getSelectedVehicle);
expose('refreshTireMap', refreshTireMap);
expose('onStockTireDragStart', onStockTireDragStart);
expose('onDropToStock', onDropToStock);
expose('renderTireMapDnD', renderTireMapDnD);
expose('onTireDragStart', onTireDragStart);
expose('onTireDragOver', onTireDragOver);
expose('onTireDragLeave', onTireDragLeave);
expose('onTireDrop', onTireDrop);
expose('renderTireTableBody', renderTireTableBody);
expose('renderTireHistory', renderTireHistory);
expose('openMountFromStockModal', openMountFromStockModal);
expose('openMountTireModal', openMountTireModal);
expose('saveMountTire', saveMountTire);
expose('openNewTireToStockModal', openNewTireToStockModal);
expose('saveNewTireToStock', saveNewTireToStock);
expose('openTireDetail', openTireDetail);
expose('saveTireAction', saveTireAction);
expose('openManualMoveModal', openManualMoveModal);
expose('saveManualMove', saveManualMove);
