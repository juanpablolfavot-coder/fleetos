// ════════════════════════════════════════════════════════════════════
//  ACTIVOS PATRIMONIALES (ES module, Fase 3) — edificios, herramientas,
//  equipos, etc.: alta, edición, baja y ficha completa.
//
//  Migrado de assets.js. Dependencias legacy declaradas con need(); las
//  funciones públicas se re-exponen en window para el dispatcher y los onclick.
// ════════════════════════════════════════════════════════════════════
import { need, expose } from './dom.mjs';

const App = need('App');
const userHasRole = need('userHasRole');
const escapeHtml = need('escapeHtml');
const openModal = need('openModal');
const closeModal = need('closeModal');
const showToast = need('showToast');
const apiFetch = need('apiFetch');
const afterSave = need('afterSave');

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
      <td class="td-mono"><a onclick="openAssetDetailModal('${a.id}')" style="color:var(--accent);cursor:pointer;text-decoration:underline;font-weight:600">${escapeHtml(a.code)}</a></td>
      <td><b>${escapeHtml(a.name)}</b></td>
      <td>${typeLabels[a.type] || a.type}</td>
      <td>${a.location ? escapeHtml(a.location) : '<span style="color:var(--text3)">—</span>'}</td>
      <td><span style="color:${statusColors[a.status]};font-weight:600">● ${statusLabels[a.status] || a.status}</span></td>
      <td>${a.brand || a.model ? `${escapeHtml(a.brand || '')} ${escapeHtml(a.model || '')}`.trim() : '<span style="color:var(--text3)">—</span>'}</td>
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
    await afterSave({ page: 'assets' });
  } catch(err) {
    showToast('error', err.message);
  }
}

function openEditAssetModal(id) {
  const a = (App.data.assets || []).find(x => x.id === id);
  if (!a) { showToast('error', 'Activo no encontrado'); return; }

  openModal(`Editar activo — ${escapeHtml(a.code)}`, `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Código</label>
        <input class="form-input" id="ea-code" value="${escapeHtml(a.code)}" readonly style="background:var(--bg3)">
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
      <textarea class="form-textarea" id="ea-notes">${escapeHtml(a.notes||'')}</textarea>
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
    await afterSave({ page: 'assets' });
  } catch(err) {
    showToast('error', err.message);
  }
}

async function deleteAsset(id) {
  const a = (App.data.assets || []).find(x => x.id === id);
  if (!a) return;
  if (!confirm(`¿Eliminar el activo "${escapeHtml(a.name)}" (${escapeHtml(a.code)})?\n\nEsta acción lo desactiva. Si tiene OTs asociadas, se conservan en el historial.`)) return;

  try {
    const res = await apiFetch(`/api/assets/${id}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json(); showToast('error', e.error || 'Error'); return; }
    showToast('ok', `Activo ${escapeHtml(a.code)} eliminado`);
    await afterSave({ page: 'assets' });
  } catch(err) {
    showToast('error', err.message);
  }
}

// ── Ficha completa del activo (modal de detalle) ──
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

  openModal(`🏗️ ${escapeHtml(a.code)} — ${escapeHtml(a.name)}`, `
    <!-- Header con foto placeholder + info principal -->
    <div style="display:grid;grid-template-columns:auto 1fr;gap:20px;margin-bottom:20px">
      <div style="width:120px;height:120px;background:var(--bg3);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:52px">
        ${(typeLabels[a.type] || '📦').split(' ')[0]}
      </div>
      <div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${typeLabels[a.type] || 'Activo'}</div>
        <div style="font-size:20px;font-weight:700;color:var(--text);margin-bottom:4px">${escapeHtml(a.name)}</div>
        <div style="font-size:13px;color:var(--text3);margin-bottom:10px">
          ${escapeHtml(a.brand || '')} ${escapeHtml(a.model || '')} ${a.serial_no ? ` · S/N: ${a.serial_no}` : ''}
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
        <div style="font-size:14px;font-weight:700;margin-top:4px">${escapeHtml(a.location || '—')}</div>
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
        <div><span style="color:var(--text3);font-size:11px">Código interno:</span> <b>${escapeHtml(a.code)}</b></div>
        <div><span style="color:var(--text3);font-size:11px">Categoría:</span> ${a.category || '—'}</div>
        <div><span style="color:var(--text3);font-size:11px">Marca:</span> ${escapeHtml(a.brand || '—')}</div>
        <div><span style="color:var(--text3);font-size:11px">Modelo:</span> ${escapeHtml(a.model || '—')}</div>
        <div><span style="color:var(--text3);font-size:11px">N° de serie:</span> <span class="td-mono">${a.serial_no || '—'}</span></div>
        <div><span style="color:var(--text3);font-size:11px">Fecha de compra:</span> ${a.purchase_date ? a.purchase_date.slice(0,10) : '—'}</div>
        <div style="grid-column:span 2"><span style="color:var(--text3);font-size:11px">Garantía:</span> <span style="color:${garantiaColor};font-weight:600">${garantiaStatus}</span></div>
      </div>
    </div>

    ${a.notes ? `
      <div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">📝 Notas</div>
        <div style="background:var(--bg3);padding:10px 14px;border-radius:var(--radius);font-size:13px;color:var(--text)">
          ${escapeHtml(a.notes)}
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
                <td style="padding:6px;font-family:var(--mono);font-weight:600">${escapeHtml(o.code || o.id.substring(0,8))}</td>
                <td style="padding:6px">${(o.opened || '—').toString().slice(0,10)}</td>
                <td style="padding:6px">${escapeHtml(((o.desc || o.description || '—')+'').substring(0,40))}</td>
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

// Puente con el mundo legacy (dispatcher renderPage + onclick).
expose('renderAssets', renderAssets);
expose('_filterAssets', _filterAssets);
expose('openNewAssetModal', openNewAssetModal);
expose('saveNewAsset', saveNewAsset);
expose('openEditAssetModal', openEditAssetModal);
expose('saveEditAsset', saveEditAsset);
expose('deleteAsset', deleteAsset);
expose('openAssetDetailModal', openAssetDetailModal);

export { renderAssets, _filterAssets, openNewAssetModal, saveNewAsset, openEditAssetModal, saveEditAsset, deleteAsset, openAssetDetailModal };
