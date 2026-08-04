// ═══════════════════════════════════════════════════════════════════════════
//  Mantenimiento preventivo.
//
//  El cálculo y la validación son puros: corren siempre. El resto necesita base
//  (TEST_DATABASE_URL) y se saltea sin ella.
//
//  Lo que más se cuida: que NO invente números. Un plan sin línea de base tiene
//  que decir "no sé", no estimar. Decirle a alguien que a un motor le quedan
//  5.000 km cuando en realidad no hay contra qué medir es peor que no decir nada.
// ═══════════════════════════════════════════════════════════════════════════
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

const DBURL = process.env.TEST_DATABASE_URL || (process.env.NODE_ENV === 'test' ? process.env.DATABASE_URL : null);
const SKIP = !DBURL;

const mant = require('../services/mantenimiento');
const { leerPlan } = require('../routes/mantenimiento');

// ── Cálculo del estado (puro) ─────────────────────────────────────────
const plan = (o) => ({
  id: 'p1', vehicle_id: 'v1', vehicle_code: 'AH327RZ',
  nombre: 'Cambio de aceite', tipo: 'km', intervalo: 15000, aviso_antes: 1000, ...o,
});

test('km: calcula cuánto falta contra el odómetro de la unidad', () => {
  const r = mant.calcular(plan({ ultimo_valor: 180000, km_current: 194200 }));
  assert.strictEqual(r.proximo, 195000);
  assert.strictEqual(r.restante, 800);
  assert.strictEqual(r.estado, 'proximo', 'a 800 km con aviso a 1000 ya entra en ventana');
});

test('km: todavía lejos es "ok"', () => {
  const r = mant.calcular(plan({ ultimo_valor: 180000, km_current: 185000 }));
  assert.strictEqual(r.restante, 10000);
  assert.strictEqual(r.estado, 'ok');
});

test('km: pasado es "vencido" y el restante va en negativo', () => {
  const r = mant.calcular(plan({ ultimo_valor: 180000, km_current: 196500 }));
  assert.strictEqual(r.restante, -1500);
  assert.strictEqual(r.estado, 'vencido');
});

test('sin línea de base NO inventa un número', () => {
  const r = mant.calcular(plan({ ultimo_valor: null, km_current: 194200 }));
  assert.strictEqual(r.estado, 'sin_base');
  assert.strictEqual(r.restante, null, 'nada de estimar sobre un motor');
});

test('sin contador en la unidad tampoco inventa', () => {
  const r = mant.calcular(plan({ ultimo_valor: 180000, km_current: null }));
  assert.strictEqual(r.estado, 'sin_base');
});

test('horas: usa el horómetro, no el odómetro', () => {
  const r = mant.calcular(plan({
    tipo: 'horas', intervalo: 500, aviso_antes: 50,
    ultimo_valor: 3000, gps_hour_meter: 3480, km_current: 999999,
  }));
  assert.strictEqual(r.restante, 20);
  assert.strictEqual(r.estado, 'proximo');
  assert.strictEqual(r.unidad_medida, 'h');
});

test('días: cuenta contra el calendario', () => {
  const hoy = new Date('2026-08-03T12:00:00Z');
  const r = mant.calcular(plan({
    tipo: 'dias', intervalo: 180, aviso_antes: 15, ultima_fecha: '2026-02-20',
  }), hoy);
  // 2026-02-20 + 180 días = 2026-08-19 → faltan 16
  assert.strictEqual(r.proximo, '2026-08-19');
  assert.strictEqual(r.restante, 16);
  assert.strictEqual(r.estado, 'ok', 'a 16 días con aviso a 15 todavía no entra');
});

test('días sin fecha de base es sin_base', () => {
  const r = mant.calcular(plan({ tipo: 'dias', intervalo: 180, ultima_fecha: null }));
  assert.strictEqual(r.estado, 'sin_base');
});

