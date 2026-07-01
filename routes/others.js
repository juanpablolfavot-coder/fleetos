// ═══════════════════════════════════════════════════════════
//  FleetOS — Rutas adicionales (combustible, cubiertas, documentos, usuarios, config, checklists, encargado)
// ═══════════════════════════════════════════════════════════
const express    = require('express');
const fuelRouter = express.Router();
const tireRouter = express.Router();
const docRouter  = express.Router();
const userRouter = express.Router();
const { pool, query } = require('../db/pool');
const { authenticate, requireRole, requireOwner, auditAction } = require('../middleware/auth');
const { auditChange } = require('../middleware/audit');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');
const bcrypt     = require('bcryptjs');

const AR_TZ = 'America/Argentina/Buenos_Aires';
const AR_TS_FMT = 'YYYY-MM-DD"T"HH24:MI:SS';
function arTsSql(column) {
  return `to_char(${column} AT TIME ZONE '${AR_TZ}', '${AR_TS_FMT}')`;
}

// ======= COMBUSTIBLE =======
// Migraciones livianas de combustible: columnas y tickets básicos de ingreso a cisterna y despachos internos.
// Se ejecuta UNA sola vez por proceso (promise cacheado). Antes corría todos los ALTER/CREATE INDEX
// en cada request a combustible -> esa era la causa de los SLOW QUERY.
let _fuelTankReadyPromise = null;
function ensureFuelTankEntriesTable() {
  if (_fuelTankReadyPromise) return _fuelTankReadyPromise;
  _fuelTankReadyPromise = (async () => {
  await query("ALTER TABLE tanks ADD COLUMN IF NOT EXISTS price_per_l NUMERIC(12,2)").catch(() => {});
  await query("ALTER TABLE tanks ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE").catch(() => {});
  await query("ALTER TABLE tanks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()").catch(() => {});
  await query("ALTER TABLE tanks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()").catch(() => {});
  await query(`
    CREATE TABLE IF NOT EXISTS fuel_tank_entries (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tank_id     UUID REFERENCES tanks(id),
      type        VARCHAR(20) NOT NULL,
      liters      NUMERIC(12,2) NOT NULL,
      price_per_l NUMERIC(12,2),
      supplier    TEXT,
      remito      TEXT,
      notes       TEXT,
      previous_l  NUMERIC(12,2),
      new_l       NUMERIC(12,2),
      created_by  UUID REFERENCES users(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await query("CREATE INDEX IF NOT EXISTS idx_fuel_tank_entries_created ON fuel_tank_entries(created_at DESC)").catch(() => {});
  await query("CREATE INDEX IF NOT EXISTS idx_fuel_tank_entries_tank ON fuel_tank_entries(tank_id)").catch(() => {});

  await query(`
    CREATE TABLE IF NOT EXISTS fuel_internal_dispatches (
      id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tank_id             UUID REFERENCES tanks(id),
      type                VARCHAR(20) NOT NULL DEFAULT 'gasoil',
      liters              NUMERIC(12,2) NOT NULL,
      destination         TEXT NOT NULL,
      destination_detail  TEXT,
      responsible         TEXT,
      transport_vehicle   TEXT,
      remito              TEXT,
      notes               TEXT,
      previous_l          NUMERIC(12,2),
      new_l               NUMERIC(12,2),
      status              VARCHAR(20) NOT NULL DEFAULT 'despachado',
      received_by         TEXT,
      received_liters     NUMERIC(12,2),
      receive_notes       TEXT,
      received_at         TIMESTAMPTZ,
      created_by          UUID REFERENCES users(id),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await query("ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS destination_detail TEXT").catch(() => {});
  await query("ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS responsible TEXT").catch(() => {});
  await query("ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS transport_vehicle TEXT").catch(() => {});
  await query("ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS received_by TEXT").catch(() => {});
  await query("ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS received_liters NUMERIC(12,2)").catch(() => {});
  await query("ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS receive_notes TEXT").catch(() => {});
  await query("ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ").catch(() => {});
  await query("ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS destination_tank_id UUID REFERENCES tanks(id)").catch(() => {});
  await query("ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS destination_stock_applied BOOLEAN NOT NULL DEFAULT FALSE").catch(() => {});
  await query("ALTER TABLE fuel_internal_dispatches ADD COLUMN IF NOT EXISTS destination_stock_applied_at TIMESTAMPTZ").catch(() => {});
  await query("CREATE INDEX IF NOT EXISTS idx_fuel_dispatches_created ON fuel_internal_dispatches(created_at DESC)").catch(() => {});
  await query("CREATE INDEX IF NOT EXISTS idx_fuel_dispatches_tank ON fuel_internal_dispatches(tank_id)").catch(() => {});
  await query("CREATE INDEX IF NOT EXISTS idx_fuel_dispatches_status ON fuel_internal_dispatches(status)").catch(() => {});
  })().catch((err) => { _fuelTankReadyPromise = null; throw err; });
  return _fuelTankReadyPromise;
}

function _userSucursal(req) {
  return String(req?.user?.sucursal || '').trim();
}
function _isGerenteSucursal(req) {
  return req?.user?.role === 'gerente_sucursal';
}
function _normalizeSucursalText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
function _branchPatterns(sucursal) {
  const raw = String(sucursal || '').trim();
  const noParen = raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(new Set([raw, noParen].map(_normalizeSucursalText).filter(x => x.length >= 3)));
}
function _normSql(column) {
  return `LOWER(translate(COALESCE(${column},''),'áéíóúÁÉÍÓÚñÑ','aeiouAEIOUnN'))`;
}
function _likeSucursal(sucursal) {
  return `%${_normalizeSucursalText(sucursal)}%`;
}
function _fuelTankType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'urea') return 'urea';
  return 'fuel';
}
function _fuelTankDisplay(type) {
  return _fuelTankType(type) === 'urea' ? 'Urea' : 'Gasoil';
}
function _branchTankLocation(sucursal, type) {
  const s = String(sucursal || '').trim() || 'Sucursal';
  return `${s} - Tanque ${_fuelTankDisplay(type)}`;
}
function _isAlreadyReceived(status) {
  return ['recibido','recibida','received'].includes(String(status || '').trim().toLowerCase());
}

async function _addFuelToDestinationTank(client, { destinoSucursal, tankType, liters, originPricePerL }) {
  const suc = String(destinoSucursal || '').trim();
  const litros = parseFloat(liters) || 0;
  if (!suc || litros <= 0) return null;

  const dbType = _fuelTankType(tankType);
  const patterns = _branchPatterns(suc);
  let findSql = `SELECT * FROM tanks WHERE type=$1 AND active IS DISTINCT FROM FALSE`;
  const findParams = [dbType];

  if (patterns.length) {
    const pieces = [];
    for (const pat of patterns) {
      findParams.push(`%${pat}%`);
      pieces.push(`${_normSql('location')} LIKE $${findParams.length}`);
    }
    findSql += ' AND (' + pieces.join(' OR ') + ')';
  } else {
    findSql += ' AND 1=0';
  }

  findSql += ' ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1 FOR UPDATE';
  const existing = await client.query(findSql, findParams);

  if (existing.rows[0]) {
    const current = parseFloat(existing.rows[0].current_l) || 0;
    const next = current + litros;
    const upd = await client.query(
      `UPDATE tanks
          SET current_l=$1,
              capacity_l=GREATEST(COALESCE(capacity_l,0), $1),
              updated_at=NOW()
        WHERE id=$2
        RETURNING *`,
      [next, existing.rows[0].id]
    );
    return upd.rows[0];
  }

  const loc = _branchTankLocation(suc, dbType);
  const ins = await client.query(
    `INSERT INTO tanks(type, capacity_l, current_l, price_per_l, location, active)
     VALUES ($1,$2,$3,$4,$5,TRUE)
     RETURNING *`,
    [dbType, litros, litros, originPricePerL || null, loc]
  );
  return ins.rows[0];
}
function _branchEmptyJson(req, res) {
  if (_isGerenteSucursal(req) && !_userSucursal(req)) {
    res.json([]);
    return true;
  }
  return false;
}
function _appendBranchTextPredicate(req, params, sqlRef, columns) {
  const suc = _userSucursal(req);
  if (!_isGerenteSucursal(req)) return;
  const patterns = _branchPatterns(suc);
  if (!patterns.length) {
    sqlRef.value += ' AND 1=0';
    return;
  }
  const pieces = [];
  for (const pat of patterns) {
    params.push(`%${pat}%`);
    const idx = params.length;
    for (const c of columns) pieces.push(`${_normSql(c)} LIKE $${idx}`);
  }
  sqlRef.value += ' AND (' + pieces.join(' OR ') + ')';
}
function _addVehicleBranchFilter(req, params, sqlRef, alias = 'v') {
  _appendBranchTextPredicate(req, params, sqlRef, [`${alias}.base`]);
}
function _addTextBranchFilter(req, params, sqlRef, columns) {
  _appendBranchTextPredicate(req, params, sqlRef, columns);
}

