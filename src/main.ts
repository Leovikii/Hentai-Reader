import 'photoswipe/style.css';
import './ui/global.css';
import { store } from './state/store';
import { SiteManager } from './sites/site-manager';
import { processBatch, setupAutoScroll } from './scroll/scroll-controller';
import { createReader } from './app/create-reader';
import { createFloatControl } from './ui/float-control';
import { initViewportScale } from './utils/viewport';
import { GalleryPageLoader } from './core/gallery-page-loader';


(async function main() {
  const adapter = SiteManager.getAdapter(window.location.href);
  if (!adapter) {
    return;
  }
  store.activeAdapter = adapter;
  const pageLoader = new GalleryPageLoader(adapter);
  store.reloadSettings();
  if (adapter.name === '18comic' || adapter.name === '4KHD') {
    (store.settings as any).scrollMode = true;
  }
  const initialPage = await pageLoader.loadInitialPage(document, window.location.href);
  if (initialPage.items.length === 0) return; // Nothing to process

  initViewportScale();

  store.imageOffset = initialPage.position?.startIndex ?? 0;
  store.perPage = initialPage.position?.pageSize
    ?? initialPage.items.length
    ?? 20;
  store.nextUrl = initialPage.nextUrl;
  store.prevUrl = initialPage.prevUrl;

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
    processBatch(initialPage.items, store.currPage, container, false, initialPage.pageUrl);
    setupAutoScroll(pageLoader);
  } else {
    const hiddenBox = document.createElement('div');
    hiddenBox.id = 'gdt-hidden';
    hiddenBox.style.display = 'none';
    document.body.appendChild(hiddenBox);
    processBatch(initialPage.items, store.currPage, hiddenBox, false, initialPage.pageUrl);
  }

  // Initialize single page mode
  const readerHandle = createReader(pageLoader);

  createFloatControl(readerHandle);

  // Non-scroll dwell warm-up: the grid downloads nothing until the reader opens,
  // and a user who lingers on the gallery is almost certainly about to read from
  // image 1. After a short dwell, prefetch the first few images' bytes so the
  // reader opens instantly. Bailed automatically if they open sooner (warmup is
  // deduped) or leave (the page unloads, killing in-flight downloads).
  if (!store.settings.scrollMode) {
    setTimeout(() => {
      if (!readerHandle.isActive()) readerHandle.warmupInitial(3);
    }, 1500);
  }



  // Auto enter reader mode
  if (store.settings.autoEnterSinglePage) {
    setTimeout(() => readerHandle.open(0), 1000);
  }

  // Native click to enter reader mode
  document.body.addEventListener('click', (e) => {
    if (!store.settings.clickToEnterReader || !store.settings.scrollMode || readerHandle.isActive()) return;
    const target = e.target as HTMLElement;
    const imgTarget = target.closest('.r-img, .r-ph');
    if (imgTarget) {
      e.preventDefault();
      e.stopPropagation(); // Stop native scripts from interfering
      const allImages = Array.from(document.querySelectorAll('.r-img, .r-ph'));
      const index = allImages.indexOf(imgTarget);
      if (index !== -1) {
        readerHandle.open(index);
      }
    }
  }, true); // Use capture phase to intercept before native scripts

})();
