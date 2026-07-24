import { GM_getValue } from '$';
import type { AppConfig, UserSettings } from './types';
import type { SiteAdapter } from '../core/site-adapter';

export const CFG: AppConfig = {
  scrollPageRootMargin: '3000px 0px',
  imageMaterializeConcurrent: 3,
};

export function loadSettings(adapter?: Pick<SiteAdapter, 'name' | 'scrollPolicy'>): UserSettings {
  const prefix = adapter ? `${adapter.name}_` : '';
  const globalScrollMode = GM_getValue('scrollMode', true);
  const scrollDefault = adapter?.scrollPolicy?.defaultEnabled ?? globalScrollMode;
  const scrollMode = adapter?.scrollPolicy?.configurable === false
    ? scrollDefault
    : GM_getValue(`${prefix}scrollMode`, scrollDefault);
  
  return {
    scrollMode,
    showControl: GM_getValue('showControl', true),
    autoEnterSinglePage: GM_getValue('autoEnterSinglePage', false),
    clickToEnterReader: GM_getValue('clickToEnterReader', true),
    autoPlayInterval: GM_getValue('autoPlayInterval', 5000),
    thumbnailPosition: GM_getValue('thumbnailPosition', 'bottom'),
  };
}
