// Only the static application shell is cached. Never cache OAuth, user sessions or gateway data.
const PREFIX = 'mistake-notebook-mobile-';
const VERSION = 'shell-v1';
self.addEventListener('install', event => event.waitUntil((async () => {
  const response = await fetch('/pwa-assets.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Asset manifest unavailable');
  const assets = await response.json();
  if (!Array.isArray(assets) || !assets.every(path => typeof path === 'string' && path.startsWith('/assets/') && !path.includes('..'))) throw new Error('Invalid asset manifest');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(assets)))), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
  const cache = await caches.open(`${PREFIX}${VERSION}-${digest}`);
  await cache.addAll(['/', '/manifest.webmanifest', '/app-icon.png', ...assets]);
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const ours = (await caches.keys()).filter(name => name.startsWith(PREFIX));
  await Promise.all(ours.slice(0, -1).map(name => caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/v1/') || url.search || url.hash) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match('/')) || Response.error()));
  } else if (url.pathname.startsWith('/assets/') || ['/manifest.webmanifest', '/app-icon.png'].includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
});
