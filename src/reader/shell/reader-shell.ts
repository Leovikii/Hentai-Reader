import type { HUDConfig } from './status-hud';
import type { GalleryItem } from '../../core/gallery';
import { createStatusHUD } from './status-hud';
import { createSidebar } from './thumbnail-panel';
import type { ReaderDriver } from '../contracts';
import type { ThumbnailController } from '../controllers/thumbnail-controller';

export interface ReaderShellOptions {
  onIndexChange: (index: number) => void;
  onScrollToBottom: () => void;
  onScrollToTop: () => void;
  onMobileInteractionStart: () => void;
  onMobileInteractionEnd: () => void;
  thumbnailController: ThumbnailController;
  getImageCount: () => number;
  getCurrentIndex: () => number;
  getImageAt: (index: number) => HTMLElement | undefined;
  getItemAt: (index: number) => GalleryItem | undefined;
  getDisplayNumber: (index: number) => number;
  getThumbnailPosition: () => 'top' | 'bottom' | 'left' | 'right';
  subscribeSettingsChanged: (listener: () => void) => () => void;
}

export interface ReaderShell {
  update(): void;
  resetCentering(): void;
  showStatus(config: HUDConfig): void;
  hideStatus(): void;
  mount(driver: ReaderDriver, counter: (index: number) => string): () => void;
}

export function createReaderShell(options: ReaderShellOptions): ReaderShell {
  const hud = createStatusHUD();
  const sidebar = createSidebar(
    options.onIndexChange,
    options.onScrollToBottom,
    options.onScrollToTop,
    {
      onMobileInteractionStart: options.onMobileInteractionStart,
      onMobileInteractionEnd: options.onMobileInteractionEnd,
      subscribeThumbnailChange: options.thumbnailController.subscribeChange,
      preloadThumbnails: options.thumbnailController.preload,
      cancelThumbnailPreloads: options.thumbnailController.cancelPreloads,
      finishThumbnailPreload: options.thumbnailController.finishPreload,
      getPreloadedAsset: options.thumbnailController.getPreloadedAsset,
      getPreloadPhase: options.thumbnailController.getPreloadPhase,
      getImageCount: options.getImageCount,
      getCurrentIndex: options.getCurrentIndex,
      getImageAt: options.getImageAt,
      getItemAt: options.getItemAt,
      getDisplayNumber: options.getDisplayNumber,
      getThumbnailPosition: options.getThumbnailPosition,
      subscribeSettingsChanged: options.subscribeSettingsChanged,
    },
  );

  function mount(driver: ReaderDriver, counter: (index: number) => string): () => void {
    driver.registerCounter(counter);
    const sidebarElements = sidebar.getElements();
    sidebarElements.forEach(element => {
      element.style.pointerEvents = 'auto';
      element.dataset.readerWheelBlock = '';
    });
    driver.appendUi([...sidebarElements, hud.getElement()]);

    const unsubscribeVisibility = driver.observeUiVisibility(isVisible => {
      sidebarElements.forEach(element => {
        element.classList.toggle('sp-hidden-by-pswp', !isVisible);
      });
      if (window.matchMedia('(hover: none)').matches) {
        if (isVisible) sidebar.openPanel(false);
        else sidebar.closePanel();
      }
    });

    return () => {
      unsubscribeVisibility();
      sidebar.closePanel();
      options.thumbnailController.cancelPreloads();
    };
  }

  return {
    update: sidebar.update,
    resetCentering: sidebar.resetCentering,
    showStatus: hud.show,
    hideStatus: hud.hide,
    mount,
  };
}
