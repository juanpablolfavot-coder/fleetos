// ════════════════════════════════════════════════════════════════════
//  MANTENIMIENTO PREVENTIVO — planes por vehículo y generación de OTs preventivas.
//  Extraído de app.js para mantenerlo manejable. Todas las funciones son
//  globales (se llaman desde onclick= y desde el dispatcher renderPage en
//  app.js). Este archivo se carga DESPUÉS de app.js, así que usa sus
//  helpers globales (escapeHtml, apiFetch, openModal, showToast, userHasRole,
//  App.data, etc.).
// ════════════════════════════════════════════════════════════════════
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
    const isFork = isAutoelevador(v);
    const unit = isFork ? 'hs' : 'km';
    const interval = parseInt(ts.maint_interval_km) || (isFork ? 250 : 15000);
    const lastMaint = parseInt(ts.maint_last_km) || 0;
    const kmSinceLast = km - lastMaint;
    const pct = Math.min(100, Math.round(kmSinceLast / interval * 100));
    const nextKm = lastMaint + interval;
    const status = pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : 'ok';
    const taskName = ts.maint_task_name || 'Cambio aceite + filtros';
    return { v, km, interval, lastMaint, kmSinceLast, pct, nextKm, status, taskName, unit, isFork };
  });

  const rows = plans.map(p => `
    <tr>
      <td class="td-mono td-main">${escapeHtml(p.v.code)}</td>
      <td>
        <div style="font-weight:500">${p.taskName}</div>
        <div style="font-size:11px;color:var(--text3)">c/${p.interval.toLocaleString()} ${escapeHtml(p.unit)} · último: ${p.lastMaint.toLocaleString()} ${escapeHtml(p.unit)}</div>
      </td>
      <td><span class="badge badge-info">${p.isFork?'Por horas':'Por km'}</span></td>
      <td class="td-mono">${p.nextKm.toLocaleString()} ${escapeHtml(p.unit)}</td>
      <td class="td-mono">${p.km.toLocaleString()} ${escapeHtml(p.unit)}</td>
      <td style="width:140px">
        <div style="background:var(--bg4);border-radius:4px;height:6px;overflow:hidden">
          <div style="background:var(--${p.status});width:${p.pct}%;height:100%"></div>
        </div>
        <div style="font-size:11px;color:var(--${p.status});margin-top:2px">${p.pct}% · faltan ${Math.max(0,p.nextKm-p.km).toLocaleString()} ${escapeHtml(p.unit)}</div>
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
      💡 Hacé clic en <b>⚙ Configurar</b> en cualquier unidad para personalizar el intervalo, el km/horas del último service y la tarea.
    </div>`;
}

function openMaintConfigModal(vehicleId) {
  const v = App.data.vehicles.find(x=>x.id===vehicleId);
  if (!v) return;
  const ts = v.tech_spec || {};
  const isFork = isAutoelevador(v);
  const interval = ts.maint_interval_km || (isFork ? 250 : 15000);
  const lastKm   = ts.maint_last_km    || 0;
  const taskName = ts.maint_task_name  || 'Cambio aceite + filtros';

  openModal(`⚙ Configurar mantenimiento — ${escapeHtml(v.code)}`, `
    <div style="margin-bottom:14px;font-size:12px;color:var(--text3)">
      ${isFork ? 'Configurá el plan de mantenimiento preventivo por horas para este autoelevador.' : 'Configurá el plan de mantenimiento preventivo para esta unidad.'} Los datos se guardan en la ficha técnica.
    </div>
    <div class="form-group">
      <label class="form-label">Tarea / nombre del service</label>
      <input class="form-input" id="mc-task" value="${taskName}" placeholder="Ej: Cambio aceite + filtros">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Intervalo (cada cuántos ${isFork ? 'hs' : 'km'})</label>
        <input class="form-input" type="number" id="mc-interval" value="${interval}" placeholder="15000">
        <div style="font-size:11px;color:var(--text3);margin-top:4px">${isFork ? 'Ej: 250, 500, 1000' : 'Ej: 15000, 20000, 25000'}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${isFork ? 'Horas del último service' : 'Km del último service'}</label>
        <input class="form-input" type="number" id="mc-last" value="${lastKm}" placeholder="0">
        <div style="font-size:11px;color:var(--text3);margin-top:4px">${isFork ? 'Horas cuando hiciste el último service' : 'Km cuando hiciste el último service'}</div>
      </div>
    </div>
    <div style="background:var(--bg3);border-radius:var(--radius);padding:12px;margin-top:8px;font-size:12px;color:var(--text3)">
      <b>${isFork ? 'Horas actuales' : 'Km actuales'}:</b> ${formatVehicleMeasure(v)}<br>
      <b>Próximo service:</b> ${(parseInt(lastKm||0)+parseInt(interval||15000)).toLocaleString('es-AR')} ${isFork ? 'hs' : 'km'}
      <span id="mc-preview" style="margin-left:8px;font-weight:600"></span>
    </div>
  `, [
    { label: '💾 Guardar', cls: 'btn-primary',   fn: () => saveMaintConfig(vehicleId) },
    { label: 'Cancelar',   cls: 'btn-secondary', fn: closeModal },
  ]);

  // Preview dinámico
  ['mc-interval','mc-last'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      const int = parseInt(document.getElementById('mc-interval')?.value)||(isFork ? 250 : 15000);
      const last = parseInt(document.getElementById('mc-last')?.value)||0;
      const next = last + int;
      const pct = Math.min(100, Math.round((v.km - last) / int * 100));
      const preview = document.getElementById('mc-preview');
      if (preview) preview.textContent = `(${pct}% completado → próximo: ${next.toLocaleString('es-AR')} ${isFork ? 'hs' : 'km'})`;
    });
  });
}

