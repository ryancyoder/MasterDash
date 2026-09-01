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

const CACHE = "qe-cache-v2";

/**
 * Supabase's public object route. Matched by path rather than by host, so a
 * custom domain or a CDN in front of storage still gets cached — the host is
 * incidental, the path is what identifies a public catalog image.
 */
const PHOTO_PATH = "/storage/v1/object/public/";

// Relative, so they resolve against the worker's own scope whatever subpath
// the app is served from.
const PRECACHE = ["./", "./proposal", "./catalog/plants.json"];

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

  // Catalog photos are the one cross-origin thing worth keeping. They are
  // immutable — every upload writes a new timestamped path — so cache-first is
  // safe, and it is what makes a photographed tile survive a dead zone.
  //
  // AN OPAQUE ENTRY IS NOT A HIT FOR EVERYONE, and this comment used to say it
  // was: the response an <img> gets is opaque, which "is fine, it is only ever
  // handed back to another <img>". That stopped being true the moment
  // something read a photograph's BYTES — dragging one onto Add plan fetches
  // it to make a layer — and the failure is not a blank picture, it is the
  // browser refusing the response outright with
  //
  //     TypeError: Response served by service worker is opaque
  //
  // which the caller can do nothing about and which only happens once the
  // picture has been looked at, so it never shows up until the field.
  //
  // The cache is keyed by URL and knows nothing about mode, so the check has
  // to be here: an opaque body can only go back to a request that asked
  // no-cors. Anything else goes to the network, and what comes back is
  // READABLE — which serves an <img> perfectly well too, so the entry it
  // replaces is strictly better than the one it had.
  if (url.pathname.includes(PHOTO_PATH)) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(request);
        if (hit && (request.mode === "no-cors" || hit.type !== "opaque")) return hit;
        try {
          const fresh = await fetch(request);
          // Only keep something worth keeping. An <img> is a no-cors request,
          // so a real success comes back opaque with ok === false and status
          // 0 — that one is fine. A readable non-ok response is a genuine 404
          // or 500, and caching it would blank the tile permanently, since
          // nothing would ever go back to the network for it again.
          if (fresh.ok || fresh.type === "opaque") {
            const cache = await caches.open(CACHE);
            cache.put(request, fresh.clone());
          }
          return fresh;
        } catch {
          // Offline with only an opaque copy of a picture somebody is trying
          // to read: there is nothing to hand back, and Response.error() is a
          // failure the caller already knows how to report. Handing over the
          // opaque one instead would raise the same TypeError, and the message
          // would be about service workers rather than about the network.
          return Response.error();
        }
      })(),
    );
    return;
  }

  // Every other origin is left alone: estimate and photo writes have their own
  // queues, and caching an API response would just hide staleness.
  if (url.origin !== self.location.origin) return;

  // The app's own API is live data — catalog photography that changes when
  // someone adds a picture anywhere. Cache-first here would pin the first
  // answer forever and quietly undo the whole point of reading it live. The
  // callers already handle a failed request, so offline needs nothing here.
  if (url.pathname.startsWith("/api/")) return;

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
            (await caches.match("./")) ??
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
