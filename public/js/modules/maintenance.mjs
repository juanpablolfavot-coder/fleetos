// ════════════════════════════════════════════════════════════════════
//  MANTENIMIENTO PREVENTIVO — planes por unidad.
//
//  Antes esta pantalla guardaba su configuración adentro del JSONB
//  vehicles.tech_spec: UN plan por unidad, calculado en el navegador y sin nadie
//  que avisara. Ahora usa /api/mantenimiento/planes, que soporta VARIOS planes
//  por unidad (aceite cada 15.000 km, correa cada 60.000, matafuegos por fecha),
//  tres tipos de contador y aviso por push.
//
//  Lo que ya estaba configurado NO se perdió: la migración 004 lo importó.
//
//  El estado lo calcula el SERVIDOR, no esta pantalla. Así el aviso que llega al
//  celular y lo que se ve acá no pueden dar distinto — mismo criterio que usa
//  services/flota-datos.js para que el asistente y la pantalla de flota no se
//  contradigan.
// ════════════════════════════════════════════════════════════════════
import { need, expose } from './dom.mjs';

const App = need('App');
const escapeHtml = need('escapeHtml');
const openModal = need('openModal');
const closeModal = need('closeModal');
const showToast = need('showToast');
const apiFetch = need('apiFetch');
const renderDashboard = need('renderDashboard');

const ESTADOS = {
  vencido:  { badge: 'danger', label: 'Pasado',   orden: 0 },
  proximo:  { badge: 'warn',   label: 'Próximo',  orden: 1 },
  sin_base: { badge: 'info',   label: 'Sin base', orden: 2 },
  ok:       { badge: 'ok',     label: 'Al día',   orden: 3 },
};

const puedeEditar = () => ['dueno', 'gerencia', 'jefe_mantenimiento'].includes(App.currentUser?.role);

// Para el modal, donde todavía no hay respuesta del servidor: ahí lo único que
// se tiene es el tipo elegido en el <select>.
function _unidadDe(tipo) { return tipo === 'km' ? 'km' : tipo === 'horas' ? 'h' : 'días'; }

// Para un plan que YA vino del servidor, se usa la etiqueta que él mandó. Las
// dos definiciones coinciden hoy, y justamente por eso conviene no tener dos:
// si mañana el servidor agrega un tipo, la pantalla lo dibuja igual en vez de
// caer al default. El || cubre los planes 'sin_base', que no traen el campo.
function _unidadDePlan(p) { return p.unidad_medida || _unidadDe(p.tipo); }

// Cuánto del intervalo ya se consumió, para la barra. Un plan sin base no tiene
// barra: no hay contra qué medir.
function _pct(p) {
  if (p.estado === 'sin_base' || p.restante == null) return null;
  const usado = p.intervalo - p.restante;
  return Math.max(0, Math.min(100, Math.round((usado / p.intervalo) * 100)));
}

function _cuanto(p) {
  if (p.estado === 'sin_base') return 'falta cargar el último service';
  const u = _unidadDePlan(p);
  if (p.restante < 0) return `pasado por ${Math.abs(p.restante).toLocaleString('es-AR')} ${u}`;
  if (p.restante === 0) return 'toca AHORA';
  return `faltan ${p.restante.toLocaleString('es-AR')} ${u}`;
}

// ── Pantalla ──────────────────────────────────────────────────────────
function renderMaintenance() {
  const root = document.getElementById('page-maintenance');
  if (!root) return;
  root.innerHTML = _cabecera() + `
    <div class="card" style="text-align:center;padding:40px;color:var(--text3)">Cargando planes…</div>`;
  _cargar();
}

function _cabecera(resumen) {
  const r = resumen || {};
  const tarjeta = (n, txt, color) => `
    <div class="card" style="padding:12px 16px;flex:1;min-width:120px">
      <div style="font-size:22px;font-weight:800;color:var(--${color})">${n == null ? '—' : n}</div>
      <div style="font-size:12px;color:var(--text3)">${txt}</div>
    </div>`;
  return `
    <div class="section-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div>
        <h2 style="font-size:18px;font-weight:700;margin:0">Plan de mantenimiento</h2>
        <p style="font-size:13px;color:var(--text3);margin:4px 0 0">
          Avisa antes de que toque. No abre órdenes solo: eso lo decidís vos.
        </p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${puedeEditar() ? '<button class="btn btn-primary" onclick="openPlanMantModal()">+ Nuevo plan</button>' : ''}
        ${puedeEditar() ? '<button class="btn btn-secondary" onclick="crearOTsDeVencidos()">🔧 Crear OTs de los pasados</button>' : ''}
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      ${tarjeta(r.vencido, 'Pasados', 'danger')}
      ${tarjeta(r.proximo, 'Próximos', 'warn')}
      ${tarjeta(r.ok, 'Al día', 'ok')}
      ${tarjeta(r.sin_base, 'Sin base', 'info')}
    </div>`;
}

