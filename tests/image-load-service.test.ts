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
    ownedBlobBytes: 0,
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
  }, { resolveAttempts: 1, alternateSourceRetries: 0, freshResolveRetries: 0 });

  const lease = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  assert.equal(await lease.result, null);
  assert.deepEqual(revoked, ['blob:failed']);
  lease.release();
});

test('uses the centralized resolve, alternate-source and fresh retry budgets', async () => {
  const calls: Array<{ token?: string; force: boolean }> = [];
  let downloads = 0;
  const service = new ImageLoadService({
    resolve: async (_url, context) => {
      const { retryToken, force } = context;
      calls.push({ token: retryToken, force });
      if (calls.length < 3) return null;
      if (retryToken) return { src: 'alternate-src' };
      return {
        src: calls.length >= 5 ? 'fresh-second-src' : 'fresh-src',
        retryToken: 'alternate-token',
      };
    },
    loadBytes: async () => {
      downloads++;
      if (downloads < 3) throw new Error('byte failure');
      return { width: 10, height: 20 };
    },
    delay: noDelay,
  }, { resolveAttempts: 4, alternateSourceRetries: 3, freshResolveRetries: 2 });

  const lease = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  assert.equal((await lease.result)?.width, 10);
  assert.deepEqual(calls, [
    { token: undefined, force: false },
    { token: undefined, force: true },
    { token: undefined, force: true },
    { token: 'alternate-token', force: true },
    { token: undefined, force: true },
  ]);
  assert.equal(downloads, 3);
  lease.release();
});

test('aborts a timed-out byte attempt and switches to the alternate source', async () => {
  const contexts: Array<{ token?: string; signal: AbortSignal }> = [];
  const phases: string[] = [];
  const service = new ImageLoadService({
    resolve: async (_url, context) => {
      contexts.push({ token: context.retryToken, signal: context.signal });
      return context.retryToken
        ? { src: 'fast-source', loadTimeoutMs: 50 }
        : { src: 'slow-source', retryToken: 'switch-source', loadTimeoutMs: 5 };
    },
    loadBytes: async (src, signal) => {
      if (src === 'fast-source') return { width: 20, height: 30 };
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
      });
    },
    delay: noDelay,
  }, { resolveAttempts: 1, alternateSourceRetries: 1, freshResolveRetries: 0 });

  const lease = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  const unsubscribe = lease.subscribe(phase => phases.push(phase));
  assert.equal((await lease.result)?.src, 'fast-source');
  assert.deepEqual(contexts.map(context => context.token), [undefined, 'switch-source']);
  assert.equal(contexts[0].signal, contexts[1].signal);
  assert.equal(phases.includes('switching-source'), true);
  unsubscribe();
  lease.release();
});

test('retains an alternate token across a transient resolver failure', async () => {
  const tokens: Array<string | undefined> = [];
  let alternateResolves = 0;
  const service = new ImageLoadService({
    resolve: async (_url, context) => {
      tokens.push(context.retryToken);
      if (!context.retryToken) return { src: 'failed-source', retryToken: 'next-node' };
      alternateResolves++;
      return alternateResolves === 1 ? null : { src: 'healthy-source' };
    },
    loadBytes: async src => {
      if (src === 'failed-source') throw new Error('simulated failed source');
      return { width: 20, height: 30 };
    },
    delay: noDelay,
  }, { resolveAttempts: 1, alternateSourceRetries: 2, freshResolveRetries: 0 });

  const lease = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  assert.equal((await lease.result)?.src, 'healthy-source');
  assert.deepEqual(tokens, [undefined, 'next-node', 'next-node']);
  lease.release();
});

test('does not switch sources for speculative background consumers', async () => {
  for (const intent of ['warmup', 'thumbnail'] as const) {
    const contexts: Array<string | undefined> = [];
    const phases: string[] = [];
    const service = new ImageLoadService({
      resolve: async (_url, context) => {
        contexts.push(context.retryToken);
        return context.retryToken
          ? { src: 'alternate-source' }
          : { src: 'failed-source', retryToken: 'alternate-token' };
      },
      loadBytes: async () => { throw new Error('simulated unavailable source'); },
      delay: noDelay,
    }, { resolveAttempts: 1, alternateSourceRetries: 3, freshResolveRetries: 2 });

    const lease = service.acquire(`viewer-${intent}`, { intent, priority: 10 });
    const unsubscribe = lease.subscribe(phase => phases.push(phase));
    assert.equal(await lease.result, null);
    assert.deepEqual(contexts, [undefined]);
    assert.equal(phases.includes('switching-source'), false);
    unsubscribe();
    lease.release();
  }
});

test('upgrades a shared background load when a demand consumer joins', async () => {
  let rejectInitial!: (error: Error) => void;
  const initialAttempt = new Promise<never>((_resolve, reject) => { rejectInitial = reject; });
  const contexts: Array<string | undefined> = [];
  const service = new ImageLoadService({
    resolve: async (_url, context) => {
      contexts.push(context.retryToken);
      return context.retryToken
        ? { src: 'healthy-source' }
        : { src: 'failed-source', retryToken: 'alternate-token' };
    },
    loadBytes: async src => src === 'failed-source'
      ? initialAttempt
      : { width: 20, height: 30 },
    delay: noDelay,
  }, { resolveAttempts: 1, alternateSourceRetries: 1, freshResolveRetries: 0 });

  const warmup = service.acquire('viewer', { intent: 'warmup', priority: 5 });
  await Promise.resolve();
  const foreground = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  rejectInitial(new Error('simulated unavailable source'));

  assert.equal((await foreground.result)?.src, 'healthy-source');
  assert.equal(foreground.result, warmup.result);
  assert.deepEqual(contexts, [undefined, 'alternate-token']);
  warmup.release();
  foreground.release();
});

