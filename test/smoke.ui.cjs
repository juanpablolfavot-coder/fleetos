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
const { execSync } = require('node:child_process');

// Playwright es una herramienta de DEV/CI, NO una dependencia del proyecto (no
// se agrega a package.json para no disparar la descarga de navegadores en el
// deploy de Render). Se resuelve desde node_modules local o desde el global; si
// no está, se explica cómo instalarlo en vez de tirar un stack trace.
function loadPlaywright() {
  try { return require('playwright'); } catch (_) { /* probar global */ }
  try {
    const gRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(gRoot, 'playwright'));
  } catch (_) { /* no está */ }
  console.error([
    '',
    '✗ No se encontró Playwright. Este smoke test es una herramienta de DEV/CI:',
    '  NO se corre en el server de Render (producción), sino en tu máquina o en CI.',
    '',
    '  Para correrlo:',
    '    npm i -g playwright        # o:  npm i -D playwright',
    '    npx playwright install chromium',
    '    npm run test:ui',
    '',
  ].join('\n'));
  process.exit(2);
}
const { chromium } = loadPlaywright();

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

// Sirve index.html; si hay bundle (public/dist/manifest.json), reemplaza el
// bloque de <script src="js/..."> por el bundle único — espeja lo que hace
// server.js, para que el smoke valide TAMBIÉN la ruta de producción bundleada.
// Sin bundle, sirve los scripts individuales (estado por defecto).
function readIndexHtml() {
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const manifestPath = path.join(PUBLIC_DIR, 'dist', 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const { bundle, moduleBundle } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (bundle && fs.existsSync(path.join(PUBLIC_DIR, bundle))) {
        let replaced = false;
        html = html.replace(/<script\s+src=["']js\/[^"']+["']>\s*<\/script>\s*/g, () => {
          if (replaced) return '';
          replaced = true;
          return `<script src="${bundle}"></script>\n`;
        });
      }
      if (moduleBundle && fs.existsSync(path.join(PUBLIC_DIR, moduleBundle))) {
        html = html.replace(/<script\s+type=["']module["']\s+src=["']js\/modules\/[^"']+["']>\s*<\/script>/,
          `<script src="${moduleBundle}"></script>`);
      }
    } catch (_) { /* sin bundle: scripts individuales */ }
  }
  return html;
}

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
        res.end(readIndexHtml());
        return;
      }
      if (rel === '/index.html') {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(readIndexHtml());
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
  flotaAhora: {
    actualizado: '2026-01-01T10:00:00.000Z',
    resumen: { total: 2, en_ruta: 1, en_ralenti: 1, detenidas: 0, sin_reportar: 0, arrastrados: 1, total_con_gps: 3 },
    unidades: [
      { code: 'INT-1', plate: 'AA111BB', base: 'Central', direccion: 'Ruta 9 km 232', lat: -34.4, lng: -58.7,
        velocidad: 84, situacion: 'ruta', arrastrado: false, estado_gps: 'driving', minutos_sin_reportar: 1, ralenti_minutos: null },
      { code: 'INT-2', plate: 'AA222BB', base: 'Norte', direccion: 'Base Norte', lat: null, lng: null,
        velocidad: 0, situacion: 'ralenti', arrastrado: false, estado_gps: 'parking', minutos_sin_reportar: 2, ralenti_minutos: 22 },
    ],
    arrastrados: [
      { code: 'SEMI-1', plate: 'BB111BB', base: 'Central', direccion: 'Ruta 9 km 232', lat: null, lng: null,
        velocidad: 84, situacion: 'ruta', arrastrado: true, estado_gps: 'driving', minutos_sin_reportar: 1, ralenti_minutos: null },
    ],
  },
  flotaEventos: {
    horas: 24, desde: '2026-01-01T10:00:00.000Z',
    resumen: { excesos: 1, velocidad_max: 97, ralenti_eventos: 1, ralenti_minutos: 22, ralenti_litros: 1.03 },
    eventos: [
      { tipo: 'exceso', id: 'exc-1', code: 'INT-1', base: 'Central', cuando: '2026-01-01T12:00:00.000Z',
        duracion_min: 3, en_curso: false, velocidad_max: 97, limite: 80 },
      { tipo: 'ralenti', id: 'ral-1', code: 'INT-2', base: 'Norte', lugar: 'Base Norte', cuando: '2026-01-01T11:00:00.000Z',
        duracion_min: 22, en_curso: true, litros: 1.03 },
    ],
  },
  // El último resumen que salió por notificación, con el id de cada anomalía:
  // es lo que permite tocar una línea y caer en ESE evento.
  flotaResumen: {
    cuando: '2026-01-01T12:06:00.000Z', hora: '12:06', desde: '2026-01-01T10:06:00.000Z',
    minutos_atras: 12, litros: 2.8,
    estado: { en_ruta: 11, detenidas: 30, sin_reportar: 0, en_ralenti: 1 },
    excesos:  [{ id: 'exc-1', code: 'INT-1', base: 'Central', cuando: '2026-01-01T12:00:00.000Z', kmh: 97, limite: 80 }],
    ralentis: [{ id: 'ral-1', code: 'INT-2', base: 'Norte', lugar: 'Base Norte', cuando: '2026-01-01T11:00:00.000Z', minutos: 22 }],
  },
};

