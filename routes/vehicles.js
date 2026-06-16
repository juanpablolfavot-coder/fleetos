const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');

const VEHICLE_TYPES = ['camion','tractor','semirremolque','acoplado','utilitario','autoelevador','furgon','moto','otro'];
let vehicleSchemaReady = false;

function cleanText(v) {
  return String(v ?? '').trim();
}

function cleanNullable(v) {
  const s = cleanText(v);
  return s ? s : null;
}

function normalizeVehicleType(value) {
  const raw = cleanText(value)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, ' ');

  if (!raw) return 'camion';
  if (raw === 'camion') return 'camion';
  if (raw === 'tractor') return 'tractor';
  if (['semi','semirremolque','semi remolque'].includes(raw)) return 'semirremolque';
  if (raw === 'acoplado') return 'acoplado';
  if (raw === 'utilitario') return 'utilitario';
  if (['autoelevador','auto elevador'].includes(raw)) return 'autoelevador';
  if (raw === 'furgon') return 'furgon';
  if (raw === 'moto') return 'moto';
  return VEHICLE_TYPES.includes(raw) ? raw : 'otro';
}

function toIntOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function toIntOrZero(v) {
  const n = toIntOrNull(v);
  return n === null ? 0 : n;
}

async function ensureVehicleSchema() {
  if (vehicleSchemaReady) return;

  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS driver_name TEXT`).catch(()=>{});
  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tech_spec JSONB DEFAULT '{}'::jsonb`).catch(()=>{});

  // La base vieja tenía un CHECK que no aceptaba autoelevador/semirremolque/acoplado.
  // Normalizamos valores antiguos y recreamos el constraint con todos los tipos válidos.
  await query(`
    UPDATE vehicles
       SET type = CASE
         WHEN type IS NULL OR BTRIM(type) = '' THEN 'camion'
         WHEN REPLACE(LOWER(BTRIM(type)), 'ó', 'o') = 'camion' THEN 'camion'
         WHEN LOWER(BTRIM(type)) = 'tractor' THEN 'tractor'
         WHEN LOWER(BTRIM(type)) IN ('semi','semirremolque','semi remolque','semi-remolque','semi_remolque') THEN 'semirremolque'
         WHEN LOWER(BTRIM(type)) = 'acoplado' THEN 'acoplado'
         WHEN LOWER(BTRIM(type)) = 'utilitario' THEN 'utilitario'
         WHEN LOWER(BTRIM(type)) IN ('autoelevador','auto elevador','auto-elevador','auto_elevador') THEN 'autoelevador'
         WHEN REPLACE(LOWER(BTRIM(type)), 'ó', 'o') = 'furgon' THEN 'furgon'
         WHEN LOWER(BTRIM(type)) = 'moto' THEN 'moto'
         WHEN LOWER(BTRIM(type)) = 'otro' THEN 'otro'
         ELSE 'otro'
       END
  `).catch(()=>{});

  await query(`ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_type_check`).catch(()=>{});
  await query(`
    ALTER TABLE vehicles
    ADD CONSTRAINT vehicles_type_check
    CHECK (type IN ('camion','tractor','semirremolque','acoplado','utilitario','autoelevador','furgon','moto','otro'))
  `).catch((e)=>{
    if (e.code !== '42710') throw e;
  });

  vehicleSchemaReady = true;
}

// GET /api/vehicles
router.get('/', authenticate, async (req, res) => {
  try {
    await ensureVehicleSchema();
    const { status, type, base } = req.query;
    let sql = `
      SELECT v.*, COALESCE(v.driver_name, u.name, '—') AS driver_name
      FROM vehicles v
      LEFT JOIN users u ON u.id = v.driver_id
      WHERE v.active = TRUE
    `;
    const params = [];
    if (status) { params.push(status); sql += ` AND v.status = $${params.length}`; }
    if (type)   { params.push(normalizeVehicleType(type)); sql += ` AND v.type = $${params.length}`; }
    if (base)   { params.push(base);   sql += ` AND v.base = $${params.length}`; }
    sql += ' ORDER BY v.code';
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET vehicles error:', err.message);
    res.status(500).json({ error: 'Error al obtener vehículos' });
  }
});

