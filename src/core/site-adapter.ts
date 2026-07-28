import type { GalleryPage } from './gallery';
import type { ResolvedImage } from './image';

export interface ImageResolveContext {
  /** Opaque adapter token used to request an alternate source after failure. */
  retryToken?: string;
  priority: number;
  force: boolean;
  signal: AbortSignal;
}

export interface SiteScrollPolicy {
  defaultEnabled: boolean;
  configurable?: boolean;
}

/** Optional site-specific Reader byte-prefetch window. */
export interface ReaderPrefetchPolicy {
  ahead: number;
  behind: number;
}

export interface ImageRequestQueueHooks {
  promote?: (url: string, priority: number) => void;
  cancelPrefetch?: (keepUrls: Set<string>) => void;
}

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
  scrollPolicy?: SiteScrollPolicy;
  readerPrefetch?: ReaderPrefetchPolicy;
  
  // Match the adapter against current URL or DOM
  match: (url: string, doc: Document) => boolean;

  // Given an image url/link, fetch the actual image URL
  resolveImage(url: string, context: ImageResolveContext): Promise<ResolvedImage | null>;

  // Optional adapter-owned queue controls; direct URL sites need none.
  imageRequestQueue?: ImageRequestQueueHooks;

  // Optional conversion step for sources that are not directly displayable.
  materializeImage?: (
    resolved: ResolvedImage,
    signal: AbortSignal,
  ) => Promise<ResolvedImage | null>;

  // UI helpers
  getContainer: () => HTMLElement | null; // Used for float control positioning
  hideOriginalElements?: () => void;      // Hide original page elements for scroll mode

  // Optional lifecycle hook: when the single page mode is closed, useful for syncing pagination URL
  onReaderClose?: (globalIndex: number, context: SiteReaderCloseContext) => void;
}
