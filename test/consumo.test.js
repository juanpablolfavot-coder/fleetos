// ═══════════════════════════════════════════════════════════════════════════
//  Alerta de consumo de combustible.
//
//  La evaluación es pura: corre siempre. Lo que necesita base (TEST_DATABASE_URL)
//  se saltea sin ella.
//
//  Lo que más se cuida acá es lo contrario que en mantenimiento. Allá el riesgo
//  era inventar un número; acá es AVISAR DE MÁS. Una alerta que grita en falso
//  se apaga a la semana, y una alerta apagada es peor que no tenerla: da
//  sensación de cobertura sin darla.
// ═══════════════════════════════════════════════════════════════════════════
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

const DBURL = process.env.TEST_DATABASE_URL || (process.env.NODE_ENV === 'test' ? process.env.DATABASE_URL : null);
const SKIP = !DBURL;

const consumo = require('../services/consumo');

const HOY = new Date('2026-08-03T13:00:00Z');   // 10:00 AR, dentro de la ventana
const ayer = (d) => new Date(HOY.getTime() - d * 86400000).toISOString();

// Arma una unidad con N tramos estables y, opcionalmente, un último tramo
// distinto. Los tramos van del más viejo al más nuevo, uno cada 4 días.
//
// `n` TIENE que ser par. El ruido va alternado (-,+,-,+…) para que la mediana
// caiga exactamente en `normal` y la variación propia sea exactamente `ruido`;
// con un n impar sobra un valor de un lado y la mediana se corre a ese extremo,
// dejando MAD 0. Eso hace que un test parezca fallar cuando el que está mal es
// el andamiaje.
function unidad({ code = 'TEST-1', normal = 30, ruido = 0.03, n = 10, ultimo = null, diasAtras = 0 } = {}) {
  assert.strictEqual(n % 2, 0, `el helper necesita un n par (le pasaron ${n})`);
  const tramos = [];
  for (let i = 0; i < n; i++) {
    // Ruido determinista y alternado, para que la mediana quede en `normal`.
    const signo = i % 2 ? 1 : -1;
    tramos.push({ l100: normal * (1 + signo * ruido), cuando: ayer((n - i) * 4 + diasAtras) });
  }
  if (ultimo !== null) {
    tramos.push({ l100: ultimo, cuando: ayer(diasAtras) });
  }
  return { vehicle_id: `v-${code}`, unidad: code, tramos };
}

const evaluarUna = (u) => consumo.evaluar([u], { ahora: HOY })[0];

// ── Estadística ───────────────────────────────────────────────────────
test('mediana y variación propia', () => {
  assert.strictEqual(consumo.mediana([3, 1, 2]), 2);
  assert.strictEqual(consumo.mediana([4, 1, 2, 3]), 2.5);
  assert.strictEqual(consumo.mediana([]), null);
  // 10 valores exactamente iguales no varían nada.
  assert.strictEqual(consumo.variacionPropia([30, 30, 30, 30, 30]), 0);
  // ±10% alternado sobre 30 → MAD de 3 sobre mediana 30 = 10%.
  assert.strictEqual(Math.round(consumo.variacionPropia([27, 33, 27, 33, 30])), 10);
});

test('la variación se mide con MAD, no con desvío estándar', () => {
  // Nueve valores idénticos y UN disparate. El desvío estándar se dispararía;
  // la MAD lo ignora, que es lo que hace falta para que un dato mal cargado no
  // suba la vara y esconda el problema siguiente.
  const conBasura = [30, 30, 30, 30, 30, 30, 30, 30, 30, 300];
  assert.strictEqual(consumo.variacionPropia(conBasura), 0, 'un solo disparate no mueve la MAD');
});

// ── Evaluación ────────────────────────────────────────────────────────
test('una unidad estable no alerta', () => {
  const r = evaluarUna(unidad({ normal: 30, ruido: 0.03, ultimo: 30.5 }));
  assert.strictEqual(r.alerta, false);
  assert.strictEqual(r.motivo, 'normal');
  assert.strictEqual(r.normal, 30);
});

test('un salto real alerta', () => {
  const r = evaluarUna(unidad({ normal: 30, ruido: 0.03, ultimo: 42 }));
  assert.strictEqual(r.alerta, true);
  assert.strictEqual(r.desvio, 40);
  assert.strictEqual(r.actual, 42);
  assert.strictEqual(r.normal, 30);
});

