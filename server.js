process.env.TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';

// Referencia al server HTTP (se asigna en app.listen) para poder hacer
// un apagado ordenado ante un crash real.
let httpServer = null;

// unhandledRejection: una promesa rechazada y no capturada (típicamente una
// query "fire and forget" de fondo) NO debe tirar abajo el server. Solo se loguea.
// Esto preserva el comportamiento que evitaba reinicios por cualquier error suelto.
process.on('unhandledRejection', (r) => {
  console.error('UNHANDLED REJECTION:', r);
  // NO process.exit — un rechazo suelto no justifica matar el proceso.
});

// uncaughtException: acá el proceso QUEDÓ en estado indefinido (Node lo advierte).
// Seguir sirviendo requests sobre un proceso corrupto puede dejar transacciones de
// pagos/stock a medio aplicar. Lo correcto: dejar de tomar conexiones nuevas y salir,
// para que Render levante un proceso limpio. Damos un margen breve para cerrar lo en vuelo.
let _shuttingDown = false;
process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT EXCEPTION:', e.message, e.stack);
  if (_shuttingDown) return;
  _shuttingDown = true;
  try {
    if (httpServer) httpServer.close(() => process.exit(1));
  } catch (_) { /* noop */ }
  // Red de seguridad: si el cierre ordenado se cuelga, forzar salida.
  setTimeout(() => process.exit(1), 3000).unref();
});

require('dotenv').config();
// P0 — validar variables de entorno ANTES de cargar módulos que las usan
// (db/pool lee DATABASE_URL al requerirse; auth usa JWT_SECRET).
require('./config/env').validateEnv();
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
const auditorRouter = require('./routes/auditor');
const purchaseOrdersRouter = require('./routes/purchase_orders');
const purchaseOrderReceiptsRouter = require('./routes/purchase_order_receipts');
const purchaseOrderInvoicesRouter = require('./routes/purchase_order_invoices');
const paymentsRouter = require('./routes/payments');
const sucursalesRouter = require('./routes/sucursales');
const adminRouter = require('./routes/admin');
const assetsRouter = require('./routes/assets');
const suppliersRouter = require('./routes/suppliers');
const app=express();
const BUILD_VERSION = String(
  process.env.RENDER_GIT_COMMIT ||
  process.env.COMMIT_SHA ||
  process.env.SOURCE_VERSION ||
  Date.now()
).slice(0, 12);

// Bundle del frontend: se reconstruye al arrancar (Node puro, milisegundos) a
// partir de los scripts actuales, así nunca queda desactualizado y no depende
// de cómo Render haga el deploy. Si falla, FRONTEND_BUNDLE queda null y el
// catch-all sirve los <script> individuales (comportamiento previo intacto).
let FRONTEND_BUNDLE = null;
let FRONTEND_MODULE_BUNDLE = null;
try {
  const fb = require('./scripts/build-frontend').buildFrontend();
  FRONTEND_BUNDLE = fb.bundle;
  FRONTEND_MODULE_BUNDLE = fb.moduleBundle;
  console.log('[frontend] bundle activo:', FRONTEND_BUNDLE, '· modules:', FRONTEND_MODULE_BUNDLE || '(nativo)');
} catch (e) {
  console.warn('[frontend] build falló, sirviendo scripts individuales:', e.message);
}
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // 'unsafe-eval' eliminado: el frontend no usa eval/new Function (verificado) y
      // Chart.js/jsPDF de CDN tampoco lo necesitan. 'unsafe-inline' queda porque la
      // app usa handlers onclick= inline en todo el HTML generado.
      scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "cdnjs.cloudflare.com", "rusegur.monitoreodeflotas.com.ar"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
