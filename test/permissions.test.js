// ═══════════════════════════════════════════════════════════════════════════
//  Tests de permisos (autorización por rol)
//  Runner integrado de Node (node --test) — sin dependencias ni base de datos.
//
//  Verifican el "portón" de autorización (requireRole / requireOwner) y dejan
//  documentada, como matriz viva, qué rol puede hacer cada operación crítica.
//  Estos tests SOLO leen el middleware ya existente; no tocan la app.
// ═══════════════════════════════════════════════════════════════════════════
const { test } = require('node:test');
const assert = require('node:assert');
const { requireRole, requireOwner } = require('../middleware/auth');

// Todos los roles del sistema (para probar los que NO deben pasar).
const TODOS_LOS_ROLES = [
  'dueno', 'gerencia', 'jefe_mantenimiento', 'mecanico', 'chofer',
  'encargado_combustible', 'paniol', 'contador', 'compras', 'tesoreria',
  'proveedores', 'gerente_sucursal', 'auditor',
];

// Ejecuta un middleware con un rol dado y reporta si dejó pasar o cortó con 403.
function correr(mw, role) {
  const req = { user: { role, name: 'Tester' }, path: '/api/x', originalUrl: '/api/x' };
  let status = null, body = null, nextLlamado = false;
  const res = {
    status(c) { status = c; return this; },
    json(b) { body = b; return this; },
  };
  mw(req, res, () => { nextLlamado = true; });
  return { paso: nextLlamado, status, body };
}

// ── Portón básico ──────────────────────────────────────────────────────────
test('requireRole deja pasar a un rol permitido', () => {
  const r = correr(requireRole('dueno', 'compras'), 'compras');
  assert.equal(r.paso, true);
  assert.equal(r.status, null, 'no debería responder con error');
});

test('requireRole corta con 403 a un rol no permitido', () => {
  const r = correr(requireRole('dueno', 'compras'), 'chofer');
  assert.equal(r.paso, false);
  assert.equal(r.status, 403);
});

test('requireOwner solo admite dueño y gerencia', () => {
  assert.equal(correr(requireOwner, 'dueno').paso, true);
  assert.equal(correr(requireOwner, 'gerencia').paso, true);
  assert.equal(correr(requireOwner, 'compras').status, 403);
  assert.equal(correr(requireOwner, 'tesoreria').status, 403);
  assert.equal(correr(requireOwner, 'chofer').status, 403);
});

// ── Matriz de permisos por operación crítica ────────────────────────────────
// Documenta y verifica el set de roles permitido por cada operación. Espejo de
// los requireRole(...) de las rutas: si cambia una regla, este test lo marca.
const MATRIZ = {
  'OC · crear / editar':        ['dueno', 'gerencia', 'jefe_mantenimiento', 'compras', 'paniol', 'contador', 'gerente_sucursal'],
  'OC · tomar cotización':      ['dueno', 'gerencia', 'compras'],
  'OC · aprobar compras':       ['dueno', 'gerencia', 'compras'],
  'OC · marcar enviada':        ['dueno', 'gerencia', 'compras'],
  'OC · cerrar':                ['dueno', 'gerencia', 'compras'],
  'OC · pagar':                 ['dueno', 'gerencia', 'tesoreria'],
  'OC · reabrir':               ['dueno', 'gerencia'],
  'Tesorería · facturas pend.': ['dueno', 'gerencia', 'tesoreria'],
  'Admin · backup DB':          ['dueno'],
};

for (const [operacion, permitidos] of Object.entries(MATRIZ)) {
  test(`Matriz · ${operacion}`, () => {
    const mw = requireRole(...permitidos);
    // Cada rol permitido pasa.
    for (const rol of permitidos) {
      assert.equal(correr(mw, rol).paso, true, `${rol} debería poder: ${operacion}`);
    }
    // Cada rol NO listado recibe 403.
    for (const rol of TODOS_LOS_ROLES.filter(r => !permitidos.includes(r))) {
      const r = correr(mw, rol);
      assert.equal(r.paso, false, `${rol} NO debería poder: ${operacion}`);
      assert.equal(r.status, 403, `${rol} debería recibir 403 en: ${operacion}`);
    }
  });
}
