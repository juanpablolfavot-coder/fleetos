// ═══════════════════════════════════════════════════════════
//  FleetOS — Proveedores
//  Catálogo de proveedores con datos fiscales, contacto,
//  condiciones comerciales y rubros.
// ═══════════════════════════════════════════════════════════
const router = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole, auditAction } = require('../middleware/auth');
const { validateUUID } = require('../middleware/security');

// Helper: clampa rating a rango [0..5] para que NUMERIC(2,1) no se queje
function clampRating(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = nullableNumber(v);
  if (n === null) return null;
  if (n < 0) return 0;
  if (n > 5) return 5;
  return n;
}

function nullableInt(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || text.toLowerCase() === 'nan') return null;
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? n : null;
}

function nullableNumber(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || text.toLowerCase() === 'nan') return null;
  const n = parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}


// Normaliza textos de proveedores para que la carga quede pareja:
// primera letra en mayúscula y el resto en minúscula, conservando siglas comunes.
function titleCaseAR(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim().replace(/\s+/g, ' ');
  if (!raw) return null;

  const upperTokens = new Set([
    'SA','S.A','S.A.','SRL','S.R.L','S.R.L.','SAS','S.A.S','S.A.S.',
    'SNC','S.C.','SCA','CUIT','IVA','CBU','CVU','YPF','ACA','R3M','LD'
  ]);
  const romanTokens = new Set(['I','II','III','IV','V','VI','VII','VIII','IX','X']);
  const lowerJoiners = new Set(['de','del','la','las','los','y','e','el','en','a','al','da','do']);

  return raw.split(' ').map((word, index) => {
    const cleanUpper = word.replace(/[.,]/g, '').toUpperCase();
    if (upperTokens.has(cleanUpper) || romanTokens.has(cleanUpper)) return cleanUpper;

    const lower = word.toLocaleLowerCase('es-AR');
    if (index > 0 && lowerJoiners.has(lower)) return lower;

    return lower.replace(/(^|[-'’/])([\p{L}])/gu, (_, sep, letter) => sep + letter.toLocaleUpperCase('es-AR'));
  }).join(' ');
}

function normalizeSupplierPayload(body = {}) {
  const b = { ...body };
  const titleFields = ['name','razon_social','contact_person','address','city','province','bank_name'];
  for (const field of titleFields) {
    if (Object.prototype.hasOwnProperty.call(b, field)) b[field] = titleCaseAR(b[field]);
  }
  if (Object.prototype.hasOwnProperty.call(b, 'email')) {
    b.email = b.email ? String(b.email).trim().toLowerCase() : null;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'website')) {
    b.website = b.website ? String(b.website).trim().toLowerCase() : null;
    if (b.website === 'https://' || b.website === 'http://') b.website = null;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'bank_alias')) {
    b.bank_alias = b.bank_alias ? String(b.bank_alias).trim().toLowerCase() : null;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'cuit')) {
    b.cuit = b.cuit ? String(b.cuit).replace(/\D/g, '') : null;
  }
  if (Array.isArray(b.rubros)) {
    b.rubros = b.rubros.map(r => String(r).trim().toLowerCase()).filter(Boolean);
  }
  return b;
}

// Auto-create de la tabla
// Acá corría al arrancar el CREATE TABLE de suppliers y ~30 ALTER de sus
// columnas. Se sacó: db/schema.sql los declara y schema:check contra producción
// confirmó que no agregaban nada. En el log del deploy, ese CREATE TABLE
// figuraba tardando ~1800 ms para no crear nada.
// Los cambios de esquema nuevos van a db/migrations/.

// GET /api/suppliers — listar
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, rubro } = req.query;
    let sql = `SELECT * FROM suppliers WHERE active = TRUE`;
    const params = [];
    if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
    if (rubro)  { params.push(rubro);  sql += ` AND $${params.length} = ANY(rubros)`; }
    sql += ` ORDER BY name ASC`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch(err) { console.error(err && err.message); res.status(500).json({ error: 'Error del servidor' }); }
});

