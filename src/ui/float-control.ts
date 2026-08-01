import './float-control.css';
import { store } from '../state/store';
import { svgReader, svgSettings, svgTop, svgScroll, svgPlay, svgPause } from '../utils/icons';
import { createSettingsPanel } from './settings-panel';
import { i18n } from '../utils/i18n';
import type { ReaderHandle } from '../reader/contracts';
import { GM_registerMenuCommand } from '$';

export function createFloatControl(readerHandle: ReaderHandle): () => void {
  const floatControl = document.createElement('div');
  floatControl.className = `bookmark-control${store.settings.showControl ? '' : ' hidden'}`;

  // Read saved position
  let savedPos = { side: 'right', topPercent: 50 };
  try {
    const raw = localStorage.getItem('hentai-reader-bookmark-pos');
    if (raw) savedPos = JSON.parse(raw);
  } catch (e) {}

  if (savedPos.side === 'left') {
    floatControl.classList.add('left-side');
  } else {
    floatControl.classList.add('right-side');
  }
  floatControl.style.top = `${savedPos.topPercent}%`;

  // Buttons: Top -> Mode -> Settings
  const topBtn = document.createElement('button');
  topBtn.type = 'button';
  topBtn.className = 'bm-btn bm-top-btn';
  const updateTopBtn = () => {
    if (readerHandle.isActive()) {
      topBtn.innerHTML = store.autoPlay ? svgPause : svgPlay;
      topBtn.title = store.autoPlay ? i18n.pause : i18n.play;
    } else {
      topBtn.innerHTML = svgTop;
      topBtn.title = i18n.backToTop;
    }
    topBtn.setAttribute('aria-label', topBtn.title);
  };

  updateTopBtn();

  topBtn.onclick = (e) => {
    e.stopPropagation();
    if (readerHandle.isActive()) {
      store.autoPlay = !store.autoPlay;
      store.emit('settingsChanged');
    } else {
      // Use scrollIntoView to support custom scroll containers (e.g., 18comic)
      const firstImg = document.querySelector('.r-img, .r-ph') as HTMLElement;
      if (firstImg) {
        firstImg.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.className = 'bm-btn bm-mode-btn';
  modeBtn.innerHTML = svgReader;
  modeBtn.title = i18n.readerMode;
  modeBtn.setAttribute('aria-label', i18n.readerMode);
  modeBtn.onclick = (e) => {
    e.stopPropagation();
    if (readerHandle.isActive()) {
      readerHandle.close();
    } else {
      readerHandle.open();
    }
  };

  // Sync button icons
  const unsubscribeReaderMode = store.on('readerModeChanged', () => {
    modeBtn.innerHTML = readerHandle.isActive() ? svgScroll : svgReader;
    updateTopBtn();
  });

  const unsubscribeSettings = store.on('settingsChanged', () => {
    updateTopBtn();
  });

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'bm-btn bm-settings-btn';
  settingsBtn.innerHTML = svgSettings;
  settingsBtn.title = i18n.settings;
  settingsBtn.setAttribute('aria-label', i18n.settings);
  const settings = createSettingsPanel(settingsBtn);
  document.body.appendChild(settings.getContainerElement()); // Append bottom sheet to body
  settingsBtn.onclick = (e) => {
    e.stopPropagation();
    if (settings.isOpen()) {
      settings.hide();
    } else {
      settings.show();
    }
  };

  floatControl.appendChild(topBtn);
  floatControl.appendChild(modeBtn);
  floatControl.appendChild(settingsBtn);

  document.body.appendChild(floatControl);

  GM_registerMenuCommand(i18n.restoreControl, () => {
    store.updateSetting('showControl', true);
    floatControl.classList.remove('hidden');
    floatControl.removeAttribute('aria-hidden');
    topBtn.focus({ preventScroll: true });
  });

  // Dragging logic
  let isDragging = false;
  let activePointerId: number | null = null;
  let startY = 0;
  let startTop = 0;
  let dragMoved = false;

  // Shared exit for pointerup/pointercancel. Only persist on a real drag-release
  // (commit && dragMoved); a browser-stolen gesture cancels and a plain tap must
  // not rewrite the saved position.
  function endDrag(commit: boolean, e?: PointerEvent): void {
    if (!isDragging) return;
    isDragging = false;
    floatControl.classList.remove('dragging');
    if (activePointerId !== null) {
      try { floatControl.releasePointerCapture(activePointerId); } catch (err) {}
      activePointerId = null;
    }

    if (commit && dragMoved) {
      const rect = floatControl.getBoundingClientRect();
      const centerPercent = ((rect.top + rect.height / 2) / window.innerHeight) * 100;
      const centerX = e ? e.clientX : rect.left + rect.width / 2;
      const side = centerX < window.innerWidth / 2 ? 'left' : 'right';

      floatControl.style.top = `${centerPercent}%`;

      localStorage.setItem('hentai-reader-bookmark-pos', JSON.stringify({ side, topPercent: centerPercent }));
    }
  }

  floatControl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    isDragging = true;
    dragMoved = false;
    activePointerId = e.pointerId;
    // Don't capture yet — wait until actual drag begins (>5px move), so a plain
    // tap on a button never captures and the button's click handler fires normally.
    startY = e.clientY;

    const rect = floatControl.getBoundingClientRect();
    startTop = rect.top + rect.height / 2;

    floatControl.classList.add('dragging');
  });

  floatControl.addEventListener('pointermove', (e) => {
    if (!isDragging || e.pointerId !== activePointerId) return;

    const deltaY = e.clientY - startY;
    if (Math.abs(deltaY) > 5) {
      if (!dragMoved) {
        // Real drag started — capture now so we keep move/up even off the
        // control and stray page pointers can't drive it. Deferring to here
        // (rather than pointerdown) keeps taps clean so button clicks fire.
        try { floatControl.setPointerCapture(e.pointerId); } catch (err) {}
        if (settings.isOpen()) settings.hide();
      }
      dragMoved = true;
    }

    const newCenterY = startTop + deltaY;
    const maxCenterY = window.innerHeight - (floatControl.offsetHeight / 2);
    const minCenterY = floatControl.offsetHeight / 2;
    const clampedY = Math.max(minCenterY, Math.min(maxCenterY, newCenterY));

    floatControl.style.top = `${clampedY}px`;

    if (e.clientX < window.innerWidth / 2) {
       floatControl.classList.remove('right-side');
       floatControl.classList.add('left-side');
    } else {
       floatControl.classList.remove('left-side');
       floatControl.classList.add('right-side');
    }
  });

  floatControl.addEventListener('pointerup', (e) => {
    if (e.pointerId !== activePointerId) return;
    endDrag(true, e);
  });

  // A gesture the browser reclaims (address-bar open/close, edge-back, etc.)
  // fires pointercancel instead of pointerup. Without this the drag state would
  // stay stuck true and later page scrolls would drag the control around.
  floatControl.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== activePointerId) return;
    endDrag(false, e);
  });
  
  floatControl.addEventListener('click', (e) => {
    if (dragMoved) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, { capture: true });

  return () => {
    unsubscribeReaderMode();
    unsubscribeSettings();
    settings.getContainerElement().remove();
    floatControl.remove();
  };
}