test('gastar de MENOS nunca alerta', () => {
  // Un consumo sospechosamente bajo casi siempre significa que falta registrar
  // una carga, no que el motor mejoró. Y en ningún caso es una urgencia.
  const r = evaluarUna(unidad({ normal: 30, ruido: 0.03, ultimo: 15 }));
  assert.strictEqual(r.alerta, false);
  assert.strictEqual(r.desvio, -50);
});

test('el umbral sube con la unidad ruidosa', () => {
  // ±16% de variación propia (el peor caso real de la flota) → umbral 3×16 = 48%.
  const ruidosa = unidad({ normal: 30, ruido: 0.16, ultimo: 30 * 1.30 });
  const r = evaluarUna(ruidosa);
  assert.ok(r.umbral >= 45, `el umbral tiene que subir con el ruido, dio ${r.umbral}`);
  assert.strictEqual(r.alerta, false, '+30% en una unidad que varía ±16% no es señal');

  // La MISMA desviación en una unidad estable SÍ alerta.
  const estable = unidad({ normal: 30, ruido: 0.01, ultimo: 30 * 1.30 });
  assert.strictEqual(evaluarUna(estable).alerta, true);
});

test('el piso del umbral protege a la unidad demasiado estable', () => {
  // Una unidad que varía ±1% tendría umbral 3% sin el piso, y avisaría por
  // cuánto se llenó el tanque en vez de por cuánto consumió el motor.
  const r = evaluarUna(unidad({ normal: 30, ruido: 0.01, ultimo: 30 * 1.10 }));
  assert.ok(r.umbral >= consumo.UMBRAL_MIN, 'el umbral nunca baja del piso');
  assert.strictEqual(r.alerta, false, '+10% no alcanza aunque la unidad sea muy estable');
});

test('sin historia suficiente no se afirma nada', () => {
  const r = evaluarUna(unidad({ n: consumo.MIN_TRAMOS - 1, ultimo: 60 }));
  assert.strictEqual(r.alerta, false);
  assert.strictEqual(r.motivo, 'sin_historia');
  assert.strictEqual(r.normal, undefined, 'ni siquiera se publica una base que no existe');
});

test('un tramo viejo no es noticia', () => {
  // Sin esto, el primer arranque avisaría sobre anomalías de hace dos meses.
  const r = evaluarUna(unidad({ normal: 30, ultimo: 45, diasAtras: consumo.DIAS_FRESCO + 5 }));
  assert.strictEqual(r.alerta, false);
  assert.strictEqual(r.motivo, 'tramo_viejo');
  assert.strictEqual(r.desvio, 50, 'el desvío se calcula igual, solo no se avisa');
});

test('el tramo que se evalúa NO entra en su propia base', () => {
  // Si entrara, empujaría la mediana hacia arriba y escondería el salto.
  const r = evaluarUna(unidad({ normal: 30, ruido: 0, n: 6, ultimo: 60 }));
  assert.strictEqual(r.normal, 30, 'la base son los ANTERIORES');
  assert.strictEqual(r.desvio, 100);
  assert.strictEqual(r.alerta, true);
});

// ── Texto del aviso ───────────────────────────────────────────────────
test('sin alertas no se arma aviso', () => {
  assert.strictEqual(consumo.armarCuerpo([{ alerta: false }, { alerta: false }]), null);
});

test('el aviso nombra la unidad, el valor y contra qué se compara', () => {
  const c = consumo.armarCuerpo([
    { alerta: true, unidad: 'AH327RZ', actual: 42, normal: 31.8, desvio: 32 },
  ]);
  assert.match(c.title, /AH327RZ/);
  assert.match(c.body, /42 L\/100km/);
  assert.match(c.body, /lo normal 31\.8/, 'sin el "normal" el número no dice nada');
  assert.match(c.body, /\+32%/);
  assert.strictEqual(c.url, '/?ir=fuel');
});

test('lo peor va primero', () => {
  const c = consumo.armarCuerpo([
    { alerta: true, unidad: 'CHICA', actual: 33, normal: 30, desvio: 10 },
    { alerta: true, unidad: 'GRANDE', actual: 60, normal: 30, desvio: 100 },
  ]);
  assert.match(c.title, /2 unidades/);
  assert.match(c.body.split('\n')[0], /GRANDE/);
});

// ── El caso que motivó todo esto ──────────────────────────────────────
test('reproduce el escenario medido en producción', () => {
  // Variación típica de la flota: ±5%. Un tractor que venía en 32 y salta a 42.
  const r = evaluarUna(unidad({ normal: 32, ruido: 0.05, n: 14, ultimo: 42 }));
  assert.strictEqual(r.alerta, true);
  assert.strictEqual(r.normal, 32);
  assert.strictEqual(r.actual, 42);
  assert.strictEqual(r.desvio, 31);
  assert.strictEqual(r.variacion, 5, 'la variación típica medida en producción');
  assert.strictEqual(r.umbral, 20, 'con ±5% de variación manda el piso (3×5 < 20)');
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
  await require('../db/pool').pool.end().catch(() => {});
});
beforeEach(async () => { if (!SKIP) await limpiar(); });

