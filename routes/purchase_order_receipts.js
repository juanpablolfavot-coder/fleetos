// ═══════════════════════════════════════════════════════════
//  FleetOS — Recepciones parciales de OCs
//  Permite registrar entregas fraccionadas: 5 de 10 filtros, 
//  un servicio recurrente, etc.
//  
//  Quien puede recibir: dueno, gerencia, jefe_mantenimiento,
//                       paniol, contador, compras
//  
//  Flujo:
//    1. POST /api/purchase_orders/:id/recepciones → registrar entrega
//    2. GET  /api/purchase_orders/:id/recepciones → listar entregas
//    3. DELETE /api/purchase_orders/:id/recepciones/:rid → anular (solo creador)
//  
//  Side effects:
//    - Suma cantidad recibida por ítem
//    - Actualiza purchase_orders.delivery_status:
//        pendiente → todavía no llegó nada
//        parcial   → llegó algo pero no todo
//        total     → todo llegó (cantidad recibida >= cantidad pedida)
// ═══════════════════════════════════════════════════════════

const express = require('express');
const router  = express.Router({ mergeParams: true });
const { pool, query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const ROLES_RECIBIR = ['dueno','gerencia','jefe_mantenimiento','paniol','contador','compras','gerente_sucursal'];

// Destinos fijos predefinidos (el frontend les agrega las sucursales dinámicamente)
const DESTINOS_FIJOS = [
  'Depósito',
  'Pañol central',
  'Taller',
  'Obra / Edilicio',
  'Logística',
];

// ─────────────────────────────────────────────────────────────
//  Helper: columnas defensivas para bases que vienen de versiones viejas
// ─────────────────────────────────────────────────────────────
async function ensurePOReceiptStateColumns(client) {
  await client.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'pendiente'`).catch(()=>{});
  await client.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS recibido_por UUID`).catch(()=>{});
  await client.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS recibido_at TIMESTAMPTZ`).catch(()=>{});
  await client.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ`).catch(()=>{});
}

// ─────────────────────────────────────────────────────────────
//  Helper: recalcular delivery_status de la OC tras una recepción
//  y mantener sincronizado el estado principal de la OC.
//
//  Regla importante:
//  - La recepción de mercadería NO depende del pago.
//  - Si llegó todo, la OC queda status='recibida' aunque payment_status siga pendiente.
//  - Tesorería maneja payment_status por separado.
// ─────────────────────────────────────────────────────────────
async function recalcDeliveryStatus(client, poId) {
  await ensurePOReceiptStateColumns(client);
  const items = await client.query(`
    SELECT
      poi.id,
      poi.cantidad AS pedida,
      COALESCE(SUM(pori.cantidad), 0) AS recibida
    FROM purchase_order_items poi
    LEFT JOIN purchase_order_receipt_items pori ON pori.po_item_id = poi.id
    WHERE poi.po_id = $1::uuid
    GROUP BY poi.id, poi.cantidad
  `, [poId]);

  if (!items.rows.length) return 'pendiente';

  let allDone = true, anyDone = false;
  for (const it of items.rows) {
    const ped = parseFloat(it.pedida) || 0;
    const rec = parseFloat(it.recibida) || 0;
    if (rec >= ped) {
      anyDone = true;
    } else if (rec > 0) {
      anyDone = true;
      allDone = false;
    } else {
      allDone = false;
    }
  }

  let status = allDone ? 'total' : (anyDone ? 'parcial' : 'pendiente');

  // OC abierta (servicios/entregas fraccionadas): nunca se marca 'total' de forma
  // automática — se cierra a mano. Así no salta a 'recibida'/'cerrada' sola.
  const oc = await client.query(`SELECT COALESCE(is_open, FALSE) AS is_open FROM purchase_orders WHERE id=$1::uuid`, [poId]);
  if (oc.rows[0]?.is_open === true && status === 'total') {
    status = 'parcial';
  }

  await client.query(`
    WITH params AS (
      SELECT $1::varchar(20) AS delivery_status, $2::uuid AS po_id
    ), ultima_recepcion AS (
      SELECT r.received_by, r.received_at
      FROM purchase_order_receipts r
      JOIN params p ON p.po_id = r.po_id
      ORDER BY r.received_at DESC
      LIMIT 1
    )
    UPDATE purchase_orders po
    SET
      delivery_status = p.delivery_status,
      status = CASE
        WHEN p.delivery_status = 'total' AND po.status <> 'rechazada' THEN 'recibida'
        WHEN p.delivery_status <> 'total' AND po.status = 'recibida' AND COALESCE(po.payment_status,'pendiente') = 'total' THEN 'pagada'
        WHEN p.delivery_status <> 'total' AND po.status = 'recibida' THEN 'enviada_proveedor'
        ELSE po.status
      END,
      recibido_por = CASE
        WHEN p.delivery_status = 'total' THEN COALESCE(po.recibido_por, ur.received_by)
        WHEN p.delivery_status = 'pendiente' THEN NULL
        ELSE po.recibido_por
      END,
      recibido_at = CASE
        WHEN p.delivery_status = 'total' THEN COALESCE(po.recibido_at, ur.received_at)
        WHEN p.delivery_status = 'pendiente' THEN NULL
        ELSE po.recibido_at
      END,
      recibido_en = CASE
        WHEN p.delivery_status = 'total' THEN COALESCE(po.recibido_en, ur.received_at)
        WHEN p.delivery_status = 'pendiente' THEN NULL
        ELSE po.recibido_en
      END
    FROM params p
    LEFT JOIN ultima_recepcion ur ON TRUE
    WHERE po.id = p.po_id
  `, [status, poId]);

  // Auto-cierre: si pago Y entrega están en total, la OC pasa a 'cerrada' (terminal).
  await client.query(
    `UPDATE purchase_orders
        SET status = 'cerrada'
      WHERE id = $1::uuid
        AND status NOT IN ('rechazada','cerrada')
        AND COALESCE(payment_status,'pendiente') = 'total'
        AND COALESCE(delivery_status,'pendiente') = 'total'`,
    [poId]
  );

  return status;
}

