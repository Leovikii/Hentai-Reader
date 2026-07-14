import test from 'node:test';
import assert from 'node:assert/strict';
import type { GalleryItem } from '../src/core/gallery.ts';
import { createThumbnailPlan } from '../src/services/thumbnail-service.ts';

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
