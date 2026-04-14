
// ═══════════════════════════════════════════════════════════
//  FleetOS — Panel Auditor
//  Todos los endpoints son solo lectura (GET)
//  Requieren rol: auditor (o dueno para emergencias)
// ═══════════════════════════════════════════════════════════
const auditorRouter = require('express').Router();
const { query }     = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const canAudit = (req, res, next) => {
  if (['auditor','dueno'].includes(req.user?.role)) return next();
  res.status(403).json({ error: 'Acceso restringido al auditor' });
};

// ── 1. Resumen ejecutivo del mes ──────────────────────────
auditorRouter.get('/resumen', authenticate, canAudit, async (req, res) => {
  try {
    const { mes } = req.query; // formato YYYY-MM, default mes actual
    const now   = new Date();
    const yr    = mes ? parseInt(mes.split('-')[0]) : now.getFullYear();
    const mo    = mes ? parseInt(mes.split('-')[1]) : now.getMonth() + 1;
    const desde = `${yr}-${String(mo).padStart(2,'0')}-01`;
    const hasta = `${yr}-${String(mo).padStart(2,'0')}-31`;

    const [fuel, ots, stock, checklists, vehiculos, accesos] = await Promise.all([
      // Combustible del mes
      query(`SELECT 
        COUNT(*) as cargas,
        COALESCE(SUM(liters),0) as litros,
        COALESCE(SUM(liters*price_per_l),0) as costo,
        COUNT(DISTINCT vehicle_id) as unidades,
        COUNT(CASE WHEN ticket_image IS NULL THEN 1 END) as sin_ticket
        FROM fuel_logs WHERE logged_at BETWEEN $1 AND $2`, [desde, hasta + ' 23:59:59']),
      // OTs del mes
      query(`SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status='Cerrada' THEN 1 END) as cerradas,
        COUNT(CASE WHEN status!='Cerrada' THEN 1 END) as abiertas,
        COALESCE(SUM(labor_cost),0) as mano_obra,
        COALESCE(SUM(parts_cost),0) as repuestos
        FROM work_orders WHERE opened_at BETWEEN $1 AND $2`, [desde, hasta + ' 23:59:59']),
      // Movimientos de stock del mes
      query(`SELECT COUNT(*) as movimientos, 
        COUNT(CASE WHEN type='Baja' THEN 1 END) as bajas,
        COUNT(CASE WHEN type='Egreso' THEN 1 END) as egresos
        FROM stock_movements WHERE created_at BETWEEN $1 AND $2`, [desde, hasta + ' 23:59:59']),
      // Checklists del mes
      query(`SELECT COUNT(*) as total,
        COUNT(CASE WHEN all_ok=FALSE THEN 1 END) as con_problema
        FROM checklists WHERE created_at BETWEEN $1 AND $2`, [desde, hasta + ' 23:59:59']),
      // Estado de flota
      query(`SELECT status, COUNT(*) as cnt FROM vehicles WHERE active=TRUE GROUP BY status`),
      // Accesos del mes
      query(`SELECT COUNT(DISTINCT u.id) as usuarios_activos
        FROM users u WHERE u.last_login BETWEEN $1 AND $2`, [desde, hasta + ' 23:59:59']),
    ]);

    const flota = {};
    vehiculos.rows.forEach(r => flota[r.status] = parseInt(r.cnt));

    res.json({
      periodo: { año: yr, mes: mo, desde, hasta },
      flota,
      combustible: fuel.rows[0],
      ordenes:     ots.rows[0],
      stock:       stock.rows[0],
      checklists:  checklists.rows[0],
      usuarios_activos: parseInt(accesos.rows[0]?.usuarios_activos || 0),
    });
  } catch(err) { console.error('auditor resumen:', err.message); res.status(500).json({ error: err.message }); }
});

