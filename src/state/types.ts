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

