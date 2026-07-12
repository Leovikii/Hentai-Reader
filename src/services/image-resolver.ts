import { store } from '../state/store';
import type { ResolvedImage } from '../types/image-load';
import { ImageLoadCoordinator } from './image-load-coordinator';

const coordinator = new ImageLoadCoordinator({
  getResolver: () => store.activeAdapter,
  getCachedSource: (url) => store.resolvedUrls.get(url),
  setCachedSource: (url, src) => store.resolvedUrls.set(url, src),
});

/** Compatibility facade for existing scroll, reader and prefetch callers. */
export function prefetchImageUrl(
  url: string,
  nlToken?: string,
  force = false,
  priority = 0,
): Promise<ResolvedImage | null> {
  return coordinator.resolve(url, nlToken, force, priority);
}

export function getImageLoadDiagnostics() {
  return coordinator.getDiagnostics();
}
