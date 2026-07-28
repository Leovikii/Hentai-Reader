import type { ReaderPrefetchPolicy } from '../core/site-adapter';

/** Shared priority bands. Keep these values stable while consumers migrate. */
export const LOAD_PRIORITY = {
  scroll: 0,
  warmup: 5,
  thumbnail: 10,
  pageHtml: 50,
  foreground: 100,
} as const;

export const READER_PREFETCH = {
  ahead: 6,
  behind: 3,
} as const satisfies ReaderPrefetchPolicy;

/** Returns the bounded Reader window in nearest-first request order. */
export function getReaderPrefetchIndices(
  center: number,
  total: number,
  direction: 1 | -1,
  policy: ReaderPrefetchPolicy = READER_PREFETCH,
): number[] {
  if (total <= 0) return [];
  const lo = Math.max(0, center - (direction === 1 ? policy.behind : policy.ahead));
  const hi = Math.min(total - 1, center + (direction === 1 ? policy.ahead : policy.behind));
  const indices: number[] = [];
  for (let distance = 0; distance <= Math.max(hi - center, center - lo); distance++) {
    const forward = center + direction * distance;
    if (forward >= lo && forward <= hi) indices.push(forward);
    const back = center - direction * distance;
    if (distance > 0 && back >= lo && back <= hi) indices.push(back);
  }
  return indices;
}
