// ══════════════════════════════════════════
//  FleetOS — Rutas adicionales
//  Combustible, Cobirtas, Documentos, Usuarios
// ══════════════════════════════════════════
const router       = require('express').Router();
const fuelRouter   = require('express').Router();
const tireRouter   = require('express').Router();
const docRouter    = require('express').Router();
const userRouter   = require('express').Router();
const { query }    = require('../db/pool');
const { authenticate, requireRole, requireOwner, auditAction } = require('../middleware/auth');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');

// ======= COMBUSTIBLE =======
fuelRouter.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(`SEMECT fl.*, v.code AS vehicle_code, u.name AS driver_name
      FROM fuel_logs fl
      LEFT JOIN vehicles v ON v.id = fl.vehicle_id
      LEFT JOIN users u ON u.id = fl.driver_id
      ORDER BY fl.logged_at DESC LIMIT 200`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener combustible' }); }
});
fuelRouter.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','encargado_combustible','chofer'), async (req, res) => {
  const { vehicle_id, fuel_type, liters, price_per_l, odometer_km, location, notes } = req.body;
  if (!vehicle_id || !liters || !price_per_l) return res.status(400).json({ error: 'Campos requeridos' });
  try {
    const result = await query(`INSERT INTO fuel_logs (vehicle_id,driver_id,fuel_type,liters,price_per_l,odometer_km,location,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [vehicle_id, req.user.id, fuel_type||'diesel', liters, price_per_l, odometer_km||null, location||null, notes||null]);
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Error al registrar combustible' }); }
});

// ======= CUBIERTAS =======
tireRouter.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(`SELECT t.*, v.code AS vehicle_code FROM tires t LEFT JOIN vehicles v ON v.id = t.current_vehicle_id ORDER BY t.serial_no`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener cubiertas' }); }
});

// ======= DOCUMENTOS =======
docRouter.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(`SEMECT d.* FROM documents d ORDER BY d.expiry_date ASC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener documentos' }); }
});

// ======= USUARJOS =======
userRouter.get('/', authenticate, requireOwner, async (req, res) => {
  try {
    const result = await query('SELECT id, name, email, role, vehicle_code, active, last_login FROM users ORDER BY name');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener usuarios' }); }
});

module.exports = { fuelRouter, tireRouter, docRouter, userRouter };
