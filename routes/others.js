// Ã¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢Â
//  FleetOS Ã¢â¬â Rutas adicionales
// Ã¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢ÂÃ¢â¢Â
const express    = require('express');
const fuelRouter = express.Router();
const tireRouter = express.Router();
const docRouter  = express.Router();
const userRouter = express.Router();
const { query }  = require('../db/pool');
const { authenticate, requireRole, requireOwner, auditAction } = require('../middleware/auth');
const { validateUUID, sensitiveLimiter } = require('../middleware/security');
const bcrypt     = require('bcryptjs');

// ======= COMBUSTIBLE =======
// Migración: agregar price_per_l a tanks si no existe
(async () => {
  try {
    await query("ALTER TABLE tanks ADD COLUMN IF NOT EXISTS price_per_l NUMERIC(12,2)");
  } catch(e) {}
})();

fuelRouter.get('/', authenticate, async (req, res) => {
  try {
    const { vehicle_id, limit = 50 } = req.query;
    let sql = `SELECT fl.*, v.code AS vehicle_code, v.plate, u.name AS driver_name
      FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
      LEFT JOIN users u ON u.id = fl.driver_id WHERE 1=1`;
    const params = [];
    if (req.user.role === 'chofer') { params.push(req.user.id); sql += ` AND fl.driver_id=$${params.length}`; }
    if (vehicle_id) { params.push(vehicle_id); sql += ` AND fl.vehicle_id=$${params.length}`; }
    sql += ` ORDER BY fl.logged_at DESC LIMIT $${params.length+1}`; params.push(parseInt(limit));
    res.json((await query(sql, params)).rows);
  } catch (err) { res.status(500).json({ error: 'Error combustible' }); }
});
fuelRouter.get('/tanks', authenticate, async (req, res) => {
  try { res.json((await query('SELECT DISTINCT ON (type) id, type, capacity_l, current_l, location, price_per_l FROM tanks ORDER BY type ASC')).rows); }
  catch (err) { res.status(500).json({ error: 'Error cisternas' }); }
});
fuelRouter.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','encargado_combustible','chofer'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    const { vehicle_id, tank_id, fuel_type, liters, price_per_l, odometer_km, location, notes, ticket_image } = req.body;
    if (!vehicle_id || !liters || !price_per_l) return res.status(400).json({ error: 'vehicle_id, liters y price_per_l requeridos' });
    // Chofer solo puede cargar a su propia unidad asignada
    if (req.user.role === 'chofer') {
      const veh = await client.query('SELECT code FROM vehicles WHERE id=$1 AND active=TRUE', [vehicle_id]);
      if (!veh.rows[0]) return res.status(404).json({ error: 'Vehículo no encontrado' });
      if (veh.rows[0].code !== req.user.vehicle_code) {
        return res.status(403).json({ error: 'Solo podés cargar combustible a tu unidad asignada (' + (req.user.vehicle_code||'sin asignar') + ')' });
      }
    }
    // Control de duplicados: misma unidad en los últimos 10 minutos
    const dup = await client.query(
      "SELECT id FROM fuel_logs WHERE vehicle_id=$1 AND driver_id=$2 AND logged_at > NOW() - INTERVAL '10 minutes'",
      [vehicle_id, req.user.id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'Ya registraste una carga para esta unidad hace menos de 10 minutos. Si es correcta, esperá unos minutos e intentá de nuevo.' });
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
    await client.query('BEGIN');
    // Asegurar que existe la columna ticket_image
    await client.query(`ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_image TEXT`).catch(()=>{});
    if (tank_id) {
      const t = await client.query('SELECT current_l FROM tanks WHERE id=$1 FOR UPDATE',[tank_id]);
      if (!t.rows[0] || t.rows[0].current_l < liters) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Combustible insuficiente' }); }
      await client.query('UPDATE tanks SET current_l=current_l-$1,updated_at=NOW() WHERE id=$2',[liters,tank_id]);
    }
    // Tomar km del GPS (km_current del vehículo) si no viene odómetro manual
    const vehKm = await client.query('SELECT km_current FROM vehicles WHERE id=$1',[vehicle_id]);
    const kmToSave = odometer_km || vehKm.rows[0]?.km_current || null;
    const r = await client.query(`INSERT INTO fuel_logs(vehicle_id,driver_id,tank_id,fuel_type,liters,price_per_l,odometer_km,location,notes,ticket_image) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[vehicle_id,req.user.id,tank_id||null,fuel_type||'diesel',liters,price_per_l,kmToSave,location||null,notes||null,ticket_image||null]);
    if (odometer_km) await client.query('UPDATE vehicles SET km_current=$1 WHERE id=$2 AND km_current<$1',[odometer_km,vehicle_id]);
    await client.query('COMMIT'); res.status(201).json(r.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: 'Error carga' }); } finally { client.release(); }
});
fuelRouter.patch('/tanks/:id',authenticate,requireRole('dueno','gerencia','encargado_combustible'),validateUUID('id'),async(req,res)=>{
  try{
    const { current_l, capacity_l, price_per_l } = req.body;
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
  try{const{status,vehicle_id}=req.query;let sql=`SELECT t.*,v.code AS vehicle_code FROM tires t LEFT JOIN vehicles v ON v.id=t.current_vehicle_id WHERE 1=1`;
  const p=[];if(status){p.push(status);sql+=` AND t.status=$${p.length}`;}if(vehicle_id){p.push(vehicle_id);sql+=` AND t.current_vehicle_id=$${p.length}`;}
  sql+=' ORDER BY t.serial_no';res.json((await query(sql,p)).rows);}catch(err){res.status(500).json({error:'Error cubiertas'});}
});
tireRouter.post('/',authenticate,requireRole('dueno','gerencia','jefe_mantenimiento'),async(req,res)=>{
  try{const{serial_no,brand,model,size,purchase_price,purchase_date,tread_depth}=req.body;
  if(!serial_no) return res.status(400).json({error:'serial_no requerido'});
  const r=await query(`INSERT INTO tires(serial_no,brand,model,size,purchase_price,purchase_date,tread_depth) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[serial_no,brand||null,model||null,size||null,purchase_price||null,purchase_date||null,tread_depth||null]);
  res.status(201).json(r.rows[0]);}catch(err){if(err.code==='23505') return res.status(409).json({error:'NÃÂºmero serie existe'});res.status(500).json({error:'Error cubierta'});}
});
tireRouter.post('/:id/move',authenticate,requireRole('dueno','gerencia','jefe_mantenimiento','mecanico'),validateUUID('id'),async(req,res)=>{
  const client=await require('../db/pool').pool.connect();
  try{const{to_vehicle_id,to_position,type,notes,tread_depth}=req.body;
  await client.query('BEGIN');
  const tire=await client.query('SELECT * FROM tires WHERE id=$1 FOR UPDATE',[req.params.id]);
  if(!tire.rows[0]){await client.query('ROLLBACK');return res.status(404).json({error:'Cubierta no encontrada'});}
  const veh=to_vehicle_id?await client.query('SELECT km_current FROM vehicles WHERE id=$1',[to_vehicle_id]):null;
  const km=veh?.rows[0]?.km_current||0;
  await client.query(`INSERT INTO tire_movements(tire_id,type,from_pos,to_pos,vehicle_id,km_at_move,tread_at_move,user_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[req.params.id,type||'RotaciÃÂ³n',tire.rows[0].current_position,to_position,to_vehicle_id||tire.rows[0].current_vehicle_id,km,tread_depth||tire.rows[0].tread_depth,req.user.id,notes||null]);
  const ns=to_vehicle_id?'montada':({'STOCK':'stock','Stock':'stock','RECAP':'recapado','Recap':'recapado','Recapado':'recapado','recapado':'recapado','BAJA':'baja','Baja':'baja','baja':'baja'}[to_position]||'stock');
  await client.query(`UPDATE tires SET current_vehicle_id=$1,current_position=$2,status=$3,tread_depth=COALESCE($4,tread_depth),km_total=km_total+$5 WHERE id=$6`,[to_vehicle_id||null,to_position,ns,tread_depth||null,km,req.params.id]);
  await client.query('COMMIT');res.json({message:'Movimiento registrado'});}catch(err){await client.query('ROLLBACK');res.status(500).json({error:'Error mover cubierta'});}finally{client.release();}
});

// ======= DOCUMENTOS =======
docRouter.get('/',authenticate,async(req,res)=>{
  try{const{entity_type,entity_id,status}=req.query;let sql='SELECT * FROM documents WHERE 1=1';const p=[];
  if(entity_type){p.push(entity_type);sql+=` AND entity_type=$${p.length}`;}if(entity_id){p.push(entity_id);sql+=` AND entity_id=$${p.length}`;}if(status){p.push(status);sql+=` AND status=$${p.length}`;}
  sql+=' ORDER BY expiry_date ASC';res.json((await query(sql,p)).rows);}catch(err){res.status(500).json({error:'Error documentos'});}
});
docRouter.post('/',authenticate,requireRole('dueno','gerencia','jefe_mantenimiento','contador'),async(req,res)=>{
  try{const{entity_type,entity_id,doc_type,reference,issue_date,expiry_date,notes}=req.body;
  if(!entity_type||!entity_id||!doc_type||!expiry_date) return res.status(400).json({error:'Campos requeridos'});
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
userRouter.get('/',authenticate,requireRole('dueno','gerencia'),async(req,res)=>{
  try{res.json((await query('SELECT id,name,email,role,vehicle_code,active,last_login FROM users ORDER BY name')).rows);}catch(err){res.status(500).json({error:'Error usuarios'});}
});
userRouter.post('/',authenticate,requireRole('dueno','gerencia'),async(req,res)=>{
  try{const{name,email,password,role,vehicle_code}=req.body;
  if(!name||!email||!password||!role) return res.status(400).json({error:'name,email,password,role requeridos'});
  const hash=await bcrypt.hash(password,parseInt(process.env.BCRYPT_ROUNDS)||12);
  const r=await query(`INSERT INTO users(name,email,password_hash,role,vehicle_code) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,active`,[name,email.toLowerCase(),hash,role,vehicle_code||null]);
  res.status(201).json(r.rows[0]);}catch(err){if(err.code==='23505') return res.status(409).json({error:'Email existe'});res.status(500).json({error:'Error usuario'});}
});
userRouter.delete('/:id', authenticate, requireRole('dueno'), validateUUID('id'), async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'No podés eliminar tu propio usuario' });
    const check = await query('SELECT email FROM users WHERE id=$1', [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (check.rows[0].email === 'admin@fleetos.com') return res.status(400).json({ error: 'No se puede eliminar el usuario administrador' });
    await query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.params.id]);
    await query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(err) { console.error('DELETE user:', err.message); res.status(500).json({ error: 'Error al eliminar usuario' }); }
});

userRouter.put('/:id',authenticate,requireRole('dueno','gerencia'),validateUUID('id'),async(req,res)=>{
  try{
    const{name,role,vehicle_code,active,password}=req.body;
    if(req.params.id===req.user.id&&active===false) return res.status(400).json({error:'No puedes desactivarte'});
    // Si viene contraseña nueva la hasheamos
    if(password && password.length>=8){
      const hash=await bcrypt.hash(password,parseInt(process.env.BCRYPT_ROUNDS)||12);
      await query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2',[hash,req.params.id]);
    }
    const r=await query('UPDATE users SET name=$1,role=$2,vehicle_code=$3,active=$4,updated_at=NOW() WHERE id=$5 RETURNING id,name,email,role,active',[name,role,vehicle_code||null,active!==false,req.params.id]);
    if(!r.rows[0]) return res.status(404).json({error:'Usuario no encontrado'});
    res.json(r.rows[0]);
  }catch(err){console.error('PUT user error:',err.message);res.status(500).json({error:'Error actualizar'});}
});

// ======= CONFIGURACIÓN (bases y tipos) =======
const configRouter = express.Router();
const DEFAULT_BASES = ['Central','Norte','Sur'];
const DEFAULT_VTYPES = ['tractor','camion','semirremolque','acoplado','utilitario','autoelevador'];

configRouter.get('/', authenticate, async (req, res) => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value JSONB NOT NULL)`);
    const bases = await query(`SELECT value FROM app_config WHERE key='bases'`);
    const vtypes = await query(`SELECT value FROM app_config WHERE key='vehicle_types'`);
    res.json({
      bases:  bases.rows[0]  ? bases.rows[0].value  : DEFAULT_BASES,
      vehicle_types: vtypes.rows[0] ? vtypes.rows[0].value : DEFAULT_VTYPES,
    });
  } catch (err) { res.status(500).json({ error: 'Error config' }); }
});

