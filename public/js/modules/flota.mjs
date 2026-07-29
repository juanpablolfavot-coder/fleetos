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
// Evento que hay que resaltar: viene de tocar una notificación de exceso, o de
// tocar una línea del último resumen. Se limpia apenas el usuario navega solo.
let _evento = null;
let _ampliado = false;   // ya se intentó ensanchar el período buscando _evento

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

// ── El último resumen, arriba de todo ─────────────────────────────────
// La notificación de las 20:06 dice "AF823RB 129 km/h · AF614LB 12 min en
// ralentí" y después se va de la bandeja. Sin esto hay que buscar esas dos
// cosas a mano en el feed, una por una. Acá quedan a la vista y cada una
// lleva de un toque a su evento. Se reemplaza sola cuando entra el resumen
// siguiente; los excesos igual quedan todos en "Lo que pasó".
function lineaResumen(icono, color, id, texto, sub) {
  const clickable = !!id;
  return `
    <div ${clickable ? `onclick="irAEventoFlota('${escapeHtml(String(id))}')" role="button" tabindex="0"` : ''}
         style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-top:1px solid var(--border)
                ${clickable ? ';cursor:pointer' : ''}">
      <span style="font-size:13px;color:${color}">${icono}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--text)">${texto}</div>
        ${sub ? `<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sub}</div>` : ''}
      </div>
      ${clickable ? '<span style="color:var(--text3);font-size:15px">›</span>' : ''}
    </div>`;
}

function tarjetaResumen(r) {
  if (!r) return '';
  const filas = [];
  for (const e of (r.excesos || [])) {
    filas.push(lineaResumen('⚠', 'var(--danger)', e.id,
      `<b>${escapeHtml(e.code || '—')}</b> a <b style="color:var(--danger)">${e.kmh} km/h</b>
       <span style="color:var(--text3)">(límite ${e.limite})</span>`,
      [horaDe(e.cuando), e.base ? escapeHtml(e.base) : ''].filter(Boolean).join(' · ')));
  }
  for (const i of (r.ralentis || [])) {
    filas.push(lineaResumen('⏸', 'var(--warn)', i.id,
      `<b>${escapeHtml(i.code || '—')}</b> <b style="color:var(--warn)">${duracion(i.minutos)} en ralentí</b>`,
      [horaDe(i.cuando), escapeHtml(i.lugar || i.base || '')].filter(Boolean).join(' · ')));
  }

  const est = r.estado || {};
  const foto = [`${est.en_ruta || 0} en ruta`, `${est.detenidas || 0} detenidas`];
  if (est.en_ralenti)   foto.push(`${est.en_ralenti} en ralentí`);
  if (est.sin_reportar) foto.push(`${est.sin_reportar} sin reportar`);

  return `
    <div class="card" style="margin-bottom:18px;border-left:3px solid var(--accent)">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="font-size:14px;font-weight:700;color:var(--text)">🚛 Resumen de las ${escapeHtml(r.hora || '')}</div>
        <div style="font-size:11px;color:var(--text3)">${hace(r.minutos_atras)}</div>
      </div>
      ${filas.length
        ? filas.join('')
        : `<div style="padding:9px 4px;border-top:1px solid var(--border);font-size:13px;color:var(--text3)">
             Sin excesos ni ralentí en el período. 👌</div>`}
      <div style="border-top:1px solid var(--border);padding-top:9px;margin-top:2px;font-size:12px;color:var(--text3)">
        ${foto.join(' · ')}${r.litros >= 1 ? ` · ralentí del período ~${r.litros.toFixed(1)} L` : ''}
      </div>
    </div>`;
}

