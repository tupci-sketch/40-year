/* ============================================================
   The 40Yr Virgil — service worker
   ------------------------------------------------------------
   App-shell cache-first for our own static files (instant loads,
   offline identity/squad/tactics/the Book). The backend (Cloudflare
   Worker API) is NEVER cached: every /api request goes straight to
   the network so the archive is always live. Bump CACHE to ship a
   new shell (also evicts any stale v1/Apps-Script-era cache).
   ============================================================ */
var CACHE = "v40-shell-v4";
var SHELL = [
  "./",
  "./index.html",
  "./css/styles.css?v=5",
  "./js/config.js",
  "./js/ui.js",
  "./js/data.js",
  "./js/api.js",
  "./js/tactics.js",
  "./js/admin.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./assets/img/crest.png",
  "./apple-touch-icon.png",
  "./favicon.ico"
];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // Add individually so one missing asset can't fail the whole install.
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // Never cache the backend (a different origin — the Worker) or any
  // third party — always hit the network.
  if (url.origin !== self.location.origin) return;

  // Navigation requests → app shell (SPA: index.html), falling back to cache.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(function () { return caches.match("./index.html"); })
    );
    return;
  }

  // Static assets → cache-first, then network (and cache the fresh copy).
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
    })
  );
});
