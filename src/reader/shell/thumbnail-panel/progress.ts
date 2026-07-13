import type { ThumbnailPanelOptions } from './panel';

/** Creates the compact seek track displayed beside the thumbnail panel. */
export function createProgressTrack(
  onIndexChange: (index: number) => void,
  panelIsActive: () => boolean,
  options: ThumbnailPanelOptions,
) {
  const progressTrack = document.createElement('div');
  progressTrack.className = 'sp-sidebar-track';

  const progressThumb = document.createElement('div');
  progressThumb.className = 'sp-sidebar-thumb';

  const progressLabel = document.createElement('div');
  progressLabel.className = 'sp-sidebar-label';

  progressTrack.appendChild(progressThumb);
  progressTrack.appendChild(progressLabel);

  let cachedTrackSize = 0;
  let isDragging = false;
  let dragStartPos = 0;
  let thumbStartPos = 0;
  let previousBodyUserSelect: string | null = null;

  function isVertical() {
    const pos = options.getThumbnailPosition();
    return pos === 'left' || pos === 'right';
  }

  function refreshTrackSize(): void {
    cachedTrackSize = isVertical() ? progressTrack.offsetHeight : progressTrack.offsetWidth;
  }
  window.addEventListener('resize', refreshTrackSize, { passive: true });
  
  // Settings change might change orientation
  options.subscribeSettingsChanged(() => {
    // Reset inline styles that might conflict when switching axes
    progressThumb.style.width = '';
    progressThumb.style.height = '';
    progressThumb.style.left = '';
    progressThumb.style.top = '';
    refreshTrackSize();
  });

  function update(): void {
    const imageCount = options.getImageCount();
    if (imageCount === 0) return;

    if (!cachedTrackSize) refreshTrackSize();
    const trackSize = cachedTrackSize;
    let thumbSize: number;

    if (imageCount <= 10) {
      thumbSize = 60;
    } else if (imageCount <= 50) {
      thumbSize = Math.max(60, trackSize * (10 / imageCount));
    } else {
      thumbSize = Math.max(60, trackSize * (5 / imageCount));
    }

    const currentIndex = options.getCurrentIndex();
    const scrollProgress = currentIndex / Math.max(1, imageCount - 1);
    const maxThumbPos = trackSize - thumbSize;
    const thumbPos = scrollProgress * maxThumbPos;

    if (isVertical()) {
      progressThumb.style.height = `${thumbSize}px`;
      progressThumb.style.top = `${thumbPos}px`;
    } else {
      progressThumb.style.width = `${thumbSize}px`;
      progressThumb.style.left = `${thumbPos}px`;
    }

    const displayLabel = `${options.getDisplayNumber(currentIndex)} / ${options.getDisplayNumber(imageCount - 1)}`;
    progressLabel.textContent = displayLabel;
  }

  // Click track to seek
  progressTrack.onclick = (e) => {
    if (e.target === progressThumb) return;
    const rect = progressTrack.getBoundingClientRect();
    let scrollProgress = 0;
    
    if (isVertical()) {
      const clickY = e.clientY - rect.top;
      scrollProgress = Math.min(1, Math.max(0, clickY / rect.height));
    } else {
      const clickX = e.clientX - rect.left;
      scrollProgress = Math.min(1, Math.max(0, clickX / rect.width));
    }
    
    const imageCount = options.getImageCount();
    const targetIndex = Math.round(scrollProgress * (imageCount - 1));
    if (targetIndex >= 0 && targetIndex < imageCount) {
      onIndexChange(targetIndex);
    }
  };

  progressThumb.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    if (isVertical()) {
      dragStartPos = e.clientY;
      thumbStartPos = progressThumb.offsetTop;
    } else {
      dragStartPos = e.clientX;
      thumbStartPos = progressThumb.offsetLeft;
    }
    previousBodyUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
  };

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const delta = isVertical() ? (e.clientY - dragStartPos) : (e.clientX - dragStartPos);
    const newPos = thumbStartPos + delta;
    const trackSize = cachedTrackSize;
    const thumbSize = isVertical() ? progressThumb.offsetHeight : progressThumb.offsetWidth;
    const maxPos = trackSize - thumbSize;
    const clampedPos = Math.max(0, Math.min(maxPos, newPos));
    
    const scrollProgress = maxPos > 0 ? clampedPos / maxPos : 0;
    const imageCount = options.getImageCount();
    const targetIndex = Math.round(scrollProgress * (imageCount - 1));
    if (targetIndex >= 0 && targetIndex < imageCount && targetIndex !== options.getCurrentIndex()) {
      onIndexChange(targetIndex);
    }
  });

  function endProgressDrag(wake = true): void {
    if (!isDragging) return;
    isDragging = false;
    document.body.style.userSelect = previousBodyUserSelect ?? '';
    previousBodyUserSelect = null;
    if (wake) wakeUp();
  }

  document.addEventListener('mouseup', () => endProgressDrag());
  window.addEventListener('blur', () => endProgressDrag(false));

  progressThumb.onclick = (e) => e.stopPropagation();

  let progressWakeTimer: ReturnType<typeof setTimeout> | null = null;
  function wakeUp() {
    if (panelIsActive()) return;
    progressTrack.classList.add('active');
    if (progressWakeTimer) clearTimeout(progressWakeTimer);
    progressWakeTimer = setTimeout(() => {
      progressTrack.classList.remove('active');
    }, 1500);
  }
  
  function sleep() {
    progressTrack.classList.remove('active');
    if (progressWakeTimer) clearTimeout(progressWakeTimer);
  }

  return {
    getElement: () => progressTrack,
    update,
    wakeUp,
    sleep
  };
}
