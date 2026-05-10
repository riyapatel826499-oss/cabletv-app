// Service Worker for Cable TV Push Notifications
const CACHE_NAME = 'cabletv-v1';

// Install
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Push event — show notification
self.addEventListener('push', (event) => {
  let data = {
    title: '📢 Cable TV',
    body: 'You have a new notification',
    tag: 'default',
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    data: {}
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-72.png',
    tag: data.tag || 'default',
    data: data.data || {},
    vibrate: [100, 50, 100],
    requireInteraction: false,
    actions: []
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click — open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = data => {
    if (data && data.url) return data.url;
    return '/';  // default: open dashboard
  };

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const targetUrl = urlToOpen(event.notification.data);
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes('rscloud.live') && 'focus' in client) {
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
