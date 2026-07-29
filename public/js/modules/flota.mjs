// ════════════════════════════════════════════════════════════════════
//  CONTROL EN VIVO DE LA FLOTA (ES module) — solo dueños
//
//  Dos pestañas:
//   · Ahora        → dónde está cada unidad en este momento.
//   · Lo que pasó  → excesos y ralentí en una línea de tiempo.
//
//  Juntas reemplazan lo que hacía el agente de WhatsApp: preguntar dónde
//  está una unidad, y el reporte periódico de alertas. La diferencia es que
//  en vez de esperar a que llegue un mensaje, está siempre acá.
//
//  Ninguna de las dos agrega llamadas a Powerfleet: todo sale de lo que el
//  sync ya guarda cada 2 minutos.
// ════════════════════════════════════════════════════════════════════
import { need, expose } from './dom.mjs';

const App = need('App');
const apiFetch = need('apiFetch');
const escapeHtml = need('escapeHtml');

const REFRESCO_MS = 30000;
let _timer = null;
let _tab = 'ahora';
let _horas = 24;

const SITUACION = {
  ruta:         { punto: '🟢', label: 'En ruta' },
  ralenti:      { punto: '🟡', label: 'Ralentí' },
  detenida:     { punto: '⚫', label: 'Detenida' },
  sin_reportar: { punto: '🔴', label: 'Sin reportar' },
};

