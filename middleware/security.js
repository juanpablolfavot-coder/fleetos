const rateLimit = require('express-rate-limit');
const { query } = require('../db/pool');

// ── RATE LIMITING ─────────────────────────────────────────
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Demasiados intentos de login. Esperá 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    message: { error: 'Demasiadas peticiones. Esperá un momento.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const sensitiveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Límite de operaciones alcanzado.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ── BLOQUEO POR INTENTOS FALLIDOS ─────────────────────────
// fix: try/catch para que un timeout de DB no crashee el proceso
const checkAccountLock = async (req, res, next) => {
    const { email } = req.body;
    if (!email) return next();
    try {
          const result = await query(
                  'SELECT login_attempts, locked_until FROM users WHERE email = $1',
                  [email.toLowerCase()]
                );
          if (result.rows[0]) {
                  const user = result.rows[0];
                  if (user.locked_until && new Date(user.locked_until) > new Date()) {
                            const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
                            return res.status(423).json({ error: `Cuenta bloqueada. Intentá en ${mins} minuto${mins !== 1 ? 's' : ''}.` });
                  }
          }
    } catch (err) {
          // Si la DB no responde, dejamos pasar — el siguiente middleware lo manejará
      console.error('[security] checkAccountLock DB error (non-fatal):', err.message);
    }
    next();
};

// ── SANITIZACIÓN DE INPUT ──────────────────────────────────
const sanitize = (req, res, next) => {
    const clean = (obj) => {
          if (typeof obj === 'string') {
                  return obj
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                    .replace(/javascript:/gi, '')
                    .replace(/on\w+\s*=/gi, '')
                    .trim();
          }
          if (typeof obj === 'object' && obj !== null) {
                  for (const key of Object.keys(obj)) {
                            obj[key] = clean(obj[key]);
                  }
          }
          return obj;
    };
    if (req.body) req.body = clean(req.body);
    next();
};

// ── VALIDAR UUID ───────────────────────────────────────────
const validateUUID = (param) => (req, res, next) => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const val = req.params[param];
    if (!UUID_RE.test(val)) {
          return res.status(400).json({ error: 'ID inválido' });
    }
    next();
};

module.exports = { loginLimiter, apiLimiter, sensitiveLimiter, checkAccountLock, sanitize, validateUUID };
