const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isUuid,
  normalizeType,
  validateDriverAssignment,
} = require('../services/driver-assignment');

test('acepta una unidad motriz y un semirremolque diferentes', () => {
  const error = validateDriverAssignment(
    { id: 'primary', type: 'camion' },
    { id: 'trailer', type: 'semirremolque' }
  );
  assert.equal(error, null);
});

test('rechaza un semirremolque como unidad principal', () => {
  assert.match(
    validateDriverAssignment({ id: 'semi', type: 'semirremolque' }, null),
    /unidad principal/i
  );
});

test('rechaza un camión como remolcado', () => {
  assert.match(
    validateDriverAssignment(null, { id: 'truck', type: 'camion' }),
    /remolcado/i
  );
});

test('normaliza tipos con mayúsculas y acentos', () => {
  assert.equal(normalizeType('  CAMIÓN  '), 'camion');
});

test('valida UUID antes de consultar PostgreSQL', () => {
  assert.equal(isUuid('28d3c7d2-d57a-4a63-96f4-36ab9f24b994'), true);
  assert.equal(isUuid('no-es-un-uuid'), false);
});
