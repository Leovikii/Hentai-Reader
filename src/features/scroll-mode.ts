import { store } from '../state/store';
import { CFG } from '../state/config';
import type { PageLink } from '../types/site-adapter';
import { showToast } from '../utils/dom';
import { resolveImageWithRetry, attachImageRetry } from './image-retry';

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

// De-dupe concurrent resolves of the same URL. Multiple independent callers
// (itemData for the current slide, directional prefetch, thumbnail-triggered
// loads, scroll-mode lazy-load) used to each fire their own network request for
// the same image, doubling load on the host. Now the first caller's in-flight
// promise is shared; later callers await it instead of issuing a second fetch.
//
// Two maps because `force` (a byte-load retry after a dead node) must bypass the
// resolvedUrls cache to get a *fresh* node — but concurrent force retries of the
// SAME url should still share one request rather than each hammer the already-
// failing node (the retry storm that overloads a hath node into 0-byte replies).
// So: force retries de-dupe among themselves (inFlightForce), and a plain caller
// may piggyback on either map (any pending resolve yields a valid src).
const inFlight = new Map<string, Promise<{ src: string; nl?: string } | null>>();
const inFlightForce = new Map<string, Promise<{ src: string; nl?: string } | null>>();

export function prefetchImageUrl(url: string, nlToken?: string, force = false, priority = 0): Promise<{ src: string; nl?: string } | null> {
  if (!force && store.resolvedUrls.has(url)) {
    return Promise.resolve({ src: store.resolvedUrls.get(url)! });
  }
  const adapter = store.activeAdapter;
  if (!adapter) return Promise.resolve(null);

  if (!force) {
    // A plain caller can share any pending resolve (force or not); both yield a
    // valid fresh src. Prefer a force task if one's running (it's the freshest).
    const pending = inFlightForce.get(url) || inFlight.get(url);
    if (pending) {
      if (adapter.bumpPriority) adapter.bumpPriority(url);
      return pending;
    }
  } else {
    // A force retry only shares another in-flight *force* request — never a plain
    // one (which might resolve from a stale/cached path). This collapses the N
    // concurrent retries of one failing image (reader chain + waterfall chain +
    // prefetch) down to a single network request.
    const pendingForce = inFlightForce.get(url);
    if (pendingForce) {
      if (adapter.bumpPriority) adapter.bumpPriority(url);
      return pendingForce;
    }
  }

  const map = force ? inFlightForce : inFlight;
  const task = (async () => {
    try {
      const res = await adapter.resolveImage(url, nlToken, priority);
      if (res && res.src) {
        store.resolvedUrls.set(url, res.src);
        return res;
      }
      return null;
    } catch (err) {
      return null;
    } finally {
      map.delete(url);
    }
  })();

  map.set(url, task);
  return task;
}

