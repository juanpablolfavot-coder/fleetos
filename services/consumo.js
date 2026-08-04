// ════════════════════════════════════════════════════════════════════
//  Consumo de combustible — cuando una unidad se sale de LO SUYO.
//
//  El gasoil es la línea de costo más grande de la operación y hasta ahora
//  nadie la vigilaba: los datos estaban cargados y solo se veían si alguien se
//  sentaba a mirar planillas. Una unidad que pasa de 32 a 42 L/100km está rota o
//  le están sacando combustible, y en cualquiera de los dos casos conviene
//  enterarse esta semana y no cuando cierre el mes.
//
//  ── Contra sí misma, nunca contra la flota ──
//  La mediana de la flota es 30 L/100km y la mitad central va de 20 a 33: un
//  tractor cargado y una camioneta no se comparan. Cada unidad se mide contra su
//  propio historial.
//
//  ── El umbral también es propio de cada unidad ──
//  Medido sobre 63 días de datos reales (npm run diag:combustible), la variación
//  típica de una unidad contra sí misma es ±5%. Pero va de ±1% a ±16%, y un
//  umbral único sería incorrecto en los dos extremos: al 20% la unidad de ±16%
//  avisaría sola por su ruido normal, y para la de ±1% un 20% deja pasar cosas
//  que para ese motor son enormes.
//
//      umbral = max(UMBRAL_MIN, FACTOR_MAD × la variación propia de la unidad)
//
//  El piso del 20% no es arbitrario: por debajo de eso se está midiendo cuánto
//  se llenó el tanque, no cuánto consumió el motor.
//
//  Con esos valores, la simulación sobre los datos que ya existen da COMO MUCHO
//  1,2 avisos por semana, y menos en la práctica porque las unidades ruidosas
//  suben su propia vara. Un aviso que llega todos los días se deja de leer.
//
//  ── Solo hacia arriba ──
//  Gastar de menos no es un problema que avisar. Y un consumo sospechosamente
//  bajo casi siempre significa que falta registrar una carga, no que el motor
//  mejoró.
//
//  Variables de entorno (todas opcionales):
//    CONSUMO_OFF=1              desactiva el aviso
//    CONSUMO_HORA               inicio de la ventana horaria (default 8)
//    CONSUMO_HORA_HASTA         fin de la ventana            (default 20)
//    CONSUMO_RECORDAR_DIAS      recordatorio si no cambió nada (default 7)
//    CONSUMO_UMBRAL_MIN         piso del umbral en % (default 20)
//    CONSUMO_ROLES              a quiénes avisar (default dueno,gerencia,jefe_mantenimiento)
// ════════════════════════════════════════════════════════════════════
const { query } = require('../db/pool');
const push = require('./push');

const TZ = 'America/Argentina/Buenos_Aires';

// ── Sanidad del dato ──────────────────────────────────────────────────
// Los mismos límites que usa scripts/diagnostico-combustible.js, a propósito:
// si el diagnóstico dice "285 tramos utilizables", la alerta tiene que estar
// mirando esos mismos 285 y no otro conjunto.
const L100_MIN = 10;    // por debajo: falta registrar una carga en el medio
const L100_MAX = 120;   // por arriba: odómetro mal tipeado
const KM_MAX_ENTRE_CARGAS = 3000;

// Cuántos tramos previos hacen falta para tener una base creíble. Con menos, la
// mediana se mueve tanto que cualquier cosa parece anomalía.
const MIN_TRAMOS = 5;

// Un tramo viejo no es noticia. Sin esto, el primer arranque avisaría sobre
// anomalías de hace dos meses que ya no se pueden investigar.
const DIAS_FRESCO = 30;

const FACTOR_MAD  = 3;
const UMBRAL_MIN  = Math.max(5, parseInt(process.env.CONSUMO_UMBRAL_MIN || '20', 10) || 20);
const HORA        = Math.min(23, Math.max(0, parseInt(process.env.CONSUMO_HORA || '8', 10) || 8));
const HORA_HASTA  = Math.min(23, Math.max(HORA, parseInt(process.env.CONSUMO_HORA_HASTA || '20', 10) || 20));
const RECORDAR_DIAS = Math.max(1, parseInt(process.env.CONSUMO_RECORDAR_DIAS || '7', 10) || 7);

