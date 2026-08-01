interface PhotoSwipeSlideLike {
  container?: HTMLElement | null;
  destroy(): void;
}

/**
 * PhotoSwipe expects every item holder to own exactly one zoom wrapper. Keep
 * that invariant even when a forced content remap loses the previous Slide
 * reference before PhotoSwipe has removed its container.
 */
export function reconcilePhotoSwipeHolder(
  holderElement: HTMLElement | null | undefined,
  activeSlide: PhotoSwipeSlideLike | null | undefined,
  previousSlide?: PhotoSwipeSlideLike,
): void {
  const activeContainer = activeSlide?.container;
  if (!holderElement || !activeContainer) return;

  const previousContainer = previousSlide?.container;
  if (previousSlide
      && previousSlide !== activeSlide
      && previousContainer?.parentElement === holderElement) {
    previousSlide.destroy();
  }

  for (const child of Array.from(holderElement.children)) {
    if (child !== activeContainer && child.classList.contains('pswp__zoom-wrap')) {
      child.remove();
    }
  }
}
