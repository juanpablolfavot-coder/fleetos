// ══════════════════════════════════════════
//  FleetOS — Servidor principal
//  Node.js + Express + PostgreSQL
// ══════════════════════════════════════════
require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const hpp        = require('hpp');
const compression= require('compression');
const morgan     = require('morgan');
const path       = require('path');
const cookieParser = require('cookie-parser');

const { apiLimiter }  = require('./middleware/security');
const { sanitize }    = require('./middleware/security');

// Rutas
const authRoutes     = require('./routes/auth');
const vehicleRoutes  = require('./routes/vehicles');
const woRoutes       = require('./routes/workorders');
const stockRoutes    = require('./routes/stock');
const { fuelRouter, tireRouter, docRouter, userRouter } = require('./routes/others');

const app = express();

// ── 1. HELMET — 14 headers de seguridad HTTP ──────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com"],
      imgSrc:      ["'self'", "data:"],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
  hsts: {
    maxAge:            31536000,  // 1 año
    includeSubDomains: true,
    preload:           true,
  },
  noSniff:           true,
  xssFilter:         true,
  referrerPolicy:    { policy: 'strict-origin-when-cross-origin' },
}));

// ── 2. CORS — Solo el dominio autorizado ──────────────────
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o.trim()))) {
      callback(null, true);
    } else {
      callback(new Error(`CORS bloqueado: ${origin}`));
    }
  },
  credentials:      true,
  methods:          ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders:   ['Content-Type','Authorization'],
  exposedHeaders:   ['X-RateLimit-Limit','X-RateLimit-Remaining'],
}));

// ── 3. PARSERS Y PROTECCIÓN ────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));   // limitar tamaño de body
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(hpp());                             // prevenir HTTP Parameter Pollution
app.use(sanitize);                          // sanitizar inputs
app.use(compression());                     // comprimir respuestas

// ── 4. LOGGING ────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  // En producción solo loguear errores
  app.use(morgan('combined', {
    skip: (req, res) => res.statusCode < 400,
  }));
} else {
  app.use(morgan('dev'));
}

// ── 5. RATE LIMITING GLOBAL ───────────────────────────────
app.use('/api/', apiLimiter);

// ── 6. TRUST PROXY (Render usa proxy) ────────────────────
app.set('trust proxy', 1);

// ── 7. RUTAS DE LA API ────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/vehicles',  vehicleRoutes);
app.use('/api/workorders',woRoutes);
app.use('/api/stock',     stockRoutes);
app.use('/api/fuel',      fuelRouter);
app.use('/api/tires',     tireRouter);
app.use('/api/documents', docRouter);
app.use('/api/users',     userRouter);

// ── 8. HEALTH CHECK ───────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const { pool } = require('./db/pool');
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', version: '2.0.0', ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ── 9. FRONTEND ESTÁTICO ──────────────────────────────────
// Servir el frontend desde la carpeta /public
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : '0',
  etag:   true,
}));

// SPA fallback — todo lo que no es /api/ devuelve index.html
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── 10. MANEJO DE ERRORES ─────────────────────────────────
// Error CORS
app.use((err, req, res, next) => {
  if (err.message?.includes('CORS')) {
    return res.status(403).json({ error: 'Origen no autorizado' });
  }
  next(err);
});

// Error genérico — NO exponer detalles en producción
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  const msg = process.env.NODE_ENV === 'production'
    ? 'Error interno del servidor'
    : err.message;
  res.status(err.status || 500).json({ error: msg });
});

// 404 para rutas API no encontradas
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

// ── 11. INICIAR SERVIDOR ──────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║  FleetOS v2.0.0 — Servidor iniciado       ║
║  Puerto: ${PORT}                             ║
║  Entorno: ${(process.env.NODE_ENV||'development').padEnd(31)}║
╚══════════════════════════════════════════╝
  `);
});

// Manejar cierre limpio
process.on('SIGTERM', async () => {
  console.log('Cerrando servidor...');
  const { pool } = require('./db/pool');
  await pool.end();
  process.exit(0);
});

module.exports = app;
