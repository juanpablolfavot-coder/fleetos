// ════════════════════════════════════════════════════════════════════
//  BUILD FRONTEND — concatena los scripts del frontend en UN solo archivo
//  con hash de contenido (cache-busting). CERO dependencias: Node puro.
//
//  Por qué concatenación (y no un bundler con módulos): el frontend todavía
//  son scripts CLÁSICOS globales (const App, funciones globales, onclick=).
//  Concatenarlos en orden es semánticamente igual a los <script> separados
//  (mismo scope global, misma secuencia), así que NO cambia el comportamiento;
//  solo reduce 13 requests a 1 y mejora el cache (el hash cambia únicamente
//  cuando el JS cambia, a diferencia del ?v= por deploy que invalida todo).
//
//  Fuente de la verdad del ORDEN: los <script src="js/..."> de index.html.
//  Así no hay que mantener la lista en dos lados.
//
//  Salida: public/dist/app.<hash>.js + public/dist/manifest.json
//  (public/dist está gitignored; el server lo reconstruye al arrancar.)
//
//  Uso CLI:  node scripts/build-frontend.js   (o: npm run build)
//  Uso prog: const { buildFrontend } = require('./scripts/build-frontend')
// ════════════════════════════════════════════════════════════════════
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIST_DIR = path.join(PUBLIC_DIR, 'dist');
const INDEX = path.join(PUBLIC_DIR, 'index.html');

// Lee index.html y devuelve los src de los <script src="js/..."> EN ORDEN,
// sin el ?v=. Ese orden es el que respeta la concatenación.
function orderedScriptFiles() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const re = /<script\s+src=["']js\/([^"'?]+)(?:\?[^"']*)?["']>\s*<\/script>/g;
  const files = [];
  let m;
  while ((m = re.exec(html)) !== null) files.push('js/' + m[1]);
  return files;
}

// Lee de index.html el src del <script type="module" src="js/..."> (el entry de
// los ES modules nuevos), sin el ?v=. Devuelve el path relativo o null.
function moduleEntry() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const m = html.match(/<script\s+type=["']module["']\s+src=["'](js\/[^"'?]+)(?:\?[^"']*)?["']>/);
  return m ? m[1] : null;
}

// Bundlea el entry de módulos con esbuild a un IIFE clásico con hash. Devuelve
// { bundle, entry, bytes } o null si no hay entry. Requiere esbuild (lanza si no).
function buildModuleBundle({ quiet = true } = {}) {
  const entry = moduleEntry();
  if (!entry) return null;
  const esbuild = require('esbuild');
  const res = esbuild.buildSync({
    entryPoints: [path.join(PUBLIC_DIR, entry)],
    bundle: true,
    format: 'iife',
    charset: 'utf8',
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false, // coherente con el legacy: nombres intactos
    legalComments: 'none',
    write: false,
  });
  const code = res.outputFiles[0].text;
  const h = crypto.createHash('sha256').update(code).digest('hex').slice(0, 12);
  const name = `modules.${h}.js`;
  for (const f of fs.readdirSync(DIST_DIR)) {
    if (/^modules\.[0-9a-f]+\.js$/.test(f) && f !== name) {
      try { fs.unlinkSync(path.join(DIST_DIR, f)); } catch (_) { /* noop */ }
    }
  }
  fs.writeFileSync(path.join(DIST_DIR, name), code);
  return { bundle: `dist/${name}`, entry, bytes: Buffer.byteLength(code) };
}

// Construye el bundle. Devuelve { bundle, hash, files, bytes, moduleBundle } o lanza.
function buildFrontend({ quiet = true } = {}) {
  const files = orderedScriptFiles();
  if (!files.length) throw new Error('No se encontraron <script src="js/..."> en index.html');

  // Concatenar en orden. El "\n;\n" entre archivos evita sorpresas de ASI en
  // el borde entre uno y otro (cada archivo es completo, así que es inocuo).
  const parts = files.map((rel) => {
    const abs = path.join(PUBLIC_DIR, rel);
    return `// ── ${rel} ──\n` + fs.readFileSync(abs, 'utf8');
  });
  let bundleSrc = parts.join('\n;\n');
  let minified = false;

  // Minificar con esbuild SOLO whitespace + sintaxis, sin renombrar
  // identificadores: así ninguna función/variable global cambia de nombre y
  // los onclick="funcionGlobal()" siguen resolviendo. Si esbuild no está o
  // falla, se usa el concatenado tal cual (fallback, sigue andando).
  try {
    const esbuild = require('esbuild');
    const out = esbuild.transformSync(bundleSrc, {
      minifyWhitespace: true,
      minifySyntax: true,
      minifyIdentifiers: false, // NO renombrar: protege los onclick globales
      legalComments: 'none',
      charset: 'utf8',
    });
    bundleSrc = out.code;
    minified = true;
  } catch (e) {
    if (!quiet) console.warn('[build-frontend] minify omitido (' + e.message + '), uso concatenado');
  }

  const hash = crypto.createHash('sha256').update(bundleSrc).digest('hex').slice(0, 12);
  const bundleName = `app.${hash}.js`;
  const bundleRel = `dist/${bundleName}`;

  // Limpiar bundles viejos para no acumular.
  fs.mkdirSync(DIST_DIR, { recursive: true });
  for (const f of fs.readdirSync(DIST_DIR)) {
    if (/^app\.[0-9a-f]+\.js$/.test(f) && f !== bundleName) {
      try { fs.unlinkSync(path.join(DIST_DIR, f)); } catch (_) { /* noop */ }
    }
  }

  fs.writeFileSync(path.join(DIST_DIR, bundleName), bundleSrc);

  // ── Bundle de los ES modules nuevos (Fase 3) ──
  // Se bundlea con esbuild (resuelve import/export) a un IIFE clásico. Si
  // esbuild no está o falla, moduleBundle queda null y el server deja el
  // <script type="module"> nativo (el navegador lo carga igual).
  let moduleBundle = null;
  try {
    const mod = buildModuleBundle({ quiet });
    if (mod) moduleBundle = mod.bundle;
  } catch (e) {
    if (!quiet) console.warn('[build-frontend] module bundle omitido (' + e.message + '), se usa <script type=module> nativo');
  }

  fs.writeFileSync(path.join(DIST_DIR, 'manifest.json'), JSON.stringify({ bundle: bundleRel, files, hash, minified, moduleBundle }, null, 2));

  const bytes = Buffer.byteLength(bundleSrc);
  if (!quiet) {
    console.log(`[build-frontend] ${files.length} archivos → ${bundleRel} (${(bytes / 1024).toFixed(0)} KB${minified ? ', minificado' : ', sin minificar'})`);
    if (moduleBundle) console.log(`[build-frontend] ES modules → ${moduleBundle}`);
  }
  return { bundle: bundleRel, hash, files, bytes, minified, moduleBundle };
}

module.exports = { buildFrontend, orderedScriptFiles, moduleEntry, buildModuleBundle };

// Ejecutado directo (npm run build): construir y reportar.
if (require.main === module) {
  try {
    buildFrontend({ quiet: false });
  } catch (e) {
    console.error('[build-frontend] ERROR:', e.message);
    process.exit(1);
  }
}
