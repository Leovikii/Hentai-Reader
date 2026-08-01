import './shell/reader.css';
import type { GalleryPage } from '../core/gallery';
import type { GalleryPageLoader } from '../core/gallery-page-loader';
import { createPrefetchController } from './controllers/prefetch-controller';
import { createWheelPager } from './controllers/wheel-pager';
import { createAutoPlay } from './controllers/auto-play-controller';
import { i18n } from '../utils/i18n';
import { createReaderPaginationController, type ReaderPaginationController } from './controllers/pagination-controller';
import { createReaderImageController, type ReaderImagePhase } from './controllers/image-controller';
import type {
  ReaderAppContext,
  ReaderDriver,
  ReaderDriverFactory,
  ReaderHandle,
  ReaderScrollBridge,
  ScreenPoint,
} from './contracts';
import { createReaderShell } from './shell/reader-shell';
import { ReaderSession } from './reader-session';
import { createThumbnailController } from './controllers/thumbnail-controller';
import { acquireImage, getCachedImage } from '../services/image-load-runtime';
import { LOAD_PRIORITY } from '../state/load-policy';
import type { ReaderPrefetchPolicy } from '../core/site-adapter';
import {
  createSpreadLayout,
  formatSpreadCounter,
  type ReaderSpread,
  type SpreadLayout,
  type SpreadPage,
} from './controllers/spread-layout';

export interface ReaderControllerDeps {
  pageLoader: GalleryPageLoader;
  onLoadNextPage: (page: GalleryPage) => void;
  onLoadPrevPage: (page: GalleryPage) => void;
  createDriver: ReaderDriverFactory;
  scroll: ReaderScrollBridge;
  context: ReaderAppContext;
  prefetchPolicy?: ReaderPrefetchPolicy;
}

const RETURN_GEOMETRY_RADIUS = 5;

