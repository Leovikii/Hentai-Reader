/** Opens the desktop panel when the pointer approaches its configured edge. */
export function createMouseTracker(
  panel: { openPanel: () => void; closePanel: () => void; isActive: () => boolean; },
  progress: { sleep: () => void; },
  getThumbnailPosition: () => 'top' | 'bottom' | 'left' | 'right',
  touchOnlyUi: boolean,
) {
  if (touchOnlyUi) return;

  const SENSITIVITY = 140; // Pixels from the edge to trigger

  document.addEventListener('mousemove', (e) => {
    if (!document.querySelector('.pswp')) return;

    // Failsafe: if mouse moves completely out of the viewport
    if (e.clientX < 0 || e.clientY < 0 || e.clientX >= window.innerWidth - 1 || e.clientY >= window.innerHeight - 1) {
      panel.closePanel();
      return;
    }

    const pos = getThumbnailPosition();
    let distanceToEdge = Infinity;

    switch (pos) {
      case 'bottom':
        distanceToEdge = window.innerHeight - e.clientY;
        break;
      case 'top':
        distanceToEdge = e.clientY;
        break;
      case 'left':
        distanceToEdge = e.clientX;
        break;
      case 'right':
        distanceToEdge = window.innerWidth - e.clientX;
        break;
    }

    if (distanceToEdge <= SENSITIVITY) {
      if (!panel.isActive()) {
        panel.openPanel();
        progress.sleep();
      }
    } else {
      if (panel.isActive()) {
        panel.closePanel();
      }
    }
  });

  document.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) panel.closePanel();
  });

  document.documentElement.addEventListener('mouseleave', () => {
    panel.closePanel();
  });
}
