import type { GalleryPage } from '../../core/gallery';
import { EmptyGalleryPageError, type GalleryPageLoader } from '../../core/gallery-page-loader';
import type { ReaderAppContext } from '../contracts';
import type { ReaderSession } from '../reader-session';
import { READER_PREFETCH } from '../../state/load-policy';

export type PaginationDirection = 'next' | 'prev';

export interface ReaderPaginationControllerDeps {
  pageLoader: GalleryPageLoader;
  appendPage: (page: GalleryPage) => void;
  prependPage: (page: GalleryPage) => void;
  syncImages: () => void;
  afterPrepend: (itemCount: number) => void;
  onLoading: (direction: PaginationDirection) => void;
  onIdle: () => void;
  onError: (direction: PaginationDirection) => void;
  onPageAdded: (direction: PaginationDirection) => void;
}

export interface ReaderPaginationController {
  loadNext(): void;
  loadPrev(): void;
  checkNearEnd(): void;
}

export function createReaderPaginationController(
  session: ReaderSession,
  deps: ReaderPaginationControllerDeps,
  context: ReaderAppContext,
): ReaderPaginationController {
  function checkNearEnd(): void {
    if (!context.getNextUrl() || context.isPageFetching()) return;
    const remainingImages = session.imageCount - session.currentIndex;
    if (remainingImages <= READER_PREFETCH.ahead) loadNext();
  }

  function loadNext(): void {
    const requestedUrl = context.getNextUrl();
    if (!requestedUrl || context.isPageFetching()) return;
    let shouldContinue = false;
    context.setPageFetching(true);
    deps.onLoading('next');

    deps.pageLoader.loadPage(requestedUrl).then(page => {
      if (!page) {
        context.setNextUrl(null);
        deps.onIdle();
        return;
      }
      deps.appendPage(page);
      deps.syncImages();
      deps.onPageAdded('next');
      deps.onIdle();
      shouldContinue = true;
    }).catch(err => {
      if (err instanceof EmptyGalleryPageError) {
        context.setNextUrl(null);
        deps.onIdle();
        return;
      }
      console.error('[Single Page] Load failed', err);
      deps.onError('next');
    }).finally(() => {
      context.setPageFetching(false);
      if (shouldContinue) checkNearEnd();
    });
  }

  function loadPrev(): void {
    const requestedUrl = context.getPrevUrl();
    if (!requestedUrl || context.isPageFetching()) return;
    context.setPageFetching(true);
    deps.onLoading('prev');

    deps.pageLoader.loadPage(requestedUrl).then(page => {
      if (!page) {
        context.setPrevUrl(null);
        deps.onIdle();
        return;
      }
      deps.prependPage(page);
      deps.syncImages();
      deps.afterPrepend(page.items.length);
      deps.onPageAdded('prev');
      deps.onIdle();
    }).catch(err => {
      if (err instanceof EmptyGalleryPageError) {
        context.setPrevUrl(null);
        deps.onIdle();
        return;
      }
      console.error('[Single Page] Load prev failed', err);
      deps.onError('prev');
    }).finally(() => { context.setPageFetching(false); });
  }

  return { loadNext, loadPrev, checkNearEnd };
}
