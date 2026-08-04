// ═══════════════════════════════════════════════════════════════════════════
//  Middleware de seguridad.
//
//  Lo que más se cuida acá: que el sanitizador NO rompa texto legítimo. Corre en
//  cada request y muta el body ANTES de guardarlo, así que cualquier cosa que
//  destruya es permanente y no se detecta después — "m15000" no parece un error.
//
//  La defensa contra XSS es escapar al RENDERIZAR (escapeHtml, 422 usos en el
//  frontend). Esto es una capa extra, y una capa extra que daña datos vale
//  menos que no tenerla.
// ═══════════════════════════════════════════════════════════════════════════
const { test } = require('node:test');
const assert = require('node:assert');

const { sanitize } = require('../middleware/security');

// Corre el middleware como lo corre Express y devuelve el body ya mutado.
function pasar(body) {
  const req = { body };
  let siguio = false;
  sanitize(req, {}, () => { siguio = true; });
  assert.ok(siguio, 'el middleware tiene que llamar a next()');
  return req.body;
}

// ── Lo que NO se puede tocar ──────────────────────────────────────────
test('el texto en castellano con "=" sobrevive intacto', () => {
  // El regex /on\w+\s*=/ que estaba acá convertía "monto=15000" en "m15000":
  // engancha cualquier palabra con "on" en el medio seguida de "=". En un
  // sistema de flota y compras eso es escritura de todos los días.
  const casos = [
    'monto=15000',
    'consumo=35 L/100km',
    'control= cada 5000 km',
    'contado= 30 dias',
    'Cambio de aceite. Monto = 42000',
    'condicion=contado',
    'Se acordó monto=1.250.000 con el proveedor',
  ];
  for (const texto of casos) {
    assert.strictEqual(pasar({ notas: texto }).notas, texto, `se rompió: ${texto}`);
  }
});

test('los campos de texto de todo el sistema pasan sin cambios', () => {
  const body = {
    nombre: 'Cambio de aceite y filtros',
    description: 'OT preventiva. Monto estimado = 42000',
    notas: 'El chofer avisó que el consumo=38 desde la semana pasada',
    location: 'Depósito Córdoba',
    ticket_obs: 'Ticket ilegible, monto=8500 según el chofer',
  };
  const salida = pasar({ ...body });
  for (const k of Object.keys(body)) {
    assert.strictEqual(salida[k], body[k], `${k} se modificó`);
  }
});

test('las contraseñas no se tocan, ni siquiera el trim', () => {
  // Un .trim() sobre una contraseña que empieza o termina con espacio rompe el
  // login sin decir por qué.
  const body = { password: '  onclick= <script> ', newPassword: ' x ' };
  const salida = pasar(body);
  assert.strictEqual(salida.password, '  onclick= <script> ');
  assert.strictEqual(salida.newPassword, ' x ');
});

// ── Lo que sí se sigue limpiando ──────────────────────────────────────
test('sigue sacando <script> y javascript:', () => {
  // Estos no aparecen nunca en texto legítimo de este dominio, así que dejarlos
  // no cuesta nada. No son la defensa principal igual.
  assert.strictEqual(pasar({ n: 'hola<script>alert(1)</script>chau' }).n, 'holachau');
  assert.strictEqual(pasar({ n: 'ver javascript:void(0)' }).n, 'ver void(0)');
});

test('recorre objetos anidados y no rompe con null', () => {
  const salida = pasar({
    plan: { nombre: 'monto=1', sub: { x: 'consumo=2' } },
    vacio: null,
    numero: 42,
  });
  assert.strictEqual(salida.plan.nombre, 'monto=1');
  assert.strictEqual(salida.plan.sub.x, 'consumo=2');
  assert.strictEqual(salida.vacio, null);
  assert.strictEqual(salida.numero, 42);
});

test('sin body no explota', () => {
  const req = {};
  let siguio = false;
  sanitize(req, {}, () => { siguio = true; });
  assert.ok(siguio);
});

// ── Por qué el filtro que se sacó tampoco servía ──────────────────────
test('el filtro de "onX=" era esquivable: se lo hacía armar el handler', () => {
  // Documenta el motivo real de la remoción, no solo el daño colateral. Al ser
  // un reemplazo de una sola pasada, borrar el match del medio deja pegados los
  // extremos y reconstruye exactamente lo que se quería prohibir.
  const filtroViejo = (s) => s.replace(/on\w+\s*=/gi, '');

  assert.strictEqual(
    filtroViejo('<img src=x oonerror=nerror=alert(1)>'),
    '<img src=x onerror=alert(1)>',
    'el filtro ARMABA el handler que decía borrar');

  // Y la defensa que sí sirve, en la capa correcta: escapar al renderizar.
  const escapeHtml = (v) => String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const escapado = escapeHtml('<img src=x oonerror=nerror=alert(1)>');
  assert.doesNotMatch(escapado, /</, 'no queda una sola etiqueta viva');
  assert.doesNotMatch(escapado, />/);
});

// ── validateUUID ──────────────────────────────────────────────────────
const { validateUUID } = require('../middleware/security');

test('validateUUID rechaza lo que no es un UUID v4', () => {
  const correr = (val) => {
    const req = { params: { id: val } };
    let estado = null, cuerpo = null, siguio = false;
    const res = { status(c) { estado = c; return this; }, json(b) { cuerpo = b; return this; } };
    validateUUID('id')(req, res, () => { siguio = true; });
    return { estado, cuerpo, siguio };
  };

  assert.ok(correr('3bd13519-7f2d-4eed-9fb9-6c21e23696a5').siguio, 'un UUID v4 real pasa');

  for (const malo of ['', '123', 'DROP TABLE users', '../../etc/passwd',
                      '3bd13519-7f2d-1eed-9fb9-6c21e23696a5']) {
    const r = correr(malo);
    assert.ok(!r.siguio, `no debería pasar: ${malo}`);
    assert.strictEqual(r.estado, 400);
  }
});
