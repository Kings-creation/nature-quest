// Nature Quest service worker. Bump VERSION when shell files change: the new worker installs,
// waits, and the app offers a reload (it never swaps code under a running quest).
const VERSION = "nq-shell-v8";
const VENDOR = "nq-vendor-v1";
const SHELL = ["./", "index.html", "manifest.webmanifest", "css/app.css", "js/app.js", "js/auth.js", "js/config.js", "js/errors.js", "js/store.js", "js/quest/model.js", "js/quest/safety.js", "js/quest/fallback.js", "js/quest/engine.js", "js/quest/loop.js", "js/quest/verify.js", "js/quest/achievements.js", "js/sync.js", "js/claim.js", "js/ai/worker.js", "js/ai/engine.js", "js/ai/prompt.js", "js/ai/pantry.js", "js/ai/matcher.js", "js/ai/providers/embed.js", "js/ai/providers/browser.js", "js/ai/providers/endpoint.js",
  "assets/topo.svg", "assets/icon-192.png", "assets/icon-512.png", "assets/icon-maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))));
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== VENDOR) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("message", e => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });

async function staleWhileRevalidate(req, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true }) || (fallbackKey && await cache.match(fallbackKey));
  const net = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; }).catch(() => null);
  if (hit) { net.catch(() => {}); return hit; }
  const res = await net;
  return res || (fallbackKey && await cache.match(fallbackKey)) || new Response("Offline", { status: 503, statusText: "Offline" });
}

self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(staleWhileRevalidate(req, VERSION, req.mode === "navigate" ? "index.html" : null));
  } else if ((url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) || (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/@huggingface/"))) {
    e.respondWith(staleWhileRevalidate(req, VENDOR));
  } // everything else (auth endpoints, Firestore) goes straight to the network, never cached
});
