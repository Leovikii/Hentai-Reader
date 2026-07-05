import { store } from '../../state/store';
import { loadPlaceholderImage } from '../../features/scroll-mode';

export interface SidebarHandle {
  update: () => void;
  getElements: () => HTMLElement[];
  wakeUpProgressBar: () => void;
}

const ITEM_HEIGHT = 80;
const VISIBLE_COUNT = 12;
const BUFFER = 3;

export function createSidebar(
  onIndexChange: (index: number) => void,
  onScrollToBottom?: () => void,
  onScrollToTop?: () => void,
): SidebarHandle {
  // --- PROGRESS BAR SECTION ---
  const progressTrack = document.createElement('div');
  progressTrack.className = 'sp-sidebar-track';

  const progressThumb = document.createElement('div');
  progressThumb.className = 'sp-sidebar-thumb';

  const progressLabel = document.createElement('div');
  progressLabel.className = 'sp-sidebar-label';

  progressTrack.appendChild(progressThumb);
  progressTrack.appendChild(progressLabel);

  // --- THUMBNAIL SECTION ---
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

  // --- STATE ---
  let scrollOffset = 0;
  let lastCenteredIndex = -1;
  let clickedFromPanel = false;
  const itemPool: HTMLElement[] = [];
  const activeItems = new Map<number, HTMLElement>();
  let cachedTrackHeight = 0;

  // --- MOUSE & SCROLL TRACKING ---
  let progressWakeTimer: ReturnType<typeof setTimeout> | null = null;
  let isPanelActive = false;

  function wakeUpProgressBar() {
    if (isPanelActive) return;
    progressTrack.classList.add('active');
    if (progressWakeTimer) clearTimeout(progressWakeTimer);
    progressWakeTimer = setTimeout(() => {
      progressTrack.classList.remove('active');
    }, 1500);
  }

  function closePanel() {
    if (!isPanelActive) return;
    isPanelActive = false;
    thumbPanel.classList.remove('active');
  }

  function openPanel() {
    if (isPanelActive) return;
    isPanelActive = true;
    thumbPanel.classList.add('active');
    progressTrack.classList.remove('active');
    if (progressWakeTimer) clearTimeout(progressWakeTimer);
  }

  document.addEventListener('mousemove', (e) => {
    if (!document.querySelector('.single-page-overlay.active')) return;
    if (isDragging) return;

    // Failsafe: if mouse moves completely out of the viewport (top, bottom, left)
    if (e.clientX < 0 || e.clientY < 0 || e.clientY >= window.innerHeight - 1) {
      closePanel();
      return;
    }

    const dx = window.innerWidth - e.clientX;
    
    if (dx <= 140) {
      openPanel();
    } else {
      closePanel();
    }
  });

  // e.relatedTarget is null when the mouse leaves the browser window entirely
  document.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) closePanel();
  });

  document.documentElement.addEventListener('mouseleave', closePanel);

  function refreshTrackHeight(): void {
    cachedTrackHeight = progressTrack.offsetHeight;
  }
  window.addEventListener('resize', refreshTrackHeight, { passive: true });

  document.addEventListener('sp-image-loaded', (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail.index === 'number') {
      const idx = detail.index;
      if (activeItems.has(idx)) {
        renderItemContent(activeItems.get(idx)!, idx);
      }
    }
  });

  // --- THUMBNAIL LOGIC ---
  function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
  }

  function vpHeight(): number {
    // Return the actual pixel height rendered by CSS flexbox, 
    // or fallback to a calculated height if not yet attached to DOM
    return viewport.offsetHeight || Math.min(VISIBLE_COUNT * ITEM_HEIGHT, store.allImages.length * ITEM_HEIGHT);
  }

  function maxOffset(): number {
    return Math.max(0, store.allImages.length * ITEM_HEIGHT - vpHeight());
  }

  function acquireItem(): HTMLElement {
    return itemPool.pop() || (() => {
      const el = document.createElement('div');
      el.className = 'sp-thumb-item';
      return el;
    })();
  }

  function releaseItem(el: HTMLElement): void {
    el.remove();
    itemPool.push(el);
  }

  function renderItemContent(el: HTMLElement, index: number): void {
    el.dataset.index = String(index);
    el.classList.toggle('sp-thumb-active', index === store.currentImageIndex);

    const img = store.allImages[index];
    let thumbSrc = '';
    const isLoadedImg = img && img.tagName === 'IMG' && (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0;

    if (isLoadedImg) {
      thumbSrc = (img as HTMLImageElement).dataset.realSrc || (img as HTMLImageElement).src;
    } else if (img && (img as HTMLImageElement).src) {
      thumbSrc = (img as HTMLImageElement).dataset.thumbSrc || (img as HTMLImageElement).dataset.realSrc || (img as HTMLImageElement).src;
    } else if (img && (img as HTMLElement).dataset.thumb) {
      thumbSrc = (img as HTMLElement).dataset.thumb!;
    }

    if (thumbSrc) {
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
      if (thumbCanvas.dataset.src !== thumbSrc) {
        thumbCanvas.dataset.src = thumbSrc;
        
        const MAX_W = 300;
        if (isLoadedImg) {
          let w = (img as HTMLImageElement).naturalWidth;
          let h = (img as HTMLImageElement).naturalHeight;
          if (w > MAX_W) {
            h = (h * MAX_W) / w;
            w = MAX_W;
          }
          thumbCanvas!.width = w;
          thumbCanvas!.height = h;
          const ctx = thumbCanvas!.getContext('2d');
          if (ctx) ctx.drawImage(img as HTMLImageElement, 0, 0, w, h);
        } else {
          const tempImg = new Image();
          tempImg.onload = () => {
            if (thumbCanvas!.dataset.src === thumbSrc) {
              let w = tempImg.naturalWidth;
              let h = tempImg.naturalHeight;
              if (w > MAX_W) {
                h = (h * MAX_W) / w;
                w = MAX_W;
              }
              thumbCanvas!.width = w;
              thumbCanvas!.height = h;
              const ctx = thumbCanvas!.getContext('2d');
              if (ctx) {
                ctx.drawImage(tempImg, 0, 0, w, h);
              }
            }
          };
          tempImg.src = thumbSrc;
        }
      }
      const label = el.querySelector('.sp-thumb-label') as HTMLElement;
      if (label) label.textContent = String(store.imageOffset + index + 1);
    } else {
      let ph = el.querySelector('.sp-thumb-ph') as HTMLElement | null;
      if (!ph) {
        el.innerHTML = '';
        ph = document.createElement('div');
        ph.className = 'sp-thumb-ph';
        el.appendChild(ph);
      }
      ph.textContent = String(store.imageOffset + index + 1);
    }
  }

  let lazyLoadTimer: ReturnType<typeof setTimeout> | null = null;
  function triggerLazyLoadForVisible() {
    if (lazyLoadTimer) clearTimeout(lazyLoadTimer);
    lazyLoadTimer = setTimeout(() => {
      for (const [idx] of activeItems) {
        const img = store.allImages[idx];
        if (img && img.classList.contains('r-ph')) {
          loadPlaceholderImage(img as HTMLElement);
        }
      }
    }, 200);
  }

  function renderVisibleItems(): void {
    const total = store.allImages.length;
    if (total === 0) return;

    const vp = vpHeight();
    content.style.height = `${total * ITEM_HEIGHT}px`;

    scrollOffset = clamp(scrollOffset, 0, maxOffset());

    const startIdx = Math.max(0, Math.floor(scrollOffset / ITEM_HEIGHT) - BUFFER);
    const endIdx = Math.min(total - 1, Math.ceil((scrollOffset + vp) / ITEM_HEIGHT) + BUFFER);

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
      el.style.transform = `translateY(${i * ITEM_HEIGHT}px)`;
      renderItemContent(el, i);
    }

    content.style.transform = `translateY(${-scrollOffset}px)`;
    
    triggerLazyLoadForVisible();
  }

  function centerOnCurrent(): void {
    const vp = vpHeight();
    const target = store.currentImageIndex * ITEM_HEIGHT - vp / 2 + ITEM_HEIGHT / 2;
    scrollOffset = clamp(target, 0, maxOffset());
  }

  function ensureVisible(): void {
    const vp = vpHeight();
    const itemTop = store.currentImageIndex * ITEM_HEIGHT;
    const itemBottom = itemTop + ITEM_HEIGHT;
    if (itemTop < scrollOffset) {
      scrollOffset = itemTop;
    } else if (itemBottom > scrollOffset + vp) {
      scrollOffset = itemBottom - vp;
    }
    scrollOffset = clamp(scrollOffset, 0, maxOffset());
  }

  function update(): void {
    if (store.allImages.length === 0) return;

    // Thumbnail updates
    if (store.currentImageIndex !== lastCenteredIndex) {
      if (clickedFromPanel) {
        ensureVisible();
        clickedFromPanel = false;
      } else {
        centerOnCurrent();
      }
      lastCenteredIndex = store.currentImageIndex;
    }
    renderVisibleItems();
    
    const displayLabel = `${store.imageOffset + store.currentImageIndex + 1} / ${store.imageOffset + store.allImages.length}`;
    counter.textContent = displayLabel;

    // Progress bar updates
    if (!cachedTrackHeight) refreshTrackHeight();
    const trackHeight = cachedTrackHeight;
    let thumbHeight: number;

    if (store.allImages.length <= 10) {
      thumbHeight = 60;
    } else if (store.allImages.length <= 50) {
      thumbHeight = Math.max(60, trackHeight * (10 / store.allImages.length));
    } else {
      thumbHeight = Math.max(60, trackHeight * (5 / store.allImages.length));
    }

    const scrollProgress = store.currentImageIndex / Math.max(1, store.allImages.length - 1);
    const maxThumbTop = trackHeight - thumbHeight;
    const thumbTop = scrollProgress * maxThumbTop;

    progressThumb.style.height = `${thumbHeight}px`;
    progressThumb.style.top = `${thumbTop}px`;
    progressLabel.textContent = displayLabel;
  }

  // Wheel event for thumbnails
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    scrollOffset = clamp(scrollOffset + e.deltaY, 0, maxOffset());
    renderVisibleItems();
    if (onScrollToBottom && scrollOffset >= maxOffset() - ITEM_HEIGHT) {
      onScrollToBottom();
    }
    if (onScrollToTop && scrollOffset <= ITEM_HEIGHT) {
      onScrollToTop();
    }
  }, { passive: false });

  // Click on thumbnail item
  content.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.sp-thumb-item') as HTMLElement | null;
    if (item?.dataset.index) {
      const index = parseInt(item.dataset.index);
      if (!isNaN(index) && index >= 0 && index < store.allImages.length) {
        clickedFromPanel = true;
        onIndexChange(index);
      }
    }
  });

  // --- SCROLLBAR EVENTS ---
  // Click track to seek
  progressTrack.onclick = (e) => {
    if (e.target === progressThumb) return;
    const rect = progressTrack.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const scrollProgress = Math.min(1, Math.max(0, clickY / rect.height));
    const targetIndex = Math.round(scrollProgress * (store.allImages.length - 1));
    if (targetIndex >= 0 && targetIndex < store.allImages.length) {
      onIndexChange(targetIndex);
    }
  };

  let isDragging = false;
  let dragStartY = 0;
  let thumbStartTop = 0;

  progressThumb.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    dragStartY = e.clientY;
    thumbStartTop = progressThumb.offsetTop;
    document.body.style.userSelect = 'none';
  };

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaY = e.clientY - dragStartY;
    const newTop = thumbStartTop + deltaY;
    const trackHeight = cachedTrackHeight;
    const thumbHeight = progressThumb.offsetHeight;
    const maxTop = trackHeight - thumbHeight;
    const clampedTop = Math.max(0, Math.min(maxTop, newTop));
    const scrollProgress = maxTop > 0 ? clampedTop / maxTop : 0;
    const targetIndex = Math.round(scrollProgress * (store.allImages.length - 1));
    if (targetIndex >= 0 && targetIndex < store.allImages.length && targetIndex !== store.currentImageIndex) {
      onIndexChange(targetIndex);
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.userSelect = '';
      wakeUpProgressBar();
    }
  });

  progressThumb.onclick = (e) => e.stopPropagation();

  return { update, getElements: () => [progressTrack, thumbPanel], wakeUpProgressBar };
}
