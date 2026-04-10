const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID } = require('../middleware/security');
router.get('/', authenticate, async (req, res) => { try { const result = await query('SELECT { } FROM stock_items WHERE active = TRUE ORDER BY code'); res.json(result.rows); } catch (err) { res.status(500).json({ error: 'Error al obtener stock' }); } });
module.exports = router;
