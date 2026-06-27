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

// Construye el bundle. Devuelve { bundle, hash, files, bytes } o lanza.
function buildFrontend({ quiet = true } = {}) {
  const files = orderedScriptFiles();
  if (!files.length) throw new Error('No se encontraron <script src="js/..."> en index.html');

  // Concatenar en orden. El "\n;\n" entre archivos evita sorpresas de ASI en
  // el borde entre uno y otro (cada archivo es completo, así que es inocuo).
  const parts = files.map((rel) => {
    const abs = path.join(PUBLIC_DIR, rel);
    return `// ── ${rel} ──\n` + fs.readFileSync(abs, 'utf8');
  });
  const bundleSrc = parts.join('\n;\n');

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
  fs.writeFileSync(path.join(DIST_DIR, 'manifest.json'), JSON.stringify({ bundle: bundleRel, files, hash }, null, 2));

  const bytes = Buffer.byteLength(bundleSrc);
  if (!quiet) {
    console.log(`[build-frontend] ${files.length} archivos → ${bundleRel} (${(bytes / 1024).toFixed(0)} KB)`);
  }
  return { bundle: bundleRel, hash, files, bytes };
}

module.exports = { buildFrontend, orderedScriptFiles };

// Ejecutado directo (npm run build): construir y reportar.
if (require.main === module) {
  try {
    buildFrontend({ quiet: false });
  } catch (e) {
    console.error('[build-frontend] ERROR:', e.message);
    process.exit(1);
  }
}
