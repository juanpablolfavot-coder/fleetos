// Service Worker mínimo de FleetOS.
// Su único objetivo es habilitar la instalación como app (PWA) en Android/Chrome.
// NO cachea los assets de la app a propósito: app.js cambia seguido y no queremos
// servir código viejo.
//
// Sin handler de 'fetch': la red es el comportamiento por defecto cuando el SW no
// intercepta. Un handler no-op (que no llama respondWith) agrega overhead en cada
// navegación y Chrome lo advierte ("no-op fetch handler"). Chrome moderno ya no
// exige un fetch handler para permitir la instalación PWA.
const SW_VERSION = 'fleetos-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// ── Notificaciones push (alertas de velocidad para dueños) ──
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'FleetOS';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'fleetos',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Al tocar la notificación se va a la URL que trae (el exceso puntual en el
// feed, el resumen en Control en vivo). Si la app ya está abierta se la
// enfoca Y se la lleva ahí: antes con una ventana abierta sólo se enfocaba, y
// el dueño quedaba en la pantalla en la que estaba, sin ver de qué le avisaron.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (!('focus' in c)) continue;
        return c.focus().then((w) => (w && 'navigate' in w ? w.navigate(url).catch(() => w) : w));
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
