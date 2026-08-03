process.env.TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';
const { Pool, types } = require('pg');

// No dejar que node-postgres convierta TIMESTAMP/TIMESTAMPTZ a Date UTC.
// Los devolvemos como texto con el offset/session timezone para que el frontend no muestre +3 hs.
types.setTypeParser(1114, (v) => v); // timestamp without time zone
types.setTypeParser(1184, (v) => v); // timestamptz

// Se deriva del intervalo del sync del GPS, que es lo que marca el ritmo de uso
// de la base cuando no hay nadie en el sistema: si las conexiones no aguantan de
// un sync al siguiente, se pagan handshakes nuevos cada vez. Se puede fijar a
// mano con DB_IDLE_TIMEOUT_MS.
const _syncMin = Math.max(1, parseInt(process.env.GPS_SYNC_MINUTES || '2', 10) || 2);
const IDLE_MS = parseInt(process.env.DB_IDLE_TIMEOUT_MS || '', 10)
  || Math.max(60000, (_syncMin + 1) * 60000);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c timezone=America/Argentina/Buenos_Aires',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  // Las conexiones tienen que sobrevivir ENTRE syncs del GPS. Con los 30 s que
  // había y un sync cada 2 minutos, TODAS se cerraban por inactividad en el
  // medio, así que cada sync volvía a abrirlas: TCP + handshake TLS contra el
  // Postgres de Render, por red, 42 veces seguidas. Eso era lo que aparecía en
  // el log como "SLOW QUERY" de ~1000 ms — la misma consulta, con la conexión
  // ya abierta, tarda 0,05 ms (medido en producción con npm run diag:eventos).
  idleTimeoutMillis: IDLE_MS,
  connectionTimeoutMillis: 5000,
});

// La timezone ya se fija en la conexión con options.
// Evitamos ejecutar client.query() dentro de pool.on('connect') porque pg advierte
// que esa práctica queda deprecada y puede generar warnings en Render.

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

// Helper con logging de consultas lentas.
//
// Mide POR SEPARADO conseguir la conexión y ejecutar. La versión anterior
// medía pool.query() entero y lo reportaba como "SLOW QUERY", pero pool.query()
// también consigue la conexión: cuando el pool está frío, ese tiempo es
// handshake de red, no trabajo de la base. El log decía "consulta lenta" cuando
// la consulta tardaba un milisegundo.
//
// No es un detalle cosmético: esa etiqueta me mandó dos veces a buscar el
// problema en el índice equivocado. Un log que nombra mal lo que mide cuesta
// más que no tenerlo.
// Ojo con el `||` acá: SLOW_QUERY_MS=0 (útil para ver TODAS las consultas
// mientras se diagnostica) daría 0, que es falsy, y volvería al default.
const _slow = parseInt(process.env.SLOW_QUERY_MS ?? '', 10);
const SLOW_MS = Number.isFinite(_slow) && _slow >= 0 ? _slow : 1000;
const query = async (text, params) => {
  const t0 = Date.now();
  const client = await pool.connect();
  const conexion = Date.now() - t0;
  try {
    const t1 = Date.now();
    const res = await client.query(text, params);
    const ejecucion = Date.now() - t1;
    if (conexion + ejecucion > SLOW_MS) {
      console.warn('SLOW QUERY:', {
        total: conexion + ejecucion,
        conexion,   // tiempo en CONSEGUIR la conexión (handshake si el pool está frío)
        ejecucion,  // tiempo real de la consulta en la base
        text: text.substring(0, 100),
      });
    }
    return res;
  } finally {
    client.release();
  }
};

module.exports = { pool, query };