async function traerResumen() {
  try {
    const res = await apiFetch('/api/flota/resumen');
    if (!res.ok) return null;
    const d = await res.json();
    return (d && typeof d === 'object' && d.hora) ? d : null;
  } catch (e) { return null; }
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
  // El resumen se pide en paralelo y no puede romper la pantalla: si falla,
  // simplemente no aparece la tarjeta.
  const pResumen = traerResumen();
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
    ${tarjetaResumen(await pResumen)}
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

  // Aviso al chofer: arma el cartel con el logo y lo comparte por el menú del
  // celular (WhatsApp, etc.). Es la MISMA función que usa el panel del auditor
  // —compartirExceso, expuesta como global— no una copia: el onclick la resuelve
  // recién al hacer clic, así que no hay que importar nada ni depende del orden
  // en que carguen los módulos.
  const enviar = esExceso
    ? `<button class="btn btn-secondary btn-sm" style="white-space:nowrap"
               onclick="compartirExceso('${escapeHtml(e.code || '')}',${e.velocidad_max},'${e.cuando}')"
               title="Enviar el aviso al chofer">📲 Avisar</button>`
    : '';

  // El evento que se vino a ver (desde la notificación o desde el resumen) se
  // marca y se lleva al centro de la pantalla. Si no, en una lista de 40 líneas
  // no hay forma de saber cuál era el que acababa de avisar.
  const buscado = e.id && String(e.id) === String(_evento);

  return `
    <div ${e.id ? `id="ev-${escapeHtml(String(e.id))}"` : ''}
         style="display:flex;align-items:flex-start;gap:12px;padding:11px 14px;border-bottom:1px solid var(--border)
                ${buscado ? ';background:var(--bg3);box-shadow:inset 3px 0 0 var(--accent)' : ''}">
      <div style="min-width:56px;text-align:right">
        <div style="font-size:13px;font-weight:700;color:var(--text2)">${horaDe(e.cuando)}</div>
        <div style="font-size:10px;color:var(--text3)">${diaDe(e.cuando)}</div>
      </div>
      <span style="font-size:14px;color:${color}">${icono}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px">
          <b style="color:var(--text)">${escapeHtml(e.code || '—')}</b> · ${detalle}
          ${e.en_curso ? `<span style="font-size:10px;background:${color};color:#fff;border-radius:3px;padding:1px 5px;margin-left:6px">EN CURSO</span>` : ''}
          ${buscado ? `<span style="font-size:10px;background:var(--accent);color:#fff;border-radius:3px;padding:1px 5px;margin-left:6px">EL DEL AVISO</span>` : ''}
        </div>
        ${lugar ? `<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(lugar)}</div>` : ''}
        ${esExceso && e.duracion_min ? `<div style="font-size:11px;color:var(--text3)">duró ${duracion(e.duracion_min)}</div>` : ''}
      </div>
      ${enviar}
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

  if (!_evento) return;
  const fila = document.getElementById('ev-' + _evento);
  if (fila) {
    fila.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  // No está en el período elegido. Pasa si se toca una notificación al otro día:
  // el feed abre en 24 h y el exceso ya quedó afuera. Se ensancha UNA vez a la
  // semana completa antes de darlo por perdido.
  if (!_ampliado && _horas < 168) {
    _ampliado = true;
    _horas = 168;
    await renderFeed(cont);
    return;
  }
  // Sigue sin aparecer: se avisa en vez de dejar la pantalla como si nada.
  const aviso = document.createElement('div');
  aviso.style.cssText = 'font-size:12px;color:var(--text3);margin-top:10px';
  aviso.textContent = 'El evento del aviso ya no entra en el período mostrado.';
  cont.appendChild(aviso);
  _evento = null;
}

// ── Pestaña "Preguntar" ───────────────────────────────────────────────
// La charla vive en el módulo, no en el DOM: la pantalla se redibuja entera en
// cada mensaje y en cada cambio de pestaña, y si no se perdería lo hablado.
let _charla = [];
let _pensando = false;

const SUGERENCIAS = [
  '¿Dónde está cada unidad?',
  '¿Cuántos camiones tengo en ruta?',
  '¿Hubo excesos de velocidad hoy?',
  '¿Qué unidad desperdició más gasoil en ralentí esta semana?',
];

function burbuja(m) {
  const mio = m.role === 'user';
  return `
    <div style="display:flex;justify-content:${mio ? 'flex-end' : 'flex-start'};margin-bottom:10px">
      <div style="max-width:82%;padding:9px 13px;border-radius:12px;font-size:13px;line-height:1.5;
                  ${mio ? 'background:var(--accent);color:#fff;border-bottom-right-radius:3px'
                        : 'background:var(--bg3);color:var(--text);border-bottom-left-radius:3px'}">
        ${escapeHtml(m.content).replace(/\n/g, '<br>')}
      </div>
    </div>`;
}

function renderPreguntar(cont) {
  const vacia = _charla.length === 0;
  cont.innerHTML = `
    <div class="card" style="padding:16px">
      <div id="flota-charla" style="max-height:52vh;overflow-y:auto;margin-bottom:14px">
        ${vacia ? `
          <div style="text-align:center;color:var(--text3);padding:18px 8px">
            <div style="font-size:30px;margin-bottom:8px">💬</div>
            <div style="font-size:13px">Preguntame lo que quieras sobre la flota, en criollo.</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;max-width:460px;margin:0 auto">
            ${SUGERENCIAS.map((s) => `
              <button class="btn btn-secondary btn-sm" style="text-align:left;font-weight:400"
                      onclick="preguntarFlotaSugerida('${escapeHtml(s).replace(/'/g, "\\'")}')">${escapeHtml(s)}</button>`).join('')}
          </div>`
        : _charla.map(burbuja).join('')
          + (_pensando ? `<div style="color:var(--text3);font-size:13px;padding:4px 6px">Pensando…</div>` : '')}
      </div>
      <div style="display:flex;gap:8px">
        <input id="flota-pregunta" type="text" placeholder="¿Dónde está el AH327RZ?"
               ${_pensando ? 'disabled' : ''} autocomplete="off"
               style="flex:1;padding:10px 12px;border:1px solid var(--border2);border-radius:var(--radius);
                      background:var(--bg);color:var(--text);font-size:14px;font-family:var(--font)"
               onkeydown="if(event.key==='Enter')preguntarFlota()">
        <button class="btn btn-primary" ${_pensando ? 'disabled' : ''} onclick="preguntarFlota()">Preguntar</button>
      </div>
      ${_charla.length ? `<div style="margin-top:10px;text-align:right">
        <button class="btn btn-secondary btn-sm" onclick="limpiarCharlaFlota()">Empezar de nuevo</button>
      </div>` : ''}
    </div>
    <div style="font-size:12px;color:var(--text3);margin-top:12px;line-height:1.6">
      Contesta con los datos reales del GPS y de los eventos registrados — no inventa.
      Si le preguntás algo que no tiene a mano (costos, órdenes de trabajo, documentación),
      te va a decir en qué sección de FleetOS mirarlo.
    </div>`;

  const inp = document.getElementById('flota-pregunta');
  if (inp && !_pensando) inp.focus();
  const caja = document.getElementById('flota-charla');
  if (caja) caja.scrollTop = caja.scrollHeight;
}

