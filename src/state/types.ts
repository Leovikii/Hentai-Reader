export interface UserSettings {
  scrollMode: boolean;
  autoEnterSinglePage: boolean;
  clickToEnterReader: boolean;
  doublePageMode: boolean;
  doublePageDirection: 'ltr' | 'rtl';
  autoPlayInterval: number;
  thumbnailPosition: 'top' | 'bottom' | 'left' | 'right';
}

export interface AppConfig {
  scrollPageRootMargin: string;
  imageMaterializeConcurrent: number;
}

