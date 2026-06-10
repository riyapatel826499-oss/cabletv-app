// Service Worker for Wasool PWA
const CACHE_NAME = 'wasool-v2';
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

// Fetch — network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache successful GET API responses briefly
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

  // Static files: cache first, fallback to network
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
      { freq: 523, start: 0, dur: 0.3, gain: 0.3 },
      { freq: 659, start: 0.1, dur: 0.25, gain: 0.25 },
      { freq: 784, start: 0.2, dur: 0.3, gain: 0.2 }
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = note.freq;
      gainNode.gain.setValueAtTime(0, note.start);
      gainNode.gain.linearRampToValueAtTime(note.gain, note.start + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, note.start + note.dur);
      osc.start(note.start);
      osc.stop(note.start + note.dur);
    }

    const buffer = await ctx.startRendering();
    const audioCtx = new AudioContext({ sampleRate });
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
  } catch (e) {
    // Fallback: vibrate only (sound not supported in this SW context)
  }
}

self.addEventListener('push', (event) => {
  let data = {
    title: '📢 Wasool',
    body: 'You have a new notification',
    tag: 'wasool-' + Date.now(),
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    vibrate: [100, 50, 100],
    data: { url: '/' }
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  // Determine notification type for appropriate sound/action
  const body = (data.body || '').toLowerCase();
  let actions = [];
  let image = undefined;

  // Smart notification types
  if (body.includes('payment') || body.includes('paid')) {
    actions = [
      { action: 'view', title: '💰 View Payment' },
      { action: 'dismiss', title: 'Dismiss' }
    ];
  } else if (body.includes('due') || body.includes('pending') || body.includes('reminder')) {
    actions = [
      { action: 'view', title: '📋 View Details' },
      { action: 'snooze', title: '⏰ Remind Later' }
    ];
  } else if (body.includes('disconnect') || body.includes('surrender')) {
    actions = [
      { action: 'view', title: '⚠️ View' },
      { action: 'dismiss', title: 'Dismiss' }
    ];
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-72.png',
    tag: data.tag || 'wasool-default',
    data: data.data || { url: '/' },
    vibrate: data.vibrate || [100, 50, 100],
    requireInteraction: actions.length > 0,  // Keep visible if has actions
    actions: actions,
    silent: false,  // Ensure system notification sound plays
    timestamp: Date.now()
  };

  // Add image if provided (rich notification)
  if (data.image) options.image = data.image;

  // Play sound + show notification
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, options),
      // Attempt to play custom sound (won't work in all browsers, fallback to system sound)
      playNotificationSound().catch(() => {})
    ])
  );
});

// Notification click — open app to correct page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  if (action === 'dismiss') return;

  // Determine URL based on notification data or action
  let targetUrl = '/dashboard.html';
  const notifData = event.notification.data || {};

  if (action === 'snooze') {
    // Re-show notification after 30 minutes
    setTimeout(() => {
      self.registration.showNotification('⏰ Reminder', {
        body: event.notification.body,
        icon: '/icon-192.png',
        tag: 'snooze-' + Date.now(),
        data: notifData
      });
    }, 30 * 60 * 1000);
    return;
  }

  if (notifData.url) {
    targetUrl = notifData.url.startsWith('/') ? notifData.url : '/' + notifData.url;
  }

  // Smart URL routing based on notification content
  const body = (event.notification.body || '').toLowerCase();
  if (!notifData.url) {
    if (body.includes('payment') || body.includes('paid') || body.includes('collect')) {
      targetUrl = '/dashboard.html#payments';
    } else if (body.includes('customer') || body.includes('new connection')) {
      targetUrl = '/dashboard.html#customers';
    } else if (body.includes('report') || body.includes('summary')) {
      targetUrl = '/dashboard.html#reports';
    }
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus existing window if open on our domain
      for (const client of clientList) {
        if (client.url.includes('wasool.co.in') && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
