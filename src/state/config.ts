import { GM_getValue } from '$';
import type { AppConfig, UserSettings } from './types';
import type { SiteAdapter } from '../core/site-adapter';

export const CFG: AppConfig = {
  scrollPageRootMargin: '3000px 0px',
  // Materializers combine source decode, a full-size canvas and Blob export.
  // Serializing this high-memory stage keeps long chapters responsive; direct
  // URL downloads still use the shared 4/2 network scheduler unchanged.
  imageMaterializeConcurrent: 1,
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
    autoEnterSinglePage: GM_getValue('autoEnterSinglePage', false),
    clickToEnterReader: GM_getValue('clickToEnterReader', true),
    doublePageMode: GM_getValue('doublePageMode', true),
    autoPlayInterval: Math.max(1000, Number(GM_getValue('autoPlayInterval', 5000)) || 5000),
    thumbnailPosition: GM_getValue('thumbnailPosition', 'bottom'),
  };
}
