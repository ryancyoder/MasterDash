// Service worker for the Quick Estimator.
//
// Offline is a defining requirement, not a nicety: many of the properties Ryan
// quotes on have no usable coverage, and an estimator that needs a round-trip
// before the first tile lights up is not usable there.
//
// Strategy is deliberately plain. The app is a static export, so everything it
// needs is cacheable: navigations try the network first and fall back to cache
// so a deploy is picked up promptly, and assets — including the 962-row plant
// list — are served cache-first because they only change when the catalog is
// re-synced.

const CACHE = "qe-cache-v1";

// Relative, so they resolve against the worker's own scope. The app is served
// from /MasterDash/ on GitHub Pages and from / in dev.
const PRECACHE = [
  "./",
  "./estimator",
  "./estimator/proposal",
  "./catalog/plants.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually, so one 404 cannot fail the whole install and leave the
      // app with no worker at all.
      await Promise.all(
        PRECACHE.map((url) => cache.add(url).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never touch Supabase or any other origin: estimate writes have their own
  // queue, and caching an API response would just hide staleness.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          return (
            (await caches.match(request)) ??
            (await caches.match("./estimator")) ??
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const hit = await caches.match(request);
      if (hit) return hit;
      try {
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch {
        return Response.error();
      }
    })(),
  );
});
