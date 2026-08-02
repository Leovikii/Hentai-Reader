import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSpreadImageRenderState,
  getPhotoSwipeHolderPosition,
  getSpreadMouseClickAction,
  reconcilePhotoSwipeHolder,
  shouldRetainMountedSpreadImage,
  shouldHandleSpreadMouseClick,
  shouldRetrySpreadImage,
} from '../src/reader/drivers/photoswipe-holder.ts';

test('distinguishes pending, decoded, and failed spread image elements', () => {
  assert.equal(getSpreadImageRenderState({ complete: false, naturalWidth: 0, naturalHeight: 0 }), 'loading');
  assert.equal(getSpreadImageRenderState({ complete: true, naturalWidth: 1472, naturalHeight: 2048 }), 'loaded');
  assert.equal(getSpreadImageRenderState({ complete: true, naturalWidth: 0, naturalHeight: 0 }), 'error');
});

test('allows only one presentation retry and only for the current spread', () => {
  assert.equal(shouldRetrySpreadImage(0, true), true);
  assert.equal(shouldRetrySpreadImage(1, true), false);
  assert.equal(shouldRetrySpreadImage(0, false), false);
});

test('maps only previous/current/next indices to stable holder positions', () => {
  assert.equal(getPhotoSwipeHolderPosition(4, 3, 3), 0);
  assert.equal(getPhotoSwipeHolderPosition(4, 4, 3), 1);
  assert.equal(getPhotoSwipeHolderPosition(4, 5, 3), 2);
  assert.equal(getPhotoSwipeHolderPosition(4, 2, 3), null);
  assert.equal(getPhotoSwipeHolderPosition(4, 6, 3), null);
});

test('retains decoded spread pixels only for a mounted image with a source', () => {
  assert.equal(shouldRetainMountedSpreadImage('IMG', 'https://example.test/page.jpg'), true);
  assert.equal(shouldRetainMountedSpreadImage('IMG', ''), false);
  assert.equal(shouldRetainMountedSpreadImage('SPAN', 'https://example.test/page.jpg'), false);
  assert.equal(shouldRetainMountedSpreadImage(undefined, undefined), false);
});

interface FakeContainer {
  classList: { contains: (name: string) => boolean };
  parentElement: FakeHolder | null;
  remove: () => void;
}

interface FakeHolder {
  children: FakeContainer[];
}

function createContainer(holder: FakeHolder, className: string): FakeContainer {
  const container: FakeContainer = {
    classList: { contains: name => className.split(' ').includes(name) },
    parentElement: holder,
    remove: () => {
      holder.children = holder.children.filter(child => child !== container);
      container.parentElement = null;
    },
  };
  holder.children.push(container);
  return container;
}

test('holder reconciliation destroys the tracked stale slide and removes orphan wrappers', () => {
  const holder: FakeHolder = { children: [] };
  const staleContainer = createContainer(holder, 'pswp__zoom-wrap');
  const untrackedContainer = createContainer(holder, 'pswp__zoom-wrap');
  const activeContainer = createContainer(holder, 'pswp__zoom-wrap');
  const uiContainer = createContainer(holder, 'custom-ui');
  let staleDestroyCount = 0;
  const staleSlide = {
    container: staleContainer as unknown as HTMLElement,
    destroy: () => {
      staleDestroyCount++;
      staleContainer.remove();
    },
  };
  const activeSlide = {
    container: activeContainer as unknown as HTMLElement,
    destroy: () => {},
  };

  reconcilePhotoSwipeHolder(
    holder as unknown as HTMLElement,
    activeSlide,
    staleSlide,
  );

  assert.equal(staleDestroyCount, 1);
  assert.deepEqual(holder.children, [activeContainer, uiContainer]);
  assert.equal(untrackedContainer.parentElement, null);
});

test('holder reconciliation does not destroy a previous slide that PhotoSwipe already detached', () => {
  const holder: FakeHolder = { children: [] };
  const detachedHolder: FakeHolder = { children: [] };
  const detachedContainer = createContainer(detachedHolder, 'pswp__zoom-wrap');
  const activeContainer = createContainer(holder, 'pswp__zoom-wrap');
  let staleDestroyCount = 0;

  reconcilePhotoSwipeHolder(
    holder as unknown as HTMLElement,
    { container: activeContainer as unknown as HTMLElement, destroy: () => {} },
    {
      container: detachedContainer as unknown as HTMLElement,
      destroy: () => { staleDestroyCount++; },
    },
  );

  assert.equal(staleDestroyCount, 0);
  assert.deepEqual(holder.children, [activeContainer]);
});

function spreadClickTarget(kind: 'image' | 'pending' | 'root' | 'outside'): Element {
  return {
    closest: (selector: string) => {
      if (selector === '[data-reader-spread]') return kind === 'outside' ? null : {};
      if (selector === 'img.hr-reader-spread__page') return kind === 'image' ? {} : null;
      return null;
    },
  } as unknown as Element;
}

test('classifies spread mouse clicks without intercepting non-spread controls', () => {
  assert.equal(getSpreadMouseClickAction(spreadClickTarget('image'), true), 'image');
  assert.equal(getSpreadMouseClickAction(spreadClickTarget('image'), false), 'background');
  assert.equal(getSpreadMouseClickAction(spreadClickTarget('pending'), true), 'background');
  assert.equal(getSpreadMouseClickAction(spreadClickTarget('root'), true), 'background');
  assert.equal(getSpreadMouseClickAction(spreadClickTarget('outside'), true), null);
  assert.equal(getSpreadMouseClickAction(null, true), null);
});

test('mouse compensation ignores touch taps and PhotoSwipe-suppressed drag clicks', () => {
  assert.equal(shouldHandleSpreadMouseClick('mouse', false, 0), true);
  assert.equal(shouldHandleSpreadMouseClick('touch', false, 0), false);
  assert.equal(shouldHandleSpreadMouseClick('pen', false, 0), false);
  assert.equal(shouldHandleSpreadMouseClick('mouse', true, 0), false);
  assert.equal(shouldHandleSpreadMouseClick('mouse', false, 1), false);
});
