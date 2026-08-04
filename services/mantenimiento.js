// ════════════════════════════════════════════════════════════════════
//  Mantenimiento preventivo — qué se VA a romper.
//
//  Hasta ahora el sistema decía qué se rompió. Esto mira los contadores que ya
//  se actualizan solos y avisa antes:
//
//    "AH327RZ · Cambio de aceite: faltan 800 km"
//    "AD235FE · VTV: venció hace 3 días"
//
//  ── Modo aviso, NO genera órdenes de trabajo ──
//  A propósito. Si generara OTs solo, aparecerían órdenes que nadie cargó
//  moviendo los KPIs de mantenimiento, el conteo del panel auditor y los costos
//  del mes. Primero hay que confiar en los números; recién después se automatiza
//  el paso siguiente. Abrir la OT sigue siendo una decisión de una persona.
//
//  ── De dónde salen los contadores ──
//    km    → vehicles.km_current      (lo actualizan el sync del GPS y cada
//                                      carga de combustible con odómetro)
//    horas → vehicles.gps_hour_meter  (horómetro de Powerfleet; autoelevadoras)
//    días  → el calendario
//
//  Un plan sin línea de base (nunca se registró el último service) NO se
//  inventa: se reporta como 'sin_base' para que alguien lo complete. Es
//  preferible decir "no sé" a decir un número equivocado sobre un motor.
//
//  Variables de entorno (todas opcionales):
//    MANTENIMIENTO_OFF=1            desactiva el aviso
//    MANTENIMIENTO_HORA             inicio de la ventana horaria (default 8)
//    MANTENIMIENTO_HORA_HASTA       fin de la ventana            (default 20)
//    MANTENIMIENTO_RECORDAR_DIAS    recordatorio si no cambió nada (default 7)
//    MANTENIMIENTO_ROLES            a quiénes avisar (default dueno,gerencia,jefe_mantenimiento)
// ════════════════════════════════════════════════════════════════════
const { query } = require('../db/pool');
const push = require('./push');

const TZ            = 'America/Argentina/Buenos_Aires';
const HORA          = Math.min(23, Math.max(0, parseInt(process.env.MANTENIMIENTO_HORA || '8', 10) || 8));
const HORA_HASTA    = Math.min(23, Math.max(HORA, parseInt(process.env.MANTENIMIENTO_HORA_HASTA || '20', 10) || 20));
const RECORDAR_DIAS = Math.max(1, parseInt(process.env.MANTENIMIENTO_RECORDAR_DIAS || '7', 10) || 7);

// Acá sí va jefe_mantenimiento: el destino del aviso es la pantalla de
// Mantenimiento, que su rol SÍ tiene (a diferencia de Documentación, que es lo
// que lo dejó afuera de los avisos de vencimiento).
const ROLES = (process.env.MANTENIMIENTO_ROLES || 'dueno,gerencia,jefe_mantenimiento')
  .split(',').map((r) => r.trim()).filter(Boolean);

function desactivado() {
  return String(process.env.MANTENIMIENTO_OFF || '') === '1';
}

// Fecha y hora argentinas sacadas con Intl directo, sin Date intermedio: el
// camino de new Date(toLocaleString(...)) + toISOString() se corre un día
// después de las 21 (ver services/vencimientos.js).
function _hoyAR(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: TZ });
}
function _horaAR(now = new Date()) {
  return parseInt(now.toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }), 10);
}

// Una columna DATE vuelve de pg como Date, no como texto, y String(date) da
// "Fri Feb 20 2026 …", no "2026-02-20". Cortarle 10 caracteres a eso daba
// "Fri Feb 2", y new Date("Fri Feb 2T00:00:00Z") es Invalid Date: alcanzaba UN
// plan por días en la base para que estadoPlanes() tirara RangeError y la
// pantalla entera devolviera 500.
//
// Se leen los campos locales en vez de toISOString() porque pg construye el
// Date a medianoche LOCAL: con el server en un huso al este de UTC,
// toISOString() devolvería el día anterior.
function _fechaISO(v) {
  if (!v) return null;
  if (!(v instanceof Date)) return String(v).slice(0, 10);
  if (Number.isNaN(v.getTime())) return null;
  return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
}

// ── Estado de cada plan ───────────────────────────────────────────────
/**
 * Devuelve cada plan activo con cuánto le falta y en qué estado está:
 *   vencido   — ya se pasó
 *   proximo   — entra en la ventana de aviso_antes
 *   ok        — todavía falta
 *   sin_base  — no hay contra qué medir (falta cargar el último service)
 */
