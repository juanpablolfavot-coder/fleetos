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
  const n = parseFloat(v);
  if (isNaN(n)) return null;
  if (n < 0) return 0;
  if (n > 5) return 5;
  return n;
}

// Auto-create de la tabla
(async () => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS suppliers (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name            VARCHAR(200) NOT NULL,
      razon_social    VARCHAR(200),
      cuit            VARCHAR(20),
      iva_condition   VARCHAR(30),         -- 'responsable_inscripto' | 'monotributo' | 'exento' | 'consumidor_final'

      contact_person  VARCHAR(200),
      phone           VARCHAR(50),
      email           VARCHAR(200),
      website         VARCHAR(200),

      address         TEXT,
      city            VARCHAR(100),
      province        VARCHAR(100),
      postal_code     VARCHAR(20),

      rubros          TEXT[],              -- ['repuestos','cubiertas','aceites','administrativo'...]

      forma_pago      VARCHAR(30),         -- 'contado' | 'cuenta_corriente' | 'cheque' | 'transferencia'
      cc_dias         INT,                 -- días de CC acordados
      moneda          VARCHAR(5) DEFAULT 'ARS',
      discount_pct    NUMERIC(5,2) DEFAULT 0,

      delivery_time_days INT,              -- tiempo promedio de entrega
      rating          NUMERIC(2,1),        -- calificación 0.0-5.0
      total_compras   NUMERIC(14,2) DEFAULT 0,  -- acumulado

      bank_name       VARCHAR(100),
      bank_cbu        VARCHAR(30),
      bank_alias      VARCHAR(100),

      notes           TEXT,
      status          VARCHAR(20) DEFAULT 'activo'
                      CHECK (status IN ('activo','suspendido','blacklist')),
      blacklist_reason TEXT,

      active          BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status) WHERE active=TRUE`);
    await query(`CREATE INDEX IF NOT EXISTS idx_suppliers_cuit ON suppliers(cuit) WHERE active=TRUE AND cuit IS NOT NULL`);
  } catch(e) { console.error('[suppliers] init:', e.message); }
})();

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
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/suppliers/:id
router.get('/:id', authenticate, validateUUID('id'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/suppliers — crear
router.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','paniol'), auditAction('CREATE','suppliers'), async (req, res) => {
  try {
    const b = req.body;
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
        (b.cc_dias!==undefined && b.cc_dias!=='')?parseInt(b.cc_dias):null,
        b.moneda||'ARS',
        (b.discount_pct!==undefined && b.discount_pct!=='')?parseFloat(b.discount_pct):0,
        (b.delivery_time_days!==undefined && b.delivery_time_days!=='')?parseInt(b.delivery_time_days):null,
        clampRating(b.rating),
        b.bank_name||null, b.bank_cbu||null, b.bank_alias||null,
        b.notes||null, b.status||'activo', b.blacklist_reason||null
      ]
    );
    res.locals.recordId = r.rows[0].id;
    res.status(201).json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/suppliers/:id — actualizar
router.put('/:id', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','paniol'), validateUUID('id'), auditAction('UPDATE','suppliers'), async (req, res) => {
  try {
    const b = req.body;
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
        discount_pct  = COALESCE($17, discount_pct),
        delivery_time_days = COALESCE($18::int, delivery_time_days),
        rating        = COALESCE($19, rating),
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
        (b.cc_dias!==undefined && b.cc_dias!=='')?parseInt(b.cc_dias):null,
        b.moneda||null,
        (b.discount_pct!==undefined && b.discount_pct!=='')?parseFloat(b.discount_pct):null,
        (b.delivery_time_days!==undefined && b.delivery_time_days!=='')?parseInt(b.delivery_time_days):null,
        clampRating(b.rating),
        b.bank_name||null, b.bank_cbu||null, b.bank_alias||null,
        b.notes||null, b.status||null, b.blacklist_reason||null,
        req.params.id
      ]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.locals.recordId = r.rows[0].id;
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
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
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
