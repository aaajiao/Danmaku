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
  readonly claimed: { count: number };
}

async function workerHarness(
  scope: string,
  options: {
    existingCaches?: string[];
    fetch?: FetchLike;
    cachedRoot?: boolean;
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
  const claimed = { count: 0 };
  const location = new URL(scope);
  const cache = {
    async addAll(requests: Request[]): Promise<void> {
      added.push(...requests.map((request) => request.url));
    },
    async match(key: Request | string): Promise<Response | undefined> {
      const url = typeof key === 'string' ? key : key.url;
      return options.cachedRoot === true && url === scope
        ? new Response('cached shell')
        : undefined;
    },
    async put(): Promise<void> {
      // Dynamic cache-fill behavior is outside these lifecycle assertions.
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
      async claim(): Promise<void> {
        claimed.count++;
      },
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
    claimed,
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
});
