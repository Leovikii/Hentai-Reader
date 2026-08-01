import { store } from '../state/store';
import { ImageLoadService, type ImageAcquireOptions } from './image-load-service';
import { MaterializeScheduler } from './materialize-scheduler';
import { ImageTaskScheduler, type ImageTaskLane } from './image-task-scheduler';
import { CFG } from '../state/config';

const materializeScheduler = new MaterializeScheduler(CFG.imageMaterializeConcurrent);
type NetworkInformationLike = EventTarget & {
  effectiveType?: string;
  saveData?: boolean;
};

function currentImageTaskLimits() {
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (document.visibilityState === 'hidden' || connection?.saveData) {
    return { total: 4, background: 0 };
  }
  if (connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') {
    return { total: 2, background: 1 };
  }
  return { total: 4, background: 2 };
}

const imageTaskScheduler = new ImageTaskScheduler(currentImageTaskLimits);
document.addEventListener('visibilitychange', () => imageTaskScheduler.notifyLimitsChanged());
const networkConnection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
networkConnection?.addEventListener('change', () => imageTaskScheduler.notifyLimitsChanged());

function loadImageBytes(
  src: string,
  signal: AbortSignal,
  _priority: number,
  lane: ImageTaskLane,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.fetchPriority = lane === 'foreground' ? 'high' : 'low';

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
  resolve: async (url, context) => {
    return store.activeAdapter?.resolveImage(url, context) ?? null;
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
  schedule: (url, task, options) => imageTaskScheduler.run(url, task, options),
  promote: (url, priority, lane) => {
    imageTaskScheduler.promote(url, priority, lane);
    materializeScheduler.promote(url, priority);
    store.activeAdapter?.imageRequestQueue?.promote?.(url, priority);
  },
  revokeObjectUrl: src => URL.revokeObjectURL(src),
});

export function acquireImage(url: string, options: ImageAcquireOptions) {
  return imageLoadService.acquire(url, options);
}

export function getImageLoadStats() {
  return {
    ...imageLoadService.getStats(),
    scheduler: imageTaskScheduler.getStats(),
  };
}

export function getCachedImage(url: string) {
  return imageLoadService.getCached(url);
}

export function getImageDimensionsHint(url: string) {
  return imageLoadService.getDimensionsHint(url);
}

export function getLatestCachedImage() {
  return imageLoadService.getLatestCached();
}

export function cancelImagePrefetch(keepUrls: Set<string>) {
  store.activeAdapter?.imageRequestQueue?.cancelPrefetch?.(keepUrls);
}
