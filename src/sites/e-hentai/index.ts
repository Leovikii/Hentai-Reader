import type { ImageResolveContext, SiteAdapter } from '../../core/site-adapter.ts';
import { NetLimiter } from '../../services/net-limiter.ts';
import { LOAD_PRIORITY } from '../../state/load-policy.ts';
import {
  buildEHentaiViewerUrl,
  extractEHentaiItems,
  getEHentaiNextUrl,
  getEHentaiPrevUrl,
  parseEHentaiPageMetadata,
  parseEHentaiViewer,
} from './gallery.ts';

let parser: DOMParser | undefined;
function parseDocument(html: string): Document {
  parser ??= new DOMParser();
  return parser.parseFromString(html, 'text/html');
}
const PAGE_FETCH_PRIORITY = LOAD_PRIORITY.pageHtml;
const REQUEST_POLICY = {
  concurrent: 3,
  rateLimitCooldownMs: 5000,
  foregroundLoadTimeoutMs: 12_000,
  backgroundLoadTimeoutMs: 20_000,
} as const;
const requestLimiter = new NetLimiter(REQUEST_POLICY.concurrent);

/** All E-Hentai requests share one priority limiter to avoid request bursts. */
function limitedFetch(
  url: string,
  options: { priority?: number; key?: string; signal?: AbortSignal; fresh?: boolean } = {},
): Promise<Response> {
  return requestLimiter.run(
    async () => {
      const response = await fetch(url, {
        signal: options.signal,
        ...(options.fresh ? { cache: 'no-store' as RequestCache } : {}),
      });
      enforceRateLimit(response);
      return response;
    },
    { priority: options.priority, key: options.key, signal: options.signal },
  );
}

function enforceRateLimit(response: Response): void {
  if (response.status !== 429 && response.status !== 503) return;
  requestLimiter.pauseFor(REQUEST_POLICY.rateLimitCooldownMs);
  throw new Error(`Rate limited: HTTP ${response.status}`);
}

export const EHentaiAdapter: SiteAdapter = {
  name: 'E-Hentai/ExHentai',
  match(url: string) {
    return /https?:\/\/(e-|ex)hentai\.org\/(g|s)\//.test(url);
  },

  async loadInitialPage(doc: Document, url: string) {
    const items = extractEHentaiItems(doc);
    const metadata = parseEHentaiPageMetadata(doc, items.length);

    return {
      pageUrl: url,
      items,
      nextUrl: getEHentaiNextUrl(doc),
      prevUrl: getEHentaiPrevUrl(doc),
      totalPages: metadata.totalPages,
      position: {
        startIndex: metadata.imageOffset ?? 0,
        pageSize: metadata.perPage ?? items.length,
      },
    };
  },

  async resolveImage(url: string, context: ImageResolveContext) {
    const response = await limitedFetch(buildEHentaiViewerUrl(url, context.retryToken), {
      priority: context.priority,
      key: url,
      signal: context.signal,
      fresh: context.force || !!context.retryToken,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const doc = parseDocument(html);
    const viewer = parseEHentaiViewer(doc);
    if (!viewer) throw new Error('Image not found');
    return {
      src: viewer.src,
      ...(viewer.nl ? { retryToken: viewer.nl } : {}),
      ...(viewer.dimensions ? { sourceDimensions: viewer.dimensions } : {}),
      loadTimeoutMs: context.priority >= LOAD_PRIORITY.foreground - 10
        ? REQUEST_POLICY.foregroundLoadTimeoutMs
        : REQUEST_POLICY.backgroundLoadTimeoutMs,
    };
  },

  async loadPage(url: string, signal?: AbortSignal) {
    const response = await limitedFetch(url, { priority: PAGE_FETCH_PRIORITY, key: url, signal });
    if (!response.ok) throw new Error('Failed to fetch page');
    const html = await response.text();
    const doc = parseDocument(html);
    return {
      pageUrl: url,
      items: extractEHentaiItems(doc),
      nextUrl: getEHentaiNextUrl(doc),
      prevUrl: getEHentaiPrevUrl(doc),
    };
  },

  getContainer() {
    return (document.querySelector('#gdt') || document.querySelector('.gm')) as HTMLElement | null;
  },

  hideOriginalElements() {
    const hiddenSelectors = [
      '.c1', '.c2', '.c3', '.c4', '.c5', '.c6', '.c7', '.c8',
      '.ptt', '.ptb', '.gdtl', '.gdtm',
      '#gdo', '#cdiv', 'table.itg',
    ];
    const elements = Array.from(document.querySelectorAll<HTMLElement>(hiddenSelectors.join(',')));
    const displays = elements.map(element => element.style.display);
    elements.forEach(element => {
      element.style.display = 'none';
    });
    return () => elements.forEach((element, index) => { element.style.display = displays[index]; });
  },

  imageRequestQueue: {
    promote(url: string, priority: number) {
      requestLimiter.promote(url, priority);
    },
    cancelPrefetch(keepUrls: Set<string>) {
      requestLimiter.cancel((priority, _seq, key) => (
        priority <= LOAD_PRIORITY.thumbnail && !!key && !keepUrls.has(key)
      ));
    },
  },

  onReaderClose(globalIndex: number, context) {
    if (context.scrollMode) return;

    const targetPage = Math.floor(globalIndex / context.pageSize);
    const url = new URL(window.location.href);
    const currentPage = parseInt(url.searchParams.get('p') || '0', 10);
    if (targetPage !== currentPage) {
      url.searchParams.set('p', String(targetPage));
      window.location.href = url.toString();
    }
  },
};
