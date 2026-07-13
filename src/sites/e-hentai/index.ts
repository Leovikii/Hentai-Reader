import type { SiteAdapter } from '../../core/site-adapter';
import { NetLimiter } from '../../services/net-limiter';
import { CFG } from '../../state/config';
import { LOAD_PRIORITY } from '../../state/load-policy';
import {
  buildEHentaiViewerUrl,
  extractEHentaiItems,
  getEHentaiNextUrl,
  getEHentaiPrevUrl,
  parseEHentaiPageMetadata,
  parseEHentaiViewer,
} from './gallery';

const parser = new DOMParser();
const PAGE_FETCH_PRIORITY = LOAD_PRIORITY.pageHtml;
const ehLimiter = new NetLimiter(CFG.maxConcurrent);

/** All E-Hentai requests share one priority limiter to avoid request bursts. */
function limitedFetch(url: string, priority = 0, signal?: AbortSignal): Promise<Response> {
  return ehLimiter.run(() => fetch(url, { signal }), priority);
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

  async resolveImage(url: string, nlToken?: string, priority = 0) {
    const response = await limitedFetch(buildEHentaiViewerUrl(url, nlToken), priority);
    if (response.status === 429 || response.status === 503) {
      ehLimiter.pauseFor(5000);
      throw new Error(`Rate limited: HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const doc = parser.parseFromString(html, 'text/html');
    const viewer = parseEHentaiViewer(doc);
    if (!viewer) throw new Error('Image not found');
    return viewer;
  },

  async loadPage(url: string, signal?: AbortSignal) {
    const response = await limitedFetch(url, PAGE_FETCH_PRIORITY, signal);
    if (!response.ok) throw new Error('Failed to fetch page');
    const html = await response.text();
    const doc = parser.parseFromString(html, 'text/html');
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
    document.querySelectorAll<HTMLElement>(hiddenSelectors.join(',')).forEach(element => {
      element.style.display = 'none';
    });
  },

  cancelPrefetch(_keepUrls: Set<string>) {
    ehLimiter.cancel(priority => priority <= 10);
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
