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
const WORKER_URL = new URL("./sw.js", self.registration.scope).href;
const TRUST_URL = new URL(
  `./.danmaku-release-${BUILD_ID}`,
  self.registration.scope,
).href;
const RELEASE_URLS = new Set(PRECACHE_URLS.map(
  (path) => new URL(path, self.registration.scope).href,
));
const LOCAL_DEVELOPMENT = (
  self.location.hostname === "localhost"
  || self.location.hostname === "127.0.0.1"
  || self.location.hostname === "[::1]"
);
let releaseRepair;
let releaseTrusted;
let releaseTrustRead;
let releaseEpoch = 0;

function releaseRequests() {
  return PRECACHE_URLS.map((path) => new Request(
    new URL(path, self.registration.scope),
    { cache: "reload" },
  ));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      // A complete release waits beside the active one. The page promotes it
      // only from a safe game state, so a live run stays on one atomic snapshot.
      await cache.addAll(releaseRequests());
      await markReleaseTrusted(cache);
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

function missingReleaseResponse() {
  return new Response("Danmaku release cache is incomplete.", {
    status: 503,
    statusText: "Release Cache Incomplete",
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function missingShellResponse() {
  const activationMessage = JSON.stringify(ACTIVATE_UPDATE);
  return new Response(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#04070c">
<title>Repairing Danmaku</title>
<style>
  html { color-scheme: dark; background: #04070c; color: #d9e5ef; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 15vh auto; max-width: 32rem; padding: 1.5rem; }
  h1 { color: #fff; font-size: 1.25rem; }
  button { font: inherit; padding: .6rem 1rem; }
</style>
<body>
  <h1>Repairing the Danmaku release cache…</h1>
  <p id="status">Checking for a complete release. This page will reload automatically.</p>
  <button id="retry" type="button" hidden>Retry</button>
  <script>
    (() => {
      const status = document.querySelector("#status");
      const retry = document.querySelector("#retry");
      let promotionTimer;
      let promotionAttempts = 0;
      const fail = (message) => {
        clearTimeout(promotionTimer);
        status.textContent = message;
        retry.hidden = false;
      };
      const promote = (registration) => {
        const waiting = registration.waiting;
        if (!waiting) return false;
        waiting.postMessage(${activationMessage});
        promotionAttempts++;
        status.textContent = "A complete release is ready. Close any other Danmaku window; activation will retry automatically.";
        clearTimeout(promotionTimer);
        if (promotionAttempts < 30) {
          promotionTimer = setTimeout(() => promote(registration), 2_000);
        } else {
          fail("Close every other Danmaku window, then select Retry.");
        }
        return true;
      };
      const watch = (registration, installing) => {
        if (!installing) return false;
        const changed = () => {
          if (installing.state === "installed") {
            setTimeout(() => {
              if (!promote(registration)) {
                fail("Reconnect, then select Retry.");
              }
            });
          } else if (installing.state === "redundant") {
            fail("The release download failed. Reconnect, then select Retry.");
          }
        };
        installing.addEventListener("statechange", changed);
        changed();
        return true;
      };
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          clearTimeout(promotionTimer);
          location.reload();
        },
        { once: true },
      );
      const run = async () => {
        retry.hidden = true;
        promotionAttempts = 0;
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) {
          location.reload();
          return;
        }
        if (promote(registration)) return;
        const alreadyInstalling = watch(registration, registration.installing);
        await registration.update();
        if (promote(registration)) return;
        if (!watch(registration, registration.installing) && !alreadyInstalling) {
          fail("Reconnect, then select Retry.");
        }
      };
      retry.addEventListener("click", () => location.reload());
      void run().catch(() => fail("Reconnect, then select Retry."));
    })();
  </script>
</body>
</html>`, {
    status: 503,
    statusText: "Repairing Release Cache",
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

async function deployedBuildId() {
  const response = await fetch(new Request(WORKER_URL, { cache: "no-store" }));
  if (!response.ok) return undefined;
  const source = await response.text();
  return source.match(/^const BUILD_ID = "([^"\r\n]+)";$/m)?.[1];
}

async function isReleaseTrusted(cache) {
  if (releaseTrusted !== undefined) return releaseTrusted;
  if (releaseTrustRead === undefined) {
    const epoch = releaseEpoch;
    releaseTrustRead = (async () => {
      let trusted = false;
      try {
        const marker = await cache.match(TRUST_URL);
        trusted = marker !== undefined && await marker.text() === BUILD_ID;
      } catch {
        // A missing or unreadable marker is never trusted.
      }
      if (epoch === releaseEpoch) releaseTrusted = trusted;
      return releaseTrusted === true;
    })().finally(() => {
      releaseTrustRead = undefined;
    });
  }
  return releaseTrustRead;
}

async function markReleaseTrusted(cache) {
  await cache.put(TRUST_URL, new Response(BUILD_ID, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  }));
  releaseTrusted = true;
  releaseEpoch++;
}

/** Persist fail-closed state before any release bytes can be replaced. */
async function poisonRelease(cache) {
  releaseTrusted = false;
  releaseEpoch++;
  try {
    await cache.put(TRUST_URL, new Response("untrusted"));
    return true;
  } catch {
    // Fall through to deletion when Cache.put itself is unavailable.
  }
  try {
    await cache.delete(TRUST_URL);
    return true;
  } catch {
    // Fall through to removing the whole named cache.
  }
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // No durable poison could be written.
  }
  // The Cache object may now be detached from its name. Stop this attempt and
  // let a later fetch reopen a fresh canonical cache before refilling it.
  return false;
}

/**
 * CacheStorage can be evicted independently of an active service worker. Refill
 * only after the network worker proves that the deployed release is byte-for-
 * byte the one this worker names. The before/after checks reject a deployment
 * switch during addAll(), and the shared promise keeps concurrent misses on one
 * atomic refill.
 */
async function repairRelease(cache) {
  if (releaseRepair === undefined) {
    releaseRepair = (async () => {
      const wasTrusted = await isReleaseTrusted(cache);
      try {
        const deployedId = await deployedBuildId();
        if (deployedId === undefined) return false;
        // No byte has changed, so keep the rest of an older snapshot usable by
        // any other live client. The missing request itself still fails closed.
        if (deployedId !== BUILD_ID) return false;
        if (!await poisonRelease(cache)) {
          releaseTrusted = wasTrusted;
          releaseEpoch++;
          return false;
        }
        try {
          await cache.addAll(releaseRequests());
        } catch {
          // Cache.addAll() is atomic. If this was a partially evicted but
          // otherwise trusted snapshot, restore its marker so another running
          // client can keep using the entries that were never replaced.
          if (wasTrusted) {
            try {
              await markReleaseTrusted(cache);
            } catch {
              // The poison marker remains the safe state.
            }
          }
          return false;
        }
        if (await deployedBuildId() !== BUILD_ID) {
          throw new Error("release changed");
        }
        await markReleaseTrusted(cache);
        return true;
      } catch {
        // The poison marker was committed before addAll(), so a worker restart
        // also rejects any committed-but-unverified entries. Keep the named
        // cache in place so the next attempt can overwrite it atomically.
        releaseTrusted = false;
        releaseEpoch++;
        return false;
      }
    })().finally(() => {
      releaseRepair = undefined;
    });
  }
  return releaseRepair;
}

async function releaseMatch(cache, request) {
  for (;;) {
    const repairing = releaseRepair;
    if (repairing !== undefined) {
      if (!await repairing && !await isReleaseTrusted(cache)) return undefined;
      continue;
    }

    const epoch = releaseEpoch;
    if (!await isReleaseTrusted(cache)) {
      if (!await repairRelease(cache)) return undefined;
      continue;
    }
    if (
      releaseRepair !== undefined
      || releaseTrusted !== true
      || epoch !== releaseEpoch
    ) continue;
    const cached = await cache.match(request);
    // A refill may have started or completed while match() was pending. Never
    // expose its provisional entries; retry against the settled generation.
    if (
      releaseRepair !== undefined
      || releaseTrusted !== true
      || epoch !== releaseEpoch
    ) continue;
    if (cached !== undefined) return cached;
    if (!await repairRelease(cache)) return undefined;
  }
}

/**
 * The generated cache is a release snapshot, so reads are cache-first. This is
 * intentional for navigations too: returning a newly deployed index through an
 * old active worker could combine new JS with old un-hashed pack files. The new
 * worker installs beside it and takes over after the old game tabs close.
 * An evicted entry may be refilled only while the deployed worker advertises
 * this exact build id; otherwise assets still fail closed. A missing navigation
 * returns a self-contained repair page so a complete waiting worker can be
 * promoted without loading a mixed application shell.
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
      const shell = await releaseMatch(cache, ROOT_URL);
      if (shell !== undefined) return shell;
      return missingShellResponse();
    }

    const cached = RELEASE_URLS.has(url.href)
      ? await releaseMatch(cache, request)
      : await cache.match(request);
    if (cached !== undefined) return cached;

    if (RELEASE_URLS.has(url.href)) {
      return missingReleaseResponse();
    }

    const response = await fetch(request);
    if (cacheable(request, response)) {
      event.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  })());
});
