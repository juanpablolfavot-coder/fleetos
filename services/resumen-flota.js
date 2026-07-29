// ════════════════════════════════════════════════════════════════════
//  Resumen periódico del estado de la flota (push a los DUEÑOS)
//
//  Cada RESUMEN_FLOTA_MIN minutos (default 120) manda UNA notificación con
//  el estado de la flota: cuántas en ruta, cuántas detenidas, cuántas en
//  ralentí, y qué pasó desde el resumen anterior (excesos y ralentí).
//
//  Reglas de diseño:
//   - Lo anómalo va PRIMERO. Un mensaje que dice siempre lo mismo se vuelve
//     papel pintado y se deja de leer.
//   - Ventana horaria: no despierta a nadie a las 3 AM (RESUMEN_FLOTA_DESDE
//     / _HASTA, default 6 a 22, hora argentina).
//   - El "ya lo mandé" se guarda en app_config (clave resumen_flota_last),
//     así un reinicio del server no dispara un resumen de más.
//   - tag fijo: la notificación nueva REEMPLAZA a la anterior en la bandeja
//     del celular en vez de apilar ocho iguales.
//
//  Variables de entorno (todas opcionales):
//    RESUMEN_FLOTA_MIN    minutos entre resúmenes (default 120; 0 = desactivado)
//    RESUMEN_FLOTA_DESDE  hora de inicio de la ventana (default 6)
//    RESUMEN_FLOTA_HASTA  hora de fin de la ventana    (default 22)
// ════════════════════════════════════════════════════════════════════
const { query } = require('../db/pool');
const push = require('./push');
const idle = require('./idle');

const INTERVALO_MIN = parseInt(process.env.RESUMEN_FLOTA_MIN || '120', 10);
const HORA_DESDE    = parseInt(process.env.RESUMEN_FLOTA_DESDE || '6', 10);
const HORA_HASTA    = parseInt(process.env.RESUMEN_FLOTA_HASTA || '22', 10);

// Minutos sin reportar a partir de los cuales una unidad no cuenta como
// "detenida" sino como "sin reportar" (equipo apagado o sin señal).
// El sync corre cada 2 min: 30 sin novedades ya es una anomalía real.
const STALE_MIN = 30;

// ── Hora argentina (el server puede correr en UTC) ────────────────────
function _ahoraAR(now = new Date()) {
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
}
function _hhmm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── Estado actual de la flota ─────────────────────────────────────────
// Solo se cuentan unidades que alguna vez reportaron GPS: las que nunca
// tuvieron equipo (acoplados, por ejemplo) no son parte de esta foto y
// contarlas como "sin reportar" inflaría el número para siempre.
async function estadoFlota() {
  const [flota, ralenti] = await Promise.all([
    query(`
      SELECT
        COUNT(*) FILTER (WHERE gps_updated_at >  NOW() - INTERVAL '${STALE_MIN} minutes'
                           AND gps_status = 'moving')                      AS en_ruta,
        COUNT(*) FILTER (WHERE gps_updated_at >  NOW() - INTERVAL '${STALE_MIN} minutes'
                           AND gps_status <> 'moving')                     AS detenidas,
        COUNT(*) FILTER (WHERE gps_updated_at <= NOW() - INTERVAL '${STALE_MIN} minutes') AS sin_reportar
      FROM vehicles
      WHERE active = TRUE AND gps_updated_at IS NOT NULL`),
    // Ralentí en curso: solo los que ya cruzaron el umbral de duración
    // (los recién abiertos todavía no son ralentí de verdad).
    query(`
      SELECT COUNT(*) AS n FROM idle_events
       WHERE ended_at IS NULL
         AND EXTRACT(EPOCH FROM (NOW() - started_at)) >= $1`, [idle.IDLE_MIN_SEC]),
  ]);

  const f = flota.rows[0] || {};
  return {
    en_ruta:      parseInt(f.en_ruta)      || 0,
    detenidas:    parseInt(f.detenidas)    || 0,
    sin_reportar: parseInt(f.sin_reportar) || 0,
    en_ralenti:   parseInt(ralenti.rows[0]?.n) || 0,
  };
}

// ── Qué pasó desde el resumen anterior ────────────────────────────────
async function novedadesDesde(desde) {
  const DUR = `COALESCE(duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(ended_at,NOW())-started_at))::int))`;
  const [excesos, ralentis] = await Promise.all([
    query(`SELECT vehicle_code, max_speed, limit_kmh
             FROM speeding_events
            WHERE started_at >= $1
            ORDER BY max_speed DESC`, [desde]),
    query(`SELECT vehicle_code, ${DUR} AS dur
             FROM idle_events
            WHERE started_at >= $1 AND ${DUR} >= $2
            ORDER BY dur DESC`, [desde, idle.IDLE_MIN_SEC]),
  ]);

  const litros = ralentis.rows.reduce(
    (a, r) => a + (parseInt(r.dur) || 0) / 3600 * idle.litrosPorHora(r.vehicle_code), 0);

  return { excesos: excesos.rows, ralentis: ralentis.rows, litros };
}

