export interface ReaderInputCapabilities {
  readonly touchOnlyUi: boolean;
}

/**
 * Classifies the Reader's interaction mode by capabilities, not by Touch
 * Events support. Hybrid desktops may expose touch APIs while a mouse remains
 * the primary way to reveal hover controls.
 */
export function getReaderInputCapabilities(
  matches: (query: string) => boolean = query => window.matchMedia(query).matches,
  maxTouchPoints = navigator.maxTouchPoints,
): ReaderInputCapabilities {
  const hasHoveringFinePointer =
    matches('(hover: hover) and (pointer: fine)')
    || matches('(any-hover: hover) and (any-pointer: fine)');
  const hasCoarsePointer =
    matches('(pointer: coarse)')
    || matches('(any-pointer: coarse)')
    || maxTouchPoints > 0;

  return { touchOnlyUi: !hasHoveringFinePointer && hasCoarsePointer };
}
