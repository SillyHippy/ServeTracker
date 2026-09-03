// ServeTracker PWA Service Worker
const CACHE_NAME = 'servetracker-v20260820-stack-prod';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'ServeTracker Alert', body: 'New directive from dispatch', url: '/dashboard' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    tag: data.tag || (data.id ? 'notif_' + data.id : 'servetracker_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
    renotify: true,
    vibrate: [100, 50, 100],
    data: { url: data.url || data.actionUrl || '/dashboard' },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
