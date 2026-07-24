import { acquireImage, cancelImagePrefetch } from '../../services/image-load-runtime';
import type { ImageLoadLease } from '../../services/image-load-service';
import {
  getReaderPrefetchIndices,
  LOAD_PRIORITY,
  READER_PREFETCH,
} from '../../state/load-policy';
import type { ReaderSession } from '../reader-session';

/**
 * Windowed byte-prefetch controller for the PhotoSwipe reader.
 *
 * Downloads images in a sliding window (AHEAD in travel direction, BEHIND in
 * the opposite) to balance reading smoothness with resource use. On large jumps
 * (thumbnail-panel navigation), aborts out-of-window byte-downloads and asks the
 * shared runtime to cancel queued low-priority work, freeing slots for the new
 * position immediately.
 *
 * The active runtime may delegate cancellation to a site limiter when needed.
 * The window is bounded at 10/4; site concurrency limits still control bursts.
 */

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

export function createPrefetchController(session: ReaderSession): PrefetchController {
  const downloads = new Map<string, ImageLoadLease>();
  let lastCenter = -1;  // previous window centre; -1 = fresh (treat next as a jump)

  function urlAt(index: number): string | undefined {
    return session.itemAt(index)?.viewerUrl;
  }

  // Acquire a shared full-lifecycle lease. The service owns resolve, byte load,
  // retry and cache state; this controller owns only the reading window.
  function ensureDownload(url: string): void {
    if (downloads.has(url)) return;
    const lease = acquireImage(url, { intent: 'warmup', priority: LOAD_PRIORITY.warmup });
    downloads.set(url, lease);
    lease.result.then(() => {
      if (downloads.get(url) !== lease) return;
      downloads.delete(url);
      lease.release();
    }).catch(() => {
      if (downloads.get(url) !== lease) return;
      downloads.delete(url);
      lease.release();
    });
  }

  function abort(url: string): void {
    downloads.get(url)?.release();
    downloads.delete(url);
  }

  function setWindow(center: number, direction: 1 | -1): void {
    const total = session.imageCount;
    if (total === 0) return;

    const indices = getReaderPrefetchIndices(center, total, direction);

    const wanted = new Set<string>();
    for (const i of indices) {
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
    const jumped = lastCenter < 0
      || Math.abs(center - lastCenter) > READER_PREFETCH.ahead + READER_PREFETCH.behind;
    if (jumped) cancelImagePrefetch(wanted);
    lastCenter = center;

    // Prefetch nearest-first so the very next image lands soonest.
    for (const index of indices) {
      const url = urlAt(index);
      if (url) ensureDownload(url);
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