(async () => {
  try {
    await ensureFuelTankEntriesTable();
  } catch(e) {}
})();

// Garantiza la columna driver_name de fuel_logs ANTES de leer el listado.
// (El listado la usa; sin esto, si no se corrió migrate ni se registró una carga
// nueva, la consulta fallaba y el listado salía VACÍO — parecía que se borraban
// las cargas, pero estaban intactas.) Se ejecuta una sola vez por proceso.
let _fuelDriverColEnsured = false;
async function ensureFuelDriverCol() {
  if (_fuelDriverColEnsured) return;
  try { await query(`ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS driver_name VARCHAR(150)`); } catch (_) {}
  _fuelDriverColEnsured = true;
}

fuelRouter.get('/', authenticate, async (req, res) => {
  try {
    await ensureFuelDriverCol();
    const { vehicle_id } = req.query;
    const limit  = Math.min(Math.max(parseInt(req.query.limit  || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
    let sql = `SELECT fl.*, v.code AS vehicle_code, v.plate,
        COALESCE(NULLIF(fl.driver_name,''), NULLIF(v.driver_name,''), u.name) AS driver_name,
        u.name AS cargado_por
      FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
      LEFT JOIN users u ON u.id = fl.driver_id WHERE 1=1`;
    const params = [];
    const ref = { value: sql };
    if (req.user.role === 'chofer') { params.push(req.user.id); ref.value += ` AND fl.driver_id=$${params.length}`; }
    _addVehicleBranchFilter(req, params, ref, 'v');
    if (vehicle_id) { params.push(vehicle_id); ref.value += ` AND fl.vehicle_id=$${params.length}`; }
    ref.value += ` ORDER BY fl.logged_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limit, offset);
    res.json((await query(ref.value, params)).rows);
  } catch (err) { console.error('[fuel GET]', err.message); res.status(500).json({ error: 'Error combustible' }); }
});
fuelRouter.get('/tanks', authenticate, async (req, res) => {
  try {
    await ensureFuelTankEntriesTable();
    let sql = 'SELECT id, type, capacity_l, current_l, location, price_per_l FROM tanks WHERE active IS DISTINCT FROM FALSE';
    const params = [];
    const ref = { value: sql };
    _addTextBranchFilter(req, params, ref, ['location']);
    ref.value += ' ORDER BY type ASC, location ASC';
    res.json((await query(ref.value, params)).rows);
  }
  catch (err) {
    console.error('[fuel tanks GET]', err.message);
    res.status(500).json({ error: 'Error cisternas' });
  }
});

// Historial de ingresos a cisterna: sirve como ticket básico del sistema.
fuelRouter.get('/tank-entries', authenticate, async (req, res) => {
  try {
    await ensureFuelTankEntriesTable();
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const params = [];
    let sql = `
      SELECT e.*, ${arTsSql('e.created_at')} AS created_at_ar, t.location AS tank_location, t.capacity_l, u.name AS created_by_name
      FROM fuel_tank_entries e
      LEFT JOIN tanks t ON t.id = e.tank_id
      LEFT JOIN users u ON u.id = e.created_by
      WHERE 1=1`;
    const ref = { value: sql };
    _addTextBranchFilter(req, params, ref, ['t.location']);
    params.push(limit);
    ref.value += ` ORDER BY e.created_at DESC LIMIT $${params.length}`;
    const r = await query(ref.value, params);
    res.json(r.rows);
  } catch (err) {
    console.error('[fuel tank-entries GET]', err.message);
    res.status(500).json({ error: 'Error al obtener tickets de cisterna' });
  }
});

// Registrar ingreso a cisterna + crear ticket básico.
fuelRouter.post('/tank-entries', authenticate, requireRole('dueno','gerencia','encargado_combustible','compras','jefe_mantenimiento'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    await ensureFuelTankEntriesTable();
    const { tank_id, type='gasoil', liters: litersRaw, price_per_l: ppuRaw, supplier, remito, notes } = req.body || {};
    const liters = parseFloat(litersRaw);
    const ppu    = ppuRaw === '' || ppuRaw === undefined || ppuRaw === null ? null : parseFloat(ppuRaw);

    if (!tank_id) return res.status(400).json({ error: 'Falta seleccionar la cisterna' });
    if (!Number.isFinite(liters) || liters <= 0) return res.status(400).json({ error: 'Ingresá litros válidos' });
    if (ppu !== null && (!Number.isFinite(ppu) || ppu < 0)) return res.status(400).json({ error: 'Precio por litro inválido' });

    await client.query('BEGIN');
    const tq = await client.query('SELECT * FROM tanks WHERE id=$1 FOR UPDATE', [tank_id]);
    const tank = tq.rows[0];
    if (!tank) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cisterna no encontrada' });
    }

    const previous = parseFloat(tank.current_l) || 0;
    const capacity = parseFloat(tank.capacity_l) || 0;
    const next     = previous + liters;
    if (capacity > 0 && next > capacity) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Excede la capacidad de la cisterna (${capacity.toFixed(0)} L). Actual: ${previous.toFixed(0)} L` });
    }

    const fields = ['current_l = $1', 'updated_at = NOW()'];
    const params = [next];
    if (ppu !== null && ['dueno','gerencia','compras','encargado_combustible'].includes(req.user.role)) {
      params.push(ppu);
      fields.push(`price_per_l = $${params.length}`);
    }
    params.push(tank_id);
    const updated = await client.query(`UPDATE tanks SET ${fields.join(', ')} WHERE id=$${params.length} RETURNING *`, params);

    const entry = await client.query(`
      INSERT INTO fuel_tank_entries
        (tank_id, type, liters, price_per_l, supplier, remito, notes, previous_l, new_l, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *, ${arTsSql('created_at')} AS created_at_ar
    `, [
      tank_id,
      (type || tank.type || 'gasoil'),
      liters,
      ppu,
      supplier || null,
      remito || null,
      notes || null,
      previous,
      next,
      req.user.id
    ]);

    await client.query('COMMIT');
    res.status(201).json({ ok:true, entry: entry.rows[0], tank: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[fuel tank-entries POST]', err.message);
    res.status(500).json({ error: 'Error al registrar ingreso a cisterna' });
  } finally {
    client.release();
  }
});


// Despachos internos: salida de cisterna hacia sucursal, bidones o tanque chico.
// No se registra como consumo de una unidad: solo descuenta la cisterna y genera remito interno.
fuelRouter.get('/dispatches', authenticate, async (req, res) => {
  try {
    await ensureFuelTankEntriesTable();
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const params = [];
    let sql = `
      SELECT d.*, ${arTsSql('d.created_at')} AS created_at_ar, ${arTsSql('d.received_at')} AS received_at_ar, ${arTsSql('d.destination_stock_applied_at')} AS destination_stock_applied_at_ar, t.location AS tank_location, t.capacity_l, u.name AS created_by_name
      FROM fuel_internal_dispatches d
      LEFT JOIN tanks t ON t.id = d.tank_id
      LEFT JOIN users u ON u.id = d.created_by
      WHERE 1=1`;
    const ref = { value: sql };
    _addTextBranchFilter(req, params, ref, ['d.destination','d.destination_detail','t.location']);
    params.push(limit);
    ref.value += ` ORDER BY d.created_at DESC LIMIT $${params.length}`;
    const r = await query(ref.value, params);
    res.json(r.rows);
  } catch (err) {
    console.error('[fuel dispatches GET]', err.message);
    res.status(500).json({ error: 'Error al obtener despachos internos' });
  }
});

fuelRouter.post('/dispatches', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','encargado_combustible','compras','mecanico'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    await ensureFuelTankEntriesTable();
    const {
      tank_id, type='gasoil', liters: litersRaw, destination, destination_detail,
      responsible, transport_vehicle, remito, notes
    } = req.body || {};
    const liters = parseFloat(litersRaw);

    if (!tank_id) return res.status(400).json({ error: 'Falta seleccionar la cisterna de origen' });
    if (!Number.isFinite(liters) || liters <= 0) return res.status(400).json({ error: 'Ingresá litros válidos' });
    if (!destination || String(destination).trim().length < 2) return res.status(400).json({ error: 'Indicá destino del despacho' });

    await client.query('BEGIN');
    const tq = await client.query('SELECT * FROM tanks WHERE id=$1 FOR UPDATE', [tank_id]);
    const tank = tq.rows[0];
    if (!tank) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cisterna de origen no encontrada' });
    }

    const previous = parseFloat(tank.current_l) || 0;
    const next = previous - liters;
    if (next < 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Stock insuficiente en ${tank.location || 'cisterna'} (${previous.toFixed(0)} L disponibles, se piden ${liters.toFixed(0)} L)` });
    }

    const updated = await client.query(
      'UPDATE tanks SET current_l=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [next, tank_id]
    );

    const dispatch = await client.query(`
      INSERT INTO fuel_internal_dispatches
        (tank_id, type, liters, destination, destination_detail, responsible, transport_vehicle, remito, notes, previous_l, new_l, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *, ${arTsSql('created_at')} AS created_at_ar
    `, [
      tank_id,
      (type || tank.type || 'gasoil'),
      liters,
      String(destination).trim(),
      destination_detail || null,
      responsible || null,
      transport_vehicle || null,
      remito || null,
      notes || null,
      previous,
      next,
      req.user.id
    ]);

    await client.query('COMMIT');
    res.status(201).json({ ok:true, dispatch: dispatch.rows[0], tank: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[fuel dispatches POST]', err.message);
    res.status(500).json({ error: 'Error al registrar despacho interno' });
  } finally {
    client.release();
  }
});

fuelRouter.patch('/dispatches/:id/receive', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','encargado_combustible','compras','mecanico','gerente_sucursal'), validateUUID('id'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    await ensureFuelTankEntriesTable();
    const { received_by, received_liters, receive_notes, destination_sucursal } = req.body || {};
    const litrosRecibidos = received_liters === '' || received_liters === undefined || received_liters === null ? null : parseFloat(received_liters);
    if (litrosRecibidos !== null && (!Number.isFinite(litrosRecibidos) || litrosRecibidos < 0)) {
      return res.status(400).json({ error: 'Litros recibidos inválidos' });
    }

    const branch = _userSucursal(req);
    await client.query('BEGIN');

    let selectSql = `
      SELECT d.*, t.type AS origin_type, t.price_per_l AS origin_price_per_l
        FROM fuel_internal_dispatches d
        LEFT JOIN tanks t ON t.id = d.tank_id
       WHERE d.id=$1`;
    const params = [req.params.id];

    if (_isGerenteSucursal(req)) {
      if (!branch) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'El gerente de sucursal no tiene sucursal asignada' });
      }
      const ref = { value: selectSql };
      _addTextBranchFilter(req, params, ref, ['d.destination','d.destination_detail']);
      selectSql = ref.value;
    }

    selectSql += ' FOR UPDATE OF d';
    const cur = await client.query(selectSql, params);
    const dispatch = cur.rows[0];
    if (!dispatch) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Despacho no encontrado o no pertenece a tu sucursal' });
    }
    if (_isAlreadyReceived(dispatch.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Este despacho ya fue recibido' });
    }

    const litrosFinales = litrosRecibidos !== null ? litrosRecibidos : (parseFloat(dispatch.liters) || 0);
    if (!Number.isFinite(litrosFinales) || litrosFinales <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No hay litros válidos para ingresar al tanque destino' });
    }

    // La recepción suma combustible al tanque/stock propio de la sucursal destino.
    // Para gerente_sucursal, siempre usa su sucursal asignada. Para roles centrales,
    // se puede indicar destination_sucursal o se toma el texto del despacho.
    const destinoSucursal = branch || String(destination_sucursal || dispatch.destination || '').trim();
    const tankType = _fuelTankType(dispatch.type || dispatch.origin_type);
    const destinoTank = await _addFuelToDestinationTank(client, {
      destinoSucursal,
      tankType,
      liters: litrosFinales,
      originPricePerL: dispatch.origin_price_per_l || null
    });

    const updDispatch = await client.query(`
      UPDATE fuel_internal_dispatches
         SET status='recibido',
             received_by=$2,
             received_liters=$3,
             receive_notes=$4,
             received_at=COALESCE(received_at, NOW()),
             destination_tank_id=$5,
             destination_stock_applied=TRUE,
             destination_stock_applied_at=NOW()
       WHERE id=$1
       RETURNING *, ${arTsSql('created_at')} AS created_at_ar, ${arTsSql('received_at')} AS received_at_ar, ${arTsSql('destination_stock_applied_at')} AS destination_stock_applied_at_ar`,
      [req.params.id, received_by || req.user.name || null, litrosFinales, receive_notes || null, destinoTank?.id || null]
    );

    await client.query('COMMIT');
    res.json({ ok:true, dispatch: updDispatch.rows[0], destination_tank: destinoTank });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[fuel dispatch receive]', err.message);
    res.status(500).json({ error: 'Error al confirmar recepción' });
  } finally {
    client.release();
  }
});


// Regularizar un despacho ya marcado como recibido: suma los litros al tanque de la sucursal.
// Sirve para despachos recibidos antes de que existiera el tanque propio de sucursal.
fuelRouter.patch('/dispatches/:id/apply-to-tank', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','encargado_combustible','compras','mecanico','gerente_sucursal'), validateUUID('id'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    await ensureFuelTankEntriesTable();
    const branch = _userSucursal(req);
    await client.query('BEGIN');

    let selectSql = `
      SELECT d.*, t.type AS origin_type, t.price_per_l AS origin_price_per_l
        FROM fuel_internal_dispatches d
        LEFT JOIN tanks t ON t.id = d.tank_id
       WHERE d.id=$1`;
    const params = [req.params.id];

    if (_isGerenteSucursal(req)) {
      if (!branch) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'El gerente de sucursal no tiene sucursal asignada' });
      }
      const ref = { value: selectSql };
      _addTextBranchFilter(req, params, ref, ['d.destination','d.destination_detail']);
      selectSql = ref.value;
    }

    selectSql += ' FOR UPDATE OF d';
    const cur = await client.query(selectSql, params);
    const dispatch = cur.rows[0];
    if (!dispatch) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Despacho no encontrado o no pertenece a tu sucursal' });
    }
    if (!_isAlreadyReceived(dispatch.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Primero hay que marcar el despacho como recibido' });
    }
    if (dispatch.destination_stock_applied === true) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Este despacho ya fue sumado al tanque de destino' });
    }

    const liters = parseFloat(dispatch.received_liters || dispatch.liters) || 0;
    if (liters <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No hay litros válidos para sumar al tanque' });
    }

    const destinoSucursal = branch || String(req.body?.destination_sucursal || dispatch.destination || '').trim();
    const tankType = _fuelTankType(dispatch.type || dispatch.origin_type);
    const destinoTank = await _addFuelToDestinationTank(client, {
      destinoSucursal,
      tankType,
      liters,
      originPricePerL: dispatch.origin_price_per_l || null
    });

    const updDispatch = await client.query(`
      UPDATE fuel_internal_dispatches
         SET destination_tank_id=$2,
             destination_stock_applied=TRUE,
             destination_stock_applied_at=NOW()
       WHERE id=$1
       RETURNING *, ${arTsSql('created_at')} AS created_at_ar, ${arTsSql('received_at')} AS received_at_ar, ${arTsSql('destination_stock_applied_at')} AS destination_stock_applied_at_ar`,
      [req.params.id, destinoTank?.id || null]
    );

    await client.query('COMMIT');
    res.json({ ok:true, dispatch: updDispatch.rows[0], destination_tank: destinoTank });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[fuel dispatch apply-to-tank]', err.message);
    res.status(500).json({ error: 'Error al sumar despacho al tanque de sucursal' });
  } finally {
    client.release();
  }
});

fuelRouter.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','encargado_combustible','chofer','mecanico','gerente_sucursal'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    const { vehicle_id, tank_id, fuel_type, liters: litersRaw, price_per_l: ppuRaw, odometer_km, location, notes, ticket_image, driver } = req.body;
    // ── Parseo numérico estricto — evita que "100" (string) rompa las restas SQL
    const liters = parseFloat(litersRaw);
    const ppuFrontend = parseFloat(ppuRaw);
    if (!vehicle_id || !Number.isFinite(liters) || liters <= 0) {
      return res.status(400).json({ error: 'vehicle_id y liters (numero > 0) son requeridos' });
    }
    // Si es estación externa (sin tank_id), el precio es obligatorio
    if (!tank_id && (!Number.isFinite(ppuFrontend) || ppuFrontend <= 0)) {
      return res.status(400).json({ error: 'Al cargar fuera de la cisterna, el precio por litro es obligatorio (del ticket)' });
    }
    // Chofer solo puede cargar a su propia unidad asignada
    if (req.user.role === 'chofer') {
      const veh = await client.query('SELECT code FROM vehicles WHERE id=$1 AND active=TRUE', [vehicle_id]);
      if (!veh.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
      if (veh.rows[0].code !== req.user.vehicle_code) {
        return res.status(403).json({ error: 'Solo podés cargar combustible a tu unidad asignada (' + (req.user.vehicle_code||'sin asignar') + ')' });
      }
    }
    // Gerente de sucursal: solo puede cargar consumos internos desde tanque de su sucursal
    // y únicamente a vehículos/equipos de su sucursal.
    if (req.user.role === 'gerente_sucursal') {
      const branch = _userSucursal(req);
      if (!branch) return res.status(403).json({ error: 'Tu usuario no tiene sucursal asignada' });
      if (!tank_id) return res.status(403).json({ error: 'La sucursal solo puede registrar consumo desde su tanque interno' });

      const veh = await client.query('SELECT id, code, base FROM vehicles WHERE id=$1 AND active=TRUE', [vehicle_id]);
      if (!veh.rows[0]) return res.status(404).json({ error: 'Vehículo/equipo no encontrado' });
      const vehBase = _normalizeSucursalText(veh.rows[0].base);
      const branchPats = _branchPatterns(branch);
      if (!vehBase || !branchPats.some(p => vehBase.includes(p) || (vehBase.length >= 3 && p.includes(vehBase)))) {
        return res.status(403).json({ error: 'Solo podés cargar combustible a vehículos/equipos de tu sucursal' });
      }

      const tk = await client.query('SELECT id, location FROM tanks WHERE id=$1 AND active IS DISTINCT FROM FALSE', [tank_id]);
      if (!tk.rows[0]) return res.status(404).json({ error: 'Tanque no encontrado' });
      const tankLoc = _normalizeSucursalText(tk.rows[0].location);
      if (!tankLoc || !branchPats.some(p => tankLoc.includes(p) || (tankLoc.length >= 3 && p.includes(tankLoc)))) {
        return res.status(403).json({ error: 'Solo podés usar el tanque interno de tu sucursal' });
      }
    }

    // Control de duplicados: misma unidad en los últimos 10 minutos.
    // IMPORTANTE: aplica solo a combustible/gasoil. La urea puede cargarse inmediatamente
    // después de una carga de combustible de la misma unidad.
    const tipoCarga = (fuel_type || 'fuel').toLowerCase();
    const esUrea = tipoCarga === 'urea';
    if (!esUrea) {
      const dup = await client.query(
        `SELECT id FROM fuel_logs
         WHERE vehicle_id=$1
           AND driver_id=$2
           AND COALESCE(fuel_type,'fuel') <> 'urea'
           AND logged_at > NOW() - INTERVAL '10 minutes'`,
        [vehicle_id, req.user.id]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'Ya registraste una carga de combustible para esta unidad hace menos de 10 minutos. Si es correcta, esperá unos minutos e intentá de nuevo.' });
      }
    }
    // Validar ticket_image si viene — debe ser JPG o PNG en base64, máx 5MB
    if (ticket_image) {
      const validTypes = ['data:image/jpeg','data:image/jpg','data:image/png','data:image/webp'];
      if (!validTypes.some(t => ticket_image.startsWith(t))) {
        return res.status(400).json({ error: 'El ticket debe ser una imagen JPG o PNG' });
      }
      const sizeKB = Math.round(ticket_image.length * 0.75 / 1024);
      if (sizeKB > 5120) return res.status(400).json({ error: 'La imagen del ticket no puede superar 5MB' });
    }
    // Ticket obligatorio para cargas de combustible hechas por choferes.
    // Para urea no se exige ticket, salvo que sea carga externa y el rol no esté exceptuado.
    const rolesSinTicket = ['dueno','gerencia','compras'];
    if (!ticket_image) {
      if (!esUrea && req.user.role === 'chofer') {
        return res.status(400).json({ error: 'Para registrar combustible tenés que subir la foto del ticket.' });
      }
      if (!tank_id && !rolesSinTicket.includes(req.user.role)) {
        return res.status(400).json({ error: 'Al cargar en estación externa, la foto del ticket es obligatoria' });
      }
    }
    await client.query('BEGIN');
    // Asegurar columnas de ticket sin dejar pendientes falsos.
    await client.query(`ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_image TEXT`).catch(()=>{});
    await client.query(`ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_estado VARCHAR(20)`).catch(()=>{});
    await client.query(`ALTER TABLE fuel_logs ALTER COLUMN ticket_estado DROP DEFAULT`).catch(()=>{});
    await client.query(`ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_obs TEXT`).catch(()=>{});
    await client.query(`ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_por UUID`).catch(()=>{});
    await client.query(`ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_at TIMESTAMPTZ`).catch(()=>{});
    // Chofer real de la carga (texto, no FK): el que maneja la unidad ese día.
    // Antes solo se guardaba driver_id = quien registra (el encargado), y el
    // listado mostraba al encargado en vez del chofer.
    await client.query(`ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS driver_name VARCHAR(150)`).catch(()=>{});

    // ── PRECIO FINAL:
    //    * Cisterna propia (tank_id presente): SIEMPRE el precio del tanque (ignoramos frontend)
    //    * Externa (sin tank_id): el precio que mandó el frontend (ya validado arriba)
    let ppuFinal = ppuFrontend;
    if (tank_id) {
      const t = await client.query('SELECT id, current_l, location, type, price_per_l FROM tanks WHERE id=$1 FOR UPDATE',[tank_id]);
      if (!t.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Cisterna no encontrada' });
      }
      const stockActual = parseFloat(t.rows[0].current_l);
      if (stockActual < liters) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Combustible insuficiente en ${t.rows[0].location} (${stockActual.toFixed(0)}L disponibles, se piden ${liters}L)` });
      }
      // Precio del tanque (puede ser null si compras aún no lo cargó → queda null, se puede completar después)
      ppuFinal = parseFloat(t.rows[0].price_per_l) || null;
      // Descontar los litros de esa cisterna específica
      const upd = await client.query(
        'UPDATE tanks SET current_l = current_l - $1, updated_at = NOW() WHERE id = $2 RETURNING current_l, location',
        [liters, tank_id]
      );
      console.log(`[FUEL] Carga ${liters}L de "${upd.rows[0].location}" — queda ${parseFloat(upd.rows[0].current_l).toFixed(0)}L`);
    }
    // Odómetro manual: no copiamos más km_current/GPS automáticamente.
    // Si no se informa, queda NULL para no guardar un dato falso.
    const kmParsed = parseInt(odometer_km, 10);
    const kmToSave = Number.isFinite(kmParsed) && kmParsed > 0 ? kmParsed : null;
    const ticketEstado = ticket_image ? 'pendiente' : null;
    // Chofer de la carga (texto): viene del form (autocompletado con el chofer
    // asignado a la unidad, editable). driver_id sigue siendo quien registra.
    const driverName = (driver || '').toString().trim().slice(0, 150) || null;
    const r = await client.query(
      `INSERT INTO fuel_logs(vehicle_id,driver_id,driver_name,tank_id,fuel_type,liters,price_per_l,odometer_km,location,notes,ticket_image,ticket_estado)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [vehicle_id,req.user.id,driverName,tank_id||null,fuel_type||'diesel',liters,ppuFinal,kmToSave,location||null,notes||null,ticket_image||null,ticketEstado]
    );
    if (kmToSave) {
      // Auditoría del km: guardamos el anterior y solo registramos si realmente subió.
      const prevKm = await client.query('SELECT km_current FROM vehicles WHERE id=$1', [vehicle_id]);
      const updKm = await client.query('UPDATE vehicles SET km_current=$1 WHERE id=$2 AND COALESCE(km_current,0)<$1 RETURNING km_current',[kmToSave,vehicle_id]);
      if (updKm.rows[0]) {
        await auditChange(req, res, {
          action: 'km_update', table: 'vehicles', recordId: vehicle_id, markAudited: false,
          oldValue: { km_current: prevKm.rows[0]?.km_current ?? null, origen: 'combustible' },
          newValue: { km_current: kmToSave },
        });
      }
    }
    await client.query('COMMIT'); res.status(201).json(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[fuel POST]', err.message);
    res.status(500).json({ error: 'Error carga' });
  } finally { client.release(); }
});
fuelRouter.patch('/tanks/:id',authenticate,requireRole('dueno','gerencia','encargado_combustible','compras','jefe_mantenimiento'),validateUUID('id'),async(req,res)=>{
  try{
    const { current_l, capacity_l, price_per_l } = req.body;

    // Solo compras/dueno/gerencia pueden cambiar price_per_l. Jefe mant solo puede registrar ingresos de litros.
    const rolesPrecio = ['dueno','gerencia','compras','encargado_combustible'];
    if (price_per_l !== undefined && !rolesPrecio.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tenés permiso para modificar el precio del combustible. Eso lo gestiona compras.' });
    }

    const fields = []; const params = [];
    if (current_l !== undefined) { params.push(current_l); fields.push('current_l=$'+params.length); }
    if (capacity_l !== undefined) { params.push(capacity_l); fields.push('capacity_l=$'+params.length); }
    if (price_per_l !== undefined) { params.push(price_per_l); fields.push('price_per_l=$'+params.length); }
    if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    const r = await query('UPDATE tanks SET '+fields.join(',')+',updated_at=NOW() WHERE id=$'+params.length+' RETURNING *', params);
    if(!r.rows[0]) return res.status(404).json({error:'Cisterna no encontrada'}); res.json(r.rows[0]);
  }catch(err){res.status(500).json({error:'Error cisterna'});}
});

// ======= CUBIERTAS =======
tireRouter.get('/',authenticate,async(req,res)=>{
  try{const{status,vehicle_id}=req.query;const ref={value:`SELECT t.*,v.code AS vehicle_code FROM tires t LEFT JOIN vehicles v ON v.id=t.current_vehicle_id WHERE 1=1`};
  const p=[];if(status){p.push(status);ref.value+=` AND t.status=$${p.length}`;}if(vehicle_id){p.push(vehicle_id);ref.value+=` AND t.current_vehicle_id=$${p.length}`;}
  _addVehicleBranchFilter(req,p,ref,'v'); // gerente de sucursal: solo cubiertas de vehículos de su sucursal
  ref.value+=' ORDER BY t.serial_no';res.json((await query(ref.value,p)).rows);}catch(err){res.status(500).json({error:'Error cubiertas'});}
});
tireRouter.post('/',authenticate,requireRole('dueno','gerencia','jefe_mantenimiento'),async(req,res)=>{
  try{const{serial_no,brand,model,size,purchase_price,purchase_date,tread_depth}=req.body;
  if(!serial_no) return res.status(400).json({error:'serial_no requerido'});
  const r=await query(`INSERT INTO tires(serial_no,brand,model,size,purchase_price,purchase_date,tread_depth) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[serial_no,brand||null,model||null,size||null,purchase_price||null,purchase_date||null,tread_depth||null]);
  res.status(201).json(r.rows[0]);}catch(err){if(err.code==='23505') return res.status(409).json({error:'Número serie existe'});res.status(500).json({error:'Error cubierta'});}
});
tireRouter.post('/:id/move',authenticate,requireRole('dueno','gerencia','jefe_mantenimiento','mecanico'),validateUUID('id'),async(req,res)=>{
  const client=await require('../db/pool').pool.connect();
  try{const{to_vehicle_id,to_position,type,notes,tread_depth}=req.body;
  await client.query('BEGIN');
  const tire=await client.query('SELECT * FROM tires WHERE id=$1 FOR UPDATE',[req.params.id]);
  if(!tire.rows[0]){await client.query('ROLLBACK');return res.status(404).json({error:'Cubierta no encontrada'});}
  const veh=to_vehicle_id?await client.query('SELECT km_current FROM vehicles WHERE id=$1',[to_vehicle_id]):null;
  const km=veh?.rows[0]?.km_current||0;
  await client.query(`INSERT INTO tire_movements(tire_id,type,from_pos,to_pos,vehicle_id,km_at_move,tread_at_move,user_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[req.params.id,type||'Rotación',tire.rows[0].current_position,to_position,to_vehicle_id||tire.rows[0].current_vehicle_id,km,tread_depth||tire.rows[0].tread_depth,req.user.id,notes||null]);
  const ns=to_vehicle_id?'montada':({'STOCK':'stock','Stock':'stock','RECAP':'recapado','Recap':'recapado','Recapado':'recapado','recapado':'recapado','BAJA':'baja','Baja':'baja','baja':'baja'}[to_position]||'stock');
  await client.query(`UPDATE tires SET current_vehicle_id=$1,current_position=$2,status=$3,tread_depth=COALESCE($4,tread_depth),km_total=km_total+$5 WHERE id=$6`,[to_vehicle_id||null,to_position,ns,tread_depth||null,km,req.params.id]);
  await client.query('COMMIT');res.json({message:'Movimiento registrado'});}catch(err){await client.query('ROLLBACK');res.status(500).json({error:'Error mover cubierta'});}finally{client.release();}
});

// POST /api/tires/:id/depth — Solo actualizar profundidad (sin mover de posición)
// Registra en tire_movements como "Control profundidad" para auditoría
tireRouter.post('/:id/depth',
  authenticate,
  requireRole('dueno','gerencia','jefe_mantenimiento','mecanico'),
  validateUUID('id'),
  async (req, res) => {
    const client = await require('../db/pool').pool.connect();
    try {
      const { depth_mm, notes } = req.body;
      const depthNum = parseFloat(depth_mm);
      if (isNaN(depthNum) || depthNum < 0 || depthNum > 50) {
        return res.status(400).json({ error: 'Profundidad inválida. Debe estar entre 0 y 50 mm' });
      }

      await client.query('BEGIN');

      // Verificar que existe y bloquear la fila
      const tire = await client.query(
        'SELECT * FROM tires WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!tire.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Cubierta no encontrada' });
      }

      const currentVehicleId = tire.rows[0].current_vehicle_id;
      const currentPos = tire.rows[0].current_position;

      // Obtener km actual del vehículo (si está montada)
      let km = 0;
      if (currentVehicleId) {
        const veh = await client.query(
          'SELECT km_current FROM vehicles WHERE id = $1',
          [currentVehicleId]
        );
        km = veh.rows[0]?.km_current || 0;
      }

      // Registrar el control en tire_movements (queda en el historial/auditoría)
      await client.query(
        `INSERT INTO tire_movements
         (tire_id, type, from_pos, to_pos, vehicle_id, km_at_move, tread_at_move, user_id, notes)
         VALUES ($1, 'Control profundidad', $2, $2, $3, $4, $5, $6, $7)`,
        [req.params.id, currentPos, currentVehicleId, km, depthNum, req.user.id, notes || null]
      );

      // Actualizar solo tread_depth (no se mueve de posición)
      await client.query(
        'UPDATE tires SET tread_depth = $1 WHERE id = $2',
        [depthNum, req.params.id]
      );

      await client.query('COMMIT');
      res.json({
        message: 'Profundidad actualizada',
        depth_mm: depthNum,
        tire_id: req.params.id
      });
    } catch(err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Error al actualizar profundidad' });
    } finally { client.release(); }
  }
);

// GET /api/tires/history — blanqueo de movimientos de cubiertas (auditoría)
// Lee tire_movements con JOIN a tires, vehicles y users.
// Si una cubierta fue eliminada (raro), el serial aparece como '[eliminada]'.
tireRouter.get('/history', authenticate, async (req, res) => {
  try {
    const { serial, limit = 200 } = req.query;
    let sql = `
      SELECT
        tm.id,
        tm.created_at,
        tm.type,
        tm.from_pos,
        tm.to_pos,
        tm.km_at_move,
        tm.tread_at_move,
        tm.notes,
        COALESCE(t.serial_no, '[eliminada]') AS serial_no,
        v.code AS vehicle_code,
        u.name AS user_name
      FROM tire_movements tm
      LEFT JOIN tires    t ON t.id = tm.tire_id
      LEFT JOIN vehicles v ON v.id = tm.vehicle_id
      LEFT JOIN users    u ON u.id = tm.user_id
      WHERE 1=1`;
    const p = [];
    if (serial) { p.push(serial); sql += ` AND t.serial_no = $${p.length}`; }
    sql += ` ORDER BY tm.created_at DESC LIMIT $${p.length + 1}`;
    p.push(Math.min(parseInt(limit) || 200, 500));
    const r = await query(sql, p);
    res.json(r.rows);
  } catch (err) {
    console.error('GET tires/history:', err.message);
    res.status(500).json({ error: 'Error historial cubiertas' });
  }
});

// ======= DOCUMENTOS =======
// GET /api/documents — trae documentos con JOIN a vehicles y users (choferes)
// Devuelve los campos necesarios para mostrar código/patente/nombre en el frontend
docRouter.get('/', authenticate, async (req, res) => {
  try {
    const { entity_type, entity_id, status } = req.query;
    let sql = `
      SELECT
        d.*,
        -- Info del vehículo (si entity_type = 'vehicle')
        v.code  AS vehicle_code,
        v.plate AS vehicle_plate,
        v.brand AS vehicle_brand,
        v.model AS vehicle_model,
        -- Info del chofer (si entity_type = 'user')
        u.name  AS user_name,
        u.role  AS user_role,
        u.vehicle_code AS user_vehicle_code,
        -- Campo "referencia visible" que el frontend usa
        CASE
          WHEN d.entity_type = 'vehicle' THEN COALESCE(v.code, 'Vehículo eliminado')
          WHEN d.entity_type = 'user'    THEN COALESCE(u.name, 'Chofer eliminado')
          ELSE d.entity_id::text
        END AS entity_label
      FROM documents d
      LEFT JOIN vehicles v ON d.entity_type = 'vehicle' AND v.id = d.entity_id
      LEFT JOIN users    u ON d.entity_type = 'user'    AND u.id = d.entity_id
      WHERE 1=1
    `;
    const p = [];
    if (entity_type) { p.push(entity_type); sql += ` AND d.entity_type = $${p.length}`; }
    if (entity_id)   { p.push(entity_id);   sql += ` AND d.entity_id = $${p.length}`; }
    if (status)      { p.push(status);      sql += ` AND d.status = $${p.length}`; }
    // Gerente de sucursal: solo documentos de vehículos de su sucursal o de
    // usuarios de su sucursal (no-op para el resto de los roles).
    const _ref = { value: sql };
    _addTextBranchFilter(req, p, _ref, ['v.base', 'u.sucursal']);
    sql = _ref.value;
    sql += ' ORDER BY d.expiry_date ASC';
    res.json((await query(sql, p)).rows);
  } catch(err) {
    console.error('[documents GET]', err.message);
    res.status(500).json({ error: 'Error al obtener documentos' });
  }
});

docRouter.post('/',authenticate,requireRole('dueno','gerencia','jefe_mantenimiento','contador'),async(req,res)=>{
  try{const{entity_type,entity_id,doc_type,reference,issue_date,expiry_date,notes}=req.body;
  if(!entity_type||!entity_id||!doc_type||!expiry_date) return res.status(400).json({error:'Campos requeridos'});
  // Validar que entity_type sea válido
  if (!['vehicle','user'].includes(entity_type)) return res.status(400).json({error:'entity_type debe ser "vehicle" o "user"'});
  const r=await query(`INSERT INTO documents(entity_type,entity_id,doc_type,reference,issue_date,expiry_date,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[entity_type,entity_id,doc_type,reference||null,issue_date||null,expiry_date,notes||null,req.user.id]);
  res.status(201).json(r.rows[0]);}catch(err){res.status(500).json({error:'Error documento'});}
});

docRouter.put('/:id',authenticate,requireRole('dueno','gerencia','jefe_mantenimiento','contador'),validateUUID('id'),async(req,res)=>{
  try{const{expiry_date,reference,notes,issue_date}=req.body;
  if(!expiry_date) return res.status(400).json({error:'expiry_date requerido'});
  const r=await query('UPDATE documents SET expiry_date=$1,reference=$2,notes=$3,updated_at=NOW() WHERE id=$4 RETURNING *',[expiry_date,reference||null,notes||null,req.params.id]);
  if(!r.rows[0]) return res.status(404).json({error:'Documento no encontrado'});
  res.json(r.rows[0]);}catch(err){res.status(500).json({error:'Error actualizar documento'});}
});

// ======= USUARIOS =======
// Se ejecuta UNA sola vez por proceso (promise cacheado), no en cada request a usuarios.
let _userOrgReadyPromise = null;
function ensureUserOrgSchema() {
  if (_userOrgReadyPromise) return _userOrgReadyPromise;
  _userOrgReadyPromise = (async () => {
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id)`).catch(()=>{});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sucursal VARCHAR(200)`).catch(()=>{});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS area VARCHAR(100)`).catch(()=>{});
  await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`).catch(()=>{});
  await query(`ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('dueno','gerencia','jefe_mantenimiento','mecanico','chofer',
                    'encargado_combustible','paniol','contador','auditor',
                    'compras','tesoreria','proveedores','gerente_sucursal'))`).catch(()=>{});
  })().catch((err) => { _userOrgReadyPromise = null; throw err; });
  return _userOrgReadyPromise;
}