async function estadoPlanes({ vehicleId = null } = {}) {
  const params = [];
  let filtro = '';
  if (vehicleId) { params.push(vehicleId); filtro = ` AND m.vehicle_id = $${params.length}`; }

  const r = await query(`
    SELECT m.*,
           v.code AS vehicle_code, v.plate AS vehicle_plate,
           v.km_current, v.gps_hour_meter
      FROM maintenance_schedules m
      JOIN vehicles v ON v.id = m.vehicle_id
     WHERE m.activo AND v.active${filtro}
     ORDER BY v.code, m.nombre`, params);

  return r.rows.map((p) => calcular(p));
}

// Separada y pura para poder testearla sin base.
function calcular(plan, hoy = new Date()) {
  const intervalo = Number(plan.intervalo);
  const aviso = Number(plan.aviso_antes) || 0;
  const base = {
    id: plan.id, vehicle_id: plan.vehicle_id,
    unidad: plan.vehicle_code || plan.vehicle_plate || '?',
    nombre: plan.nombre, tipo: plan.tipo, intervalo, aviso_antes: aviso,
    // La línea de base viaja tal cual, aparte del cálculo. No es redundante con
    // `proximo`: la pantalla la necesita para prellenar el campo "último
    // service" al editar. Sin ella, ese campo abría vacío y al guardar mandaba
    // ultimo_valor:null, así que editar el NOMBRE de un plan le borraba la base
    // y lo dejaba en 'sin_base'. Silencioso, y justo lo contrario de lo que este
    // módulo promete: en vez de no inventar un número, perdía el único real.
    ultimo_valor: plan.ultimo_valor == null ? null : Number(plan.ultimo_valor),
    ultima_fecha: _fechaISO(plan.ultima_fecha),
    notas: plan.notas ?? null,
  };

  if (plan.tipo === 'dias') {
    const desdeISO = _fechaISO(plan.ultima_fecha);
    if (!desdeISO) return { ...base, estado: 'sin_base', restante: null };
    const desde = new Date(`${desdeISO}T00:00:00Z`);
    const vence = new Date(desde.getTime() + intervalo * 86400000);
    const hoyUTC = new Date(`${_hoyAR(hoy)}T00:00:00Z`);
    const restante = Math.round((vence - hoyUTC) / 86400000);
    return { ...base, restante, unidad_medida: 'días', proximo: vence.toISOString().slice(0, 10), ...clasificar(restante, aviso) };
  }

  // km / horas: contra el contador de la unidad.
  const actual = plan.tipo === 'km'
    ? (plan.km_current == null ? null : Number(plan.km_current))
    : (plan.gps_hour_meter == null ? null : Number(plan.gps_hour_meter));

  if (plan.ultimo_valor == null || actual == null) {
    return { ...base, estado: 'sin_base', restante: null, actual };
  }
  const proximo = Number(plan.ultimo_valor) + intervalo;
  const restante = Math.round(proximo - actual);
  return {
    ...base, actual: Math.round(actual), proximo: Math.round(proximo), restante,
    unidad_medida: plan.tipo === 'km' ? 'km' : 'h',
    ...clasificar(restante, aviso),
  };
}

function clasificar(restante, aviso) {
  if (restante < 0) return { estado: 'vencido' };
  if (restante <= aviso) return { estado: 'proximo' };
  return { estado: 'ok' };
}

// ── Texto del aviso ───────────────────────────────────────────────────
function _linea(p) {
  const u = p.unidad_medida || '';
  const cuanto = p.restante < 0
    ? `pasado por ${Math.abs(p.restante)} ${u}`
    : p.restante === 0 ? 'toca AHORA' : `faltan ${p.restante} ${u}`;
  return `${p.unidad} · ${p.nombre} (${cuanto})`;
}

function armarCuerpo(planes) {
  const vencidos = planes.filter((p) => p.estado === 'vencido');
  const proximos = planes.filter((p) => p.estado === 'proximo');
  if (!vencidos.length && !proximos.length) return null;

  const partes = [];
  if (vencidos.length) partes.push(`${vencidos.length} pasado${vencidos.length > 1 ? 's' : ''}`);
  if (proximos.length) partes.push(`${proximos.length} por vencer`);

  const destacar = [...vencidos, ...proximos].slice(0, 4).map(_linea);
  const resto = vencidos.length + proximos.length - destacar.length;

  return {
    title: `🔧 Mantenimiento: ${partes.join(', ')}`,
    body: destacar.join('\n') + (resto > 0 ? `\n…y ${resto} más` : ''),
    tag: 'fleetos-mantenimiento',
    url: '/?ir=maintenance',
  };
}

