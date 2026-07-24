import type { GalleryItem, PreviewDescriptor } from '../../core/gallery';

export interface EHentaiPageMetadata {
  totalPages: number;
  imageOffset?: number;
  perPage?: number;
}

export interface EHentaiViewerImage {
  src: string;
  nl?: string;
}

function paginationUrl(doc: Document, marker: '<' | '>'): string | null {
  const pagination = doc.querySelector('.ptt');
  if (!pagination) return null;
  const link = Array.from(pagination.querySelectorAll('td a'))
    .find(anchor => (anchor.textContent ?? '').includes(marker)) as HTMLAnchorElement | undefined;
  return link?.href ?? null;
}

export function getEHentaiNextUrl(doc: Document): string | null {
  return paginationUrl(doc, '>');
}

export function getEHentaiPrevUrl(doc: Document): string | null {
  return paginationUrl(doc, '<');
}

export function extractEHentaiItems(doc: Document): GalleryItem[] {
  return Array.from(doc.querySelectorAll('#gdt a')).map(element => {
    const anchor = element as HTMLAnchorElement;
    const url = anchor.href;
    let thumb: string | undefined;
    let thumbX: number | undefined;
    let thumbY: number | undefined;
    let thumbW: number | undefined;
    let thumbH: number | undefined;

    const sprite = anchor.querySelector('div[style*="background"]');
    if (sprite) {
      const style = sprite.getAttribute('style') || '';
      const source = style.match(/url\(['"]?([^)'"]+)['"]?\)/);
      if (source) thumb = source[1];
      const afterUrl = style.slice(style.indexOf(source ? source[0] : '') + (source ? source[0].length : 0));
      const position = afterUrl.match(/(-?\d+)(?:px)?\s+(-?\d+)(?:px)?/);
      if (position) {
        thumbX = Math.abs(parseInt(position[1], 10));
        thumbY = Math.abs(parseInt(position[2], 10));
      }
      const width = style.match(/width:\s*(\d+)px/);
      const height = style.match(/height:\s*(\d+)px/);
      if (width) thumbW = parseInt(width[1], 10);
      if (height) thumbH = parseInt(height[1], 10);
    } else {
      const img = anchor.querySelector('img') as HTMLImageElement | null;
      if (img?.src && !img.src.endsWith('x.gif')) thumb = img.src;
    }

    let preview: PreviewDescriptor = { kind: 'none' };
    if (thumb && thumbW !== undefined && thumbH !== undefined
        && (thumbX !== undefined || thumbY !== undefined)) {
      preview = {
        kind: 'sprite',
        src: thumb,
        crop: {
          x: thumbX ?? 0,
          y: thumbY ?? 0,
          width: thumbW,
          height: thumbH,
        },
      };
    } else if (thumb) {
      preview = {
        kind: 'url',
        src: thumb,
        ...(thumbW !== undefined && thumbH !== undefined
          ? { size: { width: thumbW, height: thumbH } }
          : {}),
      };
    }

    return { key: url, viewerUrl: url, preview };
  });
}

export function parseEHentaiPageMetadata(doc: Document, itemCount: number): EHentaiPageMetadata {
  let totalPages = 1;
  for (const cell of Array.from(doc.querySelectorAll('.ptt td'))) {
    const page = parseInt(cell.textContent ?? '', 10);
    if (!Number.isNaN(page) && page > totalPages) totalPages = page;
  }

  const range = doc.querySelector('.gpc')?.textContent ?? '';
  const match = range.match(/([\d,]+)\s*-\s*([\d,]+)[^\d]+([\d,]+)/);
  if (!match) return { totalPages };

  const start = parseInt(match[1].replace(/,/g, ''), 10);
  const end = parseInt(match[2].replace(/,/g, ''), 10);
  const total = parseInt(match[3].replace(/,/g, ''), 10);
  const imageOffset = start - 1;
  let perPage: number;
  if (start === 1) perPage = end;
  else if (end < total) perPage = end - start + 1;
  else if (totalPages > 1) perPage = Math.round(imageOffset / (totalPages - 1));
  else perPage = itemCount;

  return { totalPages, imageOffset, perPage };
}

export function buildEHentaiViewerUrl(url: string, nlToken?: string): string {
  if (!nlToken) return url;
  const viewerUrl = new URL(url);
  viewerUrl.searchParams.set('nl', nlToken);
  return viewerUrl.toString();
}

export function parseEHentaiViewer(doc: Document): EHentaiViewerImage | null {
  const image = doc.querySelector('#img') as HTMLImageElement | null;
  if (!image?.src) return null;
  const onerror = image.getAttribute('onerror') || '';
  const token = onerror.match(/nl\(['"]([^'"]+)['"]\)/)?.[1];
  return { src: image.src, ...(token ? { nl: token } : {}) };
}
