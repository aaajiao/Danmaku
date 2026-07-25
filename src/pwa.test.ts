import { describe, expect, test } from 'bun:test';

import {
  PwaUpdateCoordinator,
  registerProductionWorker,
  reloadOnControllerUpgrade,
} from './pwa';

interface ControllerHarness {
  readonly serviceWorkers: ServiceWorkerContainer;
  setController(controller: ServiceWorker | null): void;
  dispatchControllerChange(): void;
}

function controllerHarness(initial: ServiceWorker | null): ControllerHarness {
  let controller = initial;
  let listener: (() => void) | undefined;
  const serviceWorkers = {
    get controller(): ServiceWorker | null {
      return controller;
    },
    addEventListener(type: string, next: () => void): void {
      if (type === 'controllerchange') listener = next;
    },
  } as unknown as ServiceWorkerContainer;

  return {
    serviceWorkers,
    setController(next): void {
      controller = next;
    },
    dispatchControllerChange(): void {
      listener?.();
    },
  };
}

describe('production PWA registration', () => {
  test('registers the root worker and explicitly checks for an update', async () => {
    const calls: unknown[][] = [];
    let updates = 0;
    const registration = {
      async update(): Promise<void> {
        updates++;
      },
    } as unknown as ServiceWorkerRegistration;
    const serviceWorkers = {
      async register(...args: unknown[]): Promise<ServiceWorkerRegistration> {
        calls.push(args);
        return registration;
      },
    } as unknown as ServiceWorkerContainer;

    let observed: ServiceWorkerRegistration | undefined;
    await registerProductionWorker(
      serviceWorkers,
      (next) => {
        observed = next;
      },
    );

    expect(calls).toEqual([[
      './sw.js',
      { scope: './', updateViaCache: 'none' },
    ]]);
    expect(observed).toBe(registration);
    expect(updates).toBe(1);
  });

  test('a waiting release is promoted once, and only when the shell asks', () => {
    const messages: unknown[] = [];
    const first = {
      postMessage(value: unknown): void {
        messages.push(value);
      },
    } as unknown as ServiceWorker;
    const second = {
      postMessage(value: unknown): void {
        messages.push(value);
      },
    } as unknown as ServiceWorker;
    let waiting: ServiceWorker | null = null;
    const registration = {
      get waiting(): ServiceWorker | null {
        return waiting;
      },
    } as ServiceWorkerRegistration;
    const coordinator = new PwaUpdateCoordinator();
    coordinator.observe(registration);

    expect(coordinator.activateWaiting()).toBe(false);
    expect(messages).toEqual([]);

    waiting = first;
    expect(coordinator.activateWaiting()).toBe(true);
    expect(coordinator.activateWaiting()).toBe(false);
    expect(messages).toEqual(['danmaku:activate-update']);

    waiting = second;
    expect(coordinator.activateWaiting()).toBe(true);
    expect(messages).toEqual([
      'danmaku:activate-update',
      'danmaku:activate-update',
    ]);
  });

  test('a deferred multi-client promotion retries at a bounded cadence', () => {
    const messages: unknown[] = [];
    const waiting = {
      postMessage(value: unknown): void {
        messages.push(value);
      },
    } as unknown as ServiceWorker;
    const registration = {
      waiting,
    } as ServiceWorkerRegistration;
    let now = 10_000;
    const coordinator = new PwaUpdateCoordinator(() => now);
    coordinator.observe(registration);

    expect(coordinator.activateWaiting()).toBe(true);
    now += 4_999;
    expect(coordinator.activateWaiting()).toBe(false);
    now += 1;
    expect(coordinator.activateWaiting()).toBe(true);
    expect(messages).toEqual([
      'danmaku:activate-update',
      'danmaku:activate-update',
    ]);
  });

  test('a postMessage race stays inert and may retry on a later title tick', () => {
    let attempts = 0;
    const redundant = {
      postMessage(): void {
        attempts++;
        throw new DOMException('worker became redundant', 'InvalidStateError');
      },
    } as unknown as ServiceWorker;
    const registration = {
      waiting: redundant,
    } as ServiceWorkerRegistration;
    let now = 20_000;
    const coordinator = new PwaUpdateCoordinator(() => now);
    coordinator.observe(registration);

    expect(coordinator.activateWaiting()).toBe(false);
    expect(coordinator.activateWaiting()).toBe(false);
    now += 5_000;
    expect(coordinator.activateWaiting()).toBe(false);
    expect(attempts).toBe(2);
  });

  test('waits for every held persistence operation before promoting an update', async () => {
    const messages: unknown[] = [];
    const waiting = {
      postMessage(value: unknown): void {
        messages.push(value);
      },
    } as unknown as ServiceWorker;
    const registration = {
      waiting,
    } as ServiceWorkerRegistration;
    const coordinator = new PwaUpdateCoordinator();
    coordinator.observe(registration);

    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const first = coordinator.holdUpdateWhile(new Promise<void>((resolve) => {
      finishFirst = resolve;
    }));
    const second = coordinator.holdUpdateWhile(new Promise<void>((resolve) => {
      finishSecond = resolve;
    }));

    expect(coordinator.activateWaiting()).toBe(false);
    finishFirst?.();
    await first;
    expect(coordinator.activateWaiting()).toBe(false);
    finishSecond?.();
    await second;

    expect(coordinator.activateWaiting()).toBe(true);
    expect(messages).toEqual(['danmaku:activate-update']);
  });

  test('a failed held operation releases the update gate', async () => {
    const messages: unknown[] = [];
    const waiting = {
      postMessage(value: unknown): void {
        messages.push(value);
      },
    } as unknown as ServiceWorker;
    const registration = {
      waiting,
    } as ServiceWorkerRegistration;
    const coordinator = new PwaUpdateCoordinator();
    coordinator.observe(registration);

    let fail: ((error: Error) => void) | undefined;
    const pending = coordinator.holdUpdateWhile(new Promise<void>((_resolve, reject) => {
      fail = reject;
    }));
    expect(coordinator.activateWaiting()).toBe(false);

    fail?.(new Error('quota'));
    await expect(pending).rejects.toThrow('quota');
    expect(coordinator.activateWaiting()).toBe(true);
    expect(messages).toEqual(['danmaku:activate-update']);
  });

  test('a page-only persistence failure can retain the update gate', async () => {
    const messages: unknown[] = [];
    const waiting = {
      postMessage(value: unknown): void {
        messages.push(value);
      },
    } as unknown as ServiceWorker;
    const registration = {
      waiting,
    } as ServiceWorkerRegistration;
    const coordinator = new PwaUpdateCoordinator();
    coordinator.observe(registration);

    const pending = coordinator.holdUpdateWhile(
      Promise.reject(new Error('quota')),
      { retainOnFailure: true },
    );
    await expect(pending).rejects.toThrow('quota');

    expect(coordinator.activateWaiting()).toBe(false);
    expect(messages).toEqual([]);
  });

  test('a retention predicate releases failures that kept no page-only data', async () => {
    const messages: unknown[] = [];
    const waiting = {
      postMessage(value: unknown): void {
        messages.push(value);
      },
    } as unknown as ServiceWorker;
    const registration = {
      waiting,
    } as ServiceWorkerRegistration;
    const coordinator = new PwaUpdateCoordinator();
    coordinator.observe(registration);

    const pending = coordinator.holdUpdateWhile(
      Promise.reject(new TypeError('invalid replay')),
      {
        retainOnFailure: (error) => (
          error instanceof Error && error.message === 'quota'
        ),
      },
    );
    await expect(pending).rejects.toThrow('invalid replay');

    expect(coordinator.activateWaiting()).toBe(true);
    expect(messages).toEqual(['danmaku:activate-update']);
  });

  test('does not reload when the first worker claims an uncontrolled page', () => {
    const first = {} as ServiceWorker;
    const second = {} as ServiceWorker;
    const harness = controllerHarness(null);
    let reloads = 0;
    reloadOnControllerUpgrade(harness.serviceWorkers, () => reloads++);

    harness.setController(first);
    harness.dispatchControllerChange();
    expect(reloads).toBe(0);

    harness.setController(second);
    harness.dispatchControllerChange();
    expect(reloads).toBe(1);
  });

  test('reloads an already-controlled page once across repeated change events', () => {
    const first = {} as ServiceWorker;
    const second = {} as ServiceWorker;
    const third = {} as ServiceWorker;
    const harness = controllerHarness(first);
    let reloads = 0;
    reloadOnControllerUpgrade(harness.serviceWorkers, () => reloads++);

    harness.dispatchControllerChange();
    expect(reloads).toBe(0);

    harness.setController(second);
    harness.dispatchControllerChange();
    harness.setController(third);
    harness.dispatchControllerChange();
    expect(reloads).toBe(1);
  });
});
