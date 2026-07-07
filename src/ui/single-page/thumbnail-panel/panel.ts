import { store } from '../../../state/store';
import { loadPlaceholderImage } from '../../../features/scroll-mode';

const ITEM_SIZE = 72;
const VISIBLE_COUNT = 15;
const BUFFER = 3;

export function createThumbnailPanel(
  onIndexChange: (index: number) => void,
  onScrollToBottom?: () => void,
  onScrollToTop?: () => void
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

  let scrollOffset = 0;
  let lastCenteredIndex = -1;
  let clickedFromPanel = false;
  const itemPool: HTMLElement[] = [];
  const activeItems = new Map<number, HTMLElement>();

  let isPanelActive = false;

  function closePanel() {
    if (!isPanelActive) return;
    isPanelActive = false;
    thumbPanel.classList.remove('active');
  }

  function openPanel() {
    if (isPanelActive) return;
    isPanelActive = true;
    thumbPanel.classList.add('active');
  }

  document.addEventListener('sp-image-loaded', (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail.index === 'number') {
      const idx = detail.index;
      if (activeItems.has(idx)) {
        renderItemContent(activeItems.get(idx)!, idx);
      }
    }
  });

  function isVertical() {
    const pos = store.settings.thumbnailPosition;
    return pos === 'left' || pos === 'right';
  }

  function getItemSize() {
    return ITEM_SIZE;
  }

  function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
  }

  function vpSize(): number {
    if (isVertical()) {
      return viewport.offsetHeight || Math.min(VISIBLE_COUNT * ITEM_SIZE, store.allImages.length * ITEM_SIZE);
    } else {
      return viewport.offsetWidth || Math.min(VISIBLE_COUNT * ITEM_SIZE, store.allImages.length * ITEM_SIZE);
    }
  }

  function maxOffset(): number {
    return Math.max(0, store.allImages.length * getItemSize() - vpSize());
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

    const vp = vpSize();
    const itemSize = getItemSize();
    
    if (isVertical()) {
      content.style.width = '100%';
      content.style.height = `${total * itemSize}px`;
    } else {
      content.style.width = `${total * itemSize}px`;
      content.style.height = '100%';
    }

    scrollOffset = clamp(scrollOffset, 0, maxOffset());

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
        el.style.transform = `translateY(${i * itemSize}px)`;
      } else {
        el.style.transform = `translateX(${i * itemSize}px)`;
      }
      renderItemContent(el, i);
    }

    if (isVertical()) {
      content.style.transform = `translateY(${-scrollOffset}px)`;
    } else {
      content.style.transform = `translateX(${-scrollOffset}px)`;
    }
    
    triggerLazyLoadForVisible();
  }

  function centerOnCurrent(): void {
    const vp = vpSize();
    const itemSize = getItemSize();
    const target = store.currentImageIndex * itemSize - vp / 2 + itemSize / 2;
    scrollOffset = clamp(target, 0, maxOffset());
  }

  function ensureVisible(): void {
    const vp = vpSize();
    const itemSize = getItemSize();
    const itemStart = store.currentImageIndex * itemSize;
    const itemEnd = itemStart + itemSize;
    if (itemStart < scrollOffset) {
      scrollOffset = itemStart;
    } else if (itemEnd > scrollOffset + vp) {
      scrollOffset = itemEnd - vp;
    }
    scrollOffset = clamp(scrollOffset, 0, maxOffset());
  }

  function update(): void {
    if (store.allImages.length === 0) return;

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
  }

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    scrollOffset = clamp(scrollOffset + e.deltaY + e.deltaX, 0, maxOffset());
    renderVisibleItems();
    if (onScrollToBottom && scrollOffset >= maxOffset() - getItemSize()) {
      onScrollToBottom();
    }
    if (onScrollToTop && scrollOffset <= getItemSize()) {
      onScrollToTop();
    }
  }, { passive: false });

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

  window.addEventListener('resize', () => {
    if (store.allImages.length > 0) {
      renderVisibleItems();
    }
  }, { passive: true });
  
  store.on('settingsChanged', () => {
    centerOnCurrent();
    renderVisibleItems();
  });

  return {
    getElement: () => thumbPanel,
    update,
    openPanel,
    closePanel,
    isActive: () => isPanelActive
  };
}
