import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageLoadService } from '../src/services/image-load-service.ts';
import type { ImageLoadPhase } from '../src/core/image.ts';
import { EHentaiAdapter } from '../src/sites/e-hentai/index.ts';

class FixtureDOMParser {
  parseFromString(html: string): Document {
    const src = html.match(/\bsrc="([^"]+)"/)?.[1] ?? '';
    const onerror = html.match(/\bonerror="([^"]+)"/)?.[1] ?? '';
    const image = {
      src,
      getAttribute: (name: string) => name === 'onerror' ? onerror : null,
    };
    return {
      querySelector: (selector: string) => selector === '#img' && src ? image : null,
    } as unknown as Document;
  }
}

test('E-Hentai follows an nl chain and publishes the first healthy Hath source', async () => {
  const originalFetch = globalThis.fetch;
  const originalDOMParser = globalThis.DOMParser;
  const viewerRequests: Array<{ url: string; cache?: RequestCache }> = [];

  Object.defineProperty(globalThis, 'DOMParser', {
    value: FixtureDOMParser,
    configurable: true,
    writable: true,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    viewerRequests.push({ url, cache: init?.cache });
    const token = new URL(url).searchParams.get('nl');
    const html = token === 'node-c'
      ? '<img id="img" src="https://node-c.hath.network/image.webp">'
      : token === 'node-b'
        ? '<img id="img" src="https://node-b.hath.network/image.webp" onerror="return nl(\'node-c\')">'
        : '<img id="img" src="https://node-a.hath.network/image.webp" onerror="return nl(\'node-b\')">';
    return new Response(html, { status: 200 });
  }) as typeof fetch;

  try {
    const byteRequests: string[] = [];
    const phases: ImageLoadPhase[] = [];
    const service = new ImageLoadService({
      resolve: (url, context) => EHentaiAdapter.resolveImage(url, context),
      loadBytes: async src => {
        byteRequests.push(src);
        if (!src.includes('node-c')) throw new Error('simulated failed Hath node');
        return { width: 800, height: 1200 };
      },
      delay: async () => {},
    }, {
      resolveAttempts: 1,
      alternateSourceRetries: 2,
      freshResolveRetries: 0,
      retryDelay: 0,
      cacheEntries: 4,
    });

    const viewerUrl = 'https://e-hentai.org/s/token/1';
    const lease = service.acquire(viewerUrl, { intent: 'foreground', priority: 100 });
    const unsubscribe = lease.subscribe(phase => phases.push(phase));
    const asset = await lease.result;

    assert.equal(asset?.src, 'https://node-c.hath.network/image.webp');
    assert.deepEqual(byteRequests, [
      'https://node-a.hath.network/image.webp',
      'https://node-b.hath.network/image.webp',
      'https://node-c.hath.network/image.webp',
    ]);
    assert.deepEqual(viewerRequests, [
      { url: viewerUrl, cache: undefined },
      { url: `${viewerUrl}?nl=node-b`, cache: 'no-store' },
      { url: `${viewerUrl}?nl=node-c`, cache: 'no-store' },
    ]);
    assert.equal(phases.filter(phase => phase === 'switching-source').length, 2);
    assert.equal(phases[phases.length - 1], 'ready');

    unsubscribe();
    lease.release();
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'DOMParser', {
      value: originalDOMParser,
      configurable: true,
      writable: true,
    });
  }
});
