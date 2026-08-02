export interface UserSettings {
  scrollMode: boolean;
  autoEnterSinglePage: boolean;
  clickToEnterReader: boolean;
  doublePageMode: boolean;
  autoPlayInterval: number;
  thumbnailPosition: 'top' | 'bottom' | 'left' | 'right';
}

export interface AppConfig {
  scrollPageRootMargin: string;
  imageMaterializeConcurrent: number;
}