// ── El aviso ──────────────────────────────────────────────────────────
test('sin nada vencido ni próximo no se arma aviso', () => {
  assert.strictEqual(mant.armarCuerpo([{ estado: 'ok' }, { estado: 'sin_base' }]), null);
});

test('lo pasado va primero y se dice por cuánto', () => {
  const c = mant.armarCuerpo([
    { estado: 'proximo', unidad: 'AF823RB', nombre: 'Filtros', restante: 300, unidad_medida: 'km' },
    { estado: 'vencido', unidad: 'AH327RZ', nombre: 'Aceite', restante: -1500, unidad_medida: 'km' },
  ]);
  assert.match(c.title, /1 pasado, 1 por vencer/);
  assert.match(c.body.split('\n')[0], /AH327RZ/, 'lo vencido encabeza');
  assert.match(c.body, /pasado por 1500 km/);
  assert.match(c.body, /faltan 300 km/);
});

test('restante 0 se dice "toca AHORA", no "faltan 0"', () => {
  const c = mant.armarCuerpo([{ estado: 'proximo', unidad: 'X', nombre: 'Y', restante: 0, unidad_medida: 'km' }]);
  assert.match(c.body, /toca AHORA/);
  assert.doesNotMatch(c.body, /faltan 0/);
});

// ── Validación de la entrada ──────────────────────────────────────────
test('rechaza lo que no se puede calcular', () => {
  assert.match(leerPlan({}).error, /unidad/);
  assert.match(leerPlan({ vehicle_id: 'v' }).error, /nombre/);
  assert.match(leerPlan({ vehicle_id: 'v', nombre: 'x' }).error, /tipo/);
  assert.match(leerPlan({ vehicle_id: 'v', nombre: 'x', tipo: 'millas' }).error, /tipo tiene que ser/);
  assert.match(leerPlan({ vehicle_id: 'v', nombre: 'x', tipo: 'km' }).error, /intervalo/);
  assert.match(leerPlan({ vehicle_id: 'v', nombre: 'x', tipo: 'km', intervalo: 0 }).error, /mayor a cero/);
});

test('el aviso previo no puede ser mayor o igual al intervalo', () => {
  // Si avisás 20.000 km antes de algo que pasa cada 15.000, el plan queda en
  // "próximo" para siempre y el aviso nunca se apaga.
  const r = leerPlan({ vehicle_id: 'v', nombre: 'x', tipo: 'km', intervalo: 15000, aviso_antes: 20000 });
  assert.match(r.error, /menor que el intervalo/);
});

test('un plan válido pasa y queda normalizado', () => {
  const { datos, error } = leerPlan({
    vehicle_id: 'v1', nombre: '  Cambio de aceite  ', tipo: 'KM', intervalo: '15000', aviso_antes: '1000',
  });
  assert.strictEqual(error, undefined);
  assert.strictEqual(datos.nombre, 'Cambio de aceite');
  assert.strictEqual(datos.tipo, 'km');
  assert.strictEqual(datos.intervalo, 15000);
});

// ── Con base de datos ─────────────────────────────────────────────────
let client;

before(async () => {
  if (SKIP) return;
  const { Client } = require('pg');
  client = new Client({ connectionString: DBURL, options: '-c timezone=America/Argentina/Buenos_Aires' });
  await client.connect();
  await limpiar();
});
after(async () => {
  if (!client) return;
  await limpiar().catch(() => {});
  await client.end();
  // El servicio abre además el pool compartido de db/pool.js, cuyas conexiones
  // quedan ociosas 3 minutos a propósito (sobreviven de un sync del GPS al
  // siguiente). Sin cerrarlo, node --test termina los tests en milisegundos y
  // después se queda 3 minutos esperando que el event loop se vacíe.
  await require('../db/pool').pool.end().catch(() => {});
});
beforeEach(async () => { if (!SKIP) await limpiar(); });

