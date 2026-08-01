import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpreadLayout, formatSpreadCounter } from '../src/reader/controllers/spread-layout.ts';

const portrait = (key: string) => ({ key, width: 600, height: 900 });

test('pairs fixed portrait slots when the viewport is wide enough', () => {
  const layout = createSpreadLayout([portrait('a'), portrait('b'), portrait('c')], { width: 1400, height: 900 }, true);
  assert.deepEqual(layout.spreads.map(spread => spread.logicalIndices), [[0, 1], [2]]);
  assert.equal(layout.spreads[0].state, 'pair');
  assert.equal(layout.spreadIndexForLogical(1), 0);
  assert.equal(formatSpreadCounter(layout.spreads[0], 10, 3), '11\u201312 / 13');
});

test('splits a fixed slot for landscape, square, disabled, or narrow layouts', () => {
  const invalidSeconds = [
    { key: 'landscape', width: 1000, height: 700 },
    { key: 'square', width: 800, height: 800 },
  ];
  for (const second of invalidSeconds) {
    assert.deepEqual(
      createSpreadLayout([portrait('a'), second], { width: 1400, height: 900 }, true).spreads.map(s => s.logicalIndices),
      [[0], [1]],
    );
  }
  assert.equal(createSpreadLayout([portrait('a'), portrait('b')], { width: 1400, height: 900 }, false).spreads.length, 2);
  assert.equal(createSpreadLayout([portrait('a'), portrait('b')], { width: 1000, height: 900 }, true).spreads.length, 2);
});

test('keeps a recoverable failed portrait in its stable pair slot', () => {
  const layout = createSpreadLayout(
    [portrait('a'), { key: 'failed', width: 600, height: 900, failed: true }],
    { width: 1400, height: 900 },
    true,
  );
  assert.deepEqual(layout.spreads.map(spread => spread.logicalIndices), [[0, 1]]);
  assert.equal(layout.spreads[0].state, 'pending-pair');
});

test('reserves a stable pending pair on a wide viewport until dimensions arrive', () => {
  const pending = createSpreadLayout(
    [{ key: 'a' }, { key: 'b' }],
    { width: 1400, height: 900 },
    true,
  );
  assert.deepEqual(pending.spreads.map(spread => spread.logicalIndices), [[0, 1]]);
  assert.equal(pending.spreads[0].state, 'pending-pair');
  assert.equal(pending.spreads[0].key, 'pair:a:b');
  assert.deepEqual(
    { width: pending.spreads[0].width, height: pending.spreads[0].height },
    { width: 1400, height: 900 },
  );

  const confirmed = createSpreadLayout(
    [portrait('a'), portrait('b')],
    { width: 1400, height: 900 },
    true,
  );
  assert.equal(confirmed.spreads[0].state, 'pair');
  assert.equal(confirmed.spreads[0].key, pending.spreads[0].key);
});

test('does not reserve an unknown pair when the viewport is too narrow', () => {
  const layout = createSpreadLayout(
    [{ key: 'a' }, { key: 'b' }],
    { width: 1000, height: 900 },
    true,
  );
  assert.deepEqual(layout.spreads.map(spread => spread.logicalIndices), [[0], [1]]);
});

test('keeps fixed pair ownership and the selected logical member across recomputation', () => {
  const pages = [portrait('a'), portrait('b'), portrait('c'), portrait('d')];
  const wide = createSpreadLayout(pages, { width: 1400, height: 900 }, true, 'b');
  assert.equal(wide.spreads[0].primaryIndex, 1);
  const narrow = createSpreadLayout(pages, { width: 900, height: 900 }, true, 'b');
  assert.equal(narrow.spreadIndexForLogical(1), 1);
  const wideAgain = createSpreadLayout(pages, { width: 1400, height: 900 }, true, 'b');
  assert.deepEqual(wideAgain.spreads.map(s => s.logicalIndices), [[0, 1], [2, 3]]);
  assert.equal(wideAgain.spreads[0].primaryIndex, 1);
});

test('maps either thumbnail member to one spread and can change its primary page', () => {
  const layout = createSpreadLayout([portrait('a'), portrait('b')], { width: 1400, height: 900 }, true);
  const selected = layout.withPrimaryLogical(1);
  assert.equal(selected.spreadIndexForLogical(0), 0);
  assert.equal(selected.spreadIndexForLogical(1), 0);
  assert.equal(selected.logicalIndexForSpread(0), 1);
});
