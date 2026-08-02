import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageTaskScheduler } from '../src/services/image-task-scheduler.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('reserves two slots for foreground image lifecycles', async () => {
  const scheduler = new ImageTaskScheduler(() => ({ total: 4, background: 2 }));
  const started: string[] = [];
  const gates = new Map<string, ReturnType<typeof deferred<void>>>();

  const run = (key: string, lane: 'foreground' | 'background', priority: number) => {
    const gate = deferred<void>();
    gates.set(key, gate);
    return scheduler.run(key, async () => {
      started.push(key);
      await gate.promise;
      return key;
    }, { priority, lane, signal: new AbortController().signal });
  };

  const bg1 = run('bg-1', 'background', 1);
  const bg2 = run('bg-2', 'background', 1);
  const bg3 = run('bg-3', 'background', 1);
  await Promise.resolve();
  assert.deepEqual(started, ['bg-1', 'bg-2']);

  const fg1 = run('fg-1', 'foreground', 100);
  const fg2 = run('fg-2', 'foreground', 99);
  await Promise.resolve();
  assert.deepEqual(started, ['bg-1', 'bg-2', 'fg-1', 'fg-2']);
  assert.deepEqual(scheduler.getStats(), {
    active: 4,
    activeBackground: 2,
    queued: 1,
    queuedBackground: 1,
  });

  gates.get('fg-1')!.resolve();
  await fg1;
  assert.equal(started.includes('bg-3'), false);
  gates.get('bg-1')!.resolve();
  await bg1;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(started.includes('bg-3'), true);

  for (const key of ['bg-2', 'bg-3', 'fg-2']) gates.get(key)!.resolve();
  await Promise.all([bg2, bg3, fg2]);
});

test('promotes one queued background task into a reserved foreground slot', async () => {
  const scheduler = new ImageTaskScheduler(() => ({ total: 4, background: 2 }));
  const started: string[] = [];
  const gates = new Map<string, ReturnType<typeof deferred<void>>>();

  const run = (key: string) => {
    const gate = deferred<void>();
    gates.set(key, gate);
    return scheduler.run(key, async () => {
      started.push(key);
      await gate.promise;
    }, { priority: 1, lane: 'background', signal: new AbortController().signal });
  };

  const jobs = [run('one'), run('two'), run('three')];
  await Promise.resolve();
  assert.deepEqual(started, ['one', 'two']);
  scheduler.promote('three', 100, 'foreground');
  await Promise.resolve();
  assert.deepEqual(started, ['one', 'two', 'three']);

  for (const gate of gates.values()) gate.resolve();
  await Promise.all(jobs);
});

test('holds hidden-page speculation until limits allow it', async () => {
  let backgroundLimit = 0;
  const scheduler = new ImageTaskScheduler(() => ({ total: 4, background: backgroundLimit }));
  let started = false;
  const task = scheduler.run('hidden', async () => {
    started = true;
    return 1;
  }, {
    priority: 1,
    lane: 'background',
    signal: new AbortController().signal,
  });
  await Promise.resolve();
  assert.equal(started, false);
  backgroundLimit = 2;
  scheduler.notifyLimitsChanged();
  assert.equal(await task, 1);
});

test('removes an aborted queued task without consuming a slot', async () => {
  const scheduler = new ImageTaskScheduler(() => ({ total: 4, background: 0 }));
  const controller = new AbortController();
  const task = scheduler.run('cancelled', async () => 1, {
    priority: 1,
    lane: 'background',
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(task, { name: 'AbortError' });
  assert.deepEqual(scheduler.getStats(), {
    active: 0,
    activeBackground: 0,
    queued: 0,
    queuedBackground: 0,
  });
});
