export interface ScrollImageLoadedEvent {
  index: number;
  element: HTMLElement;
  viewerUrl: string;
}

type ScrollImageLoadedListener = (event: ScrollImageLoadedEvent) => void;

const imageLoadedListeners = new Set<ScrollImageLoadedListener>();

export function notifyScrollImageLoaded(event: ScrollImageLoadedEvent): void {
  imageLoadedListeners.forEach(listener => listener(event));
}

export function subscribeScrollImageLoaded(listener: ScrollImageLoadedListener): () => void {
  imageLoadedListeners.add(listener);
  return () => imageLoadedListeners.delete(listener);
}

