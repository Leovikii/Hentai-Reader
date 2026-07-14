import { store } from '../state/store';
import { ImageLoadService, type ImageAcquireOptions } from './image-load-service';
import { MaterializeScheduler } from './materialize-scheduler';
import { CFG } from '../state/config';

const materializeScheduler = new MaterializeScheduler(CFG.maxConcurrent);

function loadImageBytes(src: string, signal: AbortSignal): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      img.onload = null;
      img.onerror = null;
    };
    const onAbort = () => {
      cleanup();
      img.src = 'data:,';
      reject(new DOMException('Image load cancelled', 'AbortError'));
    };

    img.onload = () => {
      const dimensions = { width: img.naturalWidth, height: img.naturalHeight };
      cleanup();
      resolve(dimensions);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error(`Image byte load failed: ${src}`));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else img.src = src;
  });
}

const imageLoadService = new ImageLoadService({
  resolve: async (url, nlToken, _force, priority) => {
    return store.activeAdapter?.resolveImage(url, nlToken, priority) ?? null;
  },
  materialize: (url, resolved, signal, priority) => {
    const materialize = store.activeAdapter?.materializeImage;
    if (!materialize) return Promise.resolve(resolved);
    return materializeScheduler.run(
      url,
      () => materialize(resolved, signal),
      priority,
      signal,
    );
  },
  loadBytes: loadImageBytes,
  promote: (url, priority) => {
    materializeScheduler.promote(url, priority);
  },
  revokeObjectUrl: src => URL.revokeObjectURL(src),
});

export function acquireImage(url: string, options: ImageAcquireOptions) {
  return imageLoadService.acquire(url, options);
}

export function getImageLoadStats() {
  return imageLoadService.getStats();
}

export function getCachedImage(url: string) {
  return imageLoadService.getCached(url);
}

export function getLatestCachedImage() {
  return imageLoadService.getLatestCached();
}

export function cancelImagePrefetch(keepUrls: Set<string>) {
  store.activeAdapter?.cancelPrefetch?.(keepUrls);
}