async function limpiar() {
  await client.query(`DELETE FROM fuel_logs WHERE vehicle_id IN (SELECT id FROM vehicles WHERE code LIKE 'CTEST%')`).catch(() => {});
  await client.query(`DELETE FROM vehicles WHERE code LIKE 'CTEST%'`).catch(() => {});
  await client.query(`DELETE FROM app_config WHERE key = 'consumo_last'`).catch(() => {});
}

let _n = 0;
async function cargarUnidad({ normal = 30, n = 10, ultimo = null, tipoUltimo = 'fuel' } = {}) {
  _n++;
  const code = `CTEST-${_n}`;
  const v = await client.query(
    `INSERT INTO vehicles (code, plate, type, active) VALUES ($1,$2,'camion',TRUE) RETURNING id`,
    [code, `CT${String(_n).padStart(5, '0')}`]);
  const id = v.rows[0].id;

  let odo = 100000;
  const km = 700;
  // La primera carga no genera tramo (no tiene anterior), por eso n+1.
  await client.query(
    `INSERT INTO fuel_logs (vehicle_id, fuel_type, liters, odometer_km, logged_at) VALUES ($1,'fuel',$2,$3,$4)`,
    [id, 100, odo, ayer((n + 2) * 4)]);
  for (let i = 0; i < n; i++) {
    odo += km;
    const signo = i % 2 ? 1 : -1;
    const l100 = normal * (1 + signo * 0.03);
    await client.query(
      `INSERT INTO fuel_logs (vehicle_id, fuel_type, liters, odometer_km, logged_at) VALUES ($1,'fuel',$2,$3,$4)`,
      [id, (l100 * km / 100).toFixed(2), odo, ayer((n + 1 - i) * 4)]);
  }
  if (ultimo !== null) {
    odo += km;
    await client.query(
      `INSERT INTO fuel_logs (vehicle_id, fuel_type, liters, odometer_km, logged_at) VALUES ($1,$2,$3,$4,$5)`,
      [id, tipoUltimo, (ultimo * km / 100).toFixed(2), odo, ayer(1)]);
  }
  return { id, code };
}

test('lee los tramos reales de la base y detecta el salto', { skip: SKIP }, async () => {
  const { id } = await cargarUnidad({ normal: 30, n: 10, ultimo: 42 });
  const r = (await consumo.estadoConsumo({ ahora: HOY })).find((x) => x.vehicle_id === id);
  assert.ok(r, 'la unidad tiene que aparecer');
  assert.strictEqual(r.alerta, true);
  assert.strictEqual(r.normal, 30);
  assert.strictEqual(r.actual, 42);
});

test('la urea no cuenta como consumo', { skip: SKIP }, async () => {
  // La urea no es combustible de tracción: mezclarla inventa un consumo que no
  // existe. Este último "tramo" de 42 es de urea y no tiene que evaluarse.
  const { id } = await cargarUnidad({ normal: 30, n: 10, ultimo: 42, tipoUltimo: 'urea' });
  const r = (await consumo.estadoConsumo({ ahora: HOY })).find((x) => x.vehicle_id === id);
  assert.strictEqual(r.alerta, false, 'la carga de urea no puede disparar la alerta');
});

test('una unidad dada de baja no se evalúa', { skip: SKIP }, async () => {
  const { id } = await cargarUnidad({ normal: 30, n: 10, ultimo: 42 });
  await client.query('UPDATE vehicles SET active = FALSE WHERE id = $1', [id]);
  const r = (await consumo.estadoConsumo({ ahora: HOY })).find((x) => x.vehicle_id === id);
  assert.strictEqual(r, undefined, 'el consumo de un camión que ya no está no es una alerta');
});

// ── Anti-ruido del envío ──────────────────────────────────────────────
let ultimoAviso = null;
const entregaOk = async (roles, payload) => { ultimoAviso = payload; return 2; };
const avisar = (o = {}) => {
  ultimoAviso = null;
  return consumo.generarYEnviarAviso({ notificar: entregaOk, now: HOY, ...o });
};