// "hace 3 min" / "hace 2 h 10 min" — sin librerías.
function hace(min) {
  if (min === null || min === undefined) return '—';
  if (min < 1)  return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `hace ${h} h${m ? ` ${m} min` : ''}`;
}
function duracion(min) {
  if (!min) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h${m ? ` ${m} min` : ''}`;
}
function horaDe(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '--:--' : d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}
function diaDe(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia ? 'Hoy' : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

function tarjetas(items) {
  return `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
      ${items.map(([label, valor, color]) => `
        <div class="card card-sm" style="flex:1 1 120px;min-width:120px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:${color};line-height:1.15">${valor}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px">${label}</div>
        </div>`).join('')}
    </div>`;
}

function mensaje(texto, color = 'var(--text3)') {
  return `<div class="card" style="text-align:center;color:${color};padding:30px">${texto}</div>`;
}

// ── Pestaña "Ahora" ───────────────────────────────────────────────────
function filaUnidad(u) {
  const s = SITUACION[u.situacion] || SITUACION.detenida;
  let derecha;
  if (u.arrastrado) {
    // Un semi no anda solo: si se mueve es porque lo remolcan, y el ralentí no
    // aplica. Se muestra sin el énfasis de una unidad motorizada, para no
    // leerlo como un viaje aparte.
    derecha = u.situacion === 'sin_reportar'
      ? `<b style="color:var(--danger)">${hace(u.minutos_sin_reportar)}</b>`
      : `<span style="color:var(--text3)">${u.velocidad > 0 ? `remolcado · ${u.velocidad} km/h` : 'estacionado'}</span>`;
  } else if (u.situacion === 'ruta')       derecha = `<b style="color:var(--ok)">${u.velocidad} km/h</b>`;
  else if (u.situacion === 'ralenti')      derecha = `<b style="color:var(--warn)">${u.ralenti_minutos} min en ralentí</b>`;
  else if (u.situacion === 'sin_reportar') derecha = `<b style="color:var(--danger)">${hace(u.minutos_sin_reportar)}</b>`;
  else                                     derecha = `<span style="color:var(--text3)">detenida</span>`;

  const mapa = (u.lat && u.lng)
    ? `<a href="https://www.google.com/maps?q=${u.lat},${u.lng}" target="_blank" rel="noopener"
          style="color:var(--accent);text-decoration:none" title="Ver en el mapa">📍</a>`
    : '';

  return `
    <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid var(--border)">
      <span style="font-size:13px" title="${s.label}">${s.punto}</span>
      <div style="min-width:92px">
        <div style="font-weight:700;color:var(--text);font-size:14px">${escapeHtml(u.code || '—')}</div>
        ${u.base ? `<div style="font-size:11px;color:var(--text3)">${escapeHtml(u.base)}</div>` : ''}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
             title="${escapeHtml(u.direccion || '')}">
          ${u.direccion ? escapeHtml(u.direccion) : '<span style="color:var(--text3)">sin dirección</span>'} ${mapa}
        </div>
        <div style="font-size:11px;color:var(--text3)">${hace(u.minutos_sin_reportar)}</div>
      </div>
      <div style="text-align:right;font-size:13px;white-space:nowrap">${derecha}</div>
    </div>`;
}

async function renderAhora(cont) {
  let d;
  try {
    const res = await apiFetch('/api/flota/ahora');
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      cont.innerHTML = mensaje(`No se pudo cargar: ${escapeHtml(e.error || res.status)}`, 'var(--danger)');
      return;
    }
    d = await res.json();
  } catch (e) {
    cont.innerHTML = mensaje('Sin conexión con el servidor.', 'var(--danger)');
    return;
  }

  // Sin esto, una respuesta con otra forma (un HTML de error, un proxy en el
  // medio) tira una excepción sin capturar y la pantalla queda en blanco.
  if (!d || !d.resumen || !Array.isArray(d.unidades)) {
    cont.innerHTML = mensaje('El servidor devolvió una respuesta inesperada.', 'var(--danger)');
    return;
  }

  const arrastrados = Array.isArray(d.arrastrados) ? d.arrastrados : [];
  cont.innerHTML = `
    ${tarjetas([
      ['En ruta',      d.resumen.en_ruta,      'var(--ok)'],
      ['Ralentí',      d.resumen.en_ralenti,   'var(--warn)'],
      ['Detenidas',    d.resumen.detenidas,    'var(--text3)'],
      ['Sin reportar', d.resumen.sin_reportar, 'var(--danger)'],
    ])}
    <div class="card" style="padding:0;overflow:hidden">
      ${d.unidades.length
        ? d.unidades.map(filaUnidad).join('')
        : '<div style="padding:30px;text-align:center;color:var(--text3)">Ninguna unidad motorizada reportó posición todavía.</div>'}
    </div>
    ${arrastrados.length ? `
      <div style="margin-top:22px">
        <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:8px">
          🔗 Semirremolques y acoplados (${arrastrados.length})
        </div>
        <div class="card" style="padding:0;overflow:hidden">${arrastrados.map(filaUnidad).join('')}</div>
      </div>` : ''}
    <div style="font-size:12px;color:var(--text3);margin-top:16px;line-height:1.6">
      🟡 <b>Ralentí</b> es motor encendido con la unidad parada: gasoil quemado sin moverse.<br>
      🔴 <b>Sin reportar</b> son más de 30 minutos sin novedades del equipo — apagado o sin señal.<br>
      🔗 Los <b>semirremolques</b> van aparte y no entran en los números de arriba: no tienen motor,
      así que cuando se mueven es porque los está llevando uno de los camiones de la lista.
    </div>`;
}

// ── Pestaña "Lo que pasó" ─────────────────────────────────────────────
function filaEvento(e) {
  const esExceso = e.tipo === 'exceso';
  const icono = esExceso ? '⚠' : '⏸';
  const color = esExceso ? 'var(--danger)' : 'var(--warn)';

  const detalle = esExceso
    ? `<b style="color:${color}">${e.velocidad_max} km/h</b>
       <span style="color:var(--text3)">(límite ${e.limite})</span>`
    : `<b style="color:${color}">${duracion(e.duracion_min)} en ralentí</b>
       ${e.litros >= 0.1 ? `<span style="color:var(--text3)">· ~${e.litros.toFixed(1)} L</span>` : ''}`;

  const lugar = esExceso ? (e.base || '') : (e.lugar || e.base || '');

  return `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:11px 14px;border-bottom:1px solid var(--border)">
      <div style="min-width:56px;text-align:right">
        <div style="font-size:13px;font-weight:700;color:var(--text2)">${horaDe(e.cuando)}</div>
        <div style="font-size:10px;color:var(--text3)">${diaDe(e.cuando)}</div>
      </div>
      <span style="font-size:14px;color:${color}">${icono}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px">
          <b style="color:var(--text)">${escapeHtml(e.code || '—')}</b> · ${detalle}
          ${e.en_curso ? `<span style="font-size:10px;background:${color};color:#fff;border-radius:3px;padding:1px 5px;margin-left:6px">EN CURSO</span>` : ''}
        </div>
        ${lugar ? `<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(lugar)}</div>` : ''}
      </div>
      ${esExceso && e.duracion_min ? `<div style="font-size:12px;color:var(--text3);white-space:nowrap">${duracion(e.duracion_min)}</div>` : ''}
    </div>`;
}

async function renderFeed(cont) {
  let d;
  try {
    const res = await apiFetch(`/api/flota/eventos?horas=${_horas}`);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      cont.innerHTML = mensaje(`No se pudo cargar: ${escapeHtml(e.error || res.status)}`, 'var(--danger)');
      return;
    }
    d = await res.json();
  } catch (e) {
    cont.innerHTML = mensaje('Sin conexión con el servidor.', 'var(--danger)');
    return;
  }

  if (!d || !d.resumen || !Array.isArray(d.eventos)) {
    cont.innerHTML = mensaje('El servidor devolvió una respuesta inesperada.', 'var(--danger)');
    return;
  }

  const periodo = (h, label) => `
    <button class="btn btn-sm ${_horas === h ? 'btn-primary' : 'btn-secondary'}"
            onclick="cambiarPeriodoFlota(${h})">${label}</button>`;

  cont.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
      ${periodo(8, 'Últimas 8 h')}${periodo(24, '24 horas')}${periodo(72, '3 días')}${periodo(168, '7 días')}
    </div>
    ${tarjetas([
      ['Excesos',        d.resumen.excesos,                              'var(--danger)'],
      ['Vel. máxima',    d.resumen.velocidad_max ? d.resumen.velocidad_max + '<span style="font-size:13px"> km/h</span>' : '—', 'var(--danger)'],
      ['Ralentí',        duracion(d.resumen.ralenti_minutos),            'var(--warn)'],
      ['Gasoil parado',  '~' + (d.resumen.ralenti_litros || 0).toFixed(1) + '<span style="font-size:13px"> L</span>', 'var(--warn)'],
    ])}
    <div class="card" style="padding:0;overflow:hidden">
      ${d.eventos.length
        ? d.eventos.map(filaEvento).join('')
        : '<div style="padding:30px;text-align:center;color:var(--text3)">Sin excesos ni ralentí en el período. 👌</div>'}
    </div>
    <div style="font-size:12px;color:var(--text3);margin-top:16px;line-height:1.6">
      Los litros de ralentí son una <b>estimación</b>: se calculan con el consumo por hora de cada
      modelo, no con una medición del tanque.<br>
      Los semirremolques no aparecen acá: no tienen motor, así que no generan exceso ni ralentí.
    </div>`;
}

