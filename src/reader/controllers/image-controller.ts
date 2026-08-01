import {
  acquireImage,
  getCachedImage,
  getLatestCachedImage,
} from '../../services/image-load-runtime';
import type { ImageLoadLease } from '../../services/image-load-service';
import { LOAD_PRIORITY } from '../../state/load-policy';
import type { ReaderSession } from '../reader-session';

export type ReaderImagePhase = 'resolving' | 'switching-source' | 'downloading' | 'loaded' | 'error';

export interface ReaderItemData {
  src: string;
  msrc?: string;
  w: number;
  h: number;
}

export interface ReaderSpreadItemData {
  src: '';
  w: number;
  h: number;
  hrSpread: readonly {
    index: number;
    src: string;
    alt: string;
  }[];
}

export interface ReaderImageControllerDeps {
  getCurrentIndex: () => number;
  getActiveIndices?: () => readonly number[];
  getSlideContentState: (index: number) => string | undefined;
  refreshSlide: (index: number) => void;
  onPhaseChange: (index: number, phase: ReaderImagePhase) => void;
  onAssetReady: (index: number) => void;
}

export interface ReaderImageController {
  urlAt(index: number): string | undefined;
  getItemData(index: number): ReaderItemData;
  getSpreadItemData(indices: readonly number[], width: number, height: number): ReaderSpreadItemData;
  getPhase(index: number): ReaderImagePhase;
  isLoading(index: number): boolean;
  handleContentLoad(index: number): void;
  handleLoadComplete(index: number, isError: boolean): void;
  releaseOutside(center: number): void;
  dispose(): void;
}

