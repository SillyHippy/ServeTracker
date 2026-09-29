// ServeTracker PWA Service Worker with Offline Shell Caching
const CACHE_NAME = 'servetracker-v1790651357893';
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/placeholder.svg",
  "/assets/index-BYGIXZwU.css",
  "/assets/ActiveCasesPanel-BbgV2Yd9.js",
  "/assets/download-DqPQVMED.js",
  "/assets/Billing-XM1ciUrn.js",
  "/assets/ActiveCases-B3-f_l8n.js",
  "/assets/Dashboard-CwFV-Shq.js",
  "/assets/navigation-CQa_VRVN.js",
  "/assets/alert-dialog-DR0ebKrV.js",
  "/assets/dataNormalization-DkLKQZ4X.js",
  "/assets/gps-qftsZAZS.js",
  "/assets/user-x-BXuqmYYT.js",
  "/assets/search-DlxVEkxh.js",
  "/assets/ServerAssignmentPanel-CEbmEwAz.js",
  "/assets/alert-BzRmoqTs.js",
  "/assets/index-DDi5EdSx.js",
  "/assets/Settings-BbZLX-yu.js",
  "/assets/ServerProfileDialog-Dvw6zXY8.js",
  "/assets/Migration-UGkz0hUW.js",
  "/assets/circle-alert-3D3nzm-L.js",
  "/assets/chevron-left-B-f6FWAp.js",
  "/assets/popover-B9Q4EAKq.js",
  "/assets/MarkPaidDialog-BstHQqoV.js",
  "/assets/SignatureStatusBadge-BJFLyP1T.js",
  "/assets/MyProfile-DXYseDgu.js",
  "/assets/SignatureEnrollmentDialog-CfTGDF4W.js",
  "/assets/index-utiWEz06.js",
  "/assets/checkbox-BnfIqaIc.js",
  "/assets/index-CtlUh3T_.js",
  "/assets/select-BfvRgnux.js",
  "/assets/Clients-6oMFkZjW.js",
  "/assets/copy-v7f2R2d8.js",
  "/assets/CompleteOnboardingPage-BZa1C_qM.js",
  "/assets/Servers-BFuD8tE_.js",
  "/assets/DpaPage-AW9pxeM2.js",
  "/assets/PrivacyPage-CtNtoeHm.js",
  "/assets/chevron-right-21WpAfYD.js",
  "/assets/PhotoUploader-FBLORp7Q.js",
  "/assets/index-By4jYztw.js",
  "/assets/phone-C8GsoqPz.js",
  "/assets/printer-BTiTZLG-.js",
  "/assets/MemoryMonitor-BACDGgh1.js",
  "/assets/dataSwitch-C6dBplXo.js",
  "/assets/NewServe-BLeYg593.js",
  "/assets/DataExport-BJbiSvT1.js",
  "/assets/index-BBKMlH1T.js",
  "/assets/NudgeServerDialog-DGg9B-jo.js",
  "/assets/History-eOKsq8bG.js",
  "/assets/TermsPage-3jJkk9zn.js"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Precache failed non-critically:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. API routes & uploads MUST bypass cache (handled by offlineQueue.ts when network fails)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return; // Pass through to network
  }

  // 2. Navigation requests (HTML pages): Network-first with cache fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(async () => {
        // Offline / server down: return cached index.html
        const cache = await caches.open(CACHE_NAME);
        const cachedIndex = await cache.match('/index.html') || await cache.match('/');
        if (cachedIndex) return cachedIndex;
        return new Response('ServeTracker Offline Shell Available', {
          headers: { 'Content-Type': 'text/html' }
        });
      })
    );
    return;
  }

  // 3. Built static assets (/assets/*): Cache-first since content is hashed
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        }).catch(async (fetchErr) => {
          const cache = await caches.open(CACHE_NAME);
          const fallback = await cache.match(url.pathname, { ignoreSearch: true });
          if (fallback) return fallback;
          throw fetchErr;
        });
      })
    );
    return;
  }

  // 4. Other static assets (icons, images, fonts, manifests): Stale-while-revalidate
  if (/\.(js|css|woff2?|png|jpe?g|gif|svg|ico|webp|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        }).catch(() => {
          // Network failed, nothing to revalidate
        });
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }
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
