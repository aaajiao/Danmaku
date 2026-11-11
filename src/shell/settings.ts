/**
 * Persisted shell settings: one string per key in `localStorage`.
 *
 * The first persisted setting this project has — before it, nothing in `src/`
 * touched storage. It lives in the shell because only the shell may know a
 * browser exists; a setting reaches `src/game` as a plain value on
 * `GameContext` (see `GameContext.rumble`) and never enters `RunConfig`, a
 * replay, or the simulation. Values are strings here and are parsed by
 * whoever owns their meaning (`parseRumbleSetting` for rumble), so this module
 * needs no knowledge of any one setting.
 *
 * ## Storage is allowed to be absent, broken or hostile
 *
 * `localStorage` is not a dependable object. In a sandboxed or opaque-origin
 * frame, with site data blocked, or in some private modes, merely READING the
 * `globalThis.localStorage` getter throws a `SecurityError`; `setItem` throws
 * when the quota is full or storage is disabled; and the value read back may
 * have been written by another build or by hand. So both calls swallow every
 * failure and report it as "nothing stored" / "not saved", and the getter is
 * resolved lazily INSIDE the `try` — never as a default parameter, which would
 * evaluate it at the call site, outside any guard. A setting that cannot be
 * persisted still works for the session; it simply starts from its default
 * next time.
 *
 * `storage` is injectable so tests can drive both outcomes without a browser.
 */

/** Storage key for the RUMBLE menu setting (`off` / `low` / `full`). */
export const RUMBLE_SETTING_KEY = 'danmaku.rumble';

/**
 * The string stored under `key`, or `undefined` when there is none or storage
 * is unavailable. Never throws.
 */
export function loadSetting(
  key: string,
  storage?: Pick<Storage, 'getItem'>,
): string | undefined {
  try {
    const store = storage ?? globalThis.localStorage;
    if (store === undefined || store === null) return undefined;
    const value = store.getItem(key);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Store `value` under `key`. Returns whether it was stored; `false` when
 * storage is unavailable, full or refuses the write. Never throws.
 */
export function saveSetting(
  key: string,
  value: string,
  storage?: Pick<Storage, 'setItem'>,
): boolean {
  try {
    const store = storage ?? globalThis.localStorage;
    if (store === undefined || store === null) return false;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
