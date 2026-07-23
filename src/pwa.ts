/**
 * Production-only PWA registration.
 *
 * The development server deliberately stays service-worker-free: caching Bun's
 * `/_bun/*` graph makes source edits appear not to land. The production build
 * replaces `process.env.NODE_ENV`, so this branch disappears from development
 * while the generated static build registers its root worker after the game has
 * loaded. Waiting until `load` also keeps the worker's one-time offline fill
 * from competing with the pack loader during first paint.
 */

const CACHE_PREFIX = 'danmaku-shell-';
const DEV_RESET_KEY = 'danmaku-pwa-dev-reset';

/** Same small FNV-1a scope identity used by the worker's cache namespace. */
function scopeKey(scope: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < scope.length; i++) {
    hash ^= scope.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function registrationWorkers(
  registration: ServiceWorkerRegistration,
): readonly (ServiceWorker | null)[] {
  return [
    registration.installing,
    registration.waiting,
    registration.active,
  ];
}

function isThisApp(registration: ServiceWorkerRegistration): boolean {
  if (!location.href.startsWith(registration.scope)) return false;
  return registrationWorkers(registration).some((worker) => {
    if (worker === null) return false;
    return new URL(worker.scriptURL).pathname.endsWith('/sw.js');
  });
}

/**
 * A production worker left on the dev origin would otherwise keep serving its
 * immutable app snapshot. Unregister only this page's `/sw.js` registration,
 * remove only its scope-namespaced cache, then reload once to detach the
 * controller. The worker itself lets localhost navigations reach the network,
 * which is what gives this cleanup branch a chance to run.
 */
async function clearDevelopmentWorker(): Promise<void> {
  const registrations = (await navigator.serviceWorker.getRegistrations())
    .filter(isThisApp);
  if (registrations.length === 0) {
    sessionStorage.removeItem(DEV_RESET_KEY);
    return;
  }

  await Promise.all(registrations.map((registration) => registration.unregister()));
  const ownedPrefixes = registrations.map(
    (registration) => `${CACHE_PREFIX}${scopeKey(registration.scope)}-`,
  );
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((name) => (
    ownedPrefixes.some((prefix) => name.startsWith(prefix))
      ? caches.delete(name)
      : Promise.resolve(false)
  )));

  if (
    navigator.serviceWorker.controller !== null
    && sessionStorage.getItem(DEV_RESET_KEY) !== '1'
  ) {
    sessionStorage.setItem(DEV_RESET_KEY, '1');
    location.reload();
  }
}

if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', {
      scope: './',
      updateViaCache: 'none',
    }).catch((error: unknown) => {
      // Offline support is an enhancement; a refused worker must never block
      // the procedural asset floor or the game loop.
      console.warn('pwa: service worker registration failed', error);
    });
  }, { once: true });
} else if ('serviceWorker' in navigator) {
  void clearDevelopmentWorker().catch((error: unknown) => {
    console.warn('pwa: could not clear a development service worker', error);
  });
}
