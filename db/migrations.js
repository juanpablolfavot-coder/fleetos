// ════════════════════════════════════════════════════════════════════
//  Migraciones versionadas — se aplican UNA vez y queda registro.
//
//  Convive con lo que ya había, no lo reemplaza todavía:
//
//    db/schema.sql + db/NN-*.sql   (lo de siempre)
//      Los aplica db/migrate.js en cada corrida. Son idempotentes
//      (IF NOT EXISTS / CREATE OR REPLACE), así que re-aplicarlos no hace
//      daño. Ese comportamiento queda TAL CUAL.
//
//    db/migrations/*.sql           (nuevo)
//      Se aplican una sola vez cada uno y quedan anotados en la tabla
//      schema_migrations. De acá en adelante, todo cambio de esquema va acá.
//
//  Por qué importa: hoy hay cientos de "ALTER TABLE ... ADD COLUMN IF NOT
//  EXISTS" desperdigados en routes/ y services/ que corren en cada arranque
//  porque no hay forma de saber si ya se aplicaron. Con un registro, sí la hay.
//  db/schema-check.js dice cuáles de esos ya son no-op y se pueden sacar.
//
//  Reglas de los archivos de db/migrations/:
//    - Nombre: NNN-descripcion-corta.sql (NNN ordena la aplicación).
//    - Una vez aplicado en producción, un archivo NO se edita nunca más:
//      se escribe uno nuevo. El checksum avisa si alguien lo editó igual.
//    - Cada archivo corre dentro de su propia transacción: si falla, no deja
//      la migración a medio aplicar.
// ════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'migrations');

function checksum(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex').slice(0, 16);
}

// `dir` es parametrizable solo para poder testear el runner con fixtures, sin
// aplicarle migraciones de mentira a una base de verdad. En producción siempre
// es db/migrations/.
function archivos(dir = DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

async function asegurarTabla(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    checksum   TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

/**
 * Aplica las migraciones pendientes de db/migrations/.
 * Cada una va en su propia transacción. Devuelve las versiones aplicadas.
 * `log` permite silenciarlo en los tests.
 */
async function aplicarPendientes(client, { log = console.log, dir = DIR } = {}) {
  await asegurarTabla(client);

  const yaAplicadas = new Map();
  const r = await client.query('SELECT version, checksum FROM schema_migrations');
  r.rows.forEach((row) => yaAplicadas.set(row.version, row.checksum));

  const aplicadasAhora = [];
  for (const nombre of archivos(dir)) {
    const sql = fs.readFileSync(path.join(dir, nombre), 'utf8');
    const suma = checksum(sql);

    if (yaAplicadas.has(nombre)) {
      // Editar una migración ya aplicada es un error silencioso clásico: en tu
      // máquina "anda" porque re-corrés todo, y en producción el cambio nunca
      // llega. No se aborta (la base ya está como está), pero se avisa fuerte.
      if (yaAplicadas.get(nombre) !== suma) {
        log(`  ⚠ ${nombre} cambió DESPUÉS de haberse aplicado (${yaAplicadas.get(nombre)} → ${suma}).`);
        log('    Lo que cambiaste NO se aplicó en esta base. Escribí una migración nueva.');
      }
      continue;
    }

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
        [nombre, suma]
      );
      await client.query('COMMIT');
      log(`  ✓ aplicada: ${nombre}`);
      aplicadasAhora.push(nombre);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`migración ${nombre} falló (no se aplicó nada de ese archivo): ${e.message}`);
    }
  }

  if (!aplicadasAhora.length) log('  (sin migraciones pendientes)');
  return aplicadasAhora;
}

module.exports = { aplicarPendientes, archivos, checksum };
