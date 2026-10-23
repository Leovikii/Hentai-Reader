import type { GalleryItem } from '../core/gallery';
import type { GalleryHoverTarget } from '../core/site-adapter';
import type { ImageLoadPhase } from '../core/image';
import type { ImageLoadLease } from '../services/image-load-service';
import type { UserSettings } from '../state/types';
import { hasHoveringFinePointer } from '../utils/input-capabilities.ts';
import { i18n } from '../utils/i18n.ts';

export interface HoverPreviewTarget extends GalleryHoverTarget {
  item: GalleryItem;
}

export interface HoverPreviewOptions {
  getTarget: (target: Element) => HoverPreviewTarget | null;
  getMode: () => UserSettings['hoverPreviewMode'];
  isBlocked: () => boolean;
  acquire: (item: GalleryItem) => ImageLoadLease;
}

/** A single non-interactive preview; image tasks and assets belong to the shared service. */
export function createHoverPreview(options: HoverPreviewOptions) {
  let hovered: HoverPreviewTarget | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lease: ImageLoadLease | null = null;
  let root: HTMLElement | null = null;
  let pendingImage: HTMLImageElement | null = null;
  let generation = 0;
  const events = new AbortController();

  const enabled = () => options.getMode() !== 'off' && !options.isBlocked()
    && document.visibilityState !== 'hidden' && hasHoveringFinePointer();

  function dismiss(): void {
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    // Remove pixels before releasing an owned resource such as a Blob URL.
    root?.remove();
    root = null;
    if (pendingImage) {
      pendingImage.onload = pendingImage.onerror = null;
      pendingImage.removeAttribute('src');
      pendingImage = null;
    }
    lease?.release();
    lease = null;
  }

  function show(target: HoverPreviewTarget): void {
    if (!enabled() || !target.element.isConnected) return;
    const current = ++generation;
    let fullImageVisible = false;
    const panel = document.createElement('div');
    panel.className = `hr-hover-preview hr-hover-preview--${options.getMode()}`;
    panel.setAttribute('role', 'tooltip');
    panel.setAttribute('aria-label', i18n.hoverPreview);
    const picture = document.createElement('div');
    picture.className = 'hr-hover-preview__picture';
    const status = document.createElement('div');
    status.className = 'hr-hover-preview__status';
    status.textContent = i18n.waitingForNetwork;
    panel.append(picture, status);
    document.body.append(panel);
    root = panel;

    const isCurrent = () => generation === current && root === panel;
    const position = (width: number, height: number) => {
      if (!isCurrent()) return;
      const compact = options.getMode() === 'compact';
      const maxWidth = Math.min(window.innerWidth * 0.9, compact ? 520 : Infinity);
      const maxHeight = window.innerHeight * (compact ? 0.7 : 0.9);
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      const w = Math.max(1, width * ratio);
      const h = Math.max(1, height * ratio);
      let left = (window.innerWidth - w) / 2;
      let top = (window.innerHeight - h) / 2;
      if (compact) {
        const rect = target.element.getBoundingClientRect();
        left = rect.right + 16;
        if (left + w > window.innerWidth - 16) left = rect.left - w - 16;
        left = Math.max(16, Math.min(window.innerWidth - w - 16, left));
        top = Math.max(16, Math.min(window.innerHeight - h - 16, rect.top + (rect.height - h) / 2));
      }
      Object.assign(panel.style, { width: `${w}px`, height: `${h}px`, left: `${left}px`, top: `${top}px` });
    };

    // Cheap placeholders use the standardized descriptor, including sprite crops.
    const preview = target.item.preview;
    if (preview.kind === 'sprite') {
      const { crop } = preview;
      const sprite = document.createElement('div');
      sprite.className = 'hr-hover-preview__sprite';
      sprite.style.width = `${crop.width}px`;
      sprite.style.height = `${crop.height}px`;
      sprite.style.backgroundImage = `url(${JSON.stringify(preview.src)})`;
      sprite.style.backgroundPosition = `-${crop.x}px -${crop.y}px`;
      picture.append(sprite);
      position(crop.width, crop.height);
      sprite.style.transform = `scale(${parseFloat(panel.style.width) / crop.width})`;
    } else if (preview.kind === 'url') {
      const image = document.createElement('img');
      image.alt = '';
      image.onload = () => {
        if (!fullImageVisible && image.naturalWidth > 0) position(image.naturalWidth, image.naturalHeight);
      };
      picture.append(image);
      position(preview.size?.width ?? 2, preview.size?.height ?? 3);
      image.src = preview.src;
    } else {
      position(target.item.dimensions?.width ?? 2, target.item.dimensions?.height ?? 3);
    }

    function updatePhase(phase: ImageLoadPhase): void {
      if (!isCurrent()) return;
      status.textContent = phase === 'error' ? i18n.loadFailed
        : phase === 'resolving' ? i18n.resolvingImage
        : phase === 'switching-source' ? i18n.switchingImageSource
        : phase === 'downloading' || phase === 'ready' ? i18n.downloading
        : i18n.waitingForNetwork;
    }

    try {
      const activeLease = options.acquire(target.item);
      lease = activeLease;
      activeLease.subscribe(updatePhase);
      void activeLease.result.then(asset => {
        if (!isCurrent()) return;
        if (!enabled() || !target.element.isConnected) { dismiss(); return; }
        if (!asset) { updatePhase('error'); return; }
        const image = document.createElement('img');
        pendingImage = image;
        image.alt = '';
        image.decoding = 'async';
        // Keep the thumbnail until the actual display node has decoded successfully.
        const loaded = async () => {
          try {
            await image.decode();
            if (!isCurrent()) return;
            if (!enabled() || !target.element.isConnected) { dismiss(); return; }
            if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image');
            fullImageVisible = true;
            pendingImage = null;
            picture.replaceChildren(image);
            position(image.naturalWidth, image.naturalHeight);
            status.hidden = true;
          } catch {
            if (isCurrent()) updatePhase('error');
          }
        };
        image.onload = () => { void loaded(); };
        image.onerror = () => updatePhase('error');
        image.src = asset.src;
      }).catch(() => updatePhase('error'));
    } catch {
      updatePhase('error');
    }
  }

  function pointerOver(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || event.buttons !== 0 || !(event.target instanceof Element)) return;
    const target = options.getTarget(event.target);
    if (target?.element === hovered?.element) return;
    dismiss();
    hovered = target;
    if (!target || !enabled()) return;
    timer = setTimeout(() => {
      timer = null;
      show(target);
    }, 400);
  }

  function pointerOut(event: PointerEvent): void {
    if (!hovered || (event.relatedTarget instanceof Node && hovered.element.contains(event.relatedTarget))) return;
    hovered = null;
    dismiss();
  }

  const signal = events.signal;
  document.addEventListener('pointerover', pointerOver, { signal, passive: true });
  document.addEventListener('pointerout', pointerOut, { signal, passive: true });
  document.addEventListener('pointerdown', dismiss, { signal, capture: true, passive: true });
  document.addEventListener('pointercancel', dismiss, { signal, passive: true });
  document.addEventListener('keydown', dismiss, { signal, capture: true });
  document.addEventListener('scroll', dismiss, { signal, capture: true, passive: true });
  document.addEventListener('visibilitychange', dismiss, { signal });
  window.addEventListener('blur', dismiss, { signal });
  window.addEventListener('resize', dismiss, { signal, passive: true });
  window.addEventListener('pagehide', dismiss, { signal });

  return {
    dismiss,
    destroy() {
      events.abort();
      dismiss();
      hovered = null;
    },
  };
}
