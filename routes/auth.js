const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { query } = require('../db/pool');
const { loginLimiter, checkAccountLock } = require('../middleware/security');
const { authenticate } = require('../middleware/auth');

const MAX_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const LOCK_MINS    = parseInt(process.env.LOCK_TIME_MINUTES)  || 15;

// ═══════════════════════════════════════════════════════════
//  AUTO-MIGRACIÓN: agregar roles nuevos "compras" y "tesoreria"
//  al CHECK constraint de users.role (si existe el CHECK)
// ═══════════════════════════════════════════════════════════
(async () => {
  try {
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await query(`ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('dueno','gerencia','jefe_mantenimiento','mecanico','chofer',
                      'encargado_combustible','paniol','contador','auditor',
                      'compras','tesoreria','proveedores'))`);
    console.log('[auth migración] roles habilitados (incluyendo proveedores)');
    // Agregar supplier_id a users (vincula usuario rol=proveedores con un supplier del catálogo)
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id)`);
    console.log('[auth migración] users.supplier_id agregado');
  } catch(e) { console.error('[auth migración]', e.message); }
})();

// POST /api/auth/login
router.post('/login', loginLimiter, checkAccountLock, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  try {
    const result = await query(
      'SELECT id, name, email, password_hash, role, vehicle_code, active, login_attempts, locked_until FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    const user = result.rows[0];

    // Respuesta genérica — no revelar si el email existe
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      const attempts = (user.login_attempts || 0) + 1;
      let lockUpdate = '';
      if (attempts >= MAX_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCK_MINS * 60 * 1000);
        await query(
          'UPDATE users SET login_attempts = $1, locked_until = $2 WHERE id = $3',
          [attempts, lockUntil, user.id]
        );
        return res.status(423).json({
          error: `Cuenta bloqueada por ${LOCK_MINS} minutos tras ${MAX_ATTEMPTS} intentos fallidos.`
        });
      }
      await query('UPDATE users SET login_attempts = $1 WHERE id = $2', [attempts, user.id]);
      const remaining = MAX_ATTEMPTS - attempts;
      return res.status(401).json({
        error: `Credenciales incorrectas. ${remaining} intento${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}.`
      });
    }

    // Login exitoso — resetear intentos
    await query(
      'UPDATE users SET login_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1',
      [user.id]
    );

    // Generar tokens
    const accessToken = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    const refreshToken  = crypto.randomBytes(64).toString('hex');
    const refreshHash   = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshHash, refreshExpiry]
    );

    // Refresh token en cookie HttpOnly (no accesible desde JS)
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      accessToken,
      user: {
        id:           user.id,
        name:         user.name,
        email:        user.email,
        role:         user.role,
        vehicle_code: user.vehicle_code,
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.status(401).json({ error: 'Sin refresh token' });

  try {
    const hash   = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const result = await query(
      `SELECT rt.user_id, u.role, u.active
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND rt.expires_at > NOW()`,
      [hash]
    );

    if (!result.rows[0] || !result.rows[0].active) {
      res.clearCookie('refreshToken');
      return res.status(401).json({ error: 'Refresh token inválido' });
    }

    const { user_id, role } = result.rows[0];
    const accessToken = jwt.sign({ id: user_id, role }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h'
    });

    // Traer datos del usuario para restaurar sesión
    const userRow = await query(
      'SELECT id, name, email, role, vehicle_code FROM users WHERE id = $1',
      [user_id]
    );

    res.json({ accessToken, user: userRow.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (refreshToken) {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]);
  }
  res.clearCookie('refreshToken');
  res.json({ message: 'Sesión cerrada' });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Campos requeridos' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  try {
    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid  = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

    const newHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);

    // Invalidar todos los refresh tokens del usuario
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);
    res.clearCookie('refreshToken');

    res.json({ message: 'Contraseña actualizada. Iniciá sesión nuevamente.' });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/register — registro público solo para choferes (requiere aprobación del dueño)
router.post('/register', loginLimiter, async (req, res) => {
  try {
    const { name, email, password, vehicle_code } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
    }

    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    // active=FALSE: el dueño debe aprobar antes de que pueda entrar
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role, vehicle_code, active)
       VALUES ($1, $2, $3, 'chofer', $4, FALSE) RETURNING id, name, email, role, active`,
      [name.trim(), email.toLowerCase().trim(), hash, vehicle_code || null]
    );

    res.status(201).json({
      message: 'Solicitud enviada. El administrador debe aprobar tu cuenta antes de que puedas ingresar.',
      user: { id: result.rows[0].id, name: result.rows[0].name, email: result.rows[0].email }
    });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

module.exports = router;
