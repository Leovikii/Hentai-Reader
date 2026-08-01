import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSpreadMouseClickAction,
  reconcilePhotoSwipeHolder,
  shouldHandleSpreadMouseClick,
} from '../src/reader/drivers/photoswipe-holder.ts';

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
