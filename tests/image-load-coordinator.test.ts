import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageLoadCoordinator, type ImageResolver } from '../src/services/image-load-coordinator.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createCoordinator(resolver: ImageResolver | null) {
  const cache = new Map<string, string>();
  const coordinator = new ImageLoadCoordinator({
    getResolver: () => resolver,
    getCachedSource: (url) => cache.get(url),
    setCachedSource: (url, src) => cache.set(url, src),
  });
  return { coordinator, cache };
}

test('deduplicates ordinary resolves and promotes the queued task', async () => {
  const pending = deferred<{ src: string } | null>();
  let calls = 0;
  let bumps = 0;
  const { coordinator, cache } = createCoordinator({
    resolveImage: async () => { calls++; return pending.promise; },
    bumpPriority: () => { bumps++; },
  });

  const first = coordinator.resolve('viewer', undefined, false, 5);
  const second = coordinator.resolve('viewer', undefined, false, 100);
  assert.equal(first, second);
  assert.equal(calls, 1);
  assert.equal(bumps, 1);

  pending.resolve({ src: 'image' });
  assert.deepEqual(await first, { src: 'image' });
  assert.equal(cache.get('viewer'), 'image');
  assert.deepEqual(coordinator.getDiagnostics(), {
    resolveStarted: 1,
    resolveDeduped: 1,
    resolveForced: 0,
    resolveSucceeded: 1,
    resolveFailed: 0,
    priorityPromoted: 1,
  });
});

test('plain callers share an in-flight force refresh when no cache is available', async () => {
  const pending = deferred<{ src: string } | null>();
  let calls = 0;
  const { coordinator } = createCoordinator({
    resolveImage: async () => { calls++; return pending.promise; },
  });

  const forced = coordinator.resolve('viewer', 'node-token', true, 20);
  const plain = coordinator.resolve('viewer');
  assert.equal(forced, plain);
  assert.equal(calls, 1);
  pending.resolve({ src: 'fresh' });
  assert.deepEqual(await plain, { src: 'fresh' });
});

test('plain callers prefer an active force refresh over an older ordinary resolve', async () => {
  const ordinaryPending = deferred<{ src: string } | null>();
  const forcePending = deferred<{ src: string } | null>();
  let calls = 0;
  const { coordinator, cache } = createCoordinator({
    resolveImage: async () => (++calls === 1 ? ordinaryPending.promise : forcePending.promise),
  });

  const ordinary = coordinator.resolve('viewer');
  const forced = coordinator.resolve('viewer', 'node-token', true);
  const laterPlain = coordinator.resolve('viewer');
  assert.equal(laterPlain, forced);
  assert.notEqual(laterPlain, ordinary);

  forcePending.resolve({ src: 'fresh' });
  ordinaryPending.resolve({ src: 'ordinary' });
  assert.deepEqual(await laterPlain, { src: 'fresh' });
  await ordinary;
  assert.equal(cache.get('viewer'), 'fresh');
});

test('uses completed cache for plain requests and bypasses it for force requests', async () => {
  let calls = 0;
  const { coordinator, cache } = createCoordinator({
    resolveImage: async () => ({ src: `fresh-${++calls}` }),
  });
  cache.set('viewer', 'cached');

  assert.deepEqual(await coordinator.resolve('viewer'), { src: 'cached' });
  assert.equal(calls, 0);
  assert.deepEqual(await coordinator.resolve('viewer', undefined, true), { src: 'fresh-1' });
  assert.equal(cache.get('viewer'), 'fresh-1');
});

test('evicts failed in-flight work so a later request can recover', async () => {
  let calls = 0;
  const { coordinator } = createCoordinator({
    resolveImage: async () => {
      calls++;
      if (calls === 1) throw new Error('temporary');
      return { src: 'recovered' };
    },
  });

  assert.equal(await coordinator.resolve('viewer'), null);
  assert.deepEqual(await coordinator.resolve('viewer'), { src: 'recovered' });
  assert.equal(calls, 2);
});

test('returns null when no resolver is active', async () => {
  const { coordinator } = createCoordinator(null);
  assert.equal(await coordinator.resolve('viewer'), null);
});
