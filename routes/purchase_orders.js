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
const { query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

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
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS rechazado_por UUID REFERENCES users(id)`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS rechazado_at TIMESTAMPTZ`).catch(()=>{});
  await query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT`).catch(()=>{});

  await query(`CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL, cantidad NUMERIC(10,2) DEFAULT 1,
    unidad VARCHAR(20) DEFAULT 'un', precio_unit NUMERIC(14,2) DEFAULT 0,
    subtotal NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * precio_unit) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(()=>{});
  await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS stock_item_id UUID`).catch(()=>{});
  await query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS ingresado_stock BOOLEAN DEFAULT FALSE`).catch(()=>{});
}
ensureTables();

async function nextOCCode() {
  await query(`CREATE SEQUENCE IF NOT EXISTS oc_seq START 1 INCREMENT 1`).catch(()=>{});
  const r = await query("SELECT nextval('oc_seq') as num");
  return 'OC-' + String(parseInt(r.rows[0].num)).padStart(4, '0');
}

// ─────────────────────────────────────────────────────────────
//  HELPERS DE PERMISOS
// ─────────────────────────────────────────────────────────────

// Estados que un rol PUEDE VER (filtro de listado)
function estadosQueVe(role) {
  if (role === 'dueno' || role === 'gerencia') return null; // null = todos
  if (role === 'compras') {
    return ['pendiente_cotizacion','en_cotizacion','aprobada_compras','pagada','recibida','rechazada'];
  }
  if (role === 'tesoreria') {
    return ['aprobada_compras','pagada','recibida','rechazada'];
  }
  if (role === 'contador' || role === 'auditor') {
    return ['pagada','recibida'];
  }
  if (role === 'jefe_mantenimiento') {
    return null; // ve todos los estados, pero filtramos por requested_by abajo
  }
  return []; // otros roles: no ve nada
}

