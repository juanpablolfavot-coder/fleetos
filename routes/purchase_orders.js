// ═══════════════════════════════════════════════════════════
//  FleetOS — Órdenes de Compra (con workflow)
// ═══════════════════════════════════════════════════════════
const router   = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

async function ensureTables() {
  await query(`CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'en_revision',
    requested_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sucursal VARCHAR(200), notes TEXT, proveedor VARCHAR(200),
    factura_nro VARCHAR(100), factura_fecha DATE,
    factura_monto NUMERIC(14,2), iva_pct NUMERIC(5,2) DEFAULT 0,
    area VARCHAR(200), tipo VARCHAR(30) DEFAULT 'flota',
    vehicle_id UUID REFERENCES vehicles(id),
    ot_id UUID REFERENCES work_orders(id),
    total_estimado NUMERIC(14,2) DEFAULT 0
  )`).catch(()=>{});
  // Campos nuevos: supplier_id (relación con catálogo) y asset_id (para OCs asociadas a activos no-vehículo)
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id UUID`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS asset_id UUID`).catch(()=>{});
  await query(`CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL, cantidad NUMERIC(10,2) DEFAULT 1,
    unidad VARCHAR(20) DEFAULT 'un', precio_unit NUMERIC(14,2) DEFAULT 0,
    subtotal NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * precio_unit) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(()=>{});
  // Campos nuevos: stock_item_id para vincular con stock + ingresado_stock para no duplicar
  await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS stock_item_id UUID`).catch(()=>{});
  await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS ingresado_stock BOOLEAN DEFAULT FALSE`).catch(()=>{});
}
ensureTables();

async function nextOCCode() {
  await query(`CREATE SEQUENCE IF NOT EXISTS oc_seq START 1 INCREMENT 1`).catch(()=>{});
  const r = await query("SELECT nextval('oc_seq') as num");
  return 'OC-' + String(parseInt(r.rows[0].num)).padStart(4, '0');
}

router.get('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','contador','auditor'), async (req, res) => {
  try {
    const { status, limit = 100 } = req.query;
    let sql = `SELECT po.*, u.name as solicitante_nombre,
      COALESCE((SELECT SUM(subtotal) FROM purchase_order_items WHERE po_id = po.id), 0) as total_real
      FROM purchase_orders po LEFT JOIN users u ON u.id = po.requested_by WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); sql += ` AND po.status = $${params.length}`; }
    sql += ` ORDER BY po.created_at DESC LIMIT $${params.length+1}`;
    params.push(parseInt(limit));
    res.json((await query(sql, params)).rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','contador','auditor'), async (req, res) => {
  try {
    const po = await query(`SELECT po.*,
      u.name as solicitante_nombre,
      v.code as vehicle_code, v.plate as vehicle_plate,
      ua.name as aprobador_nombre,
      urj.name as rechazador_nombre,
      urc.name as receptor_nombre,
      up.name as pagador_nombre
      FROM purchase_orders po
      LEFT JOIN users u   ON u.id   = po.requested_by
      LEFT JOIN users ua  ON ua.id  = po.aprobado_por
      LEFT JOIN users urj ON urj.id = po.rechazado_por
      LEFT JOIN users urc ON urc.id = po.recibido_por
      LEFT JOIN users up  ON up.id  = po.pagado_por
      LEFT JOIN vehicles v ON v.id = po.vehicle_id
      WHERE po.id = $1`, [req.params.id]);
    if (!po.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    const items = await query('SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY created_at', [req.params.id]);
    res.json({ ...po.rows[0], items: items.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), async (req, res) => {
  try {
    const { notes, sucursal, area, tipo='flota', vehicle_id, ot_id, asset_id, supplier_id, proveedor, iva_pct=0, items=[], forma_pago, cc_dias, moneda } = req.body;
    if (!items.length) return res.status(400).json({ error: 'La OC debe tener al menos un artículo' });

    // Regla soft: advertir si es OC de flota y NO tiene ot_id
    // (Se permite igual — es advertencia, no bloqueo.)
    const warnings = [];
    if (tipo === 'flota' && !ot_id) {
      warnings.push('OC de flota sin OT vinculada — se recomienda asociar una OT primero');
    }

    const code = await nextOCCode();
    const subtotal = items.reduce((a,i) => a + (parseFloat(i.cantidad||1) * parseFloat(i.precio_unit||0)), 0);
    const total = subtotal * (1 + parseFloat(iva_pct||0) / 100);
    const _fp = (forma_pago === 'contado' || forma_pago === 'cuenta_corriente') ? forma_pago : null;
    const _cc = (_fp === 'cuenta_corriente' && cc_dias != null && cc_dias !== '') ? parseInt(cc_dias, 10) : null;
    const _mon = (moneda === 'USD') ? 'USD' : 'ARS';

    // Si se pasó supplier_id, auto-llenar el campo proveedor (texto) con el nombre del proveedor
    let _proveedor = proveedor || null;
    if (supplier_id && !_proveedor) {
      const s = await query('SELECT name FROM suppliers WHERE id = $1', [supplier_id]);
      if (s.rows[0]) _proveedor = s.rows[0].name;
    }

    const po = await query(
      `INSERT INTO purchase_orders (code, status, requested_by, sucursal, area, tipo, vehicle_id, ot_id, asset_id, supplier_id, proveedor, notes, iva_pct, total_estimado, forma_pago, cc_dias, moneda)
       VALUES ($1,'en_revision',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [code, req.user.id, sucursal||null, area||null, tipo||'flota',
       vehicle_id||null, ot_id||null, asset_id||null, supplier_id||null,
       _proveedor, notes||null, parseFloat(iva_pct||0), total, _fp, _cc, _mon]
    );
    const poId = po.rows[0].id;
    for (const item of items) {
      if (!item.descripcion?.trim()) continue;
      await query(
        `INSERT INTO purchase_order_items (po_id,descripcion,cantidad,unidad,precio_unit,stock_item_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [poId, item.descripcion.trim(),
         parseFloat(item.cantidad||1),
         item.unidad||'un',
         parseFloat(item.precio_unit||0),
         item.stock_item_id || null]
      );
    }
    const full = await query('SELECT * FROM purchase_orders WHERE id=$1',[poId]);
    const itemsResult = await query('SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at',[poId]);
    res.status(201).json({ ...full.rows[0], items: itemsResult.rows, warnings });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), async (req, res) => {
  try {
    const { proveedor,factura_nro,factura_fecha,factura_monto,notes,status,sucursal,area,iva_pct,tipo,vehicle_id,forma_pago,cc_dias,moneda } = req.body;
    const valid_status = ['en_revision','aprobada','rechazada','recibida','pagada','cancelada'];
    if (status && !valid_status.includes(status)) return res.status(400).json({ error: 'Estado invalido' });
    const _fp = (forma_pago === 'contado' || forma_pago === 'cuenta_corriente') ? forma_pago : null;
    const _cc = (_fp === 'contado') ? null : ((cc_dias != null && cc_dias !== '') ? parseInt(cc_dias, 10) : null);
    const _mon = (moneda === 'USD' || moneda === 'ARS') ? moneda : null;
    const r = await query(`UPDATE purchase_orders SET
      sucursal=COALESCE($1,sucursal), area=COALESCE($2,area),
      vehicle_id=COALESCE($3::uuid,vehicle_id), tipo=COALESCE($4,tipo),
      proveedor=COALESCE($5,proveedor), factura_nro=COALESCE($6,factura_nro),
      factura_fecha=COALESCE($7::date,factura_fecha),
      factura_monto=COALESCE($8::numeric,factura_monto),
      notes=COALESCE($9,notes), status=COALESCE($10,status),
      iva_pct=COALESCE($11::numeric,iva_pct),
      forma_pago=COALESCE($13,forma_pago),
      cc_dias=COALESCE($14::integer,cc_dias),
      moneda=COALESCE($15,moneda)
      WHERE id=$12 RETURNING *`,
      [sucursal||null,area||null,vehicle_id||null,tipo||null,proveedor||null,
       factura_nro||null,factura_fecha||null,
       factura_monto?parseFloat(factura_monto):null,
       notes||null,status||null,
       (iva_pct!==undefined&&iva_pct!==null)?parseFloat(iva_pct):null,
       req.params.id, _fp, _cc, _mon]);
    if (!r.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/items', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), async (req, res) => {
  try {
    const { items=[] } = req.body;
    if (!items.length) return res.status(400).json({ error: 'Debe haber al menos un articulo' });
    await query('DELETE FROM purchase_order_items WHERE po_id=$1',[req.params.id]);
    let total = 0;
    for (const item of items) {
      if (!item.descripcion?.trim()) continue;
      const qty=parseFloat(item.cantidad||1), price=parseFloat(item.precio_unit||0);
      await query('INSERT INTO purchase_order_items (po_id,descripcion,cantidad,unidad,precio_unit) VALUES ($1,$2,$3,$4,$5)',
        [req.params.id,item.descripcion.trim(),qty,item.unidad||'un',price]);
      total += qty*price;
    }
    await query('UPDATE purchase_orders SET total_estimado=$1 WHERE id=$2',[total,req.params.id]);
    const updated = await query('SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at',[req.params.id]);
    res.json({ ok:true, items:updated.rows, total_estimado:total });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), async (req, res) => {
  try {
    const check = await query('SELECT status FROM purchase_orders WHERE id=$1',[req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    if (check.rows[0].status !== 'en_revision' && req.user.role !== 'dueno') return res.status(409).json({ error: 'Solo se pueden eliminar OCs en revision' });
    await query('DELETE FROM purchase_orders WHERE id=$1',[req.params.id]);
    res.json({ ok:true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

/* --- OC WORKFLOW v1 --- */

router.post('/:id/aprobar', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), async (req, res) => {
  try {
    const check = await query('SELECT status FROM purchase_orders WHERE id=$1',[req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    if (check.rows[0].status !== 'en_revision') return res.status(409).json({ error: 'Solo se aprueban OCs en revision' });
    const r = await query(
      "UPDATE purchase_orders SET status='aprobada', aprobado_por=$1, aprobado_en=NOW() WHERE id=$2 RETURNING *",
      [req.user.id, req.params.id]
    );
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/rechazar', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), async (req, res) => {
  try {
    const { motivo } = req.body;
    if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'El motivo de rechazo es obligatorio' });
    const check = await query('SELECT status FROM purchase_orders WHERE id=$1',[req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    if (check.rows[0].status !== 'en_revision') return res.status(409).json({ error: 'Solo se rechazan OCs en revision' });
    const r = await query(
      "UPDATE purchase_orders SET status='rechazada', rechazado_por=$1, rechazado_en=NOW(), rechazo_motivo=$2 WHERE id=$3 RETURNING *",
      [req.user.id, motivo.trim(), req.params.id]
    );
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/pagar', authenticate, requireRole('dueno','gerencia','contador'), async (req, res) => {
  try {
    const check = await query('SELECT status FROM purchase_orders WHERE id=$1',[req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    if (check.rows[0].status !== 'recibida') return res.status(409).json({ error: 'Solo se paga una OC en estado recibida' });
    const r = await query(
      "UPDATE purchase_orders SET status='pagada', pagado_por=$1, pagado_en=NOW() WHERE id=$2 RETURNING *",
      [req.user.id, req.params.id]
    );
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/cancelar', authenticate, requireRole('dueno','gerencia'), async (req, res) => {
  try {
    const check = await query('SELECT status FROM purchase_orders WHERE id=$1',[req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    const st = check.rows[0].status;
    const terminales = ['pagada','rechazada','cancelada'];
    if (terminales.includes(st)) return res.status(409).json({ error: 'No se puede cancelar una OC ' + st });
    const r = await query(
      "UPDATE purchase_orders SET status='cancelada' WHERE id=$1 RETURNING *",
      [req.params.id]
    );
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

/* --- FIN OC WORKFLOW v1 --- */

router.post('/:id/recibir', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    // Traer OC + items separados (queremos el stock_item_id de cada item, no solo texto)
    const poR = await client.query('SELECT * FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (!poR.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    const oc = poR.rows[0];
    if (oc.status === 'recibida') return res.status(409).json({ error: 'La OC ya fue recibida' });
    if (oc.status !== 'aprobada') return res.status(409).json({ error: 'Solo se recibe una OC aprobada' });

    const itemsR = await client.query(
      `SELECT id, descripcion, cantidad, unidad, precio_unit, stock_item_id, ingresado_stock
       FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at`,
      [req.params.id]
    );
    const items = itemsR.rows;

    await client.query('BEGIN');

    // 1. Marcar OC como recibida
    await client.query(
      "UPDATE purchase_orders SET status='recibida', recibido_por=$1, recibido_en=NOW() WHERE id=$2",
      [req.user.id, req.params.id]
    );

    // 2. INGRESAR AUTOMÁTICAMENTE AL STOCK los ítems vinculados
    const stockIngresos = [];     // lista de lo que se ingresó
    const warnings     = [];      // lista de ítems sin vincular al stock

    // Asegurarse que exista la tabla de movimientos de stock
    await client.query(`CREATE TABLE IF NOT EXISTS stock_movements (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      stock_item_id UUID REFERENCES stock_items(id) ON DELETE CASCADE,
      tipo VARCHAR(20) NOT NULL,
      qty NUMERIC(12,2) NOT NULL,
      balance_after NUMERIC(12,2),
      ref_type VARCHAR(30),
      ref_id UUID,
      notes TEXT,
      user_id UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(() => {});

    for (const item of items) {
      if (!item.stock_item_id || item.ingresado_stock) {
        // Sin vinculación al stock o ya ingresado previamente → skip
        if (!item.stock_item_id) warnings.push(`"${item.descripcion}" (sin vincular al stock)`);
        continue;
      }

      // Verificar que el ítem de stock existe
      const si = await client.query(
        'SELECT id, code, name, qty_current, unit_cost FROM stock_items WHERE id=$1',
        [item.stock_item_id]
      );
      if (!si.rows[0]) {
        warnings.push(`"${item.descripcion}" (ítem de stock no existe, tal vez eliminado)`);
        continue;
      }
      const stockItem = si.rows[0];

      const qtyIngreso = parseFloat(item.cantidad) || 0;
      const precioNuevo = parseFloat(item.precio_unit) || 0;
      const nuevoQty = parseFloat(stockItem.qty_current || 0) + qtyIngreso;

      // Actualizar stock: qty_current += cantidad, unit_cost = precio de esta OC (última compra)
      await client.query(
        `UPDATE stock_items
         SET qty_current = qty_current + $1,
             unit_cost   = CASE WHEN $2 > 0 THEN $2 ELSE unit_cost END,
             updated_at  = NOW()
         WHERE id=$3`,
        [qtyIngreso, precioNuevo, item.stock_item_id]
      );

      // Registrar movimiento
      await client.query(
        `INSERT INTO stock_movements (stock_item_id, tipo, qty, balance_after, ref_type, ref_id, notes, user_id)
         VALUES ($1, 'ingreso', $2, $3, 'purchase_order', $4, $5, $6)`,
        [item.stock_item_id, qtyIngreso, nuevoQty, oc.id,
         `Ingreso por OC ${oc.code}${oc.proveedor ? ' — ' + oc.proveedor : ''}`,
         req.user.id]
      );

      // Marcar el ítem de la OC como ya ingresado (idempotente por si se re-recibe)
      await client.query(
        'UPDATE purchase_order_items SET ingresado_stock=TRUE WHERE id=$1',
        [item.id]
      );

      stockIngresos.push({
        codigo: stockItem.code,
        nombre: stockItem.name,
        cantidad: qtyIngreso,
        precio_nuevo: precioNuevo,
        nuevo_stock: nuevoQty,
      });
    }

    // 3. Si la OC estaba vinculada a un vehículo, seguir generando la OT como antes
    let otId=null, otCode=null;
    if (oc.vehicle_id) {
      await client.query(`CREATE TABLE IF NOT EXISTS ot_sequence (
        dummy INTEGER PRIMARY KEY DEFAULT 1, last_val INTEGER DEFAULT 0,
        CONSTRAINT only_one CHECK (dummy=1))`);
      await client.query(`INSERT INTO ot_sequence (dummy,last_val) VALUES (1,0) ON CONFLICT DO NOTHING`);
      const seqR = await client.query(`UPDATE ot_sequence SET last_val=last_val+1 RETURNING last_val`);
      otCode = 'OT-'+String(parseInt(seqR.rows[0].last_val)).padStart(5,'0');
      const partsCost = parseFloat(oc.factura_monto||oc.total_estimado||0);
      const wo = await client.query(`INSERT INTO work_orders
        (code,vehicle_id,type,status,priority,description,reporter_id,parts_cost,labor_cost,km_at_open)
        VALUES ($1,$2,'Correctivo','Pendiente','Normal',$3,$4,$5,0,
          COALESCE((SELECT km_current FROM vehicles WHERE id=$2),0))
        RETURNING id,code`,
        [otCode, oc.vehicle_id,
         `OC ${oc.code}${oc.proveedor?' — '+oc.proveedor:''}`,
         req.user.id, partsCost]);
      otId=wo.rows[0].id; otCode=wo.rows[0].code;
      await client.query(`UPDATE work_orders SET root_cause=$1 WHERE id=$2`,
        [`Generada desde OC ${oc.code}`, otId]);
      await client.query('UPDATE purchase_orders SET ot_id=$1 WHERE id=$2', [otId, req.params.id]);
    }

    await client.query('COMMIT');
    res.json({
      ok:true,
      oc_status:'recibida',
      ot_generada: !!otId,
      ot_code: otCode,
      stock_ingresos: stockIngresos,            // array de ítems que entraron al stock
      stock_warnings: warnings,                  // array de ítems que NO entraron (sin vincular)
    });
  } catch(err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

module.exports = router;
