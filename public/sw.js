// Deliberately caches only the app's public shell assets. Never cache API calls,
// user media, signed URLs, auth responses, or page URLs containing auth tokens.
const CACHE = 'our-nook-shell-v1'
const BASE = new URL('./', self.location.href)
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([new URL('offline.html', BASE).href, new URL('icon-192.png', BASE).href])))
  self.skipWaiting()
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('our-nook-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== BASE.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(new URL('offline.html', BASE).href)))
  }
})
