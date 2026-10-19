/* Splice & Co. service worker: lets the app open without internet.
   The page itself is network-first (so updates show up right away), falling back to the last copy when offline
   or when the network takes more than 1.5s;
   icons and the supabase-js library are cache-first. /api and Supabase calls are never cached:
   the page keeps its own data snapshot and outbox for offline use. */
const CACHE = 'splice-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all([
    c.addAll(SHELL).catch(() => {}),
    c.add(new Request(LIB, { mode: 'cors' })).catch(() => {})   // the sign-in/data library, so the app starts offline
  ])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;

  if (same && url.pathname.startsWith('/api/')) return;           // live data only
  if (req.mode === 'navigate' || (same && (url.pathname === '/' || url.pathname === '/index.html'))) {
    // Network first so updates show right away, but on a slow connection don't wait more than 1.5s:
    // the saved copy opens instead and the download still finishes into the cache for next time.
    const net = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)); }
      return res;
    });
    const saved = () => caches.match('/').then(r => r || caches.match(req));
    e.waitUntil(net.catch(() => {}));
    e.respondWith(new Promise(done => {
      let settled = false;
      const t = setTimeout(() => saved().then(r => { if (r && !settled) { settled = true; done(r); } }), 1500);
      net.then(res => { if (!settled) { settled = true; clearTimeout(t); done(res); } })
         .catch(() => saved().then(r => { if (!settled) { settled = true; clearTimeout(t); done(r || Response.error()); } }));
    }));
    return;
  }
  const lib = url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (same || lib) {
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    }));
  }
});
