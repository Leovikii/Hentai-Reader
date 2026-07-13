export interface PreviewSize {
  width: number;
  height: number;
}

export interface PreviewCrop extends PreviewSize {
  x: number;
  y: number;
}

/** Standard preview capability consumed by thumbnail UI, independent of site DOM. */
export type PreviewDescriptor =
  | { kind: 'url'; src: string; size?: PreviewSize }
  | { kind: 'sprite'; src: string; crop: PreviewCrop }
  | { kind: 'derived' }
  | { kind: 'none' };

export interface GalleryItem {
  /** Stable identity within the gallery. Viewer URL is the default legacy key. */
  key: string;
  viewerUrl: string;
  preview: PreviewDescriptor;
  dimensions?: PreviewSize;
}

export interface GalleryPosition {
  startIndex: number;
  totalItems?: number;
  pageSize?: number;
}

export interface GalleryPage {
  pageUrl: string;
  items: GalleryItem[];
  nextUrl: string | null;
  prevUrl: string | null;
  totalPages?: number;
  position?: GalleryPosition;
}
