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
const entregaOk = async () => 2;
const avisar = (o = {}) => mant.generarYEnviarAviso({ notificar: entregaOk, now: MANIANA, ...o });

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

test('avisa, y no repite el mismo día', { skip: SKIP }, async () => {
  await unidadConPlan({ km: 196500, ultimo: 180000 });   // vencido
  const a = await avisar();
  assert.ok(a.sent);
  assert.strictEqual(a.vencidos, 1);

  const b = await avisar();
  assert.ok(!b.sent);
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
  await client.query(
    `INSERT INTO maintenance_schedules (vehicle_id, nombre, tipo, intervalo, aviso_antes, ultimo_valor)
     VALUES ($1, $2, 'km', 15000, 1000, NULL)`, [v.rows[0].id, `MTEST sin base ${_n}`]);

  const r = await avisar();
  assert.ok(!r.sent, 'sin línea de base no hay nada que afirmar');
  assert.match(r.skipped, /no hay mantenimientos/);
});
