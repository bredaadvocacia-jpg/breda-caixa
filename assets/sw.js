/* Service Worker — Caixa Breda v15 (filtro de período no modal de relatório) */
const CACHE = "caixa-breda-v15";
const ASSETS = [
  "./",
  "./index.html",
  "./app.html",
  "./assets/style.css",
  "./assets/app.js",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  if (url.hostname.includes("script.google.com")) return;
  if (ev.request.method !== "GET") return;

  // Network-first para HTML e JS principais — garante que mudanças apareçam rápido.
  const isShell = ev.request.mode === "navigate"
    || url.pathname.endsWith(".html")
    || url.pathname.endsWith("/app.js")
    || url.pathname.endsWith("/style.css");

  if (isShell) {
    ev.respondWith(
      fetch(ev.request)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(ev.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(ev.request))
    );
    return;
  }

  // Demais assets: cache-first
  ev.respondWith(
    caches.match(ev.request).then((cached) => {
      if (cached) return cached;
      return fetch(ev.request)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(ev.request, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