async function _cargar() {
  const root = document.getElementById('page-maintenance');
  if (!root) return;
  let planes = [];
  try {
    const res = await apiFetch('/api/mantenimiento/planes');
    if (!res.ok) throw new Error('no se pudo');
    const datos = await res.json();
    // Si el endpoint devolviera algo que no es lista, no romper la pantalla entera.
    planes = Array.isArray(datos) ? datos : [];
  } catch (_) {
    root.innerHTML = _cabecera() + `
      <div class="card" style="text-align:center;padding:40px;color:var(--text3)">
        No se pudieron cargar los planes. Probá recargar la página.
      </div>`;
    return;
  }

  window._planesMant = planes;   // lo leen los onclick por id
  const resumen = planes.reduce((a, p) => { a[p.estado] = (a[p.estado] || 0) + 1; return a; }, {});

  if (!planes.length) {
    root.innerHTML = _cabecera(resumen) + `
      <div class="card" style="text-align:center;padding:40px;color:var(--text3)">
        <div style="font-size:32px;margin-bottom:12px">🔧</div>
        <div style="font-weight:600;margin-bottom:8px">Todavía no hay planes cargados</div>
        <div style="font-size:13px;max-width:460px;margin:0 auto;line-height:1.6">
          Un plan es "cada cuánto toca": cambio de aceite cada 15.000 km, correa cada 60.000,
          matafuegos una vez por año. El sistema mira solo el odómetro y el horómetro, que ya se
          actualizan con el GPS y con cada carga de combustible.
        </div>
        ${puedeEditar() ? '<div style="margin-top:18px"><button class="btn btn-primary" onclick="openPlanMantModal()">+ Cargar el primero</button></div>' : ''}
      </div>`;
    return;
  }

  // Lo que exige acción va arriba.
  planes.sort((a, b) => (ESTADOS[a.estado].orden - ESTADOS[b.estado].orden)
    || (a.restante == null ? 1e9 : a.restante) - (b.restante == null ? 1e9 : b.restante)
    || String(a.unidad).localeCompare(String(b.unidad)));

  const filas = planes.map((p) => {
    const est = ESTADOS[p.estado] || ESTADOS.ok;
    const pct = _pct(p);
    const u = _unidadDePlan(p);
    return `
      <tr>
        <td class="td-mono td-main">${escapeHtml(p.unidad)}</td>
        <td>
          <div style="font-weight:500">${escapeHtml(p.nombre)}</div>
          <div style="font-size:11px;color:var(--text3)">
            cada ${p.intervalo.toLocaleString('es-AR')} ${escapeHtml(u)}${p.aviso_antes ? ` · avisa ${p.aviso_antes.toLocaleString('es-AR')} ${escapeHtml(u)} antes` : ''}
          </div>
        </td>
        <td><span class="badge badge-info">${p.tipo === 'km' ? 'Por km' : p.tipo === 'horas' ? 'Por horas' : 'Por fecha'}</span></td>
        <td class="td-mono">${p.proximo == null ? '—' : escapeHtml(String(p.proximo))}</td>
        <td class="td-mono">${p.actual == null ? '—' : p.actual.toLocaleString('es-AR')}</td>
        <td style="width:150px">
          ${pct == null ? '<span style="font-size:11px;color:var(--text3)">sin línea de base</span>' : `
            <div style="background:var(--bg4);border-radius:4px;height:6px;overflow:hidden">
              <div style="background:var(--${est.badge});width:${pct}%;height:100%"></div>
            </div>`}
          <div style="font-size:11px;color:var(--${est.badge});margin-top:2px">${escapeHtml(_cuanto(p))}</div>
        </td>
        <td><span class="badge badge-${est.badge}">${est.label}</span></td>
        <td style="white-space:nowrap">
          ${puedeEditar() ? `
            <button class="btn btn-secondary btn-sm" onclick="marcarMantRealizado('${p.id}')" title="Mover la línea de base al contador actual">✓ Ya se hizo</button>
            <button class="btn btn-secondary btn-sm" onclick="openPlanMantModal('${p.id}')">✎</button>
            <button class="btn btn-secondary btn-sm" onclick="bajaPlanMant('${p.id}')">🗑</button>` : ''}
        </td>
      </tr>`;
  }).join('');

  root.innerHTML = _cabecera(resumen) + `
    <div class="card" style="padding:0;overflow:hidden">
      <div style="overflow-x:auto">
        <table class="table">
          <thead><tr>
            <th>Unidad</th><th>Plan</th><th>Tipo</th><th>Próximo</th><th>Actual</th><th>Progreso</th><th>Estado</th><th></th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Alta / edición ────────────────────────────────────────────────────
function openPlanMantModal(planId) {
  const p = planId ? (window._planesMant || []).find((x) => x.id === planId) : null;
  const vehiculos = (App.data.vehicles || []).map((v) => {
    const sel = p && p.vehicle_id === v.id ? ' selected' : '';
    return `<option value="${v.id}"${sel}>${escapeHtml(v.code || '')} — ${escapeHtml(v.plate || '')}</option>`;
  }).join('');

  openModal(p ? 'Editar plan' : 'Nuevo plan de mantenimiento', `
    <div class="form-group">
      <label class="form-label">Unidad</label>
      <select class="form-select" id="pm-vehiculo"${p ? ' disabled' : ''}>${vehiculos}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Qué se hace</label>
      <input class="form-input" id="pm-nombre" placeholder="Cambio de aceite y filtros" value="${p ? escapeHtml(p.nombre) : ''}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Se mide en</label>
        <select class="form-select" id="pm-tipo" onchange="actualizarUnidadPlanMant()">
          <option value="km"${p && p.tipo === 'km' ? ' selected' : ''}>Kilómetros</option>
          <option value="horas"${p && p.tipo === 'horas' ? ' selected' : ''}>Horas de motor</option>
          <option value="dias"${p && p.tipo === 'dias' ? ' selected' : ''}>Días</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Cada cuánto <span id="pm-u1" style="color:var(--text3)"></span></label>
        <input class="form-input" type="number" min="1" id="pm-intervalo" placeholder="15000" value="${p ? p.intervalo : ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Avisar antes <span id="pm-u2" style="color:var(--text3)"></span></label>
        <input class="form-input" type="number" min="0" id="pm-aviso" placeholder="1000" value="${p ? p.aviso_antes : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Último service <span id="pm-u3" style="color:var(--text3)"></span></label>
        <input class="form-input" id="pm-base" placeholder="180000">
      </div>
    </div>
    <div style="font-size:12px;color:var(--text3);line-height:1.6;background:var(--bg3);border-radius:var(--radius);padding:10px">
      El <b>último service</b> es dónde estaba el contador la última vez que se hizo. Sin ese dato el
      plan queda como "sin base" y no avisa — a propósito: preferimos no decir nada antes que
      inventar un número sobre un motor.
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="guardarPlanMant('${planId || ''}')">Guardar</button>
    </div>`);

  // La base es una fecha cuando el plan va por días, y un número si no.
  const base = document.getElementById('pm-base');
  if (base && p) base.value = p.tipo === 'dias' ? (p.ultima_fecha || '') : (p.ultimo_valor == null ? '' : p.ultimo_valor);
  // Con qué valor se abrió el campo. guardarPlanMant() solo manda la línea de
  // base si CAMBIÓ, así un campo que nadie tocó no puede borrarla — ni siquiera
  // si el servidor dejara de mandar ultimo_valor y el campo abriera vacío, que
  // es exactamente como se rompió la primera vez.
  window._baseMantOriginal = base ? base.value : '';
  actualizarUnidadPlanMant();
}

// Las etiquetas cambian con el tipo: "cada 15.000 km" vs "cada 180 días".
function actualizarUnidadPlanMant() {
  const tipo = document.getElementById('pm-tipo')?.value || 'km';
  const u = _unidadDe(tipo);
  ['pm-u1', 'pm-u2'].forEach((id) => { const e = document.getElementById(id); if (e) e.textContent = `(${u})`; });
  const u3 = document.getElementById('pm-u3');
  if (u3) u3.textContent = tipo === 'dias' ? '(fecha)' : `(${u})`;
  const base = document.getElementById('pm-base');
  if (base) {
    base.type = tipo === 'dias' ? 'date' : 'number';
    base.placeholder = tipo === 'dias' ? '' : tipo === 'horas' ? '3000' : '180000';
  }
}

async function guardarPlanMant(planId) {
  const tipo = document.getElementById('pm-tipo')?.value || 'km';
  const base = (document.getElementById('pm-base')?.value || '').trim();
  const cuerpo = {
    nombre: (document.getElementById('pm-nombre')?.value || '').trim(),
    tipo,
    intervalo: document.getElementById('pm-intervalo')?.value,
    aviso_antes: document.getElementById('pm-aviso')?.value || 0,
  };
  // La línea de base solo viaja si la tocaron. El PUT es parcial: lo que no se
  // manda, no se toca. Borrarla sigue siendo posible —vaciar el campo a
  // propósito es una acción legítima, "ya no sé cuál era"— pero deja de ser algo
  // que pasa solo por abrir el modal y apretar Guardar.
  const cambioLaBase = !planId || base !== String(window._baseMantOriginal ?? '').trim();
  if (cambioLaBase) {
    if (tipo === 'dias') cuerpo.ultima_fecha = base || null;
    else cuerpo.ultimo_valor = base === '' ? null : base;
  }
  if (!planId) cuerpo.vehicle_id = document.getElementById('pm-vehiculo')?.value;

  const res = await apiFetch(planId ? `/api/mantenimiento/planes/${planId}` : '/api/mantenimiento/planes', {
    method: planId ? 'PUT' : 'POST',
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    showToast('error', e.error || 'No se pudo guardar el plan');
    return;
  }
  closeModal();
  showToast('ok', planId ? 'Plan actualizado' : 'Plan creado');
  renderMaintenance();
}

// "Ya se hizo": mueve la línea de base al contador actual de la unidad. Es la
// operación de todos los días — sin esto el plan queda pasado para siempre.
async function marcarMantRealizado(planId) {
  const p = (window._planesMant || []).find((x) => x.id === planId);
  if (p && !confirm(`¿Registrar que se hizo "${p.nombre}" en ${p.unidad}?\n\nLa cuenta arranca de nuevo desde el valor actual.`)) return;
  const res = await apiFetch(`/api/mantenimiento/planes/${planId}/realizado`, { method: 'POST', body: '{}' });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    showToast('error', e.error || 'No se pudo registrar');
    return;
  }
  showToast('ok', 'Registrado. La cuenta arranca de nuevo.');
  renderMaintenance();
  renderDashboard();
}

async function bajaPlanMant(planId) {
  const p = (window._planesMant || []).find((x) => x.id === planId);
  if (!confirm(`¿Dar de baja el plan${p ? ` "${p.nombre}" de ${p.unidad}` : ''}?`)) return;
  const res = await apiFetch(`/api/mantenimiento/planes/${planId}`, { method: 'DELETE' });
  if (!res.ok) { showToast('error', 'No se pudo dar de baja'); return; }
  showToast('ok', 'Plan dado de baja');
  renderMaintenance();
}

// ── OTs de lo que ya está pasado ──────────────────────────────────────
// Sigue siendo un botón, no algo automático: que aparezcan órdenes que nadie
// cargó ensucia los KPI de mantenimiento y los costos del mes.
async function crearOTsDeVencidos() {
  const pasados = (window._planesMant || []).filter((p) => p.estado === 'vencido');
  if (!pasados.length) { showToast('warn', 'No hay mantenimientos pasados'); return; }
  if (!confirm(`Se van a crear ${pasados.length} orden(es) de trabajo preventivas. ¿Seguir?`)) return;

  let creadas = 0, errores = 0;
  for (const p of pasados) {
    const res = await apiFetch('/api/workorders', {
      method: 'POST',
      body: JSON.stringify({
        vehicle_id: p.vehicle_id,
        type: 'Preventivo',
        priority: 'Normal',
        description: `${p.nombre} — mantenimiento programado (${_cuanto(p)})`,
      }),
    });
    if (res.ok) creadas++; else errores++;
    await new Promise((r) => setTimeout(r, 100));   // no saturar el server
  }
  showToast(errores ? 'warn' : 'ok', `${creadas} OT(s) creadas${errores ? ` · ${errores} con error` : ''}`);
  renderMaintenance();
}

// Puente con el mundo legacy (dispatcher renderPage + onclick).
expose('renderMaintenance', renderMaintenance);
expose('openPlanMantModal', openPlanMantModal);
expose('actualizarUnidadPlanMant', actualizarUnidadPlanMant);
expose('guardarPlanMant', guardarPlanMant);
expose('marcarMantRealizado', marcarMantRealizado);
expose('bajaPlanMant', bajaPlanMant);
expose('crearOTsDeVencidos', crearOTsDeVencidos);

export {
  renderMaintenance, openPlanMantModal, actualizarUnidadPlanMant,
  guardarPlanMant, marcarMantRealizado, bajaPlanMant, crearOTsDeVencidos,
};
