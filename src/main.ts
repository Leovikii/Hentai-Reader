import 'virtual:uno.css';
import 'photoswipe/style.css';
import './ui/styles.css';
import { store } from './state/store';
import { SiteManager } from './sites/site-manager';
import { processBatch, setupAutoScroll } from './features/scroll-mode';
import { initSinglePageMode } from './features/single-page-mode';
import { createFloatControl } from './ui/float-control';


(async function main() {
  const adapter = SiteManager.getAdapter(window.location.href);
  if (!adapter) {
    return;
  }
  store.activeAdapter = adapter;
  store.reloadSettings();
  if (adapter.name === '18comic' || adapter.name === '4KHD') {
    (store.settings as any).scrollMode = true;
  }
  const initData = await adapter.init(document);
  if (!initData.links || initData.links.length === 0) return; // Nothing to process

  store.totalPage = initData.totalPage ?? 1;
  store.nextUrl = initData.nextUrl;
  store.prevUrl = initData.prevUrl;
  if (!store.perPage) {
    store.perPage = initData.links.length || 20;
  }

  if (store.imageOffset > 0 && store.perPage > 0) {
    store.currPage = Math.floor(store.imageOffset / store.perPage) + 1;
  }

  let container = adapter.getContainer();
  // We no longer abort if container is missing in scroll mode. We will create a fallback.

  if (store.settings.scrollMode) {
    document.documentElement.classList.add('scroll-mode');
    adapter.hideOriginalElements?.();
    if (!container) {
      container = document.createElement('div');
      container.id = 'gdt';
      document.body.appendChild(container);
    }
    container.innerHTML = '';
    processBatch(initData.links, store.currPage, container, false, window.location.href);
    setupAutoScroll();
  } else {
    const hiddenBox = document.createElement('div');
    hiddenBox.id = 'gdt-hidden';
    hiddenBox.style.display = 'none';
    document.body.appendChild(hiddenBox);
    processBatch(initData.links, store.currPage, hiddenBox, false, window.location.href);
  }

  // Initialize single page mode with lazy wrapper for circular dependency
  let spmHandle: ReturnType<typeof initSinglePageMode>;

  createFloatControl({
    open: () => spmHandle.open(),
    close: () => spmHandle.close(),
    isActive: () => spmHandle.isActive(),
    getOverlayElement: () => spmHandle.getOverlayElement(),
    jumpTo: (index: number) => spmHandle.jumpTo(index),
  });

  spmHandle = initSinglePageMode();



  // Auto enter reader mode
  if (store.settings.autoEnterSinglePage) {
    setTimeout(() => spmHandle.open(), 1000);
  }


})();
