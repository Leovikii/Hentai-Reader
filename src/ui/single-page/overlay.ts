import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';

import './overlay.css';
import { store } from '../../state/store';
import type { PageLink } from '../../types/site-adapter';
import { qa } from '../../utils/dom';
import { pauseLazyLoad, resumeLazyLoad } from '../../features/scroll-mode';
import { resolveImageWithRetry, attachImageRetry } from '../../features/image-retry';
import { createPrefetchController } from '../../features/prefetch-controller';
import { createSidebar } from './thumbnail-panel';
import { createWheelPager } from './wheel-pager';
import { createAutoPlay } from './auto-play';
import { createStatusHUD } from '../components/status-hud';
import { i18n } from '../../utils/i18n';
import { LOAD_PRIORITY } from '../../state/load-policy';

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
  let overflowSnapshot: { documentElement: string; body: string } | null = null;

  // Sync our `store.allImages` with the DOM placeholders
  function syncImages(): void {
    const freshImages = Array.from(qa('.r-img, .r-ph')) as HTMLElement[];
    const changed = freshImages.length !== store.allImages.length || freshImages.some((img, i) => img !== store.allImages[i]);
    if (changed) {
      store.allImages = freshImages;
      sidebar.update();
      if (pswp) {
        // Rebuild current + neighbour holders: a page-count growth can leave a
        // pre-built empty holder that goTo would otherwise slide in as undefined.
        const c = pswp.currIndex;
        for (let i = c - 1; i <= c + 1; i++) {
          if (i >= 0 && i < store.allImages.length) pswp.refreshSlideContent(i);
        }
      }
    }
  }

  const hud = createStatusHUD();
  const prefetch = createPrefetchController();

  function checkAndLoadNextPage(): void {
    if (!store.nextUrl || store.isFetching) return;
    const remainingImages = store.allImages.length - store.currentImageIndex;
    if (remainingImages <= 5) {
      loadNextPage();
    }
  }

  function loadNextPage(): void {
    if (!store.nextUrl || store.isFetching) return;
    const requestedUrl = store.nextUrl;
    if (store.loadedPageUrls.has(requestedUrl)) {
      store.nextUrl = null;
      return;
    }
    store.isFetching = true;
    hud.show({ status: 'loading', text: i18n.downloading });
    store.activeAdapter!.fetchPage(requestedUrl).then(({ links, nextUrl, prevUrl }) => {
      if (links.length === 0) throw new Error('Fetched page has no images');
      deps.onLoadNextPage(links, nextUrl === requestedUrl ? null : nextUrl, prevUrl);
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
    const requestedUrl = store.prevUrl;
    if (store.loadedPageUrls.has(requestedUrl)) {
      store.prevUrl = null;
      return;
    }
    store.isFetching = true;
    hud.show({ status: 'loading', text: i18n.downloading });
    store.activeAdapter!.fetchPage(requestedUrl).then(({ links, prevUrl }) => {
      if (links.length === 0) throw new Error('Fetched page has no images');
      const prevCount = links.length;
      deps.onLoadPrevPage(links, prevUrl === requestedUrl ? null : prevUrl ?? null);

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

  function open(startIdx?: number): void {
    // Guard against a second open() while already active (e.g. the
    // autoEnterSinglePage timer firing after a manual open) — a second PhotoSwipe
    // built over the live one would orphan the first instance.
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

    overflowSnapshot = {
      documentElement: document.documentElement.style.overflow,
      body: document.body.style.overflow,
    };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    store.emit('readerModeChanged');

    if (store.settings.scrollMode) {
      pauseLazyLoad();
      // Hide the waterfall during reader open so the scroll-to-top can't flash first
      // images behind the overlay (visible on 18comic). Visibility (not display)
      // preserves geometry for the close() scrollIntoView.
      document.documentElement.classList.add('hr-reader-open');
    }

    // Re-open at the same index would skip centering (lastCenteredIndex persists),
    // but the panel's scroll was reset on DOM detach — force it.
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
      document.removeEventListener('sp-image-loaded', handleImageLoaded);
    });

    // PhotoSwipe's vertical-drag-to-close only fires when currZoomLevel <= fit.
    // But fit is clamped at 1, while our initialZoomLevel magnifies small images
    // (e.g. e-hentai's 614×900 → 750×1099, ~1.22x), making initial > fit and
    // disabling the gesture. Lift fit to initial so the filled state counts as fit.
    pswp.on('zoomLevelsUpdate', (e: any) => {
      const zl = e.zoomLevels;
      if (zl.initial > zl.fit) zl.fit = zl.initial;
    });

    // A placeholder can be upgraded to a real <img> outside the overlay's own
    // itemData chain (thumbnail-panel-triggered load, scroll-mode lazy-load). When
    // that happens for a slide PhotoSwipe already built, refresh it so the resolved
    // image shows instead of a stale empty/loading slide.
    function handleImageLoaded(e: Event): void {
      const customEvent = e as CustomEvent<{ index: number; element: HTMLElement }>;
      const { index } = customEvent.detail;
      if (pswp && index >= 0 && index < store.allImages.length) {
        pswp.refreshSlideContent(index);
      }
    }
    document.addEventListener('sp-image-loaded', handleImageLoaded);

    const fetchingState = new Map<string, 'resolving' | 'downloading'>();

    // PhotoSwipe drives the *displayed* <img>, which has its own load lifecycle
    // independent of our resolve/probe chain. Once resolve completes we clear
    // fetchingState, but PhotoSwipe's own byte download (the big WebP) is still in
    // flight — the slide paints half-drawn or black meanwhile. byteState tracks
    // that real load state so both the HUD and the wheel speed-bump reflect what's
    // actually on screen, not just our upstream resolve. Keyed by viewer URL.
    const byteState = new Map<string, 'loading' | 'loaded' | 'error'>();

    const urlForContent = (content: any): string | undefined => {
      const idx = content?.index;
      const el = idx != null ? store.allImages[idx] : undefined;
      return el ? (el.dataset.url || el.dataset.viewerUrl) : undefined;
    };

    // Single source of truth for an image's load progress, derived from the same
    // state both consumers used to inspect independently: our resolve tracker
    // (fetchingState), PhotoSwipe's byte-load lifecycle (byteState), and its slide
    // content state. Two thin consumers read this instead of each re-deriving the
    // phase: refreshHudForCurrent maps it to HUD text; isPageLoading maps it to the
    // wheel speed-bump boolean. Add a phase here and both update in lockstep.
    type ImagePhase = 'resolving' | 'downloading' | 'loaded' | 'error';
    function imagePhase(url: string, index: number): ImagePhase {
      if (byteState.get(url) === 'error') return 'error';
      // Still waiting on the resolve step (adapter.resolveImage), before any bytes.
      if (fetchingState.get(url) === 'resolving') return 'resolving';
      // Resolved: gauge the *displayed* <img> — PhotoSwipe's own content state is
      // authoritative once it has a slide for this index; byteState covers the
      // reader's own probe load. Either reaching 'loaded' means it's painted.
      const slide = (pswp as any)?.slides?.[index] ?? (pswp as any)?.getSlideByIndex?.(index);
      if (byteState.get(url) === 'loaded' || slide?.content?.state === 'loaded') return 'loaded';
      return 'downloading';
    }

    // Error HUD is persistent (no auto-hide) until the user navigates away or a
    // retry succeeds — a re-derivation on 'change'/loadComplete clears it.
    function refreshHudForCurrent(): void {
      if (!pswp) return;
      const el = store.allImages[pswp.currIndex];
      const url = el?.dataset.url || el?.dataset.viewerUrl;
      if (!url) { hud.hide(); return; }
      switch (imagePhase(url, pswp.currIndex)) {
        case 'error': hud.show({ status: 'error', text: i18n.loadFailed }); break;
        case 'resolving': hud.show({ status: 'loading', text: i18n.resolvingImage }); break;
        case 'downloading': hud.show({ status: 'loading', text: i18n.downloading }); break;
        case 'loaded': hud.hide(); break;
      }
    }

    // Mirror PhotoSwipe's own image load lifecycle into byteState.
    pswp.on('contentLoadImage', (e: any) => {
      const url = urlForContent(e.content);
      if (url && byteState.get(url) !== 'loaded') byteState.set(url, 'loading');
    });
    pswp.on('loadComplete', (e: any) => {
      const url = urlForContent(e.content);
      if (!url) return;
      byteState.set(url, e.isError ? 'error' : 'loaded');
      if (pswp && store.allImages[pswp.currIndex] &&
          (store.allImages[pswp.currIndex].dataset.url || store.allImages[pswp.currIndex].dataset.viewerUrl) === url) {
        refreshHudForCurrent();
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

      // No msrc for sprite-sheet thumbs (thumbX set): PhotoSwipe can't crop one
      // cell, so it would stretch the whole strip across the slide.
      const msrc = el.dataset.thumbX !== undefined ? undefined : el.dataset.thumb;

      if (resolvedSrc && resolvedSrc.indexOf('x.gif') === -1 && trueDimKnown) {
        e.itemData = {
          src: resolvedSrc,
          msrc, // low res (omitted for sprite-sheet thumbs)
          w: dim.w,
          h: dim.h,
        } as any;
      } else {
        // Scroll mode: if the waterfall already made a real <img>, reuse its
        // byte-load chain (which has its own retry ladder + fires sp-image-loaded)
        // rather than starting a second one — two chains doubled the retry storm
        // into the node's abuse limits. Placeholders / non-scroll fall through to
        // the reader's own fetch.
        const isWaterfallImage = store.settings.scrollMode && el.tagName === 'IMG';

        e.itemData = {
          src: '', // Empty src triggers loading state
          msrc,
          w: dim.w,
          h: dim.h,
        } as any;

        if (!isWaterfallImage && !fetchingState.has(viewerUrl) && viewerUrl) {
          fetchingState.set(viewerUrl, 'resolving');
          if (pswp && pswp.currIndex === e.index) refreshHudForCurrent();
          // Closer to the current index = higher priority (current slide first).
          const distance = pswp ? Math.abs(e.index - pswp.currIndex) : 0;
          const priority = LOAD_PRIORITY.foreground - distance;
          // myPswp pins this instance (close+reopen swaps pswp); findLive re-locates
          // the slide by URL since loadPrevPage prepends and shifts every index.
          const myPswp = pswp;
          const findLive = () => store.allImages.findIndex(im => (im.dataset.url || im.dataset.viewerUrl) === viewerUrl);
          resolveImageWithRetry(viewerUrl, { priority }).then(res => {
            if (!myPswp || myPswp !== pswp) { fetchingState.delete(viewerUrl); return; }
            if (res && res.src) {
              fetchingState.delete(viewerUrl);
              // Resolve done; PhotoSwipe's own <img> now downloads the bytes.
              // byteState + contentLoadImage/loadComplete drive the HUD from here.
              byteState.set(viewerUrl, 'loading');
              if (myPswp.currIndex === findLive()) refreshHudForCurrent();

              const failHud = () => {
                if (!myPswp || myPswp !== pswp) return;
                byteState.set(viewerUrl, 'error');
                if (myPswp.currIndex === findLive()) refreshHudForCurrent();
              };

              const img = new Image();
              img.decoding = 'async';
              img.onload = () => {
                store.imageDimensions.set(viewerUrl, { w: img.naturalWidth, h: img.naturalHeight });
                if (!myPswp || myPswp !== pswp) return;
                const idx = findLive();
                if (idx === -1) return;
                byteState.set(viewerUrl, 'loaded');
                if (myPswp.currIndex === idx) refreshHudForCurrent();
                myPswp.refreshSlideContent(idx);
                if (myPswp.currIndex === idx && store.autoPlay) {
                  autoPlay.start();
                }
              };
              // Byte-load retry: node-switch via nl token (e-hentai dead node),
              // then plain same-URL retry (CDN sites). Shared with scroll mode.
              attachImageRetry(img, {
                viewerUrl,
                nl: res.nl,
                priority,
                shouldContinue: () => myPswp === pswp,
                onRetry: () => {
                  if (!myPswp || myPswp !== pswp) return;
                  byteState.set(viewerUrl, 'loading');
                  if (myPswp.currIndex === findLive()) refreshHudForCurrent();
                },
                onFail: failHud,
              });
              img.src = res.src;
            } else {
              fetchingState.delete(viewerUrl);
              byteState.set(viewerUrl, 'error');
              if (myPswp && myPswp === pswp && myPswp.currIndex === findLive()) refreshHudForCurrent();
            }
          }).catch(() => {
             fetchingState.delete(viewerUrl);
             if (!myPswp || myPswp !== pswp) return;
             byteState.set(viewerUrl, 'error');
             if (myPswp.currIndex === findLive()) refreshHudForCurrent();
          });
        }
      }
    });

    const wheelPager = createWheelPager({
      getPswp: () => pswp,
      getImageCount: () => store.allImages.length,
      isPageLoading: (index) => {
        const el = store.allImages[index];
        const url = el?.dataset.url || el?.dataset.viewerUrl;
        if (!url || index < 0 || index >= store.allImages.length) return false;
        // Speed-bump only while genuinely in flight; terminal states (loaded/error) pass.
        const phase = imagePhase(url, index);
        return phase === 'resolving' || phase === 'downloading';
      },
      onEdgeForward: () => { if (store.nextUrl && !store.isFetching) loadNextPage(); },
      onEdgeBackward: () => { if (store.prevUrl && !store.isFetching) loadPrevPage(); },
    });
    pswp.on('destroy', () => wheelPager.stop());
    pswp.on('wheel', (e) => wheelPager.onWheel(e));

    pswp.on('change', () => {
      if (isReinitializing) {
        return;
      }
      if (pswp) {
        store.currentImageIndex = pswp.currIndex;
        sidebar.update();
        checkAndLoadNextPage();

        refreshHudForCurrent();

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

        // Byte-prefetch a small window in the travel direction (and release
        // downloads left behind, including everything skipped by a panel jump).
        prefetch.setWindow(pswp.currIndex, isNavigatingBackwards ? -1 : 1);
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
            const updateCounter = () => {
              el.innerHTML = `${store.imageOffset + pswpInstance.currIndex + 1} / ${store.imageOffset + store.allImages.length}`;
            };
            updateCounter();
            pswpInstance.on('change', updateCounter);
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

    // Seed the prefetch window on the opening image (no `change` fires on init),
    // so the next few pages start downloading during the first dwell.
    prefetch.setWindow(startIndex, 1);
  }

  function close(): void {
    autoPlay.stop();
    store.autoPlay = false;
    isActive = false;

    prefetch.clear();

    if (overflowSnapshot) {
      document.documentElement.style.overflow = overflowSnapshot.documentElement;
      document.body.style.overflow = overflowSnapshot.body;
      overflowSnapshot = null;
    }

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
      // Reveal the waterfall again (hidden on open to prevent the scroll-to-top flash).
      document.documentElement.classList.remove('hr-reader-open');

      // Reader is closing back into the live waterfall — resume lazy-load so
      // scrolling past the current position loads images again. disconnect()
      // cleared the watch list, so this re-observes every still-pending placeholder.
      resumeLazyLoad();

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

  function warmupInitial(count: number): void {
    if (isActive) return;  // already open, warmup is redundant
    // Seed store.allImages from the DOM so the prefetch controller can resolve
    // indices → URLs. This matches open()'s logic, which re-reads anyway.
    store.allImages = Array.from(qa('.r-img, .r-ph')) as HTMLElement[];
    if (store.allImages.length === 0) return;
    const indices: number[] = [];
    for (let i = 0; i < Math.min(count, store.allImages.length); i++) {
      indices.push(i);
    }
    prefetch.warmup(indices);
  }

  return {
    open,
    close,
    isActive: () => isActive,
    warmupInitial,
  };
}
