// sw.js — caches the app shell so the PWA opens with no network at all.

const CACHE = "ai-notes-v6";
const SHELL = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // App shell: cache-first so it works offline.
  // External API calls (Anthropic) go to a different origin — sw never intercepts them.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
