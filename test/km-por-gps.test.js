// ═══════════════════════════════════════════════════════════════════════════
//  km_current a partir del odómetro del GPS (services/km-por-gps.js).
//
//  Puro: corre siempre, sin base.
//
//  Lo que más se cuida: que una corrección hecha a mano NO la pise el GPS. Con
//  el GREATEST anterior, bajar el km de una unidad duraba dos minutos. Lo
//  segundo: que un odómetro que salta (equipo cambiado, valor absurdo) no
//  sume millones de km de golpe.
// ═══════════════════════════════════════════════════════════════════════════
const { test } = require('node:test');
const assert = require('node:assert');
const { avanceKm } = require('../services/km-por-gps');

test('suma la diferencia entre lecturas, no el valor absoluto', () => {
  // AG468LQ: tablero 393.719, GPS 3.625.518. Lo que cuenta es que el GPS creció 12 km.
  const r = avanceKm({ kmActual: 393719, odoGuardado: 3625518, odoNuevo: 3625530, horas: 0.05 });
  assert.strictEqual(r.motivo, 'avance');
  assert.strictEqual(r.delta, 12);
  assert.strictEqual(r.km, 393731);
  assert.strictEqual(r.odo, 3625530);
});

test('una corrección a mano queda: el GPS arranca a contar desde ahí', () => {
  // Alguien bajó km_current de 652.854 a 576.226; el GPS sigue en su propio origen.
  const r = avanceKm({ kmActual: 576226, odoGuardado: 652854, odoNuevo: 652854.4, horas: 0.03 });
  assert.strictEqual(r.motivo, 'sin_cambio');
  assert.strictEqual(r.km, 576226, 'no vuelve al valor del GPS');
});

test('primera lectura: ancla y no toca el km cargado', () => {
  const r = avanceKm({ kmActual: 100000, odoGuardado: null, odoNuevo: 250000, horas: null });
  assert.strictEqual(r.motivo, 'ancla');
  assert.strictEqual(r.km, 100000);
  assert.strictEqual(r.odo, 250000);
});

test('primera lectura sin km cargado: el odómetro es el punto de partida', () => {
  const r = avanceKm({ kmActual: 0, odoGuardado: null, odoNuevo: 250000.6, horas: null });
  assert.strictEqual(r.motivo, 'inicial');
  assert.strictEqual(r.km, 250001);
  const r2 = avanceKm({ kmActual: null, odoGuardado: null, odoNuevo: 250000.4, horas: null });
  assert.strictEqual(r2.km, 250000);
});

test('sin odómetro en la lectura: no cambia nada', () => {
  const r = avanceKm({ kmActual: 100000, odoGuardado: 5000, odoNuevo: 0, horas: 1 });
  assert.strictEqual(r.motivo, 'sin_odometro');
  assert.strictEqual(r.km, 100000);
  assert.strictEqual(r.odo, 5000);
});

test('la fracción no se pierde ni se acumula como deriva', () => {
  // 0,4 km por sync, tres veces: al tercero se cuenta 1 km, no 0 ni 3.
  let km = 100000, odo = 5000;
  let r = avanceKm({ kmActual: km, odoGuardado: odo, odoNuevo: 5000.4, horas: 0.03 });
  assert.strictEqual(r.delta, 0); assert.strictEqual(r.odo, 5000);
  r = avanceKm({ kmActual: r.km, odoGuardado: r.odo, odoNuevo: 5000.8, horas: 0.03 });
  assert.strictEqual(r.delta, 0); assert.strictEqual(r.odo, 5000);
  r = avanceKm({ kmActual: r.km, odoGuardado: r.odo, odoNuevo: 5001.2, horas: 0.03 });
  assert.strictEqual(r.delta, 1); assert.strictEqual(r.km, 100001);
  assert.strictEqual(r.odo, 5001, 'la lectura guardada avanza sólo lo contado');
});

test('retroceso del odómetro: equipo cambiado, se re-ancla y no se resta', () => {
  const r = avanceKm({ kmActual: 100000, odoGuardado: 500000, odoNuevo: 12, horas: 0.03 });
  assert.strictEqual(r.motivo, 'retroceso');
  assert.strictEqual(r.km, 100000);
  assert.strictEqual(r.odo, 12);
});

test('salto imposible para el tiempo transcurrido: se re-ancla y no suma', () => {
  // 3.000 km en dos minutos no existe.
  const r = avanceKm({ kmActual: 100000, odoGuardado: 500000, odoNuevo: 503000, horas: 0.03 });
  assert.strictEqual(r.motivo, 'salto');
  assert.strictEqual(r.km, 100000);
  assert.strictEqual(r.odo, 503000, 'desde acá se vuelve a contar');
});

test('un tramo largo con el server caído sí es plausible y se suma', () => {
  // 24 h sin sync y 1.800 km: un camión de larga distancia lo hace.
  const r = avanceKm({ kmActual: 100000, odoGuardado: 500000, odoNuevo: 501800, horas: 24 });
  assert.strictEqual(r.motivo, 'avance');
  assert.strictEqual(r.km, 101800);
});

test('sin hora de la lectura anterior, el tope es la holgura', () => {
  const ok = avanceKm({ kmActual: 100000, odoGuardado: 500000, odoNuevo: 500040, horas: null });
  assert.strictEqual(ok.motivo, 'avance');
  const no = avanceKm({ kmActual: 100000, odoGuardado: 500000, odoNuevo: 500400, horas: null });
  assert.strictEqual(no.motivo, 'salto');
});