// ── 2. Anomalías de combustible ──────────────────────────
auditorRouter.get('/anomalias-combustible', authenticate, canAudit, async (req, res) => {
  try {
    const anomalias = [];

    // a) Cargas sin foto de ticket
    const sinTicket = await query(`
      SELECT fl.*, v.code as vehicle_code, u.name as driver_name
      FROM fuel_logs fl
      JOIN vehicles v ON v.id = fl.vehicle_id
      LEFT JOIN users u ON u.id = fl.driver_id
      WHERE fl.ticket_image IS NULL
      ORDER BY fl.logged_at DESC LIMIT 50`);
    
    if (sinTicket.rows.length > 0) {
      anomalias.push({
        tipo: 'sin_ticket',
        severidad: 'media',
        titulo: 'Cargas sin foto de ticket',
        descripcion: `${sinTicket.rows.length} cargas registradas sin foto de ticket como respaldo`,
        registros: sinTicket.rows.map(r => ({
          fecha: r.logged_at,
          unidad: r.vehicle_code,
          chofer: r.driver_name,
          litros: r.liters,
          precio: r.price_per_l,
          lugar: r.location,
        }))
      });
    }

    // b) Consumo anómalo: comparar litros cargados vs km recorridos por GPS
    const cargas = await query(`
      SELECT fl.vehicle_id, fl.liters, fl.odometer_km, fl.logged_at, fl.price_per_l,
             v.code as vehicle_code, v.gps_status,
             u.name as driver_name
      FROM fuel_logs fl
      JOIN vehicles v ON v.id = fl.vehicle_id
      LEFT JOIN users u ON u.id = fl.driver_id
      WHERE fl.odometer_km > 0
      ORDER BY fl.vehicle_id, fl.logged_at ASC`);

    // Agrupar por vehículo y calcular rendimiento por intervalo
    const byVeh = {};
    cargas.rows.forEach(r => {
      if (!byVeh[r.vehicle_id]) byVeh[r.vehicle_id] = { code: r.vehicle_code, cargas: [] };
      byVeh[r.vehicle_id].cargas.push(r);
    });

    const rendAnomalo = [];
    Object.values(byVeh).forEach(({ code, cargas }) => {
      for (let i = 1; i < cargas.length; i++) {
        const kmDiff   = cargas[i].odometer_km - cargas[i-1].odometer_km;
        const litros   = parseFloat(cargas[i].liters);
        const rend     = kmDiff > 0 && litros > 0 ? kmDiff / litros : 0;
        // Rendimiento anómalo: < 1.5 km/L o > 8 km/L para un camión
        if (rend > 0 && (rend < 1.5 || rend > 8)) {
          rendAnomalo.push({
            unidad: code,
            fecha: cargas[i].logged_at,
            chofer: cargas[i].driver_name,
            km_recorridos: kmDiff,
            litros_cargados: litros,
            rendimiento: rend.toFixed(2),
            anomalia: rend < 1.5 ? 'Consumo excesivo' : 'Consumo irreal (muy bajo)',
          });
        }
      }
    });

    if (rendAnomalo.length > 0) {
      anomalias.push({
        tipo: 'rendimiento_anomalo',
        severidad: 'alta',
        titulo: 'Rendimiento de combustible anómalo',
        descripcion: `${rendAnomalo.length} intervalos con consumo fuera del rango normal (1.5 - 8 km/L)`,
        registros: rendAnomalo,
      });
    }

    // c) Cargas duplicadas (misma unidad, mismo día, litros similares)
    const duplicadas = await query(`
      SELECT fl1.vehicle_id, v.code as vehicle_code, 
             fl1.logged_at as carga1, fl2.logged_at as carga2,
             fl1.liters as litros1, fl2.liters as litros2,
             u1.name as chofer1, u2.name as chofer2
      FROM fuel_logs fl1
      JOIN fuel_logs fl2 ON fl1.vehicle_id = fl2.vehicle_id 
        AND fl1.id != fl2.id
        AND ABS(EXTRACT(EPOCH FROM (fl2.logged_at - fl1.logged_at))) < 3600
        AND ABS(fl1.liters - fl2.liters) < 50
      JOIN vehicles v ON v.id = fl1.vehicle_id
      LEFT JOIN users u1 ON u1.id = fl1.driver_id
      LEFT JOIN users u2 ON u2.id = fl2.driver_id
      WHERE fl1.logged_at > fl2.logged_at
      ORDER BY fl1.logged_at DESC LIMIT 20`);

    if (duplicadas.rows.length > 0) {
      anomalias.push({
        tipo: 'posible_duplicado',
        severidad: 'alta',
        titulo: 'Posibles cargas duplicadas',
        descripcion: `${duplicadas.rows.length} pares de cargas muy similares en menos de 1 hora para la misma unidad`,
        registros: duplicadas.rows,
      });
    }

    res.json({ total_anomalias: anomalias.length, anomalias });
  } catch(err) { console.error('auditor anomalias fuel:', err.message); res.status(500).json({ error: err.message }); }
});

