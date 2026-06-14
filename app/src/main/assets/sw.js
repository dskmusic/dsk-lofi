/* =============================================================================
   DSK•LoFi — sw.js
   Offline-first service worker. Everything is local; this just makes the PWA
   installable and fully usable with no network at all.
   Bump CACHE_VERSION when shipping updates.
   ========================================================================== */
const CACHE_VERSION = "dsklofi-v12";

const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/tokens.css",
  "./css/app.css",
  "./css/library.css",
  "./js/i18n.js",
  "./js/bridge.js",
  "./js/encoder.js",
  "./js/engine.js",
  "./js/ui.js",
  "./js/app.js",
  "./js/library.js",
  "./js/lofi-worklet.js",
  "./libs/lame.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      // tolerante: si un archivo falta/404, NO rompe el resto del precache
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const req = e.request;

  // Documento HTML (navegación): network-first → la página siempre se actualiza,
  // con el cache como respaldo cuando no hay red. Evita quedarse con un index.html
  // viejo mezclado con assets nuevos.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok && new URL(req.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html"))
      )
    );
    return;
  }

  // Resto de recursos: cache-first.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && new URL(req.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});