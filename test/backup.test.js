// ═══════════════════════════════════════════════════════════════════════════
//  Tests del backup por email: dumpGzip() no puede reportar éxito con un dump
//  truncado o con pg_dump muerto a mitad de camino.
//
//  No necesitan Postgres: usan un pg_dump FALSO (shell script en un tmpdir
//  antepuesto al PATH) que simula cada escenario.
// ═══════════════════════════════════════════════════════════════════════════
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://fake@localhost/fake';
const { dumpGzip, DUMP_END_MARKER } = require('../scripts/backup-email.js');

let tmpdir;
let origPath;

function fakePgDump(script) {
  const bin = path.join(tmpdir, 'pg_dump');
  fs.writeFileSync(bin, '#!/bin/sh\n' + script, { mode: 0o755 });
}

before(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetos-backup-test-'));
  origPath = process.env.PATH;
  process.env.PATH = tmpdir + path.delimiter + origPath;
});

after(() => {
  process.env.PATH = origPath;
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test('dump completo y exit 0 → resuelve y el contenido sobrevive al gzip', async () => {
  fakePgDump(`
echo "-- PostgreSQL database dump"
echo "CREATE TABLE demo (id int);"
echo "-- ${DUMP_END_MARKER}"
exit 0
`);
  const gz = await dumpGzip();
  const plain = zlib.gunzipSync(gz).toString();
  assert.ok(plain.includes('CREATE TABLE demo'));
  assert.ok(plain.includes(DUMP_END_MARKER));
});

test('pg_dump muere a mitad de camino (exit≠0) → rechaza, NO reporta éxito', async () => {
  // Este era el bug: gzip terminaba de comprimir la salida parcial y la
  // promesa resolvía antes de enterarse del exit code.
  fakePgDump(`
echo "-- PostgreSQL database dump"
echo "CREATE TABLE demo (id int);"
echo "se corto la conexion" >&2
exit 1
`);
  await assert.rejects(dumpGzip(), /código 1.*se corto la conexion/s);
});

test('exit 0 pero salida truncada (sin marcador de cierre) → rechaza', async () => {
  fakePgDump(`
echo "-- PostgreSQL database dump"
echo "CREATE TABLE demo (id int);"
exit 0
`);
  await assert.rejects(dumpGzip(), /TRUNCADO/);
});

test('pg_dump inexistente → rechaza con mensaje claro', async () => {
  fs.rmSync(path.join(tmpdir, 'pg_dump'));
  const soloTmp = process.env.PATH;
  process.env.PATH = tmpdir; // PATH sin pg_dump real
  try {
    await assert.rejects(dumpGzip(), /No se pudo ejecutar pg_dump/);
  } finally {
    process.env.PATH = soloTmp;
  }
});
