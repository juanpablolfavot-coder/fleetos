// ═══════════════════════════════════════════════════════════════════════════
//  Notificaciones push (services/push.js): la frase que dice si la alerta
//  salió y, si no, por qué. Es lo que queda en el log y en el resultado del
//  webhook: un exceso "notificado" que en realidad no le llegó a nadie tiene
//  que leerse distinto de uno que sí.
// ═══════════════════════════════════════════════════════════════════════════
const { test } = require('node:test');
const assert = require('node:assert');

const push = require('../services/push');

test('sin claves VAPID se dice que el push está desactivado', () => {
  const s = push.describirEnvio({ enabled: false, dispositivos: 0, sent: 0, errores: [] });
  assert.match(s, /SIN notificación/);
  assert.match(s, /VAPID/);
});

test('sin dispositivos suscriptos se dice que nadie activó las alertas', () => {
  const s = push.describirEnvio({ enabled: true, dispositivos: 0, sent: 0, errores: [] });
  assert.match(s, /SIN notificación/);
  assert.match(s, /ningún dispositivo/);
});

test('si el envío falló en todos se muestra el primer error', () => {
  const s = push.describirEnvio({ enabled: true, dispositivos: 2, sent: 0, errores: ['HTTP 403: claves rechazadas'] });
  assert.match(s, /SIN notificación/);
  assert.match(s, /2 dispositivos/);
  assert.match(s, /HTTP 403/);
});

test('envío parcial dice a cuántos de cuántos llegó', () => {
  const s = push.describirEnvio({ enabled: true, dispositivos: 3, sent: 2, errores: ['suscripción vencida'] });
  assert.doesNotMatch(s, /SIN notificación/);
  assert.match(s, /2 de 3/);
  assert.match(s, /suscripción vencida/);
});

test('envío completo se lee como notificación efectiva', () => {
  assert.strictEqual(push.describirEnvio({ enabled: true, dispositivos: 1, sent: 1, errores: [] }), 'notificación a 1 dispositivo');
  assert.strictEqual(push.describirEnvio({ enabled: true, dispositivos: 2, sent: 2, errores: [] }), 'notificación a 2 dispositivos');
});

test('sin VAPID en el entorno, enviar a roles no toca la base y avisa desactivado', async () => {
  // El test corre sin VAPID_* (no hay .env en CI): pushEnabled() tiene que ser false.
  if (push.pushEnabled()) return;   // entorno con claves: este caso no aplica
  const r = await push.enviarARoles(['dueno'], { title: 'x' });
  assert.deepStrictEqual(r, { enabled: false, dispositivos: 0, sent: 0, errores: [] });
});
