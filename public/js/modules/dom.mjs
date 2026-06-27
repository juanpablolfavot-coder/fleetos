// ════════════════════════════════════════════════════════════════════
//  dom.mjs — helpers compartidos por los módulos ES nuevos y PUENTE con el
//  mundo "legacy" (scripts clásicos globales) mientras ambos coexisten.
//
//  Por qué hace falta el puente: durante la migración, app.js y compañía
//  siguen siendo scripts clásicos que definen funciones/estado en el scope
//  global. Un ES module NO ve esos identificadores "pelados"; solo lo que
//  esté en window. Y a la inversa, el dispatcher legacy (renderPage) y los
//  onclick="..." buscan funciones globales, así que un módulo debe
//  re-exponerse en window para que lo encuentren.
// ════════════════════════════════════════════════════════════════════

// Leer un global legacy por nombre (p. ej. g('navigate'), g('_pdfHeader')).
export const g = (name) => window[name];

// App es `const` en app.js → no está en el global object salvo por el puente
// window.App = App. Se accede siempre por acá para no depender de ese detalle.
export const app = () => window.App;

// Re-exponer una función del módulo en window, para que el dispatcher legacy
// (renderPage) y los handlers onclick="fn()" la resuelvan.
export function expose(name, fn) { window[name] = fn; }
