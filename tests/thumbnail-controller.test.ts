import test from 'node:test';
import assert from 'node:assert/strict';
import type { GalleryItem } from '../src/core/gallery.ts';
import type { LoadedImage } from '../src/core/image.ts';
import type { ReaderScrollBridge } from '../src/reader/contracts.ts';
import {
  createThumbnailController,
} from '../src/reader/controllers/thumbnail-controller.ts';
import { ReaderSession } from '../src/reader/reader-session.ts';
import { ImageLoadService, type ImageLoadLease } from '../src/services/image-load-service.ts';

function item(index: number, preview: GalleryItem['preview'] = { kind: 'none' }): GalleryItem {
  return {
    key: `item-${index}`,
    viewerUrl: `viewer-${index}`,
    preview,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function scrollBridge(): ReaderScrollBridge {
  return {
    pause() {},
    resume() {},
    requestImage() {},
    subscribeImageLoaded() { return () => {}; },
    restore() {},
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('queues every missing preview in supplied centre-out order with concurrency two', async () => {
  const items = [
    item(0),
    item(1, { kind: 'url', src: 'cheap-thumb' }),
    item(2, { kind: 'derived' }),
    item(3),
  ];
  const session = new ReaderSession(() => items);
  const pending = new Map<string, ReturnType<typeof deferred<LoadedImage | null>>>();
  const starts: string[] = [];
  const releases = new Map<string, number>();

  const controller = createThumbnailController(session, scrollBridge(), {
    maxConcurrent: 2,
    priority: 10,
    acquire(url): ImageLoadLease {
      starts.push(url);
      const task = deferred<LoadedImage | null>();
      pending.set(url, task);
      return {
        url,
        result: task.promise,
        phase: 'downloading',
        subscribe: () => () => {},
        release: () => releases.set(url, (releases.get(url) ?? 0) + 1),
      };
    },
  });

  controller.preload([2, 1, 3, 0, 2]);
  assert.deepEqual(starts, ['viewer-2', 'viewer-3']);
  assert.equal(controller.getPreloadPhase(1), 'idle');
  assert.equal(controller.getPreloadPhase(0), 'loading');

  pending.get('viewer-2')!.resolve({ src: 'blob:2', width: 800, height: 1200 });
  await flush();
  assert.deepEqual(starts, ['viewer-2', 'viewer-3', 'viewer-0']);
  assert.equal(controller.getPreloadedAsset(2)?.src, 'blob:2');

  controller.finishPreload(2);
  assert.equal(releases.get('viewer-2'), 1);
  assert.equal(controller.getPreloadPhase(2), 'idle');

  controller.cancelPreloads();
});

test('cancels stale leases and lets a new settled batch start immediately', () => {
  const items = [item(0), item(1), item(2)];
  const session = new ReaderSession(() => items);
  const pending = new Map<string, ReturnType<typeof deferred<LoadedImage | null>>>();
  const starts: string[] = [];
  const releases = new Map<string, number>();

  const controller = createThumbnailController(session, scrollBridge(), {
    maxConcurrent: 2,
    priority: 10,
    acquire(url): ImageLoadLease {
      starts.push(url);
      const task = deferred<LoadedImage | null>();
      pending.set(url, task);
      return {
        url,
        result: task.promise,
        phase: 'downloading',
        subscribe: () => () => {},
        release: () => releases.set(url, (releases.get(url) ?? 0) + 1),
      };
    },
  });

  controller.preload([0, 1, 2]);
  assert.deepEqual(starts, ['viewer-0', 'viewer-1']);

  controller.cancelPreloads();
  assert.equal(releases.get('viewer-0'), 1);
  assert.equal(releases.get('viewer-1'), 1);
  assert.equal(controller.getPreloadPhase(0), 'idle');

  controller.preload([2]);
  assert.deepEqual(starts, ['viewer-0', 'viewer-1', 'viewer-2']);
  controller.cancelPreloads();
});

test('reader and thumbnail consumers share one image lifecycle', async () => {
  const items = [item(0)];
  const session = new ReaderSession(() => items);
  let resolves = 0;
  let byteLoads = 0;
  const service = new ImageLoadService({
    resolve: async url => {
      resolves++;
      return { src: `resolved:${url}` };
    },
    loadBytes: async () => {
      byteLoads++;
      return { width: 800, height: 1200 };
    },
  });
  const controller = createThumbnailController(session, scrollBridge(), {
    acquire: (url, options) => service.acquire(url, options),
    priority: 10,
  });

  controller.preload([0]);
  const readerLease = service.acquire('viewer-0', { intent: 'foreground', priority: 100 });
  await readerLease.result;
  await flush();

  assert.equal(resolves, 1);
  assert.equal(byteLoads, 1);
  assert.equal(controller.getPreloadPhase(0), 'ready');

  controller.finishPreload(0);
  readerLease.release();
});
