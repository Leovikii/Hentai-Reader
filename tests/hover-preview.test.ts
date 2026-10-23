import test from 'node:test';
import assert from 'node:assert/strict';
import { createHoverPreview } from '../src/preview/hover-preview.ts';
import { ImageLoadService } from '../src/services/image-load-service.ts';
import type { GalleryItem } from '../src/core/gallery.ts';
import type { HoverPreviewTarget } from '../src/preview/hover-preview.ts';
import type { UserSettings } from '../src/state/types.ts';

// Only DOM ownership is faked here; timers and the image service use their actual implementations.
class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  parent: ElementStub | null = null;
  style: Record<string, string> = {};
  className = '';
  textContent = '';
  hidden = false;
  isConnected = true;
  naturalWidth = 1200;
  naturalHeight = 1800;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  setAttribute() {}
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
  getBoundingClientRect() { return { left: 900, right: 1000, top: 600, height: 150 }; }
  append(...nodes: ElementStub[]) {
    for (const node of nodes) { node.parent = this; this.children.push(node); }
  }
  replaceChildren(...nodes: ElementStub[]) {
    for (const node of this.children) node.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this);
    this.parent = null;
    this.isConnected = false;
  }
  contains(node: ElementStub): boolean { return node === this || this.children.some(child => child.contains(node)); }
  decode() { return Promise.resolve(); }
}

function emit(surface: EventTarget, type: string, values: Record<string, unknown> = {}) {
  const event = new Event(type);
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
  surface.dispatchEvent(event);
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('hover lifecycle delays requests, ignores stale results, shares Reader assets and releases all ownership', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const body = new ElementStub();
  const created: ElementStub[] = [];
  const doc = Object.assign(new EventTarget(), {
    body,
    visibilityState: 'visible',
    createElement: () => { const element = new ElementStub(); created.push(element); return element; },
  });
  let fineHover = true;
  const win = Object.assign(new EventTarget(), {
    innerWidth: 1100,
    innerHeight: 800,
    matchMedia: () => ({ matches: fineHover }),
  });
  for (const [key, value] of Object.entries({ document: doc, window: win, Element: ElementStub, Node: ElementStub })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  let mode: UserSettings['hoverPreviewMode'] = 'fit';
  let blocked = false;
  const items: GalleryItem[] = ['a', 'b'].map(key => ({ key, viewerUrl: key, preview: { kind: 'none' } }));
  const targets = items.map(item => ({ key: item.key, item, element: new ElementStub() }));
  const pending = new Map<string, (asset: { src: string }) => void>();
  let resolves = 0;
  let downloads = 0;
  const service = new ImageLoadService({
    resolve: url => { resolves++; return new Promise(resolve => pending.set(url, resolve)); },
    loadBytes: async () => { downloads++; return { width: 1200, height: 1800 }; },
  });
  const preview = createHoverPreview({
    getTarget: target => targets.find(item => item.element === target as unknown) as unknown as HoverPreviewTarget ?? null,
    getMode: () => mode,
    isBlocked: () => blocked,
    acquire: item => service.acquire(item.viewerUrl, { intent: 'preview', priority: 100 }),
  });
  t.after(() => preview.destroy());
  const over = (index: number, pointerType = 'mouse') => emit(doc, 'pointerover', {
    target: targets[index].element, pointerType, buttons: 0,
  });
  const out = () => emit(doc, 'pointerout', { relatedTarget: null });

  // Fast sweeps do not start a task or create a panel.
  for (let i = 0; i < 30; i++) { over(i % 2); t.mock.timers.tick(100); out(); }
  assert.equal(resolves, 0);
  assert.equal(body.children.length, 0);
  over(0);
  t.mock.timers.tick(399);
  assert.equal(resolves, 0);
  t.mock.timers.tick(1);
  assert.equal(resolves, 1);
  assert.equal(body.children.length, 1);
  assert.equal(service.getStats().activeLeases, 1);
  over(1);
  t.mock.timers.tick(400);
  pending.get('a')!({ src: 'old' });
  await flush();
  assert.equal(downloads, 0);
  assert.equal(body.children.length, 1);
  const reader = service.acquire('b', { intent: 'foreground', priority: 100 });
  pending.get('b')!({ src: 'shared' });
  await flush();
  const display = created[created.length - 1];
  assert.equal(display.src, 'shared');
  display.onload!();
  await flush();
  assert.equal(body.children[0].children[1].hidden, true);
  assert.equal(downloads, 1);
  assert.equal((await reader.result)?.src, 'shared');
  emit(doc, 'keydown');
  assert.equal(body.children.length, 0);
  assert.equal(service.getStats().listeners, 0);
  assert.equal(service.getStats().cachedLeases, 1);
  // Dismissed targets cannot reopen until the pointer actually leaves.
  over(1);
  t.mock.timers.tick(1000);
  assert.equal(body.children.length, 0);
  out();
  mode = 'compact';
  over(1);
  t.mock.timers.tick(400);
  await flush();
  created[created.length - 1].onload!();
  await flush();
  const panel = body.children[0];
  assert.ok(parseFloat(panel.style.left) >= 16);
  assert.ok(parseFloat(panel.style.left) + parseFloat(panel.style.width) <= 1100 - 16);
  assert.ok(parseFloat(panel.style.top) + parseFloat(panel.style.height) <= 800 - 16);
  assert.equal(resolves, 2);
  emit(win, 'resize');
  reader.release();
  assert.equal(service.getStats().cachedLeases, 0);

  // A late URL thumbnail must not resize a full image that has already appeared.
  items[1].preview = { kind: 'url', src: 'thumb' };
  out(); over(1); t.mock.timers.tick(400);
  const thumbnail = created[created.length - 1];
  await flush();
  created[created.length - 1].onload!();
  await flush();
  const width = body.children[0].style.width;
  thumbnail.naturalWidth = 1600;
  thumbnail.naturalHeight = 400;
  thumbnail.onload!();
  assert.equal(body.children[0].style.width, width);
  emit(doc, 'scroll');

  for (const [viewportWidth, viewportHeight] of [[375, 829], [1280, 300]]) {
    win.innerWidth = viewportWidth;
    win.innerHeight = viewportHeight;
    for (const size of ['fit', 'compact'] as const) {
      mode = size;
      out(); over(1); t.mock.timers.tick(400);
      await flush();
      created[created.length - 1].onload!();
      await flush();
      const style = body.children[0].style;
      assert.ok(parseFloat(style.left) >= 0);
      assert.ok(parseFloat(style.top) >= 0);
      assert.ok(parseFloat(style.left) + parseFloat(style.width) <= viewportWidth);
      assert.ok(parseFloat(style.top) + parseFloat(style.height) <= viewportHeight);
      emit(win, 'blur');
    }
  }

  // Existing input policy, touch events, disabled mode and Reader state all gate requests.
  for (const condition of ['touch', 'coarse', 'off', 'reader', 'hidden']) {
    out();
    fineHover = condition !== 'coarse';
    mode = condition === 'off' ? 'off' : 'fit';
    blocked = condition === 'reader';
    doc.visibilityState = condition === 'hidden' ? 'hidden' : 'visible';
    over(0, condition === 'touch' ? 'touch' : 'mouse');
    t.mock.timers.tick(400);
    assert.equal(body.children.length, 0, condition);
  }
  preview.destroy();
  assert.equal(service.getStats().activeLeases, 0);
  assert.equal(service.getStats().listeners, 0);
  out(); over(0); t.mock.timers.tick(1000);
  assert.equal(resolves, 2);
});