// Algunas pantallas tienen pestañas: renderizar solo la primera deja sin cubrir
// el HTML —y los onclick— de las demás. Acá se listan las llamadas extra a
// hacer después del render inicial de cada pantalla.
const TABS_EXTRA = {
  flota: ["mostrarTabFlota('feed')", "mostrarTabFlota('preguntar')",
          // Tocar una línea del resumen tiene que llevar al feed sin romper nada.
          "irAEventoFlota('exc-1')"],
  // Re-render inmediato (sin esperar entre medio): es lo que hace afterSave()
  // cuando se guarda algo estando parado en la pantalla. Tiene que ser SEGUIDO
  // en el mismo paso — con la pausa de 350 ms de por medio el timer del chart
  // ya se disparó y la carrera no se reproduce. Detectó "Canvas is already in
  // use" en el chart de combustible.
  fuel: ["renderPage('fuel'); renderPage('fuel')"],
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
  // Control en vivo: sin estos stubs el default [] hacía que la pantalla
  // mostrara "respuesta inesperada", o sea que el smoke probaba la rama de
  // error y no la pantalla de verdad.
  if (u.includes('/api/flota/ahora'))   return FIX.flotaAhora;
  if (u.includes('/api/flota/eventos')) return FIX.flotaEventos;
  if (u.includes('/api/flota/resumen')) return FIX.flotaResumen;
  return []; // por defecto: lista vacía (la mayoría de endpoints devuelven arrays)
}