const ROLES = (process.env.CONSUMO_ROLES || 'dueno,gerencia,jefe_mantenimiento')
  .split(',').map((r) => r.trim()).filter(Boolean);

function desactivado() {
  return String(process.env.CONSUMO_OFF || '') === '1';
}

// Fecha y hora argentinas con Intl directo: el camino de
// new Date(toLocaleString(...)) + toISOString() se corre un día después de las
// 21 (ver services/vencimientos.js).
function _hoyAR(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: TZ });
}
function _horaAR(now = new Date()) {
  return parseInt(now.toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }), 10);
}

// ── Estadística ───────────────────────────────────────────────────────
function mediana(xs) {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

// Desviación absoluta mediana, en % de la mediana. Se usa MAD y no desvío
// estándar porque con 10 tramos un solo dato malo mueve el desvío estándar lo
// suficiente como para esconder justo lo que se busca.
function variacionPropia(xs) {
  const med = mediana(xs);
  if (!med) return null;
  return mediana(xs.map((x) => Math.abs(x - med))) / med * 100;
}

// ── Lectura ───────────────────────────────────────────────────────────
// Un "tramo" son los litros de la carga N sobre los km entre la carga N-1 y la
// N. La urea no cuenta: no es combustible de tracción.
async function tramosPorUnidad() {
  const r = await query(`
    WITH ordenadas AS (
      SELECT f.vehicle_id, v.code AS unidad, v.plate,
             f.liters, f.odometer_km, f.logged_at,
             LAG(f.odometer_km) OVER (PARTITION BY f.vehicle_id
                                      ORDER BY f.logged_at, f.odometer_km) AS odo_prev
        FROM fuel_logs f
        JOIN vehicles v ON v.id = f.vehicle_id
       WHERE f.fuel_type IS DISTINCT FROM 'urea'
         AND f.odometer_km IS NOT NULL AND f.odometer_km > 0
         AND f.liters IS NOT NULL AND f.liters > 0
         AND v.active
    )
    SELECT vehicle_id, unidad, plate, logged_at,
           odometer_km - odo_prev                              AS km,
           (liters / NULLIF(odometer_km - odo_prev, 0)) * 100  AS l100
      FROM ordenadas
     WHERE odo_prev IS NOT NULL
     ORDER BY vehicle_id, logged_at`);

  const porUnidad = new Map();
  for (const t of r.rows) {
    const km = Number(t.km);
    const l100 = Number(t.l100);
    // Descartes: no son "ruido a ignorar", son datos mal cargados. Contarlos
    // como consumo real haría que la alerta mida errores de tipeo.
    if (!(km > 0) || km > KM_MAX_ENTRE_CARGAS) continue;
    if (!Number.isFinite(l100) || l100 < L100_MIN || l100 > L100_MAX) continue;

    if (!porUnidad.has(t.vehicle_id)) {
      porUnidad.set(t.vehicle_id, {
        vehicle_id: t.vehicle_id,
        unidad: t.unidad || t.plate || '?',
        tramos: [],
      });
    }
    porUnidad.get(t.vehicle_id).tramos.push({ l100, cuando: t.logged_at });
  }
  return [...porUnidad.values()];
}

// ── Evaluación ────────────────────────────────────────────────────────
/**
 * Separada y pura para poder testearla sin base.
 *
 * Compara el ÚLTIMO tramo de cada unidad contra la mediana de los ANTERIORES.
 * Nunca contra el conjunto completo: incluir el tramo que se evalúa dentro de su
 * propia base la empuja hacia arriba y esconde justo el salto que se busca.
 *
 * Devuelve una entrada por unidad, con `alerta: true|false`, para que quien
 * llame pueda mostrar todo o filtrar. El aviso usa solo las que alertan.
 */
function evaluar(unidades, { ahora = new Date() } = {}) {
  const limite = ahora.getTime() - DIAS_FRESCO * 86400000;

  return unidades.map((u) => {
    const base = { vehicle_id: u.vehicle_id, unidad: u.unidad, tramos: u.tramos.length };

    if (u.tramos.length < MIN_TRAMOS + 1) {
      return { ...base, alerta: false, motivo: 'sin_historia' };
    }
    const ultimo = u.tramos[u.tramos.length - 1];
    const previos = u.tramos.slice(0, -1).map((t) => t.l100);

    const normal = mediana(previos);
    const variacion = variacionPropia(previos);
    if (!normal) return { ...base, alerta: false, motivo: 'sin_historia' };

    // El umbral es propio: max(piso, FACTOR × lo que esta unidad varía sola).
    const umbral = Math.max(UMBRAL_MIN, FACTOR_MAD * (variacion ?? 0));
    const desvio = (ultimo.l100 - normal) / normal * 100;

    const datos = {
      ...base,
      actual: Math.round(ultimo.l100 * 10) / 10,
      normal: Math.round(normal * 10) / 10,
      variacion: variacion == null ? null : Math.round(variacion),
      umbral: Math.round(umbral),
      desvio: Math.round(desvio),
      cuando: ultimo.cuando,
    };

    // Un tramo viejo no es noticia: puede ser de antes de que existiera la
    // alerta, y no hay nada que investigar dos meses después.
    if (new Date(ultimo.cuando).getTime() < limite) {
      return { ...datos, alerta: false, motivo: 'tramo_viejo' };
    }
    // Solo hacia arriba.
    if (desvio <= umbral) return { ...datos, alerta: false, motivo: 'normal' };

    return { ...datos, alerta: true };
  });
}

async function estadoConsumo({ ahora = new Date() } = {}) {
  return evaluar(await tramosPorUnidad(), { ahora });
}

// ── Texto del aviso ───────────────────────────────────────────────────
function _linea(a) {
  return `${a.unidad} · ${a.actual} L/100km (lo normal ${a.normal}) · +${a.desvio}%`;
}

function armarCuerpo(evaluadas) {
  const alertas = evaluadas.filter((e) => e.alerta)
    .sort((a, b) => b.desvio - a.desvio);
  if (!alertas.length) return null;

  const destacar = alertas.slice(0, 4).map(_linea);
  const resto = alertas.length - destacar.length;

  return {
    title: alertas.length === 1
      ? `⛽ Consumo alto: ${alertas[0].unidad}`
      : `⛽ Consumo alto en ${alertas.length} unidades`,
    body: destacar.join('\n') + (resto > 0 ? `\n…y ${resto} más` : ''),
    tag: 'fleetos-consumo',
    url: '/?ir=fuel',
  };
}

// ── "Ya avisé esto" ───────────────────────────────────────────────────
// Misma lógica que vencimientos y mantenimiento: se manda cuando CAMBIA el
// conjunto, y si no cambia, un recordatorio cada RECORDAR_DIAS.
//
// La firma lleva la fecha del tramo, no solo la unidad: si la misma unidad
// vuelve a cargar y sigue alta, es un dato NUEVO y merece avisar de nuevo.
// La clave lleva el instante COMPLETO de la carga, no la fecha. Con slice(0,10)
// dos cargas del mismo día daban la misma clave, así que la segunda —que es un
// dato nuevo, medido después— quedaba tapada hasta el día siguiente. Justo lo
// contrario de lo que este comentario decía que hacía.
function _clave(e) {
  const t = e.cuando instanceof Date ? e.cuando.toISOString() : String(e.cuando);
  return `${e.vehicle_id}:${t}`;
}

function _firma(evaluadas) {
  return evaluadas.filter((e) => e.alerta).map(_clave).sort().join('|');
}

// ¿Hay alguna unidad alertada que NO estuviera en el aviso anterior?
//
// Se compara por conjunto y no por igualdad de firma: si de dos unidades altas
// una se normaliza, la firma CAMBIA pero no hay nada nuevo que contar, y volver
// a avisar con menos información que la vez anterior es ruido.
function _hayNuevas(firma, previo) {
  const antes = new Set(String(previo?.firma || '').split('|').filter(Boolean));
  return String(firma).split('|').filter(Boolean).some((k) => !antes.has(k));
}

async function _leerEstado() {
  const r = await query(`SELECT value FROM app_config WHERE key = 'consumo_last'`);
  if (!r.rows[0]) return null;
  try {
    return typeof r.rows[0].value === 'string' ? JSON.parse(r.rows[0].value) : r.rows[0].value;
  } catch (_) { return null; }
}
async function _guardarEstado(estado) {
  await query(`INSERT INTO app_config(key,value) VALUES('consumo_last',$1)
               ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(estado)]);
}
function _diasEntre(a, b) {
  const x = Date.parse(a + 'T00:00:00Z'), y = Date.parse(b + 'T00:00:00Z');
  return Number.isNaN(x) || Number.isNaN(y) ? Infinity : Math.round((y - x) / 86400000);
}

// ── Envío ─────────────────────────────────────────────────────────────
async function generarYEnviarAviso({ force = false, now = new Date(), notificar = null } = {}) {
  if (desactivado() && !force) return { skipped: 'desactivado (CONSUMO_OFF=1)' };

  const evaluadas = await estadoConsumo({ ahora: now });
  const cuerpo = armarCuerpo(evaluadas);
  if (!cuerpo) return { skipped: 'ninguna unidad fuera de lo normal' };

  const hoy = _hoyAR(now);
  const hora = _horaAR(now);
  const previo = await _leerEstado();
  const firma = _firma(evaluadas);

  if (!force) {
    if (hora < HORA || hora > HORA_HASTA) {
      return { skipped: `fuera de la ventana de ${HORA} a ${HORA_HASTA} (son las ${hora})` };
    }
    // Una anomalía NUEVA se avisa cuando aparece, aunque ya se haya avisado hoy.
    // Antes el corte por día iba primero, así que una unidad que se disparaba a
    // las 10 quedaba callada hasta mañana si otra había disparado a las 8. Para
    // documentación y mantenimiento eso casi no se nota —cambian de a poco— pero
    // acá cada carga de combustible es un evento, y avisar un día tarde de un
    // consumo raro es avisar cuando ya se fue el camión.
    if (!_hayNuevas(firma, previo)) {
      if (previo && previo.dia === hoy) return { skipped: 'ya se avisó hoy y no hay nada nuevo' };
      if (previo && _diasEntre(previo.dia, hoy) < RECORDAR_DIAS) {
        return { skipped: `sin novedades; el recordatorio sale cada ${RECORDAR_DIAS} días` };
      }
    }
  }

  const enviar = notificar || ((roles, payload) => push.notifyRoles(roles, payload));
  const enviados = await enviar(ROLES, cuerpo);

  // Si no salió por ningún lado NO se anota: darlo por avisado taparía el aviso
  // hasta el próximo recordatorio, justo cuando alguien se suscriba.
  if (!enviados) {
    return { skipped: 'no se pudo entregar a nadie (push sin configurar o sin suscripciones)' };
  }

  await _guardarEstado({ dia: hoy, firma });
  return {
    sent: cuerpo.title,
    enviados,
    alertas: evaluadas.filter((e) => e.alerta).length,
  };
}

let _ultimoMotivo = null;
function programarConsumo() {
  if (desactivado()) {
    console.log('[consumo] desactivado por CONSUMO_OFF=1');
    return;
  }
  const tick = () => generarYEnviarAviso()
    .then((r) => {
      if (r.sent) {
        _ultimoMotivo = null;
        console.log(`[consumo] avisado a ${r.enviados} dispositivo(s): ${r.alertas} unidad(es) fuera de lo normal`);
      } else if (r.skipped && r.skipped !== _ultimoMotivo) {
        _ultimoMotivo = r.skipped;
        console.log('[consumo] omitido:', r.skipped);
      }
    })
    .catch((e) => console.error('[consumo]', e.message));
  setTimeout(tick, 180 * 1000);          // después del boot y del primer sync GPS
  setInterval(tick, 60 * 60 * 1000);     // una vez por hora: las cargas no llegan más rápido
}

module.exports = {
  estadoConsumo, tramosPorUnidad, evaluar, armarCuerpo, generarYEnviarAviso, programarConsumo,
  // Expuestos para poder testear la lógica anti-ruido sin base: es donde vivían
  // los dos defectos que tapaban avisos legítimos.
  _firma, _hayNuevas,
  mediana, variacionPropia,
  L100_MIN, L100_MAX, KM_MAX_ENTRE_CARGAS, MIN_TRAMOS, DIAS_FRESCO,
  FACTOR_MAD, UMBRAL_MIN, HORA, HORA_HASTA, RECORDAR_DIAS, ROLES,
};
