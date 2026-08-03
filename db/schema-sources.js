// ════════════════════════════════════════════════════════════════════
//  Qué esquema DECLARA el repositorio (sin tocar ninguna base).
//
//  Hoy el esquema de FleetOS vive en dos lugares:
//    A. db/schema.sql + db/NN-*.sql — el esquema base y sus migraciones
//    B. routes/ services/ middleware/ — cientos de sentencias DDL sueltas
//       que corren en IIFEs al arrancar cada router ("columnas antiguas
//       que pueden faltar")
//
//  El grupo B es el que queremos sacar del arranque, pero es hoy el
//  mecanismo de facto que repara el esquema: si una base de producción
//  quedó atrás, esos ALTER son lo único que la pone al día. Borrarlos a
//  ciegas es lo que rompe.
//
//  Este módulo LEE los dos grupos por separado y devuelve qué declara cada
//  uno. No se conecta a ninguna base ni ejecuta nada. db/schema-check.js lo
//  usa para comparar contra el esquema real.
// ════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DIRS_CODIGO = ['routes', 'services', 'middleware'];

// Palabras que abren una restricción dentro de un CREATE TABLE, no una columna.
const NO_ES_COLUMNA = new Set([
  'primary', 'foreign', 'unique', 'check', 'constraint', 'exclude', 'like', 'inherits',
]);