configRouter.put('/', authenticate, requireRole('dueno','gerencia'), async (req, res) => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value JSONB NOT NULL)`);
    const { bases, vehicle_types } = req.body;
    if (bases)         await query(`INSERT INTO app_config(key,value) VALUES('bases',$1) ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(bases)]);
    if (vehicle_types) await query(`INSERT INTO app_config(key,value) VALUES('vehicle_types',$1) ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(vehicle_types)]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error guardar config' }); }
});

module.exports = { fuelRouter, tireRouter, docRouter, userRouter, configRouter };

// ======= CHECKLIST =======
const checklistRouter = express.Router();

// Crear tabla si no existe
async function ensureChecklistTable() {
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
    const critical = (items||[]).filter(i => !i.ok && i.critical);
    if (critical.length > 0) {
      const desc = 'Checklist salida: ' + critical.map(i=>i.label).join(', ');
      await query(
        `INSERT INTO work_orders(vehicle_id,description,priority,status,type,created_by)
         VALUES($1,$2,'urgente','Abierta','correctivo',$3)`,
        [vehicle_id||null, desc, req.user.id]
      ).catch(()=>{});
    }
    // Actualizar km del vehículo
    if (km_at_check && vehicle_id) {
      await query('UPDATE vehicles SET km_current=$1 WHERE id=$2 AND km_current<$1',[km_at_check,vehicle_id]).catch(()=>{});
    }
    res.status(201).json(r.rows[0]);
  } catch(err) { console.error('POST checklist:', err.message); res.status(500).json({error:'Error guardar checklist'}); }
});

// GET — listar checklists (para encargado)
checklistRouter.get('/', authenticate, async (req, res) => {
  try {
    await ensureChecklistTable();
    const { date, vehicle_id, limit=50 } = req.query;
    let sql = `SELECT * FROM checklists WHERE 1=1`;
    const params = [];
    if (date) { params.push(date); sql += ` AND DATE(created_at)=$${params.length}`; }
    if (vehicle_id) { params.push(vehicle_id); sql += ` AND vehicle_id=$${params.length}`; }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length+1}`;
    params.push(parseInt(limit));
    const r = await query(sql, params);
    res.json(r.rows);
  } catch(err) { res.status(500).json({error:'Error obtener checklists'}); }
});

