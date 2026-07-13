import test from 'node:test';
import assert from 'node:assert/strict';
import type { GalleryItem } from '../src/core/gallery.ts';
import {
  createThumbnailPlan,
  selectThumbnailFallbacks,
} from '../src/services/thumbnail-service.ts';

const item = (key: string, preview: GalleryItem['preview']): GalleryItem => ({
  key,
  viewerUrl: `${key}-viewer`,
  preview,
});

test('prefers cheap URL and sprite previews even when a full image is loaded', () => {
  assert.deepEqual(createThumbnailPlan(item('url', { kind: 'url', src: 'thumb' }), 'full'), {
    src: 'thumb',
    requestFullImage: false,
  });
  assert.deepEqual(createThumbnailPlan(item('sprite', {
    kind: 'sprite',
    src: 'sheet',
    crop: { x: 10, y: 20, width: 30, height: 40 },
  }), 'full'), {
    src: 'sheet',
    crop: { x: 10, y: 20, width: 30, height: 40 },
    requestFullImage: false,
  });
});

test('uses a loaded full image only when no cheap preview exists', () => {
  assert.deepEqual(createThumbnailPlan(item('none', { kind: 'none' })), {
    requestFullImage: true,
  });
  assert.deepEqual(createThumbnailPlan(item('none', { kind: 'none' }), 'decoded'), {
    src: 'decoded',
    requestFullImage: false,
  });
});

test('limits missing-preview fallbacks and prioritizes the current neighbourhood', () => {
  const items = [
    item('0', { kind: 'none' }),
    item('1', { kind: 'url', src: 'cheap' }),
    item('2', { kind: 'none' }),
    item('3', { kind: 'derived' }),
    item('4', { kind: 'none' }),
    item('5', { kind: 'none' }),
  ];

  assert.deepEqual(selectThumbnailFallbacks(items, [0, 1, 2, 3, 4, 5], 4, 3), [4, 3, 5]);
  assert.deepEqual(selectThumbnailFallbacks(items, [0, 2], 0, 0), []);
});
