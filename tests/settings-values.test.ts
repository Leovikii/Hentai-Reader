import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAutoPlayIntervalMs,
  normalizeAutoPlaySeconds,
  normalizeDoublePageDirection,
  stepAutoPlaySeconds,
} from '../src/state/settings-values.ts';

test('normalizes autoplay seconds to whole values within the 1–60 range', () => {
  assert.equal(normalizeAutoPlaySeconds(0), 1);
  assert.equal(normalizeAutoPlaySeconds(-20), 1);
  assert.equal(normalizeAutoPlaySeconds(7), 7);
  assert.equal(normalizeAutoPlaySeconds(7.6), 8);
  assert.equal(normalizeAutoPlaySeconds(80), 60);
  assert.equal(normalizeAutoPlaySeconds('', 12), 12);
  assert.equal(normalizeAutoPlaySeconds(Number.NaN, 9), 9);
});

test('normalizes persisted autoplay milliseconds with a hard one-second floor', () => {
  assert.equal(normalizeAutoPlayIntervalMs(0), 1000);
  assert.equal(normalizeAutoPlayIntervalMs(-5000), 1000);
  assert.equal(normalizeAutoPlayIntervalMs(7000), 7000);
  assert.equal(normalizeAutoPlayIntervalMs(12_600), 13_000);
  assert.equal(normalizeAutoPlayIntervalMs(''), 5000);
});

test('steps from the current manual value by five seconds without requiring multiples of five', () => {
  assert.equal(stepAutoPlaySeconds(7, 1), 12);
  assert.equal(stepAutoPlaySeconds(7, -1), 2);
  assert.equal(stepAutoPlaySeconds(1, -1), 1);
  assert.equal(stepAutoPlaySeconds(60, 1), 60);
  assert.equal(stepAutoPlaySeconds(Number.NaN, 1, 8), 13);
});

test('accepts only the persisted rtl direction and otherwise preserves the ltr default', () => {
  assert.equal(normalizeDoublePageDirection('rtl'), 'rtl');
  assert.equal(normalizeDoublePageDirection('ltr'), 'ltr');
  assert.equal(normalizeDoublePageDirection('RTL'), 'ltr');
  assert.equal(normalizeDoublePageDirection(undefined), 'ltr');
});
