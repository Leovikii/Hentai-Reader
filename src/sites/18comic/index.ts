import type { SiteAdapter, PageLink } from '../../types/site-adapter';

declare const unsafeWindow: any;

class Mutex {
  private queue: { key: string, resolve: () => void, reject: (reason?: unknown) => void }[] = [];
  private activeCount = 0;
  constructor(private maxConcurrent: number) {}

  async lock(key: string): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return;
    }
    return new Promise((resolve, reject) => this.queue.push({ key, resolve, reject }));
  }

  bump(key: string): void {
    const idx = this.queue.findIndex(q => q.key === key);
    if (idx !== -1) {
      const item = this.queue.splice(idx, 1)[0];
      this.queue.push(item);
    }
  }

  /**
   * Drop still-waiting locks whose key matches `predicate`, rejecting them with
   * a `{ cancelled: true }` sentinel. Already-running decodes are left alone —
   * they hold a slot and can't be un-decoded. Used on a large reader jump to
   * abandon the decodes queued for pages the user skipped past, so the target
   * page's decode isn't stuck behind them.
   */
  cancel(predicate: (key: string) => boolean): void {
    if (this.queue.length === 0) return;
    const kept: typeof this.queue = [];
    for (const item of this.queue) {
      if (predicate(item.key)) item.reject({ cancelled: true });
      else kept.push(item);
    }
    this.queue = kept;
  }

  unlock(): void {
    if (this.queue.length > 0) {
      const next = this.queue.pop();
      next?.resolve();
    } else {
      this.activeCount--;
    }
  }
}

const decodeMutex = new Mutex(3);

/**
 * Cache of decoded/reassembled images, keyed by the viewer URL.
 * Values are Promises resolving to the object-URL of the stitched JPEG.
 *
 * 18comic runs in scroll mode, which keeps every decoded <img> in the DOM so
 * scroll-back is instant. That means a decoded blob may be referenced by a live
 * DOM node AND by this cache at the same time — we must never revoke a blob that
 * is still on screen, or the image goes blank.
 *
 * So the cap is deliberately generous (normal reading never evicts) and eviction
 * only revokes a blob once we've confirmed no live element still points at it.
 * This reclaims memory on marathon sessions without ever breaking a visible page.
 */
const imageCache = new Map<string, Promise<{ src: string }>>();
const MAX_DECODED_CACHE = 80;

/** Collect object-URLs currently referenced by on-screen elements. */
function collectInUseSrcs(): Set<string> {
  const inUse = new Set<string>();
  document.querySelectorAll<HTMLElement>('.r-img').forEach(el => {
    const real = el.dataset.realSrc || (el as HTMLImageElement).src;
    if (real && real.startsWith('blob:')) inUse.add(real);
  });
  return inUse;
}

/** Evict oldest cache entries past the cap, revoking blobs no longer on screen. */
async function trimImageCache(): Promise<void> {
  if (imageCache.size <= MAX_DECODED_CACHE) return;
  const inUse = collectInUseSrcs();
  // Map preserves insertion order, so the first keys are the oldest.
  for (const key of Array.from(imageCache.keys())) {
    if (imageCache.size <= MAX_DECODED_CACHE) break;
    const entry = imageCache.get(key)!;
    imageCache.delete(key);
    try {
      const { src } = await entry;
      if (src.startsWith('blob:') && !inUse.has(src)) {
        URL.revokeObjectURL(src);
      }
    } catch {
      // Failed decodes hold no blob; nothing to revoke.
    }
  }
}

