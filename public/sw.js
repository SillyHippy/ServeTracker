// ServeTracker PWA Service Worker with Offline Shell Caching
const CACHE_NAME = 'servetracker-v1791890497743';
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/placeholder.svg",
  "/assets/Billing-B-aG1xMx.js",
  "/assets/ActiveCasesPanel-C2siwr9V.js",
  "/assets/caseFilters-CcSaCDXQ.js",
  "/assets/alert-DlEBFEPl.js",
  "/assets/Dashboard-C4UR4eMo.js",
  "/assets/MemoryMonitor-D9nda3rM.js",
  "/assets/download-bBPSfyov.js",
  "/assets/PhotoUploader-AfI9J6KP.js",
  "/assets/navigation-BLDmd_8T.js",
  "/assets/ActiveCases-CjujXoTp.js",
  "/assets/Migration-Ennd8bE6.js",
  "/assets/SignatureEnrollmentDialog-DDhCes3L.js",
  "/assets/checkbox-WSwSTZDU.js",
  "/assets/copy-C3aMW9zF.js",
  "/assets/TermsPage-Cah1Kxtc.js",
  "/assets/MyProfile-D5jGNM9O.js",
  "/assets/phone-gbtuWQsP.js",
  "/assets/Settings-D24iNL5P.js",
  "/assets/SignatureStatusBadge-BXN_7fv3.js",
  "/assets/index-BuQkEjBF.css",
  "/assets/index-ApyFN6tm.js",
  "/assets/index-BGUS1Lsh.js",
  "/assets/search-BRA1eSio.js",
  "/assets/NewServe-DwcPtmBM.js",
  "/assets/gps-qftsZAZS.js",
  "/assets/popover-ZsMpDwxV.js",
  "/assets/chevron-left-9pWY8JIx.js",
  "/assets/Servers-CMIXfsXF.js",
  "/assets/index-DDmbXliv.js",
  "/assets/dataSwitch-D-jmcLR1.js",
  "/assets/PrivacyPage-BZ28HgPD.js",
  "/assets/DpaPage-DNEVYsD6.js",
  "/assets/History-DyVzdTEm.js",
  "/assets/printer-CZX8gotL.js",
  "/assets/ServerProfileDialog-DlwQo0mT.js",
  "/assets/circle-alert-JbVfbZb-.js",
  "/assets/dataNormalization-BBncGmnV.js",
  "/assets/alert-dialog-CSSsCdP8.js",
  "/assets/chevron-right-cujb7Xpz.js",
  "/assets/ServerAssignmentPanel-BudHRfb3.js",
  "/assets/DataExport-vdrgI251.js",
  "/assets/select-DfWxDv2d.js",
  "/assets/user-x-VU-FtZsi.js",
  "/assets/index-CsCjAF52.js",
  "/assets/CompleteOnboardingPage-BlNW5wf9.js",
  "/assets/index-CbJIZ6HU.js",
  "/assets/NudgeServerDialog-CufPv8mI.js",
  "/assets/Clients-BqaIXLMX.js"
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
