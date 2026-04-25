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

const ROLES_RECIBIR = ['dueno','gerencia','jefe_mantenimiento','paniol','contador','compras'];

// Destinos fijos predefinidos (el frontend les agrega las sucursales dinámicamente)
const DESTINOS_FIJOS = [
  'Pañol central',
  'Taller',
  'Obra / Edilicio',
  'Logística',
];

// ─────────────────────────────────────────────────────────────
//  Helper: recalcular delivery_status de la OC tras una recepción
// ─────────────────────────────────────────────────────────────
async function recalcDeliveryStatus(client, poId) {
  const items = await client.query(`
    SELECT
      poi.id,
      poi.cantidad AS pedida,
      COALESCE(SUM(pori.cantidad), 0) AS recibida
    FROM purchase_order_items poi
    LEFT JOIN purchase_order_receipt_items pori ON pori.po_item_id = poi.id
    WHERE poi.po_id = $1
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

  const status = allDone ? 'total' : (anyDone ? 'parcial' : 'pendiente');

  await client.query(
    `UPDATE purchase_orders SET delivery_status = $1 WHERE id = $2`,
    [status, poId]
  );

  return status;
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
      WHERE r.po_id = $1
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
      WHERE ri.receipt_id = ANY($1)
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
      `SELECT nombre FROM sucursales WHERE active=TRUE ORDER BY nombre`
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
      WHERE poi.po_id = $1
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

    // Verificar que la OC exista y esté en estado válido
    const po = await client.query(
      `SELECT id, status FROM purchase_orders WHERE id=$1 FOR UPDATE`,
      [req.params.id]
    );
    if (!po.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }
    if (['rechazada','recibida'].includes(po.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `No se puede recibir una OC ${po.rows[0].status}` });
    }

    // Validar que los ítems pertenecen a la OC y que no exceden la cantidad pendiente
    const pendientes = await client.query(`
      SELECT
        poi.id, poi.cantidad AS pedida,
        COALESCE(SUM(pori.cantidad), 0) AS recibida
      FROM purchase_order_items poi
      LEFT JOIN purchase_order_receipt_items pori ON pori.po_item_id = poi.id
      WHERE poi.po_id = $1
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
      if (parseFloat(it.cantidad) > pendByItem[it.po_item_id] + 0.001) {
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

    // Recalcular delivery_status
    const newStatus = await recalcDeliveryStatus(client, req.params.id);

    await client.query('COMMIT');

    res.status(201).json({
      ...recCab.rows[0],
      delivery_status: newStatus,
      message: newStatus === 'total'
        ? 'Recepción registrada. Mercadería recibida en su totalidad.'
        : 'Recepción registrada (parcial).'
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

    const rec = await client.query(
      `SELECT id, received_by FROM purchase_order_receipts WHERE id=$1 AND po_id=$2 FOR UPDATE`,
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

    await client.query(`DELETE FROM purchase_order_receipts WHERE id=$1`, [req.params.rid]);
    await recalcDeliveryStatus(client, req.params.id);

    await client.query('COMMIT');
    res.json({ ok: true, message: 'Recepción anulada' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[recepciones DELETE]', err.message);
    res.status(500).json({ error: 'Error al anular recepción' });
  } finally {
    client.release();
  }
});

module.exports = router;
