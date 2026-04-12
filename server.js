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
const { startGPSSync, syncGPSData, getGPSStatus } = require('./services/gps-powerfleet');
const {sanitize}=require('./middleware/security');
const authRoutes=require('./routes/auth');
const vehicleRoutes=require('./routes/vehicles');
const woRoutes=require('./routes/workorders');
const stockRoutes=require('./routes/stock');
const {fuelRouter,tireRouter,docRouter,userRouter}=require('./routes/others');
const app=express();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
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
// Forzar no-cache en archivos JS y CSS
app.use((req, res, next) => {
  if (req.path.match(/\.(js|css)$/)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname,'public'),{maxAge:'0', etag:false, lastModified:false}));
app.get(/^(?!\/api).*/, (req, res) => {
  const fs = require('fs');
  const filePath = require('path').join(__dirname, 'public', 'index.html');
  let html = fs.readFileSync(filePath, 'utf8');
  
  // Forzar que el browser nunca use cache del HTML
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  
  res.send(html);
});
app.use((err,req,res,next)=>{console.error('ERR:',err.message);res.status(err.status||500).json({error:err.message});});

// ── Endpoints GPS ──
app.get('/api/gps/status', async (req, res) => {
  res.json(getGPSStatus());
});

app.post('/api/gps/sync', async (req, res) => {
  syncGPSData();
  res.json({ ok: true, message: 'Sync iniciado' });
});

// TEMPORAL: endpoint de migraciÃÂÃÂÃÂÃÂ³n (eliminar despuÃÂÃÂÃÂÃÂ©s)
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
    res.json({status:'ok',message:'MigraciÃÂÃÂÃÂÃÂ³n completada. Usuario: admin@fleetos.com / FleetOS2024!'});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

const PORT=process.env.PORT||3000;
app.listen(PORT, () => {
  console.log('FleetOS OK port', PORT);
  // Iniciar sync GPS con Powerfleet cada 5 minutos
  startGPSSync(5);
});


