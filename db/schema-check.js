#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
//  Comparar el esquema REAL de una base contra lo que declara el repo.
//
//  SOLO LEE. No crea, no altera, no borra: hace SELECT sobre los catálogos
//  de PostgreSQL y compara contra db/schema-sources.js. Es seguro correrlo
//  contra producción.
//
//  Para qué: hoy el esquema se repara solo, con cientos de
//  "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" que corren al arrancar cada
//  router. Queremos sacarlos del arranque, pero antes hay que saber si la
//  base ya tiene TODO lo que esos ALTER agregan. Si falta aunque sea una
//  columna, sacarlos rompe esa base.
//
//  Uso:
//    DATABASE_URL=postgresql://... node db/schema-check.js
//    npm run schema:check
//
//  Opciones:
//    --strict   termina con código 1 si falta algo (para usar en CI)
//    --json     salida en JSON en vez del reporte legible
// ════════════════════════════════════════════════════════════════════
require('dotenv').config();
const { Client } = require('pg');
const { leerDeclarado } = require('./schema-sources');

const ARGS = process.argv.slice(2);
const STRICT = ARGS.includes('--strict');
const JSON_OUT = ARGS.includes('--json');

// Objetos que PostgreSQL o las extensiones crean solos y que ningún archivo
// del repo declara. Sin esto aparecen como "huérfanos" y ensucian el reporte.
const IGNORAR_TABLAS = new Set(['spatial_ref_sys', 'schema_migrations']);
const RE_INDICE_AUTOMATICO = /_(pkey|key)$/; // PRIMARY KEY / UNIQUE generan su índice

