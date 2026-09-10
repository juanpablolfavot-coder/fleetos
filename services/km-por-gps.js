// ═══════════════════════════════════════════════════════════
//  FleetOS — Cómo avanza vehicles.km_current con el odómetro del GPS
//
//  POR QUÉ EXISTE
//  El sync del GPS hacía km_current = GREATEST(km_current, odómetro_gps). Eso
//  supone que el odómetro de Powerfleet ES el del tablero, y no lo es: cada
//  equipo tiene su propio origen (services/gps-odometro.js lo dice con todas
//  las letras). En varias unidades venía muy por encima —AG468LQ mostraba
//  3.625.518 km con 393.719 en el tablero— y, con GREATEST, corregir el dato a
//  mano duraba hasta el sync siguiente: dos minutos.
//
//  LO QUE VALE DEL GPS ES LA DIFERENCIA, NO EL VALOR
//  El odómetro del GPS es un acumulador. No importa dónde arranca; importa
//  cuánto creció entre dos lecturas. Entonces:
//
//      km_current = km_current + (odómetro_gps ahora − odómetro_gps anterior)
//
//  Así el tablero real lo fija una persona (o un ticket de combustible) y el
//  GPS lo va moviendo desde ahí. Una corrección a mano queda; no la pisa nadie.
//
//  Se guarda en vehicles.gps_odometer la última lectura CONTADA (no la cruda):
//  km_current es entero, así que se suman sólo km enteros y la fracción queda
//  pendiente en la lectura guardada. Sin eso, redondear en cada sync (720 por
//  día) acumula deriva.
//
//  CASOS QUE NO SUMAN
//   · primera lectura de la unidad → se ancla, km_current no se toca
//     (si la unidad no tiene km cargado, se toma el odómetro como punto de
//     partida, igual que hace el alta automática desde el GPS: algo es mejor
//     que 0 para un motor)
//   · retrocede → equipo cambiado o reseteado: se re-ancla, no se resta
//   · salta más de lo que un camión puede recorrer en ese tiempo → se re-ancla
//     y se avisa; si el salto fuera real, el próximo ticket lo alcanza
// ═══════════════════════════════════════════════════════════

const VEL_MAX_KMH = 150;   // más que cualquier camión: tope de plausibilidad
const HOLGURA_KM  = 50;    // mensajes que llegan con retraso al proveedor

/**
 * Decide cómo mover km_current con una lectura nueva del odómetro del GPS.
 *
 * @param {object} o
 * @param {number|null} o.kmActual    vehicles.km_current
 * @param {number|null} o.odoGuardado vehicles.gps_odometer (última lectura contada)
 * @param {number|null} o.odoNuevo    odómetro que acaba de mandar el GPS
 * @param {number|null} o.horas       horas desde la lectura guardada (para el tope)
 * @returns {{ km:number|null, odo:number|null, delta:number, motivo:string }}
 *   km:    km_current resultante (null si no había y no hay con qué llenarlo)
 *   odo:   lo que hay que guardar en gps_odometer
 *   delta: km enteros que se suman (0 si no se suma)
 *   motivo: 'sin_odometro' | 'inicial' | 'ancla' | 'retroceso' | 'salto' |
 *           'sin_cambio' | 'avance'
 */
function avanceKm({ kmActual, odoGuardado, odoNuevo, horas }) {
  const kmNum = Number(kmActual);
  const km = Number.isFinite(kmNum) && kmNum > 0 ? Math.trunc(kmNum) : null;
  const nuevo = Number(odoNuevo);
  const prev = Number(odoGuardado);

  if (!(nuevo > 0)) return { km, odo: prev > 0 ? prev : null, delta: 0, motivo: 'sin_odometro' };

  if (!(prev > 0)) {
    // Primera lectura que se guarda: se ancla. Sin km cargado, el odómetro
    // sirve de punto de partida; con km cargado, ese km manda.
    if (km == null) return { km: Math.round(nuevo), odo: nuevo, delta: 0, motivo: 'inicial' };
    return { km, odo: nuevo, delta: 0, motivo: 'ancla' };
  }

  const delta = nuevo - prev;
  if (delta < 0) return { km, odo: nuevo, delta: 0, motivo: 'retroceso' };

  const h = Number(horas);
  const tope = VEL_MAX_KMH * (Number.isFinite(h) && h > 0 ? h : 0) + HOLGURA_KM;
  if (delta > tope) return { km, odo: nuevo, delta: 0, motivo: 'salto' };

  const enteros = Math.floor(delta);
  if (enteros < 1) return { km, odo: prev, delta: 0, motivo: 'sin_cambio' };
  return { km: (km || 0) + enteros, odo: prev + enteros, delta: enteros, motivo: 'avance' };
}

module.exports = { avanceKm, VEL_MAX_KMH, HOLGURA_KM };
