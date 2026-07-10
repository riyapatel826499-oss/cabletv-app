// Service Worker for Wasool PWA
const CACHE_NAME = 'wasool-v3';
const NOTIFICATION_SOUND = '/notification.wav';

// Precache: shell files only (not API data)
const PRECACHE_URLS = [
  '/dashboard.html',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/notification.wav'
];

// Install — precache shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network-first for API, network-first for app.js, cache-first for other static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (event.request.method === 'GET' && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // app.js, login.js, payments.js: always fetch fresh (never cache stale versions)
  if (url.pathname === '/app.js' || url.pathname === '/login.js' || url.pathname === '/js/payments.js') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Other static files: cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ── Push Notifications ──

// Play notification sound via AudioContext (works in SW on Chrome 92+)
async function playNotificationSound() {
  try {
    // Use OfflineAudioContext to generate a chime programmatically
    // This works without any external file
    const sampleRate = 44100;
    const duration = 0.6;
    const ctx = new OfflineAudioContext(1, sampleRate * duration, sampleRate);

    // Note frequencies: C5(523), E5(659), G5(784)
    const notes = [
      { freq: 523, start: 0, end: 0.15 },
      { freq: 659, start: 0.1, end: 0.25 },
      { freq: 784, start: 0.2, end: 0.4 },
    ];

    const bufferSize = sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);

    notes.forEach(({ freq, start, end }) => {
      const startSample = Math.floor(start * sampleRate);
      const endSample = Math.floor(end * sampleRate);
      for (let i = startSample; i < endSample; i++) {
        const t = (i - startSample) / sampleRate;
        const envelope = Math.max(0, 1 - (t / (end - start))) * 0.3;
        data[i] += Math.sin(2 * Math.PI * freq * t) * envelope;
      }
    });

    // Normalize
    let max = 0;
    for (let i = 0; i < bufferSize; i++) max = Math.max(max, Math.abs(data[i]));
    if (max > 0) for (let i = 0; i < bufferSize; i++) data[i] /= max;

    const rendered = await ctx.startRendering();
    const blob = await new Promise(resolve => rendered.toBlob(resolve));
    const audioUrl = URL.createObjectURL(blob);

    // Play via Audio element
    const audio = new Audio(audioUrl);
    audio.volume = 0.5;
    audio.play();
  } catch (e) {
    console.warn('SW: cannot play notification sound', e);
  }
}

self.addEventListener('push', async (event) => {
  let title = 'Wasool';
  let body = 'New notification';
  let icon = '/icon-192.png';

  try {
    const data = event.data.json();
    title = data.title || title;
    body = data.body || body;
    icon = data.icon || '/icon-192.png';

    // Play sound
    event.waitUntil(playNotificationSound());

    // Show notification
    const notif = await self.registration.showNotification(title, {
      body,
      icon,
      badge: '/icon-72.png',
      vibrate: [200, 100, 200],
      requireInteraction: true,
    });
  } catch (e) {
    console.warn('SW: push parse error', e);
    // Fallback
    const notif = await self.registration.showNotification(title, {
      body,
      icon,
      badge: '/icon-72.png',
      vibrate: [200, 100, 200],
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Focus or open the app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) {
        clientList[0].focus();
      } else {
        clients.openWindow('/');
      }
    })
  );
});
