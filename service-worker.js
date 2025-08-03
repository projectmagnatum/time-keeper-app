const CACHE_NAME = "time-keeper-cache-v5";   // Bumped version
const ASSETS = [
  "index.html",
  "styles.css",
  "script.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  // any backgrounds, fonts, etc.
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())  // This allows the new SW to activate immediately
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      // Clear old caches
      caches.keys().then(keys => 
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      ),
      // Tell clients about the update
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'UPDATE_AVAILABLE' }));
      }),
      // Take control of all clients
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        const networked = fetch(event.request)
          .then(response => {
            const cacheCopy = response.clone();
            caches.open(CACHE_NAME).then(cache => 
              cache.put(event.request, cacheCopy)
            );
            return response;
          })
          .catch(() => cached);
          
        return cached || networked;
      })
  );
});
