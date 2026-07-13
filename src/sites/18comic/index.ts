import type { SiteAdapter } from '../../core/site-adapter';
import type { GalleryItem } from '../../core/gallery';
import {
  create18ComicBrowserMaterializer,
  resolve18ComicSource,
} from './materializer';

declare const unsafeWindow: any;

function extractChapterItems(
  doc: Document,
  pageUrl: string,
  useUnsafeFallback: boolean,
  suppressNativeDecode: boolean,
): GalleryItem[] {
  const html = doc.documentElement.innerHTML;
  const aidMatch = html.match(/aid\s*=\s*['"]?(\d+)['"]?/);
  const scrambleMatch = html.match(/scramble_id\s*=\s*['"]?(\d+)['"]?/);
  const aid = aidMatch?.[1]
    || (useUnsafeFallback && unsafeWindow.aid ? String(unsafeWindow.aid) : '');
  const scrambleId = scrambleMatch?.[1]
    || (useUnsafeFallback && unsafeWindow.scramble_id ? String(unsafeWindow.scramble_id) : '');

  const items: GalleryItem[] = [];
  const seenUrls = new Set<string>();
  const images = doc.querySelectorAll('.scramble-page img[id], .owl-item .center img[id]');
  images.forEach(element => {
    const image = element as HTMLImageElement;
    const source = image.getAttribute('data-original')
      || image.getAttribute('data-src')
      || image.src;
    if (!source) return;

    const url = new URL(source, pageUrl);
    if (aid) url.searchParams.set('18aid', aid);
    if (scrambleId) url.searchParams.set('18scid', scrambleId);
    const viewerUrl = url.toString();
    if (!seenUrls.has(viewerUrl)) {
      seenUrls.add(viewerUrl);
      items.push({ key: viewerUrl, viewerUrl, preview: { kind: 'none' } });
    }

    if (suppressNativeDecode) {
      try {
        image.getBoundingClientRect = () => ({
          top: 999999,
          left: 0,
          right: 0,
          bottom: 999999,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => {},
        });
      } catch {
        // Some site-created elements expose a non-writable method.
      }
    }
  });
  return items;
}

function getNextUrl(doc: Document): string | null {
  const active = doc.querySelector('.pagination li.active');
  const pageLink = active?.nextElementSibling?.querySelector('a:not(.prevnext)');
  if (pageLink) return (pageLink as HTMLAnchorElement).href;

  const nextChapter = Array.from(doc.querySelectorAll('.menu-bolock-ul a[href^="/photo/"]'))
    .find(anchor => anchor.textContent?.includes('涓嬩竴'));
  return nextChapter ? (nextChapter as HTMLAnchorElement).href : null;
}

function getPrevUrl(doc: Document): string | null {
  const active = doc.querySelector('.pagination li.active');
  const pageLink = active?.previousElementSibling?.querySelector('a:not(.prevnext)');
  if (pageLink) return (pageLink as HTMLAnchorElement).href;

  const prevChapter = Array.from(doc.querySelectorAll('.menu-bolock-ul a[href^="/photo/"]'))
    .find(anchor => anchor.textContent?.includes('涓婁竴'));
  return prevChapter ? (prevChapter as HTMLAnchorElement).href : null;
}

const materialize = create18ComicBrowserMaterializer((aid, imageId) => {
  if (!unsafeWindow.get_num) return undefined;
  return unsafeWindow.get_num(btoa(aid), btoa(imageId));
});

export const Comic18Adapter: SiteAdapter = {
  name: '18comic',

  match(url: string) {
    return url.includes('18comic.vip') || url.includes('18comic.ink');
  },

  async loadInitialPage(doc: Document, pageUrl: string) {
    return {
      pageUrl,
      items: extractChapterItems(doc, pageUrl, true, true),
      nextUrl: getNextUrl(doc),
      prevUrl: getPrevUrl(doc),
    };
  },

  async loadPage(url: string, signal?: AbortSignal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Failed to fetch page: HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return {
      pageUrl: url,
      items: extractChapterItems(doc, url, false, false),
      nextUrl: getNextUrl(doc),
      prevUrl: getPrevUrl(doc),
    };
  },

  async resolveImage(url: string) {
    try {
      return resolve18ComicSource(url);
    } catch {
      return { src: url };
    }
  },

  async materializeImage(resolved, signal) {
    return materialize(resolved, signal);
  },

  getContainer() {
    return document.querySelector('.scramble-page') || document.body;
  },

  hideOriginalElements() {
    const pages = Array.from(document.querySelectorAll('.scramble-page'));
    for (let index = 1; index < pages.length; index++) pages[index].remove();
    document.querySelectorAll('.owl-carousel').forEach(element => element.remove());
  },
};
