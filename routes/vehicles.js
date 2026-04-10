const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');
router.get('/', authenticate, async (req, res) => { try { const result = await query('SELECT v.*, u.name AS driver_name FROM vehicles v LEFT JOIN users u ON u.id = v.driver_id WHERE v.active = TRUE ORDER BY v.code'); res.json(result.rows); } catch (err) { res.status(500).json({ error: 'Error al obtener vehículos' }); } });
router.get('/:id', authenticate, validateUUID('id'), async (req, res) => { try { const v = await query('SELECT v.*, u.name AS driver_name FROM vehicles v LEFT JOIN users u ON u.id = v.driver_id WHERE v.id = $1 AND v.active = TRUE', [req.params.id]); if (!v.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' }); res.json(v.rows[0]); } catch (err) { res.status(500).json({ error: 'Error al obtener vehículo' }); } });
module.exports = router;
