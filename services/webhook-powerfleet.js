// ════════════════════════════════════════════════════════════════════
//  Webhook de Powerfleet — la alerta de velocidad, en el momento
//
//  Hasta ahora el exceso se detectaba en el sondeo: cada 2 minutos FleetOS le
//  pregunta a Powerfleet a qué velocidad va cada unidad. Eso significa que la
//  notificación podía llegar hasta 2 minutos tarde, y que un pico corto entre
//  dos sondeos no se veía nunca.
//
//  Con el webhook, Powerfleet nos avisa a NOSOTROS apenas detecta el exceso.
//  El sondeo se mantiene igual: sigue siendo el que actualiza la velocidad, el
//  km, la posición, el ralentí, y el que CIERRA el evento cuando la unidad baja.
//  El webhook solo adelanta la apertura. Si el proveedor deja de mandar, no se
//  pierde nada: se vuelve solo al comportamiento de antes.
//
//  Dos cosas que conviene tener presentes:
//
//  1) El umbral del webhook es el que tiene cargado Powerfleet, no el nuestro.
//     Por eso lo que llega NO se notifica tal cual: se pasa por las mismas
//     reglas de services/speeding.js (límite propio de cada unidad, semi-
//     rremolques excluidos, un push por evento). Si Powerfleet avisa de una
//     Berlingo a 95 y su límite es 110, acá no pasa nada. Es a propósito.
//
//  2) No sabemos con qué forma exacta manda el payload: la guía documenta la
//     RESPUESTA del alta, no lo que después llega. Por eso se guarda siempre
//     crudo en gps_webhook_events y la lectura de los campos es tolerante
//     (busca por varios nombres posibles, a cualquier profundidad). Con el
//     primer exceso real se ve el formato en /api/gps/webhook/ultimos.
// ════════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const { query } = require('../db/pool');
const speeding = require('./speeding');
const gps = require('./gps-powerfleet');

// Tipo de webhook que nos interesa. Del sondeo §30.4 de la cuenta:
//   1: Over Speeding event  ← el único que es una alerta
//   2..8: estados de comandos (inmovilizador, etc.), no son eventos de manejo
const TIPO_EXCESO = 1;

// Un aviso más viejo que esto no se procesa. Sin esta guarda, un reintento del
// proveedor (o una ráfaga acumulada después de una caída) reabriría excesos ya
// cerrados y dispararía notificaciones de algo que pasó hace rato.
const VENTANA_MIN = 15;

// Cuántos días de vida se le piden al alta del webhook, y con cuánta
// anticipación se renueva. Las suscripciones vencen: sin renovación el aviso
// se corta un día en silencio y nadie se entera hasta que falta una alerta.
const DIAS_ALTA    = Math.max(1, parseInt(process.env.GPS_WEBHOOK_DIAS || '365', 10) || 365);
const DIAS_RENOVAR = 7;

const SECRETO = String(process.env.GPS_WEBHOOK_SECRET || '').trim();

