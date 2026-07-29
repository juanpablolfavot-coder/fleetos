// ════════════════════════════════════════════════════════════════════
//  CONTROL EN VIVO DE LA FLOTA (ES module) — solo dueños
//
//  Contesta "¿dónde está cada unidad?" sin tener que preguntarle a nadie.
//  Los datos salen de lo que el sync del GPS ya guarda cada 2 minutos, así
//  que la pantalla no agrega ni una llamada a Powerfleet.
//
//  Se refresca sola cada 30 segundos mientras esté abierta. El timer se
//  corta al navegar a otra sección: sin eso quedaría consultando para
//  siempre en una pestaña olvidada.
// ════════════════════════════════════════════════════════════════════
import { need, expose } from './dom.mjs';

const App = need('App');
const apiFetch = need('apiFetch');
const escapeHtml = need('escapeHtml');

const REFRESCO_MS = 30000;
let _timer = null;

// Cada situación con su color y su etiqueta. El orden lo decide el backend.
const SITUACION = {
  ruta:         { punto: '🟢', label: 'En ruta',      color: 'var(--ok)' },
  ralenti:      { punto: '🟡', label: 'Ralentí',      color: 'var(--warn)' },
  detenida:     { punto: '⚫', label: 'Detenida',     color: 'var(--text3)' },
  sin_reportar: { punto: '🔴', label: 'Sin reportar', color: 'var(--danger)' },
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

function tarjetaResumen(r) {
  const items = [
    ['En ruta',      r.en_ruta,      'var(--ok)'],
    ['Ralentí',      r.en_ralenti,   'var(--warn)'],
    ['Detenidas',    r.detenidas,    'var(--text3)'],
    ['Sin reportar', r.sin_reportar, 'var(--danger)'],
  ];
  return `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
      ${items.map(([label, n, color]) => `
        <div class="card card-sm" style="flex:1 1 120px;min-width:120px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:${color};line-height:1.1">${n}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px">${label}</div>
        </div>`).join('')}
    </div>`;
}

function fila(u) {
  const s = SITUACION[u.situacion] || SITUACION.detenida;
  // Lo de la derecha cambia según la situación: la velocidad solo importa si
  // se está moviendo, y el tiempo en ralentí solo si está quemando gasoil.
  let derecha;
  if (u.arrastrado) {
    // Un semi no anda solo: si se mueve es porque lo están remolcando, y el
    // ralentí no aplica. Se informa la velocidad sin el énfasis de una unidad
    // motorizada, para no leerlo como un viaje aparte.
    derecha = u.situacion === 'sin_reportar'
      ? `<b style="color:var(--danger)">${hace(u.minutos_sin_reportar)}</b>`
      : `<span style="color:var(--text3)">${u.velocidad > 0 ? `remolcado · ${u.velocidad} km/h` : 'estacionado'}</span>`;
  } else if (u.situacion === 'ruta')          derecha = `<b style="color:var(--ok)">${u.velocidad} km/h</b>`;
  else if (u.situacion === 'ralenti')         derecha = `<b style="color:var(--warn)">${u.ralenti_minutos} min en ralentí</b>`;
  else if (u.situacion === 'sin_reportar')    derecha = `<b style="color:var(--danger)">${hace(u.minutos_sin_reportar)}</b>`;
  else                                        derecha = `<span style="color:var(--text3)">detenida</span>`;

  const mapa = (u.lat && u.lng)
    ? `<a href="https://www.google.com/maps?q=${u.lat},${u.lng}" target="_blank" rel="noopener"
          style="color:var(--accent);text-decoration:none;font-size:12px" title="Ver en el mapa">📍</a>`
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

async function renderFlotaAhora() {
  const root = document.getElementById('page-flota');
  if (!root) return;

  if (!root.dataset.cargado) {
    root.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">Cargando la flota…</div>';
  }

  let d;
  try {
    const res = await apiFetch('/api/flota/ahora');
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      root.innerHTML = `<div class="card" style="color:var(--danger)">No se pudo cargar: ${escapeHtml(e.error || res.status)}</div>`;
      return;
    }
    d = await res.json();
  } catch (e) {
    root.innerHTML = `<div class="card" style="color:var(--danger)">Sin conexión con el servidor.</div>`;
    return;
  }

  // Sin esto, una respuesta con otra forma (un HTML de error, un proxy que se
  // mete en el medio) tira una excepción sin capturar y la pantalla queda en
  // blanco. Mejor decir qué pasó.
  if (!d || !d.resumen || !Array.isArray(d.unidades)) {
    root.innerHTML = `<div class="card" style="color:var(--danger)">El servidor devolvió una respuesta inesperada.</div>`;
    return;
  }

  const fecha = new Date(d.actualizado);
  const hora = isNaN(fecha) ? '—' : fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  const arrastrados = Array.isArray(d.arrastrados) ? d.arrastrados : [];

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div>
        <h2 style="font-size:20px;font-weight:700;margin:0;color:var(--text)">🛰️ Control en vivo</h2>
        <p style="font-size:13px;color:var(--text3);margin:4px 0 0">
          ${d.resumen.total} unidades motorizadas${arrastrados.length ? ` · ${arrastrados.length} semirremolques` : ''}
          · actualizado ${hora} · se refresca sola cada 30 s
        </p>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="renderFlotaAhora()">↻ Actualizar</button>
    </div>
    ${tarjetaResumen(d.resumen)}
    <div class="card" style="padding:0;overflow:hidden">
      ${d.unidades.length
        ? d.unidades.map(fila).join('')
        : '<div style="padding:30px;text-align:center;color:var(--text3)">Ninguna unidad motorizada reportó posición todavía.</div>'}
    </div>
    ${arrastrados.length ? `
      <div style="margin-top:22px">
        <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:8px">
          🔗 Semirremolques y acoplados (${arrastrados.length})
        </div>
        <div class="card" style="padding:0;overflow:hidden">${arrastrados.map(fila).join('')}</div>
      </div>` : ''}
    <div style="font-size:12px;color:var(--text3);margin-top:16px;line-height:1.6">
      🟡 <b>Ralentí</b> es motor encendido con la unidad parada: gasoil quemado sin moverse.<br>
      🔴 <b>Sin reportar</b> son más de 30 minutos sin novedades del equipo — apagado o sin señal.<br>
      🔗 Los <b>semirremolques</b> van aparte y no entran en los números de arriba: no tienen motor,
      así que cuando se mueven es porque los está llevando uno de los camiones de la lista.
    </div>`;

  root.dataset.cargado = '1';
  programarRefresco();
}

// Un solo timer vivo, y solo mientras la sección esté abierta.
function programarRefresco() {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    if (App.currentPage !== 'flota') { _timer = null; return; }
    renderFlotaAhora();
  }, REFRESCO_MS);
}

expose('renderFlotaAhora', renderFlotaAhora);