// CORS: si hay FRONTEND_URL configurado, se restringe a esos orígenes (recomendado en
// producción). Si NO está configurado, se mantiene el comportamiento previo (refleja origen)
// para no romper entornos sin la variable. Las requests del mismo origen (sin header Origin)
// siempre se permiten.
const ALLOWED_ORIGINS = String(process.env.FRONTEND_URL || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (o, cb) => {
    if (!o) return cb(null, true);                       // mismo origen / curl / apps móviles
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true); // sin whitelist: comportamiento previo
    return cb(null, ALLOWED_ORIGINS.includes(o));        // con whitelist: solo orígenes permitidos
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '6mb' }));  // tickets/facturas en base64 pueden superar 2mb
app.use(hpp());
app.use(sanitize);
app.use(compression());
if(process.env.NODE_ENV!=='production')app.use(morgan('dev'));
app.set('trust proxy',1);
app.use('/api/',apiLimiter);
// Auditoría global: registra toda mutación exitosa (POST/PUT/PATCH/DELETE) en audit_log.
const {auditMutations}=require('./middleware/audit');
app.use('/api/',auditMutations);
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
app.use('/api/auditor',auditorRouter);
// /api/purchase-orders se compone de varios routers montados en orden:
// recepciones → pagos → facturas → órdenes. El orden importa (Express prueba
// cada router en secuencia), por eso se respeta tal cual estaba.
app.use('/api/purchase-orders',purchaseOrderReceiptsRouter);
app.use('/api/payments',paymentsRouter);
app.use('/api/purchase-orders',paymentsRouter);
app.use('/api/purchase-orders',purchaseOrderInvoicesRouter);
app.use('/api/purchase-orders',purchaseOrdersRouter);
app.use('/api/sucursales',sucursalesRouter);
app.use('/api/admin',adminRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/suppliers', suppliersRouter);

// ── Endpoints GPS ──
// Importar middleware de autenticación
const { authenticate, requireRole } = require('./middleware/auth');

app.get('/api/gps/status', authenticate, async (req, res) => {
  res.json(getGPSStatus());
});

// Debug: forzar sync y esperar resultado (SOLO dueño/gerencia)
app.post('/api/gps/force-sync', authenticate, requireRole('dueno','gerencia'), async (req, res) => {
  const { syncGPSData, getGPSStatus } = require('./services/gps-powerfleet');
  syncGPSData();
  // Esperar 20s y devolver el resultado
  await new Promise(r => setTimeout(r, 20000));
  res.json(getGPSStatus());
});

app.post('/api/gps/sync', authenticate, requireRole('dueno','gerencia','jefe_mantenimiento'), async (req, res) => {
  syncGPSData();
  res.json({ ok: true, message: 'Sync iniciado' });
});

app.get('/api/health', async (req, res) => {
  try {
    const { pool } = require('./db/pool');
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    // Log interno completo, cliente solo recibe info básica
    console.error('[health]', e.message);
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});
// Devuelve la versión (commit) que el server está sirviendo AHORA. Sirve para
// diagnosticar deploys de un vistazo: si Render quedó pegado en un commit viejo,
// acá se ve. Coincide con el ?v= que se inyecta en los <script>/<link>.
// 'source' indica de dónde salió la versión; si dice 'fallback-timestamp' es que
// Render no expuso RENDER_GIT_COMMIT y el cache-busting depende del reinicio.
app.get('/api/version', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    version: BUILD_VERSION,
    source: process.env.RENDER_GIT_COMMIT ? 'RENDER_GIT_COMMIT'
      : process.env.COMMIT_SHA ? 'COMMIT_SHA'
      : process.env.SOURCE_VERSION ? 'SOURCE_VERSION'
      : 'fallback-timestamp'
  });
});
// Cache de assets JS/CSS según el cache-busting por versión:
//  - Con ?v=<versión> (lo que inyecta el catch-all de abajo en cada <script>/<link>):
//    es seguro cachear el archivo "para siempre". Al hacer deploy cambia BUILD_VERSION →
//    cambia la URL → el browser baja la versión nueva. Recargas más rápidas sin servir
//    código viejo.
//  - Sin ?v= (acceso directo, caso borde): se fuerza no-cache.
// IMPORTANTE: index:false para que express.static NO sirva el index.html directamente.
// Así la raíz "/" cae en el catch-all de abajo, que reescribe los ?v= con BUILD_VERSION
// (dinámico por deploy). Sin esto, se servía el index.html con un ?v= fijo escrito a mano
// y, combinado con el cache immutable, el navegador quedaba pegado a la versión vieja.
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    // MIME explícito para el manifest PWA (algunas versiones de Express no lo conocen).
    if (/\.webmanifest$/.test(filePath)) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
    if (/\.(js|css)$/.test(filePath)) {
      if (res.req && res.req.query && res.req.query.v) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }
}));
app.get(/^(?!\/api).*/, (req, res) => {
  const fs = require('fs');
  const filePath = require('path').join(__dirname, 'public', 'index.html');
  let html = fs.readFileSync(filePath, 'utf8');
  // Si hay bundle, reemplazar el bloque de <script src="js/..."> por UNO solo.
  // Reemplaza el primero por el bundle y elimina el resto. Si algo no matchea,
  // quedan los individuales (fallback natural).
  if (FRONTEND_BUNDLE) {
    let replaced = false;
    html = html.replace(/<script\s+src=["']js\/[^"']+["']>\s*<\/script>\s*/g, () => {
      if (replaced) return '';
      replaced = true;
      return `<script src="${FRONTEND_BUNDLE}"></script>\n`;
    });
  }
  // Si los ES modules se bundlearon, reemplazar el <script type="module"> nativo
  // por el bundle IIFE (clásico). Si no, queda el nativo (el navegador lo carga).
  if (FRONTEND_MODULE_BUNDLE) {
    html = html.replace(/<script\s+type=["']module["']\s+src=["']js\/modules\/[^"']+["']>\s*<\/script>/,
      `<script src="${FRONTEND_MODULE_BUNDLE}"></script>`);
  }
  html = html.replace(/(src|href)=(['"])([^'"]+\.(?:js|css))(?:\?v=[^'"]*)?\2/g, (m, attr, quote, asset) => {
    if (/^https?:/i.test(asset)) return m;
    return `${attr}=${quote}${asset}?v=${BUILD_VERSION}${quote}`;
  });
  
  // Forzar que el browser nunca use cache del HTML
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  
  res.send(html);
});

app.use((err,req,res,next)=>{
  // Log interno completo (queda en los logs del server), pero al cliente NO le
  // exponemos detalles internos: errores 5xx (incluidos los de PostgreSQL) se
  // devuelven con mensaje genérico. Los 4xx conservan su texto porque son
  // validaciones pensadas para el usuario.
  console.error('ERR:',err.message);
  const status = err.status || 500;
  res.status(status).json({ error: status >= 500 ? 'Error del servidor' : err.message });
});

const PORT=process.env.PORT||3000;
httpServer = app.listen(PORT, () => {
  console.log('FleetOS OK port', PORT);
  // Iniciar sync GPS con Powerfleet cada 5 minutos
  startGPSSync(5);

  // P7 — limpieza global periódica de refresh tokens vencidos. El refresh por
  // usuario solo borra los suyos; los de dispositivos abandonados quedaban
  // acumulándose. Corre al arranque y cada 6 horas. Aditivo y seguro: los
  // tokens vencidos ya no validan, solo se purga la tabla.
  const { query } = require('./db/pool');
  const purgeExpiredTokens = () => {
    query('DELETE FROM refresh_tokens WHERE expires_at < NOW()')
      .then((r) => { if (r.rowCount) console.log(`[tokens] purgados ${r.rowCount} refresh tokens vencidos`); })
      .catch((e) => console.error('[tokens] purga falló:', e.message));
  };
  purgeExpiredTokens();
  setInterval(purgeExpiredTokens, 6 * 60 * 60 * 1000);

  // Reporte gerencial mensual automático: si el del mes anterior todavía no
  // salió (arranque de mes o server dormido el día 1), se genera y envía por
  // email una sola vez. Usa el mismo SMTP de los backups.
  try { require('./services/reporte-mensual').programarReporteMensual(); }
  catch (e) { console.error('[reporte-mensual] no se pudo programar:', e.message); }
});
