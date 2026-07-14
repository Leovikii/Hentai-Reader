import type { GalleryItem } from '../../core/gallery';

export function extract4KHDImages(doc: Document): GalleryItem[] {
  const images = Array.from(doc.querySelectorAll(
    'figure.wp-block-image img, #basicExample img, .entry-content p img',
  ));
  return images.map(image => {
    const img = image as HTMLImageElement;
    let src = img.getAttribute('data-src')
      || img.getAttribute('data-lazy-src')
      || img.src;

    let thumb = src;
    thumb = thumb.replace(/i\d\.wp\.com\//, '');
    thumb = thumb.replace('pic.4khd.com', 'img.4khd.com');
    thumb = thumb.replace(/\/w\d+-rw\//, '/w300-h300-rw/');

    src = src.replace(/i\d\.wp\.com\//, '');
    src = src.replace('pic.4khd.com', 'img.4khd.com');
    src = src.replace(/\?.+$/, '');
    src = src.replace(/\/w\d+-rw\//, '/w2500-h2500-rw/');

    return {
      key: src,
      viewerUrl: src,
      preview: { kind: 'url' as const, src: thumb },
    };
  }).filter(item => item.viewerUrl && !item.viewerUrl.includes('avatar'));
}

interface PaginationElement extends Element {
  href?: string;
}

function findPageLink(
  doc: Document,
  direction: 'next' | 'prev',
  currentUrl: string,
): string | null {
  const pageBox = doc.querySelector('.page-link-box, .pagination, .nav-links, .nav-previous');
  if (!pageBox) return null;

  const current = pageBox.querySelector('.current, .active')
    || Array.from(pageBox.querySelectorAll('span')).find(span => !span.querySelector('a'));
  if (current) {
    const currentPageNum = parseInt(current.textContent || '1', 10);
    const targetPage = direction === 'next' ? currentPageNum + 1 : currentPageNum - 1;
    if (!Number.isNaN(currentPageNum) && targetPage >= 1) {
      const link = Array.from(pageBox.querySelectorAll('a')).find(anchor =>
        parseInt(anchor.textContent || '0', 10) === targetPage,
      ) as PaginationElement | undefined;
      if (link?.href && link.href !== currentUrl) return link.href;
    }
  }

  const selector = direction === 'next'
    ? 'a.next, a.next.page-numbers'
    : 'a.prev, a.prev.page-numbers';
  const fallback = (pageBox.querySelector(selector) || doc.querySelector(selector)) as PaginationElement | null;
  if (fallback?.href && fallback.href !== currentUrl) return fallback.href;
  return null;
}

export function get4KHDNextUrl(doc: Document, currentUrl: string): string | null {
  return findPageLink(doc, 'next', currentUrl);
}

export function get4KHDPrevUrl(doc: Document, currentUrl: string): string | null {
  return findPageLink(doc, 'prev', currentUrl);
}
