// Service Worker mínimo de FleetOS.
// Su único objetivo es habilitar la instalación como app (PWA) en Android/Chrome.
// NO cachea los assets de la app a propósito: app.js cambia seguido y no queremos
// servir código viejo.
//
// Sin handler de 'fetch': la red es el comportamiento por defecto cuando el SW no
// intercepta. Un handler no-op (que no llama respondWith) agrega overhead en cada
// navegación y Chrome lo advierte ("no-op fetch handler"). Chrome moderno ya no
// exige un fetch handler para permitir la instalación PWA.
const SW_VERSION = 'fleetos-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