// ── 3. Anomalías en OTs ───────────────────────────────────
auditorRouter.get('/anomalias-ots', authenticate, canAudit, async (req, res) => {
  try {
    const anomalias = [];

    // a) OTs con costo de mano de obra muy alto (> 3x el promedio)
    const costos = await query(`
      SELECT AVG(labor_cost) as avg_labor, STDDEV(labor_cost) as std_labor
      FROM work_orders WHERE status='Cerrada' AND labor_cost > 0`);
    
    const avgLabor = parseFloat(costos.rows[0]?.avg_labor || 0);
    const stdLabor = parseFloat(costos.rows[0]?.std_labor || 0);
    const umbral   = avgLabor + (3 * stdLabor);

    if (avgLabor > 0 && umbral > 0) {
      const caras = await query(`
        SELECT wo.*, v.code as vehicle_code, u.name as mechanic_name, rep.name as reporter_name
        FROM work_orders wo
        JOIN vehicles v ON v.id = wo.vehicle_id
        LEFT JOIN users u ON u.id = wo.mechanic_id
        LEFT JOIN users rep ON rep.id = wo.reporter_id
        WHERE wo.status='Cerrada' AND wo.labor_cost > $1
        ORDER BY wo.labor_cost DESC LIMIT 20`, [umbral]);

      if (caras.rows.length > 0) {
        anomalias.push({
          tipo: 'labor_cost_alto',
          severidad: 'alta',
          titulo: 'OTs con costo de mano de obra inusualmente alto',
          descripcion: `${caras.rows.length} OTs con costo > $${Math.round(umbral).toLocaleString()} (promedio: $${Math.round(avgLabor).toLocaleString()})`,
          registros: caras.rows.map(r => ({
            codigo: r.code,
            unidad: r.vehicle_code,
            mecanico: r.mechanic_name,
            descripcion: r.description,
            labor_cost: r.labor_cost,
            parts_cost: r.parts_cost,
            fecha_cierre: r.closed_at,
          }))
        });
      }
    } else {
      // Sin historial suficiente aún
    }

    // b) OTs abiertas y cerradas el mismo día
    const mismoDia = await query(`
      SELECT wo.*, v.code as vehicle_code, u.name as mechanic_name
      FROM work_orders wo
      JOIN vehicles v ON v.id = wo.vehicle_id
      LEFT JOIN users u ON u.id = wo.mechanic_id
      WHERE wo.status='Cerrada'
        AND DATE(wo.opened_at) = DATE(wo.closed_at)
        AND (wo.labor_cost > 0 OR wo.parts_cost > 0)
      ORDER BY wo.closed_at DESC LIMIT 20`);

    if (mismoDia.rows.length > 0) {
      anomalias.push({
        tipo: 'ot_mismo_dia',
        severidad: 'media',
        titulo: 'OTs abiertas y cerradas el mismo día con costo',
        descripcion: `${mismoDia.rows.length} OTs cerradas en el mismo día de apertura con costos registrados`,
        registros: mismoDia.rows.map(r => ({
          codigo: r.code,
          unidad: r.vehicle_code,
          mecanico: r.mechanic_name,
          descripcion: r.description,
          labor_cost: r.labor_cost,
          parts_cost: r.parts_cost,
          fecha: r.opened_at,
        }))
      });
    }

    // c) Repuestos externos sin descripción detallada
    const externos = await query(`
      SELECT wop.*, wo.code as ot_code, v.code as vehicle_code
      FROM work_order_parts wop
      JOIN work_orders wo ON wo.id = wop.wo_id
      JOIN vehicles v ON v.id = wo.vehicle_id
      WHERE wop.stock_id IS NULL AND wop.unit_cost > 50000
      ORDER BY wop.unit_cost DESC LIMIT 20`);

    if (externos.rows.length > 0) {
      anomalias.push({
        tipo: 'repuesto_externo_caro',
        severidad: 'media',
        titulo: 'Repuestos externos de alto valor sin respaldo de stock',
        descripcion: `${externos.rows.length} repuestos externos con valor > $50.000 sin factura ni código de stock`,
        registros: externos.rows.map(r => ({
          ot: r.ot_code,
          unidad: r.vehicle_code,
          repuesto: r.name,
          cantidad: r.qty,
          precio_unitario: r.unit_cost,
          subtotal: r.subtotal,
        }))
      });
    }

    res.json({ total_anomalias: anomalias.length, anomalias });
  } catch(err) { console.error('auditor anomalias ots:', err.message); res.status(500).json({ error: err.message }); }
});

