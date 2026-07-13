import type { GalleryItem, GalleryPage } from '../../core/gallery';
import type { ResolvedImage } from '../../core/image';
import type { SiteAdapter } from '../../core/site-adapter';

export interface SiteAdapterTemplateConfig {
  name: string;
  match(url: string, doc: Document): boolean;
  extractItems(doc: Document, pageUrl: string): GalleryItem[];
  getNextUrl(doc: Document, pageUrl: string): string | null;
  getPrevUrl(doc: Document, pageUrl: string): string | null;
  resolveImage?(url: string, nlToken?: string, priority?: number): Promise<ResolvedImage | null>;
  materializeImage?(resolved: ResolvedImage, signal: AbortSignal): Promise<ResolvedImage | null>;
  containerSelector: string;
  hiddenSelectors?: readonly string[];
  parseTotalPages?(doc: Document): number | undefined;
  fetchDocument?(url: string, signal?: AbortSignal): Promise<Document>;
}

async function defaultFetchDocument(url: string, signal?: AbortSignal): Promise<Document> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to fetch Gallery page: HTTP ${response.status}`);
  return new DOMParser().parseFromString(await response.text(), 'text/html');
}

function parsePage(
  config: SiteAdapterTemplateConfig,
  doc: Document,
  pageUrl: string,
): GalleryPage {
  return {
    pageUrl,
    items: config.extractItems(doc, pageUrl),
    nextUrl: config.getNextUrl(doc, pageUrl),
    prevUrl: config.getPrevUrl(doc, pageUrl),
    totalPages: config.parseTotalPages?.(doc),
  };
}

/** Factory used by new adapters; it intentionally contains no retry or Reader logic. */
export function createSiteAdapterTemplate(config: SiteAdapterTemplateConfig): SiteAdapter {
  const adapter: SiteAdapter = {
    name: config.name,
    match: config.match,
    loadInitialPage: async (doc, url) => parsePage(config, doc, url),
    async loadPage(url, signal) {
      const fetchDocument = config.fetchDocument ?? defaultFetchDocument;
      return parsePage(config, await fetchDocument(url, signal), url);
    },
    resolveImage: config.resolveImage ?? (async url => ({ src: url })),
    getContainer: () => document.querySelector(config.containerSelector) as HTMLElement | null,
    hideOriginalElements() {
      if (!config.hiddenSelectors?.length) return;
      document.querySelectorAll<HTMLElement>(config.hiddenSelectors.join(','))
        .forEach(element => { element.style.display = 'none'; });
    },
  };
  if (config.materializeImage) adapter.materializeImage = config.materializeImage;
  return adapter;
}

export function directPreview(src: string, width?: number, height?: number): GalleryItem['preview'] {
  return {
    kind: 'url',
    src,
    ...(width && height ? { size: { width, height } } : {}),
  };
}

export function noPreview(needsDerivedPreview = false): GalleryItem['preview'] {
  return { kind: needsDerivedPreview ? 'derived' : 'none' };
}