let _ready = false;
async function ensureSchema() {
  if (_ready) return;
  await query(`CREATE TABLE IF NOT EXISTS gps_webhook_events (
    id           BIGSERIAL PRIMARY KEY,
    recibido_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tipo         INTEGER,
    patente      VARCHAR(30),
    velocidad    NUMERIC(6,1),
    ocurrido_at  TIMESTAMPTZ,
    procesado    BOOLEAN NOT NULL DEFAULT FALSE,
    resultado    TEXT,
    payload      JSONB NOT NULL
  )`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_webhook_recibido ON gps_webhook_events(recibido_at DESC)`).catch(() => {});
  _ready = true;
}

// ── Lectura tolerante del payload ─────────────────────────────────────
// Recorre el objeto por niveles (primero lo más superficial) y devuelve el
// primer valor cuya clave coincida con alguno de los nombres buscados,
// ignorando mayúsculas, guiones y guiones bajos. Así da igual si el proveedor
// manda {licensePlate} o {data:{vehicle:{LicensePlate}}}.
const _k = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Busca UN nombre en todo el objeto, por niveles (primero lo más superficial).
function _buscarUno(raiz, buscado, numerico) {
  const cola = [raiz];
  let vueltas = 0;
  while (cola.length && vueltas++ < 500) {
    const nodo = cola.shift();
    if (!nodo || typeof nodo !== 'object') continue;
    for (const [clave, valor] of Object.entries(nodo)) {
      if (valor === null || valor === undefined || valor === '') continue;
      if (typeof valor === 'object') continue;                   // los hijos se ven en la vuelta siguiente
      if (_k(clave) !== buscado) continue;
      if (numerico) {
        const n = parseFloat(valor);
        if (!Number.isNaN(n)) return n;
        continue;
      }
      return valor;
    }
    for (const valor of Object.values(nodo)) {
      if (valor && typeof valor === 'object') cola.push(valor);
    }
  }
  return null;
}

// Los nombres se prueban EN ORDEN: el primero de la lista que aparezca gana,
// aunque otro esté más arriba en el objeto. Hace falta porque alguno de los
// nombres posibles es genérico ('id'), y en un payload con {id, vehicleId} el
// bueno es el segundo aunque figure después.
function buscarCampo(raiz, nombres, { numerico = false } = {}) {
  for (const nombre of nombres) {
    const v = _buscarUno(raiz, _k(nombre), numerico);
    if (v !== null) return v;
  }
  return null;
}

// Powerfleet usa 'YYYY/MM/DD HH:mm' en varios endpoints, y también manda ISO.
// Si no se puede leer, devolvemos null: sin fecha se procesa igual (mejor una
// alerta a destiempo que una alerta perdida), la ventana solo filtra cuando
// sabemos con certeza que el evento es viejo.
//
// Cuando la fecha viene SIN zona horaria se interpreta como UTC, no como la hora
// del servidor. El proveedor manda UTC: en la respuesta de fleetview su
// maxInsertTime coincide al segundo con la hora UTC de nuestro reloj, no con la
// argentina. Y esto no es un detalle: si el server corriera en hora argentina,
// una fecha sin zona se leería 3 horas vieja, la ventana la descartaría, y no
// llegaría NINGUNA alerta — sin un solo error en el log.
function leerFecha(v) {
  if (!v) return null;
  let s = String(v).trim().replace(/\//g, '-');       // 2026/07/29 → 2026-07-29
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/.exec(s);
  if (m) s = `${m[1]}T${m[2]}Z`;                      // sin zona → UTC explícito
  const d = new Date(s);                              // las que ya traen Z u offset pasan derecho
  return Number.isNaN(d.getTime()) ? null : d;
}

// Ninguno de estos números es de fiar: entran por un endpoint público y los
// pone un GPS que a veces alucina. Fuera de rango se devuelve null en vez de
// intentar guardarlos — un valor absurdo hacía explotar el INSERT (la columna es
// NUMERIC(6,1)) y con él se perdía el payload entero, que es lo único que
// realmente no se puede perder.
const VELOCIDAD_MAX = 300;   // km/h — arriba de esto es una falla del sensor, no un camión
function numeroSeguro(v, max) {
  if (v === null || !Number.isFinite(v) || v < 0 || v > max) return null;
  return v;
}

function extraer(payload) {
  // gpsDateTime y rowReferenceTime salen del payload REAL de fleetview en esta
  // cuenta; el resto son los nombres habituales, por si el webhook usa otro.
  const fecha = leerFecha(buscarCampo(payload,
    ['eventDate', 'eventTime', 'gpsDateTime', 'gpsDate', 'dateTime', 'occurredAt', 'timestamp', 'date', 'rowReferenceTime']));
  // Una fecha delirante (año 9999) también rompe la columna. Se permite hasta un
  // año para adelante porque el proveedor podría mandar hora local argentina sin
  // zona, y eso ya se ve como unas horas en el futuro.
  const AÑO = 365 * 24 * 3600 * 1000;
  return {
    tipo:      numeroSeguro(buscarCampo(payload, ['webhookType', 'notificationType', 'eventType', 'alertType'], { numerico: true }), 2147483647),
    patente:   buscarCampo(payload, ['licensePlate', 'plate', 'plateNo', 'vehiclePlate', 'patente']),
    // Un webhook muy probablemente identifique la unidad por su id interno y no
    // por la patente. El sync guarda ese id en vehicles.gps_vehicle_id, así que
    // sirve igual para saber de qué unidad habla.
    //
    // 'id' va ÚLTIMO y es el que efectivamente usa esta cuenta: en
    // fleetview/vehicles cada unidad viene como {id:"58795", licensePlate:...}.
    // Queda al final porque es un nombre genérico y en un payload que traiga
    // también el id del evento, el bueno es el específico.
    vehicleId: buscarCampo(payload, ['vehicleId', 'assetId', 'unitId', 'objectId', 'deviceId', 'id']),
    velocidad: numeroSeguro(buscarCampo(payload, ['speed', 'currentSpeed', 'maxSpeed', 'speedKmh', 'velocity'], { numerico: true }), VELOCIDAD_MAX),
    limite:    numeroSeguro(buscarCampo(payload, ['speedLimit', 'limitSpeed', 'maxAllowedSpeed', 'threshold'], { numerico: true }), VELOCIDAD_MAX),
    fecha:     fecha && Math.abs(fecha.getTime() - Date.now()) < AÑO ? fecha : null,
    direccion: buscarCampo(payload, ['address', 'location', 'direccion']),
  };
}

// ── Procesar un aviso ─────────────────────────────────────────────────
// SIEMPRE guarda el payload crudo antes de interpretarlo: si la lectura falla,
// el aviso queda igual en la base y se puede ver qué mandaron.
// Nunca tira error hacia afuera — la ruta tiene que contestar 200 igual, si no
// el proveedor puede dar de baja la suscripción por su cuenta.
async function procesar(payload) {
  await ensureSchema();
  const d = extraer(payload);

  const ins = await query(
    `INSERT INTO gps_webhook_events (tipo, patente, velocidad, ocurrido_at, payload)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [d.tipo, d.patente ? String(d.patente).slice(0, 30) : null, d.velocidad, d.fecha, JSON.stringify(payload ?? null)]);
  const id = ins.rows[0].id;

  const cerrar = async (resultado, procesado = false) => {
    await query('UPDATE gps_webhook_events SET resultado=$1, procesado=$2 WHERE id=$3',
      [resultado, procesado, id]).catch(() => {});
    return { id, resultado, procesado };
  };

  // Los tipos 2..8 son estados de comandos, no eventos de manejo: se guardan
  // para tener el registro, pero no generan nada. Cuando el tipo no viene
  // (todavía no conocemos el formato) se sigue de largo y se decide por los datos.
  if (d.tipo !== null && d.tipo !== TIPO_EXCESO) return cerrar(`tipo ${d.tipo}: no es exceso de velocidad`);
  if (!d.patente && !d.vehicleId) return cerrar('llegó sin patente ni id de unidad — ver payload');
  if (d.velocidad === null) {
    // Se distingue "no vino" de "vino un disparate": lo segundo es un sensor
    // fallado y conviene que se lea así en el diagnóstico.
    const crudo = buscarCampo(payload, ['speed', 'currentSpeed', 'maxSpeed', 'speedKmh', 'velocity'], { numerico: true });
    return cerrar(crudo === null
      ? 'llegó sin velocidad reconocible — ver payload'
      : `velocidad imposible (${crudo} km/h): falla del sensor, se descarta`);
  }

  if (d.fecha) {
    const min = Math.round((Date.now() - d.fecha.getTime()) / 60000);
    if (min > VENTANA_MIN) return cerrar(`evento de hace ${min} min: fuera de la ventana de ${VENTANA_MIN}`);
  }

  // Se identifica por patente, y si no vino, por el id interno de Powerfleet que
  // el sync guarda en cada unidad. Si vinieran los dos apuntando a unidades
  // distintas gana la patente: es la clave de la tabla y lo que identifica al
  // camión para quien lee la alerta, mientras que el id guardado vale lo que
  // valga el último sync.
  const r = await query(
    `SELECT id, code, plate, base, type,
            (UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) =
             UPPER(REGEXP_REPLACE($1,    '[^A-Z0-9]', '', 'g'))) AS por_patente
       FROM vehicles
      WHERE active IS NOT FALSE
        AND ( ($1::text IS NOT NULL AND UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) =
                                        UPPER(REGEXP_REPLACE($1,    '[^A-Z0-9]', '', 'g')))
           OR ($2::text IS NOT NULL AND gps_vehicle_id = $2) )
      ORDER BY por_patente DESC NULLS LAST
      LIMIT 1`,
    [d.patente ? String(d.patente) : null, d.vehicleId != null ? String(d.vehicleId) : null]);
  if (!r.rows.length) {
    const quien = d.patente ? `patente ${d.patente}` : `id de Powerfleet ${d.vehicleId}`;
    return cerrar(`${quien} no está en la flota de FleetOS`);
  }

  // Las mismas reglas que el sondeo: límite propio de la unidad, semirremolques
  // afuera, un push por evento. Si Powerfleet avisa por debajo de nuestro
  // límite, acá no se abre nada.
  const verdicto = await speeding.processVehicle(r.rows[0], d.velocidad);
  const detalle = `${r.rows[0].code} a ${Math.round(d.velocidad)} km/h → ${verdicto}`;
  return cerrar(detalle, true);
}

