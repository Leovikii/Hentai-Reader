import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageLoadService } from '../src/services/image-load-service.ts';

const noDelay = async () => {};

test('deduplicates the full lifecycle and retains it until every lease releases', async () => {
  let resolves = 0;
  let downloads = 0;
  const service = new ImageLoadService({
    resolve: async url => { resolves++; return { src: `${url}-src` }; },
    loadBytes: async () => { downloads++; return { width: 100, height: 200 }; },
    delay: noDelay,
  });

  const first = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  const second = service.acquire('viewer', { intent: 'warmup', priority: 5 });
  assert.equal(first.result, second.result);
  assert.equal((await first.result)?.height, 200);
  assert.equal(resolves, 1);
  assert.equal(downloads, 1);
  assert.equal(service.getCached('viewer')?.src, 'viewer-src');
  assert.equal(service.getLatestCached()?.src, 'viewer-src');

  const unsubscribe = first.subscribe(() => {});
  assert.equal(service.getStats().listeners, 1);
  unsubscribe();
  assert.equal(service.getStats().listeners, 0);

  first.release();
  const cached = service.acquire('viewer', { intent: 'scroll', priority: 0 });
  assert.equal((await cached.result)?.src, 'viewer-src');
  assert.equal(downloads, 1);
  second.release();
  cached.release();
});

test('reuses a cached owned Blob when reader hands it directly back to scroll', async () => {
  let resolves = 0;
  let downloads = 0;
  const service = new ImageLoadService({
    resolve: async () => {
      resolves++;
      return { src: 'blob:shared', ownsObjectUrl: true };
    },
    loadBytes: async () => {
      downloads++;
      return { width: 800, height: 1200 };
    },
    delay: noDelay,
  });

  const reader = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  await reader.result;
  reader.release();
  const scroll = service.acquire('viewer', { intent: 'scroll', priority: 50 });
  assert.equal((await scroll.result)?.src, 'blob:shared');
  assert.equal(resolves, 1);
  assert.equal(downloads, 1);
  assert.equal(service.getCached('viewer')?.src, 'blob:shared');
  assert.equal(service.getLatestCached()?.src, 'blob:shared');
  assert.deepEqual(service.getStats(), {
    activeLoads: 0,
    cachedEntries: 1,
    activeLeases: 0,
    cachedLeases: 1,
    leasedCacheEntries: 1,
    ownedObjectUrls: 1,
    phases: 1,
    listeners: 0,
  });
  scroll.release();
});

test('materializes a shared source once and publishes only the final display URL', async () => {
  let materializations = 0;
  const published: string[] = [];
  const service = new ImageLoadService({
    resolve: async () => ({ src: 'raw-source', materializeData: { kind: 'test' } }),
    materialize: async (_url, resolved) => {
      materializations++;
      assert.equal(resolved.src, 'raw-source');
      return { src: 'blob:display', ownsObjectUrl: true };
    },
    loadBytes: async src => {
      assert.equal(src, 'blob:display');
      return { width: 50, height: 75 };
    },
    setResolvedSource: (_url, src) => published.push(src),
    delay: noDelay,
  });

  const first = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  const second = service.acquire('viewer', { intent: 'scroll', priority: 50 });
  assert.equal((await first.result)?.src, 'blob:display');
  assert.equal(await second.result, await first.result);
  assert.equal(materializations, 1);
  assert.deepEqual(published, ['blob:display']);
  first.release();
  second.release();
});

test('publishes dimensions once when a shared asset becomes ready', async () => {
  const ready: Array<{ url: string; width: number; height: number }> = [];
  const service = new ImageLoadService({
    resolve: async url => ({ src: `${url}-src` }),
    loadBytes: async () => ({ width: 640, height: 960 }),
    onReady: (url, asset) => ready.push({ url, width: asset.width, height: asset.height }),
    delay: noDelay,
  });

  const first = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  const second = service.acquire('viewer', { intent: 'warmup', priority: 5 });
  await Promise.all([first.result, second.result]);
  const cached = service.acquire('viewer', { intent: 'scroll', priority: 1 });
  await cached.result;

  assert.deepEqual(ready, [{ url: 'viewer', width: 640, height: 960 }]);
  first.release();
  second.release();
  cached.release();
});

test('cancels byte loading only after the last active lease releases', async () => {
  let observedSignal: AbortSignal | undefined;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const service = new ImageLoadService({
    resolve: async () => ({ src: 'src' }),
    loadBytes: async (_src, signal) => {
      observedSignal = signal;
      markStarted();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    },
    delay: noDelay,
  });

  const first = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  const second = service.acquire('viewer', { intent: 'warmup', priority: 5 });
  await started;
  first.release();
  assert.equal(observedSignal?.aborted, false);
  second.release();
  assert.equal(observedSignal?.aborted, true);
  assert.equal(await first.result, null);
  assert.equal(service.getPhase('viewer'), 'cancelled');
});

