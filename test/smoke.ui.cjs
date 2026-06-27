// ════════════════════════════════════════════════════════════════════
//  SMOKE TEST DE UI (Playwright headless) — red de seguridad del frontend.
//
//  Qué hace: levanta un server estático para public/, intercepta TODO
//  /api/** con stubs (incluido /api/auth/refresh, que devuelve un usuario
//  falso → la app bootea sin backend ni Postgres), espera a que cargue, y
//  llama renderPage() de CADA pantalla del dispatcher capturando:
//    - excepciones SÍNCRONAS de renderPage (fallo duro)
//    - errores NO CAPTURADOS (pageerror) durante el render (fallo duro)
//
//  Para qué sirve: detectar regresiones de la modularización de app.js
//  (ej. una función que quedó indefinida o referencia algo movido). NO es
//  un test funcional: no valida lógica de negocio, solo que cada pantalla
//  renderice sin romperse.
//
//  Correr:  npm run test:ui
//  (usa el Chromium preinstalado vía PLAYWRIGHT_BROWSERS_PATH; Playwright
//   se resuelve del global con NODE_PATH=$(npm root -g), ver package.json)
// ════════════════════════════════════════════════════════════════════
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

// ── Server estático mínimo (sin DB, sin server.js) ──
function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/' || rel === '') rel = '/index.html';
      const filePath = path.join(PUBLIC_DIR, rel);
      // Evitar path traversal y servir index.html como fallback de SPA.
      if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')));
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(fs.readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ── Fixtures: shapes "crudos" tal como los espera roles.js (mappers usan
//    defaults, así que con lo mínimo alcanza para que rendericen filas). ──
const USER = { id: 'u1', name: 'Test Dueno', email: 'test@fleetos.local', role: 'dueno', vehicle_code: null, sucursal: null, area: null };
const FIX = {
  vehicles: [{ id: 'v1', code: 'INT-1', plate: 'AA111BB', brand: 'Scania', model: 'R450', year: 2020, type: 'tractor', status: 'ok', km_current: 1000, base: 'Central', tech_spec: {} }],
  workorders: [{ id: 'wo1', code: 'OT-1', vehicle_code: 'INT-1', type: 'Correctivo', status: 'Abierta', priority: 'Normal', description: 'test', opened_at: '2026-01-01T10:00:00', parts_cost: 0, labor_cost: 0 }],
  fuel: [{ id: 'f1', vehicle_code: 'INT-1', liters: 100, price_per_l: 1000, odometer_km: 1000, logged_at: '2026-01-01T10:00:00', location: 'Cisterna' }],
  stock: [{ id: 's1', code: 'FIL-1', name: 'Filtro de aceite', category: 'Filtros', unit: 'un', qty_current: 10, qty_min: 2, qty_reorder: 4, unit_cost: 500, base_location: 'Central', area: 'Depósito' }],
  documents: [{ id: 'd1', entity_type: 'vehicle', vehicle_code: 'INT-1', doc_type: 'VTV', expiry_date: '2026-12-31', reference: 'ABC' }],
  tanks: [{ id: 't1', location: 'Cisterna', type: 'gasoil', capacity: 10000, current_l: 5000 }],
  users: [{ id: 'u1', name: 'Juan Perez', email: 'juan@x.com', role: 'mecanico', status: 'active' }],
  tires: [{ id: 'ti1', serial_no: 'SER1', brand: 'Michelin', model: 'X Multi', size: '295/80R22.5', status: 'stock', tread_depth: 8, km_total: 0, purchase_price: 100000 }],
  suppliers: [{ id: 'sup1', name: 'Proveedor X', cuit: '20-12345678-9', email: 'prov@x.com', phone: '123', status: 'activo' }],
  assets: [{ id: 'a1', code: 'ACT-1', name: 'Compresor', type: 'equipo', status: 'activo', purchase_value: 50000 }],
  purchaseOrders: [{ id: 'po1', code: 'OC-1', supplier_name: 'Proveedor X', status: 'borrador', total: 1000, items: [], created_at: '2026-01-01T10:00:00' }],
  catalog: [{ id: 'c1', code: 'FIL-1', name: 'Filtro de aceite', category: 'Filtros', unit: 'un', total: 10, qty_min: 2, unit_cost: 500, balances: [{ base_location: 'Central', area: 'Depósito', qty_current: 10 }] }],
  config: { bases: ['Central', 'Norte'], vehicle_types: ['tractor', 'camion'], areas: { Central: ['Depósito', 'Taller'] }, labor_rate: 5000, stock_categories: ['Filtros'] },
};

// Decide el cuerpo de respuesta según el path del endpoint.
function stubFor(url) {
  const u = url.split('?')[0];
  if (u.endsWith('/auth/refresh') || u.endsWith('/auth/login')) return { accessToken: 'fake.jwt.token', user: USER };
  if (u.includes('/auth/')) return {};
  if (u.endsWith('/config')) return FIX.config;
  if (u.endsWith('/api/vehicles')) return FIX.vehicles;
  if (u.endsWith('/api/workorders')) return FIX.workorders;
  if (u.endsWith('/api/fuel')) return FIX.fuel;
  if (u.endsWith('/api/stock')) return FIX.stock;
  if (u.includes('/stock/catalog')) return u.includes('/movements') ? [] : FIX.catalog;
  if (u.includes('/stock/dispatches')) return [];
  if (u.endsWith('/api/documents')) return FIX.documents;
  if (u.endsWith('/fuel/tanks')) return FIX.tanks;
  if (u.endsWith('/api/users')) return FIX.users;
  if (u.endsWith('/api/tires')) return FIX.tires;
  if (u.endsWith('/api/suppliers')) return FIX.suppliers;
  if (u.endsWith('/api/assets')) return FIX.assets;
  if (u.includes('/purchase-orders')) return FIX.purchaseOrders;
  // Endpoints del auditor: objeto "kitchen-sink" para que los || [] no rompan.
  if (u.includes('/auditor/')) return { kpis: {}, meses: [], vehiculos: [], anomalias: [], ots: [], items: [], data: [], rows: [], logs: [] };
  return []; // por defecto: lista vacía (la mayoría de endpoints devuelven arrays)
}

// Páginas del dispatcher renderPage (app.js). proveedor_panel/tesoreria_panel
// los renderizan otros archivos; se incluyen igual.
const PAGES = [
  'dashboard', 'fleet', 'workorders', 'fuel', 'tires', 'stock', 'documents',
  'costs', 'maintenance', 'chofer_panel', 'encargado_panel', 'contador_panel',
  'auditor_panel', 'users', 'config', 'purchase_orders', 'suppliers', 'assets',
  'proveedor_panel', 'tesoreria_panel',
];

// Ruido esperado que NO indica regresión (CDN bloqueada en sandbox, etc.).
const IGNORE = /cdnjs|Failed to load resource|net::ERR|favicon|chart\.js|jspdf|autotable|the server responded with a status/i;

(async () => {
  const server = await startStaticServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let current = 'boot';
  const errors = [];
  page.on('pageerror', (e) => errors.push({ page: current, kind: 'pageerror', msg: e.message }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push({ page: current, kind: 'console', msg: m.text() }); });

  // Stubs de libs que vienen de CDN (Chart.js, jsPDF). En el sandbox no hay
  // salida a cdnjs, así que sin esto las pantallas con gráficos tiran
  // "Chart is not defined" (ruido de entorno, no regresión). Con el stub, su
  // código de render se ejecuta igual y SÍ detectaríamos un bug real ahí.
  await page.addInitScript(() => {
    const noop = function () {};
    function Chart() { return { destroy: noop, update: noop, resize: noop, render: noop, data: {}, options: {} }; }
    Chart.register = noop; Chart.defaults = { plugins: {}, font: {} }; Chart.Tooltip = {};
    window.Chart = Chart;
    function JsPDF() { return { text: noop, save: noop, addPage: noop, setFontSize: noop, setTextColor: noop, autoTable: noop, addImage: noop, setFillColor: noop, rect: noop, line: noop, splitTextToSize: () => [''], internal: { pageSize: { getWidth: () => 595, getHeight: () => 842 } } }; }
    window.jspdf = { jsPDF: JsPDF };
  });

  await page.route('**/api/**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stubFor(route.request().url())) });
  });

  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  // Esperar a que la app bootee (usuario seteado + dispatcher disponible).
  // OJO: `const App` en script clásico NO queda en window; se chequea pelado.
  try {
    await page.waitForFunction(
      () => typeof App !== 'undefined' && App.currentUser && typeof renderPage === 'function',
      { timeout: 20000 }
    );
  } catch (e) {
    const diag = await page.evaluate(() => ({
      hasApp: typeof App !== 'undefined',
      user: (typeof App !== 'undefined' && App.currentUser) ? App.currentUser.role : null,
      hasRenderPage: typeof renderPage === 'function',
      loginVisible: document.getElementById('login-screen')?.style.display !== 'none',
    })).catch((err) => ({ evalError: String(err) }));
    console.error('No booteó. Diagnóstico:', JSON.stringify(diag));
    console.error('Errores capturados:', JSON.stringify(errors.slice(0, 10), null, 2));
    throw e;
  }
  await page.waitForTimeout(600); // dejar que loadInitialData asiente

  const results = [];
  for (const p of PAGES) {
    current = p;
    const before = errors.length;
    const thrown = await page.evaluate((pg) => {
      try { window.renderPage(pg); return null; } catch (e) { return e && e.message ? e.message : String(e); }
    }, p);
    await page.waitForTimeout(200);
    const asyncErrs = errors.slice(before).filter((e) => e.kind === 'pageerror' && !IGNORE.test(e.msg));
    results.push({ page: p, thrown, asyncErrs });
  }

  await browser.close();
  server.close();

  // ── Reporte ──
  let failed = 0;
  console.log('\n  Smoke UI — renderPage por pantalla\n  ' + '─'.repeat(48));
  for (const r of results) {
    const bad = r.thrown || r.asyncErrs.length;
    if (bad) failed++;
    const mark = bad ? '✗' : '✓';
    console.log(`  ${mark} ${r.page}`);
    if (r.thrown) console.log(`      throw: ${r.thrown}`);
    for (const e of r.asyncErrs) console.log(`      ${e.kind}: ${e.msg}`);
  }
  const otherErrs = errors.filter((e) => e.page === 'boot' && e.kind === 'pageerror' && !IGNORE.test(e.msg));
  for (const e of otherErrs) { failed++; console.log(`  ✗ boot\n      ${e.kind}: ${e.msg}`); }

  console.log('  ' + '─'.repeat(48));
  console.log(`  ${results.length - failed}/${results.length} pantallas OK\n`);

  if (failed) { console.error(`SMOKE UI FALLÓ: ${failed} pantalla(s) con error.`); process.exit(1); }
  console.log('SMOKE UI OK');
  process.exit(0);
})().catch((e) => { console.error('SMOKE UI ERROR FATAL:', e); process.exit(1); });
