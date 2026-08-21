import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoPlay } from '../src/reader/controllers/auto-play-controller.ts';
import type { ReaderAppContext } from '../src/reader/contracts.ts';

test('autoplay replaces its timer and enforces the one-second runtime floor', () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const delays: number[] = [];
  const cleared: number[] = [];
  let timerId = 0;
  globalThis.setInterval = ((_: TimerHandler, delay?: number) => {
    timerId++;
    delays.push(Number(delay));
    return timerId;
  }) as typeof setInterval;
  globalThis.clearInterval = (id => {
    cleared.push(Number(id));
  }) as typeof clearInterval;

  let enabled = true;
  let interval = 0;
  const context = {
    isAutoPlayEnabled: () => enabled,
    setAutoPlayEnabled: (value: boolean) => { enabled = value; },
    getAutoPlayInterval: () => interval,
  } as unknown as ReaderAppContext;

  try {
    const autoPlay = createAutoPlay(() => {}, context);
    autoPlay.start();
    interval = 7000;
    autoPlay.start();
    autoPlay.reset();
    assert.deepEqual(delays, [1000, 7000, 7000]);
    assert.deepEqual(cleared, [1, 2]);

    autoPlay.stopAtEnd();
    assert.equal(enabled, false);
    assert.deepEqual(cleared, [1, 2, 3]);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