async function preguntarFlota(textoDirecto) {
  if (_pensando) return;
  const inp = document.getElementById('flota-pregunta');
  const texto = (textoDirecto || (inp && inp.value) || '').trim();
  if (!texto) return;

  // El historial que se manda es el de ANTES de esta pregunta: la pregunta va
  // aparte, en su propio campo.
  const historial = _charla.slice();
  _charla.push({ role: 'user', content: texto });
  _pensando = true;
  renderPreguntar(document.getElementById('flota-cont'));

  let respuesta;
  try {
    const res = await apiFetch('/api/flota/preguntar', {
      method: 'POST',
      body: JSON.stringify({ pregunta: texto, historial }),
    });
    const d = await res.json().catch(() => ({}));
    respuesta = res.ok ? (d.respuesta || 'No recibí respuesta.') : (d.error || 'No se pudo consultar.');
  } catch (e) {
    respuesta = 'Sin conexión con el servidor.';
  }

  _pensando = false;
  _charla.push({ role: 'assistant', content: respuesta });
  renderPreguntar(document.getElementById('flota-cont'));
}

function preguntarFlotaSugerida(texto) { preguntarFlota(texto); }
function limpiarCharlaFlota() { _charla = []; renderPreguntar(document.getElementById('flota-cont')); }

// ── Armado de la pantalla ─────────────────────────────────────────────
async function renderFlotaAhora() {
  const root = document.getElementById('page-flota');
  if (!root) return;

  // Si se llegó tocando una notificación push, abrir directo en la pestaña que
  // pidió, y si el aviso era de un exceso puntual, parada en ESE evento.
  // Se consume una sola vez: después el usuario manda con los botones.
  const nav = window._navParams;
  if (nav && nav.tab) { _tab = nav.tab === 'feed' ? 'feed' : 'ahora'; delete nav.tab; }
  if (nav && nav.evento) { _evento = nav.evento; _tab = 'feed'; _ampliado = false; delete nav.evento; }

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
        ${tabBtn('ahora', '📍 Ahora')}${tabBtn('feed', '📋 Lo que pasó')}${tabBtn('preguntar', '💬 Preguntar')}
        <button class="btn btn-secondary btn-sm" onclick="renderFlotaAhora()">↻</button>
      </div>
    </div>
    <div id="flota-cont">${mensaje('Cargando…')}</div>`;

  const cont = document.getElementById('flota-cont');
  const sub = document.getElementById('flota-sub');
  if (_tab === 'feed') {
    if (sub) sub.textContent = 'Excesos y ralentí, del más reciente al más viejo';
    await renderFeed(cont);
  } else if (_tab === 'preguntar') {
    if (sub) sub.textContent = 'Preguntá en criollo sobre tu flota';
    renderPreguntar(cont);
  } else {
    if (sub) sub.textContent = 'Dónde está cada unidad · se refresca sola cada 30 s';
    await renderAhora(cont);
  }
  programarRefresco();
}

// Cuando el usuario navega por su cuenta, el resaltado deja de tener sentido:
// ya no está mirando "lo que le avisaron", está mirando lo que él eligió.
function mostrarTabFlota(tab) { _tab = tab; _evento = null; renderFlotaAhora(); }

function cambiarPeriodoFlota(horas) { _horas = horas; _evento = null; renderFlotaAhora(); }

// Tocar una línea del resumen: lleva al feed parado en ese evento.
function irAEventoFlota(id) {
  _evento = String(id);
  _ampliado = false;
  _tab = 'feed';
  renderFlotaAhora();
}

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
expose('irAEventoFlota', irAEventoFlota);
expose('preguntarFlota', preguntarFlota);
expose('preguntarFlotaSugerida', preguntarFlotaSugerida);
expose('limpiarCharlaFlota', limpiarCharlaFlota);
