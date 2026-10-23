import '../preview/hover-preview.css';
import { createHoverPreview } from '../preview/hover-preview';
import type { ReaderHandle } from '../reader/contracts';
import { acquireImage } from '../services/image-load-runtime';
import { LOAD_PRIORITY } from '../state/load-policy';
import { store } from '../state/store';

export function setupHoverPreview(reader: ReaderHandle): () => void {
  const getHoverTarget = store.activeAdapter?.getHoverTarget;
  if (!getHoverTarget || store.settings.scrollMode) return () => {};
  const preview = createHoverPreview({
    getTarget: element => {
      const target = getHoverTarget(element);
      if (!target) return null;
      const item = store.galleryItems.find(item => item.key === target.key);
      return item ? { ...target, item } : null;
    },
    getMode: () => store.settings.hoverPreviewMode,
    isBlocked: () => store.settings.scrollMode || reader.isActive(),
    acquire: item => acquireImage(item.viewerUrl, { intent: 'preview', priority: LOAD_PRIORITY.foreground }),
  });
  const offSettings = store.on('settingsChanged', preview.dismiss);
  const offReader = store.on('readerModeChanged', preview.dismiss);
  return () => {
    offSettings();
    offReader();
    preview.destroy();
  };
}
