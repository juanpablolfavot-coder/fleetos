const jwt     = require('jsonwebtoken');
const { query } = require('../db/pool');

// Cache corto para evitar consultar users en cada request de la misma pantalla.
// No reemplaza la seguridad: el JWT se verifica siempre. Solo ahorra la consulta
// repetida a PostgreSQL durante unos segundos.
const USER_CACHE_TTL_MS = Number(process.env.USER_CACHE_TTL_MS || 30000);
const USER_CACHE_MAX    = Number(process.env.USER_CACHE_MAX || 500);
const userCache = new Map();

// Crear índices de apoyo para auth si la base viene de versiones viejas.
// Se ejecuta una sola vez al iniciar; no bloquea el login si falla.
(async () => {
  try {
    await query('CREATE INDEX IF NOT EXISTS idx_users_active ON users(active)');
    await query('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
    await query('CREATE INDEX IF NOT EXISTS idx_users_sucursal_area ON users(sucursal, area)');
  } catch (e) {
    console.warn('[auth índices]', e.message);
  }
})();

function getCachedUser(userId) {
  const key = String(userId || '');
  if (!key) return null;
  const item = userCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    userCache.delete(key);
    return null;
  }
  // Refresca posición LRU básica.
  userCache.delete(key);
  userCache.set(key, item);
  return item.user;
}

function setCachedUser(userId, user) {
  const key = String(userId || '');
  if (!key || !user) return;
  if (userCache.size >= USER_CACHE_MAX) {
    const firstKey = userCache.keys().next().value;
    if (firstKey) userCache.delete(firstKey);
  }
  userCache.set(key, {
    user: { ...user },
    expiresAt: Date.now() + USER_CACHE_TTL_MS,
  });
}

function clearUserCache(userId) {
  if (userId) userCache.delete(String(userId));
  else userCache.clear();
}

// Verificar JWT en cada request protegido
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const cached = getCachedUser(decoded.id);
    if (cached) {
      if (!cached.active) {
        return res.status(401).json({ error: 'Usuario no autorizado' });
      }
      req.user = cached;
      return next();
    }

    // Verificar que el usuario sigue activo en DB
    const result = await query(
      'SELECT id, name, role, vehicle_code, active, supplier_id, sucursal, area FROM users WHERE id = $1::uuid',
      [decoded.id]
    );

    if (!result.rows[0] || !result.rows[0].active) {
      clearUserCache(decoded.id);
      return res.status(401).json({ error: 'Usuario no autorizado' });
    }

    setCachedUser(decoded.id, result.rows[0]);
    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// Verificar rol requerido
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    // Registrar intento de acceso no autorizado
    console.warn(`ACCESO DENEGADO: ${req.user.name} (${req.user.role}) intentó acceder a ruta restringida: ${req.path}`);
    return res.status(403).json({ error: 'No tenés permiso para esta operación' });
  }
  next();
};

// Solo dueño o gerencia
const requireOwner = requireRole('dueno', 'gerencia');

// Solo lectura para auditores
const auditOnly = (req, res, next) => {
  if (req.user.role === 'auditor' && req.method !== 'GET') {
    return res.status(403).json({ error: 'El auditor solo tiene acceso de lectura' });
  }
  next();
};

// Crear tabla audit_log si no existe
(async () => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS audit_log (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    UUID,
      user_name  VARCHAR(200),
      action     VARCHAR(50),
      table_name VARCHAR(100),
      record_id  UUID,
      new_value  JSONB,
      ip_address VARCHAR(50),
      user_agent VARCHAR(200),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  } catch(e) { /* tabla ya existe */ }
})();

// Registrar acción en audit_log
const auditAction = (action, tableName) => async (req, res, next) => {
  // Marca sincrónica para que el logger global (middleware/audit.js) NO duplique:
  // este endpoint ya registra una versión detallada (con record_id y new_value).
  res.locals._audited = true;
  res.on('finish', async () => {
    if (res.statusCode < 400) {
      try {
        await query(
          `INSERT INTO audit_log (user_id, user_name, action, table_name, record_id, new_value, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.user?.id,
            req.user?.name,
            action,
            tableName,
            res.locals.recordId || null,
            res.locals.newValue ? JSON.stringify(res.locals.newValue) : null,
            req.ip,
            req.headers['user-agent']?.substring(0, 200)
          ]
        );
      } catch (e) {
        // No romper si falla el audit
        console.error('Audit log error:', e.message);
      }
    }
  });
  next();
};

module.exports = { authenticate, requireRole, requireOwner, auditOnly, auditAction, clearUserCache };