// ── Limpieza de comentarios ───────────────────────────────────────────
// Hace falta de verdad: routes/suppliers.js:134 tiene el comentario
//   "// Bases viejas: CREATE TABLE IF NOT EXISTS no agrega columnas nuevas."
// que sin esto se lee como una tabla llamada "no". Se recorre el texto con un
// mini-scanner en vez de regex porque hay que respetar comillas y backticks
// (un "//" adentro de una URL no abre un comentario).
function quitarComentariosJS(src) {
  let out = '';
  let i = 0;
  let modo = null; // null | "'" | '"' | '`' | 'linea' | 'bloque'
  while (i < src.length) {
    const c = src[i];
    const sig = src[i + 1];
    if (modo === 'linea') {
      if (c === '\n') { modo = null; out += c; }
      i++; continue;
    }
    if (modo === 'bloque') {
      if (c === '*' && sig === '/') { modo = null; i += 2; continue; }
      if (c === '\n') out += c; // conservar líneas para que los números coincidan
      i++; continue;
    }
    if (modo) { // dentro de un string
      if (c === '\\') { out += c + (sig || ''); i += 2; continue; }
      if (c === modo) modo = null;
      out += c; i++; continue;
    }
    if (c === '/' && sig === '/') { modo = 'linea'; i += 2; continue; }
    if (c === '/' && sig === '*') { modo = 'bloque'; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') { modo = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

// En SQL solo hay que sacar los "--" hasta fin de línea (y respetar comillas).
function quitarComentariosSQL(src) {
  return src.split('\n').map((linea) => {
    let comilla = null;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (comilla) { if (c === comilla) comilla = null; continue; }
      if (c === "'" || c === '"') { comilla = c; continue; }
      if (c === '-' && linea[i + 1] === '-') return linea.slice(0, i);
    }
    return linea;
  }).join('\n');
}

// ── Extracción ────────────────────────────────────────────────────────
// Un ALTER TABLE puede agregar VARIAS columnas separadas por coma:
//   ALTER TABLE purchase_orders
//     ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'pendiente',
//     ADD COLUMN IF NOT EXISTS destino         VARCHAR(200);
// Por eso se ubica primero el "ALTER TABLE <tabla>" y después se buscan TODAS
// las cláusulas ADD COLUMN hasta el ";" que cierra la sentencia. Con una sola
// regex encadenada se perdían todas menos la primera (db/01-compras.sql tenía
// 8 columnas invisibles para el análisis por esta razón).
const RE_ALTER_TABLE = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
const RE_ADD_COLUMN = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
const RE_CREATE_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
const RE_CREATE_INDEX = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;

// Columnas declaradas DENTRO del cuerpo de un CREATE TABLE. Se recorre con
// profundidad de paréntesis para no confundir el "id" de REFERENCES tanks(id)
// ni las comas de NUMERIC(12,2) con separadores de columna.
function columnasDeCreateTable(sql, tabla, desde) {
  const abre = sql.indexOf('(', desde);
  if (abre === -1) return [];
  let prof = 0, fin = -1;
  for (let i = abre; i < sql.length; i++) {
    if (sql[i] === '(') prof++;
    else if (sql[i] === ')') { prof--; if (prof === 0) { fin = i; break; } }
  }
  if (fin === -1) return [];
  const cuerpo = sql.slice(abre + 1, fin);
  const items = [];
  let actual = '', p = 0;
  for (const ch of cuerpo) {
    if (ch === '(') p++;
    else if (ch === ')') p--;
    if (ch === ',' && p === 0) { items.push(actual); actual = ''; continue; }
    actual += ch;
  }
  if (actual.trim()) items.push(actual);
  const cols = [];
  for (const it of items) {
    const m = it.trim().match(/^"?([a-z_][a-z0-9_]*)"?/i);
    if (!m) continue;
    const nombre = m[1].toLowerCase();
    if (NO_ES_COLUMNA.has(nombre)) continue;
    cols.push(`${tabla}.${nombre}`);
  }
  return cols;
}

// Un grupo = lo declarado por un conjunto de archivos. Cada Map guarda
// nombre → primer archivo que lo declara (hay declaraciones repetidas: la
// misma columna se "asegura" desde varios routers).
function grupoVacio() {
  return { tablas: new Map(), columnas: new Map(), indices: new Map() };
}

function ponerSiFalta(mapa, clave, origen) {
  if (!mapa.has(clave)) mapa.set(clave, origen);
}

const RE_SIGUIENTE_SENTENCIA = /\b(ALTER\s+TABLE|CREATE\s+(?:TABLE|INDEX|UNIQUE)|DROP\s+TABLE|INSERT\s+INTO|UPDATE\s+|SELECT\s+)/gi;
function buscarSiguienteSentencia(sql, desde) {
  RE_SIGUIENTE_SENTENCIA.lastIndex = desde;
  const m = RE_SIGUIENTE_SENTENCIA.exec(sql);
  return m ? m.index : -1;
}

function extraerDe(sql, origen, grupo) {
  let m;
  RE_ALTER_TABLE.lastIndex = 0;
  while ((m = RE_ALTER_TABLE.exec(sql))) {
    const tabla = m[1].toLowerCase();
    // La sentencia termina en el ";" — o antes, si aparece otro ALTER/CREATE
    // primero. En el código JS cada DDL vive en su propio template literal y el
    // ";" real queda después del backtick: cortar también en la próxima
    // sentencia evita atribuirle a esta tabla columnas de la siguiente.
    const desde = m.index + m[0].length;
    const candidatos = [sql.indexOf(';', desde), buscarSiguienteSentencia(sql, desde)]
      .filter((i) => i !== -1);
    const corte = candidatos.length ? Math.min(...candidatos) : sql.length;
    const sentencia = sql.slice(m.index, corte);
    let c;
    RE_ADD_COLUMN.lastIndex = 0;
    while ((c = RE_ADD_COLUMN.exec(sentencia))) {
      ponerSiFalta(grupo.columnas, `${tabla}.${c[1].toLowerCase()}`, origen);
    }
  }
  RE_CREATE_TABLE.lastIndex = 0;
  while ((m = RE_CREATE_TABLE.exec(sql))) {
    const tabla = m[1].toLowerCase();
    ponerSiFalta(grupo.tablas, tabla, origen);
    for (const col of columnasDeCreateTable(sql, tabla, m.index)) {
      ponerSiFalta(grupo.columnas, col, origen);
    }
  }
  RE_CREATE_INDEX.lastIndex = 0;
  while ((m = RE_CREATE_INDEX.exec(sql))) {
    ponerSiFalta(grupo.indices, m[1].toLowerCase(), origen);
  }
}

function archivosJS(dir) {
  const full = path.join(RAIZ, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));
}

/**
 * Devuelve el esquema declarado, separado por origen:
 *   sql     — lo que declaran db/schema.sql y db/NN-*.sql
 *   codigo  — lo que declara el DDL de arranque de routes/services/middleware
 *             (el conjunto que queremos poder sacar)
 *   union   — los dos juntos, para detectar objetos en la base que no declara nadie
 * Cada campo tiene Maps tablas/columnas/indices con nombre → archivo de origen.
 */
function leerDeclarado() {
  const sql = grupoVacio();
  const codigo = grupoVacio();

  for (const f of fs.readdirSync(path.join(RAIZ, 'db')).filter((f) => f.endsWith('.sql')).sort()) {
    extraerDe(quitarComentariosSQL(fs.readFileSync(path.join(RAIZ, 'db', f), 'utf8')), `db/${f}`, sql);
  }
  for (const dir of DIRS_CODIGO) {
    for (const rel of archivosJS(dir)) {
      extraerDe(quitarComentariosJS(fs.readFileSync(path.join(RAIZ, rel), 'utf8')), rel, codigo);
    }
  }

  const union = grupoVacio();
  for (const clave of ['tablas', 'columnas', 'indices']) {
    for (const [k, v] of sql[clave]) union[clave].set(k, v);
    for (const [k, v] of codigo[clave]) ponerSiFalta(union[clave], k, v);
  }

  return { sql, codigo, union };
}

module.exports = { leerDeclarado, quitarComentariosJS, quitarComentariosSQL };
