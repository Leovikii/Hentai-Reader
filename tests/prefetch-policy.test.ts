import test from 'node:test';
import assert from 'node:assert/strict';
import { getReaderPrefetchIndices } from '../src/state/load-policy.ts';

test('builds the shared 5/2 forward window in nearest-first order', () => {
  const indices = getReaderPrefetchIndices(20, 100, 1);
  assert.equal(indices.length, 8);
  assert.deepEqual(indices, [20, 21, 19, 22, 18, 23, 24, 25]);
  assert.equal(Math.min(...indices), 18);
  assert.equal(Math.max(...indices), 25);
});

test('reverses the 5/2 bias and clips it at gallery boundaries', () => {
  assert.deepEqual(getReaderPrefetchIndices(2, 8, -1), [2, 1, 3, 0, 4]);
});

test('supports a site-specific prefetch override', () => {
  const indices = getReaderPrefetchIndices(20, 100, 1, { ahead: 2, behind: 1 });
  assert.deepEqual(indices, [20, 21, 19, 22]);
});
