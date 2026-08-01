export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ReaderDriverOptions {
  startIndex: number;
  onBackgroundClick: (point: ScreenPoint) => void;
  onImageClick: (point: ScreenPoint) => void;
  onTap: (point: ScreenPoint) => void;
}

/** Reader-facing navigation and input surface, independent of PhotoSwipe. */
export interface ReaderDriver {
  readonly currentIndex: number;
  on(event: string, listener: (event: any) => void): void;
  init(): void;
  destroy(): void;
  next(): void;
  prev(): void;
  goTo(index: number): void;
  refreshSlide(index: number): void;
  /** Reconcile a changed presentation data source without replacing the root reader. */
  syncLayout(index: number): void;
  /** True while a gesture or transition makes structural remapping unsafe. */
  isInteracting(): boolean;
  stopMotion(): void;
  getSlideContentState(index: number): string | undefined;
  isCurrentContentLoaded(): boolean;
  isCurrentZoomed(): boolean;
  isCurrentAtInitialZoom(): boolean;
  canToggleCurrentZoom(): boolean;
  toggleCurrentZoom(point: ScreenPoint): void;
  hideUi(): void;
  toggleUi(): boolean;
  appendUi(elements: readonly HTMLElement[]): void;
  registerCounter(render: (index: number) => string): void;
  observeUiVisibility(listener: (visible: boolean) => void): () => void;
  installWheel(listener: (event: WheelEvent) => void): () => void;
  installEdgeSwipe(options: {
    onBackward: () => void;
    onForward: () => void;
  }): () => void;
}

export type ReaderDriverFactory = (options: ReaderDriverOptions) => ReaderDriver;

export interface ReaderScrollImageLoadedEvent {
  index: number;
  element: HTMLElement;
  viewerUrl: string;
}

export interface ReaderScrollRestoreRequest {
  entryScrollY: number;
  target?: {
    key: string;
    index: number;
    preferred?: HTMLElement;
  };
  nearbyGeometry?: ReadonlyArray<{
    key: string;
    index: number;
    preferred?: HTMLElement;
    width: number;
    height: number;
  }>;
}

/** App-provided bridge; Reader never imports the scroll implementation. */
export interface ReaderScrollBridge {
  pause(): void;
  resume(): void;
  requestImage(element: HTMLElement): void;
  subscribeImageLoaded(
    listener: (event: ReaderScrollImageLoadedEvent) => void,
  ): () => void;
  restore(request: ReaderScrollRestoreRequest): void;
}

export interface ReaderHandle {
  open(startIdx?: number): void;
  close(): void;
  isActive(): boolean;
  /** Seed a short non-scroll warm-up window before Reader opens. */
  warmupInitial(count: number): void;
}

/** Narrow application state port consumed by Reader orchestration. */
export interface ReaderAppContext {
  getGalleryItems(): readonly GalleryItem[];
  isScrollMode(): boolean;
  isDoublePageModeEnabled(): boolean;
  isAutoPlayEnabled(): boolean;
  setAutoPlayEnabled(enabled: boolean): void;
  getAutoPlayInterval(): number;
  getThumbnailPosition(): 'top' | 'bottom' | 'left' | 'right';
  getImageOffset(): number;
  setImageOffset(offset: number): void;
  getNextUrl(): string | null;
  setNextUrl(url: string | null): void;
  getPrevUrl(): string | null;
  setPrevUrl(url: string | null): void;
  isPageFetching(): boolean;
  setPageFetching(fetching: boolean): void;
  subscribeSettingsChanged(listener: () => void): () => void;
  subscribeReaderModeChanged(listener: () => void): () => void;
  emitReaderModeChanged(): void;
  onReaderClose(globalIndex: number): void;
}
import type { GalleryItem } from '../core/gallery';
