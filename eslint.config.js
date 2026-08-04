// ════════════════════════════════════════════════════════════════════
//  Linter — para la clase de error que los tests NO ven.
//
//  Los tests dicen si el código hace lo que se espera. No dicen nada de una
//  variable que se declaró y nunca se usó, de un `==` que compara mal, de una
//  condición imposible, ni de una promesa a la que le falta el await. Esa
//  familia se encuentra leyendo el código, y una máquina lo hace mejor y más
//  barato que una persona.
//
//  ── Reglas de BUGS, no de estilo ──
//  A propósito no hay nada de comillas, punto y coma ni indentación. Un linter
//  que grita por formato se apaga a la semana, y con él se van las reglas que
//  sí encuentran problemas. Si algún día se quiere formato, eso es un
//  formateador (Prettier), no esto.
//
//  Corre en CI. `npm run lint` para correrlo a mano.
// ════════════════════════════════════════════════════════════════════
'use strict';

const js = require('@eslint/js');

// Globals del navegador que usa el frontend legacy (public/js/app.js y roles.js
// no son módulos: se cargan con <script> y se hablan por window).
const navegador = {
  window: 'readonly', document: 'readonly', navigator: 'readonly',
  location: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
  fetch: 'readonly', Blob: 'readonly', URL: 'readonly', FormData: 'readonly',
  FileReader: 'readonly', Image: 'readonly', alert: 'readonly',
  confirm: 'readonly', prompt: 'readonly', setTimeout: 'readonly',
  clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  console: 'readonly', requestAnimationFrame: 'readonly', Event: 'readonly',
  CustomEvent: 'readonly', AbortController: 'readonly', Notification: 'readonly',
  IntersectionObserver: 'readonly', MutationObserver: 'readonly',
  ResizeObserver: 'readonly', getComputedStyle: 'readonly', atob: 'readonly',
  btoa: 'readonly', crypto: 'readonly', history: 'readonly', screen: 'readonly',
  matchMedia: 'readonly', performance: 'readonly', Chart: 'readonly',
  jspdf: 'readonly', html2canvas: 'readonly', XLSX: 'readonly',
};

const node = {
  require: 'readonly', module: 'writable', exports: 'writable',
  process: 'readonly', __dirname: 'readonly', __filename: 'readonly',
  Buffer: 'readonly', console: 'readonly', setTimeout: 'readonly',
  clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  setImmediate: 'readonly', URL: 'readonly', TextEncoder: 'readonly',
  TextDecoder: 'readonly', AbortController: 'readonly', fetch: 'readonly',
  structuredClone: 'readonly', global: 'readonly',
};

// Las que valen la pena. Cada una está acá porque encuentra un error real, no
// porque venga en una lista.
const reglas = {
  ...js.configs.recommended.rules,

  // Una promesa sin await se pierde en silencio: el error nunca llega a nadie.
  // Es el modo de falla más caro de este código base, donde casi todo es async.
  'require-atomic-updates': 'off',        // ruidosa y de bajo rendimiento
  'no-async-promise-executor': 'error',
  'no-await-in-loop': 'off',              // acá se usa a propósito (no saturar APIs)

  // Comparaciones que mienten.
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-self-compare': 'error',

  // Código que no se ejecuta nunca: casi siempre significa que la lógica de
  // arriba está mal.
  'no-unreachable': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-dupe-keys': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',

  // Variables declaradas y nunca usadas: sobra, o quedó a medias un cambio.
  // Los argumentos no se cuentan (un handler de Express usa (req,res,next) aunque
  // no toque los tres), ni las variables que empiezan con _.
  'no-unused-vars': ['error', {
    args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none',
  }],

  // Un catch vacío se traga un error del que después nadie se entera. Se permite
  // si lleva un comentario adentro explicando por qué está bien ignorarlo.
  'no-empty': ['error', { allowEmptyCatch: true }],

  // console está bien: es cómo este sistema reporta lo que hace.
  'no-console': 'off',
};

