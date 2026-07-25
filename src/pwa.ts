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
const ACTIVATE_UPDATE = 'danmaku:activate-update';
const UPDATE_RETRY_MS = 5_000;

export class PwaUpdateCoordinator {
  #registration: ServiceWorkerRegistration | undefined;
  #requested: ServiceWorker | undefined;
  #requestedAt = Number.NEGATIVE_INFINITY;
  #updateHolds = 0;

  constructor(
    readonly now: () => number = () => performance.now(),
  ) {}

  observe(registration: ServiceWorkerRegistration): void {
    this.#registration = registration;
    if (registration.waiting !== this.#requested) {
      this.#requested = undefined;
      this.#requestedAt = Number.NEGATIVE_INFINITY;
    }
  }

  /**
   * Keep a waiting worker from replacing this page while shell-owned durable
   * work is unsettled.
   *
   * A write that leaves its value usable only in memory may retain the hold
   * after rejection: reloading that page would otherwise turn a visible,
   * downloadable replay into data loss. Ordinary failures release it.
   */
  holdUpdateWhile<T>(
    pending: PromiseLike<T>,
    options: {
      readonly retainOnFailure?: boolean | ((error: unknown) => boolean);
    } = {},
  ): Promise<T> {
    this.#updateHolds++;
    return Promise.resolve(pending).then(
      (value) => {
        this.#updateHolds--;
        return value;
      },
      (error: unknown) => {
        const retention = options.retainOnFailure;
        const retain = retention === true
          || (typeof retention === 'function' && retention(error));
        if (!retain) this.#updateHolds--;
        throw error;
      },
    );
  }

  /**
   * Promote at a bounded cadence per waiting worker. The shell calls this only
   * while the title is current, so controllerchange reloads without losing a run.
   */
  activateWaiting(): boolean {
    if (this.#updateHolds > 0) return false;

    const worker = this.#registration?.waiting;
    if (worker === null || worker === undefined) {
      return false;
    }
    const at = this.now();
    if (
      worker === this.#requested
      && at - this.#requestedAt < UPDATE_RETRY_MS
    ) return false;

    this.#requested = worker;
    this.#requestedAt = at;
    try {
      worker.postMessage(ACTIVATE_UPDATE);
      return true;
    } catch {
      // The waiting worker may have become redundant between the getter and
      // postMessage. Keep the same bounded retry cadence; a replacement worker
      // has a different identity and can still be contacted immediately.
      return false;
    }
  }
}

const updates = new PwaUpdateCoordinator();

/** Called from the shell's title-state reconcile; inert when no update waits. */
export function activateWaitingPwaUpdate(): boolean {
  return updates.activateWaiting();
}

/** Hold an update around one shell-owned persistence operation. */
export function holdPwaUpdateWhile<T>(
  pending: PromiseLike<T>,
  options?: {
    readonly retainOnFailure?: boolean | ((error: unknown) => boolean);
  },
): Promise<T> {
  return updates.holdUpdateWhile(pending, options);
}

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
 * Reload exactly once when one active production worker hands the page to a
 * newer one. A first install changes `controller` from null and must not
 * reload: that page already came from the network as one coherent release.
 */
export function reloadOnControllerUpgrade(
  serviceWorkers: ServiceWorkerContainer,
  reload: () => void,
): void {
  let controller = serviceWorkers.controller;
  let reloading = false;

  serviceWorkers.addEventListener('controllerchange', () => {
    const previous = controller;
    controller = serviceWorkers.controller;
    if (
      reloading
      || previous === null
      || controller === null
      || controller === previous
    ) {
      return;
    }
    reloading = true;
    reload();
  });
}

/** Register the root worker and bypass the browser's periodic update cadence. */
export async function registerProductionWorker(
  serviceWorkers: ServiceWorkerContainer,
  observe: (registration: ServiceWorkerRegistration) => void = () => undefined,
): Promise<void> {
  const registration = await serviceWorkers.register('./sw.js', {
    scope: './',
    updateViaCache: 'none',
  });
  // Observe before update(): a pre-existing waiting worker is immediately
  // promotable, and a newly installing worker appears through the same live
  // registration object once it reaches `waiting`.
  observe(registration);
  await registration.update();
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
  // Install this listener before `load`: a fast, already-downloaded update may
  // otherwise claim the page before the deferred registration callback runs.
  reloadOnControllerUpgrade(
    navigator.serviceWorker,
    () => location.reload(),
  );
  addEventListener('load', () => {
    void registerProductionWorker(
      navigator.serviceWorker,
      (registration) => updates.observe(registration),
    )
      .catch((error: unknown) => {
        // Offline support is an enhancement; a refused worker must never block
        // the procedural asset floor or the game loop.
        console.warn('pwa: service worker setup failed', error);
      });
  }, { once: true });
} else if ('serviceWorker' in navigator) {
  void clearDevelopmentWorker().catch((error: unknown) => {
    console.warn('pwa: could not clear a development service worker', error);
  });
}
