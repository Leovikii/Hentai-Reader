import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';

import { store } from '../../state/store';
import type { PageLink } from '../../types/site-adapter';
import { qa } from '../../utils/dom';
import { prefetchImageUrl } from '../../features/scroll-mode';
import { createSidebar } from './sidebar';
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
    if (remainingImages <= 10) {
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

      store.currentImageIndex += prevCount;
      store.imageOffset = Math.max(0, store.imageOffset - prevCount);
      
      if (prevCount > 0 && store.currentImageIndex === prevCount) {
        store.currentImageIndex--; // Auto-advance to the newly loaded previous image
      }

      syncImages();
      if (pswp) {
        pswp.goTo(store.currentImageIndex);
      }
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

  function open(): void {
    store.allImages = Array.from(qa('.r-img, .r-ph')) as HTMLElement[];
    if (store.allImages.length === 0) {
      alert(i18n.waitImagesToLoad);
      return;
    }

    let startIndex = 0;
    // Calculate start index (same as before)
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
      const adapter = store.activeAdapter;
      let nativeImages: HTMLElement[] = [];
      if (adapter?.getNativeImages) nativeImages = adapter.getNativeImages();
      else {
        const container = adapter?.getContainer();
        if (container) nativeImages = Array.from(container.querySelectorAll('img')).filter(img => img.clientWidth > 50 || img.clientHeight > 50);
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
            const distanceToCenter = rect.bottom < viewportCenter ? viewportCenter - rect.bottom : rect.top - viewportCenter;
            if (distanceToCenter < minDistance) {
              minDistance = distanceToCenter;
              bestNativeImg = img;
            }
          }
        });
        if (bestNativeImg) {
          const currentSrc = (bestNativeImg as HTMLImageElement).dataset?.viewerUrl || (bestNativeImg as HTMLImageElement).dataset?.src || (bestNativeImg as HTMLImageElement).src;
          const foundIdx = store.allImages.findIndex(i => {
            const iSrc = (i as HTMLImageElement).dataset?.url || (i as HTMLImageElement).dataset?.viewerUrl || (i as HTMLImageElement).dataset?.realSrc || (i as HTMLImageElement).dataset?.src || (i as HTMLImageElement).src;
            return iSrc === currentSrc;
          });
          if (foundIdx !== -1) startIndex = foundIdx;
        }
      }
    }

    store.currentImageIndex = startIndex;
    isActive = true;
    store.emit('readerModeChanged');

    initPhotoSwipe(startIndex);

    if (store.autoPlay) {
      autoPlay.start();
    }
  }

  function initPhotoSwipe(startIndex: number) {
    console.log('[PS Debug] initPhotoSwipe called with startIndex:', startIndex);
    let mobileUiTimeout: ReturnType<typeof setTimeout>;
    function triggerMobileUITimeout() {
      if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;
      clearTimeout(mobileUiTimeout);
      mobileUiTimeout = setTimeout(() => {
        if (pswp && pswp.element) {
          pswp.element.classList.remove('pswp--ui-visible');
        }
      }, 2000);
    }

    function handleScreenClick(point: { x: number, y: number }, defaultCenterAction: 'zoom' | 'toggle') {
      const width = window.innerWidth;
      if (point.x < width * 0.3) {
         pswp?.prev();
      } else if (point.x > width * 0.7) {
         pswp?.next();
      } else {
         if (defaultCenterAction === 'zoom' && pswp?.currSlide?.isZoomable() && pswp.currSlide.zoomLevels.secondary !== pswp.currSlide.zoomLevels.initial) {
            pswp.currSlide.toggleZoom(point);
         } else {
            pswp?.element?.classList.toggle('pswp--ui-visible');
            triggerMobileUITimeout();
         }
      }
    }

    pswp = new PhotoSwipe({
      index: startIndex,
      bgOpacity: 1,
      spacing: 0.1,
      wheelToZoom: false,
      preload: [1, 3], // Preload 1 before, 3 after
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

    const fetchingState = new Map<string, 'resolving' | 'downloading'>();

    pswp.on('numItems', (e) => {
      e.numItems = store.allImages.length;
    });

    pswp.on('itemData', (e) => {
      console.log(`[PS Debug] itemData requested for index ${e.index}`);
      const el = store.allImages[e.index];
      if (!el) {
        console.warn(`[PS Debug] No element found for index ${e.index}`);
        e.itemData = { src: '', w: 0, h: 0 } as any;
        return;
      }
      const viewerUrl = el.dataset.url || el.dataset.viewerUrl || '';
      const fallbackSrc = (el as HTMLImageElement).dataset.realSrc || (el as HTMLImageElement).src || '';
      
      console.log(`[PS Debug] Viewer URL for index ${e.index}:`, viewerUrl);
      const resolvedSrc = store.resolvedUrls.get(viewerUrl) || fallbackSrc;
      let dim = store.imageDimensions.get(viewerUrl);
      if (!dim && el.tagName === 'IMG') {
        const htmlImg = el as HTMLImageElement;
        if (htmlImg.complete && htmlImg.naturalWidth > 0) {
          dim = { w: htmlImg.naturalWidth, h: htmlImg.naturalHeight };
          store.imageDimensions.set(viewerUrl, dim);
        }
      }

      if (resolvedSrc && resolvedSrc.indexOf('x.gif') === -1) {
        if (!dim) {
          dim = { w: window.innerWidth, h: window.innerHeight * 1.5 };
          // Need to grab the actual dimensions in the background to fix stretching
          if (!fetchingState.has(viewerUrl)) {
            fetchingState.set(viewerUrl, 'downloading');
            const tempImg = new Image();
            tempImg.onload = () => {
              fetchingState.delete(viewerUrl);
              store.imageDimensions.set(viewerUrl, { w: tempImg.naturalWidth, h: tempImg.naturalHeight });
              if (pswp) pswp.refreshSlideContent(e.index);
            };
            tempImg.onerror = () => fetchingState.delete(viewerUrl);
            tempImg.src = resolvedSrc;
          }
        }
        
        console.log(`[PS Debug] returning resolved data for index ${e.index}: src=${resolvedSrc.substring(0, 50)}..., w=${dim.w}, h=${dim.h}`);
        e.itemData = {
          src: resolvedSrc,
          msrc: el.dataset.thumb, // low res
          w: dim.w,
          h: dim.h,
        } as any;
      } else {
        const dim = { w: window.innerWidth, h: window.innerHeight * 1.5 };
        console.log(`[PS Debug] returning placeholder for index ${e.index}, triggering fetch`);
        e.itemData = {
          src: '', // Empty src triggers loading state
          msrc: el.dataset.thumb,
          w: dim.w,
          h: dim.h,
        } as any;

        if (!fetchingState.has(viewerUrl) && viewerUrl) {
          console.log(`[PS Debug] Fetching URL for index ${e.index}:`, viewerUrl);
          fetchingState.set(viewerUrl, 'resolving');
          if (pswp && pswp.currIndex === e.index) {
             hud.show({ status: 'loading', text: i18n.resolvingImage });
          }
          prefetchImageUrl(viewerUrl).then(res => {
            console.log(`[PS Debug] fetch resolved for index ${e.index}:`, res?.src ? res.src.substring(0, 50) + '...' : 'empty');
            
            if (res && res.src) {
              fetchingState.set(viewerUrl, 'downloading');
              if (pswp && pswp.currIndex === e.index) {
                 hud.show({ status: 'loading', text: i18n.downloading });
              }
              const img = new Image();
              img.onload = () => {
                console.log(`[PS Debug] image onload for index ${e.index}, w: ${img.naturalWidth}, h: ${img.naturalHeight}`);
                store.imageDimensions.set(viewerUrl, { w: img.naturalWidth, h: img.naturalHeight });
                fetchingState.delete(viewerUrl);
                if (pswp) {
                  if (pswp.currIndex === e.index) hud.hide();
                  console.log(`[PS Debug] refreshing slide content for index ${e.index}`);
                  pswp.refreshSlideContent(e.index);
                  if (pswp.currIndex === e.index && store.autoPlay) {
                    autoPlay.start();
                  }
                } else {
                   console.warn('[PS Debug] pswp instance is null during image onload');
                }
              };
              img.onerror = (err) => {
                 console.error(`[PS Debug] image onerror for index ${e.index}`, err);
                 fetchingState.delete(viewerUrl);
                 if (pswp && pswp.currIndex === e.index) {
                    hud.show({ status: 'error', text: i18n.loadFailed });
                    setTimeout(() => hud.hide(), 3000);
                 }
              };
              img.src = res.src;
            } else {
              fetchingState.delete(viewerUrl);
              if (pswp && pswp.currIndex === e.index) hud.hide();
            }
          }).catch(err => {
             console.error(`[PS Debug] fetch error for index ${e.index}`, err);
             fetchingState.delete(viewerUrl);
             if (pswp && pswp.currIndex === e.index) {
                hud.show({ status: 'error', text: i18n.resolveImageFailed });
                setTimeout(() => hud.hide(), 3000);
             }
          });
        }
      }
    });

    let wheelDebounce: ReturnType<typeof setTimeout> | null = null;
    pswp.on('wheel', (e) => {
      const slide = pswp?.currSlide;
      if (!slide) return;
      
      // If the image is zoomed in (larger than 'fit'), let PhotoSwipe handle the panning natively.
      if (slide.currZoomLevel > slide.zoomLevels.fit) {
        return;
      }

      // Otherwise, intercept wheel to switch pages
      e.preventDefault();
      
      // Debounce the wheel event slightly to prevent accidental double-skips on smooth scrolling mice
      if (wheelDebounce) return;
      wheelDebounce = setTimeout(() => { wheelDebounce = null; }, 100);

      const event = e.originalEvent as WheelEvent;
      if (event.deltaY > 0) {
        pswp?.next();
      } else if (event.deltaY < 0) {
        pswp?.prev();
      }
    });

    pswp.on('change', () => {
      if (pswp) {
        console.log(`[PS Debug] change event fired, currIndex = ${pswp.currIndex}`);
        store.currentImageIndex = pswp.currIndex;
        sidebar.update();
        checkAndLoadNextPage();
        
        // Sync HUD with current slide state
        const viewerUrl = store.allImages[pswp.currIndex]?.getAttribute('href');
        const state = viewerUrl ? fetchingState.get(viewerUrl) : undefined;
        if (state === 'resolving') {
           hud.show({ status: 'loading', text: i18n.resolvingImage });
        } else if (state === 'downloading') {
           hud.show({ status: 'loading', text: i18n.downloading });
        } else {
           hud.hide();
        }

        // Check if we need to load previous page when going backwards
        if (store.currentImageIndex <= 3 && store.prevUrl) {
          loadPrevPage();
        }
        if (store.autoPlay) {
           autoPlay.stop();
           const content = pswp.currSlide?.content;
           if (content && content.state === 'loaded') {
             autoPlay.start();
           }
        }
      }
    });

    pswp.on('uiRegister', () => {
      if (pswp && pswp.element) {
        // Append our custom sidebar directly to PhotoSwipe's container
        sidebar.getElements().forEach(el => {
          (el as HTMLElement).style.pointerEvents = 'auto'; // ensure clickable
          pswp!.element!.appendChild(el);
        });
        
        // Append HUD
        pswp.element.appendChild(hud.getElement());

        // Toggle visibility with PhotoSwipe UI
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
          }
        });
        observer.observe(pswp.element, { attributes: true, attributeFilter: ['class'] });

        // Trigger initial timeout for mobile UI
        triggerMobileUITimeout();
      }
    });

    pswp.on('close', () => {
      console.log('[PS Debug] close event fired');
      close();
    });

    try {
      console.log('[PS Debug] Calling pswp.init()');
      pswp.init();
      console.log('[PS Debug] pswp.init() succeeded');
    } catch (e) {
      console.error('[PS Debug] pswp.init() threw an error:', e);
    }
  }

  function close(): void {
    autoPlay.stop();
    store.autoPlay = false;
    isActive = false;
    store.emit('readerModeChanged');

    if (pswp) {
      const p = pswp;
      pswp = null;
      p.destroy();
    }

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
