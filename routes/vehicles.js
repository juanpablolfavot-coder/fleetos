const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');

// GET /api/vehicles
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, type, base } = req.query;
    let sql = `
      SELECT v.*, u.name AS driver_name
      FROM vehicles v
      LEFT JOIN users u ON u.id = v.driver_id
      WHERE v.active = TRUE
    `;
    const params = [];
    if (status) { params.push(status); sql += ` AND v.status = $${params.length}`; }
    if (type)   { params.push(type);   sql += ` AND v.type = $${params.length}`; }
    if (base)   { params.push(base);   sql += ` AND v.base = $${params.length}`; }
    sql += ' ORDER BY v.code';
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener vehículos' });
  }
});

// GET /api/vehicles/:id
router.get('/:id', authenticate, validateUUID('id'), async (req, res) => {
  try {
    const v = await query(
      `SELECT v.*, u.name AS driver_name, vs.*
       FROM vehicles v
       LEFT JOIN users u ON u.id = v.driver_id
       LEFT JOIN vehicle_specs vs ON vs.vehicle_id = v.id
       WHERE v.id = $1 AND v.active = TRUE`,
      [req.params.id]
    );
    if (!v.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.json(v.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener vehículo' });
  }
});

// POST /api/vehicles
router.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), auditAction('CREATE','vehicles'), async (req, res) => {
  try {
    const { code, plate, brand, model, year, type, base, driver_id, km_current, vin, engine_no, cost_center } = req.body;
    if (!code || !plate || !brand || !model || !year || !type) {
      return res.status(400).json({ error: 'Campos requeridos: code, plate, brand, model, year, type' });
    }
    const result = await query(
      `INSERT INTO vehicles (code,plate,brand,model,year,type,base,driver_id,km_current,vin,engine_no,cost_center)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [code, plate, brand, model, year, type, base, driver_id||null, km_current||0, vin||null, engine_no||null, cost_center||null]
    );
    res.locals.recordId = result.rows[0].id;
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Código o patente ya existe' });
    res.status(500).json({ error: 'Error al crear vehículo' });
  }
});

// PUT /api/vehicles/:id
router.put('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), validateUUID('id'), auditAction('UPDATE','vehicles'), async (req, res) => {
  try {
    const { brand, model, year, type, status, base, driver_id, km_current, vin, engine_no, cost_center, plate } = req.body;
    const result = await query(
      `UPDATE vehicles SET brand=$1,model=$2,year=$3,type=$4,status=$5,base=$6,
       driver_id=$7,km_current=$8,vin=$9,engine_no=$10,cost_center=$11,plate=$12
       WHERE id=$13 AND active=TRUE RETURNING *`,
      [brand, model, year, type, status, base, driver_id||null, km_current, vin||null, engine_no||null, cost_center||null, plate, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.locals.recordId = result.rows[0].id;
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar vehículo' });
  }
});

// PATCH /api/vehicles/:id/km — actualizar odómetro
router.patch('/:id/km', authenticate, validateUUID('id'), async (req, res) => {
  try {
    const { km } = req.body;
    if (!km || isNaN(km)) return res.status(400).json({ error: 'Km inválido' });
    const result = await query(
      'UPDATE vehicles SET km_current = $1 WHERE id = $2 RETURNING id, code, km_current',
      [parseInt(km), req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar km' });
  }
});

// DELETE /api/vehicles/:id — baja lógica, solo dueño
router.delete('/:id', authenticate, requireRole('dueno'), sensitiveLimiter, validateUUID('id'), auditAction('DEACTIVATE','vehicles'), async (req, res) => {
  try {
    await query('UPDATE vehicles SET active = FALSE WHERE id = $1', [req.params.id]);
    res.json({ message: 'Vehículo dado de baja' });
  } catch (err) {
    res.status(500).json({ error: 'Error al dar de baja vehículo' });
  }
});

module.exports = router;

// PATCH /api/vehicles/:id/techspec — guardar ficha técnica editable
router.patch('/:id/techspec', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), validateUUID('id'), async (req, res) => {
  try {
    // Guardar en columna tech_spec (JSONB). Si no existe la columna, la crea primero.
    await query(`
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tech_spec JSONB DEFAULT '{}'
    `);
    const result = await query(
      `UPDATE vehicles SET tech_spec = $1 WHERE id = $2 AND active = TRUE RETURNING id, tech_spec`,
      [JSON.stringify(req.body), req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('techspec error:', err.message);
    res.status(500).json({ error: 'Error al guardar ficha técnica' });
  }
});
