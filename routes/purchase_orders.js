// ═══════════════════════════════════════════════════════════
//  FleetOS — Órdenes de Compra (workflow profesional 6 estados)
//
//  Flujo:
//   1. pendiente_cotizacion → Jefe Mant creó la OC, sin precios
//   2. en_cotizacion        → Compras la tomó y está cotizando
//   3. aprobada_compras     → Compras aprobó con precio/proveedor
//   4. pagada               → Tesorería confirmó el pago
//   5. recibida             → Jefe Mant confirma que llegó la mercadería
//   6. rechazada            → Cualquiera la canceló (estado final)
//
//  Visibilidad por rol:
//   - dueno/gerencia: TODO
//   - jefe_mantenimiento: solo las que él creó, SIN precios en respuesta
//   - compras: desde pendiente_cotizacion en adelante
//   - tesoreria: desde aprobada_compras en adelante
//   - contador/auditor: solo pagada y recibida (históricas)
// ═══════════════════════════════════════════════════════════

const router   = require('express').Router();
const { pool, query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { mailEnabled, sendMail } = require('../services/mailer');
const { buildOCPdf } = require('../services/oc-pdf');

// ─────────────────────────────────────────────────────────────
//  Email de la OC al proveedor (al marcarla "Enviada al proveedor").
//  Best-effort: NUNCA debe romper el flujo de la OC. Si no hay SMTP
//  configurado o el proveedor no tiene email cargado, se saltea en silencio.
// ─────────────────────────────────────────────────────────────
async function enviarOCAlProveedor(poId) {
  if (!mailEnabled()) { console.log('[OC email] SMTP no configurado — no se envía'); return; }
  const r = await query(`
    SELECT po.*, s.name AS supplier_name, s.email AS supplier_email, s.cuit AS supplier_cuit
    FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = $1`, [poId]);
  const oc = r.rows[0];
  if (!oc) return;
  const to = (oc.supplier_email || '').trim();
  if (!to) { console.log(`[OC email] OC ${oc.code}: el proveedor no tiene email cargado — no se envía`); return; }

  const itemsRes = await query(
    `SELECT descripcion, cantidad, unidad, precio_unit FROM purchase_order_items WHERE po_id = $1 ORDER BY id`, [poId]);
  const items = itemsRes.rows;
  const supplier = { name: oc.supplier_name, email: oc.supplier_email, cuit: oc.supplier_cuit };

  const pdf = await buildOCPdf(oc, items, supplier);

  const sym = oc.moneda === 'USD' ? 'US$' : '$';
  const total = (Number(oc.total_estimado) || items.reduce((a, i) => a + (Number(i.cantidad) || 0) * (Number(i.precio_unit) || 0), 0));
  const totalFmt = sym + total.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Casilla automática: pedimos NO responder. Si hay un contacto de consultas
  // configurado (OC_EMAIL_REPLYTO), lo ofrecemos como destino para dudas.
  const contacto = process.env.OC_EMAIL_REPLYTO
    ? `Para consultas, escribir a ${process.env.OC_EMAIL_REPLYTO}.`
    : '';

  await sendMail({
    to,
    bcc: process.env.OC_EMAIL_BCC || undefined,
    replyTo: process.env.OC_EMAIL_REPLYTO || undefined,
    subject: `Orden de Compra ${oc.code} — Expreso Biletta`,
    text:
      `Estimados de ${supplier.name || 'proveedor'},\n\n` +
      `Adjuntamos la Orden de Compra ${oc.code}.\n` +
      `Ítems: ${items.length} · Total estimado: ${totalFmt}` +
      `${oc.forma_pago ? ` · Forma de pago: ${oc.forma_pago}${oc.cc_dias ? ` (${oc.cc_dias} días)` : ''}` : ''}\n\n` +
      `Este es un correo automático, por favor no responder a esta dirección.${contacto ? '\n' + contacto : ''}\n\nExpreso Biletta S.R.L.`,
    html:
      `<p>Estimados de <b>${escapeHtmlMail(supplier.name || 'proveedor')}</b>,</p>` +
      `<p>Adjuntamos la <b>Orden de Compra ${escapeHtmlMail(oc.code)}</b>.</p>` +
      `<ul>` +
        `<li>Ítems: ${items.length}</li>` +
        `<li>Total estimado: <b>${totalFmt}</b></li>` +
        (oc.forma_pago ? `<li>Forma de pago: ${escapeHtmlMail(oc.forma_pago)}${oc.cc_dias ? ` (${oc.cc_dias} días)` : ''}</li>` : '') +
      `</ul>` +
      (contacto ? `<p>${escapeHtmlMail(contacto)}</p>` : '') +
      `<p style="color:#6b7280;font-size:12px">⚠ Este es un correo automático, por favor no responder a esta dirección.<br>Expreso Biletta S.R.L. · enviado automáticamente por FleetOS</p>`,
    attachments: [{ filename: `OC-${oc.code}.pdf`, content: pdf, contentType: 'application/pdf' }],
  });
  console.log(`[OC email] OC ${oc.code} enviada a ${to}`);
}

function escapeHtmlMail(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ─────────────────────────────────────────────────────────────
//  Migración / creación de tablas + columnas nuevas del workflow
// ─────────────────────────────────────────────────────────────
async function ensureTables() {
  await query(`CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    status VARCHAR(30) DEFAULT 'pendiente_cotizacion',
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

  // Columnas antiguas que pueden faltar
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id UUID`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS asset_id UUID`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(30)`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cc_dias INTEGER`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS prioridad VARCHAR(20) DEFAULT 'Normal'`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS moneda VARCHAR(10)`).catch(()=>{});

  // ── NUEVAS COLUMNAS DEL WORKFLOW ──
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS presupuesto_imagen TEXT`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS presupuesto_monto_estimado NUMERIC(14,2)`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cotizado_por UUID REFERENCES users(id)`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cotizado_at TIMESTAMPTZ`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS aprobado_compras_por UUID REFERENCES users(id)`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS aprobado_compras_at TIMESTAMPTZ`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS pagado_por UUID REFERENCES users(id)`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS pagado_at TIMESTAMPTZ`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS recibido_por UUID REFERENCES users(id)`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS recibido_at TIMESTAMPTZ`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'pendiente'`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(20) DEFAULT 'pendiente'`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pendiente'`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS rechazado_por UUID REFERENCES users(id)`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS is_open BOOLEAN DEFAULT FALSE`).catch(()=>{});

  // Reparación defensiva: si una OC ya tiene recepción total registrada,
  // debe quedar recibida aunque todavía no esté pagada.
  // La recepción y el pago son circuitos separados.
  await query(`
    WITH ult_recepcion AS (
      SELECT DISTINCT ON (po_id) po_id, received_by, received_at
      FROM purchase_order_receipts
      ORDER BY po_id, received_at DESC
    )
    UPDATE purchase_orders po
    SET
      status = 'recibida',
      delivery_status = 'total',
      recibido_por = COALESCE(po.recibido_por, ult_recepcion.received_by),
      recibido_at = COALESCE(po.recibido_at, ult_recepcion.received_at),
      recibido_en = COALESCE(po.recibido_en, ult_recepcion.received_at)
    FROM ult_recepcion
    WHERE po.id = ult_recepcion.po_id
      AND COALESCE(po.status, '') NOT IN ('recibida','rechazada','cerrada')
      AND COALESCE(po.is_open, FALSE) = FALSE
      AND COALESCE(po.delivery_status, '') = 'total'
  `).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS rechazado_at TIMESTAMPTZ`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT`).catch(()=>{});

  // ── Columnas para el flujo de DEVOLUCIÓN (devolver a etapa anterior) ──
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS motivo_devolucion TEXT`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS devuelto_por UUID REFERENCES users(id)`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS devuelto_at TIMESTAMPTZ`).catch(()=>{});

  await query(`CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL, cantidad NUMERIC(10,2) DEFAULT 1,
    unidad VARCHAR(20) DEFAULT 'un', precio_unit NUMERIC(14,2) DEFAULT 0,
    subtotal NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * precio_unit) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(()=>{});
  await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS stock_item_id UUID`).catch(()=>{});
  await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS work_order_part_id UUID`).catch(()=>{});
  await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS ingresado_stock BOOLEAN DEFAULT FALSE`).catch(()=>{});
  // Proveedor por ítem (Compras lo asigna en la OC consolidada de una OT, para
  // después dividir en una OC por proveedor — etapas 2 y 3 del circuito).
  await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS supplier_id UUID`).catch(()=>{});
  // OC madre de la que salió esta OC al dividir por proveedor (etapa 3). La OC
  // madre queda en estado 'dividida' y cada hija apunta a ella para trazabilidad.
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS split_parent_id UUID`).catch(()=>{});

  // Índices para que el listado de OC no se vuelva lento cuando crecen las órdenes.
  await query(`CREATE INDEX IF NOT EXISTS idx_po_created_at ON purchase_orders(created_at DESC)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_po_status_created ON purchase_orders(status, created_at DESC)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_po_sucursal_created ON purchase_orders(sucursal, created_at DESC)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_po_area_created ON purchase_orders(area, created_at DESC)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_po_requested_created ON purchase_orders(requested_by, created_at DESC)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_po_payment_status_created ON purchase_orders(payment_status, created_at DESC)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_po_invoice_status_created ON purchase_orders(invoice_status, created_at DESC)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_po_delivery_status_created ON purchase_orders(delivery_status, created_at DESC)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_poi_po_fast ON purchase_order_items(po_id)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_poi_work_order_part ON purchase_order_items(work_order_part_id)`).catch(()=>{});

  // Backfill seguro: si ya hay OCs aprobadas desde OT, reflejar sus precios en la OT.
  // No toca OCs pendientes de cotización ni en cotización.
  await query(`
    UPDATE work_order_parts wop
    SET unit_cost = poi.precio_unit,
        unit = COALESCE(NULLIF(wop.unit,''), poi.unidad)
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.po_id
    WHERE poi.work_order_part_id = wop.id
      AND wop.origin = 'externo'
      AND po.status IN ('aprobada_compras','enviada_proveedor','pagada','recibida','cerrada')
      AND COALESCE(poi.precio_unit,0) > 0
  `).catch(()=>{});

  await query(`
    WITH priced_items AS (
      SELECT
        poi.po_id,
        lower(trim(poi.descripcion)) AS descripcion_key,
        COALESCE(poi.cantidad,1) AS cantidad_key,
        poi.unidad,
        poi.precio_unit,
        ROW_NUMBER() OVER (
          PARTITION BY poi.po_id, lower(trim(poi.descripcion)), COALESCE(poi.cantidad,1)
          ORDER BY poi.created_at, poi.id
        ) AS rn
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.po_id
      WHERE po.status IN ('aprobada_compras','enviada_proveedor','pagada','recibida','cerrada')
        AND poi.work_order_part_id IS NULL
        AND COALESCE(poi.precio_unit,0) > 0
    ), ext_parts AS (
      SELECT
        wop.id,
        wop.po_id,
        lower(trim(wop.name)) AS name_key,
        COALESCE(wop.qty,1) AS qty_key,
        ROW_NUMBER() OVER (
          PARTITION BY wop.po_id, lower(trim(wop.name)), COALESCE(wop.qty,1)
          ORDER BY wop.added_at, wop.id
        ) AS rn
      FROM work_order_parts wop
      WHERE wop.origin = 'externo'
        AND wop.po_id IS NOT NULL
    ), matched AS (
      SELECT ep.id, pi.precio_unit, pi.unidad
      FROM ext_parts ep
      JOIN priced_items pi
        ON ep.po_id = pi.po_id
       AND ep.name_key = pi.descripcion_key
       AND ABS(ep.qty_key - pi.cantidad_key) < 0.0001
       AND ep.rn = pi.rn
    )
    UPDATE work_order_parts wop
    SET unit_cost = matched.precio_unit,
        unit = COALESCE(NULLIF(wop.unit,''), matched.unidad)
    FROM matched
    WHERE wop.id = matched.id
      AND COALESCE(wop.unit_cost,0) <> matched.precio_unit
  `).catch(()=>{});

  await query(`
    WITH candidates AS (
      SELECT id AS po_id
      FROM purchase_orders
      WHERE ot_id IS NOT NULL
        AND status IN ('aprobada_compras','enviada_proveedor','pagada','recibida','cerrada')
    ), ext_parts AS (
      SELECT
        wop.id,
        wop.po_id,
        ROW_NUMBER() OVER (PARTITION BY wop.po_id ORDER BY wop.added_at, wop.id) AS rn
      FROM work_order_parts wop
      JOIN candidates c ON c.po_id = wop.po_id
      WHERE wop.origin = 'externo'
        AND COALESCE(wop.unit_cost,0) = 0
    ), priced_items AS (
      SELECT
        poi.po_id,
        poi.precio_unit,
        poi.unidad,
        ROW_NUMBER() OVER (PARTITION BY poi.po_id ORDER BY poi.created_at, poi.id) AS rn
      FROM purchase_order_items poi
      JOIN candidates c ON c.po_id = poi.po_id
      WHERE COALESCE(poi.precio_unit,0) > 0
    ), matched AS (
      SELECT ep.id, pi.precio_unit, pi.unidad
      FROM ext_parts ep
      JOIN priced_items pi ON pi.po_id = ep.po_id AND pi.rn = ep.rn
    )
    UPDATE work_order_parts wop
    SET unit_cost = matched.precio_unit,
        unit = COALESCE(NULLIF(wop.unit,''), matched.unidad)
    FROM matched
    WHERE wop.id = matched.id
  `).catch(()=>{});

  await query(`
    UPDATE work_orders wo
    SET parts_cost = COALESCE((
      SELECT SUM(COALESCE(wop.subtotal,0))
      FROM work_order_parts wop
      WHERE wop.wo_id = wo.id
    ),0)
    WHERE EXISTS (
      SELECT 1
      FROM work_order_parts wop
      WHERE wop.wo_id = wo.id
        AND wop.origin = 'externo'
        AND COALESCE(wop.unit_cost,0) > 0
    )
  `).catch(()=>{});
}
ensureTables();

async function nextOCCode() {
  await query(`CREATE SEQUENCE IF NOT EXISTS oc_seq START 1 INCREMENT 1`).catch(()=>{});
  const r = await query("SELECT nextval('oc_seq') as num");
  return 'OC-' + String(parseInt(r.rows[0].num)).padStart(4, '0');
}

// Cuando Compras aprueba una OC generada desde una OT, el costo del repuesto
// externo debe verse en la OT aunque Tesorería todavía no haya pagado.
// Regla: el costo técnico del trabajo nace cuando Compras aprueba precio/proveedor.
async function syncApprovedPOCostsToWorkOrder(client, poId) {
  const poRes = await client.query(
    `SELECT id, ot_id, status
     FROM purchase_orders
     WHERE id = $1`,
    [poId]
  );
  const po = poRes.rows[0];
  if (!po || !po.ot_id || !['aprobada_compras','enviada_proveedor','pagada','recibida','cerrada'].includes(po.status)) {
    return { updated_parts: 0, ot_id: po?.ot_id || null };
  }

  // Primero sincroniza por vínculo directo item OC -> repuesto OT.
  const direct = await client.query(
    `UPDATE work_order_parts wop
     SET unit_cost = poi.precio_unit,
         unit = COALESCE(NULLIF(wop.unit,''), poi.unidad)
     FROM purchase_order_items poi
     WHERE poi.po_id = $1
       AND poi.work_order_part_id = wop.id
       AND wop.origin = 'externo'
       AND COALESCE(poi.precio_unit,0) > 0
     RETURNING wop.id`,
    [poId]
  );

  // Compatibilidad con OCs viejas: si no tenían work_order_part_id,
  // empareja por descripción + cantidad.
  const fallback = await client.query(
    `WITH priced_items AS (
       SELECT
         id,
         lower(trim(descripcion)) AS descripcion_key,
         COALESCE(cantidad,1) AS cantidad_key,
         unidad,
         precio_unit,
         ROW_NUMBER() OVER (
           PARTITION BY lower(trim(descripcion)), COALESCE(cantidad,1)
           ORDER BY created_at, id
         ) AS rn
       FROM purchase_order_items
       WHERE po_id = $1
         AND work_order_part_id IS NULL
         AND COALESCE(precio_unit,0) > 0
     ), ext_parts AS (
       SELECT
         id,
         lower(trim(name)) AS name_key,
         COALESCE(qty,1) AS qty_key,
         ROW_NUMBER() OVER (
           PARTITION BY lower(trim(name)), COALESCE(qty,1)
           ORDER BY added_at, id
         ) AS rn
       FROM work_order_parts
       WHERE po_id = $1
         AND origin = 'externo'
     ), matched AS (
       SELECT ep.id, pi.precio_unit, pi.unidad
       FROM ext_parts ep
       JOIN priced_items pi
         ON ep.name_key = pi.descripcion_key
        AND ABS(ep.qty_key - pi.cantidad_key) < 0.0001
        AND ep.rn = pi.rn
     )
     UPDATE work_order_parts wop
     SET unit_cost = matched.precio_unit,
         unit = COALESCE(NULLIF(wop.unit,''), matched.unidad)
     FROM matched
     WHERE wop.id = matched.id
       AND COALESCE(wop.unit_cost,0) <> matched.precio_unit
     RETURNING wop.id`,
    [poId]
  );

  // Último respaldo para casos viejos donde Compras modificó la descripción del item:
  // empareja por orden dentro de la OC. Se usa solo en partes externas que siguen sin costo.
  const orderFallback = await client.query(
    `WITH ext_parts AS (
       SELECT id,
              ROW_NUMBER() OVER (ORDER BY added_at, id) AS rn
       FROM work_order_parts
       WHERE po_id = $1
         AND origin = 'externo'
         AND COALESCE(unit_cost,0) = 0
     ), priced_items AS (
       SELECT precio_unit, unidad,
              ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
       FROM purchase_order_items
       WHERE po_id = $1
         AND COALESCE(precio_unit,0) > 0
     ), matched AS (
       SELECT ep.id, pi.precio_unit, pi.unidad
       FROM ext_parts ep
       JOIN priced_items pi ON pi.rn = ep.rn
     )
     UPDATE work_order_parts wop
     SET unit_cost = matched.precio_unit,
         unit = COALESCE(NULLIF(wop.unit,''), matched.unidad)
     FROM matched
     WHERE wop.id = matched.id
     RETURNING wop.id`,
    [poId]
  );

  await client.query(
    `UPDATE work_orders wo
     SET parts_cost = COALESCE((
       SELECT SUM(COALESCE(wop.subtotal,0))
       FROM work_order_parts wop
       WHERE wop.wo_id = wo.id
     ), 0)
     WHERE wo.id = $1`,
    [po.ot_id]
  );

  return { updated_parts: direct.rowCount + fallback.rowCount + orderFallback.rowCount, ot_id: po.ot_id };
}

const FORMAS_PAGO_OC = ['contado','cuenta_corriente','transferencia','cheque','echeq'];
function normalizarFormaPago(v) {
  return FORMAS_PAGO_OC.includes(v) ? v : null;
}
// Normaliza la prioridad a los 3 niveles canónicos. Acepta cualquier mayúscula/minúscula
// y "crítica" (tratada como Urgente), para que la urgencia que viene de la OT se marque bien.
function normalizarPrioridad(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'urgente' || s === 'critica' || s === 'crítica') return 'Urgente';
  if (s === 'media' || s === 'medio') return 'Media';
  return 'Normal';
}

// ─────────────────────────────────────────────────────────────
//  HELPERS DE PERMISOS
// ─────────────────────────────────────────────────────────────

// Estados que un rol PUEDE VER (filtro de listado)
function estadosQueVe(role) {
  if (role === 'dueno' || role === 'gerencia') return null; // null = todos
  if (role === 'compras') {
    return ['pendiente_cotizacion','en_cotizacion','dividida','aprobada_compras','enviada_proveedor','pagada','recibida','cerrada','rechazada'];
  }
  if (role === 'tesoreria') {
    return ['aprobada_compras','enviada_proveedor','pagada','recibida','cerrada','rechazada'];
  }
  if (role === 'auditor') {
    return ['pagada','recibida','cerrada'];
  }
  if (role === 'proveedores') {
    return ['aprobada_compras','enviada_proveedor','pagada','recibida','cerrada'];
  }
  if (['jefe_mantenimiento','paniol','contador','gerente_sucursal'].includes(role)) {
    return null; // ve todos los estados, pero filtramos por requested_by abajo (solo las propias)
  }
  return []; // otros roles: no ve nada
}

// Quita los precios de la respuesta si el rol no debe verlos
// (jefe_mant, paniol, contador — son solicitantes, no gestionan precios)
function ocultarPreciosSiCorresponde(po, role) {
  const rolesSinPrecio = ['jefe_mantenimiento','paniol','contador','gerente_sucursal'];
  if (!rolesSinPrecio.includes(role)) return po;
  const copia = { ...po };
  delete copia.total_estimado;
  delete copia.factura_monto;
  delete copia.presupuesto_monto_estimado;
  delete copia.iva_pct;
  delete copia.total_real;
  if (Array.isArray(copia.items)) {
    copia.items = copia.items.map(it => {
      const { precio_unit, subtotal, ...rest } = it;
      return rest;
    });
  }
  return copia;
}

// ─────────────────────────────────────────────────────────────
//  GET / — Listado (filtra según rol)
// ─────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    // Listado liviano: NO traer campos pesados como presupuesto_imagen.
    // Ese campo puede contener base64/PDF y vuelve lentísima la solapa de OC.
    // El archivo se trae solo al abrir el detalle de una OC.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    const { status } = req.query;
    const requestedLimit = parseInt(req.query.limit || '100', 10);
    const safeLimit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 100, 20), 200);
    const role = req.user.role;
    const userId = req.user.id;

    const rolesPermitidos = ['dueno','gerencia','jefe_mantenimiento','compras','tesoreria','contador','auditor','proveedores','gerente_sucursal'];
    if (!rolesPermitidos.includes(role)) {
      return res.status(403).json({ error: 'No tenés permiso para ver órdenes de compra' });
    }

    const where = ['1=1'];
    const params = [];

    const estVis = estadosQueVe(role);
    if (estVis !== null) {
      if (estVis.length === 0) return res.json([]);
      params.push(estVis);
      where.push(`po.status = ANY($${params.length})`);
    }

    if (role === 'gerente_sucursal') {
      if (!req.user.sucursal) return res.json([]);
      params.push(req.user.sucursal);
      where.push(`po.sucursal = $${params.length}`);
    } else if (['jefe_mantenimiento','paniol','contador'].includes(role)) {
      params.push(userId);
      where.push(`po.requested_by = $${params.length}`);
    }

    if (status) {
      params.push(status);
      where.push(`po.status = $${params.length}`);
    }

    // Búsqueda libre: por código de OC o nombre de proveedor (para encontrar OCs viejas).
    const search = (req.query.search || '').trim();
    if (search) {
      params.push(`%${search}%`);
      where.push(`(po.code ILIKE $${params.length} OR po.proveedor ILIKE $${params.length})`);
    }

    params.push(safeLimit);
    const limitParam = `$${params.length}`;
    const requestedOffset = parseInt(req.query.offset || '0', 10);
    const safeOffset = Math.max(Number.isFinite(requestedOffset) ? requestedOffset : 0, 0);
    params.push(safeOffset);
    const offsetParam = `$${params.length}`;

    const sql = `
      WITH base AS (
        SELECT
          po.id,
          po.code,
          po.status,
          po.requested_by,
          po.created_at,
          po.sucursal,
          po.area,
          po.tipo,
          po.vehicle_id,
          po.ot_id,
          po.asset_id,
          po.supplier_id,
          po.proveedor,
          po.forma_pago,
          po.cc_dias,
          po.moneda,
          po.iva_pct,
          po.total_estimado,
          po.presupuesto_monto_estimado,
          (po.presupuesto_imagen IS NOT NULL AND po.presupuesto_imagen <> '') AS tiene_presupuesto,
          po.factura_nro,
          po.factura_fecha,
          po.factura_monto,
          po.cotizado_por,
          po.cotizado_at,
          po.aprobado_compras_por,
          po.aprobado_compras_at,
          po.pagado_por,
          po.pagado_at,
          po.recibido_por,
          po.recibido_at,
          po.recibido_en,
          po.delivery_status,
          po.invoice_status,
          po.payment_status,
          po.rechazado_por,
          po.rechazado_at,
          po.motivo_rechazo,
          po.motivo_devolucion,
          po.devuelto_por,
          po.devuelto_at,
          po.notes,
          po.prioridad
        FROM purchase_orders po
        WHERE ${where.join(' AND ')}
        ORDER BY po.created_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      )
      SELECT base.*,
        u.name  AS solicitante_nombre, u.role AS solicitante_rol,
        uc.name AS cotizador_nombre,
        ua.name AS aprobador_nombre,
        up.name AS pagador_nombre,
        ur.name AS receptor_nombre,
        urech.name AS rechazador_nombre,
        COALESCE(t.total_real, 0) AS total_real
      FROM base
      LEFT JOIN users u     ON u.id     = base.requested_by
      LEFT JOIN users uc    ON uc.id    = base.cotizado_por
      LEFT JOIN users ua    ON ua.id    = base.aprobado_compras_por
      LEFT JOIN users up    ON up.id    = base.pagado_por
      LEFT JOIN users ur    ON ur.id    = base.recibido_por
      LEFT JOIN users urech ON urech.id = base.rechazado_por
      LEFT JOIN LATERAL (
        SELECT SUM(i.cantidad * i.precio_unit) AS total_real
        FROM purchase_order_items i
        WHERE i.po_id = base.id
      ) t ON true
      ORDER BY base.created_at DESC`;

    const result = await query(sql, params);
    const rows = result.rows.map(po => ocultarPreciosSiCorresponde(po, role));
    res.json(rows);
  } catch(err) {
    console.error('[OC listar]', err.message);
    res.status(500).json({ error: 'Error al listar órdenes de compra' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /aux/proveedores
// ─────────────────────────────────────────────────────────────
router.get('/aux/proveedores', authenticate, async (req, res) => {
  try {
    const r = await query("SELECT DISTINCT proveedor FROM purchase_orders WHERE proveedor IS NOT NULL AND proveedor <> '' ORDER BY proveedor");
    res.json(r.rows.map(x => x.proveedor));
  } catch(err) {
    console.error('[OC aux proveedores]', err.message);
    res.status(500).json({ error: 'Error al obtener proveedores' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /:id — Detalle (con filtro por rol)
// ─────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    // Nunca cachear el detalle (cambia con cada transición)
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    const role = req.user.role;
    const userId = req.user.id;

    const po = await query(`
      SELECT po.*,
        u.name  as solicitante_nombre, u.role as solicitante_rol,
        uc.name as cotizador_nombre,
        ua.name as aprobador_nombre,
        up.name as pagador_nombre,
        ur.name as receptor_nombre,
        urech.name as rechazador_nombre
      FROM purchase_orders po
      LEFT JOIN users u     ON u.id     = po.requested_by
      LEFT JOIN users uc    ON uc.id    = po.cotizado_por
      LEFT JOIN users ua    ON ua.id    = po.aprobado_compras_por
      LEFT JOIN users up    ON up.id    = po.pagado_por
      LEFT JOIN users ur    ON ur.id    = po.recibido_por
      LEFT JOIN users urech ON urech.id = po.rechazado_por
      WHERE po.id = $1`, [req.params.id]);
    if (!po.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });

    const oc = po.rows[0];

    // El presupuesto adjunto (base64, hasta 5MB) NO viaja en el detalle: haría
    // lenta cada apertura de OC. Solo exponemos un flag y, si hace falta verlo,
    // se pide aparte con GET /:id/presupuesto (carga diferida).
    const tienePresupuesto = !!(oc.presupuesto_imagen && String(oc.presupuesto_imagen).trim());
    delete oc.presupuesto_imagen;
    oc.tiene_presupuesto = tienePresupuesto;

    // Verificar acceso
    const estVis = estadosQueVe(role);
    if (estVis !== null && !estVis.includes(oc.status)) {
      return res.status(403).json({ error: 'No tenés permiso para ver esta OC' });
    }
    if (role === 'gerente_sucursal') {
      if (!req.user.sucursal || oc.sucursal !== req.user.sucursal) {
        return res.status(403).json({ error: 'Solo podés ver OCs de tu sucursal' });
      }
    } else if (['jefe_mantenimiento','paniol','contador'].includes(role) && oc.requested_by !== userId) {
      return res.status(403).json({ error: 'Solo podés ver las OCs que creaste vos' });
    }
    // Rol proveedores: personal interno que carga facturas de cualquier proveedor.
    // No se valida supplier_id.

    const items = await query(
      `SELECT poi.*, s.name AS supplier_name
       FROM purchase_order_items poi
       LEFT JOIN suppliers s ON s.id = poi.supplier_id
       WHERE poi.po_id = $1 ORDER BY poi.created_at`, [req.params.id]);
    const resultado = { ...oc, items: items.rows };

    // Trazabilidad de la división por proveedor (etapa 3):
    //  - si es una OC hija, exponemos la OC madre de la que salió.
    //  - si es la OC madre (estado 'dividida'), exponemos las OC hijas.
    if (oc.split_parent_id) {
      const padre = await query('SELECT id, code, status FROM purchase_orders WHERE id=$1', [oc.split_parent_id]);
      resultado.split_parent = padre.rows[0] || null;
    }
    const hijas = await query(
      `SELECT po.id, po.code, po.status, po.supplier_id, s.name AS supplier_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.split_parent_id = $1
       ORDER BY po.code`, [req.params.id]);
    if (hijas.rows.length) resultado.split_children = hijas.rows;

    res.json(ocultarPreciosSiCorresponde(resultado, role));
  } catch(err) {
    console.error('[OC detalle]', err.message);
    res.status(500).json({ error: 'Error al obtener OC' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /:id/presupuesto — Archivo de presupuesto (carga diferida).
//  Se separa del detalle para no arrastrar el base64 (hasta 5MB) en cada
//  apertura de OC. Mismas reglas de visibilidad que el detalle.
// ─────────────────────────────────────────────────────────────
router.get('/:id/presupuesto', authenticate, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const role = req.user.role;
    const userId = req.user.id;

    const r = await query(
      'SELECT status, requested_by, sucursal, presupuesto_imagen FROM purchase_orders WHERE id=$1',
      [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    const oc = r.rows[0];

    // Mismo control de acceso que el detalle.
    const estVis = estadosQueVe(role);
    if (estVis !== null && !estVis.includes(oc.status)) {
      return res.status(403).json({ error: 'No tenés permiso para ver esta OC' });
    }
    if (role === 'gerente_sucursal') {
      if (!req.user.sucursal || oc.sucursal !== req.user.sucursal) {
        return res.status(403).json({ error: 'Solo podés ver OCs de tu sucursal' });
      }
    } else if (['jefe_mantenimiento','paniol','contador'].includes(role) && oc.requested_by !== userId) {
      return res.status(403).json({ error: 'Solo podés ver las OCs que creaste vos' });
    }

    if (!oc.presupuesto_imagen || !String(oc.presupuesto_imagen).trim()) {
      return res.status(404).json({ error: 'Esta OC no tiene presupuesto adjunto' });
    }
    res.json({ presupuesto_imagen: oc.presupuesto_imagen });
  } catch(err) {
    console.error('[OC presupuesto]', err.message);
    res.status(500).json({ error: 'Error al obtener el presupuesto' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST / — Crear nueva OC (Jefe mantenimiento)
//           SIN PRECIOS — solo descripción + opcional presupuesto
// ─────────────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','compras','paniol','contador','gerente_sucursal'), async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      notes, sucursal, area, tipo='flota',
      vehicle_id, ot_id, asset_id, supplier_id,
      items=[],
      presupuesto_imagen, presupuesto_monto_estimado,
      // Campos opcionales si la crea compras con precios/proveedor ya definidos
      proveedor, forma_pago, cc_dias, moneda, iva_pct,
      prioridad
    } = req.body;

    if (!items.length) return res.status(400).json({ error: 'La OC debe tener al menos un artículo' });

    // Validar presupuesto_imagen si viene (tipo + tamaño)
    if (presupuesto_imagen) {
      const validTypes = ['data:image/jpeg','data:image/jpg','data:image/png','data:image/webp','data:application/pdf'];
      if (!validTypes.some(t => presupuesto_imagen.startsWith(t))) {
        return res.status(400).json({ error: 'El presupuesto debe ser JPG, PNG, WEBP o PDF' });
      }
      const sizeKB = Math.round(presupuesto_imagen.length * 0.75 / 1024);
      if (sizeKB > 5120) return res.status(400).json({ error: 'El archivo de presupuesto no puede superar 5MB' });
    }

    // ── Determinar estado inicial según quién crea + si trajo precios ──
    // Por defecto: pendiente_cotizacion (el jefe mant pide algo, compras cotizará)
    let estadoInicial = 'pendiente_cotizacion';
    let autoCotizado = false;
    let autoAprobado = false;

    const creadorEsCompras = ['compras','dueno','gerencia'].includes(req.user.role);
    const traePreciosCargados = items.some(i => parseFloat(i.precio_unit||0) > 0);

    if (creadorEsCompras) {
      if (traePreciosCargados && proveedor) {
        // Compras crea con precios + proveedor → ya está APROBADA (lista para pagar)
        estadoInicial = 'aprobada_compras';
        autoCotizado = true;
        autoAprobado = true;
      } else {
        // Compras crea sin cotizar todavía → queda EN COTIZACIÓN (ellos ya la tomaron)
        estadoInicial = 'en_cotizacion';
        autoCotizado = true;
      }
    }

    const code = await nextOCCode();

    // Gerente de sucursal: solo solicita compras. No elige proveedor ni precios.
    // Sus pedidos quedan siempre marcados con su sucursal/área y pasan a Compras.
    const esGerenteSucursal = req.user.role === 'gerente_sucursal';
    if (esGerenteSucursal && !req.user.sucursal) {
      return res.status(403).json({ error: 'El gerente de sucursal no tiene sucursal asignada' });
    }
    const poSucursal = (esGerenteSucursal && req.user.sucursal) ? req.user.sucursal : (sucursal || null);
    const poArea     = (esGerenteSucursal && req.user.area) ? req.user.area : (area || null);

    if (esGerenteSucursal && vehicle_id) {
      const veh = await client.query('SELECT id, code, base FROM vehicles WHERE id=$1 AND active IS DISTINCT FROM FALSE', [vehicle_id]);
      if (!veh.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
      if (String(veh.rows[0].base || '').trim() !== String(req.user.sucursal || '').trim()) {
        return res.status(403).json({ error: 'Solo podés pedir OC para vehículos de tu sucursal' });
      }
    }
    const cleanSupplierId = esGerenteSucursal ? null : (supplier_id || null);
    const cleanProveedor  = esGerenteSucursal ? null : (proveedor || null);

    // Armar INSERT con columnas según estado inicial
    const _fp  = normalizarFormaPago(forma_pago);
    const _cc  = ((_fp === 'cuenta_corriente' || _fp === 'cheque' || _fp === 'echeq') && cc_dias != null && cc_dias !== '') ? parseInt(cc_dias, 10) : null;
    const _mon = (moneda === 'USD' || moneda === 'ARS') ? moneda : 'ARS';
    const _iva = iva_pct != null ? parseFloat(iva_pct) : 0;

    // ── TRANSACCIÓN: header + items + total_estimado deben persistir juntos o nada ──
    await client.query('BEGIN');

    const _prio = normalizarPrioridad(prioridad);
    const po = await client.query(`
      INSERT INTO purchase_orders (
        code, status, requested_by, sucursal, area, tipo,
        vehicle_id, ot_id, asset_id, supplier_id, notes,
        presupuesto_imagen, presupuesto_monto_estimado,
        proveedor, forma_pago, cc_dias, moneda, iva_pct,
        cotizado_por, cotizado_at,
        aprobado_compras_por, aprobado_compras_at,
        prioridad
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
              $14, $15, $16, $17, $18,
              $19, $20,
              $21, $22, $23)
      RETURNING *`,
      [
        code, estadoInicial, req.user.id, poSucursal, poArea, tipo||'flota',
        vehicle_id||null, ot_id||null, asset_id||null, cleanSupplierId,
        notes||null,
        presupuesto_imagen||null,
        presupuesto_monto_estimado != null ? parseFloat(presupuesto_monto_estimado) : null,
        cleanProveedor, _fp, _cc, _mon, _iva,
        autoCotizado ? req.user.id : null,
        autoCotizado ? new Date() : null,
        autoAprobado ? req.user.id : null,
        autoAprobado ? new Date() : null,
        _prio
      ]
    );

    const poId = po.rows[0].id;
    // Items: si es jefe mant → sin precio. Si es compras → con el precio que haya cargado
    for (const item of items) {
      if (!item.descripcion?.trim()) continue;
      const precioItem = creadorEsCompras ? (parseFloat(item.precio_unit||0) || 0) : 0;
      await client.query(
        `INSERT INTO purchase_order_items (po_id, descripcion, cantidad, unidad, precio_unit, stock_item_id, work_order_part_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [poId,
         item.descripcion.trim(),
         parseFloat(item.cantidad||1),
         item.unidad||'un',
         precioItem,
         item.stock_item_id||null,
         item.work_order_part_id || item.part_id || null]
      );
    }

    // Si es compras y cargó precios, actualizar total_estimado
    if (creadorEsCompras && traePreciosCargados) {
      const t = await client.query('SELECT COALESCE(SUM(cantidad * precio_unit),0) as total FROM purchase_order_items WHERE po_id = $1', [poId]);
      await client.query('UPDATE purchase_orders SET total_estimado = $1 WHERE id = $2', [t.rows[0].total, poId]);
    }

    // Si nació aprobada y viene de una OT, reflejar costo externo en la OT al instante.
    if (autoAprobado) {
      await syncApprovedPOCostsToWorkOrder(client, poId);
    }

    await client.query('COMMIT');

    const full = await query('SELECT * FROM purchase_orders WHERE id=$1', [poId]);
    const itemsResult = await query('SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at', [poId]);
    const resultado = { ...full.rows[0], items: itemsResult.rows };
    res.status(201).json(ocultarPreciosSiCorresponde(resultado, req.user.role));
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[OC crear]', err.message);
    res.status(500).json({ error: 'Error al crear la OC' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  PATCH /:id — Editar cabecera
//  Los campos editables dependen del rol y del estado de la OC:
//   - dueno/gerencia: pueden editar TODO, siempre
//   - compras: puede editar items/proveedor/iva/forma pago en pendiente_cotizacion o en_cotizacion
//   - tesoreria: puede editar factura/iva en aprobada_compras
//   - solicitantes (jefe_mant, paniol, contador): solo datos básicos en pendiente_cotizacion
// ─────────────────────────────────────────────────────────────
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const role = req.user.role;
    const userId = req.user.id;

    const cur = await query('SELECT * FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    const oc = cur.rows[0];
    const estado = oc.status;

    const esCreador = oc.requested_by === userId;
    const esAdmin   = ['dueno','gerencia'].includes(role);

    // ── Matriz de permisos por rol + estado ──
    // Devuelve la lista de CAMPOS que este rol/estado puede modificar
    function camposPermitidos() {
      if (esAdmin) {
        // Admin puede modificar todo siempre (salvo estados finales)
        if (['recibida','cerrada','rechazada'].includes(estado)) {
          // En estados finales solo notas/motivos
          return ['notes'];
        }
        return ['notes','sucursal','area','tipo','vehicle_id','presupuesto_imagen','presupuesto_monto_estimado',
                'proveedor','supplier_id','iva_pct','forma_pago','cc_dias','moneda','prioridad',
                'factura_nro','factura_fecha','factura_monto'];
      }
      if (role === 'compras' && ['pendiente_cotizacion','en_cotizacion'].includes(estado)) {
        return ['proveedor','supplier_id','iva_pct','forma_pago','cc_dias','moneda','prioridad','notes',
                'factura_nro','factura_fecha','factura_monto'];
      }
      if (role === 'tesoreria' && estado === 'enviada_proveedor') {
        // Tesorería solo puede corregir notas, no datos de factura (ya llegan cargados)
        return ['notes'];
      }
      if (role === 'gerente_sucursal' && esCreador && estado === 'pendiente_cotizacion') {
        return ['notes','area','tipo','vehicle_id','presupuesto_imagen','presupuesto_monto_estimado'];
      }
      if (['jefe_mantenimiento','paniol','contador'].includes(role) && esCreador && estado === 'pendiente_cotizacion') {
        return ['notes','sucursal','area','tipo','vehicle_id','presupuesto_imagen','presupuesto_monto_estimado'];
      }
      return [];
    }

    const permitidos = camposPermitidos();
    if (permitidos.length === 0) {
      return res.status(403).json({ error: `No podés editar esta OC en su estado actual (${estado})` });
    }
    if (role === 'gerente_sucursal') {
      if (!req.user.sucursal || oc.sucursal !== req.user.sucursal) {
        return res.status(403).json({ error: 'Solo podés editar solicitudes de tu sucursal' });
      }
      if (req.body.vehicle_id) {
        const veh = await query('SELECT id, base FROM vehicles WHERE id=$1 AND active IS DISTINCT FROM FALSE', [req.body.vehicle_id]);
        if (!veh.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
        if (String(veh.rows[0].base || '').trim() !== String(req.user.sucursal || '').trim()) {
          return res.status(403).json({ error: 'Solo podés asignar vehículos de tu sucursal' });
        }
      }
    }

    // Armar UPDATE dinámico con solo los campos permitidos que llegaron
    const sets = [];
    const params = [];
    const campoVal = {
      proveedor:     () => (req.body.proveedor !== undefined ? (req.body.proveedor || null) : undefined),
      supplier_id:   () => (req.body.supplier_id !== undefined ? (req.body.supplier_id || null) : undefined),
      iva_pct:       () => (req.body.iva_pct !== undefined ? parseFloat(req.body.iva_pct) || 0 : undefined),
      prioridad:     () => (req.body.prioridad !== undefined ? normalizarPrioridad(req.body.prioridad) : undefined),
      forma_pago:    () => {
        if (req.body.forma_pago === undefined) return undefined;
        const v = req.body.forma_pago;
        return normalizarFormaPago(v);
      },
      cc_dias:       () => (req.body.cc_dias !== undefined ? (req.body.cc_dias ? parseInt(req.body.cc_dias,10) : null) : undefined),
      moneda:        () => (req.body.moneda !== undefined ? (req.body.moneda === 'USD' ? 'USD' : 'ARS') : undefined),
      factura_nro:   () => (req.body.factura_nro !== undefined ? (req.body.factura_nro?.trim() || null) : undefined),
      factura_fecha: () => (req.body.factura_fecha !== undefined ? (req.body.factura_fecha || null) : undefined),
      factura_monto: () => (req.body.factura_monto !== undefined ? (req.body.factura_monto ? parseFloat(req.body.factura_monto) : null) : undefined),
      notes:         () => (req.body.notes !== undefined ? (req.body.notes?.trim() || null) : undefined),
      sucursal:      () => (req.body.sucursal !== undefined ? (req.body.sucursal || null) : undefined),
      area:          () => (req.body.area !== undefined ? (req.body.area || null) : undefined),
      tipo:          () => (req.body.tipo !== undefined ? (req.body.tipo || null) : undefined),
      vehicle_id:    () => (req.body.vehicle_id !== undefined ? (req.body.vehicle_id || null) : undefined),
      presupuesto_imagen: () => (req.body.presupuesto_imagen !== undefined ? req.body.presupuesto_imagen : undefined),
      presupuesto_monto_estimado: () => (req.body.presupuesto_monto_estimado !== undefined ?
        (req.body.presupuesto_monto_estimado ? parseFloat(req.body.presupuesto_monto_estimado) : null) : undefined)
    };

    for (const campo of permitidos) {
      if (!campoVal[campo]) continue;
      const v = campoVal[campo]();
      if (v === undefined) continue; // No vino en el body, saltar
      params.push(v);
      sets.push(`${campo}=$${params.length}`);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Nada para actualizar' });
    }

    params.push(req.params.id);
    const r = await query(
      `UPDATE purchase_orders SET ${sets.join(',')} WHERE id=$${params.length} RETURNING *`,
      params
    );
    res.json(ocultarPreciosSiCorresponde(r.rows[0], role));
  } catch(err) {
    console.error('[OC editar]', err.message);
    res.status(500).json({ error: 'Error al editar OC' });
  }
});

// ─────────────────────────────────────────────────────────────
//  PUT /:id/items — Reemplazar items (compras carga precios)
// ─────────────────────────────────────────────────────────────
router.put('/:id/items', authenticate, requireRole('dueno','gerencia','compras'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { items=[] } = req.body;
    if (!items.length) return res.status(400).json({ error: 'Debe haber al menos un artículo' });

    // ── TRANSACCIÓN con FOR UPDATE: bloquea la OC hasta finalizar ──
    // Previene race conditions si dos usuarios editan items al mismo tiempo
    await client.query('BEGIN');

    const cur = await client.query('SELECT status FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }
    const estadosEditables = ['pendiente_cotizacion','en_cotizacion'];
    if (!estadosEditables.includes(cur.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se pueden editar items mientras la OC está pendiente o en cotización' });
    }

    // Antes de reemplazar, conservar el vínculo con repuestos externos de OT.
    // Si Compras cambia la descripción/precio de un item, el vínculo no se pierde.
    const oldItems = await client.query(
      `SELECT id, work_order_part_id
       FROM purchase_order_items
       WHERE po_id = $1
       ORDER BY created_at, id`,
      [req.params.id]
    );
    const oldParts = await client.query(
      `SELECT id
       FROM work_order_parts
       WHERE po_id = $1 AND origin = 'externo'
       ORDER BY added_at, id`,
      [req.params.id]
    );

    // Reemplazar todos los items
    await client.query('DELETE FROM purchase_order_items WHERE po_id = $1', [req.params.id]);
    let itemIdx = 0;
    for (const item of items) {
      if (!item.descripcion?.trim()) continue;
      const linkedPartId = item.work_order_part_id || item.part_id || oldItems.rows[itemIdx]?.work_order_part_id || oldParts.rows[itemIdx]?.id || null;
      await client.query(
        `INSERT INTO purchase_order_items (po_id, descripcion, cantidad, unidad, precio_unit, stock_item_id, work_order_part_id, supplier_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [req.params.id, item.descripcion.trim(), parseFloat(item.cantidad||1),
         item.unidad||'un', parseFloat(item.precio_unit||0), item.stock_item_id||null,
         linkedPartId, item.supplier_id || null]
      );
      itemIdx += 1;
    }

    // Recalcular total_estimado
    const t = await client.query('SELECT COALESCE(SUM(cantidad * precio_unit),0) as total FROM purchase_order_items WHERE po_id = $1', [req.params.id]);
    await client.query('UPDATE purchase_orders SET total_estimado = $1 WHERE id = $2', [t.rows[0].total, req.params.id]);

    await client.query('COMMIT');

    const itemsResult = await query('SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at', [req.params.id]);
    res.json({ items: itemsResult.rows, total_estimado: t.rows[0].total });
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[OC items]', err.message);
    res.status(500).json({ error: 'Error al actualizar items' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/dividir — Dividir una OC consolidada por proveedor (etapa 3)
//  Agrupa los ítems por el supplier_id que asignó Compras y genera una OC
//  hija por proveedor (con trazabilidad a la OC madre y la OT). La OC madre
//  queda en estado 'dividida'. Si todos los ítems son de un solo proveedor,
//  no se divide: solo se le asigna ese proveedor a la propia OC.
// ─────────────────────────────────────────────────────────────
router.post('/:id/dividir', authenticate, requireRole('dueno','gerencia','compras'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cur = await client.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }
    const madre = cur.rows[0];

    const estadosDivisibles = ['pendiente_cotizacion','en_cotizacion'];
    if (!estadosDivisibles.includes(madre.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede dividir una OC pendiente o en cotización' });
    }

    const itemsRes = await client.query(
      'SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at, id', [req.params.id]);
    const items = itemsRes.rows;
    if (!items.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La OC no tiene ítems para dividir' });
    }

    // Todos los ítems deben tener proveedor asignado.
    const sinProveedor = items.filter(it => !it.supplier_id);
    if (sinProveedor.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Asigná un proveedor a cada ítem antes de dividir',
        items_sin_proveedor: sinProveedor.map(it => it.descripcion)
      });
    }

    // Agrupar ítems por proveedor (preservando el orden de aparición).
    const grupos = new Map();
    for (const it of items) {
      if (!grupos.has(it.supplier_id)) grupos.set(it.supplier_id, []);
      grupos.get(it.supplier_id).push(it);
    }

    // Un solo proveedor: no tiene sentido crear una hija idéntica. Le asignamos
    // el proveedor a la propia OC y la dejamos lista para cotizar.
    if (grupos.size === 1) {
      const supplierId = [...grupos.keys()][0];
      const sup = await client.query('SELECT name FROM suppliers WHERE id=$1', [supplierId]);
      await client.query(
        'UPDATE purchase_orders SET supplier_id=$1, proveedor=$2 WHERE id=$3',
        [supplierId, sup.rows[0]?.name || null, req.params.id]);
      await client.query('COMMIT');
      return res.json({ dividida: false, supplier_id: supplierId, hijas: [] });
    }

    // Varios proveedores: una OC hija por proveedor.
    const hijas = [];
    for (const [supplierId, grupoItems] of grupos) {
      const sup = await client.query('SELECT name FROM suppliers WHERE id=$1', [supplierId]);
      const supName = sup.rows[0]?.name || null;
      const code = await nextOCCode();
      const nueva = await client.query(
        `INSERT INTO purchase_orders
           (code, status, requested_by, sucursal, area, tipo, vehicle_id, ot_id, asset_id,
            notes, prioridad, supplier_id, proveedor, split_parent_id)
         VALUES ($1,'pendiente_cotizacion',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [code, madre.requested_by, madre.sucursal, madre.area, madre.tipo,
         madre.vehicle_id, madre.ot_id, madre.asset_id,
         madre.notes, madre.prioridad || 'Normal', supplierId, supName, madre.id]);
      const hijaId = nueva.rows[0].id;

      for (const it of grupoItems) {
        await client.query(
          `INSERT INTO purchase_order_items
             (po_id, descripcion, cantidad, unidad, precio_unit, stock_item_id, work_order_part_id, supplier_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [hijaId, it.descripcion, it.cantidad, it.unidad, it.precio_unit || 0,
           it.stock_item_id, it.work_order_part_id, supplierId]);
        // Reapuntar el repuesto externo de la OT a la OC hija (la que se va a pagar).
        if (it.work_order_part_id) {
          await client.query('UPDATE work_order_parts SET po_id=$1 WHERE id=$2', [hijaId, it.work_order_part_id]);
        }
      }

      const t = await client.query(
        'SELECT COALESCE(SUM(cantidad * precio_unit),0) AS total FROM purchase_order_items WHERE po_id=$1', [hijaId]);
      await client.query('UPDATE purchase_orders SET total_estimado=$1 WHERE id=$2', [t.rows[0].total, hijaId]);

      hijas.push({ id: hijaId, code, supplier_id: supplierId, supplier_name: supName });
    }

    // La OC madre queda como registro histórico de la división.
    await client.query("UPDATE purchase_orders SET status='dividida' WHERE id=$1", [madre.id]);

    await client.query('COMMIT');
    res.json({ dividida: true, hijas });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[OC dividir]', err.message);
    res.status(500).json({ error: 'Error al dividir la OC por proveedor' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  DELETE /:id — Borrar (solo dueño/gerencia/creador en estado inicial)
// ─────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','compras','paniol','contador','gerente_sucursal'), async (req, res) => {
  try {
    const cur = await query('SELECT * FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    const oc = cur.rows[0];

    if (['jefe_mantenimiento','compras','paniol','contador'].includes(req.user.role)) {
      if (oc.requested_by !== req.user.id) {
        return res.status(403).json({ error: 'Solo podés borrar OCs que creaste vos' });
      }
      // Solicitantes (jefe mant, paniol, contador): solo borran si está pendiente_cotizacion
      // Compras: puede borrar si está pendiente o en cotización (recién creada por ella)
      if (['jefe_mantenimiento','paniol','contador'].includes(req.user.role) && oc.status !== 'pendiente_cotizacion') {
        return res.status(400).json({ error: 'Solo se pueden borrar OCs pendientes de cotizar' });
      }
      if (req.user.role === 'compras' && !['pendiente_cotizacion','en_cotizacion'].includes(oc.status)) {
        return res.status(400).json({ error: 'Solo se pueden borrar OCs en estado inicial' });
      }
    }
    await query('DELETE FROM purchase_orders WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(err) {
    console.error('[OC borrar]', err.message);
    res.status(500).json({ error: 'Error al borrar OC' });
  }
});

// ═══════════════════════════════════════════════════════════════
//                  TRANSICIONES DE ESTADO
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  POST /:id/tomar-cotizacion — Compras toma la OC
//  pendiente_cotizacion → en_cotizacion
// ─────────────────────────────────────────────────────────────
router.post('/:id/tomar-cotizacion', authenticate, requireRole('dueno','gerencia','compras'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT status FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }
    if (cur.rows[0].status !== 'pendiente_cotizacion') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede tomar una OC pendiente de cotizar' });
    }
    const r = await client.query(`
      UPDATE purchase_orders SET
        status = 'en_cotizacion',
        cotizado_por = $1,
        cotizado_at = NOW()
      WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[OC tomar-cotizacion]', err.message);
    res.status(500).json({ error: 'Error al tomar la OC' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/aprobar-compras — Compras aprueba
//  en_cotizacion (o pendiente) → aprobada_compras (requiere precios cargados)
// ─────────────────────────────────────────────────────────────
router.post('/:id/aprobar-compras', authenticate, requireRole('dueno','gerencia','compras'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { proveedor, supplier_id, forma_pago, cc_dias, moneda, iva_pct,
            factura_nro, factura_fecha, factura_monto } = req.body;

    await client.query('BEGIN');

    const cur = await client.query('SELECT status FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }
    if (!['en_cotizacion','pendiente_cotizacion'].includes(cur.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede aprobar una OC en cotización' });
    }

    // Validar que haya al menos un item con precio > 0
    const items = await client.query('SELECT precio_unit FROM purchase_order_items WHERE po_id = $1', [req.params.id]);
    const hayPrecios = items.rows.some(it => parseFloat(it.precio_unit) > 0);
    if (!hayPrecios) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Debés cargar precios en los artículos antes de aprobar' });
    }

    // Validar datos MÍNIMOS para aprobar
    // En el flujo de Biletta, compras recibe factura física antes de aprobar,
    // por eso se exige N° factura y monto al aprobar.
    if (!proveedor || !String(proveedor).trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cargá el proveedor antes de aprobar' });
    }
    // Nota: ya no se exige N° de factura ni monto al aprobar.
    // En el flujo real, compras solo aprueba con proveedor + condiciones,
    // y el rol Proveedores carga la factura cuando la recibe del proveedor.

    // Validar forma_pago
    const _fp = normalizarFormaPago(forma_pago);
    const _cc = ((_fp === 'cuenta_corriente' || _fp === 'cheque' || _fp === 'echeq') && cc_dias != null && cc_dias !== '') ? parseInt(cc_dias, 10) : null;
    const _mon = (moneda === 'USD' || moneda === 'ARS') ? moneda : 'ARS';

    // Resolver supplier_id: si vino, usarlo. Sino buscar/crear automáticamente desde "proveedor" (texto)
    let _supplier_id = supplier_id || null;
    if (!_supplier_id && proveedor && String(proveedor).trim()) {
      const nombre = String(proveedor).trim();
      // Buscar por nombre exacto (case insensitive) entre proveedores activos
      const found = await client.query(
        `SELECT id FROM suppliers WHERE LOWER(name) = LOWER($1) AND active = TRUE LIMIT 1`,
        [nombre]
      );
      if (found.rows[0]) {
        _supplier_id = found.rows[0].id;
      } else {
        // Crear nuevo proveedor automáticamente con datos mínimos
        const ins = await client.query(
          `INSERT INTO suppliers (name, forma_pago, cc_dias, moneda, status, active)
           VALUES ($1, $2, $3, $4, 'activo', TRUE) RETURNING id`,
          [nombre, _fp, _cc, _mon]
        );
        _supplier_id = ins.rows[0].id;
        console.log('[OC aprobar-compras] supplier creado automáticamente:', _supplier_id);
      }
    }

    const r = await client.query(`
      UPDATE purchase_orders SET
        status = 'aprobada_compras',
        proveedor = COALESCE($1, proveedor),
        supplier_id = COALESCE($2, supplier_id),
        forma_pago = COALESCE($3, forma_pago),
        cc_dias = COALESCE($4, cc_dias),
        moneda = COALESCE($5, moneda),
        iva_pct = COALESCE($6, iva_pct),
        factura_nro = COALESCE($7, factura_nro),
        factura_fecha = COALESCE($8, factura_fecha),
        factura_monto = COALESCE($9, factura_monto),
        aprobado_compras_por = $10,
        aprobado_compras_at = NOW()
      WHERE id = $11 RETURNING *`,
      [proveedor||null, _supplier_id, _fp, _cc, _mon,
       iva_pct != null ? parseFloat(iva_pct) : null,
       factura_nro ? String(factura_nro).trim() : null,
       factura_fecha || null,
       factura_monto != null && factura_monto !== '' ? parseFloat(factura_monto) : null,
       req.user.id, req.params.id]
    );
    await syncApprovedPOCostsToWorkOrder(client, req.params.id);

    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[OC aprobar-compras]', err.message);
    res.status(500).json({ error: 'Error al aprobar OC' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/marcar-enviada — Compras marca que la OC se envió al proveedor
//  aprobada_compras → enviada_proveedor
//  Paso OBLIGATORIO: no se puede pagar ni recibir hasta marcar la OC como enviada.
// ─────────────────────────────────────────────────────────────
router.post('/:id/marcar-enviada', authenticate, requireRole('dueno','gerencia','compras'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT status FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }
    if (cur.rows[0].status !== 'aprobada_compras') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede marcar como enviada una OC aprobada por compras' });
    }
    const r = await client.query(`
      UPDATE purchase_orders SET
        status = 'enviada_proveedor',
        enviada_por = $1,
        fecha_envio_prov = NOW()
      WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    await client.query('COMMIT');
    res.json(r.rows[0]);
    // Email al proveedor (best-effort): no se await dentro de la respuesta para no
    // demorarla, y cualquier error se loguea sin afectar la OC ya marcada como enviada.
    enviarOCAlProveedor(req.params.id).catch(e => console.error('[OC email] fallo:', e.message));
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[OC marcar-enviada]', err.message);
    res.status(500).json({ error: 'Error al marcar la OC como enviada' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/pagar — Tesorería confirma el pago
//  enviada_proveedor → pagada
// ─────────────────────────────────────────────────────────────
router.post('/:id/pagar', authenticate, requireRole('dueno','gerencia','tesoreria'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { factura_nro, factura_fecha, factura_monto } = req.body;
    await client.query('BEGIN');
    const cur = await client.query('SELECT status FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }
    if (cur.rows[0].status !== 'enviada_proveedor') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede pagar una OC que ya fue enviada al proveedor' });
    }
    const r = await client.query(`
      UPDATE purchase_orders SET
        status = 'pagada',
        factura_nro = COALESCE($1, factura_nro),
        factura_fecha = COALESCE($2, factura_fecha),
        factura_monto = COALESCE($3, factura_monto),
        pagado_por = $4,
        pagado_at = NOW()
      WHERE id = $5 RETURNING *`,
      [factura_nro||null, factura_fecha||null,
       factura_monto != null ? parseFloat(factura_monto) : null,
       req.user.id, req.params.id]
    );
    await syncApprovedPOCostsToWorkOrder(client, req.params.id);

    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[OC pagar]', err.message);
    res.status(500).json({ error: 'Error al registrar pago' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/recibir — Confirmar recepción (LEGACY)
//  ⚠ LEGACY: la UI ya NO usa este atajo. La recepción se hace por la vía
//  granular (POST /:id/recepciones), que deja historial detallado, respeta
//  OC abierta e impacta el stock. Se mantiene este endpoint solo por
//  compatibilidad, blindado contra OC abiertas.
//  La mercadería puede recibirse aunque el pago siga pendiente.
// ─────────────────────────────────────────────────────────────
router.post('/:id/recibir', authenticate, (req, res) => {
  // LEGACY deshabilitado: la recepción se hace por POST /:id/recepciones (granular),
  // que deja historial detallado, respeta OC abierta e impacta el stock.
  return res.status(410).json({ error: 'Endpoint legacy no disponible. Usá la recepción por cantidades (Recibir mercadería).' });
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/cerrar — Cierre manual de la OC (estado terminal 'cerrada')
//  Pensado sobre todo para OC abiertas / servicios fraccionados donde el cierre
//  no se da automático. El cierre automático (pago + entrega total) ocurre solo.
// ─────────────────────────────────────────────────────────────
router.post('/:id/cerrar', authenticate, requireRole('dueno','gerencia','compras'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT status FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }
    if (['rechazada','cerrada'].includes(cur.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `La OC ya está ${cur.rows[0].status}` });
    }
    if (!['enviada_proveedor','pagada','recibida'].includes(cur.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede cerrar una OC ya enviada al proveedor en adelante' });
    }
    const r = await client.query(
      `UPDATE purchase_orders SET status = 'cerrada' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[OC cerrar]', err.message);
    res.status(500).json({ error: 'Error al cerrar OC' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/reabrir — Reabre una OC cerrada (solo dueño/gerencia)
//  Calcula el estado real según lo ya ocurrido para no inventar trazabilidad:
//    delivery_status total → recibida
//    payment_status total  → pagada
//    si no                 → enviada_proveedor
//  Así, al corregir (ej. anular una recepción), el estado refleja la realidad.
//  Si pago+entrega siguen en total, el recálculo la vuelve a cerrar sola.
// ─────────────────────────────────────────────────────────────
router.post('/:id/reabrir', authenticate, requireRole('dueno','gerencia'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT status FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }
    if (cur.rows[0].status !== 'cerrada') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede reabrir una OC cerrada' });
    }
    const r = await client.query(
      `UPDATE purchase_orders SET status = CASE
         WHEN COALESCE(delivery_status,'pendiente') = 'total' THEN 'recibida'
         WHEN COALESCE(payment_status,'pendiente')  = 'total' THEN 'pagada'
         ELSE 'enviada_proveedor'
       END
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[OC reabrir]', err.message);
    res.status(500).json({ error: 'Error al reabrir OC' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/rechazar — Cualquier actor puede rechazar en su etapa
// ─────────────────────────────────────────────────────────────
router.post('/:id/rechazar', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','compras','tesoreria','paniol','contador','gerente_sucursal'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { motivo } = req.body;
    if (!motivo || motivo.trim().length < 5) {
      return res.status(400).json({ error: 'Debés indicar un motivo de rechazo (mínimo 5 caracteres)' });
    }

    await client.query('BEGIN');
    const cur = await client.query('SELECT status, requested_by FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }
    if (['rechazada','recibida','cerrada'].includes(cur.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta OC ya está en estado final' });
    }

    // Validar que el rol pueda rechazar en el estado actual
    const estadoActual = cur.rows[0].status;
    const rol = req.user.role;
    const esCreador = cur.rows[0].requested_by === req.user.id;
    const puedeRechazar = (
      ['dueno','gerencia'].includes(rol) ||
      // Solicitantes (jefe mant, paniol, contador): solo rechazan las propias en pendiente
      (['jefe_mantenimiento','paniol','contador'].includes(rol) && esCreador && estadoActual === 'pendiente_cotizacion') ||
      (rol === 'compras'   && ['pendiente_cotizacion','en_cotizacion','aprobada_compras'].includes(estadoActual)) ||
      (rol === 'tesoreria' && estadoActual === 'enviada_proveedor')
    );
    if (!puedeRechazar) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No podés rechazar esta OC en su estado actual' });
    }

    const r = await client.query(`
      UPDATE purchase_orders SET
        status = 'rechazada',
        motivo_rechazo = $1,
        rechazado_por = $2,
        rechazado_at = NOW()
      WHERE id = $3 RETURNING *`,
      [motivo.trim().substring(0, 500), req.user.id, req.params.id]
    );
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[OC rechazar]', err.message);
    res.status(500).json({ error: 'Error al rechazar OC' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/devolver — Devuelve la OC a la etapa anterior
//  con un motivo. El siguiente actor corrige y avanza de nuevo.
//
//  Reglas de a dónde vuelve cada estado:
//    en_cotizacion      → pendiente_cotizacion  (compras dice que faltan datos)
//    aprobada_compras   → en_cotizacion         (tesorería dice que algo está mal)
//    enviada_proveedor  → aprobada_compras      (compras des-envía / corrige)
//    pagada             → enviada_proveedor     (raro, pero puede pasar)
// ─────────────────────────────────────────────────────────────
router.post('/:id/devolver', authenticate, requireRole('dueno','gerencia','compras','tesoreria','jefe_mantenimiento','paniol','contador','gerente_sucursal'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { motivo } = req.body;
    if (!motivo || motivo.trim().length < 5) {
      return res.status(400).json({ error: 'Indicá el motivo de la devolución (mínimo 5 caracteres)' });
    }

    await client.query('BEGIN');
    const cur = await client.query('SELECT status, requested_by FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }

    const estadoActual = cur.rows[0].status;
    const rol = req.user.role;
    const esAdmin = ['dueno','gerencia'].includes(rol);

    // Mapa de devolución — a qué estado vuelve según desde dónde se devuelve
    const mapaDevolver = {
      'en_cotizacion':      'pendiente_cotizacion',
      'aprobada_compras':   'en_cotizacion',
      'enviada_proveedor':  'aprobada_compras',
      'pagada':             'enviada_proveedor'
    };
    const estadoNuevo = mapaDevolver[estadoActual];
    if (!estadoNuevo) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `No se puede devolver una OC en estado "${estadoActual}"` });
    }

    // Validar que el rol pueda devolver desde el estado actual
    const puedeDevolver = (
      esAdmin ||
      // Compras devuelve cuando está cotizando (al solicitante) o des-envía una OC ya enviada
      (rol === 'compras' && ['en_cotizacion','enviada_proveedor'].includes(estadoActual)) ||
      // Tesorería devuelve cuando tiene que pagar (a compras)
      (rol === 'tesoreria' && estadoActual === 'enviada_proveedor') ||
      // Solicitantes pueden devolver pagadas (a tesorería) si llegó algo mal — raro
      (['jefe_mantenimiento','paniol','contador'].includes(rol) && estadoActual === 'pagada' && cur.rows[0].requested_by === req.user.id)
    );
    if (!puedeDevolver) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No podés devolver esta OC en su estado actual' });
    }

    // Si vuelve de aprobada_compras → en_cotizacion, limpiar el "aprobado"
    // Si vuelve de en_cotizacion → pendiente_cotizacion, limpiar el "cotizado"
    // Si vuelve de pagada → aprobada_compras, limpiar el "pagado"
    const limpieza = {
      'pendiente_cotizacion': 'cotizado_por = NULL, cotizado_at = NULL',
      'en_cotizacion':        'aprobado_compras_por = NULL, aprobado_compras_at = NULL',
      'aprobada_compras':     'enviada_por = NULL, fecha_envio_prov = NULL',
      'enviada_proveedor':    'pagado_por = NULL, pagado_at = NULL'
    }[estadoNuevo];

    const r = await client.query(` 
      UPDATE purchase_orders SET
        status = $1,
        motivo_devolucion = $2,
        devuelto_por = $3,
        devuelto_at = NOW(),
        ${limpieza}
      WHERE id = $4 RETURNING *`,
      [estadoNuevo, motivo.trim().substring(0, 500), req.user.id, req.params.id]
    );
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[OC devolver]', err.message);
    res.status(500).json({ error: 'Error al devolver OC' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/toggle-open — marcar OC como abierta (para servicios fraccionados)
// ─────────────────────────────────────────────────────────────
router.post('/:id/toggle-open', authenticate, requireRole('dueno','gerencia','compras','jefe_mantenimiento','paniol','contador','gerente_sucursal'), async (req, res) => {
  try {
    const { is_open } = req.body;
    const r = await query(
      'UPDATE purchase_orders SET is_open = $1 WHERE id = $2 AND status IN (\'aprobada_compras\',\'enviada_proveedor\',\'pagada\',\'recibida\') RETURNING id, code, is_open',
      [!!is_open, req.params.id]
    );
    if (!r.rows[0]) {
      return res.status(404).json({ error: 'OC no encontrada o en estado inválido' });
    }
    res.json({ ok: true, ...r.rows[0] });
  } catch (err) {
    console.error('[toggle-open]', err.message);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

module.exports = router;
