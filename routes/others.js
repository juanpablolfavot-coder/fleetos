// ══════════════════════════════════════════
//  FleetOS — Rutas adicionales
// ══════════════════════════════════════════
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
  try { res.json((await query('SELECT * FROM tanks ORDER BY type')).rows); }
  catch (err) { res.status(500).json({ error: 'Error cisternas' }); }
});
fuelRouter.post('/', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento','encargado_combustible','chofer'), async (req, res) => {
  const client = await require('../db/pool').pool.connect();
  try {
    const { vehicle_id, tank_id, fuel_type, liters, price_per_l, odometer_km, location, notes } = req.body;
    if (!vehicle_id || !liters || !price_per_l) return res.status(400).json({ error: 'vehicle_id, liters y price_per_l requeridos' });
    await client.query('BEGIN');
    if (tank_id) {
      const t = await client.query('SELECT current_l FROM tanks WHERE id=$1 FOR UPDATE',[tank_id]);
      if (!t.rows[0] || t.rows[0].current_l < liters) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Combustible insuficiente' }); }
      await client.query('UPDATE tanks SET current_l=current_l-$1,updated_at=NOW() WHERE id=$2',[liters,tank_id]);
    }
    const r = await client.query(`INSERT INTO fuel_logs(vehicle_id,driver_id,tank_id,fuel_type,liters,price_per_l,odometer_km,location,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETUP�ING *`,[vehicle_id,req.user.id,tank_id||null,fuel_type||'diesel',liters,price_per_l,odometer_km||null,location||null,notes||null]);
    if (odometer_km) await client.query('UPDATE vehicles SET km_current=$1 WHERE id=$2 AND km_current<$1',[odometer_km,vehicle_id]);
    await client.query('COMMIT'); res.status(201).json(r.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: 'Error carga' }); } finally { client.release(); }
});
fuelRouter.patch('/tanks/:id',authenticate,requireRole('dueno','gerencia','encargado_combustible'),validateUUID('id'),async(req,res)=>{
  try{const r = await query('UPDATE tanks SET current_l=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[req.body.current_l,req.params.id]);
  if(!r.rows[0]) return res.status(404).json({error:'Cisterna no encontrada'}); res.json(r.rows[0]);}catch(err){res.status(500).json({error:'Error cisterna'});}
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
  const ns=to_vehicle_id?'montada':(to_position==='Stock'?'stock':'baja');
  await client.query(`UPDATE tires SET current_vehicle_id=$1,current_position=$2,status=$3,tread_depth=COALESCE �4%�read_depth),km_total=km_total+$5 WHERE id=$6`,[to_vehicle_id||null,to_position,ns,tread_depth||null,km,req.params.id]);
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

// ======= USUARIOS =======
userRouter.get('/',authenticate,requireRole('dueno','gerencia'),async(req,res)=>{
  try{res.json((await query('SELECT id,name,email,role,vehicle_code,active,last_login FROM users ORDER BY name')).rows);}catch(err){res.status(500).json({error:'Error usuarios'});}
});
userRouter.post('/',authenticate,requireRole('dueno','gerencia'),async(req,res)=>{
  try{const{name,email,password,role,vehicle_code}=req.body;
  if(!name||!email||!password||!role) return res.status(400).json({error:'name,email,password,role requeridos'});
  const hash=await bcrypt.hash(password,parseInt(process.env.BCRYPT_ROUNDS)||12);
  const r=await query(`INSERT INTO users(name,email,password_hash,role,vehicle_code) VALUES($1,$2,$3,$4,$5) RETUP�ING id,name,email,role,active`,[name,email.toLowerCase(),hash,role,vehicle_code||null]);
  res.status(201).json(r.rows[0]);}catch(err){if(err.code==='23505') return res.status(409).json({error:'Email existe'});res.status(500).json({error:'Error usuario'});}
});
userRouter.put('/:id',authenticate,requireRole('dueno','gerencia'),validateUUID('id'),async(req,res)=>{
  try{const{name,role,vehicle_code,active}=req.body;
  if(req.params.id===req.user.id&&active===false) return res.status(400).json({error:'No puedes desactivarte'});
  const r=await query('UPDATE users SET name=$1,role=$2,vehicle_code=$3,active=$4 WHERE id=$5 RETURNING id,name,email,role,active',[name,role,vehicle_code||null,active!==false,req.params.id]);
  if(!r.rows[0]) return res.status(404).json({error:'Usuario no encontrado'});
  res.json(r.rows[0]);}catch(err){res.status(500).json({error:'Error actualizar'});}
});

mmdule.exports = { fuelRouter, tireRouter, docRouter, userRouter };
