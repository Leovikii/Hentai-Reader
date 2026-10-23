export interface ReaderInputCapabilities {
  readonly touchOnlyUi: boolean;
}

export function hasHoveringFinePointer(
  matches: (query: string) => boolean = query => window.matchMedia(query).matches,
): boolean {
  return matches('(hover: hover) and (pointer: fine)')
    || matches('(any-hover: hover) and (any-pointer: fine)');
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
  const fineHover = hasHoveringFinePointer(matches);
  const hasCoarsePointer =
    matches('(pointer: coarse)')
    || matches('(any-pointer: coarse)')
    || maxTouchPoints > 0;

  return { touchOnlyUi: !fineHover && hasCoarsePointer };
}
