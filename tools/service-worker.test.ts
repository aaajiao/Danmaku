import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const TEMPLATE_PATH = join(import.meta.dir, '..', 'public', 'sw.js');
const BUILD_DECLARATION = 'const BUILD_ID = "__BUILD_ID__";';
const PRECACHE_DECLARATION =
  'const PRECACHE_URLS = /* __PRECACHE_URLS__ */ [];';

type WorkerListener = (event: any) => void;
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface MemoryCacheStorage {
  readonly names: Set<string>;
  readonly entries: Map<string, Map<string, string>>;
}

function memoryCacheStorage(
  existingCaches: readonly string[] = [],
): MemoryCacheStorage {
  return {
    names: new Set(existingCaches),
    entries: new Map(),
  };
}

interface WorkerHarness {
  readonly cacheName: string;
  readonly cachePrefix: string;
  readonly trustUrl: string;
  readonly listeners: Map<string, WorkerListener>;
  readonly opened: string[];
  readonly added: string[];
  readonly deleted: string[];
  readonly fetches: string[];
  readonly puts: string[];
  readonly claimed: { count: number };
  readonly skipped: { count: number };
  readonly installOrder: string[];
}

async function workerHarness(
  scope: string,
  options: {
    existingCaches?: string[];
    fetch?: FetchLike;
    cachedRoot?: boolean;
    cachedUrls?: string[];
    match?: (cacheName: string, url: string) => Promise<void>;
    precache?: (requests: readonly Request[]) => Promise<void>;
    precacheError?: Error;
    storage?: MemoryCacheStorage;
    trusted?: boolean;
    windowClients?: Array<{ id: string; url: string }>;
  } = {},
): Promise<WorkerHarness> {
  const template = await Bun.file(TEMPLATE_PATH).text();
  const source = template
    .replace(BUILD_DECLARATION, 'const BUILD_ID = "test-build";')
    .replace(
      PRECACHE_DECLARATION,
      'const PRECACHE_URLS = ["./", "./asset.js"];',
    );

  const listeners = new Map<string, WorkerListener>();
  const opened: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];
  const fetches: string[] = [];
  const puts: string[] = [];
  const claimed = { count: 0 };
  const skipped = { count: 0 };
  const installOrder: string[] = [];
  const location = new URL(scope);
  const initialEntries = new Map<string, string>();
  for (const url of options.cachedUrls ?? []) {
    initialEntries.set(url, `cached ${url}`);
  }
  if (options.cachedRoot === true) initialEntries.set(scope, 'cached shell');
  const storage = options.storage
    ?? memoryCacheStorage(options.existingCaches);
  for (const name of options.existingCaches ?? []) storage.names.add(name);
  let currentCacheName: string | undefined;
  let currentTrustUrl: string | undefined;
  let currentSeeded = false;

  function cacheFor(name: string) {
    let entries = storage.entries.get(name);
    if (entries === undefined) {
      const seed = name === currentCacheName && !currentSeeded
        ? initialEntries
        : new Map<string, string>();
      entries = new Map(seed);
      if (name === currentCacheName) {
        currentSeeded = true;
        const hasSeed = initialEntries.size > 0;
        if (
          (options.trusted ?? hasSeed)
          && currentTrustUrl !== undefined
        ) entries.set(currentTrustUrl, 'test-build');
      }
      storage.entries.set(name, entries);
      storage.names.add(name);
    }
    return {
      async addAll(requests: Request[]): Promise<void> {
        installOrder.push('precache');
        if (options.precacheError !== undefined) {
          throw options.precacheError;
        }
        await options.precache?.(requests);
        added.push(...requests.map((request) => request.url));
        for (const request of requests) {
          entries.set(
            request.url,
            request.url === scope ? 'cached shell' : `cached ${request.url}`,
          );
        }
      },
      async match(key: Request | string): Promise<Response | undefined> {
        const url = typeof key === 'string' ? key : key.url;
        await options.match?.(name, url);
        const body = entries.get(url);
        return body === undefined ? undefined : new Response(body);
      },
      async put(request: Request | string, response: Response): Promise<void> {
        const url = typeof request === 'string' ? request : request.url;
        puts.push(url);
        entries.set(url, await response.text());
      },
      async delete(request: Request | string): Promise<boolean> {
        const url = typeof request === 'string' ? request : request.url;
        return entries.delete(url);
      },
    };
  }
  const cacheStorage = {
    async open(name: string) {
      opened.push(name);
      return cacheFor(name);
    },
    async keys(): Promise<string[]> {
      return [...storage.names];
    },
    async delete(name: string): Promise<boolean> {
      deleted.push(name);
      storage.entries.delete(name);
      return storage.names.delete(name);
    },
  };
  const fetchImpl: FetchLike = async (input, init) => {
    const requestLike = input as { url?: unknown };
    const url = input instanceof Request
      ? input.url
      : typeof requestLike.url === 'string'
        ? requestLike.url
        : String(input);
    fetches.push(url);
    if (options.fetch !== undefined) return options.fetch(input, init);
    throw new TypeError('offline');
  };
  const self = {
    registration: { scope },
    location,
    clients: {
      async matchAll(): Promise<Array<{ id: string; url: string }>> {
        return options.windowClients ?? [{ id: 'only', url: scope }];
      },
      async claim(): Promise<void> {
        claimed.count++;
      },
    },
    async skipWaiting(): Promise<void> {
      installOrder.push('skip-waiting');
      skipped.count++;
    },
    addEventListener(type: string, listener: WorkerListener): void {
      listeners.set(type, listener);
    },
  };

  const result = runInNewContext(
    `${source}\n({ cacheName: CACHE_NAME, cachePrefix: CACHE_PREFIX, trustUrl: TRUST_URL });`,
    {
      self,
      caches: cacheStorage,
      fetch: fetchImpl,
      URL,
      Request,
      Response,
      Headers,
      Promise,
      Math,
      TypeError,
    },
  ) as { cacheName: string; cachePrefix: string; trustUrl: string };
  currentCacheName = result.cacheName;
  currentTrustUrl = result.trustUrl;

  return {
    ...result,
    listeners,
    opened,
    added,
    deleted,
    fetches,
    puts,
    claimed,
    skipped,
    installOrder,
  };
}

