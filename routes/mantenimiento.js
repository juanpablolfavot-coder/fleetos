// ════════════════════════════════════════════════════════════════════
//  Planes de mantenimiento preventivo.
//
//  Modo aviso: acá NO se generan órdenes de trabajo. Se dice qué toca y
//  cuánto falta; abrir la OT sigue siendo decisión de una persona. Ver el
//  comentario de services/mantenimiento.js para el porqué.
// ════════════════════════════════════════════════════════════════════
const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { validateUUID } = require('../middleware/security');
const mant = require('../services/mantenimiento');

// Quién puede tocar los planes. Leer lo puede cualquiera que entre a la
// pantalla de Mantenimiento; escribir, los que responden por el taller.
const puedeEditar = requireRole('dueno', 'gerencia', 'jefe_mantenimiento');

const TIPOS = ['km', 'horas', 'dias'];

// Valida y normaliza lo que llega del cliente. Devuelve { error } o { datos }.
function leerPlan(body, { parcial = false } = {}) {
  const d = {};
  const falta = (campo) => !parcial && (body[campo] === undefined || body[campo] === null || body[campo] === '');

  if (falta('vehicle_id')) return { error: 'Falta la unidad' };
  if (body.vehicle_id !== undefined) d.vehicle_id = String(body.vehicle_id);

  if (falta('nombre')) return { error: 'Falta el nombre del plan' };
  if (body.nombre !== undefined) {
    d.nombre = String(body.nombre).trim().slice(0, 200);
    if (!d.nombre) return { error: 'El nombre no puede estar vacío' };
  }

  if (falta('tipo')) return { error: 'Falta el tipo (km, horas o dias)' };
  if (body.tipo !== undefined) {
    d.tipo = String(body.tipo).toLowerCase();
    if (!TIPOS.includes(d.tipo)) return { error: `El tipo tiene que ser uno de: ${TIPOS.join(', ')}` };
  }

  if (falta('intervalo')) return { error: 'Falta el intervalo' };
  if (body.intervalo !== undefined) {
    d.intervalo = parseInt(body.intervalo, 10);
    if (!Number.isFinite(d.intervalo) || d.intervalo <= 0) return { error: 'El intervalo tiene que ser un número mayor a cero' };
  }

  if (body.aviso_antes !== undefined) {
    d.aviso_antes = parseInt(body.aviso_antes, 10);
    if (!Number.isFinite(d.aviso_antes) || d.aviso_antes < 0) return { error: 'El aviso previo no puede ser negativo' };
    if (d.intervalo !== undefined && d.aviso_antes >= d.intervalo) {
      // Avisar con más anticipación que el propio intervalo deja el plan en
      // estado "próximo" para siempre: el aviso nunca se apaga.
      return { error: 'El aviso previo tiene que ser menor que el intervalo' };
    }
  }

  if (body.ultimo_valor !== undefined) {
    d.ultimo_valor = body.ultimo_valor === null || body.ultimo_valor === '' ? null : Number(body.ultimo_valor);
    if (d.ultimo_valor !== null && !Number.isFinite(d.ultimo_valor)) return { error: 'El último valor tiene que ser un número' };
  }
  if (body.ultima_fecha !== undefined) {
    d.ultima_fecha = body.ultima_fecha || null;
  }
  if (body.notas !== undefined) d.notas = body.notas ? String(body.notas).slice(0, 2000) : null;
  if (body.activo !== undefined) d.activo = !!body.activo;

  return { datos: d };
}

// GET /api/mantenimiento/planes — con el estado calculado de cada uno.
router.get('/planes', authenticate, async (req, res) => {
  try {
    res.json(await mant.estadoPlanes({ vehicleId: req.query.vehicle_id || null }));
  } catch (err) {
    console.error('[mantenimiento GET]', err.message);
    res.status(500).json({ error: 'Error al obtener los planes' });
  }
});

