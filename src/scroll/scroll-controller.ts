import { store } from '../state/store';
import { CFG } from '../state/config';
import { LOAD_PRIORITY } from '../state/load-policy';
import type { GalleryItem } from '../core/gallery';
import { EmptyGalleryPageError, type GalleryPageLoader } from '../core/gallery-page-loader';
import { acquireImage } from '../services/image-load-runtime';
import type { ImageLoadLease } from '../services/image-load-service';
import { notifyScrollImageLoaded } from './image-events';
import { applyKnownImageGeometry } from './scroll-navigation';
import { i18n } from '../utils/i18n';

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
const pendingPlaceholders = new Set<HTMLElement>();
let pendingLoadObserver: IntersectionObserver | null = null;
const imageElementLeases = new WeakMap<HTMLElement, ImageLoadLease>();
const ownedPlaceholders = new WeakMap<HTMLElement, HTMLElement>();
const ownedImages = new Set<HTMLElement>();
let ownedImageObserver: IntersectionObserver | null = null;
let ownedObserverResizeRaf = 0;
let pendingSweepRaf = 0;

function stopObservingPendingLoad(
  placeholder: HTMLElement,
  lease: ImageLoadLease,
): void {
  if (placeholderLeases.get(placeholder) !== lease) return;
  pendingLoadObserver?.unobserve(placeholder);
  pendingPlaceholders.delete(placeholder);
}

function cancelPendingLoad(placeholder: HTMLElement, reobserve: boolean): void {
  const lease = placeholderLeases.get(placeholder);
  pendingLoadObserver?.unobserve(placeholder);
  pendingPlaceholders.delete(placeholder);
  if (!lease) return;

  // Detach ownership before releasing the shared task so its rejection cannot
  // turn a deliberate off-screen cancellation into an automatic retry.
  placeholderLeases.delete(placeholder);
  delete placeholder.dataset.isFetching;
  delete placeholder.dataset.lazyLoaded;
  lease.release();

  if (reobserve && placeholder.isConnected) lazyLoadObserver?.observe(placeholder);
}

function rebuildPendingLoadObserver(): void {
  pendingLoadObserver?.disconnect();
  const cancelDistance = Math.max(2000, Math.max(1, window.innerHeight) * 6);
  pendingLoadObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) cancelPendingLoad(entry.target as HTMLElement, true);
    }
  }, { rootMargin: `${cancelDistance}px 0px ${cancelDistance}px 0px` });
  pendingPlaceholders.forEach(placeholder => pendingLoadObserver?.observe(placeholder));
}

function observePendingLoad(placeholder: HTMLElement): void {
  pendingPlaceholders.add(placeholder);
  if (!pendingLoadObserver) rebuildPendingLoadObserver();
  pendingLoadObserver?.observe(placeholder);
}

function cancelFarPendingLoads(): void {
  if (document.documentElement.classList.contains('hr-reader-open')) return;
  const cancelDistance = Math.max(2000, Math.max(1, window.innerHeight) * 6);
  for (const placeholder of pendingPlaceholders) {
    const rect = placeholder.getBoundingClientRect();
    if (rect.bottom < -cancelDistance || rect.top > window.innerHeight + cancelDistance) {
      cancelPendingLoad(placeholder, true);
    }
  }
}

window.addEventListener('scroll', () => {
  cancelAnimationFrame(pendingSweepRaf);
  pendingSweepRaf = requestAnimationFrame(cancelFarPendingLoads);
}, { passive: true });

function restoreOwnedImage(image: HTMLElement): void {
  const placeholder = ownedPlaceholders.get(image);
  const lease = imageElementLeases.get(image);
  if (!placeholder || !lease || !image.parentNode) {
    ownedImageObserver?.unobserve(image);
    ownedImages.delete(image);
    return;
  }
  delete placeholder.dataset.lazyLoaded;
  delete placeholder.dataset.isFetching;
  applyKnownImageGeometry(placeholder, {
    width: Number(image.dataset.naturalWidth) || image.getBoundingClientRect().width,
    height: Number(image.dataset.naturalHeight) || image.getBoundingClientRect().height,
  });
  ownedImageObserver?.unobserve(image);
  ownedImages.delete(image);
  image.parentNode.replaceChild(placeholder, image);
  imageElementLeases.delete(image);
  ownedPlaceholders.delete(image);
  lease.release();
  lazyLoadObserver?.observe(placeholder);
}