export function createReaderController(deps: ReaderControllerDeps): ReaderHandle {
  let pswp: ReaderDriver | null = null;
  let isActive = false;
  let isReinitializing = false;
  let overflowSnapshot: { documentElement: string; body: string } | null = null;
  const session = new ReaderSession(deps.context.getGalleryItems);
  let spreadLayout: SpreadLayout = createSpreadLayout([], { width: 1, height: 1 }, false);
  let onMobileInteractionStart = () => {};
  let onMobileInteractionEnd = () => {};
  let entryScrollY = 0;
  let entryItemKey = '';
  let refreshActiveLayout = () => {};
  const failedLogicalIndices = new Set<number>();

  function itemKeyAt(index: number): string {
    const element = session.elementAt(index);
    return session.itemAt(index)?.key
      || element?.dataset.itemKey
      || element?.dataset.viewerUrl
      || element?.dataset.url
      || '';
  }

  function spreadPages(): SpreadPage[] {
    return Array.from({ length: session.imageCount }, (_, index) => {
      const item = session.itemAt(index);
      const element = session.elementAt(index);
      const cached = item && getCachedImage(item.viewerUrl);
      let width = cached?.width ?? item?.dimensions?.width;
      let height = cached?.height ?? item?.dimensions?.height;
      const previewSize = item?.preview.kind === 'url'
        ? item.preview.size
        : item?.preview.kind === 'sprite'
          ? item.preview.crop
          : undefined;
      if ((!width || !height) && previewSize?.width && previewSize.height) {
        width = previewSize.width;
        height = previewSize.height;
      }
      if ((!width || !height) && element?.tagName === 'IMG') {
        const image = element as HTMLImageElement;
        if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
          width = image.naturalWidth;
          height = image.naturalHeight;
        }
      }
      return {
        key: itemKeyAt(index) || `logical:${index}`,
        width,
        height,
        failed: failedLogicalIndices.has(index),
      };
    });
  }

  function calculateSpreadLayout(preferredLogicalIndex = session.currentIndex): SpreadLayout {
    return createSpreadLayout(
      spreadPages(),
      { width: window.innerWidth, height: window.innerHeight, gutter: 20 },
      deps.context.isDoublePageModeEnabled(),
      itemKeyAt(preferredLogicalIndex),
    );
  }

  function currentSpread(): ReaderSpread | undefined {
    return pswp ? spreadLayout.spreads[pswp.currentIndex] : undefined;
  }

  function activeLogicalIndices(): readonly number[] {
    return currentSpread()?.logicalIndices ?? [session.currentIndex];
  }

  // Sync the reader session with the live scroll placeholders/images.
  function syncImages(): void {
    const freshImages = Array.from(document.querySelectorAll('.r-img, .r-ph')) as HTMLElement[];
    if (session.syncImages(freshImages)) {
      spreadLayout = calculateSpreadLayout();
      shell.update();
      if (pswp) {
        // Rebuild current + neighbour holders: a page-count growth can leave a
        // pre-built empty holder that goTo would otherwise slide in as undefined.
        const c = pswp.currentIndex;
        for (let i = c - 1; i <= c + 1; i++) {
          if (i >= 0 && i < spreadLayout.spreads.length) pswp.refreshSlide(i);
        }
      }
    }
  }

  const prefetch = createPrefetchController(session, deps.prefetchPolicy);
  const thumbnailController = createThumbnailController(session, deps.scroll, {
    acquire: acquireImage,
    priority: LOAD_PRIORITY.thumbnail,
  });
  const autoPlay = createAutoPlay(() => pswp?.next(), deps.context);
  let pagination: ReaderPaginationController;
  const shell = createReaderShell({
    onIndexChange: index => {
      session.setCurrentIndex(index);
      spreadLayout = spreadLayout.withPrimaryLogical(index);
      pswp?.goTo(spreadLayout.spreadIndexForLogical(index));
      autoPlay.reset();
    },
    onScrollToBottom: () => pagination.loadNext(),
    onScrollToTop: () => pagination.loadPrev(),
    onMobileInteractionStart: () => onMobileInteractionStart(),
    onMobileInteractionEnd: () => onMobileInteractionEnd(),
    thumbnailController,
    getImageCount: () => session.imageCount,
    getCurrentIndex: () => session.currentIndex,
    getImageAt: index => session.elementAt(index),
    getItemAt: index => session.itemAt(index),
    getDisplayNumber: index => deps.context.getImageOffset() + index + 1,
    getThumbnailPosition: deps.context.getThumbnailPosition,
    subscribeSettingsChanged: deps.context.subscribeSettingsChanged,
  });

  pagination = createReaderPaginationController(session, {
    pageLoader: deps.pageLoader,
    appendPage: deps.onLoadNextPage,
    prependPage: deps.onLoadPrevPage,
    syncImages,
    afterPrepend: itemCount => {
      isReinitializing = true;
      session.prepend(itemCount);
      spreadLayout = calculateSpreadLayout(session.currentIndex);
      deps.context.setImageOffset(Math.max(0, deps.context.getImageOffset() - itemCount));
      if (pswp) {
        pswp.stopMotion();
        pswp.goTo(spreadLayout.spreadIndexForLogical(session.currentIndex));
      }
      isReinitializing = false;
    },
    onPageAdded: direction => {
      prefetch.setWindow(session.currentIndex, direction === 'next' ? 1 : -1);
    },
    onLoading: () => shell.showStatus({ status: 'loading', text: i18n.downloading }),
    onIdle: () => shell.hideStatus(),
    onError: () => shell.showStatus({ status: 'error', text: i18n.loadFailed }),
  }, deps.context);

  function open(startIdx?: number): void {
    // Guard against a second open() while already active (e.g. the
    // autoEnterSinglePage timer firing after a manual open) — a second PhotoSwipe
    // built over the live one would orphan the first instance.
    if (isActive) return;

    session.syncImages(Array.from(document.querySelectorAll('.r-img, .r-ph')) as HTMLElement[]);
    if (session.imageCount === 0) {
      alert(i18n.waitImagesToLoad);
      return;
    }

    let startIndex = startIdx ?? 0;
    
    // Calculate start index only if not provided explicitly
    if (startIdx === undefined) {
      if (deps.context.isScrollMode()) {
        let minDistance = Infinity;
      session.snapshotImages().forEach((img, index) => {
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
        startIndex = session.currentIndex;
      }
    }

    entryScrollY = window.scrollY;
    entryItemKey = itemKeyAt(startIndex);
    session.reset(startIndex);
    spreadLayout = calculateSpreadLayout(startIndex);
    isActive = true;

    overflowSnapshot = {
      documentElement: document.documentElement.style.overflow,
      body: document.body.style.overflow,
    };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    deps.context.emitReaderModeChanged();

    if (deps.context.isScrollMode()) {
      deps.scroll.pause();
      // Hide the waterfall during reader open so the scroll-to-top can't flash first
      // images behind the overlay (visible on 18comic). Visibility (not display)
      // preserves geometry for close-time scroll restoration.
      document.documentElement.classList.add('hr-reader-open');
    }

    // Re-open at the same index would skip centering (lastCenteredIndex persists),
    // but the panel's scroll was reset on DOM detach — force it.
    shell.resetCentering();

    try {
      initPhotoSwipe(spreadLayout.spreadIndexForLogical(startIndex));
    } catch (error) {
      console.error('[Hentai-Reader] Reader initialization failed', error);
      prefetch.clear();
      isActive = false;
      if (pswp) {
        const failedDriver = pswp;
        pswp = null;
        try { failedDriver.destroy(); } catch {}
      }
      if (overflowSnapshot) {
        document.documentElement.style.overflow = overflowSnapshot.documentElement;
        document.body.style.overflow = overflowSnapshot.body;
        overflowSnapshot = null;
      }
      document.documentElement.classList.remove('hr-reader-open');
      if (deps.context.isScrollMode()) deps.scroll.resume();
      deps.context.emitReaderModeChanged();
      return;
    }

    if (deps.context.isAutoPlayEnabled()) {
      autoPlay.start();
    }
  }

  function initPhotoSwipe(startSpreadIndex: number) {
    let mobileUiTimeout: ReturnType<typeof setTimeout>;
    function triggerMobileUITimeout() {
      const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      if (!isTouchDevice) return;
      clearTimeout(mobileUiTimeout);
      mobileUiTimeout = setTimeout(() => {
        pswp?.hideUi();
      }, 2000);
    }

    function cancelMobileUITimeout() {
      clearTimeout(mobileUiTimeout);
    }

    onMobileInteractionStart = cancelMobileUITimeout;
    onMobileInteractionEnd = triggerMobileUITimeout;

    function handleScreenClick(point: ScreenPoint, defaultCenterAction: 'zoom' | 'toggle') {
      const width = window.innerWidth;
      if (point.x < width * 0.3) {
         if (pswp?.currentIndex === 0 && deps.context.getPrevUrl() && !deps.context.isPageFetching()) {
            pagination.loadPrev();
         } else {
            pswp?.prev();
         }
      } else if (point.x > width * 0.7) {
         if (pswp?.currentIndex === spreadLayout.spreads.length - 1 && deps.context.getNextUrl() && !deps.context.isPageFetching()) {
            pagination.loadNext();
         } else {
            pswp?.next();
         }
      } else {
         if (defaultCenterAction === 'zoom' && pswp?.canToggleCurrentZoom()) {
            pswp.toggleCurrentZoom(point);
         } else {
            const isNowVisible = pswp?.toggleUi();
            if (isNowVisible) triggerMobileUITimeout();
         }
      }
    }

    pswp = deps.createDriver({
      startIndex: startSpreadIndex,
      onBackgroundClick: point => handleScreenClick(point, 'toggle'),
      onImageClick: point => handleScreenClick(point, 'zoom'),
      onTap: point => handleScreenClick(point, 'toggle'),
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
    const unsubscribeImageLoaded = deps.scroll.subscribeImageLoaded(({ index, element }) => {
      session.replaceImage(index, element);
      if (pswp && index >= 0 && index < session.imageCount) {
        refreshSpreadLayout(session.currentIndex, index);
      }
    });
    pswp.on('destroy', () => {
      clearTimeout(mobileUiTimeout);
      onMobileInteractionStart = () => {};
      onMobileInteractionEnd = () => {};
      unsubscribeImageLoaded();
    });

    function showImagePhase(phase: ReaderImagePhase): void {
      switch (phase) {
        case 'error': shell.showStatus({ status: 'error', text: i18n.loadFailed }); break;
        case 'resolving': shell.showStatus({ status: 'loading', text: i18n.resolvingImage }); break;
        case 'switching-source': shell.showStatus({ status: 'loading', text: i18n.switchingImageSource }); break;
        case 'downloading': shell.showStatus({ status: 'loading', text: i18n.downloading }); break;
        case 'loaded': shell.hideStatus(); break;
      }
    }

    const imageController = createReaderImageController(session, {
      getCurrentIndex: () => session.currentIndex,
      getActiveIndices: activeLogicalIndices,
      getSlideContentState: index => pswp?.getSlideContentState(spreadLayout.spreadIndexForLogical(index)),
      refreshSlide: index => pswp?.refreshSlide(spreadLayout.spreadIndexForLogical(index)),
      onPhaseChange: (index, phase) => {
        const wasFailed = failedLogicalIndices.has(index);
        if (phase === 'error') failedLogicalIndices.add(index);
        else if (phase === 'loaded') failedLogicalIndices.delete(index);
        if (wasFailed !== failedLogicalIndices.has(index)) refreshActiveLayout();
        if (activeLogicalIndices().includes(index)) showImagePhase(phase);
      },
      onAssetReady: index => {
        refreshSpreadLayout(session.currentIndex, index);
        if (activeLogicalIndices().includes(index)
            && deps.context.isAutoPlayEnabled()
            && pswp?.isCurrentContentLoaded()) autoPlay.start();
      },
    });

    let resizeRaf = 0;
    let deferredLayoutRaf = 0;
    function refreshSpreadLayout(
      preferredLogicalIndex = session.currentIndex,
      refreshLogicalIndex = preferredLogicalIndex,
    ): void {
      if (!pswp) return;
      const previousKeys = spreadLayout.spreads.map(spread => spread.key).join('|');
      const next = calculateSpreadLayout(preferredLogicalIndex);
      const nextKeys = next.spreads.map(spread => spread.key).join('|');
      if (previousKeys !== nextKeys && pswp.isInteracting()) {
        cancelAnimationFrame(deferredLayoutRaf);
        deferredLayoutRaf = requestAnimationFrame(() => {
          deferredLayoutRaf = 0;
          refreshSpreadLayout(preferredLogicalIndex, refreshLogicalIndex);
        });
        return;
      }
      spreadLayout = next;
      const targetSpread = spreadLayout.spreadIndexForLogical(preferredLogicalIndex);
      if (targetSpread < 0) return;
      if (previousKeys !== nextKeys) {
        // Keep the PhotoSwipe root, shell, listeners, gestures and current
        // pixels alive. The driver remaps its three holders atomically and
        // patches compatible spread DOM in place, avoiding a full-screen flash.
        isReinitializing = true;
        session.setCurrentIndex(preferredLogicalIndex, false);
        pswp.syncLayout(targetSpread);
        isReinitializing = false;
        shell.update();
        return;
      }
      if (pswp.currentIndex !== targetSpread) {
        isReinitializing = true;
        pswp.stopMotion();
        pswp.goTo(targetSpread);
        shell.update();
        queueMicrotask(() => { isReinitializing = false; });
      } else {
        const refreshSpread = spreadLayout.spreadIndexForLogical(refreshLogicalIndex);
        if (refreshSpread >= 0) pswp.refreshSlide(refreshSpread);
      }
    }
    refreshActiveLayout = () => refreshSpreadLayout(session.currentIndex);

    const onResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => refreshSpreadLayout(session.currentIndex));
    };
    window.addEventListener('resize', onResize, { passive: true });

    function refreshHudForCurrent(): void {
      if (!pswp) return;
      const phases = activeLogicalIndices().map(index => imageController.getPhase(index));
      const phase = phases.includes('error')
        ? 'error'
        : phases.includes('resolving')
          ? 'resolving'
          : phases.includes('switching-source')
            ? 'switching-source'
            : phases.includes('downloading')
              ? 'downloading'
              : 'loaded';
      showImagePhase(phase);
    }

    pswp.on('destroy', () => {
      cancelAnimationFrame(resizeRaf);
      cancelAnimationFrame(deferredLayoutRaf);
      window.removeEventListener('resize', onResize);
      refreshActiveLayout = () => {};
      imageController.dispose();
    });
    pswp.on('contentLoadImage', (e: any) => {
      if (typeof e.content?.index === 'number') {
        const logicalIndex = spreadLayout.logicalIndexForSpread(e.content.index);
        if (logicalIndex >= 0) imageController.handleContentLoad(logicalIndex);
      }
    });
    pswp.on('loadComplete', (e: any) => {
      if (typeof e.content?.index === 'number') {
        const logicalIndex = spreadLayout.logicalIndexForSpread(e.content.index);
        if (logicalIndex >= 0) imageController.handleLoadComplete(logicalIndex, e.isError);
      }
    });

    pswp.on('numItems', (e) => {
      e.numItems = spreadLayout.spreads.length;
    });

    pswp.on('itemData', (e) => {
      const spread = spreadLayout.spreads[e.index];
      if (!spread) {
        e.itemData = { src: '', w: 1, h: 1 } as any;
      } else {
        // Use one stable HTML spread wrapper for both single and double pages.
        // A late second-page size/source can then be inserted without replacing
        // the current slide or flashing its already visible first image.
        e.itemData = imageController.getSpreadItemData(
          spread.logicalIndices,
          spread.width,
          spread.height,
        ) as any;
      }
    });

    const wheelPager = createWheelPager({
      getCurrentIndex: () => pswp?.currentIndex ?? 0,
      isCurrentZoomed: () => pswp?.isCurrentZoomed() ?? false,
      goTo: index => pswp?.goTo(index),
      stopMotion: () => pswp?.stopMotion(),
      getImageCount: () => spreadLayout.spreads.length,
      isPageLoading: index => spreadLayout.spreads[index]?.logicalIndices.some(logical => imageController.isLoading(logical)) ?? false,
      onEdgeForward: () => { if (deps.context.getNextUrl() && !deps.context.isPageFetching()) pagination.loadNext(); },
      onEdgeBackward: () => { if (deps.context.getPrevUrl() && !deps.context.isPageFetching()) pagination.loadPrev(); },
    });
    pswp.on('destroy', () => wheelPager.stop());

    pswp.on('change', () => {
      if (isReinitializing) {
        return;
      }
      if (pswp) {
        const previousIndex = session.currentIndex;
        const nextLogicalIndex = spreadLayout.logicalIndexForSpread(pswp.currentIndex);
        const isNavigatingBackwards = nextLogicalIndex < previousIndex;
        session.setCurrentIndex(nextLogicalIndex);
        shell.update();
        pagination.checkNearEnd();

        refreshHudForCurrent();

        // Only trigger prev page load if we are actively navigating backwards near the edge, 
        // or if we literally hit the absolute 0 index while trying to go back.
        if (session.currentIndex <= 3 && deps.context.getPrevUrl() && session.hasNavigated && isNavigatingBackwards) {
          pagination.loadPrev();
        }
        if (deps.context.isAutoPlayEnabled()) {
           autoPlay.stop();
           // Reached the last image with no further page to load — stop instead
           // of leaving the interval spinning on a no-op next().
           if (pswp.currentIndex >= spreadLayout.spreads.length - 1 && !deps.context.getNextUrl()) {
             autoPlay.stopAtEnd();
           } else {
             if (pswp.isCurrentContentLoaded()) {
               autoPlay.start();
             }
           }
        }

        // Byte-prefetch a small window in the travel direction (and release
        // downloads left behind, including everything skipped by a panel jump).
        prefetch.setWindow(session.currentIndex, isNavigatingBackwards ? -1 : 1);
        imageController.releaseOutside(session.currentIndex);
      }
    });

    pswp.on('uiRegister', () => {
      if (!pswp) return;
      const unmountShell = shell.mount(pswp, index =>
        formatSpreadCounter(spreadLayout.spreads[index], deps.context.getImageOffset(), session.imageCount),
      );
      const removeWheel = pswp.installWheel(event => wheelPager.onWheel(event));
      const removeEdgeSwipe = pswp.installEdgeSwipe({
        onBackward: () => {
          if (pswp?.currentIndex === 0 && deps.context.getPrevUrl() && !deps.context.isPageFetching()) {
            pagination.loadPrev();
          }
        },
        onForward: () => {
          if (pswp?.currentIndex === spreadLayout.spreads.length - 1
              && deps.context.getNextUrl() && !deps.context.isPageFetching()) {
            pagination.loadNext();
          }
        },
      });
      pswp.on('destroy', () => {
        removeWheel();
        removeEdgeSwipe();
        unmountShell();
      });
      triggerMobileUITimeout();
    });

    pswp.on('close', () => {
      if (!isReinitializing) close();
    });

    pswp.init();

    // Seed the prefetch window on the opening image (no `change` fires on init),
    // so the next few pages start downloading during the first dwell.
    prefetch.setWindow(session.currentIndex, 1);
  }

  function close(): void {
    autoPlay.stop();
    deps.context.setAutoPlayEnabled(false);
    isActive = false;

    prefetch.clear();

    if (overflowSnapshot) {
      document.documentElement.style.overflow = overflowSnapshot.documentElement;
      document.body.style.overflow = overflowSnapshot.body;
      overflowSnapshot = null;
    }

    if (deps.context.isScrollMode()) {
      const currentKey = itemKeyAt(session.currentIndex);
      const returnedToEntry = !!entryItemKey && currentKey === entryItemKey;
      if (session.hasNavigated && !returnedToEntry) {
        const item = session.itemAt(session.currentIndex);
        const key = item?.key || currentKey;
        const firstGeometryIndex = Math.max(0, session.currentIndex - RETURN_GEOMETRY_RADIUS);
        const lastGeometryIndex = Math.min(
          session.imageCount - 1,
          session.currentIndex + RETURN_GEOMETRY_RADIUS,
        );
        const nearbyGeometry = [];
        for (let index = firstGeometryIndex; index <= lastGeometryIndex; index++) {
          const nearbyItem = session.itemAt(index);
          const cachedAsset = nearbyItem && getCachedImage(nearbyItem.viewerUrl);
          if (!nearbyItem || !cachedAsset) continue;
          nearbyGeometry.push({
            key: nearbyItem.key,
            index,
            preferred: session.elementAt(index),
            width: cachedAsset.width,
            height: cachedAsset.height,
          });
        }
        deps.scroll.restore({
          entryScrollY,
          nearbyGeometry,
          target: {
            key,
            index: session.currentIndex,
            preferred: session.elementAt(session.currentIndex),
          },
        });
      } else {
        deps.scroll.restore({ entryScrollY });
      }

      document.documentElement.classList.remove('hr-reader-open');
      deps.scroll.resume();
    }

    if (pswp) {
      const p = pswp;
      pswp = null;
      try {
        p.destroy();
      } catch (err) {
        console.error('[Hentai-Reader] Error destroying PhotoSwipe:', err);
      }
    }

    deps.context.emitReaderModeChanged();

    deps.context.onReaderClose(deps.context.getImageOffset() + session.currentIndex);
  }

  deps.context.subscribeSettingsChanged(() => {
    if (!isActive) return;
    refreshActiveLayout();
    if (deps.context.isAutoPlayEnabled()) {
       autoPlay.start();
    } else {
      autoPlay.stop();
    }
  });

  deps.context.subscribeReaderModeChanged(() => {
    if (!isActive || !pswp) return;
    const el = document.querySelector('.pswp__counter');
    if (el) {
      el.innerHTML = formatSpreadCounter(currentSpread(), deps.context.getImageOffset(), session.imageCount);
    }
  });

  function warmupInitial(count: number): void {
    if (isActive) return;  // already open, warmup is redundant
    // Seed the session from the DOM so the prefetch controller can resolve
    // indices → URLs. This matches open()'s logic, which re-reads anyway.
    session.syncImages(Array.from(document.querySelectorAll('.r-img, .r-ph')) as HTMLElement[]);
    if (session.imageCount === 0) return;
    const indices: number[] = [];
    for (let i = 0; i < Math.min(count, session.imageCount); i++) {
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
