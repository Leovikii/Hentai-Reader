import 'virtual:uno.css';
import 'photoswipe/style.css';
import './ui/global.css';
import { store } from './state/store';
import { SiteManager } from './sites/site-manager';
import { processBatch, setupAutoScroll } from './features/scroll-mode';
import { initSinglePageMode } from './features/single-page-mode';
import { createFloatControl } from './ui/float-control';
import { initViewportScale } from './utils/viewport';


(async function main() {
  initViewportScale();

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

  // Initialize single page mode
  const spmHandle = initSinglePageMode();

  createFloatControl(spmHandle);

  // Non-scroll dwell warm-up: the grid downloads nothing until the reader opens,
  // and a user who lingers on the gallery is almost certainly about to read from
  // image 1. After a short dwell, prefetch the first few images' bytes so the
  // reader opens instantly. Bailed automatically if they open sooner (warmup is
  // deduped) or leave (the page unloads, killing in-flight downloads).
  if (!store.settings.scrollMode) {
    setTimeout(() => {
      if (!spmHandle.isActive()) spmHandle.warmupInitial(3);
    }, 1500);
  }



  // Auto enter reader mode
  if (store.settings.autoEnterSinglePage) {
    setTimeout(() => spmHandle.open(0), 1000);
  }

  // Native click to enter reader mode
  document.body.addEventListener('click', (e) => {
    if (!store.settings.clickToEnterReader || !store.settings.scrollMode || spmHandle.isActive()) return;
    const target = e.target as HTMLElement;
    const imgTarget = target.closest('.r-img, .r-ph');
    if (imgTarget) {
      e.preventDefault();
      e.stopPropagation(); // Stop native scripts from interfering
      const allImages = Array.from(document.querySelectorAll('.r-img, .r-ph'));
      const index = allImages.indexOf(imgTarget);
      if (index !== -1) {
        spmHandle.open(index);
      }
    }
  }, true); // Use capture phase to intercept before native scripts

})();
