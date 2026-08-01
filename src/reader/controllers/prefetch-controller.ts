import { acquireImage, cancelImagePrefetch } from '../../services/image-load-runtime';
import type { ImageLoadLease } from '../../services/image-load-service';
import type { ReaderPrefetchPolicy } from '../../core/site-adapter';
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
 * The default window is 5/2; adapters may override it when site evidence warrants.
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

export function createPrefetchController(
  session: ReaderSession,
  policy: ReaderPrefetchPolicy = READER_PREFETCH,
): PrefetchController {
  const downloads = new Map<string, {
    lease: ImageLoadLease;
    priority: number;
    lane: 'foreground' | 'background';
  }>();
  let lastCenter = -1;  // previous window centre; -1 = fresh (treat next as a jump)
  let generation = 0;
  let idleHandle: number | ReturnType<typeof setTimeout> | null = null;
  let idleKind: 'idle' | 'timeout' | null = null;

  function urlAt(index: number): string | undefined {
    return session.itemAt(index)?.viewerUrl;
  }

  // Acquire a shared full-lifecycle lease. The service owns resolve, byte load,
  // retry and cache state; this controller owns only the reading window.
  function ensureDownload(
    url: string,
    options: {
      intent: 'foreground' | 'neighbor' | 'warmup';
      priority: number;
      lane: 'foreground' | 'background';
    } = { intent: 'warmup', priority: LOAD_PRIORITY.warmup, lane: 'background' },
  ): ImageLoadLease {
    const existing = downloads.get(url);
    if (existing
        && existing.priority >= options.priority
        && (existing.lane === 'foreground' || options.lane === 'background')) {
      return existing.lease;
    }

    // Acquire before releasing so a foreground adoption promotes the same
    // shared lifecycle instead of briefly aborting and recreating it.
    const lease = acquireImage(url, options);
    existing?.lease.release();
    downloads.set(url, { lease, priority: options.priority, lane: options.lane });
    lease.result.then(() => {
      if (downloads.get(url)?.lease !== lease) return;
      downloads.delete(url);
      lease.release();
    }).catch(() => {
      if (downloads.get(url)?.lease !== lease) return;
      downloads.delete(url);
      lease.release();
    });
    return lease;
  }

  function abort(url: string): void {
    downloads.get(url)?.lease.release();
    downloads.delete(url);
  }

  function cancelIdleStage(): void {
    if (idleHandle === null) return;
    if (idleKind === 'idle' && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(idleHandle as number);
    } else {
      clearTimeout(idleHandle as ReturnType<typeof setTimeout>);
    }
    idleHandle = null;
    idleKind = null;
  }

  function scheduleIdleStage(callback: () => void): void {
    cancelIdleStage();
    if ('requestIdleCallback' in window) {
      idleKind = 'idle';
      idleHandle = window.requestIdleCallback(() => {
        idleHandle = null;
        idleKind = null;
        callback();
      }, { timeout: 800 });
    } else {
      idleKind = 'timeout';
      idleHandle = setTimeout(() => {
        idleHandle = null;
        idleKind = null;
        callback();
      }, 250);
    }
  }

  function networkAllowsExtraWarmup(): boolean {
    const connection = (navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
    }).connection;
    return !connection?.saveData
      && connection?.effectiveType !== 'slow-2g'
      && connection?.effectiveType !== '2g';
  }

  function setWindow(center: number, direction: 1 | -1): void {
    const total = session.imageCount;
    if (total === 0) return;
    const currentGeneration = ++generation;
    cancelIdleStage();

    const indices = getReaderPrefetchIndices(center, total, direction, policy);

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
      || Math.abs(center - lastCenter) > policy.ahead + policy.behind;
    if (jumped) cancelImagePrefetch(wanted);
    lastCenter = center;

    const currentUrl = urlAt(center);
    const nextUrl = urlAt(center + direction);
    const currentLease = currentUrl
      ? ensureDownload(currentUrl, {
        intent: 'foreground',
        priority: LOAD_PRIORITY.foreground,
        lane: 'foreground',
      })
      : null;
    if (nextUrl) {
      ensureDownload(nextUrl, {
        intent: 'neighbor',
        priority: LOAD_PRIORITY.foreground - 1,
        lane: 'foreground',
      });
    }

    // Current readiness unlocks the next two directional pages. Remaining
    // coverage is filled only during idle time, keeping startup demand small.
    Promise.resolve(currentLease?.result).finally(() => {
      if (generation !== currentGeneration) return;
      for (const distance of [2, 3]) {
        const stagedUrl = urlAt(center + direction * distance);
        if (stagedUrl && wanted.has(stagedUrl)) ensureDownload(stagedUrl);
      }
      scheduleIdleStage(() => {
        if (generation !== currentGeneration) return;
        for (const index of indices) {
          const url = urlAt(index);
          if (url) ensureDownload(url);
        }
      });
    });
  }

  function warmup(indices: number[]): void {
    const [first, second, ...rest] = indices;
    const firstUrl = first === undefined ? undefined : urlAt(first);
    if (firstUrl) ensureDownload(firstUrl);
    if (networkAllowsExtraWarmup()) {
      const secondUrl = second === undefined ? undefined : urlAt(second);
      if (secondUrl) ensureDownload(secondUrl);
    }
    if (rest.length > 0) {
      scheduleIdleStage(() => {
        for (const index of rest) {
          const url = urlAt(index);
          if (url) ensureDownload(url);
        }
      });
    }
  }

  function clear(): void {
    generation++;
    cancelIdleStage();
    for (const url of Array.from(downloads.keys())) abort(url);
    lastCenter = -1;
  }

  return { setWindow, warmup, clear };
}
