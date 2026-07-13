import type { SiteAdapter } from '../../core/site-adapter';
import { extract4KHDImages, get4KHDNextUrl, get4KHDPrevUrl } from './gallery';

const parser = new DOMParser();

export const FourKHDAdapter: SiteAdapter = {
  name: '4KHD',
  
  match(url: string) {
    return url.includes('4khd.com') || url.includes('xxtt.ink') || url.includes('uuss.uk') || url.includes('ssuu.uk');
  },

  async loadInitialPage(doc: Document, url: string) {
    const items = extract4KHDImages(doc);
    
    // For 4KHD, we might not know the absolute total pages up front without parsing them all,
    // so we set a default high number or rely on infinite scroll stopping when nextUrl is null.
    // For now we just default to 1, and the store will keep accumulating as we fetch pages.
    const totalPage = 1; 

    const pageBox = doc.querySelector('.page-link-box, .pagination, .nav-links, .nav-previous');
    let currentPageNum = 1;
    if (pageBox) {
      const current = pageBox.querySelector('.current, .active') || Array.from(pageBox.querySelectorAll('span')).find(s => !s.querySelector('a'));
      if (current) {
        currentPageNum = parseInt(current.textContent || '1', 10);
        if (isNaN(currentPageNum)) currentPageNum = 1;
      }
    }
    
    const perPage = items.length > 0 ? items.length : 20;

    return {
      pageUrl: url,
      items,
      nextUrl: get4KHDNextUrl(doc, url),
      prevUrl: get4KHDPrevUrl(doc, url),
      totalPages: totalPage,
      position: {
        startIndex: (currentPageNum - 1) * perPage,
        pageSize: perPage,
      },
    };
  },

  async resolveImage(url: string) {
    // 4KHD already provides direct image links in its gallery pages.
    // We just return it directly. No extra fetching needed!
    return { src: url };
  },

  async loadPage(url: string, signal?: AbortSignal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('Failed to fetch page');
    const html = await response.text();
    const doc = parser.parseFromString(html, 'text/html');
    const items = extract4KHDImages(doc);
    return {
      pageUrl: url,
      items,
      nextUrl: get4KHDNextUrl(doc, url),
      prevUrl: get4KHDPrevUrl(doc, url),
    };
  },

  getContainer() {
    const entryContent = document.querySelector('.entry-content, .wp-block-post-content');
    if (entryContent) return entryContent as HTMLElement;
    const basicExample = document.querySelector('#basicExample');
    if (basicExample && basicExample.parentElement) return basicExample.parentElement;
    return document.querySelector('.post-content') as HTMLElement | null;
  },

  hideOriginalElements() {
    const HIDDEN_SELECTORS = [
      '.centbtd', '.popup', '.wp-container-13', '.popup-iframe',
      '#basicExample', '.wp-block-image', '.page-link-box'
    ];
    document.querySelectorAll<HTMLElement>(HIDDEN_SELECTORS.join(',')).forEach(el => {
      el.style.display = 'none';
    });
  }
};
