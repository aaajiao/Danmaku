"use strict";

/*
 * Production placeholders are replaced by tools/build-pwa.ts after every
 * bundle and pack file is final. The template itself remains valid JavaScript
 * so syntax and lifecycle tests exercise the same worker the build emits; only
 * its release id and URL inventory are substituted.
 */
const BUILD_ID = "__BUILD_ID__";
const PRECACHE_URLS = /* __PRECACHE_URLS__ */ [];
const CACHE_BASE = "danmaku-shell-";
const ACTIVATE_UPDATE = "danmaku:activate-update";

/** CacheStorage is origin-wide, so each service-worker scope owns a namespace. */
function scopeKey(scope) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < scope.length; i++) {
    hash ^= scope.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

const CACHE_PREFIX = `${CACHE_BASE}${scopeKey(self.registration.scope)}-`;
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const ROOT_URL = new URL("./", self.registration.scope).href;
const LOCAL_DEVELOPMENT = (
  self.location.hostname === "localhost"
  || self.location.hostname === "127.0.0.1"
  || self.location.hostname === "[::1]"
);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const requests = PRECACHE_URLS.map((path) => new Request(
        new URL(path, self.registration.scope),
        { cache: "reload" },
      ));
      // A complete release waits beside the active one. The page promotes it
      // only from a safe game state, so a live run stays on one atomic snapshot.
      await cache.addAll(requests);
    } catch (error) {
      // A rejected install never reaches activate(), where old release caches
      // are normally collected. Remove this build's failed cache here so
      // repeated iOS update attempts cannot consume origin quota indefinitely.
      try {
        await caches.delete(CACHE_NAME);
      } catch {
        // Preserve the install error: cleanup failure must not make a broken
        // release eligible to activate.
      }
      throw error;
    }
  })());
});

/**
 * Promotion is page-coordinated rather than automatic. In particular, the
 * bridge from releases without this protocol must stay waiting until that old
 * client really closes; otherwise old JavaScript would fetch through a new
 * worker after its cache had been deleted.
 */
self.addEventListener("message", (event) => {
  if (event.data !== ACTIVATE_UPDATE) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    const scoped = windows.filter(
      (client) => client.url.startsWith(self.registration.scope),
    );
    // One title page is known-safe. If a Safari tab or another installed
    // window is also alive, leave the worker waiting rather than interrupting
    // an unknown run in that client.
    if (scoped.length !== 1 || scoped[0].id !== event.source?.id) return;
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => (
      name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME
        ? caches.delete(name)
        : Promise.resolve(false)
    )));
    await self.clients.claim();
  })());
});

function cacheable(request, response) {
  return request.method === "GET"
    && !request.headers.has("range")
    && response.ok
    && response.status === 200
    && response.type !== "opaque";
}

/**
 * The generated cache is a release snapshot, so reads are cache-first. This is
 * intentional for navigations too: returning a newly deployed index through an
 * old active worker could combine new JS with old un-hashed pack files. The new
 * worker installs beside it and takes over after the old game tabs close.
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Let the source dev server escape a production snapshot left on localhost;
    // src/pwa.ts then unregisters this worker and reloads once without control.
    if (request.mode === "navigate" && LOCAL_DEVELOPMENT) {
      try {
        return await fetch(request, { cache: "no-store" });
      } catch {
        // The local server is genuinely down: continue to the offline shell.
      }
    }
    if (request.mode === "navigate") {
      const shell = await cache.match(ROOT_URL);
      if (shell !== undefined) return shell;
    }

    const cached = await cache.match(request);
    if (cached !== undefined) return cached;

    const response = await fetch(request);
    if (cacheable(request, response)) {
      event.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  })());
});
