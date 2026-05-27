/* Service Worker — Caixa Breda Advocacia
   Estratégia: network-first para APIs, cache-first para assets estáticos */
const CACHE = "caixa-breda-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./escritorio.html",
  "./clientes.html",
  "./assets/style.css",
  "./assets/app.js",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  // Apps Script API → sempre rede (com fallback nulo, app já usa localStorage)
  if (url.hostname.includes("script.google.com")) return;
  // Demais GETs do mesmo origin → cache-first
  if (ev.request.method !== "GET") return;
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