userRouter.get('/',authenticate,requireRole('dueno','gerencia'),async(req,res)=>{
  try{
    await ensureUserOrgSchema();
    res.json((await query(`SELECT u.id,u.name,u.email,u.role,u.vehicle_code,u.sucursal,u.area,u.active,u.last_login,u.supplier_id,s.name AS supplier_name FROM users u LEFT JOIN suppliers s ON s.id=u.supplier_id ORDER BY u.name`)).rows);
  }catch(err){res.status(500).json({error:'Error usuarios'});}
});
userRouter.post('/',authenticate,requireRole('dueno','gerencia'),async(req,res)=>{
  try{
    await ensureUserOrgSchema();
    const{name,email,password,role,vehicle_code,supplier_id,sucursal,area}=req.body;
    if(!name||!email||!password||!role) return res.status(400).json({error:'name,email,password,role requeridos'});
    const hash=await bcrypt.hash(password,parseInt(process.env.BCRYPT_ROUNDS)||12);
    const r=await query(`INSERT INTO users(name,email,password_hash,role,vehicle_code,supplier_id,sucursal,area) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,email,role,active,supplier_id,sucursal,area`,[name,email.toLowerCase(),hash,role,vehicle_code||null,supplier_id||null,sucursal||null,area||null]);
    res.status(201).json(r.rows[0]);
  }catch(err){if(err.code==='23505') return res.status(409).json({error:'Email existe'});console.error('POST user error:',err.message);res.status(500).json({error:'Error usuario'});}
});
userRouter.delete('/:id', authenticate, requireRole('dueno'), validateUUID('id'), async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'No podés eliminar tu propio usuario' });
    const check = await query('SELECT email FROM users WHERE id=$1', [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (check.rows[0].email === 'admin@fleetos.com') return res.status(400).json({ error: 'No se puede eliminar el usuario administrador' });
    await query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.params.id]);
    try {
      await query('DELETE FROM users WHERE id=$1', [req.params.id]);
      res.json({ ok: true, deleted: true });
    } catch (e) {
      // 23503 = foreign_key_violation: el usuario tiene historial (OCs, combustible, OTs,
      // movimientos de stock, etc.) que referencia su id. No se puede borrar sin romper
      // esos registros, así que lo desactivamos: ya no puede ingresar y sale de la lista
      // de usuarios activos, pero se conserva la trazabilidad de lo que hizo.
      if (e.code === '23503') {
        await query('UPDATE users SET active=FALSE, updated_at=NOW() WHERE id=$1', [req.params.id]);
        return res.json({
          ok: true, deleted: false, deactivated: true,
          message: 'El usuario tiene historial en el sistema, por eso no se puede borrar definitivamente. Se desactivó: ya no puede ingresar y sale de la lista, pero se conserva el registro de lo que hizo.'
        });
      }
      throw e;
    }
  } catch(err) { console.error('DELETE user:', err.message); res.status(500).json({ error: 'Error al eliminar usuario' }); }
});