async function leerReal(client) {
  const tablas = new Set();
  const columnas = new Set();
  const indices = new Set();

  const t = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'`);
  t.rows.forEach((r) => tablas.add(r.table_name.toLowerCase()));

  const c = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public'`);
  c.rows.forEach((r) => columnas.add(`${r.table_name.toLowerCase()}.${r.column_name.toLowerCase()}`));

  const i = await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`);
  i.rows.forEach((r) => indices.add(r.indexname.toLowerCase()));

  return { tablas, columnas, indices };
}

function seccion(titulo, items, vacio) {
  const out = [`\n${titulo}`];
  if (!items.length) { out.push(`  ${vacio}`); return out.join('\n'); }
  items.forEach((l) => out.push(`  ${l}`));
  return out.join('\n');
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ Falta DATABASE_URL.');
    console.error('  Desde el Shell de Render ya está en el entorno: corré "npm run schema:check" sin prefijo.');
    console.error('  Fuera de ahí: DATABASE_URL=postgresql://... npm run schema:check');
    process.exit(2);
  }
  // Un placeholder pegado tal cual ("<la de Render>") llega hasta acá y falla
  // como un ENOTFOUND críptico varios segundos después. Mejor decirlo ahora.
  if (!/^postgres(ql)?:\/\//i.test(url.trim())) {
    console.error(`✗ DATABASE_URL no parece una URL de conexión: "${url.slice(0, 40)}"`);
    console.error('  Tiene que empezar con postgresql:// — ¿quedó pegado el texto de ejemplo?');
    console.error('  Desde el Shell de Render no hace falta pasarla: "npm run schema:check" a secas.');
    process.exit(2);
  }

  const declarado = leerDeclarado();
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    // Mismo criterio que db/pool.js: Render exige SSL, una base local no.
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  const real = await leerReal(client);
  await client.end();

  // ── 1. Lo que el DDL de arranque agrega y la base TODAVÍA no tiene ──
  // Es el bloqueante: mientras haya algo acá, ese DDL sigue haciendo falta.
  const tablasFaltantes = [...declarado.codigo.tablas.keys()]
    .filter((t) => !real.tablas.has(t))
    .map((t) => `${t}  (${declarado.codigo.tablas.get(t)})`);
  const columnasFaltantes = [...declarado.codigo.columnas.keys()]
    .filter((c) => {
      const tabla = c.split('.')[0];
      // Si la tabla entera falta, ya se reporta arriba; no repetir por columna.
      return real.tablas.has(tabla) && !real.columnas.has(c);
    })
    .map((c) => `${c}  (${declarado.codigo.columnas.get(c)})`);
  const indicesFaltantes = [...declarado.codigo.indices.keys()]
    .filter((i) => !real.indices.has(i))
    .map((i) => `${i}  (${declarado.codigo.indices.get(i)})`);

  // ── 2. Lo que declara db/*.sql y la base no tiene ──
  // Señal de que la base nunca corrió alguna migración numerada.
  const sqlFaltante = [...declarado.sql.columnas.keys()]
    .filter((c) => real.tablas.has(c.split('.')[0]) && !real.columnas.has(c))
    .map((c) => `${c}  (${declarado.sql.columnas.get(c)})`);

  // ── 3. Lo que la base tiene y NADIE declara ──
  // Deriva: columnas agregadas a mano o restos de versiones viejas. No es
  // urgente, pero si mañana se recrea la base desde el repo, no van a estar.
  const tablasHuerfanas = [...real.tablas]
    .filter((t) => !IGNORAR_TABLAS.has(t) && !declarado.union.tablas.has(t));
  const columnasHuerfanas = [...real.columnas]
    .filter((c) => {
      const tabla = c.split('.')[0];
      if (IGNORAR_TABLAS.has(tabla) || tablasHuerfanas.includes(tabla)) return false;
      return declarado.union.tablas.has(tabla) && !declarado.union.columnas.has(c);
    });

  const bloqueantes = tablasFaltantes.length + columnasFaltantes.length + indicesFaltantes.length;

  if (JSON_OUT) {
    console.log(JSON.stringify({
      bloqueantes,
      arranque: { tablasFaltantes, columnasFaltantes, indicesFaltantes },
      sqlFaltante, tablasHuerfanas, columnasHuerfanas,
      resumen: {
        declaradoPorCodigo: {
          tablas: declarado.codigo.tablas.size,
          columnas: declarado.codigo.columnas.size,
          indices: declarado.codigo.indices.size,
        },
        real: { tablas: real.tablas.size, columnas: real.columnas.size, indices: real.indices.size },
      },
    }, null, 2));
    process.exit(STRICT && bloqueantes ? 1 : 0);
  }

  console.log('═'.repeat(70));
  console.log('  Esquema real vs. lo que declara el repositorio');
  console.log('═'.repeat(70));
  console.log(`\nBase:   ${real.tablas.size} tablas · ${real.columnas.size} columnas · ${real.indices.size} índices`);
  console.log(`Repo:   db/*.sql declara ${declarado.sql.tablas.size} tablas · ${declarado.sql.columnas.size} columnas`);
  console.log(`        el DDL de arranque declara ${declarado.codigo.tablas.size} tablas · ${declarado.codigo.columnas.size} columnas · ${declarado.codigo.indices.size} índices`);

  console.log(seccion(
    '① BLOQUEANTE — lo que el DDL de arranque agrega y esta base NO tiene:',
    [...tablasFaltantes.map((x) => `tabla   ${x}`),
     ...columnasFaltantes.map((x) => `columna ${x}`),
     ...indicesFaltantes.map((x) => `índice  ${x}`)],
    '✓ nada: la base ya tiene todo lo que ese DDL agregaría.'));

  console.log(seccion(
    '② Declarado en db/*.sql y ausente en esta base (¿faltó correr alguna migración?):',
    sqlFaltante, '✓ nada.'));

  console.log(seccion(
    '③ En la base y declarado en ningún lado (deriva; no se recrearía desde el repo):',
    [...tablasHuerfanas.map((t) => `tabla   ${t}`),
     ...columnasHuerfanas.map((c) => `columna ${c}`)],
    '✓ nada.'));

  console.log('\n' + '─'.repeat(70));
  if (bloqueantes === 0) {
    console.log('VEREDICTO: se puede sacar el DDL de arranque para ESTA base.');
    console.log('           Esas sentencias ya no agregan nada: son todas no-op.');
  } else {
    console.log(`VEREDICTO: NO sacar todavía el DDL de arranque — faltan ${bloqueantes} objeto(s).`);
    console.log('           Cada uno de la lista ① tiene que pasar a ser una migración');
    console.log('           versionada en db/migrations/ ANTES de tocar routes/.');
  }
  console.log('─'.repeat(70));
  console.log('\nEste comando no modificó nada: solo leyó los catálogos de PostgreSQL.\n');

  process.exit(STRICT && bloqueantes ? 1 : 0);
}

main().catch((e) => {
  console.error('✗ schema-check falló:', e.message);
  process.exit(2);
});
