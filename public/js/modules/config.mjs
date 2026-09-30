// ════════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN DEL SISTEMA (ES module, Fase 3 — migrado desde app.js).
//
//  Pantalla de Config: bases operativas, tipos de vehículo y nota de mano de
//  obra interna. Incluye el modal "Configuración de la cuenta" (solo dueño).
//  Se re-exponen en window (ver dom.mjs) para que el dispatcher renderPage y
//  los onclick="..." las sigan encontrando mientras app.js es legacy global.
// ════════════════════════════════════════════════════════════════════
import { expose } from './dom.mjs';

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

    <!-- PLAZOS OBJETIVO (tiempos de respuesta) -->
    ${_cfgPlazosCard()}

    <!-- MANO DE OBRA INTERNA -->
    <div class="card" style="max-width:900px;border-left:3px solid var(--accent)">
      <div class="card-title">⏱️ Mano de obra interna</div>
      <div style="font-size:12px;color:var(--text3);line-height:1.6">
        La mano de obra propia del taller se registra por <b>partes de trabajo y horas</b>.
        No se valoriza con precio dentro de la OT.
        Si un trabajo sale a un externo, la OT genera una <b>OC pendiente para Compras</b>, donde se cotiza y negocia.
      </div>
    </div>`;
}

// Plazos objetivo por etapa, en días, para el panel "Tiempos de respuesta".
const CFG_PLAZOS = [
  ['oc_cotizar',       'Compras',               'OC: pedido → cotizada'],
  ['oc_aprobar',       'Gerencia / Compras',    'OC: cotizada → aprobada'],
  ['oc_pagar',         'Tesorería',             'OC: aprobada → pagada'],
  ['oc_recibir',       'Proveedor / Recepción', 'OC: aprobada → recibida'],
  ['oc_total',         'Todas',                 'OC: pedido → recibida (total)'],
  ['ot_iniciar',       'Taller',                'OT: abierta → en proceso'],
  ['ot_cerrar',        'Taller',                'OT: en proceso → cerrada'],
  ['ot_total',         'Todas',                 'OT: abierta → cerrada (total)'],
  ['fuel_verificar',   'Verificación',          'Combustible: carga → ticket verificado'],
  ['despacho_recibir', 'Sucursal',              'Despacho: despachado → recibido'],
];
function _cfgPlazosCard() {
  const p = App.config?.sla_plazos || {};
  return `<div class="card" style="max-width:900px;margin-bottom:20px">
    <div class="card-title">⏱ Plazos objetivo por etapa (días)</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:14px">Se usan en el panel <b>Tiempos de respuesta</b> para el semáforo y el % cumplido. Admite decimales (0,5 = medio día).</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px 16px;margin-bottom:14px">
      ${CFG_PLAZOS.map(([k, area, label]) => `
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;font-size:12px"><b>${label}</b><br><span style="color:var(--text3);font-size:11px">${area}</span></div>
          <input class="form-input" type="number" step="0.5" min="0" id="cfg-plazo-${k}" value="${p[k] ?? ''}" style="width:80px;text-align:right">
        </div>`).join('')}
    </div>
    <button class="btn btn-primary" onclick="saveConfig()">Guardar cambios</button>
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

  // Plazos objetivo (solo si la card está en pantalla)
  if (document.getElementById('cfg-plazo-oc_total')) {
    const sla = {};
    CFG_PLAZOS.forEach(([k]) => { const v = parseFloat(document.getElementById('cfg-plazo-' + k)?.value); if (Number.isFinite(v) && v >= 0) sla[k] = v; });
    payload.sla_plazos = sla;
  }

  const res = await apiFetch('/api/config', { method:'PUT', body: JSON.stringify(payload) });
  if (!res.ok) { showToast('error','Error al guardar configuración'); return; }
  if (payload.sla_plazos) App.config.sla_plazos = { ...(App.config.sla_plazos || {}), ...payload.sla_plazos };
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

// Puente con el mundo legacy (renderPage dispatcher + onclick="...").
expose('renderConfig', renderConfig);
expose('addCfgBase', addCfgBase);
expose('removeCfgBase', removeCfgBase);
expose('addCfgType', addCfgType);
expose('removeCfgType', removeCfgType);
expose('saveConfig', saveConfig);
expose('openAccountConfigModal', openAccountConfigModal);
