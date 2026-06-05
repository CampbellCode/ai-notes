// sw.js — caches the app shell so the PWA opens with no network at all.
//
// !! IMPORTANT — KEEP THIS LIST IN SYNC !!
// Every static file served by the app must be listed in SHELL below.
// If you add a new .js, .css, or other asset and forget to add it here,
// the app will load the new file from the network on first visit but will
// silently fall back to a stale cached version (or fail entirely) on
// subsequent offline visits.
//
// Current shell files:
//   ./             (index.html served at root)
//   ./index.html
//   ./styles.css
//   ./app.js
//   ./manifest.json
//
// After editing: bump the CACHE version string (e.g. v15 → v16) so the
// service worker reinstalls and users get the updated shell.

const CACHE = "ai-notes-v16";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
];

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
