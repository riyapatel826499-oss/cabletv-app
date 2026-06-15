// Self-unregistering SW — replaces old hand-written SW so Vite PWA SW takes over
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete all old caches
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      // Unregister this SW
      await self.registration.unregister();
      // Reload all clients
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => c.navigate(c.url));
    })()
  );
});
