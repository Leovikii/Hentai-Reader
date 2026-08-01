import type { GalleryItem } from '../../../core/gallery';
import type { LoadedImage } from '../../../core/image';
import { createThumbnailPlan } from '../../../services/thumbnail-service';
import type { ThumbnailPreloadPhase } from '../../controllers/thumbnail-controller';


const VISIBLE_COUNT = 15;
const BUFFER = 3;
const PRELOAD_SETTLE_MS = 300;

export interface ThumbnailPanelOptions {
  onMobileInteractionStart?: () => void;
  onMobileInteractionEnd?: () => void;
  subscribeThumbnailChange?: (listener: (index: number) => void) => () => void;
  preloadThumbnails?: (indices: readonly number[]) => void;
  cancelThumbnailPreloads?: () => void;
  finishThumbnailPreload?: (index: number, failed?: boolean) => void;
  getPreloadedAsset?: (index: number) => LoadedImage | undefined;
  getPreloadPhase?: (index: number) => ThumbnailPreloadPhase;
  getImageCount: () => number;
  getCurrentIndex: () => number;
  getImageAt: (index: number) => HTMLElement | undefined;
  getItemAt: (index: number) => GalleryItem | undefined;
  getDisplayNumber: (index: number) => number;
  getThumbnailPosition: () => 'top' | 'bottom' | 'left' | 'right';
  subscribeSettingsChanged: (listener: () => void) => () => void;
}

