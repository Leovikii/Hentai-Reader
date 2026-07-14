import { createThumbnailPanel, type ThumbnailPanelOptions } from './panel';
import { createProgressTrack } from './progress';
import { createMouseTracker } from './mouse-tracker';

export interface SidebarHandle {
  update: () => void;
  getElements: () => HTMLElement[];
  wakeUpProgressBar: () => void;
  openPanel: (keepOpen?: boolean) => void;
  closePanel: () => void;
  resetCentering: () => void;
}

/** Composes the reader thumbnail viewport and compact progress track. */
export function createSidebar(
  onIndexChange: (index: number) => void,
  onScrollToBottom: (() => void) | undefined,
  onScrollToTop: (() => void) | undefined,
  options: ThumbnailPanelOptions,
): SidebarHandle {
  const panel = createThumbnailPanel(onIndexChange, onScrollToBottom, onScrollToTop, options);
  const progress = createProgressTrack(onIndexChange, panel.isActive, options);
  
  createMouseTracker(panel, progress, options.getThumbnailPosition);

  function update() {
    panel.update();
    progress.update();
  }

  function applyPositionClasses() {
    const newPos = options.getThumbnailPosition();
    panel.getElement().classList.remove(`position-top`, `position-bottom`, `position-left`, `position-right`);
    progress.getElement().classList.remove(`position-top`, `position-bottom`, `position-left`, `position-right`);
    
    panel.getElement().classList.add(`position-${newPos}`);
    progress.getElement().classList.add(`position-${newPos}`);
  }
  
  applyPositionClasses();

  options.subscribeSettingsChanged(applyPositionClasses);

  return {
    update,
    getElements: () => [progress.getElement(), panel.getElement()],
    wakeUpProgressBar: progress.wakeUp,
    openPanel: panel.openPanel,
    closePanel: panel.closePanel,
    resetCentering: panel.resetCentering,
  };
}
