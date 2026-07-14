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
  }

  get currentIndex(): number {
    return this.instance.currIndex;
  }

  on(event: string, listener: (event: any) => void): void {
    this.instance.on(event as any, listener as any);
  }

  init(): void { this.instance.init(); }
  destroy(): void { this.instance.destroy(); }
  next(): void { this.instance.next(); }
  prev(): void { this.instance.prev(); }
  goTo(index: number): void { this.instance.goTo(index); }
  refreshSlide(index: number): void { this.instance.refreshSlideContent(index); }

  stopMotion(): void {
    (this.instance as any).mainScroll?.stop?.();
  }

  getSlideContentState(index: number): string | undefined {
    const instance = this.instance as any;
    const slide = instance.slides?.[index] ?? instance.getSlideByIndex?.(index);
    return slide?.content?.state;
  }

  isCurrentContentLoaded(): boolean {
    return this.instance.currSlide?.content?.state === 'loaded';
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
}

export function createPhotoSwipeDriver(options: ReaderDriverOptions): ReaderDriver {
  return new PhotoSwipeDriver(options);
}
