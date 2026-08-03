// ════════════════════════════════════════════════════════════════════
//  Aviso de documentación por vencer (VTV, seguro, licencias, RUTA…)
//
//  El dato ya estaba: documents.expiry_date se carga desde la pantalla de
//  Documentación y se lista ordenado por fecha. Lo que faltaba es que ALGUIEN
//  AVISE. Una VTV vencida es una multa; un seguro vencido es un siniestro sin
//  cobertura. Nadie se entera mirando una lista que hay que acordarse de abrir.
//
//  Reglas de diseño (las mismas que resumen-flota, por las mismas razones):
//
//   - Lo vencido va PRIMERO. Es lo que exige acción hoy.
//   - No se repite todos los días. Un aviso que dice siempre lo mismo se vuelve
//     papel pintado y se deja de leer. Se manda cuando CAMBIA algo (entró un
//     documento nuevo a la ventana, o uno pasó a vencido) y, si no cambia nada,
//     como mucho un recordatorio cada VENCIMIENTOS_RECORDAR_DIAS.
//   - Una sola notificación por día, dentro de una ventana horaria acotada
//     ARRIBA y abajo: ni a las 3 AM ni a las 23.
//   - Si no hay nada por vencer, no manda nada.
//   - Solo se anota como avisado si SALIÓ por algún lado. Si no se entregó,
//     se reintenta en vez de dar el aviso por hecho.
//   - Solo documentos de unidades y personas que siguen operando.
//
//  Variables de entorno (todas opcionales):
//    VENCIMIENTOS_OFF=1            desactiva el aviso por completo
//    VENCIMIENTOS_DIAS             ventana en días (default 30)
//    VENCIMIENTOS_DIAS_CRITICO     umbral de "urgente" (default 7)
//    VENCIMIENTOS_HORA             hora argentina de inicio (default 8)
//    VENCIMIENTOS_HORA_HASTA       hora argentina de fin    (default 22)
//    VENCIMIENTOS_RECORDAR_DIAS    recordatorio si no cambió nada (default 7)
//    VENCIMIENTOS_ROLES            a quiénes avisar (default dueno,gerencia)
//    VENCIMIENTOS_EMAIL_TO         además del push, mandar mail acá
// ════════════════════════════════════════════════════════════════════
const { query } = require('../db/pool');
const push = require('./push');

const TZ            = 'America/Argentina/Buenos_Aires';
const DIAS          = Math.max(1, parseInt(process.env.VENCIMIENTOS_DIAS || '30', 10) || 30);
const DIAS_CRITICO  = Math.max(0, parseInt(process.env.VENCIMIENTOS_DIAS_CRITICO || '7', 10) || 7);
const HORA          = Math.min(23, Math.max(0, parseInt(process.env.VENCIMIENTOS_HORA || '8', 10) || 8));
const HORA_HASTA    = Math.min(23, Math.max(HORA, parseInt(process.env.VENCIMIENTOS_HORA_HASTA || '22', 10) || 22));
const RECORDAR_DIAS = Math.max(1, parseInt(process.env.VENCIMIENTOS_RECORDAR_DIAS || '7', 10) || 7);
const EMAIL_TO      = (process.env.VENCIMIENTOS_EMAIL_TO || '').trim();

// A quién se le avisa. Por defecto SOLO los roles que además pueden ABRIR la
// pantalla de Documentación: mandar una notificación que al tocarla lleva a
// "home" es peor que no mandarla.
//
// jefe_mantenimiento NO está por eso: es el dueño natural del tema, pero hoy
// su rol no tiene el módulo 'documents' (public/js/roles.js:373) y
// _destinoInicial() manda a home cualquier ?ir= no permitido. Para sumarlo hay
// que darle el módulo primero — es una decisión de permisos, no de este aviso.
const ROLES = (process.env.VENCIMIENTOS_ROLES || 'dueno,gerencia')
  .split(',').map((r) => r.trim()).filter(Boolean);

function desactivado() {
  return String(process.env.VENCIMIENTOS_OFF || '') === '1';
}

// "Qué día es" y "qué hora es" en Argentina, que es lo que mira el que recibe
// el aviso.
//
// Se sacan con Intl directamente, SIN pasar por un Date intermedio. El camino
// intuitivo —new Date(toLocaleString(...)) y después toISOString()— se corre un
// día: ese Date se interpreta en la zona del proceso y toISOString() lo vuelve a
// llevar a UTC, así que entre las 21 y las 24 argentinas devuelve el día
// siguiente. Con eso, un aviso de la noche guardaba la fecha de mañana y tapaba
// el de la mañana siguiente. (Es la misma trampa que hace que un cliente de
// Postgres en UTC y otro en hora argentina no coincidan en CURRENT_DATE.)
//
// 'en-CA' se usa porque formatea como YYYY-MM-DD, que es lo que se guarda.
function _hoyAR(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: TZ });
}
function _horaAR(now = new Date()) {
  return parseInt(now.toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }), 10);
}

