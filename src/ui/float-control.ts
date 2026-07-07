import './float-control.css';
import { store } from '../state/store';
import { svgReader, svgSettings, svgTop, svgScroll, svgPlay, svgPause } from '../utils/icons';
import { createSettingsPanel } from './settings-panel';
import { i18n } from '../utils/i18n';
import type { SinglePageModeHandle } from '../types';

export function createFloatControl(spmHandle: SinglePageModeHandle): void {
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
  const topBtn = document.createElement('div');
  topBtn.className = 'bm-btn bm-top-btn';
  const updateTopBtn = () => {
    if (spmHandle.isActive()) {
      topBtn.innerHTML = store.autoPlay ? svgPause : svgPlay;
      topBtn.title = store.autoPlay ? i18n.pause : i18n.play;
    } else {
      topBtn.innerHTML = svgTop;
      topBtn.title = i18n.backToTop;
    }
  };

  updateTopBtn();

  topBtn.onclick = (e) => {
    e.stopPropagation();
    if (spmHandle.isActive()) {
      store.autoPlay = !store.autoPlay;
      store.emit('settingsChanged');
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const modeBtn = document.createElement('div');
  modeBtn.className = 'bm-btn bm-mode-btn';
  modeBtn.innerHTML = svgReader;
  modeBtn.title = i18n.readerMode;
  modeBtn.onclick = (e) => {
    e.stopPropagation();
    if (spmHandle.isActive()) {
      spmHandle.close();
    } else {
      spmHandle.open();
    }
  };

  // Sync button icons
  store.on('readerModeChanged', () => {
    modeBtn.innerHTML = spmHandle.isActive() ? svgScroll : svgReader;
    updateTopBtn();
  });

  store.on('settingsChanged', () => {
    updateTopBtn();
  });

  const settings = createSettingsPanel(floatControl);
  document.body.appendChild(settings.getContainerElement()); // Append bottom sheet to body

  const settingsBtn = document.createElement('div');
  settingsBtn.className = 'bm-btn bm-settings-btn';
  settingsBtn.innerHTML = svgSettings;
  settingsBtn.title = i18n.settings;
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

  // Dragging logic
  let isDragging = false;
  let startY = 0;
  let startTop = 0;
  let dragMoved = false;

  floatControl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    
    isDragging = true;
    dragMoved = false;
    startY = e.clientY;
    
    const rect = floatControl.getBoundingClientRect();
    startTop = rect.top + rect.height / 2;

    floatControl.classList.add('dragging');
  });

  window.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    
    const deltaY = e.clientY - startY;
    if (Math.abs(deltaY) > 5) {
      if (!dragMoved && settings.isOpen()) {
        settings.hide();
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

  window.addEventListener('pointerup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    floatControl.classList.remove('dragging');

    const rect = floatControl.getBoundingClientRect();
    const centerPercent = ((rect.top + rect.height / 2) / window.innerHeight) * 100;
    const side = e.clientX < window.innerWidth / 2 ? 'left' : 'right';

    floatControl.style.top = `${centerPercent}%`;

    localStorage.setItem('hentai-reader-bookmark-pos', JSON.stringify({ side, topPercent: centerPercent }));
  });
  
  floatControl.addEventListener('click', (e) => {
    if (dragMoved) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, { capture: true });
}
