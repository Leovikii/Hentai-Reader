interface PhotoSwipeSlideLike {
  container?: HTMLElement | null;
  destroy(): void;
}

export type SpreadMouseClickAction = 'image' | 'background' | null;

export function shouldHandleSpreadMouseClick(
  pointerType: string,
  defaultPrevented: boolean,
  button: number,
): boolean {
  return pointerType === 'mouse' && !defaultPrevented && button === 0;
}

/**
 * PhotoSwipe only classifies its own image and zoom-wrapper elements as click
 * targets. Reader spreads use custom DOM, so classify those mouse targets at
 * the driver boundary without teaching shared Reader code about PhotoSwipe.
 */
export function getSpreadMouseClickAction(
  target: Element | null,
  uiVisible: boolean,
): SpreadMouseClickAction {
  if (!target?.closest('[data-reader-spread]')) return null;
  if (!uiVisible) return 'background';
  return target.closest('img.hr-reader-spread__page') ? 'image' : 'background';
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