async function saveMaintConfig(vehicleId) {
  const v = App.data.vehicles.find(x=>x.id===vehicleId);
  if (!v) return;

  const taskName = (document.getElementById('mc-task')?.value||'').trim() || 'Cambio aceite + filtros';
  const isFork = isAutoelevador(v);
  const interval = parseInt(document.getElementById('mc-interval')?.value) || (isFork ? 250 : 15000);
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
  showToast('ok', `Mantenimiento de ${escapeHtml(v.code)} configurado — próximo service: ${(lastKm+interval).toLocaleString('es-AR')} ${isFork ? 'hs' : 'km'}`);
  renderMaintenance();
  renderDashboard(); // actualizar alertas del panel
}


function openNewMaintModal() {
  const vehicleOpts = (App.data.vehicles||[]).map(v =>
    `<option value="${v.id}" data-code="${escapeHtml(v.code)}" data-unit="${vehicleMeasureUnit(v)}" data-isfork="${isAutoelevador(v)?'1':'0'}">${escapeHtml(v.code)} — ${escapeHtml(v.brand)} ${escapeHtml(v.model)} (${formatVehicleMeasure(v)})</option>`
  ).join('');
  openModal('Nueva tarea de mantenimiento', `
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Unidad</label>
      <select class="form-select" id="nm-veh" onchange="updateNewMaintLabels()">${vehicleOpts}</select>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Descripción de la tarea</label>
      <input class="form-input" placeholder="Ej: Cambio aceite motor + filtros" id="nm-task">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" id="nm-interval-label">Intervalo (km)</label>
        <input class="form-input" type="number" placeholder="15000" id="nm-interval" value="15000">
        <div id="nm-interval-help" style="font-size:11px;color:var(--text3);margin-top:4px">Ej: 15000, 20000, 25000</div>
      </div>
      <div class="form-group"><label class="form-label" id="nm-last-label">Km del último service</label><input class="form-input" type="number" placeholder="0" id="nm-last" value="0"></div>
    </div>
  `, [
    { label:'Guardar', cls:'btn-primary', fn: saveNewMaintTask },
    { label:'Cancelar', cls:'btn-secondary', fn: closeModal }
  ]);
  updateNewMaintLabels();
}

function updateNewMaintLabels() {
  const sel = document.getElementById('nm-veh');
  if (!sel) return;
  const opt = sel.options[sel.selectedIndex];
  const isFork = opt?.dataset?.isfork === '1';
  const intervalLabel = document.getElementById('nm-interval-label');
  const intervalHelp = document.getElementById('nm-interval-help');
  const lastLabel = document.getElementById('nm-last-label');
  const intervalInput = document.getElementById('nm-interval');
  if (intervalLabel) intervalLabel.textContent = `Intervalo (${isFork ? 'horas' : 'km'})`;
  if (intervalHelp) intervalHelp.textContent = isFork ? 'Ej: 250, 500, 1000 horas' : 'Ej: 15000, 20000, 25000 km';
  if (lastLabel) lastLabel.textContent = isFork ? 'Horas del último service' : 'Km del último service';
  if (intervalInput && (!intervalInput.value || intervalInput.value === '15000' || intervalInput.value === '250')) {
    intervalInput.value = isFork ? '250' : '15000';
    intervalInput.placeholder = isFork ? '250' : '15000';
  }
}

async function saveNewMaintTask() {
  const sel      = document.getElementById('nm-veh');
  const vehicleId = sel?.value || '';
  const task     = (document.getElementById('nm-task')?.value || '').trim();
  const code     = sel?.options[sel.selectedIndex]?.dataset?.code || '';

  if (!vehicleId) { showToast('error', 'Seleccioná una unidad'); return; }
  if (!task)      { showToast('error', 'Ingresá la descripción de la tarea'); return; }

  const v = App.data.vehicles.find(x => x.id === vehicleId);
  const isFork = isAutoelevador(v);
  const interval = parseInt(document.getElementById('nm-interval')?.value) || (isFork ? 250 : 15000);
  const lastKm   = parseInt(document.getElementById('nm-last')?.value) || 0;
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
  showToast('ok', `Tarea de mantenimiento guardada para ${code} — próximo service: ${(lastKm+interval).toLocaleString('es-AR')} ${isFork ? 'hs' : 'km'}`);
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

  showToast('ok', `OT preventiva ${escapeHtml(wo.code)} creada para ${vehicleCode}`);
  renderMaintenance();
}