// ── Verificación del secreto ──────────────────────────────────────────
// El endpoint es público (lo llama una máquina del proveedor, sin sesión), así
// que la única puerta es este secreto, que va en la URL que damos de alta.
function secretoOk(dado) {
  if (!SECRETO) return false;
  const a = Buffer.from(String(dado || ''), 'utf8');
  const b = Buffer.from(SECRETO, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function configurado() { return !!SECRETO; }

// URL completa que hay que registrar en Powerfleet. Se arma con el dominio
// público de la app; GPS_WEBHOOK_URL permite fijarla a mano si FRONTEND_URL no
// es el dominio real (o si hay más de uno).
function urlPublica() {
  if (!SECRETO) return null;
  const base = String(process.env.GPS_WEBHOOK_URL || String(process.env.FRONTEND_URL || '').split(',')[0] || '')
    .trim().replace(/\/+$/, '');
  if (!base) return null;
  if (base.includes('/api/gps/webhook/')) return base;   // ya vino la URL completa
  return `${base}/api/gps/webhook/${encodeURIComponent(SECRETO)}`;
}

// ── Alta / baja / listado en Powerfleet ───────────────────────────────
function _json(res) {
  try { return JSON.parse(res.body); } catch (_) { return null; }
}

async function listar() {
  const res = await gps.apiRequest('/Fleetcore.api/api/webhooks');
  const d = _json(res);
  return { status: res.status, webhooks: (d && d.data) || [], crudo: d || res.body };
}

// Da de alta la suscripción. Devuelve TODO lo que contestó el proveedor: la
// guía documenta la respuesta como {"isSucceded": true} y nada más, así que si
// falta un campo obligatorio la única forma de saberlo es leer el error tal cual.
async function alta({ url, nombre, accountId, dias = DIAS_ALTA } = {}) {
  const destino = url || urlPublica();
  if (!destino) {
    const e = new Error('Falta la URL pública. Configurá GPS_WEBHOOK_SECRET y FRONTEND_URL (o GPS_WEBHOOK_URL).');
    e.code = 'SIN_URL'; throw e;
  }
  await gps.login();
  const cuenta = accountId != null ? accountId : gps.accountIdDelToken();
  const vence = new Date(Date.now() + dias * 24 * 3600 * 1000);

  // No sabemos exactamente qué espera el proveedor: la guía documenta la
  // respuesta del alta (un escueto {"isSucceded": true}) pero no es precisa con
  // el pedido. Hay dos dudas concretas y baratas de resolver probando, así que
  // se prueban en vez de fallar y hacer ida y vuelta:
  //   - la fecha: acá se manda ISO, pero otros endpoints de la misma API usan
  //     'YYYY/MM/DD HH:mm';
  //   - AccountId: se saca de los claims del token, que puede no traerlo. Si lo
  //     mandamos mal es peor que no mandarlo.
  const fmtPf = (x) => `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  const base = {
    Id: 0,
    URL: destino,
    Name: nombre || 'FleetOS exceso de velocidad',
    webhookType: TIPO_EXCESO,
    Token: SECRETO,
  };

  const variantes = [];
  for (const [etiquetaFecha, fecha] of [['ISO', vence.toISOString()], ['YYYY/MM/DD HH:mm', fmtPf(vence)]]) {
    for (const conCuenta of cuenta != null ? [true, false] : [false]) {
      const cuerpo = Object.assign({}, base, { expirationDate: fecha });
      if (conCuenta) cuerpo.AccountId = cuenta;
      variantes.push({ etiqueta: `fecha ${etiquetaFecha}${conCuenta ? ' + AccountId' : ' sin AccountId'}`, cuerpo });
    }
  }

  let res, d, ok = false, cuerpo = variantes[0].cuerpo, intentos = [];
  for (const v of variantes) {
    res = await gps.apiRequest('/Fleetcore.api/api/webhooks', { method: 'POST', body: v.cuerpo });
    d = _json(res);
    ok = res.status === 200 && (!d || d.isSucceded !== false);
    cuerpo = v.cuerpo;
    intentos.push({ variante: v.etiqueta, status: res.status, ok, respuesta: d || String(res.body).slice(0, 200) });
    console.log(`[webhook] alta (${v.etiqueta}): HTTP ${res.status} ${ok ? 'OK' : 'rechazado'}`);
    if (ok) break;
  }

  if (ok) {
    // Se guarda el cuerpo que FUNCIONÓ: la renovación automática lo reusa tal
    // cual en vez de volver a adivinar los campos.
    await query(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value JSONB NOT NULL)`).catch(() => {});
    await query(`INSERT INTO app_config(key,value) VALUES('gps_webhook',$1)
                 ON CONFLICT(key) DO UPDATE SET value=$1`,
      [JSON.stringify({ registrado_at: new Date().toISOString(), vence: vence.toISOString(), cuerpo })]).catch(() => {});
  }
  return { ok, status: res.status, cuerpo, respuesta: d || res.body, intentos };
}

