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
//
// Esto es defensa en profundidad, NO la defensa principal. Lo que impide que un
// dato de usuario se ejecute como HTML es escapar al RENDERIZAR: escapeHtml()
// en public/js/timezone.js, con 422 usos en el frontend. Esa es la capa
// correcta, porque el mismo dato puede ser peligroso en un lugar e inofensivo
// en otro, y eso solo se sabe al mostrarlo.
//
// ── Por qué se sacó el filtro de "onX=" ──
// Acá había además:
//
//     .replace(/on\w+\s*=/gi, '')
//
// pensado para borrar handlers inline tipo onclick=. Hacía dos cosas mal.
//
// 1. Rompía datos reales, en silencio y sin vuelta atrás. El patrón engancha
//    CUALQUIER palabra con "on" en el medio seguida de "=", que en castellano
//    es escritura común:
//
//        "monto=15000"                     →  "m15000"
//        "consumo=35 L/100km"              →  "c35 L/100km"
//        "Cambio de aceite. Monto = 42000" →  "Cambio de aceite. M 42000"
//
//    El comentario que estaba acá ya decía que las contraseñas "pueden contener
//    legítimamente secuencias como onX=" y las excluía por eso. El razonamiento
//    era correcto; lo que faltó es que vale igual para las notas de una orden de
//    trabajo, el detalle de una OC y la observación de un ticket.
//
// 2. Y no protegía. Al ser un reemplazo de una sola pasada, se lo puede hacer
//    ARMAR el handler que supuestamente borra:
//
//        entra:  <img src=x oonerror=nerror=alert(1)>
//        sale:   <img src=x onerror=alert(1)>
//
//    Ese mismo payload pasado por escapeHtml queda inerte.
//
// Un filtro que daña datos legítimos y además se puede esquivar es peor que no
// tenerlo: el daño es permanente y la sensación de cobertura es falsa.
//
// Lo que queda —<script> y javascript:— no aparece nunca en texto legítimo de
// este dominio, así que no rompe nada, y es barato dejarlo puesto.
//
// Las contraseñas siguen sin tocarse: un .trim() sobre una contraseña que
// empieza o termina con espacio rompería el login.
const SANITIZE_SKIP_KEYS = new Set(['password', 'currentPassword', 'newPassword', 'password_hash']);
const sanitize = (req, res, next) => {
    const clean = (obj) => {
          if (typeof obj === 'string') {
                  return obj
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                    .replace(/javascript:/gi, '')
                    .trim();
          }
          if (typeof obj === 'object' && obj !== null) {
                  for (const key of Object.keys(obj)) {
                            if (SANITIZE_SKIP_KEYS.has(key)) continue; // no tocar contraseñas
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
