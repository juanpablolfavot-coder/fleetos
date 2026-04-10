process.on('uncaughtException',(e)=>{console.error('CRASH:',e.message,e.stack);process.exit(1);});
process.on('unhandledRejection',(r)=>{console.error('REJECT:',r);process.exit(1);});
require('dotenv').config();
const express=require('express');
const helmet=require('helmet');
const cors=require('cors');
const hpp=require('hpp');
const compression=require('compression');
const morgan=require('morgan');
const path=require('path');
const cookieParser=require('cookie-parser');
const {apiLimiter}=require('./middleware/security');
const {sanitize}=require('./middleware/security');
const authRoutes=require('./routes/auth');
const vehicleRoutes=require('./routes/vehicles');
const woRoutes=require('./routes/workorders');
const stockRoutes=require('./routes/stock');
const {fuelRouter,tireRouter,docRouter,userRouter}=require('./routes/others');
const app=express();
app.use(helmet());
app.use(cors({origin:(o,cb)=>cb(null,true),credentials:true}));
app.use(cookieParser());
app.use(express.json({limit:'1mb'}));
app.use(hpp());
app.use(sanitize);
app.use(compression());
if(process.env.NODE_ENV!=='production')app.use(morgan('dev'));
app.set('trust proxy',1);
app.use('/api/',apiLimiter);
app.use('/api/auth',authRoutes);
app.use('/api/vehicles',vehicleRoutes);
app.use('/api/workorders',woRoutes);
app.use('/api/stock',stockRoutes);
app.use('/api/fuel',fuelRouter);
app.use('/api/tires',tireRouter);
app.use('/api/documents',docRouter);
app.use('/api/users',userRouter);
app.get('/api/health',async(req,res)=>{
  try{const{pool}=require('./db/pool');await pool.query('SELECT 1');res.json({status:'ok',db:'connected'});}
  catch(e){res.status(503).json({status:'error',db:'disconnected',msg:e.message});}
});
app.use(express.static(path.join(__dirname,'public'),{maxAge:process.env.NODE_ENV==='production'?'7d':'0'}));
app.get(/^(?!\/api).*/,(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err,req,res,next)=>{console.error('ERR:',err.message);res.status(err.status||500).json({error:err.message});});

// TEMPORAL: endpoint de migraciÃ³n (eliminar despuÃ©s)
app.get('/api/migrate-now', async(req,res)=>{
  const secret = req.query.secret;
  if(secret !== 'fleet2024migrate') return res.status(403).json({error:'forbidden'});
  try {
    const fs = require('fs');
    const path = require('path');
    const bcrypt = require('bcryptjs');
    const {pool} = require('./db/pool');
    const schema = fs.readFileSync(path.join(__dirname,'db','schema.sql'),'utf8');
    await pool.query(schema);
    const existing = await pool.query("SELECT id FROM users WHERE email=$1",['admin@fleetos.com']);
    if(existing.rows.length===0){
      const hash = await bcrypt.hash('FleetOS2024!',12);
      await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)",
        ['Administrador','admin@fleetos.com',hash,'dueno']);
    }
    await pool.query("INSERT INTO tanks(type,capacity_l,current_l,location) VALUES('fuel',10000,6840,'Base Central'),('urea',2000,380,'Base Central') ON CONFLICT DO NOTHING");
    res.json({status:'ok',message:'MigraciÃ³n completada. Usuario: admin@fleetos.com / FleetOS2024!'});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('FleetOS OK port',PORT));


// TEMP: Migration endpoint
app.get('/api/run-migrate', async (req, res) => {
  const secret = req.query.secret;
  if (secret !== process.env.JWT_SECRET?.slice(0,20)) {
    return res.status(403).json({error:'forbidden'});
  }
  try {
    const fs = require('fs');
    const path = require('path');
    const bcrypt = require('bcryptjs');
    const {pool} = require('./db/pool');
    const schema = fs.readFileSync(path.join(__dirname,'db','schema.sql'),'utf8');
    await pool.query(schema);
    const ex = await pool.query("SELECT id FROM users WHERE email=$1",['admin@fleetos.com']);
    if(ex.rows.length===0){
      const hash = await bcrypt.hash('FleetOS2024!',12);
      await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)",
        ['Administrador','admin@fleetos.com',hash,'dueno']);
    }
    await pool.query(`INSERT INTO tanks(type,capacity_l,current_l,location) VALUES('fuel',10000,6840,'Base Central'),('urea',2000,380,'Base Central') ON CONFLICT DO NOTHING`);
    res.json({ok:true,msg:'Migracion completada'});
  } catch(e) { res.status(500).json({error:e.message}); }
});