function rebuildOwnedImageObserver(): void {
  ownedImageObserver?.disconnect();
  const releaseDistance = Math.max(1, window.innerHeight) * 6;
  ownedImageObserver = new IntersectionObserver(entries => {
    if (document.documentElement.classList.contains('hr-reader-open')) return;
    for (const entry of entries) {
      if (!entry.isIntersecting) restoreOwnedImage(entry.target as HTMLElement);
    }
  }, { rootMargin: `${releaseDistance}px 0px ${releaseDistance}px 0px` });
  ownedImages.forEach(image => ownedImageObserver?.observe(image));
}

function observeOwnedImage(image: HTMLElement): void {
  ownedImages.add(image);
  if (!ownedImageObserver) rebuildOwnedImageObserver();
  ownedImageObserver?.observe(image);
}

window.addEventListener('resize', () => {
  cancelAnimationFrame(ownedObserverResizeRaf);
  ownedObserverResizeRaf = requestAnimationFrame(() => {
    rebuildOwnedImageObserver();
    rebuildPendingLoadObserver();
  });
}, { passive: true });

function scheduleAutomaticRetry(placeholder: HTMLElement, pIndex: number, index: number): void {
  delete placeholder.dataset.isFetching;
  setErrorState(placeholder, pIndex, index);
  const attempts = parseInt(placeholder.dataset.autoRetryAttempts || '0', 10);
  if (attempts >= 1) return;
  placeholder.dataset.autoRetryAttempts = String(attempts + 1);

  setTimeout(() => {
    delete placeholder.dataset.lazyLoaded;
    if (document.documentElement.classList.contains('hr-reader-open')) return;
    if (lazyLoadObserver) lazyLoadObserver.observe(placeholder);
    else loadPlaceholderImage(placeholder);
  }, 750);
}

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
  const rect = placeholder.getBoundingClientRect();
  const inViewport = rect.bottom >= 0 && rect.top <= window.innerHeight;
  const nearViewport = rect.bottom >= -window.innerHeight * 2 && rect.top <= window.innerHeight * 3;
  const lease = acquireImage(url, {
    intent: inViewport ? 'foreground' : 'scroll',
    priority: inViewport
      ? LOAD_PRIORITY.foreground
      : nearViewport
        ? LOAD_PRIORITY.scroll
        : LOAD_PRIORITY.scroll - 10,
  });
  placeholderLeases.set(placeholder, lease);
  observePendingLoad(placeholder);

  lease.result.then(asset => {
    if (placeholderLeases.get(placeholder) !== lease) return;
    stopObservingPendingLoad(placeholder, lease);
    if (!asset) {
      scheduleAutomaticRetry(placeholder, pIndex, index);
      return;
    }

    const img = document.createElement('img');
    img.className = 'r-img';
    img.alt = `Page ${pIndex}-${index + 1}`;
    img.decoding = 'async';
    img.fetchPriority = inViewport ? 'high' : nearViewport ? 'auto' : 'low';
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
      ownedImageObserver?.unobserve(img);
      ownedImages.delete(img);
      imageElementLeases.get(img)?.release();
      imageElementLeases.delete(img);
      if (img.parentNode) img.parentNode.replaceChild(placeholder, img);
      scheduleAutomaticRetry(placeholder, pIndex, index);
    };

    img.src = asset.src;
    placeholder.parentNode?.replaceChild(img, placeholder);
    if (asset.ownsObjectUrl) {
      img.dataset.ownsObjectUrl = 'true';
      img.dataset.naturalWidth = String(asset.width);
      img.dataset.naturalHeight = String(asset.height);
      placeholderLeases.delete(placeholder);
      imageElementLeases.set(img, lease);
      ownedPlaceholders.set(img, placeholder);
      observeOwnedImage(img);
    }

    const itemKey = placeholder.dataset.itemKey;
    const itemIndex = itemKey
      ? store.galleryItems.findIndex(item => item.key === itemKey)
      : store.galleryItems.findIndex(item => item.viewerUrl === url);
    if (itemIndex !== -1) {
      notifyScrollImageLoaded({ index: itemIndex, element: img, viewerUrl: url });
    }
  }).catch(() => {
    if (placeholderLeases.get(placeholder) !== lease) return;
    stopObservingPendingLoad(placeholder, lease);
    scheduleAutomaticRetry(placeholder, pIndex, index);
  }).finally(() => {
    if (placeholderLeases.get(placeholder) === lease) {
      stopObservingPendingLoad(placeholder, lease);
      placeholderLeases.delete(placeholder);
      lease.release();
    }
  });
}

