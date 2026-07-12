import test from 'node:test';
import assert from 'node:assert/strict';
import { NetLimiter, type LimiterClock } from '../src/services/net-limiter.ts';

class FakeClock implements LimiterClock {
  private time = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; callback: () => void }>();

  now = () => this.time;
  setTimeout = (callback: () => void, delay: number) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delay, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  clearTimeout = (rawId: ReturnType<typeof setTimeout>) => {
    this.timers.delete(rawId as unknown as number);
  };

  get timerCount() {
    return this.timers.size;
  }

  advance(ms: number) {
    this.time += ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= this.time)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }
}

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('keeps a single wake timer and reschedules it when cooldown is extended', async () => {
  const clock = new FakeClock();
  const limiter = new NetLimiter(1, clock);
  let ran = false;

  limiter.pauseFor(100);
  limiter.run(async () => { ran = true; });
  assert.equal(clock.timerCount, 1);

  limiter.pauseFor(200);
  assert.equal(clock.timerCount, 1);
  clock.advance(209);
  await flushPromises();
  assert.equal(ran, false);

  clock.advance(1);
  await flushPromises();
  assert.equal(ran, true);
});

test('runs higher priority queued work first and preserves FIFO for ties', async () => {
  const limiter = new NetLimiter(1);
  const blocker = deferred<void>();
  const order: string[] = [];

  const first = limiter.run(async () => { order.push('active'); await blocker.promise; });
  const low = limiter.run(async () => { order.push('low'); }, 1);
  const highA = limiter.run(async () => { order.push('high-a'); }, 10);
  const highB = limiter.run(async () => { order.push('high-b'); }, 10);
  await flushPromises();
  blocker.resolve();
  await Promise.all([first, low, highA, highB]);

  assert.deepEqual(order, ['active', 'high-a', 'high-b', 'low']);
});

test('releases a slot when a task throws synchronously', async () => {
  const limiter = new NetLimiter(1);
  const failed = limiter.run(() => { throw new Error('sync'); });
  let recovered = false;
  const next = limiter.run(async () => { recovered = true; });

  await assert.rejects(failed, /sync/);
  await next;
  assert.equal(recovered, true);
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
