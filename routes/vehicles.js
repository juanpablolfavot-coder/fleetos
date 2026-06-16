const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');

const VALID_TYPES = [
  'tractor',
  'camion',
  'semirremolque',
  'acoplado',
  'utilitario',
  'autoelevador',
  'furgon',
  'moto',
  'otro',
];

function normalizeVehicleType(value) {
  const raw = String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');

  const aliases = {
    camioneta: 'utilitario',
    utilitaria: 'utilitario',
    furgoneta: 'furgon',
    semi: 'semirremolque',
    semirremolque: 'semirremolque',
    semirremolques: 'semirremolque',
    semi_remolque: 'semirremolque',
    semi_remolques: 'semirremolque',
    remolque: 'semirremolque',
    acoplados: 'acoplado',
    auto_elevador: 'autoelevador',
    autoelevadores: 'autoelevador',
    montacargas: 'autoelevador',
    zamping: 'autoelevador',
  };

  const normalized = aliases[raw] || raw;
  return VALID_TYPES.includes(normalized) ? normalized : 'otro';
}

function toInt(value, fallback = null) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function cleanText(value, fallback = null) {
  const s = String(value ?? '').trim();
  return s || fallback;
}

function normalizePlate(value, code) {
  const plate = cleanText(value, '');
  // Autoelevadores, acoplados o semis a veces no tienen patente cargada en el momento.
  // PostgreSQL tiene unique sobre plate; usar el código interno evita NaN/null y mantiene unicidad.
  return plate || cleanText(code, 'SIN-PATENTE');
}

async function ensureVehiclesSchema() {
  // Protege bases viejas que no tenían todas las columnas que usa la pantalla de Flota.
  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS code VARCHAR(20)`).catch(() => {});
  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS base TEXT DEFAULT 'Central'`).catch(() => {});
  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS driver_id UUID`).catch(() => {});
  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS driver_name TEXT`).catch(() => {});
  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS km_current INT DEFAULT 0`).catch(() => {});
  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vin TEXT`).catch(() => {});
  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS engine_no TEXT`).catch(() => {});
  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cost_center TEXT`).catch(() => {});
  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tech_spec JSONB DEFAULT '{}'::jsonb`).catch(() => {});
  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`).catch(() => {});
  await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`).catch(() => {});
}

// GET /api/vehicles
router.get('/', authenticate, async (req, res) => {
  try {
    await ensureVehiclesSchema();
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
    await ensureVehiclesSchema();
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
    await ensureVehiclesSchema();
    const type = normalizeVehicleType(req.body.type);
    const code = cleanText(req.body.code, '').toUpperCase();
    const plate = normalizePlate(req.body.plate, code).toUpperCase();
    const brand = cleanText(req.body.brand, 'Sin marca');
    const model = cleanText(req.body.model, type === 'autoelevador' ? 'Autoelevador' : 'Sin modelo');
    const year = toInt(req.body.year, new Date().getFullYear());
    const base = cleanText(req.body.base, 'Central');
    const kmCurrent = toInt(req.body.km_current, 0);
    const status = cleanText(req.body.status, 'ok');
    const driverName = cleanText(req.body.driver, null);

    if (!code || !type) {
      return res.status(400).json({ error: 'Campos requeridos: código interno y tipo de unidad' });
    }

    const result = await query(
      `INSERT INTO vehicles (code, plate, brand, model, year, type, base, driver_id, km_current, vin, engine_no, cost_center, driver_name, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [code, plate, brand, model, year, type, base, req.body.driver_id || null, kmCurrent,
       cleanText(req.body.vin, null), cleanText(req.body.engine_no, null), cleanText(req.body.cost_center, null), driverName, status]
    );
    res.locals.recordId = result.rows[0].id;
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Código o patente ya existe' });
    console.error('POST vehicle error:', err);
    res.status(500).json({ error: 'Error al crear vehículo' });
  }
});

// PUT /api/vehicles/:id
router.put('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), validateUUID('id'), auditAction('UPDATE','vehicles'), async (req, res) => {
  try {
    await ensureVehiclesSchema();
    const type = normalizeVehicleType(req.body.type);
    const code = cleanText(req.body.code, '').toUpperCase();
    const plate = normalizePlate(req.body.plate, code).toUpperCase();
    const brand = cleanText(req.body.brand, 'Sin marca');
    const model = cleanText(req.body.model, type === 'autoelevador' ? 'Autoelevador' : 'Sin modelo');
    const year = toInt(req.body.year, new Date().getFullYear());
    const kmCurrent = toInt(req.body.km_current, 0);

    if (!code || !type) {
      return res.status(400).json({ error: 'Campos requeridos: código interno y tipo de unidad' });
    }

    const result = await query(
      `UPDATE vehicles SET brand=$1, model=$2, year=$3, type=$4, status=$5, base=$6,
       driver_id=$7, km_current=$8, vin=$9, engine_no=$10, cost_center=$11, plate=$12,
       driver_name=$13, code=$14, updated_at=NOW()
       WHERE id=$15 AND active=TRUE RETURNING *`,
      [brand, model, year, type, cleanText(req.body.status, 'ok'), cleanText(req.body.base, 'Central'),
       req.body.driver_id || null, kmCurrent, cleanText(req.body.vin, null),
       cleanText(req.body.engine_no, null), cleanText(req.body.cost_center, null), plate,
       cleanText(req.body.driver, null), code, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.locals.recordId = result.rows[0].id;
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Código o patente ya existe' });
    console.error('PUT vehicle error:', err);
    res.status(500).json({ error: 'Error al actualizar vehículo' });
  }
});

// PATCH /api/vehicles/:id/km — actualizar odómetro / horas
router.patch('/:id/km', authenticate, validateUUID('id'), async (req, res) => {
  try {
    await ensureVehiclesSchema();
    const km = toInt(req.body.km, null);
    if (km === null || km < 0) return res.status(400).json({ error: 'Km/horas inválido' });
    const result = await query(
      'UPDATE vehicles SET km_current = $1, updated_at=NOW() WHERE id = $2 RETURNING id, code, km_current',
      [km, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH km error:', err.message);
    res.status(500).json({ error: 'Error al actualizar km/horas' });
  }
});

// DELETE /api/vehicles/:id — baja lógica, solo dueño
router.delete('/:id', authenticate, requireRole('dueno'), sensitiveLimiter, validateUUID('id'), auditAction('DEACTIVATE','vehicles'), async (req, res) => {
  try {
    await ensureVehiclesSchema();
    await query('UPDATE vehicles SET active = FALSE, updated_at=NOW() WHERE id = $1', [req.params.id]);
    res.json({ message: 'Vehículo dado de baja' });
  } catch (err) {
    console.error('DELETE vehicle error:', err.message);
    res.status(500).json({ error: 'Error al dar de baja vehículo' });
  }
});

// PATCH /api/vehicles/:id/techspec — guardar ficha técnica editable
router.patch('/:id/techspec', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), validateUUID('id'), async (req, res) => {
  try {
    await ensureVehiclesSchema();
    const result = await query(
      `UPDATE vehicles SET tech_spec = $1, updated_at=NOW() WHERE id = $2 AND active = TRUE RETURNING id, tech_spec`,
      [JSON.stringify(req.body || {}), req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('techspec error:', err.message);
    res.status(500).json({ error: 'Error al guardar ficha técnica' });
  }
});

module.exports = router;