// ── "Ya avisé esto" ───────────────────────────────────────────────────
// Misma lógica que vencimientos: se manda cuando CAMBIA el conjunto, y si no
// cambia nada, un recordatorio cada RECORDAR_DIAS. Un aviso que dice lo mismo
// todos los días se deja de leer.
function _firma(planes) {
  return planes
    .filter((p) => p.estado === 'vencido' || p.estado === 'proximo')
    .map((p) => `${p.estado[0]}:${p.id}`)
    .sort().join('|');
}

async function _leerEstado() {
  const r = await query(`SELECT value FROM app_config WHERE key = 'mantenimiento_last'`);
  if (!r.rows[0]) return null;
  try {
    return typeof r.rows[0].value === 'string' ? JSON.parse(r.rows[0].value) : r.rows[0].value;
  } catch (_) { return null; }
}
async function _guardarEstado(estado) {
  await query(`INSERT INTO app_config(key,value) VALUES('mantenimiento_last',$1)
               ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(estado)]);
}
function _diasEntre(a, b) {
  const x = Date.parse(a + 'T00:00:00Z'), y = Date.parse(b + 'T00:00:00Z');
  return Number.isNaN(x) || Number.isNaN(y) ? Infinity : Math.round((y - x) / 86400000);
}

// ── Envío ─────────────────────────────────────────────────────────────
// `notificar` es parametrizable solo para testear el camino entregado: en los
// tests no hay VAPID ni suscripciones, así que el push real devolvería 0.
async function generarYEnviarAviso({ force = false, now = new Date(), notificar = null } = {}) {
  if (desactivado() && !force) return { skipped: 'desactivado (MANTENIMIENTO_OFF=1)' };

  const planes = await estadoPlanes();
  const cuerpo = armarCuerpo(planes);
  if (!cuerpo) return { skipped: 'no hay mantenimientos vencidos ni próximos' };

  const hoy = _hoyAR(now);
  const hora = _horaAR(now);
  const previo = await _leerEstado();
  const firma = _firma(planes);

  if (!force) {
    if (hora < HORA || hora > HORA_HASTA) {
      return { skipped: `fuera de la ventana de ${HORA} a ${HORA_HASTA} (son las ${hora})` };
    }
    if (previo && previo.dia === hoy) return { skipped: 'ya se avisó hoy' };
    if (previo && previo.firma === firma && _diasEntre(previo.dia, hoy) < RECORDAR_DIAS) {
      return { skipped: `sin cambios; el recordatorio sale cada ${RECORDAR_DIAS} días` };
    }
  }

  const enviar = notificar || ((roles, payload) => push.notifyRoles(roles, payload));
  const enviados = await enviar(ROLES, cuerpo);

  // Si no salió por ningún lado, NO se anota: darlo por avisado haría que el
  // aviso quede tapado hasta el próximo recordatorio cuando alguien se suscriba.
  if (!enviados) {
    return { skipped: 'no se pudo entregar a nadie (push sin configurar o sin suscripciones)' };
  }

  await _guardarEstado({ dia: hoy, firma });
  return {
    sent: cuerpo.title, enviados,
    vencidos: planes.filter((p) => p.estado === 'vencido').length,
    proximos: planes.filter((p) => p.estado === 'proximo').length,
  };
}

let _ultimoMotivo = null;
function programarMantenimiento() {
  if (desactivado()) {
    console.log('[mantenimiento] desactivado por MANTENIMIENTO_OFF=1');
    return;
  }
  const tick = () => generarYEnviarAviso()
    .then((r) => {
      if (r.sent) {
        _ultimoMotivo = null;
        console.log(`[mantenimiento] avisado a ${r.enviados} dispositivo(s): ${r.vencidos} pasados, ${r.proximos} por vencer`);
      } else if (r.skipped && r.skipped !== _ultimoMotivo) {
        _ultimoMotivo = r.skipped;
        console.log('[mantenimiento] omitido:', r.skipped);
      }
    })
    .catch((e) => console.error('[mantenimiento]', e.message));
  setTimeout(tick, 150 * 1000);        // después del boot y del primer sync GPS
  setInterval(tick, 30 * 60 * 1000);
}

module.exports = {
  estadoPlanes, calcular, armarCuerpo, generarYEnviarAviso, programarMantenimiento,
  HORA, HORA_HASTA, RECORDAR_DIAS, ROLES,
};
