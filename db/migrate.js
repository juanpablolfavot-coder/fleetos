// db/migrate.js — Ejecutar esquema SQL y datos iniciales
require('dotenv').config();
const { pool } = require('./pool');
const fs       = require('fs');
const path     = require('path');
const bcrypt   = require('bcryptjs');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Conectando a PostgreSQL...');
    await client.query('BEGIN');

    // Ejecutar esquema
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    // Separar por ; pero ignorar procedimientos PL/pgSQL
    await client.query(schema);
    console.log('✓ Esquema creado');

    // Crear usuario dueño inicial.
    // La contraseña NO se hardcodea: se toma de ADMIN_PASSWORD o, si no está,
    // se genera una aleatoria de un solo uso que se imprime una vez en consola.
    const existing = await client.query("SELECT id FROM users WHERE email = $1", ['admin@fleetos.com']);
    if (existing.rows.length === 0) {
      const adminPassword = process.env.ADMIN_PASSWORD
        || require('crypto').randomBytes(12).toString('base64url');
      const hash = await bcrypt.hash(adminPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
      await client.query(`
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($1, $2, $3, $4)`,
        ['Administrador', 'admin@fleetos.com', hash, 'dueno']
      );
      console.log('✓ Usuario admin creado: admin@fleetos.com');
      if (process.env.ADMIN_PASSWORD) {
        console.log('  Contraseña: la definida en ADMIN_PASSWORD');
      } else {
        console.log('  Contraseña generada (anotala, no se vuelve a mostrar): ' + adminPassword);
      }
      console.log('  ⚠ CAMBIAR LA CONTRASEÑA TRAS EL PRIMER INGRESO');
    } else {
      console.log('✓ Usuario admin ya existe');
    }

    // Crear cisternas iniciales
    await client.query(`
      INSERT INTO tanks (type, capacity_l, current_l, location)
      VALUES ('fuel', 47000, 0, 'Base Central'),
             ('urea', 2000, 0,  'Base Central')
      ON CONFLICT DO NOTHING
    `);
    console.log('✓ Cisternas iniciales creadas');

    await client.query('COMMIT');
    console.log('\n✅ Migración completada exitosamente');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en migración:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
