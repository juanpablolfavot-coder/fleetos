// ════════════════════════════════════════════════════════════════════
//  ENTRY de los módulos ES nuevos (Fase 3).
//  A medida que se migren pantallas de app.js a ES modules, se importan acá.
//  esbuild bundlea desde este archivo; en dev el navegador lo carga nativo
//  (<script type="module">). Cada módulo se re-expone en window (ver dom.mjs)
//  para convivir con el código legacy global.
// ════════════════════════════════════════════════════════════════════
import './contador.mjs';
import './documents.mjs';
import './maintenance.mjs';
import './assets.mjs';
import './tires.mjs';