// GET /api/vehicles/:id
router.get('/:id', authenticate, validateUUID('id'), async (req, res) => {
  try {
    await ensureVehicleSchema();
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
    console.error('GET vehicle error:', err.message);
    res.status(500).json({ error: 'Error al obtener vehículo' });
  }
});

// POST /api/vehicles
router.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), auditAction('CREATE','vehicles'), async (req, res) => {
  try {
    await ensureVehicleSchema();

    const type = normalizeVehicleType(req.body.type);
    const code = cleanText(req.body.code).toUpperCase();
    const plateInput = cleanText(req.body.plate).toUpperCase();
    const plate = plateInput || code; // Autoelevador, semi o acoplado pueden no tener patente: usamos código interno.
    const brand = cleanText(req.body.brand);
    const model = cleanText(req.body.model);
    const year = toIntOrNull(req.body.year);

    if (!code || !brand || !model || !year || !type) {
      return res.status(400).json({ error: 'Campos requeridos: código, marca, modelo, año y tipo' });
    }

    const result = await query(
      `INSERT INTO vehicles (code,plate,brand,model,year,type,base,driver_id,km_current,vin,engine_no,cost_center,driver_name,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        code,
        plate,
        brand,
        model,
        year,
        type,
        cleanNullable(req.body.base),
        req.body.driver_id || null,
        toIntOrZero(req.body.km_current),
        cleanNullable(req.body.vin),
        cleanNullable(req.body.engine_no),
        cleanNullable(req.body.cost_center),
        cleanNullable(req.body.driver),
        cleanNullable(req.body.status) || 'ok'
      ]
    );
    res.locals.recordId = result.rows[0].id;
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Código o patente ya existe' });
    console.error('POST vehicle error:', err.message, err.detail || '');
    res.status(500).json({ error: 'Error al crear vehículo' });
  }
});

// PUT /api/vehicles/:id
router.put('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), validateUUID('id'), auditAction('UPDATE','vehicles'), async (req, res) => {
  try {
    await ensureVehicleSchema();

    const type = normalizeVehicleType(req.body.type);
    const code = cleanText(req.body.code).toUpperCase();
    const plateInput = cleanText(req.body.plate).toUpperCase();
    const plate = plateInput || code;

    const result = await query(
      `UPDATE vehicles SET brand=$1,model=$2,year=$3,type=$4,status=$5,base=$6,
       driver_id=$7,km_current=$8,vin=$9,engine_no=$10,cost_center=$11,plate=$12,
       driver_name=$13,code=$14
       WHERE id=$15 AND active=TRUE RETURNING *`,
      [
        cleanText(req.body.brand),
        cleanText(req.body.model),
        toIntOrNull(req.body.year),
        type,
        cleanNullable(req.body.status) || 'ok',
        cleanNullable(req.body.base),
        req.body.driver_id || null,
        toIntOrZero(req.body.km_current),
        cleanNullable(req.body.vin),
        cleanNullable(req.body.engine_no),
        cleanNullable(req.body.cost_center),
        plate,
        cleanNullable(req.body.driver),
        code,
        req.params.id
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.locals.recordId = result.rows[0].id;
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Código o patente ya existe' });
    console.error('PUT vehicle error:', err.message, err.detail || '');
    res.status(500).json({ error: 'Error al actualizar vehículo' });
  }
});

// PATCH /api/vehicles/:id/km — actualizar odómetro / horas
router.patch('/:id/km', authenticate, validateUUID('id'), async (req, res) => {
  try {
    const km = toIntOrNull(req.body.km);
    if (km === null) return res.status(400).json({ error: 'Km / horas inválido' });
    const result = await query(
      'UPDATE vehicles SET km_current = $1 WHERE id = $2 RETURNING id, code, km_current',
      [km, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar km / horas' });
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

// PATCH /api/vehicles/:id/techspec — guardar ficha técnica editable
router.patch('/:id/techspec', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), validateUUID('id'), async (req, res) => {
  try {
    await ensureVehicleSchema();
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

module.exports = router;
