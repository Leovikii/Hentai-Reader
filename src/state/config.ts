import { GM_getValue } from '$';
import type { AppConfig, UserSettings } from './types';

export const CFG: AppConfig = {
  nextPage: '3000px 0px',
  maxRetries: 3,
  retryDelay: 1000,
  maxConcurrent: 3,
};

export function loadSettings(adapterName?: string): UserSettings {
  const prefix = adapterName ? `${adapterName}_` : '';
  const is4KHD = adapterName === '4KHD';
  const globalScrollMode = GM_getValue('scrollMode', true);
  
  return {
    scrollMode: GM_getValue(`${prefix}scrollMode`, is4KHD ? true : globalScrollMode),
    showControl: GM_getValue('showControl', true),
    autoEnterSinglePage: GM_getValue('autoEnterSinglePage', false),
    clickToEnterReader: GM_getValue('clickToEnterReader', true),
    autoPlayInterval: GM_getValue('autoPlayInterval', 5000),
    thumbnailPosition: GM_getValue('thumbnailPosition', 'bottom'),
  };
}