userRouter.put('/:id',authenticate,requireRole('dueno','gerencia'),validateUUID('id'),async(req,res)=>{
  try{
    await ensureUserOrgSchema();
    const{name,role,vehicle_code,active,password,supplier_id,sucursal,area}=req.body;
    if(req.params.id===req.user.id&&active===false) return res.status(400).json({error:'No puedes desactivarte'});

    const targetQ = await query('SELECT id, role FROM users WHERE id=$1',[req.params.id]);
    if(!targetQ.rows[0]) return res.status(404).json({error:'Usuario no encontrado'});
    const target = targetQ.rows[0];
    const soyDueno = req.user.role === 'dueno';
    const esMiCuenta = req.params.id === req.user.id;

    // Escalación de privilegios: sin estos controles, gerencia podía asignarse el rol
    // dueño o cambiarle la contraseña al dueño y tomar control total del sistema.
    if(!soyDueno){
      if(target.role === 'dueno') return res.status(403).json({error:'Solo el dueño puede modificar una cuenta de dueño'});
      if(role === 'dueno') return res.status(403).json({error:'Solo el dueño puede asignar el rol dueño'});
      if(password && !esMiCuenta) return res.status(403).json({error:'Solo el dueño puede cambiar la contraseña de otro usuario'});
    }

    if(password && password.length<8) return res.status(400).json({error:'La contraseña debe tener al menos 8 caracteres'});
    if(password){
      const hash=await bcrypt.hash(password,parseInt(process.env.BCRYPT_ROUNDS)||12);
      await query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2',[hash,req.params.id]);
      // Cerrar las sesiones abiertas de ese usuario: con la clave cambiada, ningún
      // refresh token previo debe seguir sirviendo.
      await query('DELETE FROM refresh_tokens WHERE user_id=$1',[req.params.id]);
    }
    const r=await query('UPDATE users SET name=$1,role=$2,vehicle_code=$3,active=$4,supplier_id=$6,sucursal=$7,area=$8,updated_at=NOW() WHERE id=$5 RETURNING id,name,email,role,active,supplier_id,sucursal,area',[name,role,vehicle_code||null,active!==false,req.params.id,supplier_id||null,sucursal||null,area||null]);
    if(!r.rows[0]) return res.status(404).json({error:'Usuario no encontrado'});
    // Usuario desactivado o degradado de rol: sus sesiones tampoco deben sobrevivir.
    if(active===false || (role && role!==target.role)){
      await query('DELETE FROM refresh_tokens WHERE user_id=$1',[req.params.id]).catch(()=>{});
    }
    res.json(r.rows[0]);
  }catch(err){console.error('PUT user error:',err.message);res.status(500).json({error:'Error actualizar'});}
});