// Páginas del dispatcher renderPage (app.js). proveedor_panel/tesoreria_panel
// los renderizan otros archivos; se incluyen igual.
const PAGES = [
  'home',
  'dashboard', 'fleet', 'flota', 'workorders', 'fuel', 'tires', 'stock', 'documents',
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

  let browser;
  try {
    // SMOKE_CHROME_PATH permite usar un Chrome que ya esté en la máquina en vez
    // del que baja Playwright. Es la salida cuando su CDN no responde: el 3/8/26
    // cdn.playwright.dev devolvió 403 "this service is not available in your
    // location" al runner de CI y dejó el build en rojo por una razón ajena al
    // código. Un CI que se pone rojo por un CDN de terceros enseña a ignorarlo.
    const chromeExterno = (process.env.SMOKE_CHROME_PATH || '').trim();
    if (chromeExterno) console.log(`  (usando el Chrome de la máquina: ${chromeExterno})`);
    browser = await chromium.launch({
      headless: true,
      ...(chromeExterno ? { executablePath: chromeExterno } : {}),
    });
  } catch (e) {
    server.close();
    console.error('\n✗ No se pudo lanzar Chromium. Instalá el navegador:\n    npx playwright install chromium\n  (' + e.message + ')\n');
    process.exit(2);
  }
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
    // El stub emula UNA regla real de Chart.js: no se puede crear un chart
    // sobre un canvas que ya tiene uno vivo. Sin esto el stub se traga el bug
    // y la pantalla da verde acá pero rompe en un navegador con la librería de
    // verdad (que es lo que pasó con el chart de combustible en CI, donde
    // cdnjs SÍ responde y la lib real pisa este stub).
    const enUso = new WeakMap();
    function Chart(ctx) {
      if (ctx && enUso.has(ctx)) {
        throw new Error("Canvas is already in use. Chart with ID '0' must be destroyed before the canvas with ID '" + (ctx.id || '') + "' can be reused.");
      }
      const inst = {
        destroy() { if (ctx) enUso.delete(ctx); },
        update: noop, resize: noop, render: noop, data: {}, options: {},
      };
      if (ctx) enUso.set(ctx, inst);
      return inst;
    }
    Chart.getChart = (c) => (c && enUso.get(c)) || undefined;
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
    // El primer paso es el render de la pantalla; los siguientes, sus pestañas.
    // Van por el mismo camino de chequeo, solo cambia el HTML que queda dibujado.
    const pasos = [
      { etiqueta: p, code: `window.renderPage(${JSON.stringify(p)})` },
      ...(TABS_EXTRA[p] || []).map((c) => ({ etiqueta: `${p} → ${c}`, code: c })),
    ];
    for (const paso of pasos) {
    current = paso.etiqueta;
    const before = errors.length;
    const thrown = await page.evaluate((code) => {
      try { (0, eval)(code); return null; } catch (e) { return e && e.message ? e.message : String(e); }
    }, paso.code);
    // 350 ms y no 200: varias pantallas dibujan después de un fetch, y con 200
    // el chequeo de onclick corría contra el "Cargando…" en vez del contenido.
    await page.waitForTimeout(350);
    const asyncErrs = errors.slice(before).filter((e) => e.kind === 'pageerror' && !IGNORE.test(e.msg));
    // Chequeo de onclick: cada handler del DOM renderizado llama funciones por
    // nombre (onclick="foo()"). Si una NO resuelve a algo definido en el scope
    // global, romperá al hacer clic. Esto cubre el punto ciego del render-only
    // y es CLAVE para la migración a ES modules (donde lo global desaparece).
    const missingOnclick = thrown ? [] : await page.evaluate(() => {
      const BUILTINS = new Set(['if', 'for', 'while', 'switch', 'return', 'function', 'typeof', 'new', 'delete', 'void', 'in', 'instanceof', 'do', 'else', 'try', 'catch', 'throw', 'var', 'let', 'const', 'this', 'true', 'false', 'null',
        'alert', 'confirm', 'prompt', 'parseInt', 'parseFloat', 'isNaN', 'Number', 'String', 'Array', 'Object', 'Math', 'Date', 'JSON', 'Boolean', 'RegExp', 'Map', 'Set', 'Promise', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'encodeURIComponent', 'decodeURIComponent', 'fetch', 'window', 'document', 'console', 'event']);
      const names = new Set();
      document.querySelectorAll('[onclick]').forEach((el) => {
        const code = el.getAttribute('onclick') || '';
        // Identificadores invocados como función "pelada" (no precedidos por punto).
        const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
        let m;
        while ((m = re.exec(code)) !== null) { if (!BUILTINS.has(m[2])) names.add(m[2]); }
      });
      const missing = [];
      for (const n of names) {
        let ok = false;
        try { ok = typeof (0, eval)(n) !== 'undefined'; } catch (e) { ok = false; }
        if (!ok) missing.push(n);
      }
      return missing;
    });
    results.push({ page: paso.etiqueta, thrown, asyncErrs, missingOnclick });
    }
  }

  // ── Aterrizaje desde una notificación push ──
  // El service worker abre la app con ?ir=<sección>. Si esto se rompe, tocar la
  // alerta vuelve a dejar al dueño en Inicio buscando a mano de qué le avisaron
  // —que es exactamente el problema que el parámetro vino a resolver—, y sin
  // este chequeo la regresión sería invisible.
  current = 'deep-link';
  const antesDeepLink = errors.length;
  await page.goto(base + '/?ir=flota&tab=feed', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(
    () => typeof App !== 'undefined' && App.currentUser && typeof renderPage === 'function',
    { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);   // boot + loadInitialData + render de la sección
  const deepLink = await page.evaluate(() => ({
    pagina: typeof App !== 'undefined' ? App.currentPage : null,
    limpio: location.search === '',
    // La pestaña del feed se reconoce por su selector de período.
    enFeed: /Últimas 8 h/.test(document.getElementById('page-flota')?.innerHTML || ''),
  }));
  const deepLinkErrs = errors.slice(antesDeepLink).filter((e) => e.kind === 'pageerror' && !IGNORE.test(e.msg));
  results.push({
    page: 'deep-link ?ir=flota&tab=feed',
    thrown: deepLink.pagina === 'flota' ? null : `aterrizó en "${deepLink.pagina}" en vez de "flota"`,
    asyncErrs: deepLinkErrs,
    missingOnclick: [
      ...(deepLink.enFeed ? [] : ['(no abrió la pestaña del feed)']),
      ...(deepLink.limpio ? [] : ['(no se limpió la query de la URL)']),
    ],
  });

  // ── Aterrizaje en UN evento puntual ──
  // La alerta de velocidad lleva ?evento=<id>. Sin esto se cae en la lista
  // entera y hay que adivinar cuál de todos los excesos fue el que avisó, que
  // es justo lo que este parámetro vino a evitar.
  current = 'deep-link-evento';
  const antesEvento = errors.length;
  await page.goto(base + '/?ir=flota&tab=feed&evento=exc-1', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(
    () => typeof App !== 'undefined' && App.currentUser && typeof renderPage === 'function',
    { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const evt = await page.evaluate(() => {
    const html = document.getElementById('page-flota')?.innerHTML || '';
    return {
      pagina: typeof App !== 'undefined' ? App.currentPage : null,
      marcado: /EL DEL AVISO/.test(html),
      // El resaltado tiene que caer en la fila del evento pedido, no en otra.
      enLaFila: /id="ev-exc-1"[^>]*>[\s\S]{0,900}?EL DEL AVISO/.test(html),
    };
  });
  const eventoErrs = errors.slice(antesEvento).filter((e) => e.kind === 'pageerror' && !IGNORE.test(e.msg));
  results.push({
    page: 'deep-link ?evento=<id>',
    thrown: evt.pagina === 'flota' ? null : `aterrizó en "${evt.pagina}" en vez de "flota"`,
    asyncErrs: eventoErrs,
    missingOnclick: [
      ...(evt.marcado  ? [] : ['(no resaltó el evento del aviso)']),
      ...(evt.enLaFila ? [] : ['(resaltó una fila que no es la del evento pedido)']),
    ],
  });

  await browser.close();
  server.close();

  // ── Reporte ──
  let failed = 0;
  console.log('\n  Smoke UI — renderPage por pantalla\n  ' + '─'.repeat(48));
  for (const r of results) {
    const bad = r.thrown || r.asyncErrs.length || (r.missingOnclick && r.missingOnclick.length);
    if (bad) failed++;
    const mark = bad ? '✗' : '✓';
    console.log(`  ${mark} ${r.page}`);
    if (r.thrown) console.log(`      throw: ${r.thrown}`);
    for (const e of r.asyncErrs) console.log(`      ${e.kind}: ${e.msg}`);
    if (r.missingOnclick && r.missingOnclick.length) console.log(`      onclick sin definir: ${r.missingOnclick.join(', ')}`);
  }
  const otherErrs = errors.filter((e) => e.page === 'boot' && e.kind === 'pageerror' && !IGNORE.test(e.msg));
  for (const e of otherErrs) { failed++; console.log(`  ✗ boot\n      ${e.kind}: ${e.msg}`); }

  console.log('  ' + '─'.repeat(48));
  console.log(`  ${results.length - failed}/${results.length} pantallas OK\n`);

  if (failed) { console.error(`SMOKE UI FALLÓ: ${failed} pantalla(s) con error.`); process.exit(1); }
  console.log('SMOKE UI OK');
  process.exit(0);
})().catch((e) => { console.error('SMOKE UI ERROR FATAL:', e); process.exit(1); });