// ── 4. Trazabilidad completa por unidad ───────────────────
auditorRouter.get('/trazabilidad/:vehicleId', authenticate, canAudit, async (req, res) => {
  try {
    const id = req.params.vehicleId;
    const [veh, fuel, ots, checklists, docs, tires] = await Promise.all([
      query('SELECT * FROM vehicles WHERE id=$1', [id]),
      query('SELECT fl.*, u.name as driver_name FROM fuel_logs fl LEFT JOIN users u ON u.id=fl.driver_id WHERE fl.vehicle_id=$1 ORDER BY fl.logged_at DESC LIMIT 100', [id]),
      query('SELECT wo.*, u.name as mechanic_name, r.name as reporter_name FROM work_orders wo LEFT JOIN users u ON u.id=wo.mechanic_id LEFT JOIN users r ON r.id=wo.reporter_id WHERE wo.vehicle_id=$1 ORDER BY wo.opened_at DESC LIMIT 100', [id]),
      query('SELECT c.*, u.name as driver_name FROM checklists c LEFT JOIN users u ON u.id=c.driver_id WHERE c.vehicle_id=$1 ORDER BY c.created_at DESC LIMIT 100', [id]),
      query('SELECT * FROM documents WHERE entity_id=$1 ORDER BY expiry_date ASC', [id]),
      query('SELECT t.*, tm.type as last_move_type, tm.created_at as last_move_date FROM tires t LEFT JOIN tire_movements tm ON tm.tire_id=t.id WHERE t.current_vehicle_id=$1 ORDER BY t.serial_no', [id]),
    ]);

    if (!veh.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });

    // Construir línea de tiempo unificada
    const timeline = [];
    fuel.rows.forEach(r => timeline.push({ fecha: r.logged_at, tipo: 'combustible', detalle: `${r.liters}L a $${r.price_per_l}/L — ${r.location}`, usuario: r.driver_name, monto: r.liters * r.price_per_l }));
    ots.rows.forEach(r => timeline.push({ fecha: r.opened_at, tipo: 'ot_apertura', detalle: `${r.code} — ${r.description} (${r.type})`, usuario: r.reporter_name, monto: 0 }));
    ots.rows.filter(r=>r.closed_at).forEach(r => timeline.push({ fecha: r.closed_at, tipo: 'ot_cierre', detalle: `${r.code} cerrada — MO: $${r.labor_cost} / Rep: $${r.parts_cost}`, usuario: r.mechanic_name, monto: parseFloat(r.labor_cost||0)+parseFloat(r.parts_cost||0) }));
    checklists.rows.forEach(r => timeline.push({ fecha: r.created_at, tipo: 'checklist', detalle: `Checklist — ${r.all_ok ? 'OK' : 'CON PROBLEMAS'}`, usuario: r.driver_name, monto: 0 }));
    timeline.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));

    res.json({
      vehiculo: veh.rows[0],
      resumen: {
        total_cargas: fuel.rows.length,
        total_ots: ots.rows.length,
        total_checklists: checklists.rows.length,
        costo_combustible: fuel.rows.reduce((a,r)=>a+parseFloat(r.liters)*parseFloat(r.price_per_l),0),
        costo_mantenimiento: ots.rows.reduce((a,r)=>a+parseFloat(r.labor_cost||0)+parseFloat(r.parts_cost||0),0),
      },
      timeline,
      documentos: docs.rows,
      cubiertas: tires.rows,
    });
  } catch(err) { console.error('auditor trazabilidad:', err.message); res.status(500).json({ error: err.message }); }
});

