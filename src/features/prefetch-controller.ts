import { store } from '../state/store';
import { ehLimiter } from '../services/net-limiter';
import { prefetchImageUrl } from './scroll-mode';

/**
 * Directional byte-prefetch controller for the non-scroll reader.
 *
 * Network is the scarce resource here: E-Hentai rate-limits resolve requests
 * (via ehLimiter) and meters daily image bandwidth, while physical bandwidth
 * caps how fast bytes arrive. Two levers follow from that:
 *
 *   1. Prefetch — download the *bytes* of the next few images in the travel
 *      direction during the seconds the user dwells on the current one, so the
 *      viewer opens them instantly. (The old ±4 prefetch only ran the cheap
 *      resolve step and never downloaded bytes, so it bought almost nothing.)
 *   2. View-only — never spend bandwidth on images the user has skipped past.
 *      A thumbnail-panel jump from image 1 to 100 must abandon 2-99 and pour
 *      everything into 100 onward.
 *
 * Both collapse into one idea: a small window that follows the current index,
 * biased forward. Inside the window we ensure bytes are downloading; anything
 * that falls outside has its in-flight download aborted. The window is
 * deliberately small (see AHEAD/BEHIND) to respect the daily quota — a wasted
 * prefetch is spent quota.
 *
 * Scroll mode is untouched: it lazy-loads natively via IntersectionObserver.
 */

const AHEAD = 3;   // images to prefetch ahead of the current one
const BEHIND = 1;  // keep one behind so a small back-step is still instant

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

    // On a jump (new window doesn't touch the old centre) drop the queued
    // prefetch resolves (priority <= 10) still waiting for the abandoned
    // position, so their limiter slots free up for the new window at once. On a
    // normal ±1 step the windows overlap, so skip this — cancelling resolves the
    // step still wants would just stall them.
    const jumped = lastCenter < 0 || Math.abs(center - lastCenter) > AHEAD + BEHIND;
    if (jumped) ehLimiter.cancel(priority => priority <= 10);
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