// ======= DASHBOARD ENCARGADO =======
const encargadoRouter = express.Router();

encargadoRouter.get('/resumen', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), async (req, res) => {
  try {
    await ensureChecklistTable();
    const today = new Date().toISOString().slice(0,10);

    const [checklists, novedades, sinChecklist, fuelHoy, vehiculos] = await Promise.all([
      // Checklists de hoy
      query(`SELECT c.*, v.code as vcode FROM checklists c LEFT JOIN vehicles v ON v.id=c.vehicle_id WHERE DATE(c.created_at)=$1 ORDER BY c.created_at DESC`, [today]),
      // Novedades abiertas (OTs)
      query(`SELECT wo.*, v.code as vehicle_code FROM work_orders wo LEFT JOIN vehicles v ON v.id=wo.vehicle_id WHERE wo.status='Abierta' ORDER BY wo.created_at DESC LIMIT 20`),
      // Vehículos activos que NO hicieron checklist hoy
      query(`SELECT v.code, v.plate, v.driver_name, v.base FROM vehicles v WHERE v.active=TRUE AND v.id NOT IN (SELECT vehicle_id FROM checklists WHERE DATE(created_at)=$1 AND vehicle_id IS NOT NULL) ORDER BY v.code`, [today]),
      // Cargas de combustible hoy
      query(`SELECT fl.*, v.code as vehicle_code FROM fuel_logs fl LEFT JOIN vehicles v ON v.id=fl.vehicle_id WHERE DATE(fl.logged_at)=$1 ORDER BY fl.logged_at DESC`, [today]),
      // Resumen flota
      query(`SELECT status, COUNT(*) as cnt FROM vehicles WHERE active=TRUE GROUP BY status`),
    ]);

    const flotaResumen = {};
    vehiculos.rows.forEach(r => { flotaResumen[r.status] = parseInt(r.cnt); });

    res.json({
      fecha: today,
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
    await query("ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_estado VARCHAR(20) DEFAULT 'pendiente'").catch(()=>{});
    await query('ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_obs TEXT').catch(()=>{});
    await query('ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_por UUID').catch(()=>{});
    await query('ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_at TIMESTAMPTZ').catch(()=>{});

    let sql, params;
    if (accion === 'aprobar') {
      // Aprobar: marcar como verificado y BORRAR la foto para liberar espacio
      sql = `UPDATE fuel_logs SET 
        ticket_estado = 'verificado',
        ticket_image = NULL,
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
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Cargas pendientes de verificación ────────────────────
// DELETE /api/fuel/:id — solo dueño puede eliminar cargas
fuelRouter.delete('/:id', authenticate, requireRole('dueno'), validateUUID('id'), async (req, res) => {
  try {
    const fuel = await query('SELECT * FROM fuel_logs WHERE id=$1', [req.params.id]);
    if (!fuel.rows[0]) return res.status(404).json({ error: 'Carga no encontrada' });
    
    // Si tenía cisterna, devolver los litros
    const fl = fuel.rows[0];
    if (fl.tank_id && fl.liters) {
      await query('UPDATE tanks SET current_l = current_l + $1 WHERE id = $2', [fl.liters, fl.tank_id]);
    }
    
    await query('DELETE FROM fuel_logs WHERE id=$1', [req.params.id]);
    res.json({ ok: true, liters_devueltos: fl.tank_id ? fl.liters : 0 });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

fuelRouter.get('/pendientes-verificacion', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','encargado_combustible'), async (req, res) => {
  try {
    await query("ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_estado VARCHAR(20) DEFAULT 'pendiente'").catch(()=>{});
    await query("ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_obs TEXT").catch(()=>{});
    await query("ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_por UUID").catch(()=>{});
    await query("ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS ticket_verificado_at TIMESTAMPTZ").catch(()=>{});
    const r = await query(`
      SELECT fl.id, fl.vehicle_id, fl.liters, fl.price_per_l, fl.logged_at, fl.location,
             fl.ticket_estado, fl.ticket_obs, fl.ticket_image,
             v.code as vehicle_code, u.name as driver_name
      FROM fuel_logs fl
      JOIN vehicles v ON v.id = fl.vehicle_id
      LEFT JOIN users u ON u.id = fl.driver_id
      WHERE fl.ticket_image IS NOT NULL AND (fl.ticket_estado IS NULL OR fl.ticket_estado = 'pendiente')
      ORDER BY fl.logged_at DESC LIMIT 50`);
    res.json(r.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = { fuelRouter, tireRouter, docRouter, userRouter, configRouter, checklistRouter, encargadoRouter };