test('revokes an owned object URL when its byte load never succeeds', async () => {
  const revoked: string[] = [];
  const service = new ImageLoadService({
    resolve: async () => ({ src: 'blob:failed', ownsObjectUrl: true }),
    loadBytes: async () => { throw new Error('broken blob'); },
    delay: noDelay,
    revokeObjectUrl: src => revoked.push(src),
  }, { resolveAttempts: 1, nodeRetries: 0, plainRetries: 0 });

  const lease = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  assert.equal(await lease.result, null);
  assert.deepEqual(revoked, ['blob:failed']);
  lease.release();
});

test('uses the centralized resolve, node-switch and plain retry budgets', async () => {
  const calls: Array<{ nl?: string; force: boolean }> = [];
  let downloads = 0;
  const service = new ImageLoadService({
    resolve: async (_url, nl, force) => {
      calls.push({ nl, force });
      if (calls.length < 3) return null;
      if (nl) return { src: 'node-src', nl: undefined };
      return { src: 'plain-src', nl: 'node-token' };
    },
    loadBytes: async () => {
      downloads++;
      if (downloads < 3) throw new Error('byte failure');
      return { width: 10, height: 20 };
    },
    delay: noDelay,
  }, { resolveAttempts: 4, nodeRetries: 3, plainRetries: 2 });

  const lease = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  assert.equal((await lease.result)?.width, 10);
  assert.deepEqual(calls, [
    { nl: undefined, force: false },
    { nl: undefined, force: true },
    { nl: undefined, force: true },
    { nl: 'node-token', force: true },
    { nl: undefined, force: true },
  ]);
  assert.equal(downloads, 3);
  lease.release();
});

test('evicts only unleased owned object URLs', async () => {
  const revoked: string[] = [];
  const service = new ImageLoadService({
    resolve: async url => ({ src: `blob:${url}`, ownsObjectUrl: true }),
    loadBytes: async () => ({ width: 1, height: 1 }),
    delay: noDelay,
    revokeObjectUrl: src => revoked.push(src),
  }, { cacheEntries: 1 });

  const first = service.acquire('first', { intent: 'foreground', priority: 1 });
  await first.result;
  const second = service.acquire('second', { intent: 'foreground', priority: 1 });
  await second.result;
  assert.deepEqual(revoked, []);

  first.release();
  const third = service.acquire('third', { intent: 'foreground', priority: 1 });
  await third.result;
  assert.deepEqual(revoked, ['blob:first']);
  second.release();
  third.release();
});

test('keeps long galleries bounded and clears metadata for every evicted asset', async () => {
  const revoked: string[] = [];
  const invalidated: string[] = [];
  const evicted: string[] = [];
  const service = new ImageLoadService({
    resolve: async url => ({ src: `blob:${url}`, ownsObjectUrl: true }),
    loadBytes: async () => ({ width: 1, height: 1 }),
    delay: noDelay,
    invalidateResolved: url => invalidated.push(url),
    revokeObjectUrl: src => revoked.push(src),
    onEvict: url => evicted.push(url),
  }, { cacheEntries: 80 });

  for (let index = 0; index < 1000; index++) {
    const lease = service.acquire(`item-${index}`, { intent: 'scroll', priority: 1 });
    await lease.result;
    lease.release();
  }

  assert.equal(revoked.length, 920);
  assert.equal(invalidated.length, 920);
  assert.equal(evicted.length, 920);
  assert.equal(revoked[0], 'blob:item-0');
  assert.equal(revoked[revoked.length - 1], 'blob:item-919');
  assert.equal(service.getCached('item-0'), undefined);
  assert.equal(service.getCached('item-919'), undefined);
  assert.equal(service.getCached('item-999')?.src, 'blob:item-999');
  assert.equal(service.getLatestCached()?.src, 'blob:item-999');
  assert.deepEqual(service.getStats(), {
    activeLoads: 0,
    cachedEntries: 80,
    activeLeases: 0,
    cachedLeases: 0,
    leasedCacheEntries: 0,
    ownedObjectUrls: 80,
    phases: 80,
    listeners: 0,
  });
});

test('protects leased scroll Blobs and returns to the cache bound after final release', async () => {
  const revoked: string[] = [];
  const service = new ImageLoadService({
    resolve: async url => ({ src: `blob:${url}`, ownsObjectUrl: true }),
    loadBytes: async () => ({ width: 1, height: 1 }),
    delay: noDelay,
    revokeObjectUrl: src => revoked.push(src),
  }, { cacheEntries: 80 });
  const leases = [];

  for (let index = 0; index < 300; index++) {
    const lease = service.acquire(`item-${index}`, { intent: 'scroll', priority: 1 });
    leases.push(lease);
    await lease.result;
  }

  assert.equal(service.getStats().cachedEntries, 300);
  assert.equal(service.getStats().cachedLeases, 300);
  assert.equal(revoked.length, 0);

  for (const lease of leases) lease.release();

  const stats = service.getStats();
  assert.equal(stats.cachedEntries, 80);
  assert.equal(stats.cachedLeases, 0);
  assert.equal(stats.ownedObjectUrls, 80);
  assert.equal(revoked.length, 220);

  const reverse = service.acquire('item-299', { intent: 'foreground', priority: 100 });
  assert.equal((await reverse.result)?.src, 'blob:item-299');
  assert.equal(revoked.length, 220);
  reverse.release();
});
