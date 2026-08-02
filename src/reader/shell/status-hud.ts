export type HUDStatus = 'loading' | 'error';

export interface HUDConfig {
  status: HUDStatus;
  text: string;
  pageText?: string;
}

export interface StatusHUDHandle {
  show: (config: HUDConfig) => void;
  hide: () => void;
  getElement: () => HTMLElement;
}

/** Reader-owned status surface for loading and recoverable errors. */
export function createStatusHUD(): StatusHUDHandle {
  const container = document.createElement('div');
  container.className = 'sp-hud-container';
  let renderedKey = '';
  let visible = false;

  function show(config: HUDConfig): void {
    const isError = config.status === 'error';
    const nextKey = `${config.status}\u0000${config.text}\u0000${config.pageText ?? ''}`;

    if (renderedKey !== nextKey) {
      const color = isError ? '#ef4444' : '#F596AA';
      const iconSvg = isError
        ? `<svg style="color: ${color}; width: 18px; height: 18px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
        : `<svg class="hr-spinner" style="color: ${color}; width: 18px; height: 18px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>`;
      container.innerHTML = `
        <div class="sp-hud-box ${isError ? 'hud-error' : ''}">
          ${iconSvg}
          <div class="sp-hud-text">${config.text}</div>
          ${config.pageText ? `<div class="sp-hud-page">${config.pageText}</div>` : ''}
        </div>
      `;
      renderedKey = nextKey;
    }

    if (!visible) {
      container.classList.add('show');
      visible = true;
    }
  }

  function hide(): void {
    if (visible) {
      container.classList.remove('show');
      visible = false;
    }
  }

  return { show, hide, getElement: () => container };
}
