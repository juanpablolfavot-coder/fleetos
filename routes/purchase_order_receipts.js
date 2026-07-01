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

// Seguridad: un gerente_sucursal solo puede operar recepciones de OCs de SU sucursal.
// Devuelve null si está OK, o { status, error } si hay que cortar.
// `runner` es query (lecturas) o client.query.bind(client) (dentro de transacción).
async function checkSucursalScope(runner, poId, req) {
  if (req.user?.role !== 'gerente_sucursal') return null; // otros roles no se restringen acá
  const r = await runner(`SELECT sucursal FROM purchase_orders WHERE id=$1::uuid`, [poId]);
  if (!r.rows[0]) return { status: 404, error: 'OC no encontrada' };
  const sucUser = String(req.user.sucursal || '').trim().toLowerCase();
  const sucOC   = String(r.rows[0].sucursal || '').trim().toLowerCase();
  if (!sucUser || !sucOC || sucUser !== sucOC) {
    return { status: 403, error: 'Solo podés operar recepciones de OCs de tu sucursal' };
  }
  return null;
}

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
let _poReceiptColsEnsured = false;
async function ensurePOReceiptStateColumns(_client) {
  // Memoizado: corre una sola vez por proceso. El DDL va por el pool (autocommit),
  // no por la transacción del caller: así, aunque la recepción haga ROLLBACK, las
  // columnas ya quedaron creadas y el memo es seguro. Solo se memoiza si tuvo éxito.
  if (_poReceiptColsEnsured) return;
  try {
    await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'pendiente'`);
    await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS recibido_por UUID`);
    await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS recibido_at TIMESTAMPTZ`);
    await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ`);
    _poReceiptColsEnsured = true;
  } catch (e) {
    console.warn('[ensurePOReceiptStateColumns]', e.message);
  }
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
//  Stock: ingreso al recibir, contra el CATÁLOGO NUEVO (stock_catalog +
//  stock_balances). Solo entran los ítems que el usuario TILDÓ "ingresar al
//  stock" (it.to_stock). Cada uno se vincula a un artículo existente
//  (it.catalog_id) o crea uno nuevo (it.new_article). La ubicación es
//  sucursal/área (it.base_location / it.area). Se guarda el vínculo en el
//  ítem recibido para poder revertirlo si se anula la recepción.
// ─────────────────────────────────────────────────────────────
const CAT_PREFIJOS = { lubricantes: 'LUB', electrico: 'ELE', filtros: 'FIL', general: 'GEN', palet: 'PAL', frenos: 'FRE' };
function _stripAccents(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function categoryPrefix(cat) {
  const k = _stripAccents(cat).trim().toLowerCase();
  return CAT_PREFIJOS[k] || (_stripAccents(cat).replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'GEN');
}
async function nextCatalogCode(client, category) {
  const prefix = categoryPrefix(category);
  const r = await client.query(`SELECT code FROM stock_catalog WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`, [prefix + '-%']);
  let n = 0;
  if (r.rows[0]) { const m = /(\d+)$/.exec(r.rows[0].code); if (m) n = parseInt(m[1], 10); }
  return `${prefix}-${String(n + 1).padStart(3, '0')}`;
}

let _catalogReadyRcp = false;
async function ensureCatalogForReceipts() {
  if (_catalogReadyRcp) return;
  try {
    await query(`CREATE TABLE IF NOT EXISTS stock_catalog (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      code VARCHAR(50) UNIQUE NOT NULL, name VARCHAR(200) NOT NULL,
      category VARCHAR(100) NOT NULL DEFAULT 'General', unit VARCHAR(20) NOT NULL DEFAULT 'un',
      qty_min NUMERIC(10,2) NOT NULL DEFAULT 0, qty_reorder NUMERIC(10,2) NOT NULL DEFAULT 0,
      unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0, supplier VARCHAR(200),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await query(`CREATE TABLE IF NOT EXISTS stock_balances (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      catalog_id UUID NOT NULL REFERENCES stock_catalog(id) ON DELETE CASCADE,
      base_location VARCHAR(200) NOT NULL, area VARCHAR(100) NOT NULL,
      qty_current NUMERIC(10,2) NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (catalog_id, base_location, area))`);
    await query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS catalog_id UUID`).catch(() => {});
    await query(`ALTER TABLE stock_movements ALTER COLUMN stock_id DROP NOT NULL`).catch(() => {});
    // Vínculo en el ítem recibido para revertir el ingreso al anular la recepción.
    await query(`ALTER TABLE purchase_order_receipt_items ADD COLUMN IF NOT EXISTS catalog_id UUID`).catch(() => {});
    await query(`ALTER TABLE purchase_order_receipt_items ADD COLUMN IF NOT EXISTS stock_base_location VARCHAR(200)`).catch(() => {});
    await query(`ALTER TABLE purchase_order_receipt_items ADD COLUMN IF NOT EXISTS stock_area VARCHAR(100)`).catch(() => {});
    _catalogReadyRcp = true;
  } catch (e) { console.warn('[ensureCatalogForReceipts]', e.message); }
}

async function ingresarStockDeRecepcion(client, receiptId, items, destino, userId) {
  await ensureCatalogForReceipts();
  const ingresos = [];
  const warnings = [];
  for (const it of items) {
    if (!it.to_stock) continue; // solo los tildados
    const qty = parseFloat(it.cantidad);
    if (!(qty > 0)) continue;
    const poi = await client.query(
      `SELECT id, descripcion, unidad, precio_unit FROM purchase_order_items WHERE id=$1::uuid`, [it.po_item_id]);
    const row = poi.rows[0];
    if (!row) continue;

    // 1) Resolver el artículo del catálogo: existente o nuevo.
    let catalogId = null, artName = null, unit = row.unidad || 'un';
    if (it.catalog_id) {
      const c = await client.query(`SELECT id, name, unit FROM stock_catalog WHERE id=$1::uuid AND active=TRUE`, [it.catalog_id]);
      if (!c.rows[0]) { warnings.push(`"${row.descripcion}": el artículo elegido no existe — no se ingresó.`); continue; }
      catalogId = c.rows[0].id; artName = c.rows[0].name; unit = c.rows[0].unit || unit;
    } else if (it.new_article && String(it.new_article.name || row.descripcion || '').trim()) {
      const na = it.new_article || {};
      const name = String(na.name || row.descripcion).trim();
      const category = String(na.category || 'General').trim() || 'General';
      const u = String(na.unit || unit || 'un').trim() || 'un';
      // Costo del artículo nuevo: el que cargó el usuario, o si no, el precio de la OC.
      const cost = Math.max(0, parseFloat(na.unit_cost) > 0 ? parseFloat(na.unit_cost) : (parseFloat(row.precio_unit) || 0));
      try {
        const code = await nextCatalogCode(client, category);
        const ins = await client.query(
          `INSERT INTO stock_catalog (code, name, category, unit, unit_cost) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, unit`,
          [code, name, category, u, cost]);
        catalogId = ins.rows[0].id; artName = ins.rows[0].name; unit = ins.rows[0].unit;
      } catch (e) { warnings.push(`"${row.descripcion}": no se pudo crear el artículo (${e.message}).`); continue; }
    } else {
      warnings.push(`"${row.descripcion}": marcado para stock pero sin artículo — no se ingresó.`); continue;
    }

    // 2) Sumar saldo en la ubicación elegida + movimiento + vínculo para reversa.
    const base_location = String(it.base_location || 'Central').trim() || 'Central';
    const area = String(it.area || 'Depósito').trim() || 'Depósito';
    const upd = await client.query(
      `INSERT INTO stock_balances (catalog_id, base_location, area, qty_current) VALUES ($1,$2,$3,$4)
       ON CONFLICT (catalog_id, base_location, area)
       DO UPDATE SET qty_current = stock_balances.qty_current + EXCLUDED.qty_current, updated_at = NOW()
       RETURNING qty_current`,
      [catalogId, base_location, area, qty]);
    await client.query(
      `INSERT INTO stock_movements (catalog_id, type, qty, reason, user_id, base_location, area)
       VALUES ($1,'Ingreso',$2,$3,$4,$5,$6)`,
      [catalogId, qty, `Recepción OC${destino ? ' · ' + destino : ''}`, userId, base_location, area]);
    await client.query(
      `UPDATE purchase_order_receipt_items SET catalog_id=$1, stock_base_location=$2, stock_area=$3
       WHERE receipt_id=$4::uuid AND po_item_id=$5::uuid`,
      [catalogId, base_location, area, receiptId, it.po_item_id]);
    await client.query(`UPDATE purchase_order_items SET ingresado_stock = TRUE WHERE id=$1::uuid`, [it.po_item_id]).catch(() => {});
    ingresos.push({ catalog_id: catalogId, name: artName, qty, new_qty: parseFloat(upd.rows[0].qty_current), unit, base_location, area });
  }
  return { ingresos, warnings };
}

// Reversa del stock al anular una recepción: descuenta lo ingresado y deja
// un movimiento 'Egreso' de trazabilidad.
async function revertirStockDeRecepcion(client, receiptId, userId) {
  await ensureCatalogForReceipts();
  const its = await client.query(
    `SELECT cantidad, catalog_id, stock_base_location, stock_area
     FROM purchase_order_receipt_items
     WHERE receipt_id = $1::uuid AND catalog_id IS NOT NULL`,
    [receiptId]
  );
  for (const r of its.rows) {
    const qty = parseFloat(r.cantidad);
    if (!(qty > 0)) continue;
    // Descontar solo lo que realmente hay y registrar el movimiento por ESE monto.
    // Antes el saldo se recortaba con GREATEST(...,0) pero el Egreso se anotaba por
    // la cantidad completa: si parte del stock ya se había consumido, los saldos y
    // los movimientos dejaban de cuadrar en silencio.
    const bal = await client.query(
      `SELECT qty_current FROM stock_balances
       WHERE catalog_id = $1 AND base_location = $2 AND area = $3 FOR UPDATE`,
      [r.catalog_id, r.stock_base_location, r.stock_area]
    );
    const disponible = bal.rows[0] ? parseFloat(bal.rows[0].qty_current) : 0;
    const descontado = Math.min(disponible, qty);
    if (descontado > 0) {
      await client.query(
        `UPDATE stock_balances SET qty_current = qty_current - $1, updated_at = NOW()
         WHERE catalog_id = $2 AND base_location = $3 AND area = $4`,
        [descontado, r.catalog_id, r.stock_base_location, r.stock_area]
      );
      const faltante = qty - descontado;
      await client.query(
        `INSERT INTO stock_movements (catalog_id, type, qty, reason, user_id, base_location, area)
         VALUES ($1,'Egreso',$2,$3,$4,$5,$6)`,
        [r.catalog_id, descontado,
         faltante > 0.001
           ? `Anulación de recepción de OC (recibidas ${qty}, en stock solo ${descontado}: el resto ya se consumió)`
           : 'Anulación de recepción de OC',
         userId, r.stock_base_location, r.stock_area]
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  GET /api/purchase_orders/:id/recepciones
//  Listar todas las recepciones de una OC con sus ítems
// ─────────────────────────────────────────────────────────────
router.get('/:id/recepciones', authenticate, async (req, res) => {
  try {
    const scopeErr = await checkSucursalScope(query, req.params.id, req);
    if (scopeErr) return res.status(scopeErr.status).json({ error: scopeErr.error });
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
    const scopeErr = await checkSucursalScope(query, req.params.id, req);
    if (scopeErr) return res.status(scopeErr.status).json({ error: scopeErr.error });
    const r = await query(`
      SELECT
        poi.id, poi.descripcion, poi.unidad, poi.precio_unit,
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

    // IMPORTANTE: asegurar el esquema del catálogo (ALTER TABLE) ANTES del BEGIN.
    // Si corre dentro de la transacción, el ALTER sobre purchase_order_receipt_items
    // choca con el lock que la propia transacción tiene sobre esa tabla y se cuelga.
    await ensureCatalogForReceipts();
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
    const scopeErr = await checkSucursalScope(client.query.bind(client), req.params.id, req);
    if (scopeErr) { await client.query('ROLLBACK'); return res.status(scopeErr.status).json({ error: scopeErr.error }); }
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

    // Ingreso a stock (solo ítems tildados "ingresar al stock")
    const { ingresos: stock_ingresos, warnings: stock_warnings } =
      await ingresarStockDeRecepcion(client, receiptId, items, destino.trim(), req.user.id);

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
    // IMPORTANTE: asegurar el esquema del catálogo (ALTER TABLE) ANTES del BEGIN.
    // Si corre dentro de la transacción, el ALTER sobre purchase_order_receipt_items
    // choca con el lock que la propia transacción tiene sobre esa tabla y se cuelga.
    await ensureCatalogForReceipts();
    await client.query('BEGIN');
    await ensurePOReceiptStateColumns(client);

    const scopeErr = await checkSucursalScope(client.query.bind(client), req.params.id, req);
    if (scopeErr) { await client.query('ROLLBACK'); return res.status(scopeErr.status).json({ error: scopeErr.error }); }

    // No se puede anular una recepción si la OC está en estado final: anularla
    // revertiría stock/entrega y dejaría la OC inconsistente. Hay que reabrirla primero.
    const ocEstado = await client.query('SELECT status FROM purchase_orders WHERE id=$1::uuid', [req.params.id]);
    if (['cerrada','rechazada'].includes(ocEstado.rows[0]?.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `La OC está ${ocEstado.rows[0].status}. Reabrila antes de anular una recepción.` });
    }

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