async function dispatchWaitUntil(
  listener: WorkerListener | undefined,
): Promise<void> {
  if (listener === undefined) throw new Error('worker listener is missing');
  let pending: Promise<unknown> | undefined;
  listener({
    waitUntil(value: Promise<unknown>) {
      pending = value;
    },
  });
  if (pending === undefined) throw new Error('listener did not extend its lifetime');
  await pending;
}

async function dispatchMessage(
  listener: WorkerListener | undefined,
  data: unknown,
  source: { id: string } = { id: 'only' },
): Promise<void> {
  if (listener === undefined) throw new Error('worker listener is missing');
  let pending: Promise<unknown> | undefined;
  listener({
    data,
    source,
    waitUntil(value: Promise<unknown>) {
      pending = value;
    },
  });
  if (pending !== undefined) await pending;
}

async function dispatchFetch(
  listener: WorkerListener | undefined,
  request: Request | {
    readonly method: string;
    readonly mode: string;
    readonly url: string;
    readonly headers: Headers;
  },
): Promise<Response> {
  if (listener === undefined) throw new Error('worker listener is missing');
  let response: Promise<Response> | undefined;
  const pending: Promise<unknown>[] = [];
  listener({
    request,
    respondWith(value: Promise<Response>) {
      response = value;
    },
    waitUntil(value: Promise<unknown>) {
      pending.push(value);
    },
  });
  if (response === undefined) throw new Error('fetch listener did not respond');
  const result = await response;
  await Promise.all(pending);
  return result;
}

