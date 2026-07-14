import type { LoadedImage } from '../../core/image';
import type { ImageAcquireOptions, ImageLoadLease } from '../../services/image-load-service';
import type { ReaderScrollBridge } from '../contracts';
import type { ReaderSession } from '../reader-session';

export type ThumbnailPreloadPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface ThumbnailController {
  preload(indices: readonly number[]): void;
  cancelPreloads(): void;
  finishPreload(index: number, failed?: boolean): void;
  getPreloadedAsset(index: number): LoadedImage | undefined;
  getPreloadPhase(index: number): ThumbnailPreloadPhase;
  subscribeChange(listener: (index: number) => void): () => void;
}

type AcquireImage = (url: string, options: ImageAcquireOptions) => ImageLoadLease;

export interface ThumbnailControllerDeps {
  acquire: AcquireImage;
  maxConcurrent?: number;
  priority: number;
}

interface PreloadEntry {
  phase: Exclude<ThumbnailPreloadPhase, 'idle'>;
  lease?: ImageLoadLease;
  asset?: LoadedImage;
  releaseSlot?: () => void;
}

/** Owns bounded thumbnail leases without exposing loading or scroll internals to UI. */
export function createThumbnailController(
  session: ReaderSession,
  scroll: ReaderScrollBridge,
  deps: ThumbnailControllerDeps,
): ThumbnailController {
  const acquire = deps.acquire;
  const maxConcurrent = Math.max(1, deps.maxConcurrent ?? 2);
  const entries = new Map<number, PreloadEntry>();
  const listeners = new Set<(index: number) => void>();
  let pending: number[] = [];
  let active = 0;

  function notify(index: number): void {
    listeners.forEach(listener => listener(index));
  }

  function releaseEntry(entry: PreloadEntry): void {
    entry.releaseSlot?.();
    entry.releaseSlot = undefined;
    entry.lease?.release();
    entry.lease = undefined;
    entry.asset = undefined;
  }

  function pump(): void {
    while (active < maxConcurrent && pending.length > 0) {
      const index = pending.shift()!;
      const entry = entries.get(index);
      const item = session.itemAt(index);
      if (!entry || entry.phase !== 'loading' || !item) continue;

      active++;
      let slotHeld = true;
      entry.releaseSlot = () => {
        if (!slotHeld) return;
        slotHeld = false;
        active--;
      };

      const lease = acquire(item.viewerUrl, {
        intent: 'thumbnail',
        priority: deps.priority,
      });
      entry.lease = lease;

      lease.result.then(asset => {
        if (entries.get(index) !== entry) return;
        if (!asset) {
          releaseEntry(entry);
          entry.phase = 'error';
        } else {
          entry.asset = asset;
          entry.phase = 'ready';
        }
        notify(index);
      }).catch(() => {
        if (entries.get(index) !== entry) return;
        releaseEntry(entry);
        entry.phase = 'error';
        notify(index);
      }).finally(() => {
        entry.releaseSlot?.();
        entry.releaseSlot = undefined;
        pump();
      });
    }
  }

  function cancelPreloads(): void {
    pending = [];
    const changed = Array.from(entries.keys());
    entries.forEach(releaseEntry);
    entries.clear();
    changed.forEach(notify);
    pump();
  }

  function preload(indices: readonly number[]): void {
    cancelPreloads();
    const unique = new Set<number>();
    for (const index of indices) {
      if (unique.has(index)) continue;
      const item = session.itemAt(index);
      if (!item || (item.preview.kind !== 'none' && item.preview.kind !== 'derived')) continue;

      const element = session.elementAt(index) as HTMLImageElement | undefined;
      if (element?.tagName === 'IMG' && element.complete && element.naturalWidth > 0) continue;

      unique.add(index);
      entries.set(index, { phase: 'loading' });
      pending.push(index);
      notify(index);
    }
    pump();
  }

  function finishPreload(index: number, failed = false): void {
    const entry = entries.get(index);
    if (!entry) return;
    releaseEntry(entry);
    if (failed) {
      entry.phase = 'error';
    } else {
      entries.delete(index);
    }
    notify(index);
  }

  return {
    preload,
    cancelPreloads,
    finishPreload,
    getPreloadedAsset(index) {
      return entries.get(index)?.asset;
    },
    getPreloadPhase(index) {
      return entries.get(index)?.phase ?? 'idle';
    },
    subscribeChange(listener) {
      listeners.add(listener);
      const unsubscribeScroll = scroll.subscribeImageLoaded(event => listener(event.index));
      return () => {
        listeners.delete(listener);
        unsubscribeScroll();
      };
    },
  };
}
