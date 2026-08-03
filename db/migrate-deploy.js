#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
//  Migraciones pendientes — pensado para el Pre-Deploy Command de Render.
//
//  Aplica SOLO lo que falta de db/migrations/ y nada más. Se diferencia de
//  `npm run migrate` en lo que NO hace: no re-aplica schema.sql ni los 10
//  archivos numerados, no siembra el admin ni las cisternas.
//
//  Por qué importa la diferencia: `npm run migrate` re-corre ~2280 líneas de
//  SQL dentro de UNA transacción (db/migrate.js abre BEGIN en la línea 12 y
//  cierra en la 70). Es idempotente y anda, pero en cada deploy toma locks
//  sobre el esquema entero por ~1 segundo para no cambiar nada. Esto tarda ~100 ms
//  y solo toca lo que de verdad hace falta.
//
//  `npm run migrate` sigue siendo el comando para una base NUEVA o para correr
//  a mano. Este es el del deploy.
//
//  Si algo falla, sale con código 1 → Render ABORTA el deploy y sigue sirviendo
//  la versión anterior. Es lo que se quiere: código que necesita una columna
//  que no se pudo crear no debería llegar a producción.
//
//  Uso:
//    npm run migrate:deploy
// ════════════════════════════════════════════════════════════════════
require('dotenv').config();
const { pool } = require('./pool');
const { aplicarPendientes } = require('./migrations');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[migrate:deploy] ✗ Falta DATABASE_URL.');
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    const aplicadas = await aplicarPendientes(client, {
      log: (m) => console.log('[migrate:deploy]' + (m.startsWith('  ') ? m : ' ' + m)),
    });
    console.log(`[migrate:deploy] ✓ ${aplicadas.length} migración(es) aplicada(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[migrate:deploy] ✗', e.message);
  console.error('[migrate:deploy] El deploy se aborta a propósito: la versión anterior sigue sirviendo.');
  process.exit(1);
});
