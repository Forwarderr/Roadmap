/**
 * sw.js — Roadmap PWA Service Worker
 *
 * Strategy overview:
 *  • App shell (index.html, icons, CDN scripts/fonts) → Cache-first
 *  • GitHub API file list                             → NEVER cached (always live)
 *  • GitHub Raw JSON roadmap files                   → Network-first, fallback to cache
 *  • Everything else                                 → Network-only
 */

const CACHE_VERSION = 'v2';
const SHELL_CACHE   = `rdmap-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `rdmap-runtime-${CACHE_VERSION}`;

const SHELL_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/offline.html',
];

const CDN_ORIGINS = [
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
];

// ─── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
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
        ).then(() => self.clients.claim())
    );
});

// ─── FETCH ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;
    if (url.protocol === 'chrome-extension:') return;

    // 1. GitHub API (file list) — NEVER intercept, always go to network
    //    This ensures new JSON files appear immediately without clearing cache
    if (url.hostname === 'api.github.com') {
        return;
    }

    // 2. GitHub Raw (roadmap JSON content) — network-first, cache for offline
    if (url.hostname === 'raw.githubusercontent.com') {
        event.respondWith(networkFirst(request, RUNTIME_CACHE));
        return;
    }

    // 3. CDN assets — cache-first (they don't change)
    if (CDN_ORIGINS.some(origin => request.url.startsWith(origin))) {
        event.respondWith(cacheFirst(request, RUNTIME_CACHE));
        return;
    }

    // 4. Same-origin app shell — cache-first
    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirst(request, SHELL_CACHE));
        return;
    }

    // 5. Everything else — network only
});

// ─── STRATEGIES ─────────────────────────────────────────────────────────────

async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (_) {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
            return caches.match('/offline.html');
        }
        return new Response('Network error', { status: 503, statusText: 'Service Unavailable' });
    }
}

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