// ── Armado de la pantalla ─────────────────────────────────────────────
async function renderFlotaAhora() {
  const root = document.getElementById('page-flota');
  if (!root) return;

  const tabBtn = (id, label) => `
    <button class="btn btn-sm ${_tab === id ? 'btn-primary' : 'btn-secondary'}"
            onclick="mostrarTabFlota('${id}')">${label}</button>`;

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:12px">
      <div>
        <h2 style="font-size:20px;font-weight:700;margin:0;color:var(--text)">🛰️ Control en vivo</h2>
        <p style="font-size:13px;color:var(--text3);margin:4px 0 0" id="flota-sub"></p>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${tabBtn('ahora', '📍 Ahora')}${tabBtn('feed', '📋 Lo que pasó')}
        <button class="btn btn-secondary btn-sm" onclick="renderFlotaAhora()">↻</button>
      </div>
    </div>
    <div id="flota-cont">${mensaje('Cargando…')}</div>`;

  const cont = document.getElementById('flota-cont');
  const sub = document.getElementById('flota-sub');
  if (_tab === 'feed') {
    if (sub) sub.textContent = 'Excesos y ralentí, del más reciente al más viejo';
    await renderFeed(cont);
  } else {
    if (sub) sub.textContent = 'Dónde está cada unidad · se refresca sola cada 30 s';
    await renderAhora(cont);
  }
  programarRefresco();
}

function mostrarTabFlota(tab) { _tab = tab; renderFlotaAhora(); }
function cambiarPeriodoFlota(horas) { _horas = horas; renderFlotaAhora(); }

// Un solo timer vivo, solo mientras la sección esté abierta y solo en la
// pestaña "Ahora": el feed mira el pasado, no necesita refrescarse solo.
function programarRefresco() {
  if (_timer) clearTimeout(_timer);
  _timer = null;
  if (_tab !== 'ahora') return;
  _timer = setTimeout(() => {
    if (App.currentPage !== 'flota' || _tab !== 'ahora') { _timer = null; return; }
    renderFlotaAhora();
  }, REFRESCO_MS);
}

expose('renderFlotaAhora', renderFlotaAhora);
expose('mostrarTabFlota', mostrarTabFlota);
expose('cambiarPeriodoFlota', cambiarPeriodoFlota);
