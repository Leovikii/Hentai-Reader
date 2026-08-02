import './settings-panel.css';
import { store } from '../state/store';
import type { UserSettings } from '../state/types';
import { i18n } from '../utils/i18n';
import { svgClose } from '../utils/icons';

export interface SettingsPanelHandle {
  getContainerElement: () => HTMLElement;
  show: () => void;
  hide: () => void;
  isOpen: () => boolean;
}

interface SettingItem {
  label: string;
  key: keyof Pick<typeof store.settings, 'scrollMode' | 'autoEnterSinglePage' | 'clickToEnterReader' | 'doublePageMode'>;
}

const SETTINGS: SettingItem[] = [
  { label: i18n.scrollMode, key: 'scrollMode' },
  { label: i18n.autoEnter, key: 'autoEnterSinglePage' },
  { label: i18n.clickToEnter, key: 'clickToEnterReader' },
  { label: i18n.doublePageMode, key: 'doublePageMode' },
];

export function createSettingsPanel(anchorElement: HTMLElement): SettingsPanelHandle {
  const backdrop = document.createElement('div');
  backdrop.className = 'settings-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.inert = true;

  const bottomSheet = document.createElement('div');
  bottomSheet.className = 'settings-bottom-sheet';
  bottomSheet.setAttribute('role', 'dialog');
  bottomSheet.setAttribute('aria-modal', 'true');
  bottomSheet.setAttribute('aria-labelledby', 'hr-settings-title');

  // Header with title and close button
  const sheetHeader = document.createElement('div');
  sheetHeader.className = 'settings-sheet-header';

  const title = document.createElement('h2');
  title.className = 'settings-title';
  title.id = 'hr-settings-title';
  title.textContent = i18n.settings;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'settings-close-btn';
  closeBtn.setAttribute('aria-label', i18n.close);
  closeBtn.innerHTML = svgClose.replace('class="pswp__icn"', '');
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    hide();
  };

  sheetHeader.appendChild(title);
  sheetHeader.appendChild(closeBtn);
  bottomSheet.appendChild(sheetHeader);

  SETTINGS.forEach(({ label, key }) => {
    if (key === 'scrollMode' && store.activeAdapter?.scrollPolicy?.configurable === false) {
      return;
    }
    const item = document.createElement('div');
    item.className = 'settings-item';

    const labelEl = document.createElement('span');
    labelEl.className = 'settings-label';
    labelEl.textContent = label;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `toggle-switch${store.settings[key] ? ' on' : ''}`;
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-checked', String(store.settings[key]));

    const slider = document.createElement('div');
    slider.className = 'toggle-slider';
    toggle.appendChild(slider);

    toggle.onclick = (e) => {
      e.stopPropagation();
      const newValue = !store.settings[key];
      store.updateSetting(key, newValue);
      toggle.classList.toggle('on', newValue);
      toggle.setAttribute('aria-checked', String(newValue));
      if (key === 'scrollMode') {
        window.location.reload();
      }
    };

    item.appendChild(labelEl);
    item.appendChild(toggle);
    bottomSheet.appendChild(item);
  });

  // Auto-play interval setting
  const intervalItem = document.createElement('div');
  intervalItem.className = 'settings-item';

  const intervalLabel = document.createElement('label');
  intervalLabel.className = 'settings-label';
  intervalLabel.textContent = i18n.playSpeed;

  const intervalRight = document.createElement('div');
  intervalRight.className = 'stepper-control';

  const minusBtn = document.createElement('button');
  minusBtn.type = 'button';
  minusBtn.className = 'stepper-btn';
  minusBtn.textContent = '−';
  minusBtn.setAttribute('aria-label', `${i18n.playSpeed}: -1`);

  const intervalInput = document.createElement('input');
  intervalInput.type = 'number';
  intervalInput.id = 'hr-autoplay-interval';
  intervalInput.name = 'hr-autoplay-interval';
  intervalLabel.htmlFor = intervalInput.id;
  intervalInput.className = 'interval-input';
  intervalInput.min = '1';
  intervalInput.max = '60';
  intervalInput.step = '1';
  intervalInput.value = String(store.settings.autoPlayInterval / 1000);
  intervalInput.onclick = (e) => e.stopPropagation();

  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'stepper-btn';
  plusBtn.textContent = '+';
  plusBtn.setAttribute('aria-label', `${i18n.playSpeed}: +1`);

  const updateInterval = (val: number) => {
    if (!isNaN(val) && val >= 1 && val <= 60) {
      intervalInput.value = String(val);
      store.updateSetting('autoPlayInterval', val * 1000);
    }
  };

  intervalInput.onchange = (e) => {
    updateInterval(parseFloat((e.target as HTMLInputElement).value));
  };

  minusBtn.onclick = (e) => {
    e.stopPropagation();
    let current = parseFloat(intervalInput.value);
    if (isNaN(current)) current = 5;
    updateInterval(Math.max(1, current - 1));
  };

  plusBtn.onclick = (e) => {
    e.stopPropagation();
    let current = parseFloat(intervalInput.value);
    if (isNaN(current)) current = 5;
    updateInterval(Math.min(60, current + 1));
  };

  intervalRight.appendChild(minusBtn);
  intervalRight.appendChild(intervalInput);
  intervalRight.appendChild(plusBtn);

  intervalItem.appendChild(intervalLabel);
  intervalItem.appendChild(intervalRight);
  bottomSheet.appendChild(intervalItem);

  // Thumbnail Position setting (Apple-style Segmented Control)
  const posItem = document.createElement('div');
  posItem.className = 'settings-item';

  const posLabel = document.createElement('span');
  posLabel.className = 'settings-label';
  posLabel.textContent = i18n.thumbnailPosition;

  const segmentControl = document.createElement('div');
  segmentControl.className = 'segment-control';

  const posOptions: Array<{
    value: UserSettings['thumbnailPosition'];
    label: string;
  }> = [
    { value: 'top', label: i18n.posTop },
    { value: 'bottom', label: i18n.posBottom },
    { value: 'left', label: i18n.posLeft },
    { value: 'right', label: i18n.posRight },
  ];

  const segmentItems: HTMLButtonElement[] = [];

  posOptions.forEach(opt => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `segment-item${store.settings.thumbnailPosition === opt.value ? ' active' : ''}`;
    item.textContent = opt.label;
    item.setAttribute('aria-pressed', String(store.settings.thumbnailPosition === opt.value));

    item.onclick = (e) => {
      e.stopPropagation();
      if (store.settings.thumbnailPosition === opt.value) return;

      store.updateSetting('thumbnailPosition', opt.value);
      segmentItems.forEach(el => {
        el.classList.remove('active');
        el.setAttribute('aria-pressed', 'false');
      });
      item.classList.add('active');
      item.setAttribute('aria-pressed', 'true');
    };

    segmentItems.push(item);
    segmentControl.appendChild(item);
  });

  posItem.appendChild(posLabel);
  posItem.appendChild(segmentControl);
  bottomSheet.appendChild(posItem);

  backdrop.appendChild(bottomSheet);

  const show = () => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !document.documentElement.classList.contains('hr-mobile')) {
      // Hardcode width for desktop to prevent CSS transition measurement issues
      const panelWidth = 340;
      const rect = anchorElement.getBoundingClientRect();
      
      // Temporarily display block to measure height if needed, but since it's just opacity: 0,
      // getBoundingClientRect() works fine before 'show' is added
      const panelRect = bottomSheet.getBoundingClientRect();
      const panelHeight = panelRect.height || 300; // Fallback if 0

      let top = rect.top + rect.height / 2 - panelHeight / 2;
      top = Math.max(16, Math.min(window.innerHeight - panelHeight - 16, top));

      bottomSheet.style.top = `${top}px`;
      bottomSheet.style.bottom = 'auto';

      if (rect.left < window.innerWidth / 2) {
        bottomSheet.style.left = `${rect.right + 20}px`;
        bottomSheet.style.transformOrigin = 'left center';
      } else {
        bottomSheet.style.left = `${rect.left - panelWidth - 20}px`;
        bottomSheet.style.transformOrigin = 'right center';
      }
      
      // Trigger reflow to ensure styles are applied before adding the show class
      void bottomSheet.offsetHeight;
    } else {
      bottomSheet.style.cssText = '';
    }
    
    backdrop.classList.add('show');
    backdrop.inert = false;
    backdrop.setAttribute('aria-hidden', 'false');
    closeBtn.focus({ preventScroll: true });
  };

  const hide = () => {
    backdrop.classList.remove('show');
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.inert = true;
    if (document.contains(anchorElement)) anchorElement.focus({ preventScroll: true });
  };

  backdrop.onclick = (e) => {
    if (e.target === backdrop) {
      hide();
    }
  };

  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hide();
    }
  });

  const isOpen = () => backdrop.classList.contains('show');

  return {
    getContainerElement: () => backdrop,
    show,
    hide,
    isOpen,
  };
}
