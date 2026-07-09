export interface PageLink {
  url: string;
  thumb?: string;
  thumbW?: number;
  thumbH?: number;
  thumbX?: number;  // sprite-sheet crop offset X (E-Hentai Normal thumbnails)
  thumbY?: number;  // sprite-sheet crop offset Y
}

export interface SiteAdapter {
  name: string;
  
  // Match the adapter against current URL or DOM
  match: (url: string, doc: Document) => boolean;

  // Initialize and get the initial page data
  init: (doc: Document) => Promise<{
    links: PageLink[];         // Image viewer URLs and thumbnails
    nextUrl: string | null;
    prevUrl: string | null;
    totalPage?: number;
  }>;

  // Given an image url/link, fetch the actual image URL
  resolveImage(url: string, ...args: any[]): Promise<{src: string, nl?: string} | null>;

  // Optional: Given a resolved image url, extract its dimensions if encoded in the URL
  extractDimensionFromResolvedUrl?: (url: string) => { w: number, h: number } | null;

  // Bump the priority of a currently loading/queued image
  bumpPriority?: (url: string) => void;

  // Optional: on a large reader jump, abandon still-queued prefetch work for
  // images the user skipped past. `keepUrls` is the set of viewer URLs the
  // prefetch controller still wants (the current window); anything else queued
  // may be cancelled. Each adapter cancels via its own resolve queue — e-hentai
  // drops low-priority ehLimiter jobs, 18comic clears its decode-mutex queue.
  // Already-running work is left alone (it can't be un-fetched).
  cancelPrefetch?: (keepUrls: Set<string>) => void;

  // Fetch the next page and get its links
  fetchPage: (url: string) => Promise<{
    links: PageLink[];
    nextUrl: string | null;
    prevUrl?: string | null;
  }>;

  // UI helpers
  getContainer: () => HTMLElement | null; // Used for float control positioning
  hideOriginalElements?: () => void;      // Hide original page elements for scroll mode
  getNativeImages?: () => HTMLElement[];  // Get original native image elements for positioning

  // Optional lifecycle hook: when the single page mode is closed, useful for syncing pagination URL
  onReaderClose?: (globalIndex: number) => void;
}