/** Virtualized thumbnail viewport owned by the reader shell. */
export function createThumbnailPanel(
  onIndexChange: (index: number) => void,
  onScrollToBottom: (() => void) | undefined,
  onScrollToTop: (() => void) | undefined,
  options: ThumbnailPanelOptions,
) {
  const thumbPanel = document.createElement('div');
  thumbPanel.className = 'sp-thumb-panel';

  const viewport = document.createElement('div');
  viewport.className = 'sp-thumb-viewport';

  const content = document.createElement('div');
  content.className = 'sp-thumb-content';

  const counter = document.createElement('div');
  counter.className = 'sp-thumb-counter';

  viewport.appendChild(content);
  thumbPanel.appendChild(viewport);
  thumbPanel.appendChild(counter);

  let lastCenteredIndex = -1;
  let clickedFromPanel = false;
  let lastContentSize = '';
  let lastContentVertical: boolean | null = null;
  const itemPool: HTMLElement[] = [];
  const activeItems = new Map<number, HTMLElement>();
  let hideTimeout: ReturnType<typeof setTimeout>;
  let isPanelActive = false;
  let preloadTimer: ReturnType<typeof setTimeout> | null = null;
  let userScrollArmed = false;

  function openPanel(keepOpen = false): void {
    if (options.getImageCount() === 0) return;
    clearTimeout(hideTimeout);
    isPanelActive = true;
    thumbPanel.classList.add('active');
    
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    
    if (keepOpen) {
      if (isTouchDevice) {
        options.onMobileInteractionStart?.();
      }
    } else {
      if (isTouchDevice) {
        options.onMobileInteractionEnd?.();
      } else {
        hideTimeout = setTimeout(() => {
          closePanel();
        }, 2000);
      }
    }
  }

  function clearThumbnailPreloadTimer(): void {
    if (preloadTimer) {
      clearTimeout(preloadTimer);
      preloadTimer = null;
    }
  }

  function cancelThumbnailPreloadWork(): void {
    clearThumbnailPreloadTimer();
    options.cancelThumbnailPreloads?.();
  }

  function closePanel(): void {
    isPanelActive = false;
    userScrollArmed = false;
    thumbPanel.classList.remove('active');
    clearThumbnailPreloadTimer();
  }

  // Mouse interaction (ignore touch-simulated mouse events)
  thumbPanel.addEventListener('pointerenter', (e: PointerEvent) => {
    if (e.pointerType === 'mouse') openPanel(true);
  });
  thumbPanel.addEventListener('pointerleave', (e: PointerEvent) => {
    if (e.pointerType === 'mouse') openPanel(false);
  });
  thumbPanel.addEventListener('pointermove', (e: PointerEvent) => {
    if (e.pointerType === 'mouse') openPanel(true);
  });

  options.subscribeThumbnailChange?.(idx => {
    if (activeItems.has(idx)) {
      renderItemContent(activeItems.get(idx)!, idx);
    }
  });

  function isVertical() {
    const pos = options.getThumbnailPosition();
    return pos === 'left' || pos === 'right';
  }

  function getItemSize() {
    return document.documentElement.classList.contains('hr-mobile') ? 96 : 80;
  }



  function vpSize(): number {
    if (isVertical()) {
      return viewport.offsetHeight || Math.min(VISIBLE_COUNT * getItemSize(), options.getImageCount() * getItemSize());
    } else {
      return viewport.offsetWidth || Math.min(VISIBLE_COUNT * getItemSize(), options.getImageCount() * getItemSize());
    }
  }

  function maxOffset(): number {
    return Math.max(0, options.getImageCount() * getItemSize() - vpSize());
  }

  function acquireItem(): HTMLElement {
    return itemPool.pop() || (() => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'sp-thumb-item';
      return el;
    })();
  }

  function releaseItem(el: HTMLElement): void {
    el.remove();
    itemPool.push(el);
  }

  // Cache downscaled thumbnails keyed by source URL. Pooled items get recycled
  // across indices, so without this every recycle re-runs drawImage scaling a
  // full-res (2000px+) source down to 300px on the main thread. Caching the
  // small canvas turns recycle into a cheap 300->300 blit. LRU-capped to bound
  // memory (each entry ~0.5MB, so 60 ~= 30MB worst case).
  const THUMB_CACHE_MAX = 60;
  const thumbCache = new Map<string, HTMLCanvasElement>();

  function getCachedThumb(src: string): HTMLCanvasElement | undefined {
    const c = thumbCache.get(src);
    if (c) { thumbCache.delete(src); thumbCache.set(src, c); } // LRU touch
    return c;
  }

  function putCachedThumb(src: string, canvas: HTMLCanvasElement): void {
    thumbCache.set(src, canvas);
    if (thumbCache.size > THUMB_CACHE_MAX) {
      const oldest = thumbCache.keys().next().value;
      if (oldest !== undefined) thumbCache.delete(oldest);
    }
  }

  function makeThumbCanvas(source: CanvasImageSource, natW: number, natH: number,
                           crop?: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
    let w = crop ? crop.w : natW;
    let h = crop ? crop.h : natH;
    if (w > 300) { h = (h * 300) / w; w = 300; }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) {
      if (crop) {
        // Sprite sheet: draw only this cell's crop box, scaled to the canvas.
        ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
      } else {
        ctx.drawImage(source, 0, 0, w, h);
      }
    }
    return c;
  }

  function blitToCanvas(dest: HTMLCanvasElement, cache: HTMLCanvasElement): void {
    dest.width = cache.width;
    dest.height = cache.height;
    const ctx = dest.getContext('2d');
    if (ctx) ctx.drawImage(cache, 0, 0);
  }

  function renderItemContent(el: HTMLElement, index: number): void {
    el.dataset.index = String(index);
    el.classList.toggle('sp-thumb-active', index === options.getCurrentIndex());
    el.setAttribute('aria-label', `Page ${options.getDisplayNumber(index)}`);
    if (index === options.getCurrentIndex()) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');

    const img = options.getImageAt(index);
    const item = options.getItemAt(index);
    const isLoadedImg = img && img.tagName === 'IMG' && (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0;
    const preloadedAsset = options.getPreloadedAsset?.(index);
    const loadedSource = preloadedAsset?.src || (isLoadedImg
      ? (img as HTMLImageElement).dataset.realSrc || (img as HTMLImageElement).src
      : undefined);
    const plan = item ? createThumbnailPlan(item, loadedSource) : { requestFullImage: false };
    const thumbSrc = plan.src || '';
    const isDerived = item?.preview.kind === 'none' || item?.preview.kind === 'derived';

    // Sprite-sheet crop (E-Hentai "Normal" thumbnails): one shared image holds a
    // row of cells. Only crop the still-placeholder case — a loaded full image is
    // its own picture, not a sprite. Cache key includes the crop so cells sharing
    // one sprite URL don't collide on the same cached canvas.
    const crop = plan.crop ? {
      x: plan.crop.x,
      y: plan.crop.y,
      w: plan.crop.width,
      h: plan.crop.height,
    } : undefined;
    const cacheKey = isDerived && item
      ? `derived:${item.key}`
      : crop
        ? `${thumbSrc}#${crop.x},${crop.y},${crop.w},${crop.h}`
        : thumbSrc;
    const cached = cacheKey ? getCachedThumb(cacheKey) : undefined;

    if (cached || thumbSrc) {
      let thumbCanvas = el.querySelector('canvas.sp-thumb-img') as HTMLCanvasElement | null;
      if (!thumbCanvas) {
        el.innerHTML = '';
        thumbCanvas = document.createElement('canvas');
        thumbCanvas.className = 'sp-thumb-img';
        el.appendChild(thumbCanvas);
        const label = document.createElement('span');
        label.className = 'sp-thumb-label';
        el.appendChild(label);
      }
      if (thumbCanvas.dataset.src !== cacheKey) {
        thumbCanvas.dataset.src = cacheKey;

        if (cached) {
          blitToCanvas(thumbCanvas, cached);
          if (isDerived && preloadedAsset) options.finishThumbnailPreload?.(index);
        } else if (isDerived && isLoadedImg && loadedSource === thumbSrc) {
          const c = makeThumbCanvas(img as HTMLImageElement, (img as HTMLImageElement).naturalWidth, (img as HTMLImageElement).naturalHeight);
          putCachedThumb(cacheKey, c);
          blitToCanvas(thumbCanvas, c);
          if (preloadedAsset) options.finishThumbnailPreload?.(index);
        } else {
          const tempImg = new Image();
          tempImg.decoding = 'async';
          tempImg.onload = () => {
            // Cache regardless, but only paint if this slot still wants this src.
            const c = makeThumbCanvas(tempImg, tempImg.naturalWidth, tempImg.naturalHeight, crop);
            putCachedThumb(cacheKey, c);
            if (thumbCanvas!.dataset.src === cacheKey) {
              blitToCanvas(thumbCanvas!, c);
            }
            if (isDerived) options.finishThumbnailPreload?.(index);
          };
          tempImg.onerror = () => {
            if (isDerived) options.finishThumbnailPreload?.(index, true);
          };
          tempImg.src = thumbSrc;
        }
      }
      const label = el.querySelector('.sp-thumb-label') as HTMLElement;
      if (label) label.textContent = String(options.getDisplayNumber(index));
    } else {
      let ph = el.querySelector('.sp-thumb-ph') as HTMLElement | null;
      if (!ph) {
        el.innerHTML = '';
        ph = document.createElement('div');
        ph.className = 'sp-thumb-ph';
        el.appendChild(ph);
      }
      const phase = options.getPreloadPhase?.(index) ?? 'idle';
      ph.classList.toggle('loading', phase === 'loading');
      ph.classList.toggle('error', phase === 'error');
      ph.textContent = phase === 'error'
        ? `${options.getDisplayNumber(index)} !`
        : String(options.getDisplayNumber(index));
    }
  }

  function getScrollOffset(): number {
    return isVertical() ? viewport.scrollTop : viewport.scrollLeft;
  }

  function visiblePreloadIndices(): number[] {
    const total = options.getImageCount();
    const itemSize = getItemSize();
    const offset = getScrollOffset();
    const viewportSize = vpSize();
    const first = Math.max(0, Math.floor(offset / itemSize));
    const last = Math.min(total - 1, Math.ceil((offset + viewportSize) / itemSize) - 1);
    const center = offset + viewportSize / 2;
    const indices: number[] = [];

    for (let index = first; index <= last; index++) {
      const item = options.getItemAt(index);
      if (!item || (item.preview.kind !== 'none' && item.preview.kind !== 'derived')) continue;
      if (getCachedThumb(`derived:${item.key}`)) continue;

      const element = options.getImageAt(index) as HTMLImageElement | undefined;
      if (element?.tagName === 'IMG' && element.complete && element.naturalWidth > 0) continue;
      indices.push(index);
    }

    return indices.sort((a, b) => {
      const distanceA = Math.abs((a + 0.5) * itemSize - center);
      const distanceB = Math.abs((b + 0.5) * itemSize - center);
      return distanceA - distanceB || a - b;
    });
  }

  function scheduleThumbnailPreload(): void {
    cancelThumbnailPreloadWork();
    preloadTimer = setTimeout(() => {
      preloadTimer = null;
      userScrollArmed = false;
      if (!isPanelActive) return;
      options.preloadThumbnails?.(visiblePreloadIndices());
    }, PRELOAD_SETTLE_MS);
  }

  let isProgrammaticScroll = false;
  let programmaticScrollTimer: ReturnType<typeof setTimeout>;

  function setScrollOffset(val: number): void {
    const current = getScrollOffset();
    if (Math.abs(current - val) < 1) return;
    
    isProgrammaticScroll = true;
    if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer);
    programmaticScrollTimer = setTimeout(() => { isProgrammaticScroll = false; }, 50);

    if (isVertical()) {
      viewport.scrollTop = val;
    } else {
      viewport.scrollLeft = val;
    }
  }

  function renderVisibleItems(): void {
    const total = options.getImageCount();
    if (total === 0) return;

    const vp = vpSize();
    const itemSize = getItemSize();

    // Only touch content size when it actually changes; rewriting it on every
    // scroll event invalidates layout needlessly while scrubbing.
    const wantSize = `${total * itemSize + 16}px`;
    const vertical = isVertical();
    if (lastContentSize !== wantSize || lastContentVertical !== vertical) {
      if (vertical) {
        content.style.width = '100%';
        content.style.height = wantSize;
      } else {
        content.style.width = wantSize;
        content.style.height = '100%';
      }
      lastContentSize = wantSize;
      lastContentVertical = vertical;
    }

    const scrollOffset = getScrollOffset();
    const startIdx = Math.max(0, Math.floor(scrollOffset / itemSize) - BUFFER);
    const endIdx = Math.min(total - 1, Math.ceil((scrollOffset + vp) / itemSize) + BUFFER);

    for (const [idx, el] of activeItems) {
      if (idx < startIdx || idx > endIdx) {
        releaseItem(el);
        activeItems.delete(idx);
      }
    }

    for (let i = startIdx; i <= endIdx; i++) {
      let el = activeItems.get(i);
      if (!el) {
        el = acquireItem();
        activeItems.set(i, el);
        content.appendChild(el);
      }
      if (isVertical()) {
        el.style.transform = `translateY(${i * itemSize + 8}px)`;
      } else {
        el.style.transform = `translateX(${i * itemSize + 8}px)`;
      }
      renderItemContent(el, i);
    }
  }

  function centerOnCurrent(): void {
    const vp = vpSize();
    const itemSize = getItemSize();
    const target = options.getCurrentIndex() * itemSize - vp / 2 + itemSize / 2;
    setScrollOffset(target);
  }

  function ensureVisible(): void {
    const vp = vpSize();
    const itemSize = getItemSize();
    const itemStart = options.getCurrentIndex() * itemSize;
    const itemEnd = itemStart + itemSize;
    const currentScroll = getScrollOffset();
    if (itemStart < currentScroll) {
      setScrollOffset(itemStart);
    } else if (itemEnd > currentScroll + vp) {
      setScrollOffset(itemEnd - vp);
    }
  }

  function update(): void {
    const total = options.getImageCount();
    if (total === 0) return;

    const currentIndex = options.getCurrentIndex();
    if (currentIndex !== lastCenteredIndex) {
      userScrollArmed = false;
      cancelThumbnailPreloadWork();
      if (clickedFromPanel) {
        ensureVisible();
        clickedFromPanel = false;
      } else {
        centerOnCurrent();
      }
      lastCenteredIndex = currentIndex;
    }
    renderVisibleItems();

    const displayLabel = `${options.getDisplayNumber(currentIndex)} / ${options.getDisplayNumber(total - 1)}`;
    counter.textContent = displayLabel;
  }

  let lastScrollPos = 0;
  let scrollRafPending = false;
  viewport.addEventListener('scroll', () => {
    if (scrollRafPending) return;
    scrollRafPending = true;
    requestAnimationFrame(() => {
      scrollRafPending = false;
      renderVisibleItems();

      if (isProgrammaticScroll) {
        isProgrammaticScroll = false;
        if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer);
        lastScrollPos = getScrollOffset();
        return;
      }

      if (!userScrollArmed) return;

      scheduleThumbnailPreload();

      const currentScroll = getScrollOffset();
      const isScrollingUp = currentScroll < lastScrollPos;
      const isScrollingDown = currentScroll > lastScrollPos;

      if (onScrollToTop && currentScroll <= 5 && isScrollingUp) {
        onScrollToTop();
      } else if (onScrollToBottom && currentScroll >= maxOffset() - 5 && isScrollingDown) {
        onScrollToBottom();
      }

      lastScrollPos = currentScroll;

      openPanel(true);
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => openPanel(false), 500);
    });
  }, { passive: true });

  thumbPanel.addEventListener('wheel', (e) => {
    e.stopPropagation(); // Stop PhotoSwipe from changing slides
  }, { passive: true });

  viewport.addEventListener('wheel', (e) => {
    userScrollArmed = true;
    // Check if primarily vertical wheel
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      const prevScroll = getScrollOffset();
      
      // If horizontal panel, we map vertical wheel to horizontal scroll manually
      if (!isVertical()) {
        e.preventDefault();
        viewport.scrollBy({ left: e.deltaY, behavior: 'auto' });
      }
      
      // Edge loading detection for both vertical and horizontal panels
      const mOffset = maxOffset();
      if (prevScroll <= 0 && e.deltaY < 0 && onScrollToTop) {
        onScrollToTop();
      } else if (prevScroll >= mOffset - 1 && e.deltaY > 0 && onScrollToBottom) {
        onScrollToBottom();
      }
    }
  }, { passive: false });

  // Polyfill drag-to-scroll for desktop mouse with inertia
  let isDragging = false;
  let hasDragged = false;
  let startX = 0;
  let startY = 0;
  let startScroll = 0;
  
  let lastTime = 0;
  let lastClientX = 0;
  let lastClientY = 0;
  let velocityX = 0;
  let velocityY = 0;
  let inertiaRaf = 0;
  let dragPointerId: number | null = null;

  viewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    cancelAnimationFrame(inertiaRaf);
    isDragging = true;
    dragPointerId = e.pointerId;
    hasDragged = false;
    startX = e.clientX;
    startY = e.clientY;
    startScroll = isVertical() ? viewport.scrollTop : viewport.scrollLeft;
    
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    lastTime = performance.now();
    velocityX = 0;
    velocityY = 0;
    
    viewport.style.cursor = 'grabbing';
  });

  window.addEventListener('pointermove', (e) => {
    if (!isDragging || e.pointerId !== dragPointerId) return;
    if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) {
      hasDragged = true;
      userScrollArmed = true;
    }
    e.preventDefault();
    
    const now = performance.now();
    const dt = now - lastTime;
    if (dt > 5) {
      const dx = e.clientX - lastClientX;
      const dy = e.clientY - lastClientY;
      velocityX = 0.6 * velocityX + 0.4 * (-dx / dt);
      velocityY = 0.6 * velocityY + 0.4 * (-dy / dt);
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      lastTime = now;
    }
    
    const mOffset = maxOffset();
    
    if (isVertical()) {
      const newScroll = startScroll - (e.clientY - startY);
      viewport.scrollTop = newScroll;
      
      if (startScroll <= 0 && newScroll < -30 && onScrollToTop) {
        onScrollToTop();
        startScroll = 0;
        startY = e.clientY;
      } else if (startScroll >= mOffset - 1 && newScroll > mOffset + 30 && onScrollToBottom) {
        onScrollToBottom();
        startScroll = mOffset;
        startY = e.clientY;
      }
    } else {
      const newScroll = startScroll - (e.clientX - startX);
      viewport.scrollLeft = newScroll;

      if (startScroll <= 0 && newScroll < -30 && onScrollToTop) {
        onScrollToTop();
        startScroll = 0;
        startX = e.clientX;
      } else if (startScroll >= mOffset - 1 && newScroll > mOffset + 30 && onScrollToBottom) {
        onScrollToBottom();
        startScroll = mOffset;
        startX = e.clientX;
      }
    }
  });

  function endMouseDrag(withInertia: boolean): void {
    if (!isDragging) return;
    isDragging = false;
    dragPointerId = null;
    viewport.style.cursor = '';

    if (!withInertia) {
      velocityX = 0;
      velocityY = 0;
      return;
    }

    const timeSinceLastMove = performance.now() - lastTime;
    if (timeSinceLastMove > 50) {
       velocityX = 0;
       velocityY = 0;
    }
    
    let virtualScroll = isVertical() ? viewport.scrollTop : viewport.scrollLeft;
    
    const startInertia = () => {
      const v = isVertical() ? velocityY : velocityX;
      if (Math.abs(v) < 0.05) return;
      
      const mOffset = maxOffset();
      virtualScroll += v * 16;
      
      if (isVertical()) {
        viewport.scrollTop = virtualScroll;
        if (virtualScroll < -30 && onScrollToTop) {
           onScrollToTop();
           return;
        }
        if (virtualScroll > mOffset + 30 && onScrollToBottom) {
           onScrollToBottom();
           return;
        }
        velocityY *= 0.95; 
        if (virtualScroll < 0 || virtualScroll > mOffset) velocityY *= 0.8;
      } else {
        viewport.scrollLeft = virtualScroll;
        if (virtualScroll < -30 && onScrollToTop) {
           onScrollToTop();
           return;
        }
        if (virtualScroll > mOffset + 30 && onScrollToBottom) {
           onScrollToBottom();
           return;
        }
        velocityX *= 0.95;
        if (virtualScroll < 0 || virtualScroll > mOffset) velocityX *= 0.8;
      }

      inertiaRaf = requestAnimationFrame(startInertia);
    };
    
    inertiaRaf = requestAnimationFrame(startInertia);
  }

  window.addEventListener('pointerup', (e) => {
    if (e.pointerId === dragPointerId) endMouseDrag(true);
  });

  window.addEventListener('pointercancel', (e) => {
    if (e.pointerId === dragPointerId) endMouseDrag(false);
  });

  // Polyfill edge-pull loading for mobile touch
  // Since native scroll doesn't fire events when trying to scroll past the boundaries on some mobile browsers
  let touchStartX = 0;
  let touchStartY = 0;

  viewport.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    userScrollArmed = true;
    const currentScroll = getScrollOffset();
    const mOffset = maxOffset();
    
    if (isVertical()) {
      const dy = e.touches[0].clientY - touchStartY;
      if (currentScroll <= 0 && dy > 40 && onScrollToTop) {
        onScrollToTop();
        touchStartY = e.touches[0].clientY; // Reset to avoid rapid fire
      } else if (currentScroll >= mOffset - 1 && dy < -40 && onScrollToBottom) {
        onScrollToBottom();
        touchStartY = e.touches[0].clientY;
      }
    } else {
      const dx = e.touches[0].clientX - touchStartX;
      if (currentScroll <= 0 && dx > 40 && onScrollToTop) {
        onScrollToTop();
        touchStartX = e.touches[0].clientX;
      } else if (currentScroll >= mOffset - 1 && dx < -40 && onScrollToBottom) {
        onScrollToBottom();
        touchStartX = e.touches[0].clientX;
      }
    }
  }, { passive: true });

  content.addEventListener('click', (e) => {
    if (hasDragged) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const item = (e.target as HTMLElement).closest('.sp-thumb-item') as HTMLElement | null;
    if (item?.dataset.index) {
      const index = parseInt(item.dataset.index);
      if (!isNaN(index) && index >= 0 && index < options.getImageCount()) {
        clickedFromPanel = true;
        onIndexChange(index);
      }
    }
  });

  window.addEventListener('resize', () => {
    userScrollArmed = false;
    cancelThumbnailPreloadWork();
    if (options.getImageCount() > 0) {
      renderVisibleItems();
    }
  }, { passive: true });
  
  options.subscribeSettingsChanged(() => {
    userScrollArmed = false;
    cancelThumbnailPreloadWork();
    centerOnCurrent();
    renderVisibleItems();
  });

  return {
    getElement: () => thumbPanel,
    update,
    openPanel,
    closePanel,
    isActive: () => isPanelActive,
    resetCentering: () => { lastCenteredIndex = -1; }
  };
}
