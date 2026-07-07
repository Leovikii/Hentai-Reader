import { store } from '../../../state/store';
import { createThumbnailPanel } from './panel';
import { createProgressTrack } from './progress';
import { createMouseTracker } from './mouse-tracker';

export interface SidebarHandle {
  update: () => void;
  getElements: () => HTMLElement[];
  wakeUpProgressBar: () => void;
}

export function createSidebar(
  onIndexChange: (index: number) => void,
  onScrollToBottom?: () => void,
  onScrollToTop?: () => void,
): SidebarHandle {
  const panel = createThumbnailPanel(onIndexChange, onScrollToBottom, onScrollToTop);
  const progress = createProgressTrack(onIndexChange, panel.isActive);
  
  createMouseTracker(panel, progress);

  function update() {
    panel.update();
    progress.update();
  }

  function applyPositionClasses() {
    const newPos = store.settings.thumbnailPosition;
    panel.getElement().classList.remove(`position-top`, `position-bottom`, `position-left`, `position-right`);
    progress.getElement().classList.remove(`position-top`, `position-bottom`, `position-left`, `position-right`);
    
    panel.getElement().classList.add(`position-${newPos}`);
    progress.getElement().classList.add(`position-${newPos}`);
  }
  
  applyPositionClasses();

  store.on('settingsChanged', applyPositionClasses);

  return {
    update,
    getElements: () => [progress.getElement(), panel.getElement()],
    wakeUpProgressBar: progress.wakeUp,
  };
}
