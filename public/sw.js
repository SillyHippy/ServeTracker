// ServeTracker PWA Service Worker with Offline Shell Caching
const CACHE_NAME = 'servetracker-v1790807284295';
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/placeholder.svg",
  "/assets/index-BYGIXZwU.css",
  "/assets/ActiveCases-B26_33Gp.js",
  "/assets/Billing-Dmxe9nTc.js",
  "/assets/Dashboard-BJ3K3cuJ.js",
  "/assets/navigation-BQMlDV0Y.js",
  "/assets/History-CZoJhLDK.js",
  "/assets/PrivacyPage-BE5l3U5P.js",
  "/assets/CompleteOnboardingPage-B9ldkNrF.js",
  "/assets/MyProfile-ss850hRc.js",
  "/assets/alert-dialog-xpR6CJ-h.js",
  "/assets/DataExport-D-sU1UQy.js",
  "/assets/chevron-right-sevvQS7v.js",
  "/assets/chevron-left-DAWC-jbq.js",
  "/assets/ActiveCasesPanel-BKI_F2dD.js",
  "/assets/circle-alert-DYK4vsEc.js",
  "/assets/copy-DgdtR8lG.js",
  "/assets/PhotoUploader-DG1-x_YG.js",
  "/assets/user-x-GFruIm-U.js",
  "/assets/Servers-BDMp8E3R.js",
  "/assets/SignatureStatusBadge-C6CL0ddg.js",
  "/assets/dataSwitch-Vd3f8-ZI.js",
  "/assets/phone-BwH4bh8x.js",
  "/assets/DpaPage-DftlQ0C4.js",
  "/assets/MarkPaidDialog-CukKU7wn.js",
  "/assets/checkbox-CFKb1kf1.js",
  "/assets/TermsPage-BbcV7W2_.js",
  "/assets/SignatureEnrollmentDialog-BfQJMQNM.js",
  "/assets/index-B8FfiNBL.js",
  "/assets/ServerProfileDialog-DrrQFdKS.js",
  "/assets/index-Ct8g3zo3.js",
  "/assets/index-C3MOpJmr.js",
  "/assets/index-VL6Smovz.js",
  "/assets/Clients-e0D7XSq3.js",
  "/assets/download-Bro9rOHk.js",
  "/assets/alert-D4dn4rqG.js",
  "/assets/Settings-W3jcjVLx.js",
  "/assets/ServerAssignmentPanel-C8kLl2sh.js",
  "/assets/MemoryMonitor-DkU0pxdA.js",
  "/assets/printer-DciynqGI.js",
  "/assets/dataNormalization-fPsFQwwt.js",
  "/assets/popover-BwOR_YkC.js",
  "/assets/search-CGH8uLv2.js",
  "/assets/gps-qftsZAZS.js",
  "/assets/NewServe-BEecbP1d.js",
  "/assets/select-B4T5tOTK.js",
  "/assets/Migration-BGG1WbxQ.js",
  "/assets/index-DpNzKmeM.js",
  "/assets/NudgeServerDialog-Dhq6qOZT.js"
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