async function limpiar() {
  await client.query(`DELETE FROM maintenance_schedules WHERE nombre LIKE 'MTEST%'`).catch(() => {});
  await client.query(`DELETE FROM vehicles WHERE code LIKE 'MTEST-%'`).catch(() => {});
  await client.query(`DELETE FROM app_config WHERE key = 'mantenimiento_last'`).catch(() => {});
}

let _n = 0;
async function unidadConPlan({ km = 194200, ultimo = 180000, intervalo = 15000, aviso = 1000 } = {}) {
  _n++;
  const v = await client.query(
    `INSERT INTO vehicles (code, plate, km_current, active) VALUES ($1,$2,$3,TRUE) RETURNING id`,
    [`MTEST-${_n}`, `MT${String(_n).padStart(5, '0')}`, km]);
  await client.query(
    `INSERT INTO maintenance_schedules (vehicle_id, nombre, tipo, intervalo, aviso_antes, ultimo_valor)
     VALUES ($1, $2, 'km', $3, $4, $5)`,
    [v.rows[0].id, `MTEST aceite ${_n}`, intervalo, aviso, ultimo]);
  return v.rows[0].id;
}

const MANIANA = new Date('2026-08-03T13:00:00Z');   // 10:00 AR, dentro de la ventana

// Captura lo que se habría enviado. Las afirmaciones van sobre ESTE contenido y
// no sobre conteos globales: la base de prueba puede tener otros planes
// cargados (de otro test, o reales), y un test que exige "hay exactamente 1
// vencido" falla sin que nada esté mal.
let ultimoAviso = null;
const entregaOk = async (roles, payload) => { ultimoAviso = payload; return 2; };
const avisar = (o = {}) => {
  ultimoAviso = null;
  return mant.generarYEnviarAviso({ notificar: entregaOk, now: MANIANA, ...o });
};

test('estadoPlanes lee los contadores reales de la unidad', { skip: SKIP }, async () => {
  await unidadConPlan({ km: 194200, ultimo: 180000 });
  const planes = (await mant.estadoPlanes()).filter((p) => p.nombre.startsWith('MTEST'));
  assert.strictEqual(planes.length, 1);
  assert.strictEqual(planes[0].restante, 800);
  assert.strictEqual(planes[0].estado, 'proximo');
});

test('una unidad dada de baja no aparece', { skip: SKIP }, async () => {
  const id = await unidadConPlan();
  await client.query('UPDATE vehicles SET active = FALSE WHERE id = $1', [id]);
  const planes = (await mant.estadoPlanes()).filter((p) => p.nombre.startsWith('MTEST'));
  assert.strictEqual(planes.length, 0, 'el service de un camión que ya no está no es una alerta');
});

// ── La línea de base tiene que VOLVER en la respuesta ──────────────────
// No es un detalle de la API: la pantalla llena el campo "último service" del
// modal de edición con este valor. Cuando no venía, el campo salía vacío, y al
// guardar mandaba ultimo_valor:null — o sea que editar el NOMBRE de un plan le
// borraba la línea de base y lo dejaba en 'sin_base'.
//
// Silencioso y destructivo: el módulo entero existe para no inventar números
// sobre un motor, y lo que hacía era perder el único número real que había.
test('estadoPlanes devuelve la línea de base, que es lo que la pantalla edita', { skip: SKIP }, async () => {
  await unidadConPlan({ km: 194200, ultimo: 180000 });
  const p = (await mant.estadoPlanes()).find((x) => x.nombre.startsWith('MTEST'));
  assert.strictEqual(Number(p.ultimo_valor), 180000, 'sin esto el modal de edición abre vacío');
  assert.ok('ultima_fecha' in p, 'y la fecha también, para los planes por días');
});

