// ════════════════════════════════════════════════════════════════════
//  DOCUMENTACIÓN — vencimientos de documentos (vehículos y entidades): alta, edición, renovación.
//  Extraído de app.js para mantenerlo manejable. Todas las funciones son
//  globales (se llaman desde onclick= y desde el dispatcher renderPage en
//  app.js). Este archivo se carga DESPUÉS de app.js, así que usa sus
//  helpers globales (escapeHtml, apiFetch, openModal, showToast, userHasRole,
//  App.data, etc.).
// ════════════════════════════════════════════════════════════════════
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
              <td class="td-mono" style="color:var(--text3);font-size:11px">${escapeHtml(d.plate||'—')}</td>
              <td>${d.type}</td>
              <td class="td-mono">${d.expiry}</td>
              <td class="td-mono" style="color:var(--${d.status==='danger'?'danger':d.status==='warn'?'warn':'ok'})">
                ${days<0?'Vencido hace '+Math.abs(days)+' días':days+' días'}
              </td>
              <td style="font-size:11px;color:var(--text3)">${d.ref||'—'}</td>
              <td><span class="badge ${d.status==='ok'?'badge-ok':d.status==='warn'?'badge-warn':'badge-danger'}">${d.status==='ok'?'Vigente':d.status==='warn'?'Por vencer':'Vencido'}</span></td>
              <td style="white-space:nowrap;display:flex;gap:4px;padding:8px 6px;flex-wrap:wrap">
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
      <input class="form-input" placeholder="ABC 123" id="ed-plate" value="${escapeHtml(d.plate||'')}">
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

  const vehOpts = vehiculos.map(v => `<option value="${v.id}" data-code="${escapeHtml(v.code)}" data-plate="${escapeHtml(v.plate||'')}">${escapeHtml(v.code)} — ${escapeHtml(v.plate||'sin patente')} · ${escapeHtml(v.brand||'')} ${escapeHtml(v.model||'')}</option>`).join('');
  const userOpts = choferes.map(u => `<option value="${u.id}" data-name="${escapeHtml(u.name)}">${escapeHtml(u.name)} · ${u.role}</option>`).join('');

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
    await afterSave({ page: 'documents' });
  } catch(err) {
    showToast('error', err.message);
  }
}
