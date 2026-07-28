import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSiteAdapterTemplate,
  directPreview,
  noPreview,
} from '../src/sites/_template/index.ts';
import { assertAdapterInitialPageContract } from './site-adapter-contract.ts';

const emptyDocument = {
  querySelector: () => null,
  querySelectorAll: () => [],
} as unknown as Document;

test('new-site template supplies direct resolve and standard preview capabilities', async () => {
  const adapter = createSiteAdapterTemplate({
    name: 'Template test',
    scrollPolicy: { defaultEnabled: false, configurable: true },
    readerPrefetch: { ahead: 3, behind: 1 },
    match: url => url.includes('example.test'),
    extractItems: () => [
      {
        key: 'one',
        viewerUrl: 'https://example.test/image-1.jpg',
        preview: directPreview('https://example.test/thumb-1.jpg', 100, 150),
      },
      {
        key: 'two',
        viewerUrl: 'https://example.test/image-2.jpg',
        preview: noPreview(true),
      },
    ],
    getNextUrl: () => null,
    getPrevUrl: () => null,
    containerSelector: '#gallery',
  });

  await assertAdapterInitialPageContract(adapter, emptyDocument, 'https://example.test/gallery');
  assert.deepEqual(adapter.scrollPolicy, { defaultEnabled: false, configurable: true });
  assert.deepEqual(adapter.readerPrefetch, { ahead: 3, behind: 1 });
  assert.deepEqual(await adapter.resolveImage('https://example.test/image-1.jpg', {
    priority: 100,
    force: false,
    signal: new AbortController().signal,
  }), {
    src: 'https://example.test/image-1.jpg',
  });
});