// ─────────────────────────────────────────────────────────────
//  GET /ranking/gastos — ranking de proveedores por gasto (mayor a menor).
//  Por cada proveedor: comprado (total OC c/IVA), facturado (c/IVA) y pagado.
//  Se ordena por facturado desc (el gasto real comprometido) y se omiten los
//  proveedores sin actividad. Debe ir ANTES de /:id para no chocar con esa ruta.
// ─────────────────────────────────────────────────────────────
router.get('/ranking/gastos', authenticate, requireRole('dueno','gerencia','compras','contador','tesoreria'), async (req, res) => {
  try {
    const r = await query(`
      SELECT s.id, s.name, s.cuit,
        COALESCE((SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id=s.id),0) AS oc_count,
        COALESCE((SELECT SUM(ROUND(po.total_estimado*(1+COALESCE(po.iva_pct,0)/100.0),2))
                  FROM purchase_orders po WHERE po.supplier_id=s.id),0) AS comprado,
        COALESCE((SELECT SUM(ROUND(f.invoice_monto*(1+COALESCE(f.iva_pct,0)/100.0),2))
                  FROM purchase_order_invoices f JOIN purchase_orders po ON po.id=f.po_id
                  WHERE po.supplier_id=s.id),0) AS facturado,
        COALESCE((SELECT SUM(p.monto) FROM purchase_order_payments p
                  JOIN purchase_order_invoices f ON f.id=p.invoice_id
                  JOIN purchase_orders po ON po.id=f.po_id
                  WHERE po.supplier_id=s.id),0) AS pagado
      FROM suppliers s
      WHERE s.active = TRUE`);

    const n = (v) => parseFloat(v) || 0;
    const ranking = r.rows
      .map((s) => ({
        id: s.id, name: s.name, cuit: s.cuit,
        oc_count: parseInt(s.oc_count, 10) || 0,
        comprado: n(s.comprado), facturado: n(s.facturado), pagado: n(s.pagado),
        saldo: +(n(s.facturado) - n(s.pagado)).toFixed(2),
      }))
      .filter((s) => s.comprado > 0 || s.facturado > 0 || s.pagado > 0)
      .sort((a, b) => b.facturado - a.facturado || b.comprado - a.comprado);

    const totales = ranking.reduce((t, s) => ({
      comprado: t.comprado + s.comprado,
      facturado: t.facturado + s.facturado,
      pagado: t.pagado + s.pagado,
    }), { comprado: 0, facturado: 0, pagado: 0 });

    res.json({ ranking, totales });
  } catch (err) {
    console.error('[supplier ranking]', err.message);
    res.status(500).json({ error: 'Error al cargar el ranking de proveedores' });
  }
});

// GET /api/suppliers/:id
router.get('/:id', authenticate, validateUUID('id'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(r.rows[0]);
  } catch(err) { console.error(err && err.message); res.status(500).json({ error: 'Error del servidor' }); }
});

