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
