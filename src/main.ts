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
  const rollbacks: Array<() => void> = [];
  try {
    store.activeAdapter = adapter;
    const pageLoader = new GalleryPageLoader(adapter);
    store.reloadSettings();
    const initialPage = await pageLoader.loadInitialPage(document, window.location.href);
    if (initialPage.items.length === 0) return; // Nothing to process

    rollbacks.push(initViewportScale());

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
    const originalContainerHtml = container?.innerHTML;

    if (store.settings.scrollMode) {
      document.documentElement.classList.add('scroll-mode');
      rollbacks.push(() => document.documentElement.classList.remove('scroll-mode'));
      const restoreOriginal = adapter.hideOriginalElements?.();
      if (restoreOriginal) rollbacks.push(restoreOriginal);
      if (!container) {
        container = document.createElement('div');
        container.id = 'gdt';
        document.body.appendChild(container);
        rollbacks.push(() => container?.remove());
      } else {
        rollbacks.push(() => {
          if (container && originalContainerHtml !== undefined) container.innerHTML = originalContainerHtml;
        });
      }
      container.innerHTML = '';
      processBatch(initialPage.items, store.currPage, container, false, initialPage.pageUrl);
      rollbacks.push(setupAutoScroll(pageLoader));
    } else {
      const hiddenBox = document.createElement('div');
      hiddenBox.id = 'gdt-hidden';
      hiddenBox.style.display = 'none';
      document.body.appendChild(hiddenBox);
      rollbacks.push(() => hiddenBox.remove());
      processBatch(initialPage.items, store.currPage, hiddenBox, false, initialPage.pageUrl);
    }

  // Initialize single page mode
    const readerHandle = createReader(pageLoader);

    rollbacks.push(createFloatControl(readerHandle));

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
  } catch (error) {
    for (const rollback of rollbacks.reverse()) {
      try { rollback(); } catch {}
    }
    store.galleryItems = [];
    store.activeAdapter = null;
    console.error('[Hentai-Reader] Initialization failed and was rolled back', error);
  }

})();