test('avisa, y no repite el mismo día', { skip: SKIP }, async () => {
  const { code } = await cargarUnidad({ normal: 30, n: 10, ultimo: 42 });
  const a = await avisar();
  assert.ok(a.sent, 'la primera vez avisa');
  assert.match(ultimoAviso.body, new RegExp(code), 'y el aviso nombra a la unidad');

  const b = await avisar();
  assert.ok(!b.sent);
  assert.match(b.skipped, /ya se avisó hoy/);
});

test('si no se entregó a nadie, NO queda como avisado', { skip: SKIP }, async () => {
  await cargarUnidad({ normal: 30, n: 10, ultimo: 42 });
  const sinEntrega = async () => 0;
  const r = await consumo.generarYEnviarAviso({ notificar: sinEntrega, now: HOY });
  assert.ok(!r.sent);
  assert.match(r.skipped, /no se pudo entregar/);

  // Y como no se anotó, el próximo intento sí sale.
  const b = await avisar();
  assert.ok(b.sent, 'el aviso no quedó tapado');
});

test('una anomalía NUEVA avisa el mismo día', { skip: SKIP }, async () => {
  // Antes el corte por día iba antes que el de firma, así que una unidad que se
  // disparaba a las 10 quedaba callada hasta mañana si otra había disparado a
  // las 8. Para combustible eso es avisar cuando ya se fue el camión.
  const a = await cargarUnidad({ normal: 30, n: 10, ultimo: 42 });
  const r1 = await avisar();
  assert.ok(r1.sent, 'la primera avisa');
  assert.match(ultimoAviso.body, new RegExp(a.code));

  // Segunda unidad, mismo día, también alta.
  const b = await cargarUnidad({ normal: 25, n: 10, ultimo: 40 });
  const r2 = await avisar();
  assert.ok(r2.sent, 'la segunda TAMBIÉN avisa, aunque ya se avisó hoy');
  assert.match(ultimoAviso.body, new RegExp(b.code), 'y nombra a la nueva');

  // Y sin nada nuevo, se calla.
  const r3 = await avisar();
  assert.ok(!r3.sent);
  assert.match(r3.skipped, /no hay nada nuevo/);
});

test('que una unidad se normalice NO dispara un aviso', { skip: SKIP }, async () => {
  // Si de dos altas una vuelve a lo normal, el conjunto cambia pero no hay nada
  // nuevo que contar. Volver a avisar con menos información que la vez anterior
  // es ruido.
  const a = await cargarUnidad({ normal: 30, n: 10, ultimo: 42 });
  const b = await cargarUnidad({ normal: 25, n: 10, ultimo: 40 });
  assert.ok((await avisar()).sent);

  // Se "normaliza" la segunda borrando su última carga.
  await client.query(
    `DELETE FROM fuel_logs WHERE id = (SELECT f.id FROM fuel_logs f
       JOIN vehicles v ON v.id = f.vehicle_id WHERE v.code = $1
       ORDER BY f.logged_at DESC LIMIT 1)`, [b.code]);

  const r = await avisar();
  assert.ok(!r.sent, 'sigue habiendo una alta, pero no es novedad');
  assert.ok(a.code);
});

test('la firma distingue dos cargas del MISMO día', { skip: SKIP }, async () => {
  // Con slice(0,10) las dos cargas daban la misma clave y la segunda quedaba
  // tapada. La clave lleva el instante completo.
  const base = [
    { alerta: true, vehicle_id: 'v1', cuando: '2026-08-03T08:00:00.000Z' },
  ];
  const despues = [
    { alerta: true, vehicle_id: 'v1', cuando: '2026-08-03T17:00:00.000Z' },
  ];
  const f1 = consumo._firma(base);
  const f2 = consumo._firma(despues);
  assert.notStrictEqual(f1, f2, 'dos cargas del mismo día NO pueden dar la misma firma');
  assert.ok(consumo._hayNuevas(f2, { firma: f1 }), 'la segunda carga es novedad');
  assert.ok(!consumo._hayNuevas(f1, { firma: f1 }), 'la misma no');
});

test('fuera de la ventana horaria no molesta', { skip: SKIP }, async () => {
  await cargarUnidad({ normal: 30, n: 10, ultimo: 42 });
  const madrugada = new Date('2026-08-03T07:00:00Z');   // 04:00 AR
  const r = await avisar({ now: madrugada });
  assert.ok(!r.sent);
  assert.match(r.skipped, /fuera de la ventana/);
});

test('sin nada fuera de lo normal no se manda nada', { skip: SKIP }, async () => {
  await cargarUnidad({ normal: 30, n: 10, ultimo: 30.2 });
  const r = await avisar();
  assert.ok(!r.sent);
  assert.match(r.skipped, /ninguna unidad fuera de lo normal/);
});