// ── Qué está por vencer ───────────────────────────────────────────────
// Se apoya en la misma forma que usa la pantalla de Documentación para
// nombrar la entidad, así el aviso dice "AH327RZ" y no un UUID.
async function documentosPorVencer({ dias = DIAS } = {}) {
  const r = await query(`
    SELECT d.id, d.doc_type, d.expiry_date, d.entity_type,
           (d.expiry_date - CURRENT_DATE) AS dias_restantes,
           CASE
             WHEN d.entity_type = 'vehicle' THEN COALESCE(v.code, v.plate, 'Vehículo eliminado')
             WHEN d.entity_type = 'user'    THEN COALESCE(u.name, 'Usuario eliminado')
             ELSE d.entity_id::text
           END AS entidad
      FROM documents d
      LEFT JOIN vehicles v ON d.entity_type = 'vehicle' AND v.id = d.entity_id
      LEFT JOIN users    u ON d.entity_type = 'user'    AND u.id = d.entity_id
     WHERE d.expiry_date IS NOT NULL
       AND d.expiry_date <= CURRENT_DATE + $1::int
       -- Solo de unidades y personas que siguen operando. Dar de baja un
       -- vehículo no borra la fila (DELETE /api/vehicles/:id hace
       -- active = FALSE), así que sin este filtro la VTV vencida de un camión
       -- que ya no está seguiría apareciendo en el aviso para siempre. Lo mismo
       -- con la licencia de alguien que ya no trabaja acá.
       AND (d.entity_type <> 'vehicle' OR v.active IS TRUE)
       AND (d.entity_type <> 'user'    OR u.active IS TRUE)
     ORDER BY d.expiry_date ASC`, [dias]);

  const vencidos = [], criticos = [], proximos = [];
  for (const row of r.rows) {
    const d = Number(row.dias_restantes);
    const item = { ...row, dias_restantes: d };
    if (d < 0) vencidos.push(item);
    else if (d <= DIAS_CRITICO) criticos.push(item);
    else proximos.push(item);
  }
  return { vencidos, criticos, proximos, total: r.rows.length };
}

// ── Texto del aviso ───────────────────────────────────────────────────
// Corto: se lee en la pantalla de bloqueo de un celular. Lo vencido primero,
// y como mucho unos pocos ejemplos con el resto contado.
function _linea(doc) {
  const d = doc.dias_restantes;
  const cuando = d < 0 ? `vencido hace ${Math.abs(d)} d`
    : d === 0 ? 'vence HOY'
      : `en ${d} d`;
  return `${doc.entidad} · ${doc.doc_type} (${cuando})`;
}

function armarCuerpo({ vencidos, criticos, proximos }) {
  const partes = [];
  if (vencidos.length) partes.push(`${vencidos.length} vencido${vencidos.length > 1 ? 's' : ''}`);
  if (criticos.length) partes.push(`${criticos.length} vence${criticos.length > 1 ? 'n' : ''} esta semana`);
  if (proximos.length) partes.push(`${proximos.length} en ${DIAS} días`);
  if (!partes.length) return null;

  const destacar = [...vencidos, ...criticos].slice(0, 4).map(_linea);
  const restantes = vencidos.length + criticos.length - destacar.length;
  const cuerpo = destacar.join('\n') + (restantes > 0 ? `\n…y ${restantes} más` : '');

  return {
    title: `📋 Documentación: ${partes.join(', ')}`,
    body: cuerpo || `${proximos.length} documento(s) vencen en los próximos ${DIAS} días.`,
    // tag fijo: el aviso nuevo REEMPLAZA al anterior en la bandeja en vez de
    // apilar siete iguales.
    tag: 'fleetos-vencimientos',
    url: '/?ir=documents',
  };
}

// ── "Ya avisé esto" ───────────────────────────────────────────────────
// Se guarda una firma del conjunto (qué documentos y en qué estado) junto con
// la fecha. Si la firma no cambió, no se vuelve a avisar hasta que pasen
// RECORDAR_DIAS: así un vencimiento que sigue sin resolverse recuerda una vez
// por semana en lugar de todos los días.
function _firma({ vencidos, criticos, proximos }) {
  const marca = (arr, tag) => arr.map((d) => `${tag}:${d.id}`).sort();
  return [...marca(vencidos, 'v'), ...marca(criticos, 'c'), ...marca(proximos, 'p')].join('|');
}

