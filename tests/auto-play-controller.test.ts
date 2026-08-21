import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_PLAY_LOAD_GRACE_MS,
  createAutoPlay,
} from '../src/reader/controllers/auto-play-controller.ts';
import type { ReaderAppContext } from '../src/reader/contracts.ts';

test('autoplay waits once for loading and then advances without permanent blocking', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const delays: number[] = [];
  const callbacks = new Map<number, () => void>();
  let timerId = 0;
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
    timerId++;
    delays.push(Number(delay));
    callbacks.set(timerId, callback as () => void);
    return timerId;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (id => {
    callbacks.delete(Number(id));
  }) as typeof clearTimeout;

  let enabled = true;
  let interval = 0;
  let loaded = false;
  let advances = 0;
  const context = {
    isAutoPlayEnabled: () => enabled,
    setAutoPlayEnabled: (value: boolean) => { enabled = value; },
    getAutoPlayInterval: () => interval,
  } as unknown as ReaderAppContext;

  try {
    const runTimer = (id: number) => {
      const callback = callbacks.get(id);
      assert.ok(callback);
      callbacks.delete(id);
      callback();
    };
    const autoPlay = createAutoPlay(() => { advances++; }, () => loaded, context);
    autoPlay.start();
    assert.deepEqual(delays, [1000]);
    runTimer(1);
    assert.equal(advances, 0);
    assert.deepEqual(delays, [1000, AUTO_PLAY_LOAD_GRACE_MS]);

    runTimer(2);
    assert.equal(advances, 1);
    assert.deepEqual(delays, [1000, AUTO_PLAY_LOAD_GRACE_MS, 1000]);

    loaded = true;
    runTimer(3);
    assert.equal(advances, 2);
    assert.deepEqual(delays, [1000, AUTO_PLAY_LOAD_GRACE_MS, 1000, 1000]);

    interval = 7000;
    autoPlay.reset();
    assert.equal(callbacks.size, 1);
    assert.equal(delays[delays.length - 1], 7000);

    autoPlay.stopAtEnd();
    assert.equal(enabled, false);
    assert.equal(callbacks.size, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