// ── 5. Log de acciones del sistema ───────────────────────
auditorRouter.get('/log-acciones', authenticate, canAudit, async (req, res) => {
  try {
    const { limit = 100, desde, hasta } = req.query;
    let sql = `
      SELECT al.*, u.name as user_name, u.role as user_role
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE 1=1`;
    const params = [];
    if (desde) { params.push(desde); sql += ` AND al.created_at >= $${params.length}`; }
    if (hasta) { params.push(hasta); sql += ` AND al.created_at <= $${params.length}`; }
    sql += ` ORDER BY al.created_at DESC LIMIT $${params.length+1}`;
    params.push(parseInt(limit));
    
    // Verificar si existe la tabla audit_log
    const tableCheck = await query(`SELECT to_regclass('public.audit_log') as exists`);
    if (!tableCheck.rows[0]?.exists) {
      return res.json({ log: [], nota: 'Tabla de auditoría en construcción — se registrarán acciones desde ahora' });
    }
    
    const result = await query(sql, params);
    res.json({ total: result.rows.length, log: result.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── 6. Reporte comparativo mensual ───────────────────────
auditorRouter.get('/comparativo', authenticate, canAudit, async (req, res) => {
  try {
    const meses = [];
    for (let i = 5; i >= 0; i--) {
      const d     = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const yr    = d.getFullYear();
      const mo    = d.getMonth() + 1;
      const desde = `${yr}-${String(mo).padStart(2,'0')}-01`;
      const hasta = `${yr}-${String(mo).padStart(2,'0')}-31`;

      const [fuel, ots] = await Promise.all([
        query(`SELECT COALESCE(SUM(liters*price_per_l),0) as costo_fuel, COALESCE(SUM(liters),0) as litros, COUNT(*) as cargas FROM fuel_logs WHERE logged_at BETWEEN $1 AND $2`, [desde, hasta+' 23:59:59']),
        query(`SELECT COALESCE(SUM(labor_cost+parts_cost),0) as costo_mant, COUNT(*) as ots FROM work_orders WHERE opened_at BETWEEN $1 AND $2`, [desde, hasta+' 23:59:59']),
      ]);

      meses.push({
        periodo: `${yr}-${String(mo).padStart(2,'0')}`,
        label:   d.toLocaleString('es-AR', { month:'short', year:'2-digit' }),
        costo_combustible: parseFloat(fuel.rows[0].costo_fuel),
        litros:            parseFloat(fuel.rows[0].litros),
        cargas:            parseInt(fuel.rows[0].cargas),
        costo_mantenimiento: parseFloat(ots.rows[0].costo_mant),
        ots:               parseInt(ots.rows[0].ots),
        total:             parseFloat(fuel.rows[0].costo_fuel) + parseFloat(ots.rows[0].costo_mant),
      });
    }
    res.json({ meses });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = auditorRouter;

// ── 7. Proxy IA — llama a Claude desde el backend (protege la API key) ──
auditorRouter.post('/ia', authenticate, canAudit, async (req, res) => {
  try {
    const { pregunta, contexto } = req.body;
    if (!pregunta) return res.status(400).json({ error: 'Pregunta requerida' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'API key de IA no configurada. Contactar al administrador.' });

    const https = require('https');
    const body  = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: contexto || 'Sos un auditor experto en empresas de transporte de Argentina. Respondé en español, de forma concisa y profesional.',
      messages: [{ role: 'user', content: pregunta }]
    });

    const respuesta = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      let data = '';
      const r = https.request(options, resp => {
        resp.on('data', c => data += c);
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error('Respuesta inválida de la IA')); }
        });
      });
      r.on('error', reject);
      r.write(body);
      r.end();
    });

    const texto = respuesta.content?.[0]?.text;
    if (!texto) return res.status(500).json({ error: 'Sin respuesta de la IA' });
    res.json({ respuesta: texto });
  } catch(err) {
    console.error('auditor ia:', err.message);
    res.status(500).json({ error: err.message });
  }
});