async function _leerEstado() {
  await query(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value JSONB NOT NULL)`).catch(() => {});
  const r = await query(`SELECT value FROM app_config WHERE key = 'vencimientos_last'`);
  if (!r.rows[0]) return null;
  try {
    return typeof r.rows[0].value === 'string' ? JSON.parse(r.rows[0].value) : r.rows[0].value;
  } catch (_) { return null; }
}

async function _guardarEstado(estado) {
  await query(`INSERT INTO app_config(key,value) VALUES('vencimientos_last',$1)
               ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(estado)]);
}

function _diasEntre(isoA, isoB) {
  const a = Date.parse(isoA + 'T00:00:00Z');
  const b = Date.parse(isoB + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.round((b - a) / 86400000);
}

// ── Envío ─────────────────────────────────────────────────────────────
// `notificar` es parametrizable solo para poder testear el camino en que el
// aviso SÍ se entrega: en los tests no hay claves VAPID ni suscripciones, así
// que el push real siempre devolvería 0. En producción es push.notifyRoles.
async function generarYEnviarAviso({ force = false, now = new Date(), notificar = null } = {}) {
  if (desactivado() && !force) return { skipped: 'desactivado (VENCIMIENTOS_OFF=1)' };

  const hoy = _hoyAR(now);
  const hora = _horaAR(now);
  const datos = await documentosPorVencer();
  const cuerpo = armarCuerpo(datos);

  if (!cuerpo) return { skipped: 'no hay documentos por vencer' };

  const previo = await _leerEstado();
  const firma = _firma(datos);

  if (!force) {
    // Ventana con tope arriba, no solo abajo: un reinicio o un recordatorio
    // vencido a las 23 no tiene que hacer sonar el celular de nadie. Mismo
    // criterio que RESUMEN_FLOTA_DESDE / _HASTA.
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

  let mail = false;
  if (EMAIL_TO) {
    try {
      const mailer = require('./mailer');
      if (mailer.mailEnabled && mailer.mailEnabled()) {
        const detalle = [...datos.vencidos, ...datos.criticos, ...datos.proximos].map(_linea).join('\n');
        await mailer.sendMail({
          to: EMAIL_TO,
          subject: cuerpo.title,
          text: `${cuerpo.title}\n\n${detalle}\n\nSe ve completo en FleetOS → Documentación.\n`,
        });
        mail = true;
      }
    } catch (e) {
      // El mail es un extra: que falle no debe tapar el push que sí salió.
      console.error('[vencimientos] mail falló:', e.message);
    }
  }

  // Solo se anota como avisado si SALIÓ por algún lado. Si no hay claves VAPID,
  // nadie está suscripto y no hay mail configurado, no se entregó nada: darlo
  // por avisado haría que, cuando alguien se suscriba, el aviso quede tapado
  // hasta el próximo recordatorio. Sin anotar, sale en el siguiente intento.
  if (!enviados && !mail) {
    return { skipped: 'no se pudo entregar a nadie (push sin configurar, sin suscripciones y sin mail)' };
  }

  await _guardarEstado({ dia: hoy, firma });
  return {
    sent: cuerpo.title, enviados, mail,
    vencidos: datos.vencidos.length, criticos: datos.criticos.length, proximos: datos.proximos.length,
  };
}

// ── Agendado ──────────────────────────────────────────────────────────
// Cada 30 minutos se fija si corresponde avisar. La ventana horaria y el
// "ya avisé" los decide generarYEnviarAviso, no el reloj del setInterval:
// así un reinicio del server no dispara un aviso de más.
let _ultimoMotivo = null;
function programarVencimientos() {
  if (desactivado()) {
    console.log('[vencimientos] desactivado por VENCIMIENTOS_OFF=1');
    return;
  }
  const tick = () => generarYEnviarAviso()
    .then((r) => {
      if (r.sent) {
        _ultimoMotivo = null;
        console.log(`[vencimientos] avisado a ${r.enviados} dispositivo(s): ${r.vencidos} vencidos, ${r.criticos} críticos`);
      } else if (r.skipped && r.skipped !== _ultimoMotivo) {
        _ultimoMotivo = r.skipped;
        console.log('[vencimientos] omitido:', r.skipped);
      }
    })
    .catch((e) => console.error('[vencimientos]', e.message));
  setTimeout(tick, 120 * 1000);          // dejar que el boot termine
  setInterval(tick, 30 * 60 * 1000);
}

module.exports = {
  documentosPorVencer, armarCuerpo, generarYEnviarAviso, programarVencimientos,
  DIAS, DIAS_CRITICO, HORA, HORA_HASTA, RECORDAR_DIAS, ROLES,
};
