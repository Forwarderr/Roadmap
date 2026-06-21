/**
 * sw.js — Roadmap PWA Service Worker
 *
 * Strategy overview:
 *  • App shell (index.html, icons, CDN scripts/fonts) → Cache-first
 *  • GitHub API file list                             → Network-first, fallback to cache
 *  • GitHub Raw JSON roadmap files                   → Network-first, fallback to cache
 *  • Everything else                                 → Network-only
 *
 * Cache names are versioned. Bumping CACHE_VERSION causes the old
 * cache to be deleted on the next SW activation.
 */

const CACHE_VERSION   = 'v1';
const SHELL_CACHE     = `rdmap-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE   = `rdmap-runtime-${CACHE_VERSION}`;

// Files to pre-cache when the SW installs (the "app shell")
const SHELL_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    // Offline fallback page (simple HTML shown when network AND cache both fail)
    '/offline.html',
];

// External CDN assets we also want cached after first load
const CDN_ORIGINS = [
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
];

// GitHub origins we handle with network-first
const GITHUB_ORIGINS = [
    'https://api.github.com',
    'https://raw.githubusercontent.com',
];

// ─── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())   // Activate new SW immediately
    );
});

// ─── ACTIVATE ───────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())    // Take control of open tabs immediately
    );
});

// ─── FETCH ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET and browser extension requests
    if (request.method !== 'GET') return;
    if (url.protocol === 'chrome-extension:') return;

    // 1. GitHub API & Raw — network-first, cache fallback
    if (GITHUB_ORIGINS.some(origin => request.url.startsWith(origin))) {
        event.respondWith(networkFirst(request, RUNTIME_CACHE));
        return;
    }

    // 2. CDN assets — cache-first, then network (they rarely change)
    if (CDN_ORIGINS.some(origin => request.url.startsWith(origin))) {
        event.respondWith(cacheFirst(request, RUNTIME_CACHE));
        return;
    }

    // 3. Same-origin app shell — cache-first
    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirst(request, SHELL_CACHE));
        return;
    }

    // 4. All other requests — network only (don't cache unknown origins)
});

// ─── STRATEGIES ─────────────────────────────────────────────────────────────

/**
 * Network-first: try the network; if it fails, serve from cache.
 * On a successful network response, update the cache.
 */
async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const networkResponse = await fetch(request);
        // Only cache valid responses
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (_) {
        const cached = await cache.match(request);
        if (cached) return cached;
        // If it's a navigation, show offline page
        if (request.mode === 'navigate') {
            return caches.match('/offline.html');
        }
        return new Response('Network error', { status: 503, statusText: 'Service Unavailable' });
    }
}

/**
 * Cache-first: serve from cache immediately if available.
 * If not cached, fetch from network and store in cache.
 */
async function cacheFirst(request, cacheName) {
    const cache  = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (_) {
        if (request.mode === 'navigate') {
            return caches.match('/offline.html');
        }
        return new Response('Not available offline', { status: 503 });
    }
}

// ─── BACKGROUND SYNC (future-proof hook) ────────────────────────────────────
// Uncomment if you add write-back features later
// self.addEventListener('sync', (event) => {
//     if (event.tag === 'sync-progress') {
//         event.waitUntil(syncProgress());
//     }
// });

// ─── PUSH NOTIFICATIONS (future-proof hook) ─────────────────────────────────
// self.addEventListener('push', (event) => { ... });
