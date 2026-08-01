import PhotoSwipe from 'photoswipe';
import type { ReaderDriver, ReaderDriverOptions, ScreenPoint } from '../contracts';

export type { ScreenPoint } from '../contracts';

export class PhotoSwipeDriver implements ReaderDriver {
  private readonly instance: PhotoSwipe;

  constructor(options: ReaderDriverOptions) {
    this.instance = new PhotoSwipe({
      index: options.startIndex,
      counter: false,
      bgOpacity: 1,
      spacing: 0.1,
      loop: false,
      wheelToZoom: false,
      preload: [1, 1],
      closeOnVerticalDrag: true,
      arrowPrev: false,
      arrowNext: false,
      doubleTapAction: false,
      initialZoomLevel: (zoomLevelObject: any) => {
        if (!zoomLevelObject.panAreaSize || !zoomLevelObject.elementSize) return zoomLevelObject.fit;
        const hRatio = zoomLevelObject.panAreaSize.x / zoomLevelObject.elementSize.x;
        const vRatio = zoomLevelObject.panAreaSize.y / zoomLevelObject.elementSize.y;
        return hRatio < vRatio ? hRatio : vRatio;
      },
      secondaryZoomLevel: (zoomLevelObject: any) => {
        if (!zoomLevelObject.panAreaSize || !zoomLevelObject.elementSize) return zoomLevelObject.fit * 1.5;
        const hRatio = zoomLevelObject.panAreaSize.x / zoomLevelObject.elementSize.x;
        return hRatio * 1.5;
      },
      maxZoomLevel: (zoomLevelObject: any) => {
        if (!zoomLevelObject.panAreaSize || !zoomLevelObject.elementSize) return 4;
        const hRatio = zoomLevelObject.panAreaSize.x / zoomLevelObject.elementSize.x;
        return Math.max(hRatio * 3, 4);
      },
      bgClickAction: (point: any) => options.onBackgroundClick(point),
      imageClickAction: (point: any) => options.onImageClick(point),
      tapAction: (point: any) => options.onTap(point),
    });

    // Reader spreads remain opaque to PhotoSwipe outside this driver. Convert
    // the Reader-owned description into HTML content only at the integration
    // boundary, so two independently cached images share one zoom wrapper.
    this.instance.addFilter('itemData', (itemData: any) => {
      if (!Array.isArray(itemData.hrSpread)) return itemData;
      const escape = (value: string) => value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const images = itemData.hrSpread.map((page: any) => page.src
        ? `<img class="hr-reader-spread__page" data-logical-index="${Number(page.index)}" src="${escape(page.src)}" alt="${escape(page.alt || '')}" decoding="async" fetchpriority="high">`
        : `<span class="hr-reader-spread__page hr-reader-spread__page--pending" data-logical-index="${Number(page.index)}" aria-hidden="true"></span>`
      ).join('');
      return {
        ...itemData,
        type: 'html',
        html: `<div class="hr-reader-spread" data-reader-spread>${images}</div>`,
      };
    });
    this.instance.addFilter('isContentZoomable', (zoomable: boolean, content: any) => (
      Array.isArray(content?.data?.hrSpread) ? true : zoomable
    ));
  }

  get currentIndex(): number {
    return this.instance.currIndex;
  }

  on(event: string, listener: (event: any) => void): void {
    this.instance.on(event as any, listener as any);
  }

  init(): void {
    this.instance.init();
    this.instance.element?.setAttribute('aria-label', 'Image reader');
  }
  destroy(): void { this.instance.destroy(); }
  next(): void { this.instance.next(); }
  prev(): void { this.instance.prev(); }
  goTo(index: number): void { this.instance.goTo(index); }
  refreshSlide(index: number): void {
    const instance = this.instance as any;
    const slide = instance.mainScroll?.itemHolders
      ?.map((holder: any) => holder.slide)
      .find((candidate: any) => candidate?.index === index);
    if (slide && this.patchSpreadSlide(slide, instance.getItemData(index))) return;

    // An off-screen cached item must not retain stale presentation data. The
    // public refresh path also rebuilds a visible non-spread fallback safely.
    this.instance.refreshSlideContent(index);
  }

