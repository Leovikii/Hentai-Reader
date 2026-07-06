import type { SiteAdapter, PageLink } from '../../types/site-adapter';
import { q, qa } from '../../utils/dom';
import { requestQueue } from '../../services/request-queue';
import { CFG } from '../../state/config';
import { store } from '../../state/store';

const parser = new DOMParser();

function getNextUrl(doc: Document) {
  const ptt = q('.ptt', doc);
  if (!ptt) return null;
  const nextBtn = Array.from(qa('td a', ptt)).find(a => (a.textContent ?? '').includes('>'));
  return nextBtn ? (nextBtn as HTMLAnchorElement).href : null;
}

function getPrevUrl(doc: Document) {
  const ptt = q('.ptt', doc);
  if (!ptt) return null;
  const prevBtn = Array.from(qa('td a', ptt)).find(a => (a.textContent ?? '').includes('<'));
  return prevBtn ? (prevBtn as HTMLAnchorElement).href : null;
}

function extractLinks(doc: Document): PageLink[] {
  return Array.from(qa('#gdt a', doc)).map(a => {
    const url = (a as HTMLAnchorElement).href;
    let thumb: string | undefined;
    
    const divWithBg = a.closest('div[style*="background"]');
    if (divWithBg) {
      const style = divWithBg.getAttribute('style') || '';
      const match = style.match(/url\(['"]?([^)'"]+)['"]?\)/);
      if (match) thumb = match[1];
    } else {
      const img = a.querySelector('img');
      if (img && img.src && !img.src.endsWith('x.gif')) {
        thumb = img.src;
      }
    }
    
    return { url, thumb };
  });
}

export const EHentaiAdapter: SiteAdapter = {
  name: 'E-Hentai/ExHentai',
  
  match(url: string) {
    return /https?:\/\/(e-|ex)hentai\.org\/(g|s)\//.test(url);
  },

  async init(doc: Document) {
    const initLinks = extractLinks(doc);
    
    // Parse total pages
    let totalPage = 1;
    const gpc = q('.gpc', doc);
    if (gpc) {
      const txt = gpc.textContent ?? '';
      const m = txt.match(/of\s+([\d,]+)\s+images/);
      if (m && m[1]) {
        const totalImgs = parseInt(m[1].replace(/,/g, ''));
        const perPage = initLinks.length || 20;
        totalPage = Math.ceil(totalImgs / perPage);
      }
    } else {
      const allLinks = Array.from(qa('.ptt td a', doc));
      const lastA = allLinks.pop();
      if (lastA) {
        const t = parseInt(lastA.textContent ?? '');
        if (!isNaN(t)) totalPage = t;
      }
    }

    // Determine current image offset for reader mode (if applicable)
    if (gpc) {
      const txt = gpc.textContent ?? '';
      const m = txt.match(/([\d,]+)\s*-\s*([\d,]+)[^\d]+([\d,]+)/);
      if (m) {
        const start = parseInt(m[1].replace(/,/g, ''));
        const end = parseInt(m[2].replace(/,/g, ''));
        const total = parseInt(m[3].replace(/,/g, ''));
        store.imageOffset = start - 1;

        if (start === 1) {
          store.perPage = end;
        } else if (end < total) {
          store.perPage = end - start + 1;
        } else {
          // Guess based on offset if on last page
          const offset = start - 1;
          if (offset % 200 === 0) store.perPage = 200;
          else if (offset % 100 === 0) store.perPage = 100;
          else if (offset % 50 === 0) store.perPage = 50;
          else if (offset % 40 === 0) store.perPage = 40;
          else if (offset % 20 === 0) store.perPage = 20;
          else store.perPage = initLinks.length;
        }
      }
    }

    return {
      links: initLinks,
      nextUrl: getNextUrl(doc),
      prevUrl: getPrevUrl(doc),
      totalPage,
    };
  },

  async resolveImage(url: string, nlToken?: string) {
    const fetchUrl = nlToken ? `${url}${url.includes('?') ? '&' : '?'}nl=${nlToken}` : url;
    let retries = 0;
    
    while (retries <= CFG.maxRetries) {
      try {
        const response = await fetch(fetchUrl);
        if (response.status === 429 || response.status === 503) {
          requestQueue.pauseGlobally(5000);
          throw { rateLimited: true };
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const doc = parser.parseFromString(html, 'text/html');
        const imgEl = q('#img', doc) as HTMLImageElement | null;
        const imgSrc = imgEl?.src;
        if (!imgSrc) throw new Error('Image not found');
        
        const onerror = imgEl.getAttribute('onerror') || '';
        const m = onerror.match(/nl\(['"]([^'"]+)['"]\)/);
        const nextNlToken = m ? m[1] : null;

        return { src: imgSrc, nl: nextNlToken ?? undefined };
      } catch (err) {
        if (retries < CFG.maxRetries) {
          const isRateLimited = err && typeof err === 'object' && 'rateLimited' in err;
          const delay = isRateLimited ? 5000 : CFG.retryDelay * Math.pow(2, retries);
          await new Promise(resolve => setTimeout(resolve, delay));
          retries++;
        } else {
          return null;
        }
      }
    }
    return null;
  },

  async fetchPage(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch page');
    const html = await response.text();
    const doc = parser.parseFromString(html, 'text/html');
    const links = extractLinks(doc);
    return {
      links,
      nextUrl: getNextUrl(doc),
      prevUrl: getPrevUrl(doc),
    };
  },

  getContainer() {
    return (document.querySelector('#gdt') || document.querySelector('.gm')) as HTMLElement | null;
  },

  hideOriginalElements() {
    const HIDDEN_SELECTORS = [
      '.c1', '.c2', '.c3', '.c4', '.c5', '.c6', '.c7', '.c8',
      '.ptt', '.ptb', '.gdtl', '.gdtm',
      '#gdo', '#cdiv', 'table.itg'
    ];
    document.querySelectorAll<HTMLElement>(HIDDEN_SELECTORS.join(',')).forEach(el => {
      el.style.display = 'none';
    });
  },
  
  extractDimensionFromResolvedUrl(url: string) {
    const m = url.match(/-(\d+)-(\d+)-(?:wbp|jpg|png|gif|jpeg)/i);
    if (m) {
      return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
    }
    return null;
  },

  getNativeImages() {
    return Array.from(qa('#gdt a', document)) as HTMLElement[];
  },

  onReaderClose(globalIndex: number) {
    if (store.settings.scrollMode) return;
    
    const targetPage = Math.floor(globalIndex / store.perPage);
    const url = new URL(window.location.href);
    const currentPage = parseInt(url.searchParams.get("p") || "0", 10);
    
    if (targetPage !== currentPage) {
      url.searchParams.set("p", String(targetPage));
      window.location.href = url.toString();
    }
  }
};
