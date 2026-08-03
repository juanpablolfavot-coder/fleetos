// ═══════════════════════════════════════════════════════════════════════════
//  Aviso de documentación por vencer (services/vencimientos.js).
//
//  armarCuerpo() es puro y se prueba siempre. El resto necesita base de prueba
//  (TEST_DATABASE_URL) y se saltea sin ella, igual que po_flow.
//
//  Lo que más se cuida acá NO es que el aviso salga, sino que NO salga de más:
//  un aviso que dice lo mismo todos los días se vuelve papel pintado y se deja
//  de leer, y ahí la funcionalidad entera deja de servir.
// ═══════════════════════════════════════════════════════════════════════════
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

const DBURL = process.env.TEST_DATABASE_URL || (process.env.NODE_ENV === 'test' ? process.env.DATABASE_URL : null);
const SKIP = !DBURL;

const venc = require('../services/vencimientos');

// ── armarCuerpo: puro, corre siempre ──────────────────────────────────
const doc = (id, entidad, tipo, dias) => ({ id, entidad, doc_type: tipo, dias_restantes: dias });

test('sin nada por vencer no se arma ningún aviso', () => {
  assert.strictEqual(venc.armarCuerpo({ vencidos: [], criticos: [], proximos: [] }), null);
});

test('lo vencido va primero y se dice hace cuánto', () => {
  const c = venc.armarCuerpo({
    vencidos: [doc('1', 'AH327RZ', 'VTV', -12)],
    criticos: [doc('2', 'AF823RB', 'Seguro', 3)],
    proximos: [doc('3', 'INT-04', 'RUTA', 25)],
  });
  assert.match(c.title, /1 vencido/);
  assert.match(c.title, /1 vence esta semana/);
  const primeraLinea = c.body.split('\n')[0];
  assert.match(primeraLinea, /AH327RZ/, 'lo vencido tiene que encabezar');
  assert.match(primeraLinea, /vencido hace 12 d/);
  assert.match(c.body, /AF823RB · Seguro \(en 3 d\)/);
});

test('"vence HOY" no se dice como "en 0 d"', () => {
  const c = venc.armarCuerpo({ vencidos: [], criticos: [doc('1', 'INT-01', 'VTV', 0)], proximos: [] });
  assert.match(c.body, /vence HOY/);
  assert.doesNotMatch(c.body, /en 0 d/);
});

test('con muchos, se muestran pocos y se cuenta el resto', () => {
  const muchos = Array.from({ length: 9 }, (_, i) => doc(String(i), `V-${i}`, 'VTV', -1));
  const c = venc.armarCuerpo({ vencidos: muchos, criticos: [], proximos: [] });
  assert.strictEqual(c.body.split('\n').filter((l) => l.startsWith('V-')).length, 4, 'como mucho 4 ejemplos');
  assert.match(c.body, /…y 5 más/);
});

test('el tag es fijo: el aviso nuevo reemplaza al anterior en la bandeja', () => {
  const a = venc.armarCuerpo({ vencidos: [doc('1', 'A', 'VTV', -1)], criticos: [], proximos: [] });
  const b = venc.armarCuerpo({ vencidos: [doc('2', 'B', 'VTV', -2)], criticos: [], proximos: [] });
  assert.strictEqual(a.tag, b.tag);
});

// ── Con base de datos ─────────────────────────────────────────────────
let client;

before(async () => {
  if (SKIP) return;
  const { Client } = require('pg');
  // MISMA zona horaria que db/pool.js. No es cosmético: los documentos se
  // insertan con CURRENT_DATE desde este cliente y se leen con CURRENT_DATE
  // desde el pool. Con el cliente en UTC y el pool en hora argentina, entre las
  // 21 y las 24 (hora local) los dos CURRENT_DATE caen en días distintos y todo
  // el agrupamiento se corre un día.
  client = new Client({
    connectionString: DBURL,
    options: '-c timezone=America/Argentina/Buenos_Aires',
  });
  await client.connect();
  await limpiar();
});

after(async () => {
  if (!client) return;
  await limpiar().catch(() => {});
  await client.end();
});

beforeEach(async () => {
  if (SKIP) return;
  await limpiar();
});

