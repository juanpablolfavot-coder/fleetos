// ════════════════════════════════════════════════════════════════════
//  PANEL CHOFER (ES module, Fase 3) — vehículo asignado, acciones rápidas
//  (novedad, carga combustible/urea, checklist de salida).
//  Extraído de app.js. Lee los helpers globales legacy por referencia pelada
//  (resuelven vía el global object); App se toma de window. Las funciones se
//  re-exponen para el dispatcher (renderPage) y los onclick.
// ════════════════════════════════════════════════════════════════════
import { expose } from './dom.mjs';

const App = window.App;

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
          <div style="font-size:22px;font-weight:700;color:var(--info);letter-spacing:1px">${escapeHtml(myVehicle.code)}</div>
          <div style="color:var(--text3);font-size:13px;margin:4px 0 10px">${escapeHtml(myVehicle.plate)} · ${escapeHtml(myVehicle.brand)} ${escapeHtml(myVehicle.model)}</div>
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
        ${(App.data.vehicles||[]).map(v=>`<option value="${v.id}" ${myVehicle?.id===v.id?'selected':''}>${escapeHtml(v.code)} — ${escapeHtml(v.plate)}</option>`).join('')}
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
      ${myVehicle ? escapeHtml(myVehicle.code)+' — '+escapeHtml(myVehicle.plate) : 'Completá el checklist antes de salir'}
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
  await afterSave({ page: 'chofer_panel' });
}

// Puente con el mundo legacy (dispatcher + onclick).
expose('renderChoferPanel', renderChoferPanel);
expose('openChoferCargaModal', openChoferCargaModal);
expose('openChoferNovedadModal', openChoferNovedadModal);
expose('saveChoferNovedad', saveChoferNovedad);
expose('openChoferChecklistModal', openChoferChecklistModal);
expose('saveChoferChecklist', saveChoferChecklist);