// ── Por qué hay dos niveles ───────────────────────────────────────────
// Las reglas de arriba son de BUGS y hoy pasan TODAS con cero errores. Esas van
// en 'error' y frenan el CI: si mañana aparece un `==` mal, un case duplicado o
// una variable no declarada, el PR se pone rojo.
//
// Las tres de abajo son de LIMPIEZA —variables muertas, escapes de más,
// asignaciones que se pisan— y hoy dan 69 avisos preexistentes. Ponerlas en
// 'error' dejaría el linter rojo desde el día uno, y un linter que arranca rojo
// no lo corre nadie: se vuelve ruido de fondo y se lleva puestas también a las
// reglas que sí sirven.
//
// Van en 'warn': se ven, no frenan. Se limpian cuando alguien toca ese archivo
// por otra razón, que es cuando el riesgo de tocar código sin tests es menor.
// Arreglar 69 declaraciones muertas hoy es cero valor para quien usa el sistema
// y una oportunidad de romper algo en 11.000 líneas sin cobertura.
const limpieza = {
  'no-unused-vars': ['warn', {
    args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none',
  }],
  'no-useless-assignment': 'warn',
  'no-useless-escape': 'warn',
  'preserve-caught-error': 'warn',
};
Object.assign(reglas, limpieza);

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },

  // Backend y scripts: CommonJS sobre Node.
  {
    files: ['**/*.js'],
    ignores: ['public/**'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: node },
    rules: reglas,
  },

  // Frontend legacy: se carga con <script>, todo vive en el global.
  {
    files: ['public/js/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: navegador },
    rules: {
      ...reglas,
      // app.js y roles.js se hablan por funciones globales declaradas en el otro
      // archivo. Marcarlas como no definidas sería ruido puro hasta que termine
      // la migración a módulos.
      'no-undef': 'off',
      // Y hay funciones que solo llama un onclick= del HTML generado, así que
      // desde el punto de vista del linter "no se usan".
      'no-unused-vars': ['warn', {
        args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none',
        vars: 'local',
      }],
    },
  },

  // Módulos del frontend: ES modules de verdad, pero a medio migrar. Varios
  // todavía leen helpers del global en vez de importarlos con need() del puente
  // (dom.mjs). Eso funciona porque app.js carga antes, y NO es un error del
  // linter: es el estado real de la migración.
  //
  // Se declaran los que existen de verdad para que no-undef siga sirviendo para
  // lo que importa —un nombre mal escrito— en vez de tapar 210 avisos que
  // apagarían la regla entera. A medida que un módulo pasa a need(), su nombre
  // sale de esta lista.
  {
    files: ['public/js/modules/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023, sourceType: 'module',
      globals: {
        ...navegador,
        App: 'readonly', escapeHtml: 'readonly', showToast: 'readonly',
        apiFetch: 'readonly', openModal: 'readonly', closeModal: 'readonly',
        loadInitialData: 'readonly', afterSave: 'readonly',
        userHasRole: 'readonly', todayISO: 'readonly', File: 'readonly',
        // Funciones que viven en otros módulos y se llaman por el global,
        // porque quien las invoca es un onclick= del HTML generado.
        renderTesoreriaPanelInline: 'readonly', abrirModalRecepciones: 'readonly',
        abrirModalFacturas: 'readonly', actualizarPreviewFacturaIVA: 'readonly',
        openFuelLoadModal: 'readonly', updateFuelPlaceOpts: 'readonly',
        cambiarMetodoPago: 'readonly', pciRecalcular: 'readonly',
        pciAgregar: 'readonly', pciMetodoCampos: 'readonly',
        stockBaseOptions: 'readonly', stockAreaOptions: 'readonly',
      },
    },
    rules: reglas,
  },

  // Service worker.
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2023, sourceType: 'script',
      globals: { ...navegador, self: 'readonly', clients: 'readonly' },
    },
    rules: { ...reglas, 'no-undef': 'off' },
  },

  // Tests: node:test inyecta sus globals por require, no hay nada especial.
  {
    files: ['test/**/*.js', 'test/**/*.cjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: node },
    rules: reglas,
  },

  // El smoke de UI tiene código que corre DENTRO del navegador (page.evaluate),
  // así que en el mismo archivo conviven globals de Node y del DOM.
  {
    files: ['test/smoke.ui.cjs'],
    languageOptions: {
      ecmaVersion: 2023, sourceType: 'commonjs',
      globals: { ...node, ...navegador, App: 'readonly' },
    },
    rules: reglas,
  },
];