// Quita los precios de la respuesta si el rol no debe verlos (jefe_mant)
function ocultarPreciosSiCorresponde(po, role) {
  if (role !== 'jefe_mantenimiento') return po;
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
    const { status, limit = 100 } = req.query;
    const role = req.user.role;
    const userId = req.user.id;

    // Roles sin acceso al módulo
    const rolesPermitidos = ['dueno','gerencia','jefe_mantenimiento','compras','tesoreria','contador','auditor'];
    if (!rolesPermitidos.includes(role)) {
      return res.status(403).json({ error: 'No tenés permiso para ver órdenes de compra' });
    }

    let sql = `
      SELECT po.*, u.name as solicitante_nombre, u.role as solicitante_rol,
        COALESCE((SELECT SUM(cantidad * precio_unit) FROM purchase_order_items WHERE po_id = po.id), 0) as total_real
      FROM purchase_orders po
      LEFT JOIN users u ON u.id = po.requested_by
      WHERE 1=1`;
    const params = [];

    // Filtro de estados visibles por rol
    const estVis = estadosQueVe(role);
    if (estVis !== null) {
      if (estVis.length === 0) {
        return res.json([]);
      }
      params.push(estVis);
      sql += ` AND po.status = ANY($${params.length})`;
    }

    // Jefe mant: SOLO las que él creó
    if (role === 'jefe_mantenimiento') {
      params.push(userId);
      sql += ` AND po.requested_by = $${params.length}`;
    }

    // Filtro de estado específico si viene en query
    if (status) {
      params.push(status);
      sql += ` AND po.status = $${params.length}`;
    }

    sql += ` ORDER BY po.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await query(sql, params);

    // Ocultar precios si el rol no debe verlos
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
    const role = req.user.role;
    const userId = req.user.id;

    const po = await query(`
      SELECT po.*, u.name as solicitante_nombre, u.role as solicitante_rol
      FROM purchase_orders po
      LEFT JOIN users u ON u.id = po.requested_by
      WHERE po.id = $1`, [req.params.id]);
    if (!po.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });

    const oc = po.rows[0];

    // Verificar acceso
    const estVis = estadosQueVe(role);
    if (estVis !== null && !estVis.includes(oc.status)) {
      return res.status(403).json({ error: 'No tenés permiso para ver esta OC' });
    }
    if (role === 'jefe_mantenimiento' && oc.requested_by !== userId) {
      return res.status(403).json({ error: 'Solo podés ver las OCs que creaste vos' });
    }

    const items = await query('SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY created_at', [req.params.id]);
    const resultado = { ...oc, items: items.rows };
    res.json(ocultarPreciosSiCorresponde(resultado, role));
  } catch(err) {
    console.error('[OC detalle]', err.message);
    res.status(500).json({ error: 'Error al obtener OC' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST / — Crear nueva OC (Jefe mantenimiento)
//           SIN PRECIOS — solo descripción + opcional presupuesto
// ─────────────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','compras'), async (req, res) => {
  try {
    const {
      notes, sucursal, area, tipo='flota',
      vehicle_id, ot_id, asset_id, supplier_id,
      items=[],
      presupuesto_imagen, presupuesto_monto_estimado,
      // Campos opcionales si la crea compras con precios/proveedor ya definidos
      proveedor, forma_pago, cc_dias, moneda, iva_pct
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

    // Armar INSERT con columnas según estado inicial
    const _fp  = (forma_pago === 'contado' || forma_pago === 'cuenta_corriente') ? forma_pago : null;
    const _cc  = (_fp === 'cuenta_corriente' && cc_dias != null && cc_dias !== '') ? parseInt(cc_dias, 10) : null;
    const _mon = (moneda === 'USD' || moneda === 'ARS') ? moneda : 'ARS';
    const _iva = iva_pct != null ? parseFloat(iva_pct) : 0;

    const po = await query(`
      INSERT INTO purchase_orders (
        code, status, requested_by, sucursal, area, tipo,
        vehicle_id, ot_id, asset_id, supplier_id, notes,
        presupuesto_imagen, presupuesto_monto_estimado,
        proveedor, forma_pago, cc_dias, moneda, iva_pct,
        cotizado_por, cotizado_at,
        aprobado_compras_por, aprobado_compras_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
              $14, $15, $16, $17, $18,
              $19, $20,
              $21, $22)
      RETURNING *`,
      [
        code, estadoInicial, req.user.id, sucursal||null, area||null, tipo||'flota',
        vehicle_id||null, ot_id||null, asset_id||null, supplier_id||null,
        notes||null,
        presupuesto_imagen||null,
        presupuesto_monto_estimado != null ? parseFloat(presupuesto_monto_estimado) : null,
        proveedor||null, _fp, _cc, _mon, _iva,
        autoCotizado ? req.user.id : null,
        autoCotizado ? new Date() : null,
        autoAprobado ? req.user.id : null,
        autoAprobado ? new Date() : null
      ]
    );

    const poId = po.rows[0].id;
    // Items: si es jefe mant → sin precio. Si es compras → con el precio que haya cargado
    for (const item of items) {
      if (!item.descripcion?.trim()) continue;
      const precioItem = creadorEsCompras ? (parseFloat(item.precio_unit||0) || 0) : 0;
      await query(
        `INSERT INTO purchase_order_items (po_id, descripcion, cantidad, unidad, precio_unit, stock_item_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [poId, item.descripcion.trim(), parseFloat(item.cantidad||1), item.unidad||'un', precioItem, item.stock_item_id||null]
      );
    }

    // Si es compras y cargó precios, actualizar total_estimado
    if (creadorEsCompras && traePreciosCargados) {
      const t = await query('SELECT COALESCE(SUM(cantidad * precio_unit),0) as total FROM purchase_order_items WHERE po_id = $1', [poId]);
      await query('UPDATE purchase_orders SET total_estimado = $1 WHERE id = $2', [t.rows[0].total, poId]);
    }

    const full = await query('SELECT * FROM purchase_orders WHERE id=$1', [poId]);
    const itemsResult = await query('SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at', [poId]);
    const resultado = { ...full.rows[0], items: itemsResult.rows };
    res.status(201).json(ocultarPreciosSiCorresponde(resultado, req.user.role));
  } catch(err) {
    console.error('[OC crear]', err.message);
    res.status(500).json({ error: 'Error al crear la OC' });
  }
});