// POST /api/suppliers — crear
router.post('/', authenticate, requireRole('dueno','gerencia','paniol','proveedores'), auditAction('CREATE','suppliers'), async (req, res) => {
  try {
    const b = normalizeSupplierPayload(req.body);
    if (!b.name) return res.status(400).json({ error: 'El nombre es obligatorio' });

    // CUIT debe ser único si se provee
    if (b.cuit) {
      const exists = await query('SELECT id FROM suppliers WHERE cuit = $1 AND active = TRUE', [b.cuit]);
      if (exists.rows[0]) return res.status(409).json({ error: `Ya existe un proveedor con CUIT ${b.cuit}` });
    }

    const r = await query(
      `INSERT INTO suppliers (
        name, razon_social, cuit, iva_condition,
        contact_person, phone, email, website,
        address, city, province, postal_code,
        rubros, forma_pago, cc_dias, moneda, discount_pct,
        delivery_time_days, rating,
        bank_name, bank_cbu, bank_alias,
        notes, status, blacklist_reason
      ) VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,$8,
        $9,$10,$11,$12,
        $13,$14,$15,$16,$17,
        $18,$19,
        $20,$21,$22,
        $23,$24,$25
      ) RETURNING *`,
      [
        b.name, b.razon_social||null, b.cuit||null, b.iva_condition||null,
        b.contact_person||null, b.phone||null, b.email||null, b.website||null,
        b.address||null, b.city||null, b.province||null, b.postal_code||null,
        Array.isArray(b.rubros)?b.rubros:null,
        b.forma_pago||null,
        nullableInt(b.cc_dias),
        b.moneda||'ARS',
        nullableNumber(b.discount_pct) ?? 0,
        nullableInt(b.delivery_time_days),
        clampRating(b.rating),
        b.bank_name||null, b.bank_cbu||null, b.bank_alias||null,
        b.notes||null, b.status||'activo', b.blacklist_reason||null
      ]
    );
    res.locals.recordId = r.rows[0].id;
    res.status(201).json(r.rows[0]);
  } catch(err) { console.error(err && err.message); res.status(500).json({ error: 'Error del servidor' }); }
});

