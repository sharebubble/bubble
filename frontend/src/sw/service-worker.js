/**
 * Bubble's service worker.
 *
 * Written as plain JS on purpose: this file runs in the ServiceWorkerGlobalScope,
 * not in the app bundle, so it is neither imported nor type-checked with the DOM
 * lib. The `pwa-service-worker` Vite plugin (frontend/vite.config.ts) substitutes
 * the two build-time tokens below and emits the result as `dist/sw.js`; the dev
 * server serves a self-unregistering stub instead, so this code only ever runs
 * against a real production build.
 *
 * Caching rules, in order of precedence:
 *
 *   1. Anything dynamic or user-scoped is never touched — API, auth, admin,
 *      caldav, Django statics, the Sentry tunnel, /env-config.js and
 *      /version.json all go straight to the network. Stale API responses are far
 *      worse than a slow one, and /version.json backs the release gate.
 *   2. Navigations are network-first and fall back to the cached app shell, so a
 *      new deploy is picked up on the next load instead of being pinned by the
 *      cache (the previous worker cache-firsted "/", which served an index.html
 *      pointing at hashed bundles that no longer existed).
 *   3. Hashed build output under /assets/ is immutable, so it is cache-first.
 *   4. Uploaded images under /media/ are stale-while-revalidate in a bounded
 *      cache, which is what makes browsing offline useful at all. (Deployments
 *      that serve media from S3 with a custom domain hand out cross-origin URLs
 *      instead; those are left to the browser like any other third-party asset.)
 */

// Replaced at build time — do not rename without updating vite.config.ts.
const BUILD_ID = '__BUILD_ID__';
const PRECACHE_URLS = __PRECACHE_URLS__;

// The shell cache is per build: a new deploy gets a new one and the old one is
// dropped on activate. The asset and media caches are keyed by content-hashed or
// immutable URLs, so they survive deploys and are bounded by entry count instead.
const SHELL_CACHE = `bubble-shell-${BUILD_ID}`;
const ASSET_CACHE = 'bubble-assets-v1';
const MEDIA_CACHE = 'bubble-media-v1';
const CACHE_PREFIX = 'bubble-';

const ASSET_CACHE_LIMIT = 160;
const MEDIA_CACHE_LIMIT = 80;

const SHELL_URL = '/index.html';
const OFFLINE_URL = '/offline.html';

// Never intercepted: dynamic, authenticated or deliberately uncached responses.
const BYPASS_PREFIXES = [
  '/api/',
  '/accounts/',
  '/admin/',
  '/caldav/',
  '/static/',
  '/sentry-tunnel/',
];
const BYPASS_PATHS = ['/env-config.js', '/version.json', '/healthz', '/sw.js'];

// Immutable because the filename carries a content hash (Vite) or a pinned
// library version (the zxing WASM emitted by the zxing-wasm plugin).
const IMMUTABLE_PREFIXES = ['/assets/', '/lib/wasm/'];

const isBypassed = url =>
  BYPASS_PATHS.includes(url.pathname) ||
  BYPASS_PREFIXES.some(prefix => url.pathname.startsWith(prefix));

const isImmutable = url => IMMUTABLE_PREFIXES.some(prefix => url.pathname.startsWith(prefix));

/** Only same-origin, non-opaque success responses are worth storing. */
const isCacheable = response => response && response.ok && response.type === 'basic';

/**
 * Trim a cache to `limit` entries, evicting insertion-order-oldest first.
 * The Cache API preserves insertion order, so this is FIFO rather than true LRU —
 * good enough to keep a long-lived image cache off the user's storage quota.
 */
async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map(key => cache.delete(key)));
}

/**
 * Warm the shell cache. Deliberately per-URL and fault-tolerant: `cache.addAll`
 * is atomic, so a single 404 rejects the whole install and the worker never
 * activates — exactly how the previous worker managed to be dead on arrival.
 */
async function precache() {
  const cache = await caches.open(SHELL_CACHE);
  const results = await Promise.allSettled(
    PRECACHE_URLS.map(async url => {
      // `cache: 'reload'` keeps a stale HTTP-cached copy out of the shell.
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) throw new Error(`${url} responded ${response.status}`);
      await cache.put(url, response);
    }),
  );

  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length > 0) {
    console.warn(
      `[sw] precache incomplete (${failed.length}/${PRECACHE_URLS.length} failed):`,
      failed.map(result => String(result.reason)).join(', '),
    );
  }
}

/** Network-first, falling back to the cached shell and finally the offline page. */
async function handleNavigation(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const shell = await cache.match(SHELL_URL);
    if (shell) return shell;
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return Response.error();
  }
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    await cache.put(request, response.clone());
    await trimCache(cacheName, limit);
  }
  return response;
}

async function staleWhileRevalidate(event, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);

  const revalidate = fetch(event.request)
    .then(async response => {
      if (isCacheable(response)) {
        await cache.put(event.request, response.clone());
        await trimCache(cacheName, limit);
      }
      return response;
    })
    // Offline with nothing cached: let the caller surface the network error.
    .catch(error => {
      if (cached) return cached;
      throw error;
    });

  if (cached) {
    event.waitUntil(revalidate.catch(() => {}));
    return cached;
  }
  return revalidate;
}

self.addEventListener('install', event => {
  // No implicit skipWaiting: swapping the shell out from under a running tab can
  // break in-flight lazy chunks. The app asks for the swap once the user accepts
  // the update prompt (see src/lib/serviceWorker.ts).
  event.waitUntil(precache());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Lets the browser start the navigation request before the worker boots.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }

      const keep = new Set([SHELL_CACHE, ASSET_CACHE, MEDIA_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(name => name.startsWith(CACHE_PREFIX) && !keep.has(name))
          .map(name => caches.delete(name)),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // Mutations, cross-origin traffic and range requests are left entirely alone.
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (isBypassed(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE, ASSET_CACHE_LIMIT));
    return;
  }

  if (url.pathname.startsWith('/media/')) {
    event.respondWith(staleWhileRevalidate(event, MEDIA_CACHE, MEDIA_CACHE_LIMIT));
    return;
  }

  // Everything else same-origin: icons, the manifest, the offline page.
  event.respondWith(staleWhileRevalidate(event, SHELL_CACHE, ASSET_CACHE_LIMIT));
});

self.addEventListener('message', event => {
  const type = event.data && event.data.type;

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // Sign-out: uploaded images may belong to a community the next user of this
  // device cannot see, so drop them. Build output carries nothing user-scoped.
  if (type === 'CLEAR_MEDIA_CACHE') {
    event.waitUntil(caches.delete(MEDIA_CACHE));
  }
});