test('stops a repeated candidate from consuming the alternate-source budget', async () => {
  let resolves = 0;
  let downloads = 0;
  const service = new ImageLoadService({
    resolve: async (_url, _context) => {
      resolves++;
      if (resolves === 3) return { src: 'fresh-plain' };
      return { src: 'same-source', retryToken: 'same-token' };
    },
    loadBytes: async src => {
      downloads++;
      if (src === 'same-source') throw new Error('failed');
      return { width: 10, height: 10 };
    },
    delay: noDelay,
  }, { resolveAttempts: 1, alternateSourceRetries: 3, freshResolveRetries: 1 });

  const lease = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  assert.equal((await lease.result)?.src, 'fresh-plain');
  assert.equal(resolves, 3);
  assert.equal(downloads, 2);
  lease.release();
});

test('does not return to an already failed source after an alternate was attempted', async () => {
  const contexts: Array<string | undefined> = [];
  const downloads: string[] = [];
  const service = new ImageLoadService({
    resolve: async (_url, context) => {
      contexts.push(context.retryToken);
      return context.retryToken
        ? { src: 'alternate-source' }
        : { src: 'original-source', retryToken: 'alternate-token' };
    },
    loadBytes: async src => {
      downloads.push(src);
      throw new Error('simulated unavailable source');
    },
    delay: noDelay,
  }, { resolveAttempts: 1, alternateSourceRetries: 1, freshResolveRetries: 2 });

  const lease = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  assert.equal(await lease.result, null);
  assert.deepEqual(contexts, [undefined, 'alternate-token', undefined]);
  assert.deepEqual(downloads, ['original-source', 'alternate-source']);
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

  assert.equal(revoked.length, 976);
  assert.equal(invalidated.length, 976);
  assert.equal(evicted.length, 976);
  assert.equal(revoked[0], 'blob:item-0');
  assert.equal(revoked[revoked.length - 1], 'blob:item-975');
  assert.equal(service.getCached('item-0'), undefined);
  assert.equal(service.getCached('item-919'), undefined);
  assert.equal(service.getCached('item-999')?.src, 'blob:item-999');
  assert.equal(service.getLatestCached()?.src, 'blob:item-999');
  assert.deepEqual(service.getStats(), {
    activeLoads: 0,
    cachedEntries: 24,
    activeLeases: 0,
    cachedLeases: 0,
    leasedCacheEntries: 0,
    ownedObjectUrls: 24,
    ownedBlobBytes: 0,
    phases: 24,
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
  assert.equal(stats.cachedEntries, 24);
  assert.equal(stats.cachedLeases, 0);
  assert.equal(stats.ownedObjectUrls, 24);
  assert.equal(stats.ownedBlobBytes, 0);
  assert.equal(revoked.length, 276);

  const reverse = service.acquire('item-299', { intent: 'foreground', priority: 100 });
  assert.equal((await reverse.result)?.src, 'blob:item-299');
  assert.equal(revoked.length, 276);
  reverse.release();
});

test('reuses dimensions from an already-decoded materialized Blob', async () => {
  let byteLoads = 0;
  const service = new ImageLoadService({
    resolve: async () => ({ src: 'raw', materializeData: { kind: 'test' } }),
    materialize: async () => ({
      src: 'blob:decoded',
      ownsObjectUrl: true,
      byteSize: 123,
      decodedDimensions: { width: 800, height: 1200 },
    }),
    loadBytes: async () => {
      byteLoads++;
      return { width: 1, height: 1 };
    },
    delay: noDelay,
  });

  const lease = service.acquire('viewer', { intent: 'foreground', priority: 100 });
  const asset = await lease.result;
  assert.equal(byteLoads, 0);
  assert.equal(asset?.width, 800);
  assert.equal(asset?.height, 1200);
  lease.release();
});

test('enforces exact managed Blob bytes without revoking an active lease', async () => {
  const revoked: string[] = [];
  const service = new ImageLoadService({
    resolve: async url => ({
      src: `blob:${url}`,
      ownsObjectUrl: true,
      byteSize: 60,
    }),
    loadBytes: async () => ({ width: 1, height: 1 }),
    delay: noDelay,
    revokeObjectUrl: src => revoked.push(src),
  }, { cacheEntries: 10, ownedObjectUrlEntries: 10, ownedBlobBytes: 100 });

  const first = service.acquire('first', { intent: 'scroll', priority: 1 });
  await first.result;
  const second = service.acquire('second', { intent: 'scroll', priority: 1 });
  await second.result;
  assert.deepEqual(revoked, []);
  assert.equal(service.getStats().ownedBlobBytes, 120);

  first.release();
  assert.deepEqual(revoked, ['blob:first']);
  assert.equal(service.getStats().ownedBlobBytes, 60);
  second.release();
});