async function baja(id) {
  const res = await gps.apiRequest(`/Fleetcore.api/api/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { ok: res.status === 200, status: res.status, respuesta: _json(res) || res.body };
}

// ── Renovación automática ─────────────────────────────────────────────
// Solo actúa si YA hubo un alta exitosa (el script guardó el cuerpo que anduvo).
// Renueva cuando falta menos de DIAS_RENOVAR para el vencimiento. No intenta
// dar de alta por su cuenta: si nunca se registró, avisa y no toca nada.
async function renovarSiHaceFalta() {
  await query(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value JSONB NOT NULL)`).catch(() => {});
  const r = await query(`SELECT value FROM app_config WHERE key='gps_webhook'`).catch(() => ({ rows: [] }));
  const guardado = r.rows[0] && r.rows[0].value;
  if (!guardado || !guardado.cuerpo) {
    console.log('[webhook] no hay suscripción registrada — correr: node scripts/webhook-powerfleet.js alta');
    return { renovado: false, motivo: 'nunca se dio de alta' };
  }
  const vence = new Date(guardado.vence || 0).getTime();
  const dias = (vence - Date.now()) / 86400000;
  if (dias > DIAS_RENOVAR) return { renovado: false, motivo: `vence en ${Math.round(dias)} días` };

  console.log(`[webhook] la suscripción vence en ${Math.round(dias)} días: renovando`);
  const res = await alta({ url: guardado.cuerpo.URL, nombre: guardado.cuerpo.Name, accountId: guardado.cuerpo.AccountId })
    .catch((e) => ({ ok: false, respuesta: e.message }));
  console.log(res.ok ? '[webhook] renovada' : '[webhook] la renovación falló: ' + JSON.stringify(res.respuesta).slice(0, 200));
  return { renovado: res.ok, respuesta: res.respuesta };
}