// ======= CONFIGURACIÓN (bases y tipos) =======
const configRouter = express.Router();
const DEFAULT_BASES = ['Central','Norte','Sur'];
const DEFAULT_VTYPES = ['tractor','camion','semirremolque','acoplado','utilitario','autoelevador','furgon','moto','otro'];
function mergeVehicleTypes(value) {
  const incoming = Array.isArray(value) ? value : [];
  const aliases = {
    semi: 'semirremolque',
    semirremolques: 'semirremolque',
    'semi remolque': 'semirremolque',
    acoplados: 'acoplado',
    'auto elevador': 'autoelevador',
    autoelevadores: 'autoelevador',
    montacargas: 'autoelevador',
    camioneta: 'utilitario',
  };
  const clean = [];
  for (const item of [...incoming, ...DEFAULT_VTYPES]) {
    const raw = String(item || '').trim().toLowerCase();
    if (!raw) continue;
    const normalized = aliases[raw] || raw.replace(/\s+/g, '_').replace(/-/g, '_');
    if (!clean.includes(normalized)) clean.push(normalized);
  }
  return clean;
}

// Evita ejecutar CREATE TABLE en cada carga de configuración.
// Se crea una sola vez por proceso y luego se reutiliza.
let appConfigReadyPromise = null;
function ensureAppConfigTable() {
  if (!appConfigReadyPromise) {
    appConfigReadyPromise = query(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value JSONB NOT NULL)`)
      .catch((err) => {
        appConfigReadyPromise = null;
        throw err;
      });
  }
  return appConfigReadyPromise;
}

configRouter.get('/', authenticate, async (req, res) => {
  try {
    await ensureAppConfigTable();
    const cfg = await query(`SELECT key, value FROM app_config WHERE key IN ('bases','vehicle_types','labor_rate','areas','stock_categories')`);
    const map = Object.fromEntries(cfg.rows.map(r => [r.key, r.value]));
    res.json({
      bases: Array.isArray(map.bases) ? map.bases : DEFAULT_BASES,
      vehicle_types: mergeVehicleTypes(map.vehicle_types || DEFAULT_VTYPES),
      labor_rate: map.labor_rate !== undefined ? parseFloat(map.labor_rate) : 0,
      areas: map.areas && typeof map.areas === 'object' ? map.areas : {},
      stock_categories: Array.isArray(map.stock_categories) ? map.stock_categories : [],
    });
  } catch (err) {
    console.error('[config GET]', err.message);
    res.status(500).json({ error: 'Error config' });
  }
});

configRouter.put('/', authenticate, requireRole('dueno','gerencia'), async (req, res) => {
  try {
    await ensureAppConfigTable();
    const { bases, vehicle_types, labor_rate, areas, stock_categories } = req.body;
    if (bases)         await query(`INSERT INTO app_config(key,value) VALUES('bases',$1) ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(bases)]);
    if (Array.isArray(stock_categories)) {
      // Lista de categorías de stock (definida por dueño/gerencia). Limpia, sin vacíos ni duplicados.
      const seen = {};
      const cats = stock_categories
        .map(c => String(c || '').trim())
        .filter(c => c && !seen[c.toLowerCase()] && (seen[c.toLowerCase()] = true));
      await query(`INSERT INTO app_config(key,value) VALUES('stock_categories',$1) ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(cats)]);
    }
    if (vehicle_types) await query(`INSERT INTO app_config(key,value) VALUES('vehicle_types',$1) ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(mergeVehicleTypes(vehicle_types))]);
    if (areas && typeof areas === 'object') {
      // Validación básica: debe ser objeto con arrays de strings
      const clean = {};
      for (const suc of Object.keys(areas)) {
        if (Array.isArray(areas[suc])) {
          clean[suc] = areas[suc].filter(a => typeof a === 'string' && a.trim().length > 0);
        }
      }
      await query(`INSERT INTO app_config(key,value) VALUES('areas',$1) ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(clean)]);
    }
    if (labor_rate !== undefined && labor_rate !== null && labor_rate !== '') {
      const rateNum = parseFloat(labor_rate);
      if (isNaN(rateNum) || rateNum < 0) return res.status(400).json({ error: 'labor_rate inválido' });
      await query(`INSERT INTO app_config(key,value) VALUES('labor_rate',$1) ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(rateNum)]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error guardar config' }); }
});