test('un plan por días también devuelve su fecha de base', { skip: SKIP }, async () => {
  _n++;
  const v = await client.query(
    `INSERT INTO vehicles (code, plate, active) VALUES ($1,$2,TRUE) RETURNING id`,
    [`MTEST-${_n}`, `MT${String(_n).padStart(5, '0')}`]);
  await client.query(
    `INSERT INTO maintenance_schedules (vehicle_id, nombre, tipo, intervalo, aviso_antes, ultima_fecha)
     VALUES ($1, $2, 'dias', 365, 30, '2026-02-20')`, [v.rows[0].id, `MTEST matafuegos ${_n}`]);
  const p = (await mant.estadoPlanes()).find((x) => x.nombre.startsWith('MTEST matafuegos'));
  assert.ok(p.ultima_fecha, 'el modal de un plan por días necesita la fecha para prellenarse');
  assert.strictEqual(String(p.ultima_fecha).slice(0, 10), '2026-02-20');
});

// El recorrido completo, tal cual lo hace la pantalla: leer → prellenar el
// modal → guardar. Es el que reproduce el borrado; los dos de arriba solo
// miran la respuesta.
test('editar solo el nombre NO borra la línea de base', { skip: SKIP }, async () => {
  const vid = await unidadConPlan({ km: 194200, ultimo: 180000 });
  const antes = (await mant.estadoPlanes()).find((x) => x.vehicle_id === vid);
  assert.strictEqual(antes.estado, 'proximo');

  // openPlanMantModal(): con qué valor se llena el input "último service".
  const enElInput = antes.tipo === 'dias'
    ? (antes.ultima_fecha || '')
    : (antes.ultimo_valor == null ? '' : antes.ultimo_valor);

  // guardarPlanMant(): qué se manda al tocar Guardar sin haber tocado ese campo.
  const base = String(enElInput).trim();
  const cuerpo = { nombre: 'MTEST aceite renombrado', tipo: antes.tipo, intervalo: antes.intervalo, aviso_antes: antes.aviso_antes };
  if (antes.tipo === 'dias') cuerpo.ultima_fecha = base || null;
  else cuerpo.ultimo_valor = base === '' ? null : base;

  const { error, datos } = leerPlan(cuerpo, { parcial: true });
  assert.strictEqual(error, undefined);
  const campos = Object.keys(datos);
  const params = campos.map((c) => datos[c]);
  params.push(antes.id);
  await client.query(
    `UPDATE maintenance_schedules SET ${campos.map((c, i) => `${c} = $${i + 1}`).join(', ')}
      WHERE id = $${params.length}`, params);

  const despues = (await mant.estadoPlanes()).find((x) => x.id === antes.id);
  assert.strictEqual(despues.estado, 'proximo', 'seguía siendo "próximo", no "sin_base"');
  assert.strictEqual(despues.restante, 800, 'y sigue sabiendo cuánto falta');
  assert.strictEqual(Number(despues.ultimo_valor), 180000);
});

test('avisa, y no repite el mismo día', { skip: SKIP }, async () => {
  const id = await unidadConPlan({ km: 196500, ultimo: 180000 });   // vencido
  const codigo = (await client.query('SELECT code FROM vehicles WHERE id=$1', [id])).rows[0].code;

  const a = await avisar();
  assert.ok(a.sent, 'la primera vez avisa');
  assert.match(ultimoAviso.body, new RegExp(codigo), 'y el aviso nombra a la unidad vencida');
  assert.match(ultimoAviso.title, /pasado/);

  const b = await avisar();
  assert.ok(!b.sent, 'la segunda no');
  assert.match(b.skipped, /ya se avisó hoy/);
});

test('si no se entregó a nadie, no queda como avisado', { skip: SKIP }, async () => {
  await unidadConPlan({ km: 196500, ultimo: 180000 });
  const sin = await mant.generarYEnviarAviso({ now: MANIANA, notificar: async () => 0 });
  assert.match(sin.skipped, /no se pudo entregar/);
  const con = await avisar();
  assert.ok(con.sent, 'un aviso que nunca salió no puede darse por hecho');
});