export const Comic18Adapter: SiteAdapter = {
  name: '18comic',

  match: (url: string): boolean => {
    return url.includes('18comic.vip') || url.includes('18comic.ink');
  },

  init: async (doc: Document): Promise<{ links: PageLink[]; nextUrl: string | null; prevUrl: string | null }> => {
    const aidMatch = doc.documentElement.innerHTML.match(/aid\s*=\s*['"]?(\d+)['"]?/);
    const scrambleMatch = doc.documentElement.innerHTML.match(/scramble_id\s*=\s*['"]?(\d+)['"]?/);
    
    const aid = aidMatch ? aidMatch[1] : (unsafeWindow.aid ? String(unsafeWindow.aid) : '');
    const scrambleId = scrambleMatch ? scrambleMatch[1] : (unsafeWindow.scramble_id ? String(unsafeWindow.scramble_id) : '');

    const links: PageLink[] = [];
    const seenUrls = new Set<string>();
    const imgs = doc.querySelectorAll('.scramble-page img[id], .owl-item .center img[id]');
    
    imgs.forEach((img: Element) => {
      const url = img.getAttribute('data-original') || img.getAttribute('data-src') || (img as HTMLImageElement).src;
      if (url) {
        // Encode aid and scramble_id into the URL hash to handle cross-chapter pagination
        const urlObj = new URL(url, window.location.href);
        if (aid) urlObj.searchParams.set('18aid', aid);
        if (scrambleId) urlObj.searchParams.set('18scid', scrambleId);
        
        const viewerUrl = urlObj.toString();
        if (!seenUrls.has(viewerUrl)) {
          seenUrls.add(viewerUrl);
          links.push({ url: viewerUrl });
        }

        // We purposefully keep original attributes so native scripts don't crash.
        // However, to prevent the native script from initiating 300 background Canvas decodes
        // when we detach these images, we trick it into thinking they are infinitely far away.
        try {
          (img as HTMLElement).getBoundingClientRect = () => ({
            top: 999999, left: 0, right: 0, bottom: 999999, width: 0, height: 0, x: 0, y: 0, toJSON: () => {}
          });
        } catch (e) {}
      }
    });

    return {
      links,
      nextUrl: getNextUrl(doc),
      prevUrl: getPrevUrl(doc),
    };
  },

  fetchPage: async (url: string): Promise<{ links: PageLink[]; nextUrl: string | null; prevUrl: string | null }> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch page: HTTP ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const aidMatch = html.match(/aid\s*=\s*['"]?(\d+)['"]?/);
    const scrambleMatch = html.match(/scramble_id\s*=\s*['"]?(\d+)['"]?/);
    
    const aid = aidMatch ? aidMatch[1] : '';
    const scrambleId = scrambleMatch ? scrambleMatch[1] : '';

    const links: PageLink[] = [];
    const seenUrls = new Set<string>();
    const imgs = doc.querySelectorAll('.scramble-page img[id], .owl-item .center img[id]');
    
    imgs.forEach((img: Element) => {
      const imgUrl = img.getAttribute('data-original') || img.getAttribute('data-src') || (img as HTMLImageElement).src;
      if (imgUrl) {
        const urlObj = new URL(imgUrl, window.location.href);
        if (aid) urlObj.searchParams.set('18aid', aid);
        if (scrambleId) urlObj.searchParams.set('18scid', scrambleId);
        const viewerUrl = urlObj.toString();
        if (!seenUrls.has(viewerUrl)) {
          seenUrls.add(viewerUrl);
          links.push({ url: viewerUrl });
        }
      }
    });

    return {
      links,
      nextUrl: getNextUrl(doc),
      prevUrl: getPrevUrl(doc),
    };
  },

  resolveImage: async (urlStr: string): Promise<{ src: string }> => {
    try {
      const urlObj = new URL(urlStr);
      const aid = urlObj.searchParams.get('18aid');
      const scrambleId = urlObj.searchParams.get('18scid');
      
      // Clean up the URL
      urlObj.searchParams.delete('18aid');
      urlObj.searchParams.delete('18scid');
      const realUrl = urlObj.toString();

      if (realUrl.includes('.gif') || !aid || !scrambleId || Number(aid) < Number(scrambleId)) {
        return { src: realUrl };
      }

      if (imageCache.has(urlStr)) {
        decodeMutex.bump(urlStr);
        return imageCache.get(urlStr)!;
      }

      const p = (async () => {
        // Lock Mutex BEFORE fetching to limit network concurrency as well as CPU
        await decodeMutex.lock(urlStr);
      try {
        // Fetch the blob
        const res = await fetch(realUrl);
        if (!res.ok) throw new Error('Failed to fetch image');
        const blob = await res.blob();
        
        const fileName = urlObj.pathname.split('/').pop() || '';
        const id = fileName.split('.')[0];
        if (!id) return { src: realUrl };

        const bitmap = await createImageBitmap(blob);
        const imgWidth = bitmap.width;
        const imgHeight = bitmap.height;

        if (!unsafeWindow.get_num) {
          bitmap.close();
          return { src: realUrl };
        }

        const num = unsafeWindow.get_num(btoa(aid), btoa(id));
        if (!num || num <= 1) {
          bitmap.close();
          return { src: realUrl };
        }

        const canvas = new OffscreenCanvas(imgWidth, imgHeight);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          bitmap.close();
          return { src: realUrl };
        }

        // Fill with white to prevent transparent WebP/PNG artifacts in JPEG export
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, imgWidth, imgHeight);

        const cropHeight = Number(imgHeight % num);
        const sHeight = Math.floor(imgHeight / num);
        let sy = imgHeight - cropHeight - sHeight;
        let dy = cropHeight + sHeight;
        
        // Draw first piece (includes remainder)
        ctx.drawImage(bitmap, 0, sy, imgWidth, cropHeight + sHeight, 0, 0, imgWidth, cropHeight + sHeight);
        
        // Draw subsequent pieces
        for (let i = 1; i < num; ++i) {
          sy -= sHeight;
          ctx.drawImage(bitmap, 0, sy, imgWidth, sHeight, 0, dy, imgWidth, sHeight);
          dy += sHeight;
        }

        bitmap.close(); // Clean up bitmap memory

        // Export as JPEG for massive encoding performance boost over WebP
        const finalBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        const finalUrl = URL.createObjectURL(finalBlob);

        return { src: finalUrl };
      } finally {
        decodeMutex.unlock();
      }

      })();

      imageCache.set(urlStr, p);
      // A rejected decode (cancelled mid-jump, or a failed fetch) must not stay
      // cached — a poisoned promise would be handed to every future visitor of
      // this page. Evict it so a later visit can retry cleanly.
      p.catch(() => { if (imageCache.get(urlStr) === p) imageCache.delete(urlStr); });
      // After this decode lands, reclaim memory from long-past pages (never
      // touches blobs still on screen). Fire-and-forget; failures are harmless.
      p.then(() => trimImageCache()).catch(() => {});
      return p;

    } catch (err) {
      // Fallback to original url
      const cleanUrl = new URL(urlStr);
      cleanUrl.searchParams.delete('18aid');
      cleanUrl.searchParams.delete('18scid');
      return { src: cleanUrl.toString() };
    }
  },

  bumpPriority: (urlStr: string) => {
    decodeMutex.bump(urlStr);
  },

  cancelPrefetch: (keepUrls: Set<string>) => {
    // A reader jump abandoned a range of pages. Drop the decodes still queued
    // for any page outside the new window so the target page isn't stuck behind
    // them. keepUrls holds the window's viewer URLs (the decode-queue keys).
    decodeMutex.cancel((key) => !keepUrls.has(key));
  },

  getContainer: () => {
    return document.querySelector('.scramble-page') || document.body;
  },

  hideOriginalElements: () => {
    const scramblePages = Array.from(document.querySelectorAll('.scramble-page'));
    for (let i = 1; i < scramblePages.length; i++) {
      scramblePages[i].remove();
    }
    document.querySelectorAll('.owl-carousel').forEach(el => el.remove());
  }
};

function getNextUrl(doc: Document): string | null {
  const activeLi = doc.querySelector('.pagination li.active');
  if (activeLi) {
    const nextA = activeLi.nextElementSibling?.querySelector('a:not(.prevnext)');
    if (nextA) return (nextA as HTMLAnchorElement).href;
  }
  
  const nextChapter = Array.from(doc.querySelectorAll('.menu-bolock-ul a[href^="/photo/"]'))
    .find(a => a.textContent?.includes('下一'));
  if (nextChapter) return (nextChapter as HTMLAnchorElement).href;
  
  return null;
}

function getPrevUrl(doc: Document): string | null {
  const activeLi = doc.querySelector('.pagination li.active');
  if (activeLi) {
    const prevA = activeLi.previousElementSibling?.querySelector('a:not(.prevnext)');
    if (prevA) return (prevA as HTMLAnchorElement).href;
  }
  
  const prevChapter = Array.from(doc.querySelectorAll('.menu-bolock-ul a[href^="/photo/"]'))
    .find(a => a.textContent?.includes('上一'));
  if (prevChapter) return (prevChapter as HTMLAnchorElement).href;
  
  return null;
}
