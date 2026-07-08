export interface UserSettings {
  scrollMode: boolean;
  showControl: boolean;
  autoEnterSinglePage: boolean;
  clickToEnterReader: boolean;
  autoPlayInterval: number;
  thumbnailPosition: 'top' | 'bottom' | 'left' | 'right';
}

export interface AppConfig {
  nextPage: string;
  prefetchDistance: number;
  maxRetries: number;
  retryDelay: number;
  maxConcurrent: number;
  requestSpacing: number;
  imageLoadTimeout: number;
}

export interface SinglePageModeHandle {
  open: (startIdx?: number) => void;
  close: () => void;
  isActive: () => boolean;
  getOverlayElement: () => HTMLElement;
  jumpTo: (index: number) => void;
}
