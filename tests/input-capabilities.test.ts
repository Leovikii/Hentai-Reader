import test from 'node:test';
import assert from 'node:assert/strict';
import { getReaderInputCapabilities } from '../src/utils/input-capabilities.ts';

function matcher(activeQueries: readonly string[]): (query: string) => boolean {
  const active = new Set(activeQueries);
  return query => active.has(query);
}

test('a normal mouse desktop uses desktop Reader controls', () => {
  const capabilities = getReaderInputCapabilities(
    matcher(['(hover: hover) and (pointer: fine)']),
    0,
  );
  assert.equal(capabilities.touchOnlyUi, false);
});

test('a fine-hover desktop ignores false-positive touch capabilities', () => {
  const capabilities = getReaderInputCapabilities(
    matcher([
      '(any-hover: hover) and (any-pointer: fine)',
      '(any-pointer: coarse)',
    ]),
    5,
  );
  assert.equal(capabilities.touchOnlyUi, false);
});

test('a coarse-pointer mobile device uses touch-only Reader controls', () => {
  const capabilities = getReaderInputCapabilities(
    matcher(['(pointer: coarse)', '(any-pointer: coarse)']),
    5,
  );
  assert.equal(capabilities.touchOnlyUi, true);
});
