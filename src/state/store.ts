import { GM_setValue } from '$';
import type { UserSettings } from './types';
import type { SiteAdapter } from '../core/site-adapter';
import type { GalleryItem } from '../core/gallery';
import { loadSettings } from './config';

type StoreEvent = 'settingsChanged' | 'readerModeChanged';
type Listener = () => void;

class Store {
  private _settings: UserSettings;
  private listeners = new Map<StoreEvent, Set<Listener>>();

  activeAdapter: SiteAdapter | null = null;

  // Page state
  currPage = 1;
  perPage = 20;
  imageOffset = 0;  // Global index of first loaded image (0-based)
  nextUrl: string | null = null;
  prevUrl: string | null = null;
  isFetching = false;
  galleryItems: GalleryItem[] = [];

  // Reader session flag
  autoPlay = false;  // Session-only, not persisted

  constructor() {
    this._settings = loadSettings();
  }

  get settings(): Readonly<UserSettings> {
    return this._settings;
  }

  reloadSettings(): void {
    this._settings = loadSettings(this.activeAdapter ?? undefined);
    // Don't emit here, we are doing it during init
  }

  updateSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]): void {
    if (key === 'scrollMode' && this.activeAdapter?.scrollPolicy?.configurable === false) return;
    this._settings[key] = value;
    if (key === 'scrollMode' && this.activeAdapter) {
      GM_setValue(`${this.activeAdapter.name}_scrollMode`, value);
    } else {
      GM_setValue(key, value);
    }
    this.emit('settingsChanged');
  }

  on(event: StoreEvent, listener: Listener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => {
      const listeners = this.listeners.get(event);
      listeners?.delete(listener);
      if (listeners?.size === 0) this.listeners.delete(event);
    };
  }

  emit(event: StoreEvent): void {
    this.listeners.get(event)?.forEach(fn => fn());
  }
}

export const store = new Store();
