import assert from 'node:assert/strict';
import type { GalleryPage } from '../src/core/gallery';
import type { GalleryAdapter } from '../src/core/site-adapter';

export function assertGalleryPageContract(page: GalleryPage, requestedUrl: string): void {
  assert.equal(page.pageUrl, requestedUrl);
  const keys = new Set<string>();
  for (const item of page.items) {
    assert.ok(item.key, 'GalleryItem.key must be stable and non-empty');
    assert.ok(item.viewerUrl, 'GalleryItem.viewerUrl must be non-empty');
    assert.equal(keys.has(item.key), false, `duplicate GalleryItem.key: ${item.key}`);
    keys.add(item.key);
    assert.ok(['url', 'sprite', 'derived', 'none'].includes(item.preview.kind));
    if (item.dimensions) {
      assert.ok(Number.isFinite(item.dimensions.width) && item.dimensions.width > 0);
      assert.ok(Number.isFinite(item.dimensions.height) && item.dimensions.height > 0);
    }
  }
  assert.ok(page.nextUrl === null || typeof page.nextUrl === 'string');
  assert.ok(page.prevUrl === null || typeof page.prevUrl === 'string');
}

export async function assertAdapterInitialPageContract(
  adapter: GalleryAdapter,
  doc: Document,
  url: string,
): Promise<void> {
  assertGalleryPageContract(await adapter.loadInitialPage(doc, url), url);
}
