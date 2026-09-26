// ServeTracker PWA Service Worker with Offline Shell Caching
const CACHE_NAME = 'servetracker-v1790423356098';
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/placeholder.svg",
  "/assets/index-BuBEXJjh.css",
  "/assets/Billing-CLKBL-ud.js",
  "/assets/ActiveCases-1uyjrpvQ.js",
  "/assets/Dashboard-CgAq2Qmt.js",
  "/assets/ActiveCasesPanel-CbNHAXKY.js",
  "/assets/navigation-B94O8cue.js",
  "/assets/NewServe-CTaS9PZC.js",
  "/assets/MarkPaidDialog-BxZbCmcQ.js",
  "/assets/download-CSJBf_lL.js",
  "/assets/ServerAssignmentPanel-1j1INW3j.js",
  "/assets/ServerProfileDialog-mtmg7atw.js",
  "/assets/popover-BnbN6-b8.js",
  "/assets/chevron-left-DUgzgOhT.js",
  "/assets/MemoryMonitor-CdDA8DmV.js",
  "/assets/chevron-right-BRwOEan3.js",
  "/assets/History-gXmAp0mz.js",
  "/assets/alert-CBpyN56y.js",
  "/assets/gps-qftsZAZS.js",
  "/assets/search-Ck871ieW.js",
  "/assets/circle-alert-BSYVGlwi.js",
  "/assets/dataSwitch-CEDqCFWh.js",
  "/assets/Migration-CzyAtre9.js",
  "/assets/PhotoUploader-BH3Rzcr_.js",
  "/assets/select-92lp1CCD.js",
  "/assets/Clients-BknCV8VD.js",
  "/assets/SignatureStatusBadge-DyO4eAOo.js",
  "/assets/CompleteOnboardingPage-1yWWfNl2.js",
  "/assets/phone-CC9W-hha.js",
  "/assets/PrivacyPage-Cz3BkUmL.js",
  "/assets/TermsPage-CXZtek4Y.js",
  "/assets/MyProfile-CYWnT1GJ.js",
  "/assets/printer-Fr9c9GU0.js",
  "/assets/DpaPage-BLzrWQm2.js",
  "/assets/copy-DtXnIe5K.js",
  "/assets/SignatureEnrollmentDialog-BQu98UyF.js",
  "/assets/index-D8sXkM2h.js",
  "/assets/dataNormalization-FYCV1Y5L.js",
  "/assets/index-H36UwkWW.js",
  "/assets/Settings-C2yH3dtH.js",
  "/assets/Servers-Ddpyko2g.js",
  "/assets/alert-dialog-Ci7ghhf-.js",
  "/assets/index-DeuyLuxn.js",
  "/assets/checkbox-DLhW01nJ.js",
  "/assets/user-x-Dqs5UXBz.js",
  "/assets/DataExport-BzwcW8BN.js",
  "/assets/index-BibVHLsB.js",
  "/assets/index-Dv0iin58.js",
  "/assets/NudgeServerDialog-BwQ4g04N.js"
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