// POST /api/mantenimiento/planes
router.post('/planes', authenticate, puedeEditar, async (req, res) => {
  const { error, datos } = leerPlan(req.body || {});
  if (error) return res.status(400).json({ error });
  try {
    const r = await query(
      `INSERT INTO maintenance_schedules
         (vehicle_id, nombre, tipo, intervalo, aviso_antes, ultimo_valor, ultima_fecha, notas, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [datos.vehicle_id, datos.nombre, datos.tipo, datos.intervalo, datos.aviso_antes ?? 0,
       datos.ultimo_valor ?? null, datos.ultima_fecha ?? null, datos.notas ?? null, req.user.id]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Esa unidad ya tiene un plan con ese nombre' });
    if (err.code === '23503') return res.status(400).json({ error: 'La unidad no existe' });
    console.error('[mantenimiento POST]', err.message);
    res.status(500).json({ error: 'Error al crear el plan' });
  }
});

// PUT /api/mantenimiento/planes/:id
router.put('/planes/:id', authenticate, puedeEditar, validateUUID('id'), async (req, res) => {
  const { error, datos } = leerPlan(req.body || {}, { parcial: true });
  if (error) return res.status(400).json({ error });
  const campos = Object.keys(datos);
  if (!campos.length) return res.status(400).json({ error: 'Nada para actualizar' });
  try {
    const sets = campos.map((c, i) => `${c} = $${i + 1}`);
    const params = campos.map((c) => datos[c]);
    params.push(req.params.id);
    const r = await query(
      `UPDATE maintenance_schedules SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows[0]) return res.status(404).json({ error: 'Plan no encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Esa unidad ya tiene un plan con ese nombre' });
    console.error('[mantenimiento PUT]', err.message);
    res.status(500).json({ error: 'Error al actualizar el plan' });
  }
});

// POST /api/mantenimiento/planes/:id/realizado — "ya se hizo".
// Mueve la línea de base al contador actual de la unidad (o al valor que
// manden, si lo hicieron en otro momento). Es la operación de todos los días:
// sin esto el plan queda vencido para siempre.
router.post('/planes/:id/realizado', authenticate, puedeEditar, validateUUID('id'), async (req, res) => {
  try {
    const p = await query(`
      SELECT m.tipo, v.km_current, v.gps_hour_meter
        FROM maintenance_schedules m JOIN vehicles v ON v.id = m.vehicle_id
       WHERE m.id = $1`, [req.params.id]);
    if (!p.rows[0]) return res.status(404).json({ error: 'Plan no encontrado' });

    const plan = p.rows[0];
    const fecha = req.body?.fecha || new Date().toISOString().slice(0, 10);
    let valor = req.body?.valor !== undefined && req.body.valor !== null && req.body.valor !== ''
      ? Number(req.body.valor)
      : (plan.tipo === 'km' ? plan.km_current : plan.tipo === 'horas' ? plan.gps_hour_meter : null);
    if (valor !== null && !Number.isFinite(Number(valor))) {
      return res.status(400).json({ error: 'El valor tiene que ser un número' });
    }
    if (plan.tipo !== 'dias' && (valor === null || valor === undefined)) {
      return res.status(400).json({
        error: `La unidad no tiene ${plan.tipo === 'km' ? 'kilometraje' : 'horómetro'} cargado. Indicá el valor a mano.`,
      });
    }

    const r = await query(
      `UPDATE maintenance_schedules
          SET ultimo_valor = $1, ultima_fecha = $2, updated_at = NOW()
        WHERE id = $3 RETURNING *`,
      [plan.tipo === 'dias' ? null : Number(valor), fecha, req.params.id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[mantenimiento realizado]', err.message);
    res.status(500).json({ error: 'Error al registrar el mantenimiento' });
  }
});

// DELETE /api/mantenimiento/planes/:id — baja lógica, para no perder el historial.
router.delete('/planes/:id', authenticate, puedeEditar, validateUUID('id'), async (req, res) => {
  try {
    const r = await query(
      'UPDATE maintenance_schedules SET activo = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id',
      [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Plan no encontrado' });
    res.json({ message: 'Plan dado de baja' });
  } catch (err) {
    console.error('[mantenimiento DELETE]', err.message);
    res.status(500).json({ error: 'Error al dar de baja el plan' });
  }
});

module.exports = router;
module.exports.leerPlan = leerPlan;
