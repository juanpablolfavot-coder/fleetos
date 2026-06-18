process.env.TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';
const { Pool, types } = require('pg');

// No dejar que node-postgres convierta TIMESTAMP/TIMESTAMPTZ a Date UTC.
// Los devolvemos como texto con el offset/session timezone para que el frontend no muestre +3 hs.
types.setTypeParser(1114, (v) => v); // timestamp without time zone
types.setTypeParser(1184, (v) => v); // timestamptz

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c timezone=America/Argentina/Buenos_Aires',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// La timezone ya se fija en la conexión con options.
// Evitamos ejecutar client.query() dentro de pool.on('connect') porque pg advierte
// que esa práctica queda deprecada y puede generar warnings en Render.

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

// Helper con logging de queries lentas
const query = async (text, params) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) {
    console.warn('SLOW QUERY:', { duration, text: text.substring(0, 100) });
  }
  return res;
};

module.exports = { pool, query };