async function limpiar() {
  await client.query(`DELETE FROM documents WHERE reference = 'VTEST'`).catch(() => {});
  await client.query(`DELETE FROM app_config WHERE key = 'vencimientos_last'`).catch(() => {});
}

// entity_id apunta a un vehículo que no existe: la consulta cae en el COALESCE
// y devuelve 'Vehículo eliminado'. Alcanza para probar el agrupamiento sin
// ensuciar la tabla de vehículos.
async function nuevoDoc(tipo, diasDesdeHoy) {
  const r = await client.query(
    `INSERT INTO documents (entity_type, entity_id, doc_type, reference, expiry_date)
     VALUES ('vehicle', gen_random_uuid(), $1, 'VTEST', CURRENT_DATE + $2::int) RETURNING id`,
    [tipo, diasDesdeHoy]);
  return r.rows[0].id;
}

// Las 9 de la mañana: pasada la hora de envío por defecto (8).
const MANIANA = new Date('2026-08-03T12:00:00Z');

test('agrupa en vencidos / críticos / próximos según los días', { skip: SKIP }, async () => {
  await nuevoDoc('VTV', -5);      // vencido
  await nuevoDoc('Seguro', 3);    // crítico (<= 7)
  await nuevoDoc('RUTA', 20);     // próximo
  await nuevoDoc('Licencia', 400); // fuera de la ventana

  const d = await venc.documentosPorVencer();
  const soloTest = (arr) => arr.filter((x) => ['VTV', 'Seguro', 'RUTA', 'Licencia'].includes(x.doc_type));
  assert.strictEqual(soloTest(d.vencidos).length, 1);
  assert.strictEqual(soloTest(d.criticos).length, 1);
  assert.strictEqual(soloTest(d.proximos).length, 1);
  assert.ok(!JSON.stringify(d).includes('Licencia'), 'lo que vence en 400 días no entra en la ventana');
});

test('no vuelve a avisar el mismo día', { skip: SKIP }, async () => {
  await nuevoDoc('VTV', -1);
  const primero = await venc.generarYEnviarAviso({ now: MANIANA });
  assert.ok(primero.sent, 'la primera vez sí avisa');

  const segundo = await venc.generarYEnviarAviso({ now: MANIANA });
  assert.ok(!segundo.sent, 'la segunda no');
  assert.match(segundo.skipped, /ya se avisó hoy/);
});

test('si no cambió nada, espera al recordatorio en vez de repetir', { skip: SKIP }, async () => {
  await nuevoDoc('VTV', -1);
  await venc.generarYEnviarAviso({ now: MANIANA });

  // Dos días después, con el MISMO documento sin resolver.
  const dosDias = new Date(MANIANA.getTime() + 2 * 86400000);
  const r = await venc.generarYEnviarAviso({ now: dosDias });
  assert.ok(!r.sent, 'no repite el mismo aviso dos días seguidos');
  assert.match(r.skipped, /sin cambios/);
});

test('si aparece un documento nuevo, avisa aunque sea al día siguiente', { skip: SKIP }, async () => {
  await nuevoDoc('VTV', -1);
  await venc.generarYEnviarAviso({ now: MANIANA });

  await nuevoDoc('Seguro', 2);   // cambia el conjunto
  const alDiaSiguiente = new Date(MANIANA.getTime() + 86400000);
  const r = await venc.generarYEnviarAviso({ now: alDiaSiguiente });
  assert.ok(r.sent, 'un vencimiento nuevo tiene que romper el silencio');
  assert.strictEqual(r.criticos, 1);
});

test('no avisa antes de la hora configurada', { skip: SKIP }, async () => {
  await nuevoDoc('VTV', -1);
  // 05:00 en Argentina (08:00 UTC) — antes de las 8 por defecto.
  const madrugada = new Date('2026-08-03T08:00:00Z');
  const r = await venc.generarYEnviarAviso({ now: madrugada });
  assert.ok(!r.sent);
  assert.match(r.skipped, /todavía no son las/);
});

test('sin documentos por vencer no manda nada', { skip: SKIP }, async () => {
  const r = await venc.generarYEnviarAviso({ now: MANIANA });
  assert.ok(!r.sent);
  assert.match(r.skipped, /no hay documentos por vencer/);
});
