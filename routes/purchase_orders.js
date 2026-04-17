// ═══════════════════════════════════════════════════════════
//  FleetOS — Órdenes de Compra
// ═══════════════════════════════════════════════════════════
const router   = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

async function ensureTables() {
  await query(`CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'borrador',
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
  await query(`CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL, cantidad NUMERIC(10,2) DEFAULT 1,
    unidad VARCHAR(20) DEFAULT 'un', precio_unit NUMERIC(14,2) DEFAULT 0,
    subtotal NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * precio_unit) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(()=>{});
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
    const po = await query(`SELECT po.*, u.name as solicitante_nombre, v.code as vehicle_code, v.plate as vehicle_plate FROM purchase_orders po LEFT JOIN users u ON u.id = po.requested_by LEFT JOIN vehicles v ON v.id = po.vehicle_id WHERE po.id = $1`, [req.params.id]);
    if (!po.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    const items = await query('SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY created_at', [req.params.id]);
    res.json({ ...po.rows[0], items: items.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), async (req, res) => {
  try {
    const { notes, sucursal, area, tipo='flota', vehicle_id, iva_pct=0, items=[], forma_pago, cc_dias, moneda } = req.body;
    if (!items.length) return res.status(400).json({ error: 'La OC debe tener al menos un artículo' });
    const code = await nextOCCode();
    const subtotal = items.reduce((a,i) => a + (parseFloat(i.cantidad||1) * parseFloat(i.precio_unit||0)), 0);
    const total = subtotal * (1 + parseFloat(iva_pct||0) / 100);
    const _fp = (forma_pago === 'contado' || forma_pago === 'cuenta_corriente') ? forma_pago : null;
    const _cc = (_fp === 'cuenta_corriente' && cc_dias != null && cc_dias !== '') ? parseInt(cc_dias, 10) : null;
    const _mon = (moneda === 'USD') ? 'USD' : 'ARS';
    const po = await query(`INSERT INTO purchase_orders (code,status,requested_by,sucursal,area,tipo,vehicle_id,notes,iva_pct,total_estimado,forma_pago,cc_dias,moneda) VALUES ($1,'borrador',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [code,req.user.id,sucursal||null,area||null,tipo||'flota',vehicle_id||null,notes||null,parseFloat(iva_pct||0),total,_fp,_cc,_mon]);
    const poId = po.rows[0].id;
    for (const item of items) {
      if (!item.descripcion?.trim()) continue;
      await query(`INSERT INTO purchase_order_items (po_id,descripcion,cantidad,unidad,precio_unit) VALUES ($1,$2,$3,$4,$5)`,
        [poId,item.descripcion.trim(),parseFloat(item.cantidad||1),item.unidad||'un',parseFloat(item.precio_unit||0)]);
    }
    const full = await query('SELECT * FROM purchase_orders WHERE id=$1',[poId]);
    const itemsResult = await query('SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at',[poId]);
    res.status(201).json({ ...full.rows[0], items: itemsResult.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), async (req, res) => {
  try {
    const { proveedor,factura_nro,factura_fecha,factura_monto,notes,status,sucursal,area,iva_pct,tipo,vehicle_id,forma_pago,cc_dias,moneda } = req.body;
    const valid_status = ['borrador','emitida','en_curso','recibida','cancelada'];
    if (status && !valid_status.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
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
    if (!items.length) return res.status(400).json({ error: 'Debe haber al menos un artículo' });
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
    if (check.rows[0].status !== 'borrador' && req.user.role !== 'dueno') return res.status(409).json({ error: 'Solo se pueden eliminar OCs en borrador' });
    await query('DELETE FROM purchase_orders WHERE id=$1',[req.params.id]);
    res.json({ ok:true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/recibir', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    const po = await client.query(`SELECT po.*,v.code as vehicle_code,
      json_agg(json_build_object('descripcion',poi.descripcion,'cantidad',poi.cantidad,
        'unidad',poi.unidad,'precio_unit',poi.precio_unit,'subtotal',poi.subtotal)) as items
      FROM purchase_orders po
      LEFT JOIN vehicles v ON v.id=po.vehicle_id
      LEFT JOIN purchase_order_items poi ON poi.po_id=po.id
      WHERE po.id=$1 GROUP BY po.id,v.code`,[req.params.id]);
    if (!po.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    const oc = po.rows[0];
    if (oc.status === 'recibida') return res.status(409).json({ error: 'La OC ya fue recibida' });
    await client.query('BEGIN');
    await client.query("UPDATE purchase_orders SET status='recibida' WHERE id=$1",[req.params.id]);
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
        VALUES ($1,$2,'Correctivo','Cerrada','Normal',$3,$4,$5,0,
          COALESCE((SELECT km_current FROM vehicles WHERE id=$2),0))
        RETURNING id,code`,
        [otCode,oc.vehicle_id,
         `OC ${oc.code}${oc.proveedor?' — '+oc.proveedor:''}`,
         req.user.id,partsCost]);
      otId=wo.rows[0].id; otCode=wo.rows[0].code;
      await client.query(`UPDATE work_orders SET closed_at=NOW(),root_cause=$1 WHERE id=$2`,
        [`Generada desde OC ${oc.code}`,otId]);
      await client.query('UPDATE purchase_orders SET ot_id=$1 WHERE id=$2',[otId,req.params.id]);
    }
    await client.query('COMMIT');
    res.json({ ok:true, oc_status:'recibida', ot_generada:!!otId, ot_code:otCode });
  } catch(err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

module.exports = router;
