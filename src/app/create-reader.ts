import { store } from '../state/store';
import { createPhotoSwipeDriver, createReaderController } from '../reader';
import {
  loadPlaceholderImage,
  pauseLazyLoad,
  processBatch,
  resumeLazyLoad,
} from '../scroll/scroll-controller';
import { subscribeScrollImageLoaded } from '../scroll/image-events';
import { restoreReaderScroll } from '../scroll/scroll-navigation';
import type { ReaderHandle } from '../reader/contracts';
import type { GalleryPageLoader } from '../core/gallery-page-loader';

export function createReader(pageLoader: GalleryPageLoader): ReaderHandle {
  const reader = createReaderController({
    pageLoader,
    createDriver: createPhotoSwipeDriver,
    scroll: {
      pause: pauseLazyLoad,
      resume: resumeLazyLoad,
      requestImage: loadPlaceholderImage,
      subscribeImageLoaded: subscribeScrollImageLoaded,
      restore: restoreReaderScroll,
    },
    context: {
      getGalleryItems: () => store.galleryItems,
      isScrollMode: () => store.settings.scrollMode,
      isAutoPlayEnabled: () => store.autoPlay,
      setAutoPlayEnabled: enabled => {
        if (store.autoPlay === enabled) return;
        store.autoPlay = enabled;
        store.emit('settingsChanged');
      },
      getAutoPlayInterval: () => store.settings.autoPlayInterval,
      getThumbnailPosition: () => store.settings.thumbnailPosition,
      getImageOffset: () => store.imageOffset,
      setImageOffset: offset => { store.imageOffset = offset; },
      getNextUrl: () => store.nextUrl,
      setNextUrl: url => { store.nextUrl = url; },
      getPrevUrl: () => store.prevUrl,
      setPrevUrl: url => { store.prevUrl = url; },
      isPageFetching: () => store.isFetching,
      setPageFetching: fetching => { store.isFetching = fetching; },
      subscribeSettingsChanged: listener => store.on('settingsChanged', listener),
      subscribeReaderModeChanged: listener => store.on('readerModeChanged', listener),
      emitReaderModeChanged: () => store.emit('readerModeChanged'),
      onReaderClose: globalIndex => store.activeAdapter?.onReaderClose?.(globalIndex, {
        scrollMode: store.settings.scrollMode,
        pageSize: store.perPage,
      }),
    },
    onLoadNextPage: (page) => {
      store.currPage++;
      processBatch(page.items, store.currPage, undefined, false, page.pageUrl);
      store.nextUrl = page.nextUrl;
    },
    onLoadPrevPage: (page) => {
      // Decrement so consecutive prev-page loads get distinct, correct P-labels
      // (symmetric with onLoadNextPage's currPage++); it's only a display label.
      store.currPage--;
      processBatch(page.items, store.currPage, undefined, true, page.pageUrl);
      store.prevUrl = page.prevUrl;
    },
  });

  return reader;
}
