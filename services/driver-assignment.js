const PRIMARY_VEHICLE_TYPES = new Set(['camion', 'tractor', 'utilitario', 'furgon', 'moto', 'otro']);
const TRAILER_VEHICLE_TYPES = new Set(['semirremolque', 'acoplado']);

function normalizeType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function validateDriverAssignment(primary, trailer) {
  if (primary && !PRIMARY_VEHICLE_TYPES.has(normalizeType(primary.type))) {
    return 'La unidad principal debe ser un camión, tractor o vehículo de reparto';
  }
  if (trailer && !TRAILER_VEHICLE_TYPES.has(normalizeType(trailer.type))) {
    return 'El remolcado debe ser un semirremolque o acoplado';
  }
  if (primary && trailer && String(primary.id) === String(trailer.id)) {
    return 'La unidad principal y el remolcado no pueden ser el mismo vehículo';
  }
  return null;
}

module.exports = {
  PRIMARY_VEHICLE_TYPES,
  TRAILER_VEHICLE_TYPES,
  isUuid,
  normalizeType,
  validateDriverAssignment,
};