function initLazyLoad() {
  if (lazyLoadObserver) return;
  lazyLoadObserver = new IntersectionObserver((entries) => {
    if (document.documentElement.classList.contains('hr-reader-open')) return;
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
  // Reader foreground work must not wait behind scroll tasks that were started
  // for a viewport the user has just left.
  [...pendingPlaceholders].forEach(placeholder => cancelPendingLoad(placeholder, false));
}

export function resumeLazyLoad(): void {
  if (!lazyLoadObserver) return;
  // Re-observing also releases owned images that became far away while the
  // Reader froze page scrolling and suspended resource cleanup callbacks.
  if (ownedImages.size > 0) rebuildOwnedImageObserver();
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
    if (store.settings.scrollMode
        && !document.documentElement.classList.contains('hr-reader-open')) {
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

export function setupAutoScroll(pageLoader: GalleryPageLoader): () => void {
  const scrollSent = document.createElement('div');
  document.body.appendChild(scrollSent);

  const errorSentinel = document.createElement('div');
  errorSentinel.className = 'hr-pagination-error';
  errorSentinel.hidden = true;
  const errorText = document.createElement('span');
  errorText.textContent = i18n.paginationFailed;
  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.textContent = i18n.retry;
  errorSentinel.append(errorText, retryButton);
  scrollSent.before(errorSentinel);

  const showError = () => {
    errorSentinel.hidden = false;
    pageObs.unobserve(scrollSent);
  };

  const hideError = () => {
    errorSentinel.hidden = true;
  };

  async function loadNextPage(): Promise<void> {
    if (!store.nextUrl || store.isFetching) return;
    const requestedUrl = store.nextUrl;
    store.isFetching = true;
    hideError();
    try {
      const page = await pageLoader.loadPage(requestedUrl);
      if (!page) {
        store.nextUrl = null;
        pageObs.disconnect();
        return;
      }
      store.currPage++;
      processBatch(page.items, store.currPage, store.activeAdapter?.getContainer() || document.querySelector('.scroll-mode .entry-content, .scroll-mode .wp-block-post-content, .scroll-mode .post-content') as HTMLElement || document.body, false, page.pageUrl);
      store.nextUrl = page.nextUrl;
      if (!store.nextUrl) pageObs.disconnect();
    } catch (err) {
      if (err instanceof EmptyGalleryPageError) {
        store.nextUrl = null;
        pageObs.disconnect();
      } else {
        console.error('[Hentai-Reader] Infinite pagination failed', err);
        showError();
      }
    } finally {
      store.isFetching = false;
    }
  }

  const pageObs = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) void loadNextPage();
  }, { rootMargin: CFG.scrollPageRootMargin });

  retryButton.addEventListener('click', () => {
    hideError();
    pageObs.observe(scrollSent);
    void loadNextPage();
  });
  pageObs.observe(scrollSent);
  return () => {
    pageObs.disconnect();
    retryButton.replaceWith();
    errorSentinel.remove();
    scrollSent.remove();
  };
}
