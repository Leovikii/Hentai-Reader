import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePhotoSwipeHolder } from '../src/reader/drivers/photoswipe-holder.ts';

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
