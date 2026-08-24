/**
 * Hand-rolled service worker.
 *
 * Two different caching strategies, because the app shell and the API have
 * opposite requirements:
 *
 *   - App shell (HTML/JS/CSS): cache-first, so a cold start with no network
 *     still boots the UI. The install step precaches the entry points; the
 *     hashed build assets are picked up lazily on first visit.
 *   - API GETs: network-first with a cache fallback, so an online user always
 *     sees fresh data and an offline user sees the last successful response
 *     instead of an error page.
 *
 * API writes are never cached or replayed here — the IndexedDB queue in
 * src/offline/queue.js owns that, because it needs op ids and per-operation
 * results that a service worker cannot meaningfully reason about.
 */

const VERSION = 'v1';
const SHELL_CACHE = `shell-${VERSION}`;
const API_CACHE = `api-${VERSION}`;

const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, so one 404 during development does not abort the install.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== API_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // A JSON 503 keeps the client on its normal error path; an opaque network
    // failure would surface as a browser error page instead.
    return new Response(
      JSON.stringify({ error: 'offline', detail: String(error) }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && request.method === 'GET') {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Navigations fall back to the cached shell so a deep link like
  // /portfolios/pf_1 still boots offline instead of 404-ing on the SPA route.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r || Response.error())),
    );
    return;
  }

  event.respondWith(cacheFirst(request));
});

// The page asks for a drain when it regains connectivity; Background Sync
// gives the same nudge even if the tab was closed at the time.
self.addEventListener('sync', (event) => {
  if (event.tag === 'flush-queue') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'flush-queue' }));
      }),
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') self.skipWaiting();
});
