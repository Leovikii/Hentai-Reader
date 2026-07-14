import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EmptyGalleryPageError,
  GalleryPageLoader,
} from '../src/core/gallery-page-loader.ts';
import type { GalleryAdapter } from '../src/core/site-adapter.ts';

function page(pageUrl: string, nextUrl: string | null = null) {
  return {
    pageUrl,
    items: [{ key: `${pageUrl}-item`, viewerUrl: `${pageUrl}-viewer`, preview: { kind: 'none' as const } }],
    nextUrl,
    prevUrl: null,
  };
}

test('deduplicates concurrent page requests and stops already loaded pages', async () => {
  let calls = 0;
  let resolveRequest!: (value: ReturnType<typeof page>) => void;
  const adapter: GalleryAdapter = {
    loadInitialPage: async () => page('initial'),
    loadPage: async () => {
      calls++;
      return new Promise(resolve => { resolveRequest = resolve; });
    },
  };
  const loader = new GalleryPageLoader(adapter);

  const first = loader.loadPage('next');
  const second = loader.loadPage('next');
  assert.equal(first, second);
  assert.equal(calls, 1);

  resolveRequest(page('next'));
  assert.equal((await first)?.pageUrl, 'next');
  assert.equal(await loader.loadPage('next'), null);
  assert.equal(calls, 1);
});

test('removes failed requests from in-flight state so retry can succeed', async () => {
  let calls = 0;
  const adapter: GalleryAdapter = {
    loadInitialPage: async () => page('initial'),
    loadPage: async url => {
      calls++;
      if (calls === 1) throw new Error('temporary');
      return page(url);
    },
  };
  const loader = new GalleryPageLoader(adapter);

  await assert.rejects(loader.loadPage('retry'), /temporary/);
  assert.equal((await loader.loadPage('retry'))?.pageUrl, 'retry');
  assert.equal(calls, 2);
});

test('rejects empty fetched pages without marking them loaded', async () => {
  let calls = 0;
  const adapter: GalleryAdapter = {
    loadInitialPage: async () => page('initial'),
    loadPage: async url => {
      calls++;
      return { ...page(url), items: [] };
    },
  };
  const loader = new GalleryPageLoader(adapter);

  await assert.rejects(loader.loadPage('empty'), EmptyGalleryPageError);
  await assert.rejects(loader.loadPage('empty'), EmptyGalleryPageError);
  assert.equal(calls, 2);
});

test('cuts self-loops and links back to an already loaded page', async () => {
  const adapter: GalleryAdapter = {
    loadInitialPage: async () => page('initial', 'next'),
    loadPage: async url => ({ ...page(url, url), prevUrl: 'initial' }),
  };
  const loader = new GalleryPageLoader(adapter);

  const initial = await loader.loadInitialPage({} as Document, 'initial');
  const next = await loader.loadPage(initial.nextUrl!);
  assert.equal(next?.nextUrl, null);
  assert.equal(next?.prevUrl, null);
});

test('forwards AbortSignal to the adapter', async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const adapter: GalleryAdapter = {
    loadInitialPage: async () => page('initial'),
    loadPage: async (url, signal) => {
      received = signal;
      return page(url);
    },
  };

  await new GalleryPageLoader(adapter).loadPage('next', controller.signal);
  assert.equal(received, controller.signal);
});