export function createReaderImageController(
  session: ReaderSession,
  deps: ReaderImageControllerDeps,
): ReaderImageController {
  const byteState = new Map<string, 'loading' | 'loaded' | 'error'>();
  const leases = new Map<string, { lease: ImageLoadLease; unsubscribe: () => void }>();
  let disposed = false;

  function releaseLease(url: string): void {
    const held = leases.get(url);
    if (!held) return;
    held.unsubscribe();
    held.lease.release();
    leases.delete(url);
  }

  function markLoadFailed(viewerUrl: string): void {
    releaseLease(viewerUrl);
    byteState.set(viewerUrl, 'error');
    notify(viewerUrl);
  }

  function urlAt(index: number): string | undefined {
    const itemUrl = session.itemAt(index)?.viewerUrl;
    if (itemUrl) return itemUrl;
    const el = session.elementAt(index);
    return el?.dataset.url || el?.dataset.viewerUrl || undefined;
  }

  function indexOfUrl(url: string): number {
    return session.indexOfViewerUrl(url);
  }

  function getPhase(index: number): ReaderImagePhase {
    const url = urlAt(index);
    if (!url) return 'error';
    if (byteState.get(url) === 'error') return 'error';
    const servicePhase = leases.get(url)?.lease.phase;
    if (servicePhase === 'error' || servicePhase === 'cancelled') return 'error';
    if (servicePhase === 'resolving') return 'resolving';
    if (servicePhase === 'switching-source') return 'switching-source';
    if (servicePhase === 'downloading') return 'downloading';
    if (byteState.get(url) === 'loaded' || deps.getSlideContentState(index) === 'loaded') {
      return 'loaded';
    }
    return 'downloading';
  }

  function notify(url: string): void {
    const index = indexOfUrl(url);
    if (index !== -1) deps.onPhaseChange(index, getPhase(index));
  }

  function ensureLease(index: number, viewerUrl: string): void {
    if (!viewerUrl || leases.has(viewerUrl) || disposed) return;
    const isActive = deps.getActiveIndices?.().includes(index) ?? index === deps.getCurrentIndex();
    const distance = Math.abs(index - deps.getCurrentIndex());
    const lease = acquireImage(viewerUrl, {
      intent: isActive ? 'foreground' : 'neighbor',
      priority: isActive ? LOAD_PRIORITY.foreground : LOAD_PRIORITY.foreground - distance,
    });
    leases.set(viewerUrl, { lease, unsubscribe: () => {} });
    const unsubscribe = lease.subscribe(() => notify(viewerUrl));
    leases.set(viewerUrl, { lease, unsubscribe });

    lease.result.then(asset => {
      if (disposed || leases.get(viewerUrl)?.lease !== lease) return;
      const liveIndex = indexOfUrl(viewerUrl);
      if (!asset || liveIndex === -1) {
        markLoadFailed(viewerUrl);
        return;
      }
      byteState.set(viewerUrl, 'loaded');
      notify(viewerUrl);
      deps.refreshSlide(liveIndex);
      deps.onAssetReady(liveIndex);
    }).catch(() => {
      if (disposed || leases.get(viewerUrl)?.lease !== lease) return;
      markLoadFailed(viewerUrl);
    });
  }

  function getItemData(index: number): ReaderItemData {
    const el = session.elementAt(index);
    const item = session.itemAt(index);
    if (!el) return { src: '', w: 0, h: 0 };

    const viewerUrl = item?.viewerUrl || el.dataset.url || el.dataset.viewerUrl || '';
    const fallbackSrc = (el as HTMLImageElement).dataset.realSrc
      || (el as HTMLImageElement).src
      || '';
    const cachedAsset = getCachedImage(viewerUrl);
    const resolvedSrc = cachedAsset?.src || fallbackSrc;
    let dim = cachedAsset
      ? { w: cachedAsset.width, h: cachedAsset.height }
      : undefined;

    if (!dim && item?.dimensions) {
      dim = { w: item.dimensions.width, h: item.dimensions.height };
    }
    if (!dim && el.tagName === 'IMG') {
      const htmlImg = el as HTMLImageElement;
      if (htmlImg.complete && htmlImg.naturalWidth > 0) {
        dim = { w: htmlImg.naturalWidth, h: htmlImg.naturalHeight };
      }
    }
    if (!dim) {
      const fallbackW = window.innerWidth;
      const previewSize = item?.preview.kind === 'url'
        ? item.preview.size
        : item?.preview.kind === 'sprite'
          ? item.preview.crop
          : undefined;
      let fallbackRatio = 1.414;
      if (previewSize && previewSize.width > 0 && previewSize.height > 0) {
        fallbackRatio = previewSize.height / previewSize.width;
      } else {
        const latestCached = getLatestCachedImage();
        if (latestCached && latestCached.width > 0 && latestCached.height > 0) {
          fallbackRatio = latestCached.height / latestCached.width;
        }
      }
      dim = { w: fallbackW, h: fallbackW * fallbackRatio };
    }

    const trueDimKnown = !!item?.dimensions
      || !!cachedAsset
      || (el.tagName === 'IMG'
        && (el as HTMLImageElement).complete
        && (el as HTMLImageElement).naturalWidth > 0);
    const msrc = item?.preview.kind === 'url' ? item.preview.src : undefined;

    if (viewerUrl) ensureLease(index, viewerUrl);
    const serviceReady = leases.get(viewerUrl)?.lease.phase === 'ready';
    if (serviceReady && resolvedSrc && !resolvedSrc.includes('x.gif') && trueDimKnown) {
      return { src: resolvedSrc, msrc, w: dim.w, h: dim.h };
    }
    return { src: '', msrc, w: dim.w, h: dim.h };
  }

  function handleContentLoad(index: number): void {
    const url = urlAt(index);
    if (!url || byteState.get(url) === 'loaded') return;
    byteState.set(url, 'loading');
    notify(url);
  }

  function getSpreadItemData(indices: readonly number[], width: number, height: number): ReaderSpreadItemData {
    return {
      src: '',
      w: Math.max(1, width),
      h: Math.max(1, height),
      hrSpread: indices.map(index => {
        const data = getItemData(index);
        return {
          index,
          src: data.src,
          alt: `Page ${index + 1}`,
        };
      }),
    };
  }

  function handleLoadComplete(index: number, isError: boolean): void {
    const url = urlAt(index);
    if (!url) return;
    byteState.set(url, isError ? 'error' : 'loaded');
    notify(url);
  }

  function releaseOutside(center: number): void {
    for (const url of leases.keys()) {
      const index = indexOfUrl(url);
      if (index !== -1 && Math.abs(index - center) <= 2) continue;
      releaseLease(url);
    }
  }

  function dispose(): void {
    disposed = true;
    for (const url of Array.from(leases.keys())) releaseLease(url);
  }

  return {
    urlAt,
    getItemData,
    getSpreadItemData,
    getPhase,
    isLoading: index => {
      const phase = getPhase(index);
      return phase === 'resolving' || phase === 'switching-source' || phase === 'downloading';
    },
    handleContentLoad,
    handleLoadComplete,
    releaseOutside,
    dispose,
  };
}