// ─────────────────────────────────────────────────────────────
//  PATCH /:id — Editar cabecera (solo creador o dueño)
// ─────────────────────────────────────────────────────────────
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const role = req.user.role;
    const userId = req.user.id;

    // Cargar OC actual
    const cur = await query('SELECT * FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    const oc = cur.rows[0];

    // Solo el creador o dueño/gerencia puede editar la cabecera
    const esCreador = oc.requested_by === userId;
    const esAdmin   = ['dueno','gerencia'].includes(role);
    if (!esCreador && !esAdmin) {
      return res.status(403).json({ error: 'Solo el creador o admin puede editar la cabecera' });
    }

    // Solo se puede editar si está en pendiente_cotizacion
    if (!esAdmin && oc.status !== 'pendiente_cotizacion') {
      return res.status(400).json({ error: 'Solo se puede editar cuando está pendiente de cotizar' });
    }

    const { notes, sucursal, area, tipo, vehicle_id, presupuesto_imagen, presupuesto_monto_estimado } = req.body;

    const r = await query(`
      UPDATE purchase_orders SET
        notes = COALESCE($1, notes),
        sucursal = COALESCE($2, sucursal),
        area = COALESCE($3, area),
        tipo = COALESCE($4, tipo),
        vehicle_id = COALESCE($5, vehicle_id),
        presupuesto_imagen = COALESCE($6, presupuesto_imagen),
        presupuesto_monto_estimado = COALESCE($7, presupuesto_monto_estimado)
      WHERE id = $8 RETURNING *`,
      [notes||null, sucursal||null, area||null, tipo||null,
       vehicle_id||null, presupuesto_imagen||null,
       presupuesto_monto_estimado != null ? parseFloat(presupuesto_monto_estimado) : null,
       req.params.id]
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
  try {
    const { items=[] } = req.body;
    if (!items.length) return res.status(400).json({ error: 'Debe haber al menos un artículo' });

    // Cargar OC y validar estado
    const cur = await query('SELECT status FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    const estadosEditables = ['pendiente_cotizacion','en_cotizacion'];
    if (!estadosEditables.includes(cur.rows[0].status)) {
      return res.status(400).json({ error: 'Solo se pueden editar items mientras la OC está pendiente o en cotización' });
    }

    // Reemplazar todos los items
    await query('DELETE FROM purchase_order_items WHERE po_id = $1', [req.params.id]);
    for (const item of items) {
      if (!item.descripcion?.trim()) continue;
      await query(
        `INSERT INTO purchase_order_items (po_id, descripcion, cantidad, unidad, precio_unit, stock_item_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.params.id, item.descripcion.trim(), parseFloat(item.cantidad||1),
         item.unidad||'un', parseFloat(item.precio_unit||0), item.stock_item_id||null]
      );
    }

    // Recalcular total_estimado
    const t = await query('SELECT COALESCE(SUM(cantidad * precio_unit),0) as total FROM purchase_order_items WHERE po_id = $1', [req.params.id]);
    await query('UPDATE purchase_orders SET total_estimado = $1 WHERE id = $2', [t.rows[0].total, req.params.id]);

    const itemsResult = await query('SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at', [req.params.id]);
    res.json({ items: itemsResult.rows, total_estimado: t.rows[0].total });
  } catch(err) {
    console.error('[OC items]', err.message);
    res.status(500).json({ error: 'Error al actualizar items' });
  }
});

// ─────────────────────────────────────────────────────────────
//  DELETE /:id — Borrar (solo dueño/gerencia/creador en estado inicial)
// ─────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','compras'), async (req, res) => {
  try {
    const cur = await query('SELECT * FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    const oc = cur.rows[0];

    if (['jefe_mantenimiento','compras'].includes(req.user.role)) {
      if (oc.requested_by !== req.user.id) {
        return res.status(403).json({ error: 'Solo podés borrar OCs que creaste vos' });
      }
      // Jefe mant solo puede borrar si está pendiente_cotizacion
      // Compras puede borrar si está pendiente_cotizacion o en_cotizacion (recién creada)
      if (req.user.role === 'jefe_mantenimiento' && oc.status !== 'pendiente_cotizacion') {
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
  try {
    const cur = await query('SELECT status FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    if (cur.rows[0].status !== 'pendiente_cotizacion') {
      return res.status(400).json({ error: 'Solo se puede tomar una OC pendiente de cotizar' });
    }
    const r = await query(`
      UPDATE purchase_orders SET
        status = 'en_cotizacion',
        cotizado_por = $1,
        cotizado_at = NOW()
      WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    res.json(r.rows[0]);
  } catch(err) {
    console.error('[OC tomar-cotizacion]', err.message);
    res.status(500).json({ error: 'Error al tomar la OC' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/aprobar-compras — Compras aprueba
//  en_cotizacion (o pendiente) → aprobada_compras (requiere precios cargados)
// ─────────────────────────────────────────────────────────────
router.post('/:id/aprobar-compras', authenticate, requireRole('dueno','gerencia','compras'), async (req, res) => {
  try {
    const { proveedor, supplier_id, forma_pago, cc_dias, moneda, iva_pct } = req.body;

    const cur = await query('SELECT status FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    if (!['en_cotizacion','pendiente_cotizacion'].includes(cur.rows[0].status)) {
      return res.status(400).json({ error: 'Solo se puede aprobar una OC en cotización' });
    }

    // Validar que haya al menos un item con precio > 0
    const items = await query('SELECT precio_unit FROM purchase_order_items WHERE po_id = $1', [req.params.id]);
    const hayPrecios = items.rows.some(it => parseFloat(it.precio_unit) > 0);
    if (!hayPrecios) {
      return res.status(400).json({ error: 'Debés cargar precios en los artículos antes de aprobar' });
    }

    // Validar forma_pago
    const _fp = (forma_pago === 'contado' || forma_pago === 'cuenta_corriente') ? forma_pago : null;
    const _cc = (_fp === 'cuenta_corriente' && cc_dias != null && cc_dias !== '') ? parseInt(cc_dias, 10) : null;
    const _mon = (moneda === 'USD' || moneda === 'ARS') ? moneda : 'ARS';

    const r = await query(`
      UPDATE purchase_orders SET
        status = 'aprobada_compras',
        proveedor = COALESCE($1, proveedor),
        supplier_id = COALESCE($2, supplier_id),
        forma_pago = $3,
        cc_dias = $4,
        moneda = $5,
        iva_pct = COALESCE($6, iva_pct),
        aprobado_compras_por = $7,
        aprobado_compras_at = NOW()
      WHERE id = $8 RETURNING *`,
      [proveedor||null, supplier_id||null, _fp, _cc, _mon,
       iva_pct != null ? parseFloat(iva_pct) : null,
       req.user.id, req.params.id]
    );
    res.json(r.rows[0]);
  } catch(err) {
    console.error('[OC aprobar-compras]', err.message);
    res.status(500).json({ error: 'Error al aprobar OC' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/pagar — Tesorería confirma el pago
//  aprobada_compras → pagada
// ─────────────────────────────────────────────────────────────
router.post('/:id/pagar', authenticate, requireRole('dueno','gerencia','tesoreria'), async (req, res) => {
  try {
    const { factura_nro, factura_fecha, factura_monto } = req.body;
    const cur = await query('SELECT status FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    if (cur.rows[0].status !== 'aprobada_compras') {
      return res.status(400).json({ error: 'Solo se puede pagar una OC aprobada por compras' });
    }
    const r = await query(`
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
    res.json(r.rows[0]);
  } catch(err) {
    console.error('[OC pagar]', err.message);
    res.status(500).json({ error: 'Error al registrar pago' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/recibir — Jefe mant confirma recepción
//  pagada → recibida
// ─────────────────────────────────────────────────────────────
router.post('/:id/recibir', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','compras'), async (req, res) => {
  try {
    const cur = await query('SELECT status, requested_by FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });

    // Jefe mant y compras: solo pueden recibir OCs que crearon ellos mismos
    if (['jefe_mantenimiento','compras'].includes(req.user.role) && cur.rows[0].requested_by !== req.user.id) {
      return res.status(403).json({ error: 'Solo podés recibir OCs que creaste vos' });
    }
    if (cur.rows[0].status !== 'pagada') {
      return res.status(400).json({ error: 'Solo se puede recibir una OC pagada' });
    }
    const r = await query(`
      UPDATE purchase_orders SET
        status = 'recibida',
        recibido_por = $1,
        recibido_at = NOW()
      WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    res.json(r.rows[0]);
  } catch(err) {
    console.error('[OC recibir]', err.message);
    res.status(500).json({ error: 'Error al recibir OC' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/rechazar — Cualquier actor puede rechazar en su etapa
// ─────────────────────────────────────────────────────────────
router.post('/:id/rechazar', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','compras','tesoreria'), async (req, res) => {
  try {
    const { motivo } = req.body;
    if (!motivo || motivo.trim().length < 5) {
      return res.status(400).json({ error: 'Debés indicar un motivo de rechazo (mínimo 5 caracteres)' });
    }

    const cur = await query('SELECT status, requested_by FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'OC no encontrada' });
    if (cur.rows[0].status === 'rechazada' || cur.rows[0].status === 'recibida') {
      return res.status(400).json({ error: 'Esta OC ya está en estado final' });
    }

    // Validar que el rol pueda rechazar en el estado actual
    const estadoActual = cur.rows[0].status;
    const rol = req.user.role;
    const puedeRechazar = (
      ['dueno','gerencia'].includes(rol) ||
      (rol === 'jefe_mantenimiento' && cur.rows[0].requested_by === req.user.id && estadoActual === 'pendiente_cotizacion') ||
      (rol === 'compras'   && ['pendiente_cotizacion','en_cotizacion'].includes(estadoActual)) ||
      (rol === 'tesoreria' && estadoActual === 'aprobada_compras')
    );
    if (!puedeRechazar) {
      return res.status(403).json({ error: 'No podés rechazar esta OC en su estado actual' });
    }

    const r = await query(`
      UPDATE purchase_orders SET
        status = 'rechazada',
        motivo_rechazo = $1,
        rechazado_por = $2,
        rechazado_at = NOW()
      WHERE id = $3 RETURNING *`,
      [motivo.trim().substring(0, 500), req.user.id, req.params.id]
    );
    res.json(r.rows[0]);
  } catch(err) {
    console.error('[OC rechazar]', err.message);
    res.status(500).json({ error: 'Error al rechazar OC' });
  }
});

module.exports = router;
