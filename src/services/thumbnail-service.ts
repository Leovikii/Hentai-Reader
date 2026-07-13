import type { GalleryItem, PreviewCrop } from '../core/gallery';

export interface ThumbnailPlan {
  src?: string;
  crop?: PreviewCrop;
  requestFullImage: boolean;
}

/** Chooses a thumbnail source without depending on site-specific DOM metadata. */
export function createThumbnailPlan(item: GalleryItem, loadedSource?: string): ThumbnailPlan {
  switch (item.preview.kind) {
    case 'url':
      return { src: item.preview.src, requestFullImage: false };
    case 'sprite':
      return { src: item.preview.src, crop: item.preview.crop, requestFullImage: false };
    case 'derived':
    case 'none':
      return loadedSource
        ? { src: loadedSource, requestFullImage: false }
        : { requestFullImage: true };
  }
}

/** Bounds full-image fallbacks and orders them by reader proximity. */
export function selectThumbnailFallbacks(
  items: readonly GalleryItem[],
  visibleIndices: Iterable<number>,
  currentIndex: number,
  limit = 3,
): number[] {
  if (limit <= 0) return [];

  return Array.from(new Set(visibleIndices))
    .filter(index => {
      const preview = items[index]?.preview;
      return preview?.kind === 'derived' || preview?.kind === 'none';
    })
    .sort((a, b) => Math.abs(a - currentIndex) - Math.abs(b - currentIndex) || a - b)
    .slice(0, limit);
}
