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
  maxRetries: number;
  retryDelay: number;
  maxConcurrent: number;
}

export interface SinglePageModeHandle {
  open: (startIdx?: number) => void;
  close: () => void;
  isActive: () => boolean;
  /** Non-scroll dwell warm-up: prefetch the first few images' bytes so the
   * reader opens instantly. No-op once the reader is already active. */
  warmupInitial: (count: number) => void;
}
