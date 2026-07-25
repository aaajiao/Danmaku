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

interface WorkerHarness {
  readonly cacheName: string;
  readonly cachePrefix: string;
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
    precacheError?: Error;
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
  const cache = {
    async addAll(requests: Request[]): Promise<void> {
      installOrder.push('precache');
      if (options.precacheError !== undefined) {
        throw options.precacheError;
      }
      added.push(...requests.map((request) => request.url));
    },
    async match(key: Request | string): Promise<Response | undefined> {
      const url = typeof key === 'string' ? key : key.url;
      if (options.cachedRoot === true && url === scope) {
        return new Response('cached shell');
      }
      return options.cachedUrls?.includes(url) === true
        ? new Response(`cached ${url}`)
        : undefined;
    },
    async put(request: Request): Promise<void> {
      puts.push(request.url);
    },
  };
  const cacheStorage = {
    async open(name: string): Promise<typeof cache> {
      opened.push(name);
      return cache;
    },
    async keys(): Promise<string[]> {
      return options.existingCaches ?? [];
    },
    async delete(name: string): Promise<boolean> {
      deleted.push(name);
      return true;
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
    `${source}\n({ cacheName: CACHE_NAME, cachePrefix: CACHE_PREFIX });`,
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
  ) as { cacheName: string; cachePrefix: string };

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

  test('a missing release resource fails closed without fetching the deployment', async () => {
    const worker = await workerHarness('https://example.test/', {
      fetch: async () => new Response('new deployment'),
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
    expect(worker.fetches).toEqual([]);
    expect(worker.puts).toEqual([]);
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

  test('a missing navigation shell fails closed without fetching the deployment', async () => {
    const worker = await workerHarness('https://example.test/', {
      fetch: async () => new Response('new deployment'),
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
    expect(await result?.text()).toBe('Danmaku release cache is incomplete.');
    expect(worker.fetches).toEqual([]);
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
