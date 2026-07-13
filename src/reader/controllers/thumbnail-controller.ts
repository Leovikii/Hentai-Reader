import type { ReaderScrollBridge } from '../contracts';
import type { ReaderSession } from '../reader-session';

export interface ThumbnailController {
  requestFallback(index: number): void;
  subscribeImageLoaded(listener: (index: number) => void): () => void;
}

/** Bridges thumbnail requests to shared loading without exposing scroll internals to UI. */
export function createThumbnailController(
  session: ReaderSession,
  scroll: ReaderScrollBridge,
): ThumbnailController {
  return {
    requestFallback(index) {
      const element = session.elementAt(index);
      if (element?.classList.contains('r-ph') && element.dataset.isFetching !== 'true') {
        scroll.requestImage(element);
      }
    },
    subscribeImageLoaded(listener) {
      return scroll.subscribeImageLoaded(event => listener(event.index));
    },
  };
}
