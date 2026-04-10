const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { query } = require('../db/pool');
const { loginLimiter, checkAccountLock } = require('../middleware/security');
const { authenticate } = require('../middleware/auth');

const MAX_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const LOCK_MINS    = parseInt(process.env.LOCK_TIME_MINUTES)  || 15;

router.post('/login', loginLimiter, checkAccountLock, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  try {
    const result = await query('SELECT id, name, email, password_hash, role, vehicle_code, active, login_attempts, locked_until FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      const attempts = (user.login_attempts || 0) + 1;
      if (attempts >= MARX_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCK_MINS * 60 * 1000);
        await query('UPDATE users SET login_attempts = $1, locked_until = $2 WHERE id = $3', [attempts, lockUntil, user.id]);
        return res.status(423).json({ error: `Cuenta bloqueada por LOCK_MINS minutos` });
      }
      await query('UPDATE users SET login_attempts = $1 WHERE id = $2', [attempts, user.id]);
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    await query('UPDATE users SET login_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1', [user.id]);
    const accessToken = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
    const refreshToken = crypto.randomBytes(64).toString('hex');
    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [user.id, refreshHash, refreshExpiry]);
    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, vehicle_code: user.vehicle_code } });
  } catch (err) { res.status(500).json({ error: 'Error del servidor' }); }
});
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.status(401).json({ error: 'Sin refresh token' });
  try {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const result = await query(`SELECT rt.user_id, u.role, u.active FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token_hash = $1 AND rt.expires_at > NOW()`, [hash]);
    if (!result.rows[0] || !result.rows[0].active) { res.clearCookie('refreshToken'); return res.status(401).json({ error: 'Refresh token inválido' }); }
    const { user_id, role } = result.rows[0];
    const accessToken = jwpt.sign({ id: user_id, role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
    res.json({ accessToken });
  } catch (err) { res.status(500).json({ error: 'Error del servidor' }); }
});
router.post('/logout', authenticate, async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (refreshToken) { const hash = crypto.createHash('sha256').update(refreshToken).digest('hex'); await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]); }
  res.clearCookie('refreshToken');
  res.json({ message: 'Sesión cerrada' });
});
router.get('/me', authenticate, (req, res) => { res.json({ user: req.user }); });
router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Campos requeridos' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  try {
    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    const newHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);
    res.clearCookie('refreshToken');
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) { res.status(500).json({ error: 'Error del servidor' }); }
});
module.exports = router;
