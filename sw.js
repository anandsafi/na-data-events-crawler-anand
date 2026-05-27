/* The Data Dispatch — service worker
 * Strategy:
 *  - Pre-cache shell on install
 *  - Cache-first for shell assets; network-first (with cache fallback) for events.json
 *  - Periodic Background Sync (Chromium/Android): pulls events.json daily and fires a
 *    local notification if there are new events vs. what's stored.
 *  - On iOS (no Periodic Sync): a fresh check runs every time the PWA is opened,
 *    and a notification fires inline if new content is found.
 */

const CACHE = 'data-dispatch-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png',
  './events.json'
];

// ---------- install ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// ---------- activate ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ---------- fetch ----------
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // Network-first for events.json so we always see fresh data when online
  if (url.pathname.endsWith('/events.json')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for the rest of the shell
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ---------- periodic background sync (Chromium / Android) ----------
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'daily-briefing-check') {
    event.waitUntil(checkForNewEvents({ source: 'periodicsync' }));
  }
});

// ---------- background sync (fallback when one-shot sync is registered) ----------
self.addEventListener('sync', (event) => {
  if (event.tag === 'briefing-check') {
    event.waitUntil(checkForNewEvents({ source: 'sync' }));
  }
});

// ---------- push events (future-ready; works if a server is added later) ----------
self.addEventListener('push', (event) => {
  let data = { title: 'The Data Dispatch', body: 'New events available — tap to read.' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      data: { url: data.url || './index.html' },
      tag: 'data-dispatch',
      renotify: true
    })
  );
});

// ---------- notification click ----------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.navigate(url); return w.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// ---------- message bridge (page → SW for on-open checks) ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CHECK_NOW') {
    event.waitUntil(checkForNewEvents({ source: 'page' }));
  }
});

// ---------- core: compare events.json against seen-set, notify on delta ----------
async function checkForNewEvents({ source }) {
  try {
    const res = await fetch('./events.json', { cache: 'no-store' });
    if (!res.ok) return;
    const fresh = await res.json();
    const freshEvents = fresh.events || [];

    const cache = await caches.open(CACHE);

    // Load seen-ids
    const seenRes = await cache.match('seen-ids');
    const seen = seenRes ? new Set(await seenRes.json()) : new Set();

    // Load last-watermark (highest discovered_at we've ever observed)
    const wmRes = await cache.match('seen-watermark');
    const lastWatermark = wmRes ? Number(await wmRes.text()) : 0;

    // "New" if either id never seen OR discovered_at exceeds our watermark
    const newOnes = freshEvents.filter((e) => {
      if (!seen.has(e.id)) return true;
      if (e.discovered_at && Date.parse(e.discovered_at) > lastWatermark) return true;
      return false;
    });

    // Update seen-ids and watermark
    const mergedIds = new Set([...seen, ...freshEvents.map((e) => e.id)]);
    const maxWatermark = freshEvents.reduce((m, e) => {
      const t = e.discovered_at ? Date.parse(e.discovered_at) : 0;
      return t > m ? t : m;
    }, lastWatermark);

    await cache.put(
      'seen-ids',
      new Response(JSON.stringify([...mergedIds]), { headers: { 'Content-Type': 'application/json' } })
    );
    await cache.put(
      'seen-watermark',
      new Response(String(maxWatermark), { headers: { 'Content-Type': 'text/plain' } })
    );

    if (newOnes.length === 0) return;

    const names = newOnes.slice(0, 3).map((e) => e.name);
    const body =
      newOnes.length === 1
        ? names[0]
        : `${names.join(' · ')}${newOnes.length > 3 ? ` +${newOnes.length - 3} more` : ''}`;

    await self.registration.showNotification(
      `Data Dispatch — ${newOnes.length} new`,
      {
        body,
        icon: './icon-192.png',
        badge: './icon-192.png',
        data: { url: './index.html' },
        tag: 'data-dispatch-daily',
        renotify: true,
        requireInteraction: false
      }
    );
  } catch (e) {
    // silent — next sync will retry
  }
}
