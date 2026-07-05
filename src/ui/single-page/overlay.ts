import { store } from '../../state/store';
import type { PageLink } from '../../types/site-adapter';
import { CFG } from '../../state/config';
import { qa, isImageReady } from '../../utils/dom';
import { loadPlaceholderImage } from '../../features/scroll-mode';
import { createSidebar } from './sidebar';
import { setupNavigation } from './navigation';
import { createAutoPlay } from './auto-play';
import { createStatusHUD } from '../components/status-hud';
import { i18n } from '../../utils/i18n';
import type { SinglePageModeHandle } from '../../types';

export interface SinglePageOverlayDeps {
  onLoadNextPage: (links: PageLink[], nextUrl: string | null, prevUrl?: string | null) => void;
  onLoadPrevPage: (links: PageLink[], prevUrl: string | null) => void;
}

export function createSinglePageOverlay(deps: SinglePageOverlayDeps): SinglePageModeHandle {
  const overlay = document.createElement('div');
  overlay.className = 'single-page-overlay';

  const closeBtn = document.createElement('div');
  closeBtn.className = 'sp-close-btn';
  closeBtn.innerHTML = '&#10005;';

  const imageContainer = document.createElement('div');
  imageContainer.className = 'sp-image-container';

  const currentImage = document.createElement('img');
  currentImage.className = 'sp-current-image';
  imageContainer.appendChild(currentImage);

  // Error handler for the overlay display image itself
  currentImage.addEventListener('error', () => {
    if (!overlay.classList.contains('active')) return;
    if (!currentImage.src || currentImage.src === location.href) return;
    showError();
  });

  let loadPollTimer: ReturnType<typeof setInterval> | null = null;
  let loadTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let networkTriggerTimer: ReturnType<typeof setTimeout> | null = null;
  let loadObserver: MutationObserver | null = null;

  function clearLoadPoll(): void {
    if (loadPollTimer) {
      clearInterval(loadPollTimer);
      loadPollTimer = null;
    }
    if (loadTimeoutTimer) {
      clearTimeout(loadTimeoutTimer);
      loadTimeoutTimer = null;
    }
    if (networkTriggerTimer) {
      clearTimeout(networkTriggerTimer);
      networkTriggerTimer = null;
    }
    if (loadObserver) {
      loadObserver.disconnect();
      loadObserver = null;
    }
  }

  const statusHUD = createStatusHUD();

  function showPlaceholder(statusText: string = 'Loading...'): void {
    statusHUD.show({
      status: 'loading',
      text: statusText,
      pageText: `${store.imageOffset + store.currentImageIndex + 1} / ${store.imageOffset + store.allImages.length}`
    });
  }

  function removePlaceholder(): void {
    statusHUD.hide();
  }

  function showError(): void {
    clearLoadPoll();
    currentImage.style.display = 'none';
    statusHUD.show({
      status: 'error',
      text: i18n.loadFailed,
      pageText: `${store.imageOffset + store.currentImageIndex + 1} / ${store.imageOffset + store.allImages.length}`,
    });
  }

  function removeErrorUI(): void {
    statusHUD.hide();
  }

  function syncImages(): void {
    const freshImages = Array.from(qa('.r-img, .r-ph')) as HTMLElement[];
    if (freshImages.length !== store.allImages.length || freshImages.some((img, i) => img !== store.allImages[i])) {
      store.allImages = freshImages;
      sidebar.update();
    }
  }

  function applyOverlaySrc(imgSrc: string, currentImg: HTMLElement): void {
    if (imgSrc && currentImage.dataset.assignedSrc !== imgSrc) {
      currentImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      setTimeout(() => {
        currentImage.src = imgSrc;
        currentImage.dataset.assignedSrc = imgSrc;
        if (!isImageReady(currentImg as HTMLImageElement) && !isImageReady(currentImage)) {
          showPlaceholder(i18n.downloading);
        } else {
          removePlaceholder();
        }
      }, 0);
    } else if (imgSrc && currentImage.dataset.assignedSrc === imgSrc) {
      if (isImageReady(currentImg as HTMLImageElement) || isImageReady(currentImage)) {
        removePlaceholder();
      }
    } else if (!imgSrc && currentImage.dataset.assignedSrc) {
      currentImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      delete currentImage.dataset.assignedSrc;
    }
  }

  function updateImage(): void {
    clearLoadPoll();
    removeErrorUI();
    const idx = store.currentImageIndex;

    syncImages();
    const img = store.allImages[idx];

    if (!img) {
      showPlaceholder(i18n.waitingForNetwork);
      sidebar.update();
      startLoadPoll(idx);
      return;
    }

    const imgSrc = (img as HTMLImageElement).dataset.realSrc || (img as HTMLImageElement).src;
    applyOverlaySrc(imgSrc, img);
    currentImage.style.display = 'block';

    if (!imgSrc) {
      showPlaceholder(i18n.waitingForNetwork);
    }

    sidebar.update();

    // Defer actual network fetching to avoid clogging queue when scrolling fast
    networkTriggerTimer = setTimeout(() => {
      // Re-fetch in case it changed
      const currentImg = store.allImages[store.currentImageIndex];
      if (!currentImg) return;

      const latestImgSrc = (currentImg as HTMLImageElement).dataset.realSrc || (currentImg as HTMLImageElement).src;
      if (latestImgSrc) {
        applyOverlaySrc(latestImgSrc, currentImg);
      }

      // Preload current and next 3 images
      for (let i = 0; i <= 3; i++) {
        const targetImg = store.allImages[store.currentImageIndex + i];
        if (targetImg && targetImg.classList.contains('r-ph')) {
          loadPlaceholderImage(targetImg as HTMLElement);
        }
      }

      if (!isImageReady(currentImg as HTMLImageElement)) {
        startLoadPoll(store.currentImageIndex);
      }
    }, 150);
  }

  function startLoadPoll(idx: number): void {
    if (store.autoPlay) autoPlay.stop();

    let imageErrored = false;
    let lastKnownImg = store.allImages[idx];

    function onImageReady(): void {
      if (store.currentImageIndex !== idx) return;
      const img = store.allImages[idx];
      if ((img && isImageReady(img as HTMLImageElement)) || isImageReady(currentImage)) {
        clearLoadPoll();
        removePlaceholder();
        sidebar.update();
        if (store.autoPlay) autoPlay.start();
      }
    }

    function onImageError(): void {
      imageErrored = true;
      if (store.autoPlay) {
        tryAutoSkip();
      } else {
        if (store.currentImageIndex === idx) {
          showError();
        }
      }
    }

    function tryAutoSkip(): void {
      if (store.currentImageIndex !== idx) return;
      const nextIdx = idx + 1;
      if (nextIdx < store.allImages.length) {
        const nextImg = store.allImages[nextIdx];
        if (nextImg && isImageReady(nextImg as HTMLImageElement)) {
          clearLoadPoll();
          store.currentImageIndex = nextIdx;
          updateImage();
          checkAndLoadNextPage();
          if (store.autoPlay) autoPlay.start();
          return;
        }
      }
      if (nextIdx < store.allImages.length || imageErrored) {
        clearLoadPoll();
        store.currentImageIndex = nextIdx < store.allImages.length ? nextIdx : idx;
        updateImage();
        if (nextIdx < store.allImages.length) {
          checkAndLoadNextPage();
        }
      }
    }

    if (lastKnownImg && lastKnownImg.tagName === 'IMG') {
      lastKnownImg.addEventListener('load', onImageReady, { once: true });
      lastKnownImg.addEventListener('error', onImageError, { once: true });
    }

    const mainBox = document.querySelector(store.settings.scrollMode ? '#gdt' : '#gdt-hidden');
    if (mainBox) {
      loadObserver = new MutationObserver(() => {
        if (store.currentImageIndex !== idx) { clearLoadPoll(); return; }
        syncImages();
        const currentImg = store.allImages[idx];
        if (currentImg) {
          if (currentImg.classList.contains('error')) {
            showError();
            return;
          } else if (currentImg.classList.contains('loading')) {
            showPlaceholder(i18n.downloading);
            return;
          }
           const imgSrc = (currentImg as HTMLImageElement).dataset.realSrc || (currentImg as HTMLImageElement).src;
           applyOverlaySrc(imgSrc, currentImg);
          if (currentImg !== lastKnownImg) {
            lastKnownImg = currentImg;
            if (currentImg.tagName === 'IMG') {
              currentImg.addEventListener('load', onImageReady, { once: true });
              currentImg.addEventListener('error', onImageError, { once: true });
              if (isImageReady(currentImg as HTMLImageElement)) onImageReady();
            }
          }
        }
      });
      loadObserver.observe(mainBox, { childList: true, subtree: true });
    }

    loadPollTimer = setInterval(() => {
      if (store.currentImageIndex !== idx) { clearLoadPoll(); return; }
      const currentImg = store.allImages[idx];
      if (currentImg) {
        if (currentImg.classList.contains('error')) {
          showError();
          return;
        } else if (currentImg.classList.contains('loading')) {
          showPlaceholder(i18n.downloading);
          return;
        }
        const imgSrc = (currentImg as HTMLImageElement).dataset.realSrc || (currentImg as HTMLImageElement).src;
        applyOverlaySrc(imgSrc, currentImg);
        if (currentImg !== lastKnownImg) {
          lastKnownImg = currentImg;
          if (currentImg.tagName === 'IMG') {
            currentImg.addEventListener('load', onImageReady, { once: true });
            currentImg.addEventListener('error', onImageError, { once: true });
          }
        }
      }
      onImageReady();
    }, 500);

    if (store.autoPlay) {
      loadTimeoutTimer = setTimeout(() => {
        if (store.currentImageIndex !== idx) return;
        const img = store.allImages[idx];
        if (img && isImageReady(img as HTMLImageElement)) return;
        tryAutoSkip();
      }, CFG.imageLoadTimeout);
    }
  }

  // Wire up sub-modules (forward declarations resolved via closures)
  const autoPlay = createAutoPlay(() => nav.nextImage());

  currentImage.addEventListener('load', () => {
    if (!overlay.classList.contains('active')) return;
    if (currentImage.src && !currentImage.src.includes('data:') && isImageReady(currentImage)) {
      removePlaceholder();
      clearLoadPoll();
      sidebar.update();
      if (store.autoPlay) autoPlay.start();
    }
  });

  const sidebar = createSidebar((index) => {
    store.currentImageIndex = index;
    updateImage();
    autoPlay.reset();
  }, () => loadNextPage(), () => loadPrevPage());

  const nav = setupNavigation({
    overlay,
    updateImage,
    checkAndLoadNextPage: () => checkAndLoadNextPage(),
    checkAndLoadPrevPage: () => loadPrevPage(),
    resetAutoPlay: () => autoPlay.reset(),
    stopAutoPlayAtEnd: () => autoPlay.stopAtEnd(),
    closeSinglePageMode: () => close(),
  });

  overlay.addEventListener('wheel', () => {
    sidebar.wakeUpProgressBar();
  }, { passive: true });

  // Assemble DOM
  overlay.appendChild(closeBtn);
  sidebar.getElements().forEach(el => overlay.appendChild(el));
  overlay.appendChild(statusHUD.getElement());
  overlay.appendChild(imageContainer);
  document.body.appendChild(overlay);

  closeBtn.onclick = () => close();

  function open(): void {
    store.allImages = Array.from(qa('.r-img, .r-ph')) as HTMLElement[];
    if (store.allImages.length === 0) {
      alert(i18n.waitImagesToLoad);
      return;
    }

    let startIndex = 0;

    if (store.settings.scrollMode) {
      let minDistance = Infinity;

      store.allImages.forEach((img, index) => {
        const rect = img.getBoundingClientRect();
        const viewportCenter = window.innerHeight / 2;
        
        if (rect.top <= viewportCenter && rect.bottom >= viewportCenter) {
          startIndex = index;
          minDistance = -1;
        } else if (minDistance !== -1) {
          const distanceToCenter = rect.bottom < viewportCenter 
            ? viewportCenter - rect.bottom 
            : rect.top - viewportCenter;
            
          if (distanceToCenter < minDistance) {
            minDistance = distanceToCenter;
            startIndex = index;
          }
        }
      });
    } else {
      // Non-scroll mode: try to find the native image closest to viewport center
      const adapter = store.activeAdapter;
      let nativeImages: HTMLElement[] = [];
      
      if (adapter?.getNativeImages) {
        nativeImages = adapter.getNativeImages();
      } else {
        const container = adapter?.getContainer();
        if (container) {
          nativeImages = Array.from(container.querySelectorAll('img')).filter(img => img.clientWidth > 50 || img.clientHeight > 50);
        }
      }

      if (nativeImages.length > 0) {
        let minDistance = Infinity;
        let bestNativeImg: HTMLElement | null = null;
        nativeImages.forEach((img) => {
          const rect = img.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          
          const viewportCenter = window.innerHeight / 2;
          if (rect.top <= viewportCenter && rect.bottom >= viewportCenter) {
            bestNativeImg = img;
            minDistance = -1;
          } else if (minDistance !== -1) {
            const distanceToCenter = rect.bottom < viewportCenter 
              ? viewportCenter - rect.bottom 
              : rect.top - viewportCenter;
              
            if (distanceToCenter < minDistance) {
              minDistance = distanceToCenter;
              bestNativeImg = img;
            }
          }
        });
        
        if (bestNativeImg) {
          const currentSrc = (bestNativeImg as HTMLImageElement).dataset?.viewerUrl || (bestNativeImg as HTMLImageElement).dataset?.src || (bestNativeImg as HTMLImageElement).src;
          const foundIdx = store.allImages.findIndex(i => {
            const iSrc = (i as HTMLImageElement).dataset?.viewerUrl || (i as HTMLImageElement).dataset?.realSrc || (i as HTMLImageElement).dataset?.src || (i as HTMLImageElement).src;
            return iSrc === currentSrc;
          });
          if (foundIdx !== -1) {
            startIndex = foundIdx;
          }
        }
      } else {
        startIndex = 0;
      }
    }

    store.currentImageIndex = startIndex;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    updateImage();
    store.emit('readerModeChanged');

    if (store.autoPlay) {
      autoPlay.start();
    }
  }

  function close(): void {
    clearLoadPoll();
    removeErrorUI();
    autoPlay.stop();
    store.autoPlay = false;
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    store.emit('readerModeChanged');

    if (store.settings.scrollMode) {
      const currentImages = Array.from(qa('.r-img, .r-ph')) as HTMLElement[];
      if (store.currentImageIndex >= 0 && store.currentImageIndex < currentImages.length) {
        const targetImg = currentImages[store.currentImageIndex];
        if (targetImg) {
          setTimeout(() => {
            targetImg.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      }
    } else {
      const adapter = store.activeAdapter;
      let nativeImages: HTMLElement[] = [];
      if (adapter?.getNativeImages) {
        nativeImages = adapter.getNativeImages();
      } else {
        const container = adapter?.getContainer();
        if (container) {
          nativeImages = Array.from(container.querySelectorAll('img')).filter(img => img.clientWidth > 50 || img.clientHeight > 50);
        }
      }

      const targetImgFallback = store.allImages[store.currentImageIndex];
      const batchDiv = targetImgFallback?.closest('.page-batch') as HTMLElement | null;

      if (batchDiv && batchDiv.dataset.pageUrl) {
        const targetUrl = new URL(batchDiv.dataset.pageUrl, window.location.href);
        const currentUrl = new URL(window.location.href);
        // If the image belongs to a different page, navigate to it!
        if (targetUrl.pathname !== currentUrl.pathname || targetUrl.search !== currentUrl.search) {
          window.location.href = targetUrl.toString();
          return;
        }
      }

      // If we are still on the same page, we can attempt to scroll to the native image
      if (store.currentImageIndex >= 0 && nativeImages.length > 0) {
        // Find which index this image represents IN THE NATIVE PAGE
        // We can do this by finding the img in nativeImages that has the same src
        const currentSrc = (targetImgFallback as HTMLImageElement)?.dataset?.viewerUrl || (targetImgFallback as HTMLImageElement)?.dataset?.realSrc || (targetImgFallback as HTMLImageElement)?.src;
        if (currentSrc) {
          const targetNativeImg = nativeImages.find(img => {
            const nativeSrc = (img as HTMLImageElement).dataset?.viewerUrl || (img as HTMLImageElement).dataset?.src || (img as HTMLImageElement).src;
            return nativeSrc === currentSrc;
          });

          if (targetNativeImg) {
            setTimeout(() => {
              targetNativeImg.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
            return;
          }
        }
      }



      // Fallback for sites that use ?p= parameter for pagination
      if (adapter?.name === 'E-Hentai' || adapter?.name === 'ExHentai') {
        const globalIndex = store.imageOffset + store.currentImageIndex;
        if (globalIndex >= 0) {
          const targetPage = Math.floor(globalIndex / store.perPage);
          const url = new URL(window.location.href);
          const currentPage = parseInt(url.searchParams.get('p') || '0');
          if (targetPage !== currentPage) {
            url.searchParams.set('p', String(targetPage));
            window.location.href = url.toString();
          }
        }
      }
    }
  }

  // Listen for autoPlay setting changes from float-control button
  store.on('settingsChanged', () => {
    if (!overlay.classList.contains('active')) return;
    if (store.autoPlay) {
      const img = store.allImages[store.currentImageIndex];
      if (img && isImageReady(img as HTMLImageElement)) {
        autoPlay.start();
      }
    } else {
      autoPlay.stop();
    }
  });

  function loadNextPage(): void {
    if (!store.nextUrl || store.isFetching) return;

    store.isFetching = true;
    store.activeAdapter!.fetchPage(store.nextUrl).then(({ links, nextUrl, prevUrl }) => {
      deps.onLoadNextPage(links, nextUrl, prevUrl);
      syncImages();
      store.isFetching = false;
      checkAndLoadNextPage();
    }).catch((err) => {
      console.error('[Single Page] Load failed', err);
      store.isFetching = false;
    });
  }

  function loadPrevPage(): void {
    if (!store.prevUrl || store.isFetching) return;

    store.isFetching = true;

    store.activeAdapter!.fetchPage(store.prevUrl).then(({ links, prevUrl }) => {
      const prevCount = links.length;

      deps.onLoadPrevPage(links, prevUrl ?? null);

      store.currentImageIndex += prevCount;
      store.imageOffset = Math.max(0, store.imageOffset - prevCount);
      
      if (prevCount > 0 && store.currentImageIndex === prevCount) {
        store.currentImageIndex--; // Auto-advance to the newly loaded previous image
      }

      store.allImages = Array.from(qa('.r-img, .r-ph')) as HTMLElement[];
      sidebar.update();
      updateImage();

      store.isFetching = false;
    }).catch((err) => {
      console.error('[Single Page] Load prev failed', err);
      store.isFetching = false;
    });
  }

  function checkAndLoadNextPage(): void {
    if (!store.nextUrl || store.isFetching) return;

    const remainingImages = store.allImages.length - store.currentImageIndex;
    if (remainingImages <= 10) {
      loadNextPage();
    }
  }

  function jumpTo(index: number): void {
    if (!overlay.classList.contains('active')) return;
    store.currentImageIndex = Math.max(0, Math.min(index, store.allImages.length - 1));
    updateImage();
    autoPlay.reset();
  }

  return {
    open,
    close,
    isActive: () => overlay.classList.contains('active'),
    getOverlayElement: () => overlay,
    jumpTo,
  };
}
