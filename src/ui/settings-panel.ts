import { store } from '../state/store';
import { i18n } from '../utils/i18n';

export interface SettingsPanelHandle {
  getContainerElement: () => HTMLElement;
  show: () => void;
  hide: () => void;
}

interface SettingItem {
  label: string;
  key: keyof Pick<typeof store.settings, 'scrollMode' | 'showControl' | 'autoEnterSinglePage'>;
}

const SETTINGS: SettingItem[] = [
  { label: i18n.scrollMode, key: 'scrollMode' },
  { label: i18n.autoEnter, key: 'autoEnterSinglePage' },
];

export function createSettingsPanel(): SettingsPanelHandle {
  const backdrop = document.createElement('div');
  backdrop.className = 'settings-backdrop';

  const bottomSheet = document.createElement('div');
  bottomSheet.className = 'settings-bottom-sheet';

  // Header/drag handle area for aesthetics
  const sheetHeader = document.createElement('div');
  sheetHeader.className = 'settings-sheet-header';
  const dragHandle = document.createElement('div');
  dragHandle.className = 'settings-drag-handle';
  sheetHeader.appendChild(dragHandle);
  bottomSheet.appendChild(sheetHeader);

  SETTINGS.forEach(({ label, key }) => {
    if (key === 'scrollMode' && store.activeAdapter && ['18comic', '4KHD'].includes(store.activeAdapter.name)) {
      return;
    }
    const item = document.createElement('div');
    item.className = 'settings-item';

    const labelEl = document.createElement('span');
    labelEl.className = 'settings-label';
    labelEl.textContent = label;

    const toggle = document.createElement('div');
    toggle.className = `toggle-switch${store.settings[key] ? ' on' : ''}`;

    const slider = document.createElement('div');
    slider.className = 'toggle-slider';
    toggle.appendChild(slider);

    toggle.onclick = (e) => {
      e.stopPropagation();
      const newValue = !store.settings[key];
      store.updateSetting(key, newValue);
      toggle.classList.toggle('on', newValue);
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

  const intervalLabel = document.createElement('span');
  intervalLabel.className = 'settings-label';
  intervalLabel.textContent = i18n.playSpeed;

  const intervalRight = document.createElement('div');
  intervalRight.style.cssText = 'display:flex;align-items:center;gap:4px;';

  const intervalInput = document.createElement('input');
  intervalInput.type = 'number';
  intervalInput.className = 'interval-input';
  intervalInput.min = '1';
  intervalInput.max = '60';
  intervalInput.step = '0.5';
  intervalInput.value = String(store.settings.autoPlayInterval / 1000);
  intervalInput.onclick = (e) => e.stopPropagation();
  intervalInput.onchange = (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value) && value >= 1 && value <= 60) {
      store.updateSetting('autoPlayInterval', value * 1000);
    }
  };

  const intervalUnit = document.createElement('span');
  intervalUnit.textContent = 's';
  intervalUnit.style.cssText = 'font-size:12px;color:#888;';

  intervalRight.appendChild(intervalInput);
  intervalRight.appendChild(intervalUnit);
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

  const posOptions = [
    { value: 'top', label: i18n.posTop },
    { value: 'bottom', label: i18n.posBottom },
    { value: 'left', label: i18n.posLeft },
    { value: 'right', label: i18n.posRight },
  ];

  const segmentItems: HTMLElement[] = [];

  posOptions.forEach(opt => {
    const item = document.createElement('div');
    item.className = `segment-item${store.settings.thumbnailPosition === opt.value ? ' active' : ''}`;
    item.textContent = opt.label;
    
    item.onclick = (e) => {
      e.stopPropagation();
      if (store.settings.thumbnailPosition === opt.value) return;
      
      store.updateSetting('thumbnailPosition', opt.value as any);
      segmentItems.forEach(el => el.classList.remove('active'));
      item.classList.add('active');
    };
    
    segmentItems.push(item);
    segmentControl.appendChild(item);
  });

  posItem.appendChild(posLabel);
  posItem.appendChild(segmentControl);
  bottomSheet.appendChild(posItem);

  backdrop.appendChild(bottomSheet);

  const show = () => {
    backdrop.classList.add('show');
  };

  const hide = () => {
    backdrop.classList.remove('show');
  };

  backdrop.onclick = (e) => {
    if (e.target === backdrop) {
      hide();
    }
  };

  return {
    getContainerElement: () => backdrop,
    show,
    hide,
  };
}