module.exports = { fuelRouter, tireRouter, docRouter, userRouter, configRouter };

// ======= CHECKLIST =======
const checklistRouter = express.Router();

// Crear tabla si no existe
// Se ejecuta UNA sola vez por proceso (promise cacheado), no en cada POST/GET de checklist.
let _checklistReadyPromise = null;
function ensureChecklistTable() {
  if (_checklistReadyPromise) return _checklistReadyPromise;
  _checklistReadyPromise = (async () => {
  await query(`CREATE TABLE IF NOT EXISTS checklists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id),
    driver_id UUID REFERENCES users(id),
    driver_name VARCHAR(100),
    vehicle_code VARCHAR(20),
    km_at_check INTEGER,
    items JSONB NOT NULL DEFAULT '[]',
    observations TEXT,
    all_ok BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
  )`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_checklists_date ON checklists(created_at DESC)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_checklists_vehicle ON checklists(vehicle_id)`).catch(()=>{});
  })().catch((err) => { _checklistReadyPromise = null; throw err; });
  return _checklistReadyPromise;
}

// POST — guardar checklist
checklistRouter.post('/', authenticate, async (req, res) => {
  try {
    await ensureChecklistTable();
    const { vehicle_id, vehicle_code, km_at_check, items, observations, all_ok } = req.body;
    const r = await query(
      `INSERT INTO checklists(vehicle_id,driver_id,driver_name,vehicle_code,km_at_check,items,observations,all_ok)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [vehicle_id||null, req.user.id, req.user.name, vehicle_code||null,
       km_at_check||null, JSON.stringify(items||[]), observations||null, all_ok!==false]
    );
    // Si hay ítems críticos fallidos, crear OT automática
    // FIX: usaba columnas/valores que no coinciden con el schema real.
    //   - created_by → NO existe, la columna real es reporter_id
    //   - status='Abierta' → el resto del sistema usa 'Pendiente'
    //   - priority='urgente' → debe ser 'Urgente' (mayúscula)
    //   - faltaba generar code (OT-00xxx) con ot_sequence como en workorders.js
    // Si esto fallaba, se silenciaba con .catch(()=>{}) y nadie se enteraba.
    const critical = (items||[]).filter(i => !i.ok && i.critical);
    if (critical.length > 0) {
      try {
        const desc = 'Checklist salida: ' + critical.map(i=>i.label).join(', ');
        // Generar código correlativo OT-00xxx (mismo patrón que routes/workorders.js)
        await query(`CREATE TABLE IF NOT EXISTS ot_sequence (
          dummy INT PRIMARY KEY DEFAULT 1,
          last_val INT NOT NULL DEFAULT 0,
          CHECK (dummy = 1)
        )`);
        await query(`INSERT INTO ot_sequence (dummy, last_val) VALUES (1, 0) ON CONFLICT DO NOTHING`);
        const seq = await query(`UPDATE ot_sequence SET last_val = last_val + 1 RETURNING last_val`);
        const code = 'OT-' + String(seq.rows[0].last_val).padStart(5, '0');
        // km_at_open del vehículo (si viene del checklist, usamos ese)
        const kmOpen = km_at_check || 0;
        await query(
          `INSERT INTO work_orders
             (code, vehicle_id, ot_tipo, type, status, priority, description, reporter_id, km_at_open)
           VALUES ($1, $2, 'vehiculo', 'Correctivo', 'Pendiente', 'Urgente', $3, $4, $5)`,
          [code, vehicle_id||null, desc, req.user.id, kmOpen]
        );
      } catch(otErr) {
        // No tiramos 500 porque el checklist ya se guardó; pero dejamos rastro.
        console.error('[checklist] fallo al crear OT automática:', otErr.message);
      }
    }
    // Actualizar km del vehículo (y auditar si realmente subió).
    if (km_at_check && vehicle_id) {
      try {
        const prevKm = await query('SELECT km_current FROM vehicles WHERE id=$1', [vehicle_id]);
        const updKm = await query('UPDATE vehicles SET km_current=$1 WHERE id=$2 AND km_current<$1 RETURNING km_current',[km_at_check,vehicle_id]);
        if (updKm.rows[0]) {
          await auditChange(req, res, {
            action: 'km_update', table: 'vehicles', recordId: vehicle_id, markAudited: false,
            oldValue: { km_current: prevKm.rows[0]?.km_current ?? null, origen: 'checklist' },
            newValue: { km_current: km_at_check },
          });
        }
      } catch(e) { /* no romper el guardado del checklist por el km */ }
    }
    res.status(201).json(r.rows[0]);
  } catch(err) { console.error('POST checklist:', err.message); res.status(500).json({error:'Error guardar checklist'}); }
});

