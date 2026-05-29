/* ============================================================
   AURA Service Worker  —  aura-pwa/sw.js
   Cache-first offline strategy.
   Background sync stub → wire to cr-sqlite CRDT push.
   Push notification stub → wire to LightGBM health alerts.
   ============================================================ */

const CACHE_VERSION = 'aura-v1';
const STATIC_ASSETS = ['/', '/index.html', '/icon.svg', '/manifest.json'];

// ─── Install: pre-cache static shell ───────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing AURA service worker');
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache =>
      cache.addAll(STATIC_ASSETS).catch(err =>
        console.warn('[SW] Pre-cache partial failure (fonts may skip):', err)
      )
    )
  );
  self.skipWaiting();
});

// ─── Activate: purge stale caches ──────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating, cleaning old caches');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch: cache-first; skip /api/* (always network) ──────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // 🔌 PLUG: /api/* calls bypass cache → always hit your backend
  if (new URL(event.request.url).pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline', code: 503 }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Navigation fallback → serve app shell
        if (event.request.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});

// ─── Background Sync: CRDT push to Poshan Tracker ──────────
// Fires automatically when connectivity is restored after
// navigator.serviceWorker.ready.then(sw => sw.sync.register('aura-poshan-sync'))
self.addEventListener('sync', (event) => {
  if (event.tag === 'aura-poshan-sync') {
    console.log('[SW] Background sync: aura-poshan-sync fired');
    event.waitUntil(runPoshanSync());
  }
  if (event.tag === 'aura-pdf-gen') {
    event.waitUntil(runPDFGeneration());
  }
});

async function runPoshanSync() {
  // 🔌 PLUG: replace this stub with actual CRDT sync logic
  // Steps:
  //   1. Open cr-sqlite and pull all rows with sync_status = 'pending'
  //   2. POST changesets to your Poshan Tracker sync endpoint
  //   3. On 200, mark rows as sync_status = 'synced'
  //   4. Notify all open clients with { type: 'SYNC_COMPLETE', count }
  console.log('[SW] 🔌 runPoshanSync — replace with cr-sqlite CRDT push');
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'SYNC_STATUS', status: 'stub', synced: 0 }));
}

async function runPDFGeneration() {
  // 🔌 PLUG: generate PDF register copies after audit commit
  // Use jsPDF or a server-side endpoint; store in OPFS or send to worker
  console.log('[SW] 🔌 runPDFGeneration — replace with PDF gen logic');
}

// ─── Push Notifications: malnutrition early-warning alerts ─
// 🔌 PLUG: your LightGBM backend sends a push payload like:
//   { title: "AURA Alert", body: "Meera flagged: risk in 6 weeks", screen: "health", childId: "CLD_042" }
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const options = {
    body: data.body ?? 'A child needs attention today.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: 'aura-health-alert',
    vibrate: [200, 100, 200],
    data: { screen: data.screen ?? 'triage', childId: data.childId ?? null }
  };
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'AURA', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = `/?screen=${event.notification.data?.screen ?? 'shell'}`;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
      const existing = ws.find(w => w.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.postMessage({ type: 'NAV', screen: event.notification.data?.screen }); }
      else clients.openWindow(target);
    })
  );
});

// ─── Message from main thread ──────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'TRIGGER_SYNC') {
    self.registration.sync?.register('aura-poshan-sync').catch(console.warn);
  }
});
