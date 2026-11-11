// Cache de l'application pour l'ouvrir même sans réseau (les données sont gardées par app.js)
const CACHE = "appli-ensam-v16";
const FICHIERS = ["./", "index.html", "style.css", "app.js", "revision.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Formules (KaTeX) : cache d'abord, pour marcher hors ligne
  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return res; })));
    return;
  }
  if (url.origin !== location.origin || url.pathname.includes("/cal/")) return;
  // Réseau d'abord (mises à jour immédiates), cache si hors ligne
  e.respondWith(
    fetch(e.request).then((r) => { const copie = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copie)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
