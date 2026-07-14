export interface KnownImageGeometry {
  width: number;
  height: number;
}

export interface ScrollRestoreRequest {
  entryScrollY: number;
  target?: {
    key: string;
    index: number;
    preferred?: HTMLElement;
  };
  nearbyGeometry?: ReadonlyArray<{
    key: string;
    index: number;
    preferred?: HTMLElement;
    width: number;
    height: number;
  }>;
}

function validGeometry(geometry: KnownImageGeometry): boolean {
  return Number.isFinite(geometry.width)
    && Number.isFinite(geometry.height)
    && geometry.width > 0
    && geometry.height > 0;
}

/** Match Reader state back to its live scroll placeholder/image without a registry. */
export function findScrollItem(
  itemKey: string,
  fallbackIndex: number,
  preferred?: HTMLElement,
): HTMLElement | null {
  if (preferred?.isConnected && (
    preferred.dataset.itemKey === itemKey
    || preferred.dataset.viewerUrl === itemKey
    || preferred.dataset.url === itemKey
  )) {
    return preferred;
  }

  const items = Array.from(document.querySelectorAll<HTMLElement>('.r-img, .r-ph'));
  return items.find(element =>
    element.dataset.itemKey === itemKey
    || element.dataset.viewerUrl === itemKey
    || element.dataset.url === itemKey,
  ) ?? items[fallbackIndex] ?? null;
}

/** Make one placeholder/img use the already-known final image geometry. */
export function applyKnownImageGeometry(
  element: HTMLElement,
  geometry: KnownImageGeometry,
): boolean {
  if (!validGeometry(geometry)) return false;
  const width = Math.round(geometry.width);
  const height = Math.round(geometry.height);
  element.style.aspectRatio = `${width} / ${height}`;
  element.style.width = '100%';
  element.style.maxWidth = `${width}px`;
  element.style.height = 'auto';
  if (element.classList.contains('r-ph')) {
    element.style.minHeight = '0';
    element.style.marginBottom = '20px';
  }
  return true;
}

/** Run one direct document jump even when a host site enables smooth scrolling. */
function withInstantDocumentScroll(action: () => void): void {
  const rootBehavior = document.documentElement.style.scrollBehavior;
  const bodyBehavior = document.body.style.scrollBehavior;
  const alreadyForced = document.documentElement.classList.contains('hr-instant-scroll');
  document.documentElement.classList.add('hr-instant-scroll');
  document.documentElement.style.scrollBehavior = 'auto';
  document.body.style.scrollBehavior = 'auto';
  try {
    action();
  } finally {
    document.documentElement.style.scrollBehavior = rootBehavior;
    document.body.style.scrollBehavior = bodyBehavior;
    if (!alreadyForced) document.documentElement.classList.remove('hr-instant-scroll');
  }
}

export function restoreDocumentScroll(top: number): void {
  if (!Number.isFinite(top) || Math.abs(window.scrollY - top) < 2) return;
  withInstantDocumentScroll(() => window.scrollTo({ top, behavior: 'auto' }));
}

export function isScrollItemCentered(target: HTMLElement, tolerance = 2): boolean {
  const rect = target.getBoundingClientRect();
  const centeredTop = (window.innerHeight - rect.height) / 2;
  return Math.abs(rect.top - centeredTop) < tolerance;
}

export function jumpToScrollItem(target: HTMLElement): void {
  if (!target.isConnected) return;
  const rect = target.getBoundingClientRect();
  const top = window.scrollY + rect.top - (window.innerHeight - rect.height) / 2;
  withInstantDocumentScroll(() => window.scrollTo({
    top: Math.max(0, top),
    behavior: 'auto',
  }));
}

/** Restore Reader state with at most one synchronous document scroll write. */
export function restoreReaderScroll(request: ScrollRestoreRequest): void {
  for (const geometry of request.nearbyGeometry ?? []) {
    const element = findScrollItem(geometry.key, geometry.index, geometry.preferred);
    if (element) applyKnownImageGeometry(element, geometry);
  }

  if (!request.target) {
    restoreDocumentScroll(request.entryScrollY);
    return;
  }

  const target = findScrollItem(
    request.target.key,
    request.target.index,
    request.target.preferred,
  );
  if (target && !isScrollItemCentered(target)) jumpToScrollItem(target);
}
