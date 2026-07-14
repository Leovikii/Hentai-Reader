import test from 'node:test';
import assert from 'node:assert/strict';
import { MaterializeScheduler } from '../src/services/materialize-scheduler.ts';

test('runs queued materializers by promoted priority with FIFO ties', async () => {
  const scheduler = new MaterializeScheduler(1);
  const order: string[] = [];
  let finishFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { finishFirst = resolve; });

  const first = scheduler.run('first', async () => {
    order.push('first');
    await firstGate;
    return 'first';
  }, 1, new AbortController().signal);
  const low = scheduler.run('low', async () => { order.push('low'); return 'low'; }, 1, new AbortController().signal);
  const promoted = scheduler.run('promoted', async () => { order.push('promoted'); return 'promoted'; }, 2, new AbortController().signal);
  scheduler.promote('low', 3);

  await Promise.resolve();
  finishFirst();
  assert.deepEqual(await Promise.all([first, low, promoted]), ['first', 'low', 'promoted']);
  assert.deepEqual(order, ['first', 'low', 'promoted']);
});

test('removes a queued materializer when its final lease aborts', async () => {
  const scheduler = new MaterializeScheduler(1);
  let finishFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { finishFirst = resolve; });
  const first = scheduler.run('first', async () => { await firstGate; }, 1, new AbortController().signal);

  const controller = new AbortController();
  let ran = false;
  const queued = scheduler.run('queued', async () => { ran = true; }, 1, controller.signal);
  controller.abort();
  await assert.rejects(queued, (error: any) => error?.name === 'AbortError');
  finishFirst();
  await first;
  assert.equal(ran, false);
});