// GET — listar checklists (para encargado)
checklistRouter.get('/', authenticate, async (req, res) => {
  try {
    await ensureChecklistTable();
    const { date, vehicle_id, limit=50 } = req.query;
    const ref = { value: `SELECT c.* FROM checklists c LEFT JOIN vehicles v ON v.id = c.vehicle_id WHERE 1=1` };
    const params = [];
    if (date) { params.push(date); ref.value += ` AND DATE(c.created_at)=$${params.length}`; }
    if (vehicle_id) { params.push(vehicle_id); ref.value += ` AND c.vehicle_id=$${params.length}`; }
    // Gerente de sucursal: solo checklists de vehículos de su sucursal (no-op para el resto).
    _addVehicleBranchFilter(req, params, ref, 'v');
    ref.value += ` ORDER BY c.created_at DESC LIMIT $${params.length+1}`;
    params.push(parseInt(limit));
    const r = await query(ref.value, params);
    res.json(r.rows);
  } catch(err) { res.status(500).json({error:'Error obtener checklists'}); }
});

// ======= DASHBOARD ENCARGADO =======
const encargadoRouter = express.Router();

encargadoRouter.get('/resumen', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','encargado_combustible','mecanico','gerente_sucursal'), async (req, res) => {
  try {
    await ensureChecklistTable();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const branch = _userSucursal(req);
    const scoped = _isGerenteSucursal(req);

    if (scoped && !branch) {
      return res.json({
        fecha: today,
        flota: {},
        checklists_hoy: [],
        checklists_count: 0,
        checklists_con_problema: 0,
        novedades_abiertas: [],
        novedades_count: 0,
        sin_checklist: [],
        sin_checklist_count: 0,
        cargas_hoy: [],
        cargas_count: 0,
        litros_hoy: 0,
        aviso: 'Gerente de sucursal sin sucursal asignada'
      });
    }

    const pDate = scoped ? [today, branch] : [today];
    const pBranch = scoped ? [branch] : [];
    const branchCheck = scoped ? ' AND v.base = $2' : '';
    const branchOnly  = scoped ? ' AND v.base = $1' : '';

    const [checklists, novedades, sinChecklist, fuelHoy, vehiculos] = await Promise.all([
      query(`SELECT c.*, v.code as vcode, v.code as vehicle_code, v.plate, v.driver_name
             FROM checklists c
             LEFT JOIN vehicles v ON v.id=c.vehicle_id
             WHERE DATE(c.created_at)=$1${branchCheck}
             ORDER BY c.created_at DESC`, pDate),
      query(`SELECT wo.*, v.code as vehicle_code
             FROM work_orders wo
             LEFT JOIN vehicles v ON v.id=wo.vehicle_id
             WHERE wo.status <> 'Cerrada'${branchOnly}
             ORDER BY wo.opened_at DESC LIMIT 20`, pBranch),
      query(`SELECT v.code, v.plate, v.driver_name, v.base
             FROM vehicles v
             WHERE v.active=TRUE${branchCheck}
               AND v.id NOT IN (SELECT vehicle_id FROM checklists WHERE DATE(created_at)=$1 AND vehicle_id IS NOT NULL)
             ORDER BY v.code`, pDate),
      query(`SELECT fl.*, v.code as vehicle_code
             FROM fuel_logs fl
             LEFT JOIN vehicles v ON v.id=fl.vehicle_id
             WHERE DATE(fl.logged_at)=$1${branchCheck}
             ORDER BY fl.logged_at DESC`, pDate),
      query(`SELECT status, COUNT(*) as cnt
             FROM vehicles v
             WHERE active=TRUE${branchOnly}
             GROUP BY status`, pBranch),
    ]);

    const flotaResumen = {};
    vehiculos.rows.forEach(r => { flotaResumen[r.status] = parseInt(r.cnt); });

    res.json({
      fecha: today,
      sucursal: scoped ? branch : null,
      flota: flotaResumen,
      checklists_hoy: checklists.rows,
      checklists_count: checklists.rows.length,
      checklists_con_problema: checklists.rows.filter(c=>!c.all_ok).length,
      novedades_abiertas: novedades.rows,
      novedades_count: novedades.rows.length,
      sin_checklist: sinChecklist.rows,
      sin_checklist_count: sinChecklist.rows.length,
      cargas_hoy: fuelHoy.rows,
      cargas_count: fuelHoy.rows.length,
      litros_hoy: fuelHoy.rows.reduce((a,b)=>a+parseFloat(b.liters||0),0),
    });
  } catch(err) { console.error('encargado resumen:', err.message); res.status(500).json({error:'Error resumen'}); }
});


