import { store } from '../state/store';
import { prefetchImageUrl } from './scroll-mode';

/**
 * Windowed byte-prefetch controller for the PhotoSwipe reader.
 *
 * Downloads images in a sliding window (AHEAD in travel direction, BEHIND in
 * the opposite) to balance reading smoothness with resource use. On large jumps
 * (thumbnail-panel navigation), aborts out-of-window byte-downloads and asks the
 * active adapter to cancel queued resolve/decode work, freeing slots for the new
 * position immediately.
 *
 * Each adapter cancels its own queue — e-hentai drops low-priority resolves from
 * the rate limiter, 18comic clears its canvas-decode mutex, 4khd has no queue.
 * The window is deliberately modest (5/2) to respect metered sites while staying
 * smooth on others.
 */

const AHEAD = 5;   // images to prefetch ahead in the travel direction
const BEHIND = 2;  // keep two behind so small back-steps are instant

export interface PrefetchController {
  /**
   * Recentre the window on `center`, biased in `direction` (+1 forward / -1
   * back). Starts byte-downloads for freshly-covered indices and aborts those
   * that dropped out. A large jump (thumbnail-panel) is just a distant centre:
   * the whole old window falls outside and is released.
   */
  setWindow(center: number, direction: 1 | -1): void;

  /** Prefetch specific indices regardless of the window (dwell warm-up). */
  warmup(indices: number[]): void;

  /** Abort every in-flight prefetch download (reader close). */
  clear(): void;
}

export function createPrefetchController(): PrefetchController {
  // viewerUrl -> the Image driving its byte download. Held so we can abort by
  // clearing .src when the index leaves the window.
  const downloads = new Map<string, HTMLImageElement>();
  let lastCenter = -1;  // previous window centre; -1 = fresh (treat next as a jump)

  function urlAt(index: number): string | undefined {
    const el = store.allImages[index];
    return el?.dataset.url || el?.dataset.viewerUrl || undefined;
  }

  // Kick off (or reuse) the byte download for one image. Resolve first (shared,
  // deduped, low priority), then load the bytes into a held Image so the
  // browser HTTP-caches them for the viewer's later `new Image().src`.
  function ensureDownload(url: string): void {
    if (downloads.has(url)) return;                 // already downloading
    if (store.resolvedUrls.has(url)) {
      // Resolved already; a quick byte fetch still warms the HTTP cache.
      startImage(url, store.resolvedUrls.get(url)!);
      return;
    }
    // Placeholder occupies the map slot so concurrent calls don't double-fetch;
    // replaced with the real Image once resolve lands.
    downloads.set(url, new Image());
    prefetchImageUrl(url, undefined, false, 5).then(res => {
      // Aborted (removed from map) while resolving, or resolve failed.
      if (!downloads.has(url)) return;
      if (!res || !res.src) { downloads.delete(url); return; }
      startImage(url, res.src);
    }).catch(() => { downloads.delete(url); });
  }

  function startImage(url: string, src: string): void {
    const existing = downloads.get(url);
    if (existing && existing.src) return;           // real download already running
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (img.naturalWidth > 0) {
        store.imageDimensions.set(url, { w: img.naturalWidth, h: img.naturalHeight });
      }
      downloads.delete(url);                        // bytes now in HTTP cache
    };
    img.onerror = () => { downloads.delete(url); };
    downloads.set(url, img);
    img.src = src;
  }

  function abort(url: string): void {
    const img = downloads.get(url);
    if (img) img.src = '';                           // cancel in-flight transfer
    downloads.delete(url);
  }

  function setWindow(center: number, direction: 1 | -1): void {
    const total = store.allImages.length;
    if (total === 0) return;

    const lo = Math.max(0, center - (direction === 1 ? BEHIND : AHEAD));
    const hi = Math.min(total - 1, center + (direction === 1 ? AHEAD : BEHIND));

    const wanted = new Set<string>();
    for (let i = lo; i <= hi; i++) {
      const url = urlAt(i);
      if (url) wanted.add(url);
    }

    // Abort downloads that dropped out of the window (the skipped-past images).
    for (const url of Array.from(downloads.keys())) {
      if (!wanted.has(url)) abort(url);
    }

    // On a jump (new window doesn't touch the old centre) tell the adapter to
    // drop the prefetch work still queued for the abandoned position, so its
    // resolve/decode slots free up for the new window at once. `wanted` is the
    // set of URLs the new window still needs — the adapter cancels everything
    // else it has queued. On a normal ±1 step the windows overlap, so skip this:
    // cancelling work the step still wants would just stall it.
    const jumped = lastCenter < 0 || Math.abs(center - lastCenter) > AHEAD + BEHIND;
    if (jumped) store.activeAdapter?.cancelPrefetch?.(wanted);
    lastCenter = center;

    // Prefetch nearest-first so the very next image lands soonest.
    for (let d = 0; d <= Math.max(hi - center, center - lo); d++) {
      const forward = center + direction * d;
      if (forward >= lo && forward <= hi) {
        const url = urlAt(forward);
        if (url) ensureDownload(url);
      }
      const back = center - direction * d;
      if (d > 0 && back >= lo && back <= hi) {
        const url = urlAt(back);
        if (url) ensureDownload(url);
      }
    }
  }

  function warmup(indices: number[]): void {
    for (const i of indices) {
      const url = urlAt(i);
      if (url) ensureDownload(url);
    }
  }

  function clear(): void {
    for (const url of Array.from(downloads.keys())) abort(url);
    lastCenter = -1;
  }

  return { setWindow, warmup, clear };
}