test('fuera de la ventana horaria no molesta', { skip: SKIP }, async () => {
  await unidadConPlan({ km: 196500, ultimo: 180000 });
  const noche = new Date('2026-08-04T04:00:00Z');   // 01:00 AR
  const r = await avisar({ now: noche });
  assert.match(r.skipped, /fuera de la ventana/);
});

test('un plan sin base no dispara aviso', { skip: SKIP }, async () => {
  _n++;
  const v = await client.query(
    `INSERT INTO vehicles (code, plate, km_current, active) VALUES ($1,$2,500000,TRUE) RETURNING id`,
    [`MTEST-${_n}`, `MT${String(_n).padStart(5, '0')}`]);
  const nombre = `MTEST sin base ${_n}`;
  await client.query(
    `INSERT INTO maintenance_schedules (vehicle_id, nombre, tipo, intervalo, aviso_antes, ultimo_valor)
     VALUES ($1, $2, 'km', 15000, 1000, NULL)`, [v.rows[0].id, nombre]);

  // Se afirma sobre ESTE plan, no sobre que la base entera esté vacía: la
  // versión anterior asumía que no había ningún otro plan cargado, y eso solo
  // vale en una base recién creada. Contra una con datos —producción, o esta
  // misma después de otro test— fallaba sin que nada estuviera mal.
  const mio = (await mant.estadoPlanes()).find((p) => p.nombre === nombre);
  assert.ok(mio, 'el plan tiene que aparecer en el listado');
  assert.strictEqual(mio.estado, 'sin_base');
  assert.strictEqual(mio.restante, null, 'sin línea de base no hay nada que afirmar');
  assert.strictEqual(mant.armarCuerpo([mio]), null, 'y por lo tanto no arma aviso');
});

// ── Migración 005 ─────────────────────────────────────────────────────
test('un plan dado de baja no le quema el nombre a la unidad', { skip: SKIP }, async () => {
  _n++;
  const v = await client.query(
    `INSERT INTO vehicles (code, plate, active) VALUES ($1,$2,TRUE) RETURNING id`,
    [`MTEST-${_n}`, `MT${String(_n).padStart(5, '0')}`]);
  const id = v.rows[0].id;
  const nombre = `MTEST aceite ${_n}`;
  const crear = () => client.query(
    `INSERT INTO maintenance_schedules (vehicle_id, nombre, tipo, intervalo, aviso_antes)
     VALUES ($1,$2,'km',15000,1000)`, [id, nombre]);

  await crear();
  // Duplicar uno ACTIVO tiene que seguir prohibido.
  await assert.rejects(crear, (e) => e.code === '23505', 'dos planes activos con el mismo nombre no');

  // Baja lógica, como hace el DELETE del módulo.
  await client.query('UPDATE maintenance_schedules SET activo = FALSE WHERE vehicle_id = $1', [id]);

  // Y ahora sí se puede volver a crear. Antes de la 005 esto devolvía 23505 y
  // el plan culpable no aparecía en ninguna pantalla: el nombre quedaba quemado.
  await crear();
  const r = await client.query(
    'SELECT count(*) FILTER (WHERE activo) AS activos, count(*) AS todos FROM maintenance_schedules WHERE vehicle_id = $1',
    [id]);
  assert.strictEqual(Number(r.rows[0].activos), 1);
  assert.strictEqual(Number(r.rows[0].todos), 2, 'el de baja se conserva como historial');
});

