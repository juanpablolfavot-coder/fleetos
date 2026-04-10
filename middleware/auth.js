const jwt     = require('jsonwebtoken');
const { query } = require('../db/pool');

// Verificar JWT en cada request protegido
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verificar que el usuario sigue activo en DB
    const result = await query(
      'SELECT id, name, role, vehicle_code, active FROM users WHERE id = $1',
      [decoded.id]
    );

    if (!result.rows[0] || !result.rows[0].active) {
      return res.status(401).json({ error: 'Usuario no autorizado' });
    }

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

// Registrar acción en audit_log
const auditAction = (action, tableName) => async (req, res, next) => {
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

module.exports = { authenticate, requireRole, requireOwner, auditOnly, auditAction };