export function loadPlaceholderImage(placeholder: HTMLElement) {
  const url = placeholder.dataset.url!;
  const pIndex = parseInt(placeholder.dataset.pIndex!);
  const index = parseInt(placeholder.dataset.index!);
  const thumb = placeholder.dataset.thumb;

  const adapter = store.activeAdapter;
  if (!adapter) return;

  if (placeholder.dataset.isFetching === 'true') {
    if (adapter.bumpPriority) adapter.bumpPriority(url);
    return;
  }
  placeholder.dataset.isFetching = 'true';
  placeholder.dataset.lazyLoaded = 'true';

  resolveImageWithRetry(url).then(res => {
    if (res) {
      const img = document.createElement('img');
      img.className = 'r-img';
      img.decoding = 'async';
      img.dataset.viewerUrl = url;
      img.dataset.realSrc = res.src;
      if (thumb) img.dataset.thumbSrc = thumb;
      if (placeholder.dataset.thumbW) img.dataset.thumbW = placeholder.dataset.thumbW;
      if (placeholder.dataset.thumbH) img.dataset.thumbH = placeholder.dataset.thumbH;
      // Carry the sprite-sheet crop offset too, so the thumbnail panel can crop
      // this cell while the full image is still loading (scroll-mode reader).
      if (placeholder.dataset.thumbX !== undefined) img.dataset.thumbX = placeholder.dataset.thumbX;
      if (placeholder.dataset.thumbY !== undefined) img.dataset.thumbY = placeholder.dataset.thumbY;
      if (res.nl) img.dataset.nl = res.nl;
      
      if (store.activeAdapter?.extractDimensionFromResolvedUrl) {
         const extracted = store.activeAdapter.extractDimensionFromResolvedUrl(res.src);
         if (extracted) {
            img.style.aspectRatio = `${extracted.w} / ${extracted.h}`;
            store.imageDimensions.set(url, extracted);
         }
      }
      let currentNlToken = res.nl;

      attachImageRetry(img, {
        viewerUrl: url,
        nl: currentNlToken,
        priority: 20,
        shouldContinue: () => !!placeholder.parentNode || !!img.parentNode,
        onRetry: (attempt, kind) => {
          if (kind === 'node') {
            showToast(`P${pIndex}-${index + 1}: Auto requesting new node... (${attempt}/3)`, 3000);
          } else {
            showToast(`P${pIndex}-${index + 1}: Retrying... (${attempt}/2)`, 3000);
          }
          // Swap back to loading placeholder to show retry is in progress
          if (placeholder.parentNode) {
            placeholder.className = 'r-ph sp-placeholder loading';
            if (img.parentNode) img.parentNode.replaceChild(placeholder, img);
          }
        },
        onSuccess: (newSrc) => {
          img.dataset.realSrc = newSrc;
          // Swap placeholder → img back into DOM on successful retry
          if (placeholder.parentNode) {
            placeholder.parentNode.replaceChild(img, placeholder);
            const storeIdx = store.allImages.indexOf(placeholder);
            if (storeIdx !== -1) {
              store.allImages[storeIdx] = img;
              document.dispatchEvent(new CustomEvent('sp-image-loaded', { detail: { index: storeIdx } }));
            }
          }
        },
        onFail: () => {
          if (placeholder.parentNode) {
            setErrorState(placeholder, pIndex, index);
            if (img.parentNode) img.parentNode.replaceChild(placeholder, img);
          } else if (img.parentNode) {
            // Image is in DOM but placeholder detached — swap first, then error
            img.parentNode.replaceChild(placeholder, img);
            setErrorState(placeholder, pIndex, index);
          }
        }
      });

      img.onload = () => {
        if (!img.dataset.locked && img.naturalWidth > 0) {
          img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
          img.style.width = '100%';
          img.style.maxWidth = `${img.naturalWidth}px`;
          img.style.height = 'auto';
          img.dataset.locked = 'true';
        }
      };

      img.src = res.src;
      placeholder.parentNode?.replaceChild(img, placeholder);
      
      const storeIdx = store.allImages.indexOf(placeholder);
      if (storeIdx !== -1) {
        store.allImages[storeIdx] = img;
        document.dispatchEvent(new CustomEvent('sp-image-loaded', { detail: { index: storeIdx } }));
      }
    } else {
      setErrorState(placeholder, pIndex, index);
    }
  }).catch(() => {
    setErrorState(placeholder, pIndex, index);
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

export function processBatch(links: PageLink[], pIndex: number, container?: HTMLElement, prepend = false, pageUrl?: string): void {
  const batchDiv = document.createElement('div');
  batchDiv.className = 'page-batch';
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

  links.forEach((link, index) => {
    const url = link.url;
    const placeholder = document.createElement('div');
    placeholder.className = 'r-ph sp-placeholder loading';
    placeholder.dataset.url = url;
    placeholder.dataset.pIndex = String(pIndex);
    placeholder.dataset.index = String(index);
    if (link.thumb) placeholder.dataset.thumb = link.thumb;
    if (link.thumbW) placeholder.dataset.thumbW = String(link.thumbW);
    if (link.thumbH) placeholder.dataset.thumbH = String(link.thumbH);
    if (link.thumbX !== undefined) placeholder.dataset.thumbX = String(link.thumbX);
    if (link.thumbY !== undefined) placeholder.dataset.thumbY = String(link.thumbY);

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
    targetContainer.insertBefore(batchDiv, targetContainer.firstChild);
  } else {
    targetContainer.appendChild(batchDiv);
  }
}

export function setupAutoScroll(): void {
  const scrollSent = document.createElement('div');
  document.body.appendChild(scrollSent);

  const pageObs = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && store.nextUrl && !store.isFetching) {
      store.isFetching = true;
      store.activeAdapter!.fetchPage(store.nextUrl).then(({ links, nextUrl: nUrl }) => {
        store.currPage++;
        processBatch(links, store.currPage, store.activeAdapter?.getContainer() || document.querySelector('.scroll-mode .entry-content, .scroll-mode .wp-block-post-content, .scroll-mode .post-content') as HTMLElement || document.body);

        store.nextUrl = nUrl;
        store.isFetching = false;
        store.nextPagePrefetched = false;
        if (!store.nextUrl) pageObs.disconnect();
      }).catch(() => { store.isFetching = false; });
    }
  }, { rootMargin: CFG.nextPage });

  pageObs.observe(scrollSent);
}