test('la base rechaza un aviso previo mayor o igual al intervalo', { skip: SKIP }, async () => {
  _n++;
  const v = await client.query(
    `INSERT INTO vehicles (code, plate, active) VALUES ($1,$2,TRUE) RETURNING id`,
    [`MTEST-${_n}`, `MT${String(_n).padStart(5, '0')}`]);
  // leerPlan() ya lo rechaza, pero esa validación vive solo en el camino HTTP.
  // Un INSERT directo la esquivaba y dejaba el plan en "próximo" para siempre.
  await assert.rejects(
    () => client.query(
      `INSERT INTO maintenance_schedules (vehicle_id, nombre, tipo, intervalo, aviso_antes)
       VALUES ($1,$2,'km',15000,15000)`, [v.rows[0].id, `MTEST absurdo ${_n}`]),
    (e) => e.code === '23514' && /aviso_menor_intervalo/.test(e.constraint || ''));
});

// ── La fecha de "ya se hizo" es argentina, no UTC ─────────────────────
test('"ya se hizo" a las 22 hs anota hoy, no mañana', () => {
  // 2026-08-04T01:30:00Z = 22:30 del 3 de agosto en Argentina.
  const noche = new Date('2026-08-04T01:30:00Z');
  const argentina = noche.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  assert.strictEqual(argentina, '2026-08-03', 'el service se hizo el 3, no el 4');
  assert.strictEqual(noche.toISOString().slice(0, 10), '2026-08-04',
    'y así es como se equivocaba: toISOString() ya pasó a mañana');
});

// ── La migración 004 y el helper de la pantalla vieja ─────────────────
// La pantalla vieja guardaba las horas de una autoelevadora en la MISMA clave
// tech_spec.maint_last_km que usaba para los km de un camión. Lo único que
// decidía qué era ese número es isAutoelevador() de public/js/app.js.
//
// Si la migración clasifica distinto que ese helper, el plan importado compara
// kilómetros contra el horómetro y nadie se entera: no falla, da mal.
//
// Por eso el test corre el helper REAL sacado de app.js, no una copia escrita
// acá — una copia se desincroniza en silencio, que es justo el modo de falla
// que se quiere descartar.
function helperDeLaPantalla() {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const sacar = (nombre) => {
    const m = src.match(new RegExp(`^function ${nombre}\\([\\s\\S]*?^\\}`, 'm'));
    assert.ok(m, `no se encontró ${nombre}() en public/js/app.js`);
    return m[0];
  };
  return new Function(
    `${sacar('normalizeVehicleTypeLabel')}\n${sacar('isAutoelevador')}\nreturn isAutoelevador;`,
  )();
}

// Y el CASE se lee del archivo de la migración, no se transcribe.
function caseDeLaMigracion() {
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '004-importar-planes-de-techspec.sql'), 'utf8');
  const m = sql.match(/CASE WHEN [\s\S]*?THEN 'horas' ELSE 'km' END/);
  assert.ok(m, 'no se encontró el CASE que decide km/horas en la migración 004');
  // replaceAll, no replace: si el CASE menciona v.type más de una vez y solo se
  // sustituye la primera, el SELECT falla con "missing FROM-clause entry for
  // table v" y el test parece detectar el problema cuando en realidad ni llegó
  // a comparar nada.
  const expr = m[0].replaceAll('COALESCE(v.type', 'COALESCE($1');
  assert.ok(!/\bv\./.test(expr), 'quedó una referencia a v. sin sustituir en el CASE');
  return expr;
}

test('la migración 004 clasifica km/horas igual que isAutoelevador()', { skip: SKIP }, async () => {
  const isAutoelevador = helperDeLaPantalla();
  const expr = caseDeLaMigracion();

  const CASOS = [
    // Los 9 valores que hoy permite el CHECK de vehicles.type.
    'camion', 'tractor', 'semirremolque', 'acoplado', 'utilitario',
    'autoelevador', 'furgon', 'moto', 'otro',
    // Y variantes que el CHECK hoy no deja entrar. Se prueban igual: son las
    // que separan la comparación exacta del helper de un LIKE '%autoelevador%'
    // —"Autoelevador Toyota" y "Montacargas" son km, "Auto-elevador" es horas—
    // y el día que alguien relaje el CHECK, este test ya cubre el caso.
    'Autoelevador', 'AUTOELEVADOR', '  Autoelevador  ',
    'Auto-elevador', 'Auto elevador', 'auto_elevador', 'Autoelevadór',
    'Autoelevador Toyota', 'Montacargas', 'Camión', '', null,
  ];

  for (const t of CASOS) {
    const enLaBase = (await client.query(`SELECT ${expr} AS tipo`, [t])).rows[0].tipo;
    const enLaPantalla = isAutoelevador(t) ? 'horas' : 'km';
    assert.strictEqual(enLaBase, enLaPantalla, `tipo "${t}": SQL dice ${enLaBase} y el helper ${enLaPantalla}`);
  }
});

