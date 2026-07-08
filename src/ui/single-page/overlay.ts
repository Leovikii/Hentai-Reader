import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';

import './overlay.css';
import { store } from '../../state/store';
import type { PageLink } from '../../types/site-adapter';
import { qa } from '../../utils/dom';
import { prefetchImageUrl } from '../../features/scroll-mode';
import { createSidebar } from './thumbnail-panel';
import { createAutoPlay } from './auto-play';
import { createStatusHUD } from '../components/status-hud';
import { i18n } from '../../utils/i18n';

import type { SinglePageModeHandle } from '../../types';

export interface SinglePageOverlayDeps {
  onLoadNextPage: (links: PageLink[], nextUrl: string | null, prevUrl?: string | null) => void;
  onLoadPrevPage: (links: PageLink[], prevUrl: string | null) => void;
}

export function createSinglePageOverlay(deps: SinglePageOverlayDeps): SinglePageModeHandle {
  let pswp: PhotoSwipe | null = null;
  let isActive = false;
  let isReinitializing = false;
  let hasNavigatedInReader = false;
  let lastNavigatedIndex = -1;

  // Sync our `store.allImages` with the DOM placeholders
  function syncImages(): void {
    const freshImages = Array.from(qa('.r-img, .r-ph')) as HTMLElement[];
    if (freshImages.length !== store.allImages.length || freshImages.some((img, i) => img !== store.allImages[i])) {
      store.allImages = freshImages;
      sidebar.update();
      if (pswp) {
        // Just let PhotoSwipe know the total number of items changed
        pswp.refreshSlideContent(pswp.currIndex);
      }
    }
  }

  const hud = createStatusHUD();

  function checkAndLoadNextPage(): void {
    if (!store.nextUrl || store.isFetching) return;
    const remainingImages = store.allImages.length - store.currentImageIndex;
    if (remainingImages <= 5) {
      loadNextPage();
    }
  }

  function loadNextPage(): void {
    if (!store.nextUrl || store.isFetching) return;
    store.isFetching = true;
    hud.show({ status: 'loading', text: i18n.downloading });
    store.activeAdapter!.fetchPage(store.nextUrl).then(({ links, nextUrl, prevUrl }) => {
      deps.onLoadNextPage(links, nextUrl, prevUrl);
      syncImages();
      store.isFetching = false;
      hud.hide();
      checkAndLoadNextPage();
    }).catch((err) => {
      console.error('[Single Page] Load failed', err);
      store.isFetching = false;
      hud.show({ status: 'error', text: i18n.loadFailed, onClick: () => { hud.hide(); loadNextPage(); } });
    });
  }

  function loadPrevPage(): void {
    if (!store.prevUrl || store.isFetching) return;
    store.isFetching = true;
    hud.show({ status: 'loading', text: i18n.downloading });
    store.activeAdapter!.fetchPage(store.prevUrl).then(({ links, prevUrl }) => {
      const prevCount = links.length;
      deps.onLoadPrevPage(links, prevUrl ?? null);

      isReinitializing = true;
      store.currentImageIndex += prevCount;
      store.imageOffset = Math.max(0, store.imageOffset - prevCount);
      
      syncImages();
      if (pswp) {
        // @ts-ignore
        if (pswp.mainScroll && pswp.mainScroll.stop) pswp.mainScroll.stop();
        pswp.goTo(store.currentImageIndex);
      }
      isReinitializing = false;
      store.isFetching = false;
      hud.hide();
    }).catch((err) => {
      console.error('[Single Page] Load prev failed', err);
      store.isFetching = false;
      hud.show({ status: 'error', text: i18n.loadFailed, onClick: () => { hud.hide(); loadPrevPage(); } });
    });
  }

  const autoPlay = createAutoPlay(() => {
    if (pswp) pswp.next();
  });

  const sidebar = createSidebar((index) => {
    store.currentImageIndex = index;
    if (pswp) pswp.goTo(index);
    autoPlay.reset();
  }, () => loadNextPage(), () => loadPrevPage());

  // Assemblage handled in uiRegister for PhotoSwipe

  // We will append sidebar elements to PhotoSwipe once it initializes

  function open(startIdx?: number): void {
    // Guard against a second open() while already active (e.g. the
    // autoEnterSinglePage timer firing after a manual open) — without this a
    // new PhotoSwipe is built over the live one, orphaning the first instance.
    if (isActive) return;

    store.allImages = Array.from(qa('.r-img, .r-ph')) as HTMLElement[];
    if (store.allImages.length === 0) {
      alert(i18n.waitImagesToLoad);
      return;
    }

    let startIndex = startIdx ?? 0;
    
    // Reset navigation tracker on open
    hasNavigatedInReader = false;
    lastNavigatedIndex = startIndex;
    
    // Calculate start index only if not provided explicitly
    if (startIdx === undefined) {
      if (store.settings.scrollMode) {
        let minDistance = Infinity;
      store.allImages.forEach((img, index) => {
        const rect = img.getBoundingClientRect();
        const viewportCenter = window.innerHeight / 2;
        if (rect.top <= viewportCenter && rect.bottom >= viewportCenter) {
          startIndex = index;
          minDistance = -1;
        } else if (minDistance !== -1) {
          const distanceToCenter = rect.bottom < viewportCenter ? viewportCenter - rect.bottom : rect.top - viewportCenter;
          if (distanceToCenter < minDistance) {
            minDistance = distanceToCenter;
            startIndex = index;
          }
        }
      });
      } else {
        startIndex = store.currentImageIndex;
      }
    }

    store.currentImageIndex = startIndex;
    isActive = true;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    store.emit('readerModeChanged');

    // Force re-centering on the current image. Without this, lastCenteredIndex
    // would persist from the previous session, and if we re-open at the same
    // index, centerOnCurrent() gets skipped even though the panel's scroll
    // position was reset to 0 when the DOM was detached/reattached.
    sidebar.resetCentering();

    initPhotoSwipe(startIndex);

    if (store.autoPlay) {
      autoPlay.start();
    }
  }

  function initPhotoSwipe(startIndex: number) {
    let mobileUiTimeout: ReturnType<typeof setTimeout>;
    function triggerMobileUITimeout() {
      const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      if (!isTouchDevice) return;
      clearTimeout(mobileUiTimeout);
      mobileUiTimeout = setTimeout(() => {
        if (pswp && pswp.element) {
          pswp.element.classList.remove('pswp--ui-visible');
        }
      }, 2000);
    }

    function cancelMobileUITimeout() {
      clearTimeout(mobileUiTimeout);
    }

    window.addEventListener('sp-mobile-ui-interaction-start', cancelMobileUITimeout);
    window.addEventListener('sp-mobile-ui-interaction-end', triggerMobileUITimeout);

    function handleScreenClick(point: { x: number, y: number }, defaultCenterAction: 'zoom' | 'toggle') {
      const width = window.innerWidth;
      if (point.x < width * 0.3) {
         if (pswp?.currIndex === 0 && store.prevUrl && !store.isFetching) {
            loadPrevPage();
         } else {
            pswp?.prev();
         }
      } else if (point.x > width * 0.7) {
         if (pswp?.currIndex === store.allImages.length - 1 && store.nextUrl && !store.isFetching) {
            loadNextPage();
         } else {
            pswp?.next();
         }
      } else {
         if (defaultCenterAction === 'zoom' && pswp?.currSlide?.isZoomable() && pswp.currSlide.zoomLevels.secondary !== pswp.currSlide.zoomLevels.initial) {
            pswp.currSlide.toggleZoom(point);
         } else {
            const isNowVisible = pswp?.element?.classList.toggle('pswp--ui-visible');
            if (isNowVisible) triggerMobileUITimeout();
         }
      }
    }

    pswp = new PhotoSwipe({
      index: startIndex,
      counter: false, // We use a custom counter to show global offset
      bgOpacity: 1,
      spacing: 0.1,
      loop: false,
      wheelToZoom: false,
      preload: [1, 1], // Reduced from [1, 3] to save memory for massive WebPs
      closeOnVerticalDrag: true,
      arrowPrev: false,
      arrowNext: false,
      doubleTapAction: false,
      initialZoomLevel: (zoomLevelObject: any) => {
        if (!zoomLevelObject.panAreaSize || !zoomLevelObject.elementSize) return zoomLevelObject.fit;
        const hRatio = zoomLevelObject.panAreaSize.x / zoomLevelObject.elementSize.x;
        const vRatio = zoomLevelObject.panAreaSize.y / zoomLevelObject.elementSize.y;
        return hRatio < vRatio ? hRatio : vRatio;
      },
      secondaryZoomLevel: (zoomLevelObject: any) => {
        if (!zoomLevelObject.panAreaSize || !zoomLevelObject.elementSize) return zoomLevelObject.fit * 1.5;
        const hRatio = zoomLevelObject.panAreaSize.x / zoomLevelObject.elementSize.x;
        return hRatio * 1.5;
      },
      maxZoomLevel: (zoomLevelObject: any) => {
        if (!zoomLevelObject.panAreaSize || !zoomLevelObject.elementSize) return 4;
        const hRatio = zoomLevelObject.panAreaSize.x / zoomLevelObject.elementSize.x;
        return Math.max(hRatio * 3, 4);
      },
      bgClickAction: (point: any) => handleScreenClick(point, 'toggle'),
      imageClickAction: (point: any) => handleScreenClick(point, 'zoom'),
      tapAction: (point: any) => handleScreenClick(point, 'toggle'),
    });

    pswp.on('destroy', () => {
      window.removeEventListener('sp-mobile-ui-interaction-start', cancelMobileUITimeout);
      window.removeEventListener('sp-mobile-ui-interaction-end', triggerMobileUITimeout);
    });

    const fetchingState = new Map<string, 'resolving' | 'downloading'>();
    const tempImages = new Map<number, HTMLImageElement>(); // Keep track to abort

    pswp.on('contentRemove', (e) => {
      const content = e.content;
      if (tempImages.has(content.index)) {
        const tImg = tempImages.get(content.index)!;
        tImg.src = '';
        tempImages.delete(content.index);
      }
    });

    pswp.on('numItems', (e) => {
      e.numItems = store.allImages.length;
    });

    pswp.on('itemData', (e) => {
      const el = store.allImages[e.index];
      if (!el) {
        e.itemData = { src: '', w: 0, h: 0 } as any;
        return;
      }
      const viewerUrl = el.dataset.url || el.dataset.viewerUrl || '';
      const fallbackSrc = (el as HTMLImageElement).dataset.realSrc || (el as HTMLImageElement).src || '';
      
      const resolvedSrc = store.resolvedUrls.get(viewerUrl) || fallbackSrc;
      let dim = store.imageDimensions.get(viewerUrl);
      if (!dim && el.tagName === 'IMG') {
        const htmlImg = el as HTMLImageElement;
        if (htmlImg.complete && htmlImg.naturalWidth > 0) {
          dim = { w: htmlImg.naturalWidth, h: htmlImg.naturalHeight };
          store.imageDimensions.set(viewerUrl, dim);
        }
      }
      
      if (!dim && resolvedSrc && store.activeAdapter?.extractDimensionFromResolvedUrl) {
        const extracted = store.activeAdapter.extractDimensionFromResolvedUrl(resolvedSrc);
        if (extracted) {
          dim = extracted;
          store.imageDimensions.set(viewerUrl, dim);
        }
      }

      // If dimensions are unknown, calculate fallback
      if (!dim) {
        let fallbackW = window.innerWidth;
        let fallbackH = 0;
        
        const tw = parseInt(el.dataset.thumbW || '0', 10);
        const th = parseInt(el.dataset.thumbH || '0', 10);
        
        if (tw > 0 && th > 0) {
          // 1. Use extracted thumbnail dimensions if available
          fallbackH = (fallbackW / tw) * th;
        } else {
          // 2. Elegant fallback: use aspect ratio of any already loaded image in the gallery
          let fallbackRatio = 1.414; // Standard manga A4 aspect ratio (height / width)
          for (const loadedDim of store.imageDimensions.values()) {
            if (loadedDim.w > 0 && loadedDim.h > 0) {
              fallbackRatio = loadedDim.h / loadedDim.w;
              break;
            }
          }
          fallbackH = fallbackW * fallbackRatio;
        }
        dim = { w: fallbackW, h: fallbackH };
      }

      const trueDimKnown = store.imageDimensions.has(viewerUrl) || (el.tagName === 'IMG' && (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);

      if (resolvedSrc && resolvedSrc.indexOf('x.gif') === -1 && trueDimKnown) {
        e.itemData = {
          src: resolvedSrc,
          msrc: el.dataset.thumb, // low res
          w: dim.w,
          h: dim.h,
        } as any;
      } else {
        e.itemData = {
          src: '', // Empty src triggers loading state
          msrc: el.dataset.thumb,
          w: dim.w,
          h: dim.h,
        } as any;

        if (!fetchingState.has(viewerUrl) && viewerUrl) {
          fetchingState.set(viewerUrl, 'resolving');
          if (pswp && pswp.currIndex === e.index) {
             hud.show({ status: 'loading', text: i18n.resolvingImage });
          }
          // The slide the user is looking at must resolve before its preloaded
          // neighbors; closer to the current index = higher priority.
          const distance = pswp ? Math.abs(e.index - pswp.currIndex) : 0;
          const priority = 100 - distance;
          // Guard against stale async callbacks: `myPswp` pins the instance this
          // request belongs to (a close+reopen swaps `pswp`), and findLive()
          // re-locates the slide by URL because loadPrevPage prepends and shifts
          // every index — the captured e.index goes stale mid-flight.
          const myPswp = pswp;
          const findLive = () => store.allImages.findIndex(im => (im.dataset.url || im.dataset.viewerUrl) === viewerUrl);
          prefetchImageUrl(viewerUrl, undefined, false, priority).then(res => {
            if (!myPswp || myPswp !== pswp) { fetchingState.delete(viewerUrl); return; }
            if (res && res.src) {
              fetchingState.set(viewerUrl, 'downloading');
              if (myPswp.currIndex === findLive()) {
                 hud.show({ status: 'loading', text: i18n.downloading });
              }
              const img = new Image();
              img.decoding = 'async';
              img.onload = () => {
                store.imageDimensions.set(viewerUrl, { w: img.naturalWidth, h: img.naturalHeight });
                fetchingState.delete(viewerUrl);
                if (!myPswp || myPswp !== pswp) return;
                const idx = findLive();
                if (idx === -1) return;
                if (myPswp.currIndex === idx) hud.hide();
                myPswp.refreshSlideContent(idx);
                if (myPswp.currIndex === idx && store.autoPlay) {
                  autoPlay.start();
                }
              };
              img.onerror = () => {
                 fetchingState.delete(viewerUrl);
                 if (!myPswp || myPswp !== pswp) return;
                 const idx = findLive();
                 if (idx !== -1 && myPswp.currIndex === idx) {
                    hud.show({ status: 'error', text: i18n.loadFailed });
                    setTimeout(() => hud.hide(), 3000);
                 }
              };
              img.src = res.src;
            } else {
              fetchingState.delete(viewerUrl);
              if (myPswp && myPswp === pswp && myPswp.currIndex === findLive()) hud.hide();
            }
          }).catch(() => {
             fetchingState.delete(viewerUrl);
             if (!myPswp || myPswp !== pswp) return;
             const idx = findLive();
             if (idx !== -1 && myPswp.currIndex === idx) {
                hud.show({ status: 'error', text: i18n.resolveImageFailed });
                setTimeout(() => hud.hide(), 3000);
             }
          });
        }
      }
    });

    let scrollAccumulator = 0;
    let scrollDecayTimeout: ReturnType<typeof setTimeout> | null = null;
    let scrollBatchTimeout: ReturnType<typeof setTimeout> | null = null;
    const SCROLL_THRESHOLD = 80;

    pswp.on('wheel', (e) => {
      const slide = pswp?.currSlide;
      if (!slide) return;
      
      // If the image is zoomed in (larger than 'initial'), let PhotoSwipe handle the panning natively.
      if (slide.currZoomLevel > slide.zoomLevels.initial) {
        return;
      }

      // Otherwise, intercept wheel to switch pages
      e.preventDefault();
      
      const event = e.originalEvent as WheelEvent;
      let delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 33;
      else if (event.deltaMode === 2) delta *= window.innerHeight;

      // Reset accumulator if scrolling direction changes
      if (Math.sign(delta) !== Math.sign(scrollAccumulator) && scrollAccumulator !== 0) {
        scrollAccumulator = 0;
      }

      scrollAccumulator += delta;

      // Decay accumulator if user stops scrolling
      if (scrollDecayTimeout) clearTimeout(scrollDecayTimeout);
      scrollDecayTimeout = setTimeout(() => { scrollAccumulator = 0; }, 200);

      // Batch rapid scroll events to calculate the jump distance
      if (Math.abs(scrollAccumulator) >= SCROLL_THRESHOLD && !scrollBatchTimeout) {
         scrollBatchTimeout = setTimeout(() => {
             const pagesToJump = Math.trunc(scrollAccumulator / SCROLL_THRESHOLD);
             if (pagesToJump !== 0) {
                 let targetIndex = pswp!.currIndex + pagesToJump;
                 
                 if (targetIndex < 0 && store.prevUrl && !store.isFetching) {
                     loadPrevPage();
                     scrollAccumulator = 0;
                 } else if (targetIndex >= store.allImages.length && store.nextUrl && !store.isFetching) {
                     loadNextPage();
                     scrollAccumulator = 0;
                 } else {
                     targetIndex = Math.max(0, Math.min(store.allImages.length - 1, targetIndex));
                     if (targetIndex !== pswp!.currIndex) {
                         // @ts-ignore
                         if (pswp!.mainScroll && pswp!.mainScroll.stop) pswp!.mainScroll.stop();
                         pswp!.goTo(targetIndex);
                     }
                     scrollAccumulator -= pagesToJump * SCROLL_THRESHOLD;
                     if (Math.abs(scrollAccumulator) > SCROLL_THRESHOLD) {
                         scrollAccumulator = Math.sign(scrollAccumulator) * (SCROLL_THRESHOLD - 1);
                     }
                 }
             }
             scrollBatchTimeout = null;
         }, 50); // 50ms batching window perfectly captures fast wheel flicks
      }
    });

    pswp.on('change', () => {
      if (isReinitializing) {
        return;
      }
      if (pswp) {
        store.currentImageIndex = pswp.currIndex;
        sidebar.update();
        checkAndLoadNextPage();
        
        // Sync HUD with current slide state
        const viewerUrl = store.allImages[pswp.currIndex]?.dataset.url || store.allImages[pswp.currIndex]?.dataset.viewerUrl;
        const state = viewerUrl ? fetchingState.get(viewerUrl) : undefined;
        if (state === 'resolving') {
           hud.show({ status: 'loading', text: i18n.resolvingImage });
        } else if (state === 'downloading') {
           hud.show({ status: 'loading', text: i18n.downloading });
        } else {
           hud.hide();
        }

        // Track navigation
        if (lastNavigatedIndex !== -1 && lastNavigatedIndex !== pswp.currIndex) {
          hasNavigatedInReader = true;
        }
        
        // Only trigger prev page load if we are actively navigating backwards near the edge, 
        // or if we literally hit the absolute 0 index while trying to go back.
        const isNavigatingBackwards = pswp.currIndex < lastNavigatedIndex;
        lastNavigatedIndex = pswp.currIndex;

        if (store.currentImageIndex <= 3 && store.prevUrl && hasNavigatedInReader && isNavigatingBackwards) {
          loadPrevPage();
        }
        if (store.autoPlay) {
           autoPlay.stop();
           // Reached the last image with no further page to load — stop instead
           // of leaving the interval spinning on a no-op next().
           if (pswp.currIndex >= store.allImages.length - 1 && !store.nextUrl) {
             autoPlay.stopAtEnd();
           } else {
             const content = pswp.currSlide?.content;
             if (content && content.state === 'loaded') {
               autoPlay.start();
             }
           }
        }
      }
    });

    let touchStartX = 0;
    let touchStartY = 0;

    pswp.on('uiRegister', () => {
      if (pswp && pswp.ui) {
        // Register Custom Counter
        pswp.ui.registerElement({
          name: 'custom-counter',
          order: 5,
          onInit: (el, pswpInstance) => {
            el.className = 'pswp__counter'; // Use native class for styling
            pswpInstance.on('change', () => {
              el.innerHTML = `${store.imageOffset + pswpInstance.currIndex + 1} / ${store.imageOffset + store.allImages.length}`;
            });
          }
        });
      }

      if (pswp && pswp.element) {
        // Append our custom sidebar directly to PhotoSwipe's container
        sidebar.getElements().forEach(el => {
          (el as HTMLElement).style.pointerEvents = 'auto'; // ensure clickable
          pswp!.element!.appendChild(el);
        });
        
        // Append HUD
        pswp.element.appendChild(hud.getElement());

        // Mobile out-of-bounds swipe detection
        pswp.element.addEventListener('touchstart', (e: TouchEvent) => {
            if (e.touches.length === 1) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            }
        }, { passive: true });

        pswp.element.addEventListener('touchend', (e: TouchEvent) => {
            if (e.changedTouches.length === 1) {
                const touchEndX = e.changedTouches[0].clientX;
                const touchEndY = e.changedTouches[0].clientY;
                const deltaX = touchEndX - touchStartX;
                const deltaY = touchEndY - touchStartY;

                // Check if it's a horizontal swipe
                if (Math.abs(deltaX) > 50 && Math.abs(deltaY) < Math.abs(deltaX)) {
                    const slide = pswp?.currSlide;
                    if (slide && slide.currZoomLevel <= slide.zoomLevels.initial) {
                        if (deltaX > 0) { // Swiped right
                            if (pswp?.currIndex === 0 && store.prevUrl && !store.isFetching) {
                                loadPrevPage();
                            }
                        } else { // Swiped left
                            if (pswp?.currIndex === store.allImages.length - 1 && store.nextUrl && !store.isFetching) {
                                loadNextPage();
                            }
                        }
                    }
                }
            }
        }, { passive: true });

        const observer = new MutationObserver(() => {
          if (pswp && pswp.element) {
            const isVisible = pswp.element.classList.contains('pswp--ui-visible');
            
            sidebar.getElements().forEach(el => { 
               if (isVisible) {
                 el.classList.remove('sp-hidden-by-pswp');
               } else {
                 el.classList.add('sp-hidden-by-pswp');
               }
            });
            
            const isTouchDevice = window.matchMedia('(hover: none)').matches;
            if (isTouchDevice) {
              if (isVisible) {
                 sidebar.openPanel(false); 
              } else {
                 sidebar.closePanel();
              }
            }
          }
        });
        observer.observe(pswp.element, { attributes: true, attributeFilter: ['class'] });
        pswp.on('destroy', () => observer.disconnect());

        // Trigger initial timeout for mobile UI
        triggerMobileUITimeout();
      }
    });

    pswp.on('close', () => {
      close();
    });

    pswp.init();
  }

  function close(): void {
    autoPlay.stop();
    store.autoPlay = false;
    isActive = false;

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';

    store.emit('readerModeChanged');

    if (pswp) {
      const p = pswp;
      pswp = null;
      try {
        p.destroy();
      } catch (err) {
        console.error('[Hentai-Reader] Error destroying PhotoSwipe:', err);
      }
    }

    if (store.settings.scrollMode) {
      const currentImages = Array.from(qa('.r-img, .r-ph')) as HTMLElement[];
      if (store.currentImageIndex >= 0 && store.currentImageIndex < currentImages.length) {
        const targetImg = currentImages[store.currentImageIndex];
        if (targetImg) {
          setTimeout(() => {
            targetImg.scrollIntoView({ behavior: 'auto', block: 'center' });
          }, 10);
        }
      }
    }

    if (store.activeAdapter?.onReaderClose) {
      store.activeAdapter.onReaderClose(store.imageOffset + store.currentImageIndex);
    }
  }

  store.on('settingsChanged', () => {
    if (!isActive) return;
    if (store.autoPlay) {
       autoPlay.start();
    } else {
      autoPlay.stop();
    }
  });

  store.on('readerModeChanged', () => {
    if (!isActive || !pswp) return;
    const el = document.querySelector('.pswp__counter');
    if (el) {
      el.innerHTML = `${store.imageOffset + pswp.currIndex + 1} / ${store.imageOffset + store.allImages.length}`;
    }
  });

  function jumpTo(index: number): void {
    if (!isActive) return;
    store.currentImageIndex = Math.max(0, Math.min(index, store.allImages.length - 1));
    if (pswp) {
      pswp.goTo(store.currentImageIndex);
    }
    autoPlay.reset();
  }

  return {
    open,
    close,
    isActive: () => isActive,
    getOverlayElement: () => pswp?.element || document.body,
    jumpTo,
  };
}
