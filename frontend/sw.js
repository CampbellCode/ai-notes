// sw.js — caches the app shell so the PWA opens with no network at all.
// Note: we deliberately do NOT cache /api/* calls — those should only ever
// run when actually online (the "Enhance" action).

const CACHE = "ai-notes-v1";
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
  const url = new URL(event.request.url);

  // Never cache API calls — let them hit the network and fail if offline.
  if (url.pathname.startsWith("/api/")) return;

  // App shell: cache-first so it works offline.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
