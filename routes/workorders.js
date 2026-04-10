const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID } = require('../middleware/security');
router.get('/', authenticate, async (req, res) => { try { const result = await query('SELECT wo.*, v.code AS vehicle_code, u.name AS mechanic_name FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id LEFT JOIN users u ON u.id = wo.mechanic_id ORDER BY wo.opened_at DESC'); res.json(result.rows); } catch (err) { res.status(500).json({ error: 'Error al obtener OTs' }); } });
module.exports = router;
