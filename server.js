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
const {fuelRouter,tireRouter,docRouter,userRouter,configRouter,checklistRouter,encargadoRouter}=require('./routes/others');
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
      connectSrc: ["'self'", "cdnjs.cloudflare.com", "rusegur.monitoreodeflotas.com.ar"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({origin:(o,cb)=>cb(null,true),credentials:true}));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
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
app.use('/api/checklists',checklistRouter);
app.use('/api/encargado',encargadoRouter);
app.use('/api/tires',tireRouter);
app.use('/api/documents',docRouter);
app.use('/api/users',userRouter);
app.use('/api/config',configRouter);
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

// ── Reset total de la DB (solo dueno) ──────────────────────
app.post('/api/admin/reset-db', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({error:'No autorizado'});
    
    // Verificar que sea admin/dueno
    const token = auth.replace('Bearer ','');
    const jwt = require('jsonwebtoken');
    let decoded;
    try { decoded = jwt.verify(token, process.env.JWT_SECRET); }
    catch(e) { return res.status(401).json({error:'Token inválido'}); }
    
    if (decoded.role !== 'dueno' && decoded.role !== 'admin') {
      return res.status(403).json({error:'Solo el dueño puede hacer esto'});
    }

    const { query } = require('./db/pool');
    
    // Borrar TODOS los datos en orden correcto (por FK)
    const tables = [
      'tire_moves', 'tire_assets',
      'tires',
      'maintenance_logs',
      'fuel_logs',
      'stock_movements', 'stock_items',
      'documents',
      'work_orders',
      'drivers',
      'vehicles',
    ];
    
    const results = [];
    for (const table of tables) {
      try {
        const r = await query(`DELETE FROM ${table}`);
        results.push({ table, deleted: r.rowCount });
      } catch(e) {
        results.push({ table, error: e.message });
      }
    }

    // Resetear secuencias de IDs
    const seqTables = ['vehicles','work_orders','fuel_logs','stock_items','drivers','documents'];
    for (const t of seqTables) {
      try {
        await query(`ALTER SEQUENCE IF EXISTS ${t}_id_seq RESTART WITH 1`);
      } catch(e) {}
    }
    
    res.json({ ok: true, message: 'DB limpiada. Sistema listo para empezar.', results });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.use((err,req,res,next)=>{console.error('ERR:',err.message);res.status(err.status||500).json({error:err.message});});

// ── Endpoints GPS ──
app.get('/api/gps/status', async (req, res) => {
  res.json(getGPSStatus());
});

// Debug: forzar sync y esperar resultado
app.post('/api/gps/force-sync', async (req, res) => {
  const { syncGPSData, getGPSStatus } = require('./services/gps-powerfleet');
  syncGPSData();
  // Esperar 20s y devolver el resultado
  await new Promise(r => setTimeout(r, 20000));
  res.json(getGPSStatus());
});

app.post('/api/gps/sync', async (req, res) => {
  syncGPSData();
  res.json({ ok: true, message: 'Sync iniciado' });
});


const PORT=process.env.PORT||3000;
app.listen(PORT, () => {
  console.log('FleetOS OK port', PORT);
  // Iniciar sync GPS con Powerfleet cada 5 minutos
  startGPSSync(5);
});


// TEMP: Migration endpoint
