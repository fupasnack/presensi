/* Presensi FUPA — Service Worker
 * Cache dasar: shell offline + strategi SWR.
 * Hindari cache request dinamis: Firestore, Auth, Cloudinary (upload/delete).
 * Notifikasi via SW (opsional): postMessage({ type: 'show-notification', title, body }).
 */

const VERSION = 'v1.0.0';
const PRECACHE = `precache-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;

const FILES_TO_PRECACHE = [
  './',
  './index.html',
  './karyawan.html',
  './admin.html',
  './manifest.webmanifest'
];

// Best-effort prefetch untuk beberapa sumber umum (tidak memblokir install)
const OPTIONAL_PREFETCH = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=Material+Symbols+Rounded:FILL@1'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      await cache.addAll(FILES_TO_PRECACHE);

      // Prefetch opsional: jangan gagalkan install jika gagal
      const runtime = await caches.open(RUNTIME);
      await Promise.all(
        OPTIONAL_PREFETCH.map(async (url) => {
          try {
            await runtime.add(new Request(url, { mode: 'no-cors' }));
          } catch (_) {}
        })
      );

      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => ![PRECACHE, RUNTIME].includes(k))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isBypassed(url) {
  // Jangan cache request dinamis ke Firebase/Cloudinary
  return (
    url.origin.includes('firestore.googleapis.com') ||
    url.origin.includes('firebaseio.com') ||
    url.origin.includes('identitytoolkit.googleapis.com') ||
    url.origin.includes('securetoken.googleapis.com') ||
    url.origin.includes('api.cloudinary.com')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Non-GET langsung fetch
  if (req.method !== 'GET') return;

  // Bypass domain dinamis
  if (isBypassed(url)) {
    event.respondWith(fetch(req));
    return;
  }

  // Navigasi: network-first, fallback cache, lalu fallback index
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(RUNTIME);
          cache.put(req, res.clone());
          return res;
        } catch (_) {
          const cache = await caches.open(PRECACHE);
          const cached = await cache.match(req);
          return cached || cache.match('./index.html');
        }
      })()
    );
    return;
  }

  // Static: cache-first
  if (url.origin === location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PRECACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        cache.put(req, res.clone());
        return res;
      })()
    );
    return;
  }

  // Cross-origin (fonts, icons): stale-while-revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req)
        .then((res) => {
          cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })()
  );
});

// Notifikasi via SW (dipicu dari halaman dengan postMessage)
self.addEventListener('message', async (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    await self.skipWaiting();
    return;
  }
  if (data.type === 'show-notification') {
    const title = data.title || 'Notifikasi';
    const body = data.body || '';
    const icon = 'https://api.iconify.design/material-symbols/notifications-active-rounded.png?height=128';
    self.registration.showNotification(title, { body, icon });
  }
});

// Interaksi notifikasi
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const url = './index.html';
      const client = allClients.find((c) => c.url.endsWith('index.html') || c.url.endsWith('/'));
      if (client) {
        client.focus();
      } else {
        await clients.openWindow(url);
      }
    })()
  );
});