// ═══════════════════════════════════════════════════════════════════════════
//  Runner de migraciones versionadas (db/migrations.js).
//
//  Necesita una base de Postgres DE PRUEBA (descartable):
//    TEST_DATABASE_URL=postgresql://... npm test
//  Si no está esa variable, toda la suite se SALTA (igual que po_flow).
//
//  Usa fixtures en un directorio temporal, NO db/migrations/: así prueba el
//  runner de verdad sin aplicarle migraciones de mentira al esquema real.
// ═══════════════════════════════════════════════════════════════════════════
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DBURL = process.env.TEST_DATABASE_URL || (process.env.NODE_ENV === 'test' ? process.env.DATABASE_URL : null);
const SKIP = !DBURL;

const { aplicarPendientes, checksum } = require('../db/migrations');

let client;
let dir;
const silencio = () => {};
const avisos = [];
const capturar = (m) => avisos.push(String(m));

before(async () => {
  if (SKIP) return;
  const { Client } = require('pg');
  client = new Client({ connectionString: DBURL });
  await client.connect();
  // Tabla propia del test: el runner escribe en schema_migrations, así que se
  // limpian solo las filas de estos fixtures para no pisar nada real.
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await limpiar();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetos-mig-'));
});

after(async () => {
  if (!client) return;
  await limpiar().catch(() => {});
  await client.query('DROP TABLE IF EXISTS mtest_uno, mtest_dos').catch(() => {});
  await client.end();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

async function limpiar() {
  await client.query("DELETE FROM schema_migrations WHERE version LIKE 'ZZZ-test-%'");
}

function escribir(nombre, sql) {
  fs.writeFileSync(path.join(dir, nombre), sql);
}

test('aplica las pendientes en orden y las registra', { skip: SKIP }, async () => {
  escribir('ZZZ-test-001-uno.sql', 'CREATE TABLE IF NOT EXISTS mtest_uno (id INT)');
  escribir('ZZZ-test-002-dos.sql', 'CREATE TABLE IF NOT EXISTS mtest_dos (id INT)');

  const aplicadas = await aplicarPendientes(client, { dir, log: silencio });
  assert.deepStrictEqual(aplicadas, ['ZZZ-test-001-uno.sql', 'ZZZ-test-002-dos.sql'],
    'se aplican en orden alfabético');

  for (const t of ['mtest_uno', 'mtest_dos']) {
    const r = await client.query('SELECT to_regclass($1) AS existe', [t]);
    assert.ok(r.rows[0].existe, `${t} tiene que existir`);
  }

  const reg = await client.query("SELECT version FROM schema_migrations WHERE version LIKE 'ZZZ-test-%' ORDER BY version");
  assert.strictEqual(reg.rows.length, 2, 'quedan las dos anotadas');
});

test('una segunda corrida no re-aplica nada', { skip: SKIP }, async () => {
  const aplicadas = await aplicarPendientes(client, { dir, log: silencio });
  assert.deepStrictEqual(aplicadas, [], 'ya estaban aplicadas: no se toca nada');
});

test('solo aplica la nueva cuando se agrega un archivo', { skip: SKIP }, async () => {
  escribir('ZZZ-test-003-tres.sql', 'ALTER TABLE mtest_uno ADD COLUMN IF NOT EXISTS extra TEXT');
  const aplicadas = await aplicarPendientes(client, { dir, log: silencio });
  assert.deepStrictEqual(aplicadas, ['ZZZ-test-003-tres.sql'], 'solo la nueva');

  const c = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='mtest_uno' AND column_name='extra'`);
  assert.strictEqual(c.rows.length, 1, 'la columna se agregó');
});

test('una migración que falla no deja nada a medio aplicar', { skip: SKIP }, async () => {
  escribir('ZZZ-test-004-rota.sql', `
    CREATE TABLE IF NOT EXISTS mtest_rota (id INT);
    ESTO NO ES SQL VALIDO;
  `);
  await assert.rejects(
    () => aplicarPendientes(client, { dir, log: silencio }),
    /ZZZ-test-004-rota\.sql falló/,
    'tiene que propagar el error nombrando el archivo');

  // Lo importante: la tabla del principio del archivo NO quedó creada.
  const r = await client.query("SELECT to_regclass('mtest_rota') AS existe");
  assert.strictEqual(r.rows[0].existe, null, 'la transacción se revirtió entera');

  const reg = await client.query("SELECT 1 FROM schema_migrations WHERE version='ZZZ-test-004-rota.sql'");
  assert.strictEqual(reg.rows.length, 0, 'una migración fallida no se anota como aplicada');

  fs.unlinkSync(path.join(dir, 'ZZZ-test-004-rota.sql'));
});

test('avisa si una migración ya aplicada cambió después', { skip: SKIP }, async () => {
  avisos.length = 0;
  escribir('ZZZ-test-003-tres.sql', 'ALTER TABLE mtest_uno ADD COLUMN IF NOT EXISTS otra_mas TEXT');

  const aplicadas = await aplicarPendientes(client, { dir, log: capturar });
  assert.deepStrictEqual(aplicadas, [], 'no la re-aplica: ya figura como aplicada');
  assert.ok(avisos.some((a) => /cambió DESPUÉS/.test(a)), 'tiene que avisar del cambio');

  // Y el aviso no miente: el cambio editado NO entró en la base.
  const c = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='mtest_uno' AND column_name='otra_mas'`);
  assert.strictEqual(c.rows.length, 0, 'lo editado no se aplicó, que es justo el peligro que avisa');
});

test('el checksum cambia con el contenido', { skip: SKIP }, () => {
  assert.notStrictEqual(checksum('SELECT 1'), checksum('SELECT 2'));
  assert.strictEqual(checksum('SELECT 1'), checksum('SELECT 1'));
});