// ── Verificar ticket de carga ─────────────────────────────
fuelRouter.patch('/:id/verificar', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','encargado_combustible'), validateUUID('id'), async (req, res) => {
  try {
    const { accion, observacion } = req.body; // accion: 'aprobar' | 'observar'
    if (!['aprobar','observar'].includes(accion)) return res.status(400).json({ error: 'accion debe ser aprobar u observar' });

    // Asegurar columnas
    await query("ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_estado VARCHAR(20)").catch(()=>{});
    await query("ALTER TABLE fuel_logs ALTER COLUMN ticket_estado DROP DEFAULT").catch(()=>{});
    await query('ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_obs TEXT').catch(()=>{});
    await query('ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_por UUID').catch(()=>{});
    await query('ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_at TIMESTAMPTZ').catch(()=>{});

    let sql, params;
    if (accion === 'aprobar') {
      // Aprobar: marcar como verificado, conservando la foto para auditoría y consulta posterior.
      sql = `UPDATE fuel_logs SET 
        ticket_estado = 'verificado',
        ticket_verificado_por = $1,
        ticket_verificado_at = NOW()
        WHERE id = $2 RETURNING id, ticket_estado`;
      params = [req.user.id, req.params.id];
    } else {
      // Observar: mantener la foto y marcar para investigar
      sql = `UPDATE fuel_logs SET 
        ticket_estado = 'observado',
        ticket_obs = $1,
        ticket_verificado_por = $2,
        ticket_verificado_at = NOW()
        WHERE id = $3 RETURNING id, ticket_estado`;
      params = [observacion || 'Sin observación', req.user.id, req.params.id];
    }

    const r = await query(sql, params);
    if (!r.rows[0]) return res.status(404).json({ error: 'Carga no encontrada' });
    res.json({ ok: true, estado: r.rows[0].ticket_estado });
  } catch(err) { console.error('[fuel verificar]', err.message); res.status(500).json({ error: 'Error al verificar ticket' }); }
});

// ── Cargas pendientes de verificación ────────────────────
// DELETE /api/fuel/:id — solo dueño puede eliminar cargas
fuelRouter.delete('/:id', authenticate, requireRole('dueno'), validateUUID('id'), async (req, res) => {
  // Transacción con DELETE primero (RETURNING): antes se acreditaban los litros al
  // tanque y DESPUÉS se borraba, en dos queries sueltas — dos requests simultáneos
  // (doble clic / reintento) acreditaban los litros dos veces, y un fallo a mitad
  // dejaba el tanque inflado. Con el DELETE atómico, el segundo request encuentra
  // 0 filas y recibe 404; el crédito y el borrado quedan en la misma transacción.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const del = await client.query('DELETE FROM fuel_logs WHERE id=$1 RETURNING *', [req.params.id]);
    if (!del.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Carga no encontrada' }); }
    const fl = del.rows[0];
    let devueltos = 0;
    if (fl.tank_id && fl.liters) {
      const t = await client.query('UPDATE tanks SET current_l = current_l + $1, updated_at = NOW() WHERE id = $2 RETURNING id', [fl.liters, fl.tank_id]);
      if (t.rows[0]) devueltos = parseFloat(fl.liters) || 0;
    }
    await client.query('COMMIT');
    // Auditoría con el CONTENIDO borrado (antes quedaba solo "DELETE fuel {}" y era
    // imposible reconstruir qué carga se eliminó).
    await auditChange(req, res, {
      action: 'fuel_delete', table: 'fuel', recordId: req.params.id,
      oldValue: {
        vehicle_id: fl.vehicle_id, fuel_type: fl.fuel_type, liters: fl.liters,
        price_per_l: fl.price_per_l, odometer_km: fl.odometer_km, location: fl.location,
        logged_at: fl.logged_at, driver_name: fl.driver_name, tank_id: fl.tank_id,
      },
      newValue: { deleted: true, liters_devueltos: devueltos },
    });
    res.json({ ok: true, liters_devueltos: devueltos });
  } catch(err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[fuel DELETE]', err.message); res.status(500).json({ error: 'Error al eliminar carga' });
  } finally { client.release(); }
});

fuelRouter.get('/pendientes-verificacion', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','encargado_combustible','mecanico','gerente_sucursal'), async (req, res) => {
  try {
    await query("ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_estado VARCHAR(20)").catch(()=>{});
    await query("ALTER TABLE fuel_logs ALTER COLUMN ticket_estado DROP DEFAULT").catch(()=>{});
    await query("ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_obs TEXT").catch(()=>{});
    await query("ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_por UUID").catch(()=>{});
    await query("ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_at TIMESTAMPTZ").catch(()=>{});
    const params = [];
    let sql = `
      SELECT fl.id, fl.vehicle_id, fl.liters, fl.price_per_l, fl.logged_at, fl.location,
             fl.ticket_estado, fl.ticket_obs, fl.ticket_image,
             v.code as vehicle_code, u.name as driver_name
      FROM fuel_logs fl
      JOIN vehicles v ON v.id = fl.vehicle_id
      LEFT JOIN users u ON u.id = fl.driver_id
      WHERE fl.ticket_image IS NOT NULL AND (fl.ticket_estado IS NULL OR fl.ticket_estado = 'pendiente')`;
    const ref = { value: sql };
    _addVehicleBranchFilter(req, params, ref, 'v');
    ref.value += ' ORDER BY fl.logged_at DESC LIMIT 50';
    const r = await query(ref.value, params);
    res.json(r.rows);
  } catch(err) { console.error('[fuel pendientes]', err.message); res.status(500).json({ error: 'Error al obtener pendientes' }); }
});

module.exports = { fuelRouter, tireRouter, docRouter, userRouter, configRouter, checklistRouter, encargadoRouter };
