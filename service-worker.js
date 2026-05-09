const CACHE = "ia-v41";
const FILES = ["./","./index.html","./style.css","./app.js","./firebase-config.js","./manifest.json","./icons/icon-192.png","./icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => { if (e.request.method !== "GET") return; e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return res; }).catch(() => caches.match("./index.html")))); });
