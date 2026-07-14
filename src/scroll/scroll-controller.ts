import { store } from '../state/store';
import { CFG } from '../state/config';
import { LOAD_PRIORITY } from '../state/load-policy';
import type { GalleryItem } from '../core/gallery';
import { EmptyGalleryPageError, type GalleryPageLoader } from '../core/gallery-page-loader';
import { acquireImage } from '../services/image-load-runtime';
import type { ImageLoadLease } from '../services/image-load-service';
import { notifyScrollImageLoaded } from './image-events';
import { applyKnownImageGeometry } from './scroll-navigation';

function setErrorState(
  placeholder: HTMLElement,
  pIndex: number,
  index: number
): void {
  placeholder.className = 'r-ph sp-placeholder error';
  placeholder.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; transform: translateY(-20px);">
      <div style="display: flex; align-items: center; gap: 10px; background: rgba(200, 40, 40, 0.8); border: 1px solid rgba(255, 255, 255, 0.2); padding: 10px 20px; border-radius: 30px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); margin-bottom: 16px;">
        <svg style="color: #fff; width: 20px; height: 20px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <div style="font-size: 15px; color: #fff; font-weight: 500; letter-spacing: 0.5px;">Load Failed</div>
      </div>
      <div style="font-size: 14px; color: rgba(255, 255, 255, 0.5); font-family: monospace; letter-spacing: 1px;">P${pIndex}-${index + 1}</div>
    </div>
  `;
}

let lazyLoadObserver: IntersectionObserver | null = null;
const placeholderLeases = new WeakMap<HTMLElement, ImageLoadLease>();
const imageElementLeases = new WeakMap<HTMLElement, ImageLoadLease>();

export function loadPlaceholderImage(placeholder: HTMLElement): void {
  const url = placeholder.dataset.url;
  const adapter = store.activeAdapter;
  if (!url || !adapter) return;

  if (placeholder.dataset.isFetching === 'true') {
    return;
  }
  placeholder.dataset.isFetching = 'true';
  placeholder.dataset.lazyLoaded = 'true';

  const pIndex = parseInt(placeholder.dataset.pIndex || '0', 10);
  const index = parseInt(placeholder.dataset.index || '0', 10);
  const lease = acquireImage(url, { intent: 'scroll', priority: LOAD_PRIORITY.scroll });
  placeholderLeases.set(placeholder, lease);

  lease.result.then(asset => {
    if (placeholderLeases.get(placeholder) !== lease) return;
    if (!asset) {
      setErrorState(placeholder, pIndex, index);
      return;
    }

    const img = document.createElement('img');
    img.className = 'r-img';
    img.decoding = 'async';
    img.dataset.viewerUrl = url;
    if (placeholder.dataset.itemKey) img.dataset.itemKey = placeholder.dataset.itemKey;
    img.dataset.realSrc = asset.src;
    if (placeholder.dataset.thumb) img.dataset.thumbSrc = placeholder.dataset.thumb;
    if (placeholder.dataset.thumbW) img.dataset.thumbW = placeholder.dataset.thumbW;
    if (placeholder.dataset.thumbH) img.dataset.thumbH = placeholder.dataset.thumbH;
    if (placeholder.dataset.thumbX !== undefined) img.dataset.thumbX = placeholder.dataset.thumbX;
    if (placeholder.dataset.thumbY !== undefined) img.dataset.thumbY = placeholder.dataset.thumbY;

    applyKnownImageGeometry(img, asset);
    img.onload = () => {
      if (img.dataset.locked || img.naturalWidth <= 0) return;
      applyKnownImageGeometry(img, {
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      img.dataset.locked = 'true';
    };
    img.onerror = () => {
      imageElementLeases.get(img)?.release();
      imageElementLeases.delete(img);
      if (img.parentNode) img.parentNode.replaceChild(placeholder, img);
      setErrorState(placeholder, pIndex, index);
    };

    img.src = asset.src;
    placeholder.parentNode?.replaceChild(img, placeholder);
    if (asset.ownsObjectUrl) {
      placeholderLeases.delete(placeholder);
      imageElementLeases.set(img, lease);
    }

    const itemKey = placeholder.dataset.itemKey;
    const itemIndex = itemKey
      ? store.galleryItems.findIndex(item => item.key === itemKey)
      : store.galleryItems.findIndex(item => item.viewerUrl === url);
    if (itemIndex !== -1) {
      notifyScrollImageLoaded({ index: itemIndex, element: img, viewerUrl: url });
    }
  }).catch(() => {
    setErrorState(placeholder, pIndex, index);
  }).finally(() => {
    if (placeholderLeases.get(placeholder) === lease) {
      placeholderLeases.delete(placeholder);
      lease.release();
    }
  });
}

function initLazyLoad() {
  if (lazyLoadObserver) return;
  lazyLoadObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const placeholder = entry.target as HTMLElement;
        if (placeholder.dataset.lazyLoaded) return;
        placeholder.dataset.lazyLoaded = 'true';
        lazyLoadObserver?.unobserve(placeholder);

        loadPlaceholderImage(placeholder);
      }
    });
  }, { rootMargin: '2000px 0px 2000px 0px' });
}

// While the reader is open the page scroll is frozen (overflow:hidden), so the
// lazy-load observer wouldn't fire anyway — but relying on that side effect is
// fragile. Pause it explicitly on reader open so a stray intersection (layout
// shift, prepended prev-page) can't kick off an off-screen load the reader
// doesn't want, then resume on close. disconnect() clears the watch list, so
// resume re-observes every placeholder still awaiting load.
export function pauseLazyLoad(): void {
  lazyLoadObserver?.disconnect();
}

export function resumeLazyLoad(): void {
  if (!lazyLoadObserver) return;
  document.querySelectorAll<HTMLElement>('.r-ph').forEach(ph => {
    if (!ph.dataset.lazyLoaded) lazyLoadObserver!.observe(ph);
  });
}

export function processBatch(items: GalleryItem[], pIndex: number, container?: HTMLElement, prepend = false, pageUrl?: string): void {
  const batchDiv = document.createElement('div');
  batchDiv.className = 'hr-page-batch';
  if (pageUrl) {
    batchDiv.dataset.pageUrl = pageUrl;
  }
  const fragment = document.createDocumentFragment();


  initLazyLoad();

  let targetContainer = container;
  if (!targetContainer) {
    targetContainer = document.querySelector('#gdt-hidden') as HTMLElement || 
                      store.activeAdapter?.getContainer() ||
                      document.querySelector('.scroll-mode .entry-content, .scroll-mode .wp-block-post-content, .scroll-mode .post-content') as HTMLElement || 
                      document.body;
  }

  items.forEach((item, index) => {
    const url = item.viewerUrl;
    const placeholder = document.createElement('div');
    placeholder.className = 'r-ph sp-placeholder loading';
    placeholder.dataset.url = url;
    placeholder.dataset.pIndex = String(pIndex);
    placeholder.dataset.index = String(index);
    placeholder.dataset.itemKey = item.key;
    if (item.dimensions) {
      applyKnownImageGeometry(placeholder, item.dimensions);
    }
    if (item.preview.kind === 'url') {
      placeholder.dataset.thumb = item.preview.src;
      if (item.preview.size) {
        placeholder.dataset.thumbW = String(item.preview.size.width);
        placeholder.dataset.thumbH = String(item.preview.size.height);
      }
    } else if (item.preview.kind === 'sprite') {
      placeholder.dataset.thumb = item.preview.src;
      placeholder.dataset.thumbW = String(item.preview.crop.width);
      placeholder.dataset.thumbH = String(item.preview.crop.height);
      placeholder.dataset.thumbX = String(item.preview.crop.x);
      placeholder.dataset.thumbY = String(item.preview.crop.y);
    }

    placeholder.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; transform: translateY(-20px);">
        <div style="display: flex; align-items: center; gap: 10px; background: rgba(20, 20, 20, 0.8); border: 1px solid rgba(255, 255, 255, 0.1); padding: 10px 20px; border-radius: 30px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); margin-bottom: 16px;">
          <svg class="hr-spinner" style="color: #F596AA; width: 20px; height: 20px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
          </svg>
          <div style="font-size: 15px; color: #f3f4f6; font-weight: 500; letter-spacing: 0.5px;">Loading...</div>
        </div>
        <div style="font-size: 14px; color: rgba(255, 255, 255, 0.5); font-family: monospace; letter-spacing: 1px;">P${pIndex}-${index + 1}</div>
      </div>
    `;
    fragment.appendChild(placeholder);

    // Scroll mode lazy-loads via the observer as placeholders scroll into view.
    // Non-scroll mode shows images only through the reader (PhotoSwipe), which
    // resolves the current slide + directional neighbours on demand, so these
    // placeholders need no eager network work — that just bursts the limiter.
    if (store.settings.scrollMode) {
      lazyLoadObserver?.observe(placeholder);
    }
  });

  batchDiv.appendChild(fragment);
  if (prepend && targetContainer.firstChild) {
    store.galleryItems = [...items, ...store.galleryItems];
    targetContainer.insertBefore(batchDiv, targetContainer.firstChild);
  } else {
    store.galleryItems.push(...items);
    targetContainer.appendChild(batchDiv);
  }
}

export function setupAutoScroll(pageLoader: GalleryPageLoader): void {
  const scrollSent = document.createElement('div');
  document.body.appendChild(scrollSent);

  const pageObs = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && store.nextUrl && !store.isFetching) {
      const requestedUrl = store.nextUrl;
      store.isFetching = true;
      pageLoader.loadPage(requestedUrl).then(page => {
        if (!page) {
          store.nextUrl = null;
          pageObs.disconnect();
          return;
        }
        store.currPage++;
        processBatch(page.items, store.currPage, store.activeAdapter?.getContainer() || document.querySelector('.scroll-mode .entry-content, .scroll-mode .wp-block-post-content, .scroll-mode .post-content') as HTMLElement || document.body, false, page.pageUrl);

        store.nextUrl = page.nextUrl;
        if (!store.nextUrl) pageObs.disconnect();
      }).catch(err => {
        if (err instanceof EmptyGalleryPageError) {
          store.nextUrl = null;
          pageObs.disconnect();
        }
      }).finally(() => { store.isFetching = false; });
    }
  }, { rootMargin: CFG.nextPage });

  pageObs.observe(scrollSent);
}