// PUT /api/suppliers/:id — actualizar
router.put('/:id', authenticate, requireRole('dueno','gerencia','paniol','proveedores'), validateUUID('id'), auditAction('UPDATE','suppliers'), async (req, res) => {
  try {
    const b = normalizeSupplierPayload(req.body);

    if (b.cuit) {
      const exists = await query('SELECT id FROM suppliers WHERE cuit = $1 AND id <> $2 AND active = TRUE', [b.cuit, req.params.id]);
      if (exists.rows[0]) return res.status(409).json({ error: `Ya existe otro proveedor con CUIT ${b.cuit}` });
    }

    const r = await query(
      `UPDATE suppliers SET
        name          = COALESCE($1, name),
        razon_social  = COALESCE($2, razon_social),
        cuit          = COALESCE($3, cuit),
        iva_condition = COALESCE($4, iva_condition),
        contact_person= COALESCE($5, contact_person),
        phone         = COALESCE($6, phone),
        email         = COALESCE($7, email),
        website       = COALESCE($8, website),
        address       = COALESCE($9, address),
        city          = COALESCE($10, city),
        province      = COALESCE($11, province),
        postal_code   = COALESCE($12, postal_code),
        rubros        = COALESCE($13::text[], rubros),
        forma_pago    = COALESCE($14, forma_pago),
        cc_dias       = COALESCE($15::int, cc_dias),
        moneda        = COALESCE($16, moneda),
        discount_pct  = COALESCE($17::numeric, discount_pct),
        delivery_time_days = COALESCE($18::int, delivery_time_days),
        rating        = COALESCE($19::numeric, rating),
        bank_name     = COALESCE($20, bank_name),
        bank_cbu      = COALESCE($21, bank_cbu),
        bank_alias    = COALESCE($22, bank_alias),
        notes         = COALESCE($23, notes),
        status        = COALESCE($24, status),
        blacklist_reason = COALESCE($25, blacklist_reason),
        updated_at    = NOW()
      WHERE id = $26 AND active = TRUE RETURNING *`,
      [
        b.name||null, b.razon_social||null, b.cuit||null, b.iva_condition||null,
        b.contact_person||null, b.phone||null, b.email||null, b.website||null,
        b.address||null, b.city||null, b.province||null, b.postal_code||null,
        Array.isArray(b.rubros)?b.rubros:null,
        b.forma_pago||null,
        nullableInt(b.cc_dias),
        b.moneda||null,
        nullableNumber(b.discount_pct),
        nullableInt(b.delivery_time_days),
        clampRating(b.rating),
        b.bank_name||null, b.bank_cbu||null, b.bank_alias||null,
        b.notes||null, b.status||null, b.blacklist_reason||null,
        req.params.id
      ]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.locals.recordId = r.rows[0].id;
    res.json(r.rows[0]);
  } catch(err) { console.error('[suppliers] PUT:', err); res.status(500).json({ error: 'Error del servidor' }); }
});

// DELETE /api/suppliers/:id — soft delete
router.delete('/:id', authenticate, requireRole('dueno','gerencia'), validateUUID('id'), auditAction('DELETE','suppliers'), async (req, res) => {
  try {
    const r = await query(
      'UPDATE suppliers SET active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json({ ok: true });
  } catch(err) { console.error(err && err.message); res.status(500).json({ error: 'Error del servidor' }); }
});

// ─────────────────────────────────────────────────────────────
//  GET /:id/cuenta — resumen de cuenta del proveedor:
//  totales (comprado / facturado / pagado / saldo) + OCs + movimientos.
//  saldo = facturado − pagado (>0 = le debemos; <0 = saldo a favor).
// ─────────────────────────────────────────────────────────────
router.get('/:id/cuenta', authenticate, requireRole('dueno','gerencia','compras','contador','tesoreria'), validateUUID('id'), async (req, res) => {
  try {
    const id = req.params.id;
    const sup = await query('SELECT id, name, cuit, email FROM suppliers WHERE id=$1', [id]);
    if (!sup.rows[0]) return res.status(404).json({ error: 'Proveedor no encontrado' });

    const ocsRes = await query(`
      SELECT po.id, po.code, po.created_at, po.status,
        ROUND(po.total_estimado * (1 + COALESCE(po.iva_pct,0)/100.0), 2) AS total_oc,
        COALESCE((SELECT SUM(ROUND(f.invoice_monto*(1+COALESCE(f.iva_pct,0)/100.0),2))
                  FROM purchase_order_invoices f WHERE f.po_id=po.id),0) AS facturado,
        COALESCE((SELECT SUM(p.monto) FROM purchase_order_payments p
                  JOIN purchase_order_invoices f ON f.id=p.invoice_id WHERE f.po_id=po.id),0) AS pagado
      FROM purchase_orders po
      WHERE po.supplier_id=$1
      ORDER BY po.created_at DESC`, [id]);

    const movRes = await query(`
      SELECT * FROM (
        SELECT 'factura' AS tipo, f.invoice_fecha AS fecha, f.invoice_nro AS ref, po.code AS oc_code, NULL AS metodo,
               ROUND(f.invoice_monto*(1+COALESCE(f.iva_pct,0)/100.0),2) AS monto
        FROM purchase_order_invoices f JOIN purchase_orders po ON po.id=f.po_id
        WHERE po.supplier_id=$1
        UNION ALL
        SELECT 'pago' AS tipo, p.paid_at::date AS fecha, NULL AS ref, po.code AS oc_code, p.metodo AS metodo, p.monto AS monto
        FROM purchase_order_payments p
        JOIN purchase_order_invoices f ON f.id=p.invoice_id
        JOIN purchase_orders po ON po.id=f.po_id
        WHERE po.supplier_id=$1
      ) m
      ORDER BY fecha ASC, (tipo='pago')`, [id]);

    const n = (v) => parseFloat(v) || 0;
    const ocs = ocsRes.rows;
    const comprado  = ocs.reduce((s, o) => s + n(o.total_oc), 0);
    const facturado = ocs.reduce((s, o) => s + n(o.facturado), 0);
    const pagado    = ocs.reduce((s, o) => s + n(o.pagado), 0);

    // Movimientos con saldo acumulado (facturado − pagado, cronológico).
    let acum = 0;
    const movimientos = movRes.rows.map((m) => {
      acum += m.tipo === 'factura' ? n(m.monto) : -n(m.monto);
      return { ...m, monto: n(m.monto), saldo_acum: +acum.toFixed(2) };
    });

    res.json({
      supplier: sup.rows[0],
      totals: { comprado, facturado, pagado, saldo: +(facturado - pagado).toFixed(2) },
      ocs,
      movimientos,
    });
  } catch (err) {
    console.error('[supplier cuenta]', err.message);
    res.status(500).json({ error: 'Error al cargar la cuenta del proveedor' });
  }
});

module.exports = router;