// ── Estado para el diagnóstico (lo mira el dueño desde la app) ─────────
async function ultimos(limite = 20) {
  await ensureSchema();
  const n = Math.min(Math.max(parseInt(limite) || 20, 1), 100);
  const r = await query(
    `SELECT id, recibido_at, tipo, patente, velocidad, ocurrido_at, procesado, resultado, payload
       FROM gps_webhook_events ORDER BY id DESC LIMIT $1`, [n]);
  const c = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE procesado)::int AS procesados,
            MAX(recibido_at) AS ultimo
       FROM gps_webhook_events`);
  return {
    configurado: configurado(),
    url: urlPublica() ? urlPublica().replace(SECRETO, '••••••') : null,
    resumen: c.rows[0],
    eventos: r.rows,
  };
}

// Los avisos se guardan para poder ver el formato y auditar; después de un mes
// no sirven para nada y solo ocupan lugar.
async function purgar() {
  await ensureSchema();
  const r = await query(`DELETE FROM gps_webhook_events WHERE recibido_at < NOW() - INTERVAL '30 days'`).catch(() => ({ rowCount: 0 }));
  if (r.rowCount) console.log(`[webhook] purgados ${r.rowCount} avisos de más de 30 días`);
}

// Arranque: si el webhook no está configurado, no hace absolutamente nada (la
// app sigue funcionando con el sondeo de siempre).
function programarWebhook() {
  if (!configurado()) {
    console.log('[webhook] desactivado (falta GPS_WEBHOOK_SECRET) — el exceso se sigue detectando por el sondeo');
    return;
  }
  console.log('[webhook] activo. URL a registrar:', (urlPublica() || '(falta FRONTEND_URL)').replace(SECRETO, '••••••'));
  const tick = () => {
    renovarSiHaceFalta().catch((e) => console.error('[webhook] renovación:', e.message));
    purgar().catch(() => {});
  };
  setTimeout(tick, 60000);
  setInterval(tick, 12 * 60 * 60 * 1000);
}

module.exports = {
  ensureSchema, procesar, extraer, buscarCampo, leerFecha,
  secretoOk, configurado, urlPublica,
  listar, alta, baja, renovarSiHaceFalta, ultimos, purgar, programarWebhook,
  TIPO_EXCESO, VENTANA_MIN,
};