// ─────────────────────────────────────────────────────────────
//  Ingreso a stock al recibir: SOLO ítems de la OC vinculados a un
//  artículo de stock (stock_item_id). Los de texto libre no tocan inventario.
//  Devuelve { ingresos: [...], warnings: [...] } para mostrar al usuario.
// ─────────────────────────────────────────────────────────────
async function ingresarStockDeRecepcion(client, items, destino, userId) {
  const ingresos = [];
  const warnings = [];
  for (const it of items) {
    const qty = parseFloat(it.cantidad);
    if (!(qty > 0)) continue;
    const poi = await client.query(
      `SELECT id, stock_item_id, descripcion FROM purchase_order_items WHERE id=$1::uuid`,
      [it.po_item_id]
    );
    const row = poi.rows[0];
    if (!row || !row.stock_item_id) continue; // ítem no vinculado a stock: no toca inventario
    const upd = await client.query(
      `UPDATE stock_items SET qty_current = qty_current + $1, updated_at = NOW()
       WHERE id = $2::uuid AND active = TRUE
       RETURNING id, name, qty_current, base_location, area, unit`,
      [qty, row.stock_item_id]
    );
    if (!upd.rows[0]) {
      warnings.push(`"${row.descripcion}": el artículo de stock vinculado no existe o está inactivo — no se ingresó.`);
      continue;
    }
    const si = upd.rows[0];
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id, base_location, area)
       VALUES ($1,'Ingreso',$2,$3,$4,$5,$6)`,
      [si.id, qty, `Recepción OC${destino ? ' · ' + destino : ''}`, userId, si.base_location, si.area]
    );
    ingresos.push({ stock_id: si.id, name: si.name, qty, new_qty: parseFloat(si.qty_current), unit: si.unit });
  }
  return { ingresos, warnings };
}

// Reversa del stock al anular una recepción: descuenta lo ingresado y deja
// un movimiento 'Egreso' de trazabilidad.
async function revertirStockDeRecepcion(client, receiptId, userId) {
  const its = await client.query(
    `SELECT pori.cantidad, poi.stock_item_id
     FROM purchase_order_receipt_items pori
     JOIN purchase_order_items poi ON poi.id = pori.po_item_id
     WHERE pori.receipt_id = $1::uuid AND poi.stock_item_id IS NOT NULL`,
    [receiptId]
  );
  for (const r of its.rows) {
    const qty = parseFloat(r.cantidad);
    if (!(qty > 0)) continue;
    const upd = await client.query(
      `UPDATE stock_items SET qty_current = GREATEST(qty_current - $1, 0), updated_at = NOW()
       WHERE id = $2::uuid
       RETURNING id, base_location, area`,
      [qty, r.stock_item_id]
    );
    if (!upd.rows[0]) continue;
    const si = upd.rows[0];
    await client.query(
      `INSERT INTO stock_movements (stock_id, type, qty, reason, user_id, base_location, area)
       VALUES ($1,'Egreso',$2,$3,$4,$5,$6)`,
      [si.id, qty, 'Anulación de recepción de OC', userId, si.base_location, si.area]
    );
  }
}

// ─────────────────────────────────────────────────────────────
//  GET /api/purchase_orders/:id/recepciones
//  Listar todas las recepciones de una OC con sus ítems
// ─────────────────────────────────────────────────────────────
router.get('/:id/recepciones', authenticate, async (req, res) => {
  try {
    const recs = await query(`
      SELECT
        r.id, r.po_id, r.received_by, r.received_at, r.destino, r.remito_nro, r.notes,
        u.name AS received_by_name
      FROM purchase_order_receipts r
      LEFT JOIN users u ON u.id = r.received_by
      WHERE r.po_id = $1::uuid
      ORDER BY r.received_at DESC
    `, [req.params.id]);

    if (!recs.rows.length) return res.json([]);

    const recIds = recs.rows.map(r => r.id);
    const items = await query(`
      SELECT
        ri.id, ri.receipt_id, ri.po_item_id, ri.cantidad, ri.notes,
        poi.descripcion, poi.unidad, poi.cantidad AS cantidad_pedida
      FROM purchase_order_receipt_items ri
      JOIN purchase_order_items poi ON poi.id = ri.po_item_id
      WHERE ri.receipt_id = ANY($1::uuid[])
    `, [recIds]);

    const itemsByRec = {};
    items.rows.forEach(it => {
      if (!itemsByRec[it.receipt_id]) itemsByRec[it.receipt_id] = [];
      itemsByRec[it.receipt_id].push(it);
    });

    const result = recs.rows.map(r => ({ ...r, items: itemsByRec[r.id] || [] }));
    res.json(result);
  } catch (err) {
    console.error('[recepciones GET]', err.message);
    res.status(500).json({ error: 'Error al listar recepciones' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/purchase_orders/:id/recepciones/aux/destinos
//  Devuelve la lista de destinos disponibles (fijos + sucursales)
// ─────────────────────────────────────────────────────────────
router.get('/:id/recepciones/aux/destinos', authenticate, async (req, res) => {
  try {
    const sucs = await query(
      `SELECT nombre FROM sucursales WHERE activo=TRUE ORDER BY nombre`
    ).catch(() => ({ rows: [] }));

    res.json({
      fijos: DESTINOS_FIJOS,
      sucursales: sucs.rows.map(s => s.nombre),
    });
  } catch (err) {
    res.json({ fijos: DESTINOS_FIJOS, sucursales: [] });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/purchase_orders/:id/items-pendientes
//  Devuelve los ítems de la OC con: pedida, recibida, pendiente
// ─────────────────────────────────────────────────────────────
router.get('/:id/items-pendientes', authenticate, async (req, res) => {
  try {
    const r = await query(`
      SELECT
        poi.id, poi.descripcion, poi.unidad,
        poi.cantidad AS pedida,
        COALESCE(SUM(pori.cantidad), 0) AS recibida,
        (poi.cantidad - COALESCE(SUM(pori.cantidad), 0)) AS pendiente
      FROM purchase_order_items poi
      LEFT JOIN purchase_order_receipt_items pori ON pori.po_item_id = poi.id
      WHERE poi.po_id = $1::uuid
      GROUP BY poi.id
      ORDER BY poi.created_at
    `, [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    console.error('[items-pendientes]', err.message);
    res.status(500).json({ error: 'Error al obtener ítems' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/purchase_orders/:id/recepciones
//  Registrar una recepción (parcial o total)
//  
//  Body: {
//    destino: 'Pañol central',
//    remito_nro: 'R-12345',
//    notes: 'Llegaron 5 de 10 filtros',
//    items: [
//      { po_item_id: 'uuid', cantidad: 5, notes: '' },
//      { po_item_id: 'uuid', cantidad: 3 }
//    ]
//  }
// ─────────────────────────────────────────────────────────────
router.post('/:id/recepciones', authenticate, requireRole(...ROLES_RECIBIR), async (req, res) => {
  const client = await pool.connect();
  try {
    const { destino, remito_nro, notes, items } = req.body;

    if (!destino || !destino.trim()) {
      return res.status(400).json({ error: 'Falta el destino de la mercadería' });
    }
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Tenés que indicar al menos un ítem recibido' });
    }
    for (const it of items) {
      if (!it.po_item_id) return res.status(400).json({ error: 'Falta po_item_id' });
      if (!(parseFloat(it.cantidad) > 0)) return res.status(400).json({ error: 'Cantidad inválida' });
    }

    await client.query('BEGIN');
    await ensurePOReceiptStateColumns(client);

    // Verificar que la OC exista y esté en estado válido
    const po = await client.query(
      `SELECT id, status, COALESCE(is_open, FALSE) AS is_open FROM purchase_orders WHERE id=$1::uuid FOR UPDATE`,
      [req.params.id]
    );
    if (!po.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }
    const ocAbierta = po.rows[0].is_open === true;
    // Estados finales: nunca se recibe. 'recibida' bloquea SALVO que la OC sea abierta
    // (servicios/entregas fraccionadas que se descuentan progresivamente).
    if (['rechazada','cerrada'].includes(po.rows[0].status) ||
        (po.rows[0].status === 'recibida' && !ocAbierta)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `No se puede recibir una OC ${po.rows[0].status}` });
    }
    // Gate: no se puede recibir una OC que todavía no fue enviada al proveedor.
    if (['pendiente_cotizacion','en_cotizacion','aprobada_compras'].includes(po.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No se puede recibir: la OC todavía no fue enviada al proveedor' });
    }

    // Validar que los ítems pertenecen a la OC y que no exceden la cantidad pendiente
    const pendientes = await client.query(`
      SELECT
        poi.id, poi.cantidad AS pedida,
        COALESCE(SUM(pori.cantidad), 0) AS recibida
      FROM purchase_order_items poi
      LEFT JOIN purchase_order_receipt_items pori ON pori.po_item_id = poi.id
      WHERE poi.po_id = $1::uuid
      GROUP BY poi.id
    `, [req.params.id]);

    const pendByItem = {};
    pendientes.rows.forEach(p => {
      pendByItem[p.id] = parseFloat(p.pedida) - parseFloat(p.recibida);
    });

    for (const it of items) {
      if (!(it.po_item_id in pendByItem)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `El ítem ${it.po_item_id} no pertenece a esta OC` });
      }
      // En OC abiertas (servicios fraccionados) se permiten cantidades libres,
      // incluso por encima de lo "pendiente". En OC normales se respeta el tope.
      if (!ocAbierta && parseFloat(it.cantidad) > pendByItem[it.po_item_id] + 0.001) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Estás recibiendo más cantidad de la pendiente para uno de los ítems (pendiente: ${pendByItem[it.po_item_id]})`
        });
      }
    }

    // Crear cabecera de recepción
    const recCab = await client.query(`
      INSERT INTO purchase_order_receipts (po_id, received_by, destino, remito_nro, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, po_id, received_by, received_at, destino, remito_nro, notes
    `, [req.params.id, req.user.id, destino.trim(), (remito_nro || '').trim() || null, (notes || '').trim() || null]);

    const receiptId = recCab.rows[0].id;

    // Insertar ítems
    for (const it of items) {
      await client.query(`
        INSERT INTO purchase_order_receipt_items (receipt_id, po_item_id, cantidad, notes)
        VALUES ($1, $2, $3, $4)
      `, [receiptId, it.po_item_id, parseFloat(it.cantidad), (it.notes || '').trim() || null]);
    }

    // Ingreso a stock (solo ítems vinculados a un artículo de stock)
    const { ingresos: stock_ingresos, warnings: stock_warnings } =
      await ingresarStockDeRecepcion(client, items, destino.trim(), req.user.id);

    // Recalcular delivery_status
    const newStatus = await recalcDeliveryStatus(client, req.params.id);

    await client.query('COMMIT');

    const baseMsg = newStatus === 'total'
      ? 'Recepción registrada. Mercadería recibida en su totalidad.'
      : 'Recepción registrada (parcial).';
    const stockMsg = stock_ingresos.length ? ` ${stock_ingresos.length} ítem(s) ingresado(s) a stock.` : '';
    res.status(201).json({
      ...recCab.rows[0],
      delivery_status: newStatus,
      stock_ingresos,
      stock_warnings,
      message: baseMsg + stockMsg
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[recepciones POST]', err.message);
    res.status(500).json({ error: 'Error al registrar recepción' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  DELETE /api/purchase_orders/:id/recepciones/:rid
//  Anular una recepción (solo el que la creó o dueno/gerencia)
// ─────────────────────────────────────────────────────────────
router.delete('/:id/recepciones/:rid', authenticate, requireRole(...ROLES_RECIBIR), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensurePOReceiptStateColumns(client);

    const rec = await client.query(
      `SELECT id, received_by FROM purchase_order_receipts WHERE id=$1::uuid AND po_id=$2::uuid FOR UPDATE`,
      [req.params.rid, req.params.id]
    );
    if (!rec.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Recepción no encontrada' });
    }

    // Solo el creador o dueno/gerencia puede anular
    if (!['dueno','gerencia'].includes(req.user.role) && rec.rows[0].received_by !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Solo podés anular recepciones que vos cargaste' });
    }

    // Revertir el stock que esta recepción había ingresado (antes de borrar sus ítems)
    await revertirStockDeRecepcion(client, req.params.rid, req.user.id);
    await client.query(`DELETE FROM purchase_order_receipts WHERE id=$1::uuid`, [req.params.rid]);
    await recalcDeliveryStatus(client, req.params.id);

    await client.query('COMMIT');
    res.json({ ok: true, message: 'Recepción anulada (stock revertido)' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[recepciones DELETE]', err.message);
    res.status(500).json({ error: 'Error al anular recepción' });
  } finally {
    client.release();
  }
});

module.exports = router;