  syncLayout(index: number): void {
    const instance = this.instance as any;
    instance.animations?.stopAll?.();
    instance.mainScroll?.stop?.();

    // PhotoSwipe's goTo is synchronous when no animation flag is supplied.
    // Run it after the Reader has published the new numItems/itemData mapping,
    // then reconcile all three holders against their new expected indices.
    this.instance.goTo(index);
    const itemCount = this.instance.getNumItems();
    const holders: any[] = instance.mainScroll?.itemHolders ?? [];
    for (let holderIndex = 0; holderIndex < holders.length; holderIndex++) {
      const holder = holders[holderIndex];
      const expectedIndex = this.instance.currIndex - 1 + holderIndex;
      if (expectedIndex < 0 || expectedIndex >= itemCount) {
        if (holder.slide) instance.setContent(holder, expectedIndex, true);
        continue;
      }

      if (holder.slide?.index !== expectedIndex) {
        instance.setContent(holder, expectedIndex, true);
      }
      const slide = holder.slide;
      if (slide && !this.patchSpreadSlide(slide, instance.getItemData(expectedIndex))) {
        instance.setContent(holder, expectedIndex, true);
      }
    }

    instance.currSlide = holders[1]?.slide;
    const visibleContents = new Set(holders.map(holder => holder.slide?.content).filter(Boolean));
    const cachedItems: any[] = instance.contentLoader?._cachedItems ?? [];
    for (const content of cachedItems) {
      if (!visibleContents.has(content)) content.destroy();
    }
    if (instance.contentLoader) {
      instance.contentLoader._cachedItems = cachedItems.filter(content => visibleContents.has(content));
    }

    this.instance.element?.classList.toggle('pswp--one-slide', itemCount === 1);
    this.instance.updateSize(true);
    instance.contentLoader?.updateLazy?.();
    this.instance.dispatch('change');
  }

  isInteracting(): boolean {
    const instance = this.instance as any;
    return !!instance.gestures?.isDragging
      || !!instance.gestures?.isZooming
      || !!instance.mainScroll?.isShifted?.()
      || (instance.animations?.activeAnimations?.length ?? 0) > 0;
  }

  stopMotion(): void {
    (this.instance as any).mainScroll?.stop?.();
  }

  getSlideContentState(index: number): string | undefined {
    const instance = this.instance as any;
    const slide = instance.slides?.[index] ?? instance.getSlideByIndex?.(index);
    return slide?.content?.state;
  }

  isCurrentContentLoaded(): boolean {
    const content: any = this.instance.currSlide?.content;
    if (Array.isArray(content?.data?.hrSpread)) {
      return content.data.hrSpread.every((page: any) => !!page.src);
    }
    return content?.state === 'loaded';
  }

  isCurrentZoomed(): boolean {
    const slide = this.instance.currSlide;
    return !!slide && slide.currZoomLevel > slide.zoomLevels.initial;
  }

  isCurrentAtInitialZoom(): boolean {
    const slide = this.instance.currSlide;
    return !!slide && slide.currZoomLevel <= slide.zoomLevels.initial;
  }

  canToggleCurrentZoom(): boolean {
    const slide = this.instance.currSlide;
    return !!slide
      && slide.isZoomable()
      && slide.zoomLevels.secondary !== slide.zoomLevels.initial;
  }

  toggleCurrentZoom(point: ScreenPoint): void {
    this.instance.currSlide?.toggleZoom(point);
  }

  hideUi(): void {
    this.instance.element?.classList.remove('pswp--ui-visible');
  }

  toggleUi(): boolean {
    return this.instance.element?.classList.toggle('pswp--ui-visible') ?? false;
  }

  appendUi(elements: readonly HTMLElement[]): void {
    const root = this.instance.element;
    if (!root) return;
    for (const element of elements) root.appendChild(element);
  }

