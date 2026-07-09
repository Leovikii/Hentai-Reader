import { CFG } from '../state/config';
import { prefetchImageUrl } from './scroll-mode';

/**
 * Shared image retry policy for both loading paths (scroll-mode waterfall and
 * the PhotoSwipe reader). The two paths differ wildly in how they *display* an
 * image (DOM node vs throwaway byte-loader, persistent error card vs transient
 * HUD, store sync, stale-instance guarding), so this module deliberately does
 * NOT try to be a unified loader. It owns only the retry *orchestration* — the
 * one piece that was duplicated and drifting — and hands every visible side
 * effect back to the caller through callbacks.
 *
 * Two failure stages, two functions:
 *   1. resolveImageWithRetry — the resolve step (adapter.resolveImage) fails.
 *   2. attachImageRetry      — the <img> byte load fails after a good resolve.
 */

/** Resolve step retry — see resolveImageWithRetry. */
interface ResolveRetryOpts {
  /** Priority forwarded to prefetchImageUrl / the net limiter. Default 0. */
  priority?: number;
  /** Max retry attempts after the first try. Default CFG.maxRetries. */
  retries?: number;
  /** Delay between attempts in ms. Default CFG.retryDelay. */
  retryDelay?: number;
}

/**
 * Resolve a viewer URL to an image src, retrying the resolve on failure. Each
 * retry forces a fresh request (bypassing the resolvedUrls cache and the
 * in-flight share) so a transient failure isn't served a stale rejection.
 * Returns null only after every attempt is exhausted.
 *
 * This is the single home of the resolve-retry loop that used to live only in
 * scroll mode (`resolveWithRetry`); the reader now shares it too.
 */
export async function resolveImageWithRetry(
  url: string,
  opts: ResolveRetryOpts = {}
): Promise<{ src: string; nl?: string } | null> {
  const priority = opts.priority ?? 0;
  const retries = opts.retries ?? CFG.maxRetries;
  const retryDelay = opts.retryDelay ?? CFG.retryDelay;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await prefetchImageUrl(url, undefined, attempt > 0, priority);
      if (res) return res;
    } catch {
      // fall through to the delay/retry
    }
    if (attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  return null;
}

/** Byte-load retry — see attachImageRetry. */
interface ImageRetryOpts {
  /** Viewer URL (resolve key), used to re-resolve on retry. */
  viewerUrl: string;
  /** nl token from the first resolve, if the adapter supplies one (e-hentai). */
  nl?: string;
  /** Priority forwarded to the forced re-resolve. */
  priority: number;
  /** Max node-switch retries (nl token present). Default 3. */
  maxNodeRetries?: number;
  /** Max plain same-URL retries (no nl token). Default 2. */
  maxPlainRetries?: number;
  /** Delay before a plain retry in ms. Default CFG.retryDelay. */
  plainRetryDelay?: number;
  /**
   * Is this load still relevant? Discards a stale onerror after the caller has
   * moved on (scroll: placeholder detached; reader: PhotoSwipe swapped). When
   * it returns false, the handler bails without retrying or reporting.
   */
  shouldContinue: () => boolean;
  /** Optional UI feedback before a retry fires (scroll: toast / placeholder swap). */
  onRetry?: (attempt: number, kind: 'node' | 'plain') => void;
  /** A fresh src is ready and has been assigned to img.src — sync store / refresh slide. Optional; when omitted the caller relies on img.onload alone. */
  onSuccess?: (newSrc: string) => void;
  /** All retries exhausted (or no strategy applies) — show the error UI. */
  onFail: () => void;
}

/**
 * Install an `img.onerror` handler that retries a failed byte load, then wire
 * the caller's success/fail side effects. Two strategies, tried in order:
 *
 *   - Node switch (e-hentai): when an `nl` token is available, re-request the
 *     viewer page via a forced re-resolve to get a *different* hath node, and
 *     retry with the new src. The token advances each round.
 *   - Plain retry (CDN sites, no nl): re-point img.src at a freshly re-resolved
 *     src after a short delay. The forced re-resolve may be short-circuited by
 *     an adapter's own cache (e.g. 18comic's imageCache), but re-assigning
 *     img.src still makes the browser re-request the bytes — which is what
 *     recovers a transient CDN hiccup.
 *
 * The caller owns all display: this only assigns img.src and invokes callbacks.
 */
export function attachImageRetry(img: HTMLImageElement, opts: ImageRetryOpts): void {
  const maxNodeRetries = opts.maxNodeRetries ?? 3;
  const maxPlainRetries = opts.maxPlainRetries ?? 2;
  const plainRetryDelay = opts.plainRetryDelay ?? CFG.retryDelay;

  let currentNl = opts.nl;
  let nodeRetries = 0;
  let plainRetries = 0;

  img.onerror = () => {
    if (!opts.shouldContinue()) return;

    // Strategy 1: node switch via nl token (e-hentai dead-node recovery).
    if (currentNl && nodeRetries < maxNodeRetries) {
      nodeRetries++;
      opts.onRetry?.(nodeRetries, 'node');
      prefetchImageUrl(opts.viewerUrl, currentNl, true, opts.priority).then(newRes => {
        if (!opts.shouldContinue()) return;
        if (newRes && newRes.src) {
          currentNl = newRes.nl;
          img.src = newRes.src;
          opts.onSuccess?.(newRes.src);
        } else {
          opts.onFail();
        }
      }).catch(() => opts.onFail());
      return;
    }

    // Strategy 2: plain same-URL retry (CDN sites with no node concept).
    if (plainRetries < maxPlainRetries) {
      plainRetries++;
      opts.onRetry?.(plainRetries, 'plain');
      setTimeout(() => {
        if (!opts.shouldContinue()) return;
        prefetchImageUrl(opts.viewerUrl, undefined, true, opts.priority).then(newRes => {
          if (!opts.shouldContinue()) return;
          if (newRes && newRes.src) {
            img.src = newRes.src;
            opts.onSuccess?.(newRes.src);
          } else {
            opts.onFail();
          }
        }).catch(() => opts.onFail());
      }, plainRetryDelay);
      return;
    }

    opts.onFail();
  };
}