// TEMP: Migration endpoint
app.get('/api/run-migrate', async (req, res) => {
  if (req.query.secret !== 'migrate-fleetos-2024') return res.status(403).json({error:'forbidden'});
  const results = [];
  try {
    const fs = require('fs'), path = require('path'), bcrypt = require('bcryptjs');
    const {pool} = require('./db/pool');
    const client = await pool.connect();
    try {
      // Extensions
      await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'); results.push('ext uuid');
      await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'); results.push('ext pgcrypto');
      
      // Users table
      await client.query(`CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('dueno','gerencia','jefe_mantenimiento','mecanico','chofer','encargado_combustible','paniol','contador','auditor')),
        vehicle_code VARCHAR(20),
        active BOOLEAN DEFAULT TRUE,
        login_attempts INTEGER DEFAULT 0,
        locked_until TIMESTAMP,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`); results.push('users');

      await client.query(`CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )`); results.push('refresh_tokens');

      await client.query(`CREATE TABLE IF NOT EXISTS vehicles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        code VARCHAR(20) UNIQUE NOT NULL,
        plate VARCHAR(20) UNIQUE NOT NULL,
        brand VARCHAR(50) NOT NULL,
        model VARCHAR(80) NOT NULL,
        year INTEGER NOT NULL,
        type VARCHAR(30) NOT NULL CHECK (type IN ('tractor','camion','semirremolque','acoplado','cisterna','auxiliar')),
        status VARCHAR(30) NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','warn','taller','detenida','inactiva','baja')),
        vin VARCHAR(50), engine_no VARCHAR(50),
        km_current INTEGER DEFAULT 0, engine_hours INTEGER DEFAULT 0,
        base VARCHAR(50), cost_center VARCHAR(50),
        driver_id UUID REFERENCES users(id),
        cost_per_km DECIMAL(10,4) DEFAULT 0.18,
        fuel_capacity INTEGER, urea_capacity INTEGER,
        notes TEXT, active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )`); results.push('vehicles');

      await client.query(`CREATE TABLE IF NOT EXISTS stock_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(50) NOT NULL,
        unit VARCHAR(20) NOT NULL DEFAULT 'un',
        qty_current DECIMAL(10,2) DEFAULT 0,
        qty_min DECIMAL(10,2) DEFAULT 1,
        unit_cost DECIMAL(12,2) DEFAULT 0,
        supplier VARCHAR(100),
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )`); results.push('stock_items');

      await client.query(`CREATE TABLE IF NOT EXISTS work_orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        code VARCHAR(20) UNIQUE NOT NULL,
        vehicle_id UUID NOT NULL REFERENCES vehicles(id),
        type VARCHAR(30) NOT NULL CHECK (type IN ('Correctivo','Preventivo','Predictivo')),
        status VARCHAR(40) NOT NULL DEFAULT 'Pendiente',
        priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
        description TEXT NOT NULL,
        diagnosis TEXT, root_cause TEXT,
        mechanic_id UUID REFERENCES users(id),
        reporter_id UUID REFERENCES users(id),
        labor_cost DECIMAL(12,2) DEFAULT 0,
        parts_cost DECIMAL(12,2) DEFAULT 0,
        km_at_open INTEGER,
        opened_at TIMESTAMP DEFAULT NOW(),
        closed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )`); results.push('work_orders');

      await client.query(`CREATE TABLE IF NOT EXISTS tanks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        type VARCHAR(20) NOT NULL CHECK (type IN ('fuel','urea')),
        capacity_l INTEGER NOT NULL,
        current_l DECIMAL(10,2) DEFAULT 0,
        location VARCHAR(50),
        updated_at TIMESTAMP DEFAULT NOW()
      )`); results.push('tanks');

      await client.query(`CREATE TABLE IF NOT EXISTS fuel_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        vehicle_id UUID NOT NULL REFERENCES vehicles(id),
        driver_id UUID REFERENCES users(id),
        tank_id UUID REFERENCES tanks(id),
        fuel_type VARCHAR(20) NOT NULL DEFAULT 'diesel',
        liters DECIMAL(8,2) NOT NULL,
        price_per_l DECIMAL(10,2) NOT NULL,
        odometer_km INTEGER,
        location VARCHAR(100),
        notes TEXT,
        logged_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )`); results.push('fuel_logs');

      await client.query(`CREATE TABLE IF NOT EXISTS tires (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        serial_no VARCHAR(50) UNIQUE NOT NULL,
        brand VARCHAR(50), model VARCHAR(80), size VARCHAR(30),
        purchase_price DECIMAL(12,2), purchase_date DATE,
        km_total INTEGER DEFAULT 0, tread_depth DECIMAL(4,1),
        status VARCHAR(20) DEFAULT 'stock' CHECK (status IN ('montada','stock','recapado','baja')),
        current_vehicle_id UUID REFERENCES vehicles(id),
        current_position VARCHAR(20),
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )`); results.push('tires');

      await client.query(`CREATE TABLE IF NOT EXISTS documents (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('vehicle','driver')),
        entity_id UUID NOT NULL,
        doc_type VARCHAR(50) NOT NULL,
        reference VARCHAR(100),
        issue_date DATE, expiry_date DATE NOT NULL,
        file_url VARCHAR(500), notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )`); results.push('documents');

      await client.query(`CREATE TABLE IF NOT EXISTS maintenance_plans (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        task_name VARCHAR(200) NOT NULL,
        interval_type VARCHAR(20) NOT NULL CHECK (interval_type IN ('km','hours','days')),
        interval_value INTEGER NOT NULL,
        last_done_date DATE, next_due_date DATE,
        alert_pct INTEGER DEFAULT 80,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )`); results.push('maintenance_plans');

      // Índices
      try { await client.query('CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status)'); } catch(e){}
      try { await client.query('CREATE INDEX IF NOT EXISTS idx_wo_vehicle ON work_orders(vehicle_id)'); } catch(e){}
      try { await client.query('CREATE INDEX IF NOT EXISTS idx_fuel_vehicle ON fuel_logs(vehicle_id)'); } catch(e){}
      try { await client.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)'); } catch(e){}
      results.push('indexes');

      // Admin user
      const ex = await client.query("SELECT id FROM users WHERE email=$1",['admin@fleetos.com']);
      if(ex.rows.length===0){
        const hash = await bcrypt.hash('FleetOS2024!',12);
        await client.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)",
          ['Administrador','admin@fleetos.com',hash,'dueno']);
        results.push('admin created');
      } else { results.push('admin exists'); }

      // Initial tanks
      await client.query("INSERT INTO tanks(type,capacity_l,current_l,location) VALUES('fuel',10000,6840,'Base Central'),('urea',2000,380,'Base Central') ON CONFLICT DO NOTHING");
      results.push('tanks inserted');

      res.json({ok:true,msg:'Migracion completada',steps:results});
    } finally { client.release(); }
  } catch(e) { res.status(500).json({error:e.message,steps:results}); }
});