  registerCounter(render: (index: number) => string): void {
    this.instance.ui?.registerElement({
      name: 'custom-counter',
      order: 5,
      onInit: (element, instance) => {
        element.className = 'pswp__counter';
        const update = () => { element.innerHTML = render(instance.currIndex); };
        update();
        instance.on('change', update);
      },
    });
  }

  observeUiVisibility(listener: (visible: boolean) => void): () => void {
    const root = this.instance.element;
    if (!root) return () => {};
    const notify = () => listener(root.classList.contains('pswp--ui-visible'));
    const observer = new MutationObserver(notify);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    notify();
    return () => observer.disconnect();
  }

  installWheel(listener: (event: WheelEvent) => void): () => void {
    const root = this.instance.element;
    if (!root) return () => {};
    const onWheel = (event: WheelEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[data-reader-wheel-block]')) return;
      listener(event);
    };
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }

  installEdgeSwipe(options: {
    onBackward: () => void;
    onForward: () => void;
  }): () => void {
    const root = this.instance.element;
    if (!root) return () => {};
    let touchStartX = 0;
    let touchStartY = 0;
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    };
    const onEnd = (event: TouchEvent) => {
      if (event.changedTouches.length !== 1 || !this.isCurrentAtInitialZoom()) return;
      const deltaX = event.changedTouches[0].clientX - touchStartX;
      const deltaY = event.changedTouches[0].clientY - touchStartY;
      if (Math.abs(deltaX) <= 50 || Math.abs(deltaY) >= Math.abs(deltaX)) return;
      if (deltaX > 0) options.onBackward();
      else options.onForward();
    };
    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchend', onEnd);
    };
  }

  /**
   * Patch a stable single/double spread wrapper without detaching the current
   * slide. Existing image nodes (and their decoded pixels) are preserved when
   * their source is unchanged.
   */
  private patchSpreadSlide(slide: any, itemData: any): boolean {
    if (!Array.isArray(slide?.content?.data?.hrSpread)
        || !Array.isArray(itemData?.hrSpread)) return false;
    const root = slide.content.element?.querySelector?.('[data-reader-spread]') as HTMLElement | null;
    if (!root) return false;

    const existing = new Map<number, HTMLElement>();
    root.querySelectorAll<HTMLElement>('[data-logical-index]').forEach(element => {
      existing.set(Number(element.dataset.logicalIndex), element);
    });

    for (const page of itemData.hrSpread) {
      const logicalIndex = Number(page.index);
      const current = existing.get(logicalIndex);
      let next: HTMLElement;
      if (page.src) {
        const image = current?.tagName === 'IMG'
          ? current as HTMLImageElement
          : document.createElement('img');
        image.className = 'hr-reader-spread__page';
        image.dataset.logicalIndex = String(logicalIndex);
        image.alt = page.alt || '';
        image.decoding = 'async';
        image.fetchPriority = 'high';
        if (image.src !== page.src) image.src = page.src;
        next = image;
      } else {
        const pending = current?.tagName === 'SPAN'
          ? current
          : document.createElement('span');
        pending.className = 'hr-reader-spread__page hr-reader-spread__page--pending';
        pending.dataset.logicalIndex = String(logicalIndex);
        pending.setAttribute('aria-hidden', 'true');
        next = pending;
      }

      if (current && current !== next) current.replaceWith(next);
      root.appendChild(next);
      existing.delete(logicalIndex);
    }
    existing.forEach(element => element.remove());

    slide.data = itemData;
    slide.content.data = itemData;
    slide.content.width = Number(itemData.w) || 1;
    slide.content.height = Number(itemData.h) || 1;
    slide.width = slide.content.width;
    slide.height = slide.content.height;
    slide.zoomLevels.itemData = itemData;
    slide.resize();
    return true;
  }
}

export function createPhotoSwipeDriver(options: ReaderDriverOptions): ReaderDriver {
  return new PhotoSwipeDriver(options);
}
