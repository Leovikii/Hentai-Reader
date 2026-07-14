import type { GalleryPage } from './gallery';
import type { ResolvedImage } from './image';

/** Standard page capability targeted by the staged adapter migration. */
export interface GalleryAdapter {
  loadInitialPage: (doc: Document, url: string) => Promise<GalleryPage>;
  loadPage: (url: string, signal?: AbortSignal) => Promise<GalleryPage>;
}

export interface SiteReaderCloseContext {
  scrollMode: boolean;
  pageSize: number;
}

export interface SiteAdapter extends GalleryAdapter {
  name: string;
  
  // Match the adapter against current URL or DOM
  match: (url: string, doc: Document) => boolean;

  // Given an image url/link, fetch the actual image URL
  resolveImage(url: string, ...args: any[]): Promise<ResolvedImage | null>;

  // Optional conversion step for sources that are not directly displayable.
  materializeImage?: (
    resolved: ResolvedImage,
    signal: AbortSignal,
  ) => Promise<ResolvedImage | null>;

  // Optional: on a large reader jump, abandon still-queued prefetch work for
  // images the user skipped past. Already-running work is left alone.
  cancelPrefetch?: (keepUrls: Set<string>) => void;

  // UI helpers
  getContainer: () => HTMLElement | null; // Used for float control positioning
  hideOriginalElements?: () => void;      // Hide original page elements for scroll mode

  // Optional lifecycle hook: when the single page mode is closed, useful for syncing pagination URL
  onReaderClose?: (globalIndex: number, context: SiteReaderCloseContext) => void;
}
