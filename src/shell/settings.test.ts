import { afterEach, describe, expect, test } from 'bun:test';

import { loadSetting, RUMBLE_SETTING_KEY, saveSetting } from './settings';

/** A Map-backed `Storage` slice: the two methods these helpers use. */
class FakeStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

/**
 * Replace `globalThis.localStorage` for one test and put the original
 * descriptor back afterwards, whatever it was (Bun may or may not define one).
 */
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
function setGlobalStorage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor });
}
afterEach(() => {
  if (original === undefined) {
    Reflect.deleteProperty(globalThis, 'localStorage');
  } else {
    Object.defineProperty(globalThis, 'localStorage', original);
  }
});

describe('settings', () => {
  test('the rumble key is namespaced', () => {
    expect(RUMBLE_SETTING_KEY).toBe('danmaku.rumble');
  });

  test('a saved value loads back', () => {
    const storage = new FakeStorage();
    expect(saveSetting(RUMBLE_SETTING_KEY, 'low', storage)).toBe(true);
    expect(storage.items.get(RUMBLE_SETTING_KEY)).toBe('low');
    expect(loadSetting(RUMBLE_SETTING_KEY, storage)).toBe('low');
  });

  test('a missing key loads as undefined, not null', () => {
    expect(loadSetting('danmaku.absent', new FakeStorage())).toBeUndefined();
  });

  test('a throwing getItem loads as undefined', () => {
    const storage = {
      getItem(): string | null {
        throw new DOMException('denied', 'SecurityError');
      },
    };
    expect(loadSetting(RUMBLE_SETTING_KEY, storage)).toBeUndefined();
  });

  test('a throwing setItem (quota, disabled storage) reports false', () => {
    const storage = {
      setItem(): void {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(saveSetting(RUMBLE_SETTING_KEY, 'full', storage)).toBe(false);
  });

  test('a non-string from a misbehaving store loads as undefined', () => {
    const storage = { getItem: () => 42 as unknown as string };
    expect(loadSetting(RUMBLE_SETTING_KEY, storage)).toBeUndefined();
  });

  test('with no injected storage it uses globalThis.localStorage, resolved at call time', () => {
    const fake = new FakeStorage();
    setGlobalStorage({ value: fake, writable: true });
    expect(saveSetting(RUMBLE_SETTING_KEY, 'off')).toBe(true);
    expect(loadSetting(RUMBLE_SETTING_KEY)).toBe('off');
    expect(fake.items.get(RUMBLE_SETTING_KEY)).toBe('off');
  });

  test('a localStorage GETTER that throws is caught, on both paths', () => {
    // A sandboxed or opaque-origin frame throws on merely reading the property.
    // Had the getter been a default parameter, this would throw out of the call.
    let reads = 0;
    setGlobalStorage({
      get(): Storage {
        reads++;
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(() => loadSetting(RUMBLE_SETTING_KEY)).not.toThrow();
    expect(loadSetting(RUMBLE_SETTING_KEY)).toBeUndefined();
    expect(saveSetting(RUMBLE_SETTING_KEY, 'low')).toBe(false);
    expect(reads).toBeGreaterThan(0);
  });

  test('no localStorage at all (a headless host) is "nothing stored"', () => {
    setGlobalStorage({ value: undefined, writable: true });
    expect(loadSetting(RUMBLE_SETTING_KEY)).toBeUndefined();
    expect(saveSetting(RUMBLE_SETTING_KEY, 'low')).toBe(false);
  });

  test('an injected storage is preferred and the global is never read', () => {
    let reads = 0;
    setGlobalStorage({
      get(): Storage {
        reads++;
        throw new Error('global storage must not be read');
      },
    });
    const storage = new FakeStorage();
    expect(saveSetting(RUMBLE_SETTING_KEY, 'full', storage)).toBe(true);
    expect(loadSetting(RUMBLE_SETTING_KEY, storage)).toBe('full');
    expect(reads).toBe(0);
  });
});