describe('generated service-worker lifecycle', () => {
  test('precache is exact and cache namespaces differ by scope', async () => {
    const root = await workerHarness('https://example.test/');
    const preview = await workerHarness('https://example.test/preview/');
    expect(root.cacheName).not.toBe(preview.cacheName);

    await dispatchWaitUntil(root.listeners.get('install'));
    expect(root.opened).toEqual([root.cacheName]);
    expect(root.added).toEqual([
      'https://example.test/',
      'https://example.test/asset.js',
    ]);
    expect(root.puts).toEqual([root.trustUrl]);
    expect(root.skipped.count).toBe(0);
    expect(root.installOrder).toEqual(['precache']);

    await dispatchMessage(root.listeners.get('message'), 'another-app');
    expect(root.skipped.count).toBe(0);
    await dispatchMessage(
      root.listeners.get('message'),
      'danmaku:activate-update',
    );
    expect(root.skipped.count).toBe(1);
    expect(root.installOrder).toEqual(['precache', 'skip-waiting']);
  });

  test('a title client cannot promote while another scoped window is alive', async () => {
    const worker = await workerHarness('https://example.test/', {
      windowClients: [
        { id: 'title', url: 'https://example.test/' },
        { id: 'playing', url: 'https://example.test/?run=1' },
      ],
    });
    await dispatchWaitUntil(worker.listeners.get('install'));
    await dispatchMessage(
      worker.listeners.get('message'),
      'danmaku:activate-update',
      { id: 'title' },
    );

    expect(worker.skipped.count).toBe(0);
    expect(worker.installOrder).toEqual(['precache']);
  });

  test('failed precache deletes only its release cache and never advances', async () => {
    const failed = await workerHarness('https://example.test/', {
      precacheError: new Error('asset refused'),
    });

    await expect(
      dispatchWaitUntil(failed.listeners.get('install')),
    ).rejects.toThrow('asset refused');
    expect(failed.skipped.count).toBe(0);
    expect(failed.deleted).toEqual([failed.cacheName]);
    expect(failed.installOrder).toEqual(['precache']);
  });

  test('activate deletes only older releases from its own scope', async () => {
    const root = await workerHarness('https://example.test/');
    const preview = await workerHarness('https://example.test/preview/');
    const active = await workerHarness('https://example.test/', {
      existingCaches: [
        root.cacheName,
        `${root.cachePrefix}old-build`,
        `${preview.cachePrefix}old-build`,
        'another-app',
      ],
    });

    await dispatchWaitUntil(active.listeners.get('activate'));
    expect(active.deleted).toEqual([`${root.cachePrefix}old-build`]);
    expect(active.claimed.count).toBe(1);
  });

  test('localhost escapes a stale shell while remote offline navigation uses it', async () => {
    const local = await workerHarness('http://localhost:3000/', {
      cachedRoot: true,
      fetch: async () => new Response('development'),
    });
    let localResponse: Promise<Response> | undefined;
    local.listeners.get('fetch')?.({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: 'http://localhost:3000/',
        headers: new Headers(),
      },
      respondWith(value: Promise<Response>) {
        localResponse = value;
      },
      waitUntil() {},
    });
    expect(await (await localResponse)?.text()).toBe('development');
    expect(local.fetches).toEqual(['http://localhost:3000/']);

    const localOffline = await workerHarness('http://localhost:3000/', {
      cachedRoot: true,
    });
    let localOfflineResponse: Promise<Response> | undefined;
    localOffline.listeners.get('fetch')?.({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: 'http://localhost:3000/',
        headers: new Headers(),
      },
      respondWith(value: Promise<Response>) {
        localOfflineResponse = value;
      },
      waitUntil() {},
    });
    expect(await (await localOfflineResponse)?.text()).toBe('cached shell');
    expect(localOffline.fetches).toEqual(['http://localhost:3000/']);

    const remote = await workerHarness('https://example.test/', {
      cachedRoot: true,
    });
    let remoteResponse: Promise<Response> | undefined;
    remote.listeners.get('fetch')?.({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: 'https://example.test/',
        headers: new Headers(),
      },
      respondWith(value: Promise<Response>) {
        remoteResponse = value;
      },
      waitUntil() {},
    });
    expect(await (await remoteResponse)?.text()).toBe('cached shell');
    expect(remote.fetches).toEqual([]);
  });

  test('a missing release resource rejects a different deployment', async () => {
    const worker = await workerHarness('https://example.test/', {
      fetch: async () => new Response('const BUILD_ID = "new-build";'),
    });
    let response: Promise<Response> | undefined;
    worker.listeners.get('fetch')?.({
      request: new Request('https://example.test/asset.js'),
      respondWith(value: Promise<Response>) {
        response = value;
      },
      waitUntil() {},
    });

    const result = await response;
    expect(result?.status).toBe(503);
    expect(result?.statusText).toBe('Release Cache Incomplete');
    expect(await result?.text()).toBe('Danmaku release cache is incomplete.');
    expect(worker.fetches).toEqual(['https://example.test/sw.js']);
    expect(worker.added).toEqual([]);
    expect(worker.puts).toEqual([]);
  });

  test('a newer deployment leaves other cached snapshot entries trusted', async () => {
    const worker = await workerHarness('https://example.test/', {
      cachedRoot: true,
      fetch: async () => new Response('const BUILD_ID = "new-build";'),
    });

    const asset = await dispatchFetch(
      worker.listeners.get('fetch'),
      new Request('https://example.test/asset.js'),
    );
    expect(asset.status).toBe(503);

    const navigation = await dispatchFetch(worker.listeners.get('fetch'), {
      method: 'GET',
      mode: 'navigate',
      url: 'https://example.test/',
      headers: new Headers(),
    });
    expect(await navigation.text()).toBe('cached shell');
    expect(worker.fetches).toEqual(['https://example.test/sw.js']);
  });

  test('an evicted cache refills the complete matching release before serving', async () => {
    const worker = await workerHarness('https://example.test/', {
      fetch: async () => new Response('const BUILD_ID = "test-build";'),
    });
    let navigation: Promise<Response> | undefined;
    worker.listeners.get('fetch')?.({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: 'https://example.test/play',
        headers: new Headers(),
      },
      respondWith(value: Promise<Response>) {
        navigation = value;
      },
      waitUntil() {},
    });

    expect(await (await navigation)?.text()).toBe('cached shell');
    expect(worker.added).toEqual([
      'https://example.test/',
      'https://example.test/asset.js',
    ]);
    expect(worker.fetches).toEqual([
      'https://example.test/sw.js',
      'https://example.test/sw.js',
    ]);

    let asset: Promise<Response> | undefined;
    worker.listeners.get('fetch')?.({
      request: new Request('https://example.test/asset.js'),
      respondWith(value: Promise<Response>) {
        asset = value;
      },
      waitUntil() {},
    });
    expect(await (await asset)?.text()).toBe(
      'cached https://example.test/asset.js',
    );
    expect(worker.fetches).toHaveLength(2);
  });

  test('a failed matching-release refill remains fail-closed', async () => {
    const worker = await workerHarness('https://example.test/', {
      fetch: async () => new Response('const BUILD_ID = "test-build";'),
      precacheError: new Error('asset refused'),
    });
    let response: Promise<Response> | undefined;
    worker.listeners.get('fetch')?.({
      request: new Request('https://example.test/asset.js'),
      respondWith(value: Promise<Response>) {
        response = value;
      },
      waitUntil() {},
    });

    expect((await response)?.status).toBe(503);
    expect(worker.fetches).toEqual(['https://example.test/sw.js']);
    expect(worker.added).toEqual([]);
    expect(worker.puts).toEqual([worker.trustUrl]);
    expect(worker.deleted).toEqual([]);
  });

  test('an atomic refill rejection preserves prior trusted entries', async () => {
    const worker = await workerHarness('https://example.test/', {
      cachedRoot: true,
      fetch: async () => new Response('const BUILD_ID = "test-build";'),
      precacheError: new Error('asset refused'),
    });

    const asset = await dispatchFetch(
      worker.listeners.get('fetch'),
      new Request('https://example.test/asset.js'),
    );
    expect(asset.status).toBe(503);

    const navigation = await dispatchFetch(worker.listeners.get('fetch'), {
      method: 'GET',
      mode: 'navigate',
      url: 'https://example.test/',
      headers: new Headers(),
    });
    expect(await navigation.text()).toBe('cached shell');
    expect(worker.fetches).toEqual(['https://example.test/sw.js']);
    expect(worker.puts).toEqual([worker.trustUrl, worker.trustUrl]);
  });

  test('a concurrent cached hit survives a failed refill that restores trust', async () => {
    const assetUrl = 'https://example.test/asset.js';
    let rejectRefill!: () => void;
    let refillStarted!: () => void;
    const refillGate = new Promise<void>((_resolve, reject) => {
      rejectRefill = () => reject(new Error('asset refused'));
    });
    const refillReady = new Promise<void>((resolve) => {
      refillStarted = resolve;
    });
    const worker = await workerHarness('https://example.test/', {
      cachedUrls: [assetUrl],
      fetch: async () => new Response('const BUILD_ID = "test-build";'),
      precache: async () => {
        refillStarted();
        await refillGate;
      },
    });

    const navigation = dispatchFetch(worker.listeners.get('fetch'), {
      method: 'GET',
      mode: 'navigate',
      url: 'https://example.test/',
      headers: new Headers(),
    });
    await refillReady;
    const asset = dispatchFetch(
      worker.listeners.get('fetch'),
      new Request(assetUrl),
    );

    rejectRefill();
    expect((await navigation).statusText).toBe('Repairing Release Cache');
    expect(await (await asset).text()).toBe(`cached ${assetUrl}`);
  });

  test('a deployment switch during refill discards the uncertain cache', async () => {
    let checks = 0;
    const worker = await workerHarness('https://example.test/', {
      fetch: async () => new Response(
        checks++ === 0
          ? 'const BUILD_ID = "test-build";'
          : 'const BUILD_ID = "new-build";',
      ),
    });
    let response: Promise<Response> | undefined;
    worker.listeners.get('fetch')?.({
      request: new Request('https://example.test/asset.js'),
      respondWith(value: Promise<Response>) {
        response = value;
      },
      waitUntil() {},
    });

    expect((await response)?.status).toBe(503);
    expect(worker.deleted).toEqual([]);
  });

  test('a post-refill failure stays poisoned across a worker restart', async () => {
    let checks = 0;
    const storage = memoryCacheStorage();
    const worker = await workerHarness('https://example.test/', {
      storage,
      fetch: async () => {
        if (checks++ === 0) {
          return new Response('const BUILD_ID = "test-build";');
        }
        throw new TypeError('offline');
      },
    });

    const first = await dispatchFetch(
      worker.listeners.get('fetch'),
      new Request('https://example.test/asset.js'),
    );
    expect(first.status).toBe(503);
    expect(worker.deleted).toEqual([]);
    expect(storage.entries.get(worker.cacheName)?.get(worker.trustUrl)).toBe(
      'untrusted',
    );

    const restarted = await workerHarness('https://example.test/', {
      storage,
      fetch: async () => new Response('const BUILD_ID = "new-build";'),
    });
    const second = await dispatchFetch(
      restarted.listeners.get('fetch'),
      new Request('https://example.test/asset.js'),
    );
    expect(second.status).toBe(503);
    expect(await second.text()).toBe('Danmaku release cache is incomplete.');
    expect(restarted.added).toEqual([]);
  });

  test('concurrent hits wait until a refill passes its second identity check', async () => {
    let checks = 0;
    let releaseSecondCheck!: () => void;
    let secondCheckStarted!: () => void;
    const secondCheck = new Promise<void>((resolve) => {
      releaseSecondCheck = resolve;
    });
    const secondCheckReady = new Promise<void>((resolve) => {
      secondCheckStarted = resolve;
    });
    const worker = await workerHarness('https://example.test/', {
      fetch: async () => {
        checks++;
        if (checks === 2) {
          secondCheckStarted();
          await secondCheck;
        }
        return new Response('const BUILD_ID = "test-build";');
      },
    });

    const first = dispatchFetch(
      worker.listeners.get('fetch'),
      new Request('https://example.test/asset.js'),
    );
    await secondCheckReady;

    let secondSettled = false;
    const second = dispatchFetch(
      worker.listeners.get('fetch'),
      new Request('https://example.test/asset.js'),
    ).then((response) => {
      secondSettled = true;
      return response;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    releaseSecondCheck();
    expect(await (await first).text()).toBe(
      'cached https://example.test/asset.js',
    );
    expect(await (await second).text()).toBe(
      'cached https://example.test/asset.js',
    );
    expect(worker.fetches).toHaveLength(2);
    expect(worker.added).toHaveLength(2);
  });

  test('a match already in flight cannot expose a failed provisional refill', async () => {
    const assetUrl = 'https://example.test/asset.js';
    let releaseAssetMatch!: () => void;
    let assetMatchStarted!: () => void;
    let blockAssetMatch = true;
    const assetMatch = new Promise<void>((resolve) => {
      releaseAssetMatch = resolve;
    });
    const assetMatchReady = new Promise<void>((resolve) => {
      assetMatchStarted = resolve;
    });
    let checks = 0;
    const worker = await workerHarness('https://example.test/', {
      cachedUrls: [assetUrl],
      match: async (_cacheName, url) => {
        if (url !== assetUrl || !blockAssetMatch) return;
        blockAssetMatch = false;
        assetMatchStarted();
        await assetMatch;
      },
      fetch: async () => new Response(
        checks++ === 0
          ? 'const BUILD_ID = "test-build";'
          : 'const BUILD_ID = "new-build";',
      ),
    });

    const pendingAsset = dispatchFetch(
      worker.listeners.get('fetch'),
      new Request(assetUrl),
    );
    await assetMatchReady;

    const navigation = await dispatchFetch(worker.listeners.get('fetch'), {
      method: 'GET',
      mode: 'navigate',
      url: 'https://example.test/',
      headers: new Headers(),
    });
    expect(navigation.statusText).toBe('Repairing Release Cache');

    releaseAssetMatch();
    const asset = await pendingAsset;
    expect(asset.status).toBe(503);
    expect(await asset.text()).toBe('Danmaku release cache is incomplete.');
  });

  test('a cached release resource is served from its snapshot', async () => {
    const assetUrl = 'https://example.test/asset.js';
    const worker = await workerHarness('https://example.test/', {
      cachedUrls: [assetUrl],
      fetch: async () => new Response('new deployment'),
    });
    let response: Promise<Response> | undefined;
    worker.listeners.get('fetch')?.({
      request: new Request(assetUrl),
      respondWith(value: Promise<Response>) {
        response = value;
      },
      waitUntil() {},
    });

    expect(await (await response)?.text()).toBe(`cached ${assetUrl}`);
    expect(worker.fetches).toEqual([]);
    expect(worker.puts).toEqual([]);
  });

  test('a different deployment returns a self-contained recovery shell', async () => {
    const worker = await workerHarness('https://example.test/', {
      fetch: async () => new Response('const BUILD_ID = "new-build";'),
    });
    let response: Promise<Response> | undefined;
    worker.listeners.get('fetch')?.({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: 'https://example.test/play',
        headers: new Headers(),
      },
      respondWith(value: Promise<Response>) {
        response = value;
      },
      waitUntil() {},
    });

    const result = await response;
    expect(result?.status).toBe(503);
    expect(result?.statusText).toBe('Repairing Release Cache');
    expect(result?.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const body = await result?.text();
    expect(body).toContain('Repairing the Danmaku release cache');
    expect(body).toContain('danmaku:activate-update');
    expect(body).toContain('installing.state === "redundant"');
    expect(body).toContain('activation will retry automatically');
    expect(body).not.toContain('<script src=');
    const script = body?.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script ?? '')).not.toThrow();
    expect(worker.fetches).toEqual(['https://example.test/sw.js']);
    expect(worker.added).toEqual([]);
    expect(worker.puts).toEqual([]);
  });

  test('a same-origin GET outside the release inventory may use the network', async () => {
    const worker = await workerHarness('https://example.test/', {
      fetch: async () => new Response('live response'),
    });
    let response: Promise<Response> | undefined;
    let cacheWrite: Promise<unknown> | undefined;
    worker.listeners.get('fetch')?.({
      request: new Request('https://example.test/runtime-data.json'),
      respondWith(value: Promise<Response>) {
        response = value;
      },
      waitUntil(value: Promise<unknown>) {
        cacheWrite = value;
      },
    });

    expect(await (await response)?.text()).toBe('live response');
    await cacheWrite;
    expect(worker.fetches).toEqual([
      'https://example.test/runtime-data.json',
    ]);
    expect(worker.puts).toEqual([
      'https://example.test/runtime-data.json',
    ]);
  });
});