test('la migración 004 importa lo configurado y no inventa lo que no', { skip: SKIP }, async () => {
  _n++;
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '004-importar-planes-de-techspec.sql'), 'utf8');

  const alta = async (code, type, spec) => (await client.query(
    `INSERT INTO vehicles (code, plate, type, km_current, active, tech_spec)
     VALUES ($1,$2,$3,100000,TRUE,$4) RETURNING id`,
    [code, code.slice(0, 8), type, spec ? JSON.stringify(spec) : null])).rows[0].id;

  const camion = await alta(`MTEST-C${_n}`, 'camion',
    { maint_task_name: 'Aceite y filtros', maint_interval_km: 15000, maint_last_km: 90000 });
  const fork = await alta(`MTEST-F${_n}`, 'autoelevador',
    { maint_task_name: 'Service hidráulico', maint_interval_km: 250, maint_last_km: 1200 });
  // parseInt('') || 0 escribía un 0: "no lo sé", no "el service fue en el km 0".
  const sinBase = await alta(`MTEST-S${_n}`, 'camion',
    { maint_task_name: 'Correa', maint_interval_km: 60000, maint_last_km: 0 });
  const nunca = await alta(`MTEST-N${_n}`, 'camion', { fuel_type: 'Diesel' });

  const leer = async (id) => (await client.query(
    'SELECT nombre, tipo, intervalo, aviso_antes, ultimo_valor FROM maintenance_schedules WHERE vehicle_id=$1',
    [id])).rows;

  // La migración importa de TODAS las unidades con tech_spec configurado, no
  // solo de las de este test. Contra la base de un desarrollador eso dejaría
  // planes de unidades reales que limpiar() no borra (no se llaman MTEST). Va
  // adentro de una transacción que siempre vuelve atrás.
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await verificar();
    // Idempotente: correrla de nuevo no duplica nada.
    await client.query(sql);
    assert.strictEqual((await leer(camion)).length, 1);
    assert.strictEqual((await leer(fork)).length, 1);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }

  async function verificar() {
    const c = await leer(camion);
    assert.strictEqual(c.length, 1);
    assert.strictEqual(c[0].nombre, 'Aceite y filtros');
    assert.strictEqual(c[0].tipo, 'km');
    assert.strictEqual(c[0].intervalo, 15000);
    assert.strictEqual(c[0].aviso_antes, 1500, 'aviso al 90% del intervalo');
    assert.strictEqual(Number(c[0].ultimo_valor), 90000);

    const f = await leer(fork);
    assert.strictEqual(f[0].tipo, 'horas', 'el número de una autoelevadora son horas, no km');
    assert.strictEqual(f[0].intervalo, 250);
    assert.strictEqual(Number(f[0].ultimo_valor), 1200);
    assert.strictEqual(f[0].aviso_antes, 25);

    const s = await leer(sinBase);
    assert.strictEqual(s.length, 1, 'se importa el plan…');
    assert.strictEqual(s[0].ultimo_valor, null, '…pero el 0 entra como NULL, no como línea de base');

    assert.strictEqual((await leer(nunca)).length, 0, 'una unidad sin configurar no se inventa');
  }
});
