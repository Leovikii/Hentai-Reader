import type { SiteAdapter } from '../core/site-adapter';
import { EHentaiAdapter } from './e-hentai';
import { FourKHDAdapter } from './4khd';
import { Comic18Adapter } from './18comic';

const adapters: SiteAdapter[] = [EHentaiAdapter, FourKHDAdapter, Comic18Adapter];

export const SiteManager = {
  register(adapter: SiteAdapter) {
    adapters.push(adapter);
  },

  getAdapter(url: string, doc: Document = document): SiteAdapter | null {
    return adapters.find(a => a.match(url, doc)) || null;
  }
};