// ── Armado del texto ──────────────────────────────────────────────────
// Primera línea: lo que merece atención. Segunda: la foto de la flota.
// Si no pasó nada, va solo la foto (y se nota, justamente por corta).
function armarCuerpo(estado, nov) {
  const alertas = [];
  const peorExceso = nov.excesos[0];
  if (peorExceso) {
    const otros = nov.excesos.length - 1;
    alertas.push(`${peorExceso.vehicle_code} ${Math.round(peorExceso.max_speed)} km/h`
      + (otros > 0 ? ` (+${otros})` : ''));
  }
  const peorRalenti = nov.ralentis[0];
  if (peorRalenti) {
    alertas.push(`${peorRalenti.vehicle_code} ${Math.round(peorRalenti.dur / 60)} min en ralentí`);
  }

  const foto = [`${estado.en_ruta} en ruta`, `${estado.detenidas} detenidas`];
  if (estado.en_ralenti > 0)   foto.push(`${estado.en_ralenti} en ralentí`);
  if (estado.sin_reportar > 0) foto.push(`${estado.sin_reportar} sin reportar`);

  const lineas = [];
  if (alertas.length) lineas.push('⚠ ' + alertas.join(' · '));
  lineas.push(foto.join(' · '));
  if (nov.litros >= 1) lineas.push(`Ralentí del período: ~${nov.litros.toFixed(1)} L`);
  return lineas.join('\n');
}

// ── Control de "ya lo mandé" ──────────────────────────────────────────
async function _ultimoEnvio() {
  await query(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value JSONB NOT NULL)`).catch(() => {});
  const r = await query(`SELECT value FROM app_config WHERE key = 'resumen_flota_last'`);
  const raw = r.rows[0] && String(r.rows[0].value).replace(/"/g, '');
  const d = raw ? new Date(raw) : null;
  return (d && !isNaN(d)) ? d : null;
}
async function _marcarEnviado(cuando) {
  await query(`INSERT INTO app_config(key,value) VALUES('resumen_flota_last',$1)
               ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(cuando.toISOString())]);
}

// ── Envío ─────────────────────────────────────────────────────────────
// force=true saltea la ventana horaria y el intervalo (lo usa el botón de
// prueba del dueño), pero igual registra el envío.
async function generarYEnviarResumen({ force = false } = {}) {
  if (!force && INTERVALO_MIN <= 0) return { skipped: 'desactivado (RESUMEN_FLOTA_MIN=0)' };
  if (!push.pushEnabled()) {
    return { skipped: 'push no configurado — faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en el Environment' };
  }

  const ahora   = new Date();
  const ahoraAR = _ahoraAR(ahora);

  if (!force) {
    const h = ahoraAR.getHours();
    if (h < HORA_DESDE || h >= HORA_HASTA) {
      return { skipped: `fuera de la ventana horaria (${HORA_DESDE} a ${HORA_HASTA})` };
    }
  }

  const ultimo = await _ultimoEnvio();
  if (!force && ultimo) {
    const minutosDesde = (ahora - ultimo) / 60000;
    if (minutosDesde < INTERVALO_MIN) {
      return { skipped: `faltan ${Math.ceil(INTERVALO_MIN - minutosDesde)} min para el próximo` };
    }
  }

  // Ventana de novedades: desde el último resumen, o el intervalo hacia atrás
  // si es el primero (o si el anterior quedó muy viejo por un server dormido).
  const maxAtras = new Date(ahora - INTERVALO_MIN * 60000);
  const desde = (ultimo && ultimo > maxAtras) ? ultimo : maxAtras;

  const [estado, nov] = await Promise.all([estadoFlota(), novedadesDesde(desde)]);

  const enviados = await push.notifyDuenos({
    title: `🚛 Flota ${_hhmm(ahoraAR)}`,
    body:  armarCuerpo(estado, nov),
    tag:   'flota-resumen',
    url:   '/',
  });

  await _marcarEnviado(ahora);
  return { sent: _hhmm(ahoraAR), enviados, estado, novedades: { excesos: nov.excesos.length, ralentis: nov.ralentis.length } };
}

// ── Programación ──────────────────────────────────────────────────────
// Se reevalúa cada 5 minutos y la decisión de mandar o no la toma
// generarYEnviarResumen() contra app_config. Es a propósito: un setInterval
// de 2 horas se pierde si Render reinicia el servicio, y así el resumen
// sale igual apenas el server vuelve a estar arriba.
//
// El motivo del salteo se loguea SOLO cuando cambia. Con un tick cada 5 min,
// loguear siempre serían ~300 líneas por día de "fuera de ventana"; no
// loguear nunca dejaría una mala configuración (VAPID sin cargar) invisible.
let _ultimoMotivo = null;
function programarResumenFlota() {
  const tick = () => generarYEnviarResumen()
    .then((r) => {
      if (r.sent) {
        _ultimoMotivo = null;
        console.log(`[resumen-flota] enviado ${r.sent} a ${r.enviados} dispositivo(s)`);
      } else if (r.skipped && r.skipped !== _ultimoMotivo) {
        _ultimoMotivo = r.skipped;
        console.log('[resumen-flota] omitido:', r.skipped);
      }
    })
    .catch((e) => console.error('[resumen-flota]', e.message));
  setTimeout(tick, 90 * 1000);            // dejar que el boot y el primer sync GPS terminen
  setInterval(tick, 5 * 60 * 1000);
}

module.exports = {
  generarYEnviarResumen, programarResumenFlota,
  estadoFlota, novedadesDesde, armarCuerpo,
};
