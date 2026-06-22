// Service Worker mínimo de FleetOS.
// Su único objetivo es habilitar la instalación como app (PWA) en Android/Chrome.
// NO cachea los assets de la app a propósito: app.js cambia seguido y no queremos
// servir código viejo. El fetch va siempre a la red (passthrough).
const SW_VERSION = 'fleetos-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* red por defecto; sin caché de la app */ });
