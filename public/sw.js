/**
 * PixelForge Studio — service worker (plain JS, no build step).
 *
 * Strategy:
 *  - install:  precache the app shell (individual failures are tolerated)
 *  - activate: drop old cache versions, take control of open clients
 *  - fetch:    non-GET and anything containing '/api' is ignored;
 *              navigations are network-first with cached '/' fallback;
 *              same-origin assets use stale-while-revalidate;
 *              cross-origin responses are never cached (opaque bodies).
 */

const CACHE_VERSION = 'pixelforge-v1';
const PRECACHE_URLS = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // tolerate individual failures (e.g. offline dev server)
      await Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // never intercept API routes (or anything that looks like one)
  if (url.pathname.includes('/api') || url.href.includes('/api')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(handleStatic(request));
  }
  // cross-origin: bypass the worker entirely — opaque responses are never cached.
});

/** Network-first for navigations; falls back to the cached app shell ('/'). */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      cache.put(request, fresh.clone()).catch(() => undefined);
    }
    return fresh;
  } catch {
    const shell = (await cache.match('/')) || (await cache.match(request));
    if (shell) return shell;
    return new Response('PixelForge Studio is offline and this page was not cached.', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/** Stale-while-revalidate for same-origin static assets. */
async function handleStatic(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  // revalidate in the background; failures are swallowed — cache stays valid
  const refresh = fetch(request)
    .then((fresh) => {
      // only cache fully-readable same-origin successes (never opaque)
      if (fresh && fresh.ok && fresh.type === 'basic') {
        cache.put(request, fresh.clone()).catch(() => undefined);
      }
      return fresh;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const fresh = await refresh;
  if (fresh) return fresh;
  return new Response('Not cached and network unavailable.', {
    status: 504,
    statusText: 'Gateway Timeout',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
