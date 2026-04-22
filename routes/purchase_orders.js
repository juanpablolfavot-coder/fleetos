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
  if (role === 'auditor') {
    return ['pagada','recibida'];
  }
  if (['jefe_mantenimiento','paniol','contador'].includes(role)) {
    return null; // ve todos los estados, pero filtramos por requested_by abajo (solo las propias)
  }
  return []; // otros roles: no ve nada
}

// Quita los precios de la respuesta si el rol no debe verlos
// (jefe_mant, paniol, contador — son solicitantes, no gestionan precios)
function ocultarPreciosSiCorresponde(po, role) {
  const rolesSinPrecio = ['jefe_mantenimiento','paniol','contador'];
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
    // Nunca cachear el listado (datos cambian con cada transición de estado)
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    const { status, limit = 100 } = req.query;
    const role = req.user.role;
    const userId = req.user.id;

    // Roles sin acceso al módulo
    const rolesPermitidos = ['dueno','gerencia','jefe_mantenimiento','compras','tesoreria','contador','auditor'];
    if (!rolesPermitidos.includes(role)) {
      return res.status(403).json({ error: 'No tenés permiso para ver órdenes de compra' });
    }

    let sql = `
      SELECT po.*,
        u.name  as solicitante_nombre, u.role as solicitante_rol,
        uc.name as cotizador_nombre,
        ua.name as aprobador_nombre,
        up.name as pagador_nombre,
        ur.name as receptor_nombre,
        urech.name as rechazador_nombre,
        COALESCE((SELECT SUM(cantidad * precio_unit) FROM purchase_order_items WHERE po_id = po.id), 0) as total_real
      FROM purchase_orders po
      LEFT JOIN users u     ON u.id     = po.requested_by
      LEFT JOIN users uc    ON uc.id    = po.cotizado_por
      LEFT JOIN users ua    ON ua.id    = po.aprobado_compras_por
      LEFT JOIN users up    ON up.id    = po.pagado_por
      LEFT JOIN users ur    ON ur.id    = po.recibido_por
      LEFT JOIN users urech ON urech.id = po.rechazado_por
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

    // Solicitantes (jefe mant, paniol, contador): SOLO ven las que crearon ellos
    if (['jefe_mantenimiento','paniol','contador'].includes(role)) {
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

    // Verificar acceso
    const estVis = estadosQueVe(role);
    if (estVis !== null && !estVis.includes(oc.status)) {
      return res.status(403).json({ error: 'No tenés permiso para ver esta OC' });
    }
    if (['jefe_mantenimiento','paniol','contador'].includes(role) && oc.requested_by !== userId) {
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
router.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','compras','paniol','contador'), async (req, res) => {
  const client = await pool.connect();
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

    // ── TRANSACCIÓN: header + items + total_estimado deben persistir juntos o nada ──
    await client.query('BEGIN');

    const po = await client.query(`
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
      await client.query(
        `INSERT INTO purchase_order_items (po_id, descripcion, cantidad, unidad, precio_unit, stock_item_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [poId, item.descripcion.trim(), parseFloat(item.cantidad||1), item.unidad||'un', precioItem, item.stock_item_id||null]
      );
    }

    // Si es compras y cargó precios, actualizar total_estimado
    if (creadorEsCompras && traePreciosCargados) {
      const t = await client.query('SELECT COALESCE(SUM(cantidad * precio_unit),0) as total FROM purchase_order_items WHERE po_id = $1', [poId]);
      await client.query('UPDATE purchase_orders SET total_estimado = $1 WHERE id = $2', [t.rows[0].total, poId]);
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
        if (['recibida','rechazada'].includes(estado)) {
          // En estados finales solo notas/motivos
          return ['notes'];
        }
        return ['notes','sucursal','area','tipo','vehicle_id','presupuesto_imagen','presupuesto_monto_estimado',
                'proveedor','supplier_id','iva_pct','forma_pago','cc_dias','moneda',
                'factura_nro','factura_fecha','factura_monto'];
      }
      if (role === 'compras' && ['pendiente_cotizacion','en_cotizacion'].includes(estado)) {
        return ['proveedor','supplier_id','iva_pct','forma_pago','cc_dias','moneda','notes',
                'factura_nro','factura_fecha','factura_monto'];
      }
      if (role === 'tesoreria' && estado === 'aprobada_compras') {
        // Tesorería solo puede corregir notas, no datos de factura (ya llegan cargados)
        return ['notes'];
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

    // Armar UPDATE dinámico con solo los campos permitidos que llegaron
    const sets = [];
    const params = [];
    const campoVal = {
      proveedor:     () => (req.body.proveedor !== undefined ? (req.body.proveedor || null) : undefined),
      supplier_id:   () => (req.body.supplier_id !== undefined ? (req.body.supplier_id || null) : undefined),
      iva_pct:       () => (req.body.iva_pct !== undefined ? parseFloat(req.body.iva_pct) || 0 : undefined),
      forma_pago:    () => {
        if (req.body.forma_pago === undefined) return undefined;
        const v = req.body.forma_pago;
        return (v === 'contado' || v === 'cuenta_corriente') ? v : null;
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

    // Reemplazar todos los items
    await client.query('DELETE FROM purchase_order_items WHERE po_id = $1', [req.params.id]);
    for (const item of items) {
      if (!item.descripcion?.trim()) continue;
      await client.query(
        `INSERT INTO purchase_order_items (po_id, descripcion, cantidad, unidad, precio_unit, stock_item_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.params.id, item.descripcion.trim(), parseFloat(item.cantidad||1),
         item.unidad||'un', parseFloat(item.precio_unit||0), item.stock_item_id||null]
      );
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
//  DELETE /:id — Borrar (solo dueño/gerencia/creador en estado inicial)
// ─────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','compras','paniol','contador'), async (req, res) => {
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
    if (!factura_nro || !String(factura_nro).trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cargá el N° de factura antes de aprobar (la factura física la tiene compras)' });
    }
    if (factura_monto == null || factura_monto === '' || parseFloat(factura_monto) <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cargá el monto de la factura antes de aprobar' });
    }

    // Validar forma_pago
    const _fp = (forma_pago === 'contado' || forma_pago === 'cuenta_corriente') ? forma_pago : null;
    const _cc = (_fp === 'cuenta_corriente' && cc_dias != null && cc_dias !== '') ? parseInt(cc_dias, 10) : null;
    const _mon = (moneda === 'USD' || moneda === 'ARS') ? moneda : 'ARS';

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
      [proveedor||null, supplier_id||null, _fp, _cc, _mon,
       iva_pct != null ? parseFloat(iva_pct) : null,
       factura_nro ? String(factura_nro).trim() : null,
       factura_fecha || null,
       factura_monto != null && factura_monto !== '' ? parseFloat(factura_monto) : null,
       req.user.id, req.params.id]
    );
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
//  POST /:id/pagar — Tesorería confirma el pago
//  aprobada_compras → pagada
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
    if (cur.rows[0].status !== 'aprobada_compras') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede pagar una OC aprobada por compras' });
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
//  POST /:id/recibir — Jefe mant confirma recepción
//  pagada → recibida
// ─────────────────────────────────────────────────────────────
router.post('/:id/recibir', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','compras','paniol','contador'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT status, requested_by FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }

    // Jefe mant, compras, paniol, contador: solo pueden recibir las que crearon
    if (['jefe_mantenimiento','compras','paniol','contador'].includes(req.user.role) && cur.rows[0].requested_by !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Solo podés recibir OCs que creaste vos' });
    }
    if (cur.rows[0].status !== 'pagada') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede recibir una OC pagada' });
    }
    const r = await client.query(`
      UPDATE purchase_orders SET
        status = 'recibida',
        recibido_por = $1,
        recibido_at = NOW()
      WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[OC recibir]', err.message);
    res.status(500).json({ error: 'Error al recibir OC' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /:id/rechazar — Cualquier actor puede rechazar en su etapa
// ─────────────────────────────────────────────────────────────
router.post('/:id/rechazar', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','compras','tesoreria','paniol','contador'), async (req, res) => {
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
    if (cur.rows[0].status === 'rechazada' || cur.rows[0].status === 'recibida') {
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
      (rol === 'compras'   && ['pendiente_cotizacion','en_cotizacion'].includes(estadoActual)) ||
      (rol === 'tesoreria' && estadoActual === 'aprobada_compras')
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
//    pagada             → aprobada_compras      (raro, pero puede pasar)
// ─────────────────────────────────────────────────────────────
router.post('/:id/devolver', authenticate, requireRole('dueno','gerencia','compras','tesoreria','jefe_mantenimiento','paniol','contador'), async (req, res) => {
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
      'pagada':             'aprobada_compras'
    };
    const estadoNuevo = mapaDevolver[estadoActual];
    if (!estadoNuevo) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `No se puede devolver una OC en estado "${estadoActual}"` });
    }

    // Validar que el rol pueda devolver desde el estado actual
    const puedeDevolver = (
      esAdmin ||
      // Compras devuelve cuando está cotizando (al solicitante)
      (rol === 'compras' && estadoActual === 'en_cotizacion') ||
      // Tesorería devuelve cuando tiene que pagar (a compras)
      (rol === 'tesoreria' && estadoActual === 'aprobada_compras') ||
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
      'aprobada_compras':     'pagado_por = NULL, pagado_at = NULL'
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

module.exports = router;
