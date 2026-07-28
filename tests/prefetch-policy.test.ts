import test from 'node:test';
import assert from 'node:assert/strict';
import { getReaderPrefetchIndices } from '../src/state/load-policy.ts';

test('builds a 6/3 forward window in nearest-first order', () => {
  const indices = getReaderPrefetchIndices(20, 100, 1);
  assert.equal(indices.length, 10);
  assert.deepEqual(indices.slice(0, 7), [20, 21, 19, 22, 18, 23, 17]);
  assert.equal(Math.min(...indices), 17);
  assert.equal(Math.max(...indices), 26);
});

test('reverses the 6/3 bias and clips it at gallery boundaries', () => {
  assert.deepEqual(getReaderPrefetchIndices(2, 8, -1), [2, 1, 3, 0, 4, 5]);
});

test('supports a conservative site-specific prefetch window', () => {
  const indices = getReaderPrefetchIndices(20, 100, 1, { ahead: 5, behind: 2 });
  assert.deepEqual(indices, [20, 21, 19, 22, 18, 23, 24, 25]);
});
