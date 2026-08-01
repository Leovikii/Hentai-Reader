import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWheelPager,
  getWheelPageLoadBehavior,
} from '../src/reader/controllers/wheel-pager.ts';

function withAnimationFrames(run: (flush: (now?: number) => void) => void): void {
  const callbacks: FrameRequestCallback[] = [];
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = callback => {
    callbacks.push(callback);
    return callbacks.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  try {
    run((now = 1000) => callbacks.shift()?.(now));
  } finally {
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
  }
}

function wheel(deltaY: number, timeStamp = 500): WheelEvent {
  return {
    deltaY,
    deltaMode: 0,
    timeStamp,
    preventDefault() {},
  } as WheelEvent;
}

test('aggregates single and double-page loading behavior', () => {
  const loading = new Set([0, 1]);
  const isLoading = (index: number) => loading.has(index);
  assert.equal(getWheelPageLoadBehavior([0], isLoading), 'frontier');
  assert.equal(getWheelPageLoadBehavior([0, 1], isLoading), 'ready');
  loading.delete(0);
  assert.equal(getWheelPageLoadBehavior([0, 1], isLoading), 'ready');
  loading.clear();
  assert.equal(getWheelPageLoadBehavior([0, 1], isLoading), 'ready');
});

test('turns one page for an unzoomed wheel gesture', () => {
  withAnimationFrames(flush => {
    let index = 0;
    const turns: number[] = [];
    const pager = createWheelPager({
      getCurrentIndex: () => index,
      isCurrentZoomed: () => false,
      goTo: target => { index = target; turns.push(target); },
      stopMotion: () => {},
      getPageLoadBehavior: () => 'frontier',
      onEdgeForward: () => {},
      onEdgeBackward: () => {},
      getImageCount: () => 5,
    });

    pager.onWheel(wheel(120));
    flush();
    assert.deepEqual(turns, [1]);
    flush();
    assert.deepEqual(turns, [1]);
  });
});

test('leaves wheel input to PhotoSwipe while the current image is zoomed', () => {
  withAnimationFrames(flush => {
    let prevented = false;
    const pager = createWheelPager({
      getCurrentIndex: () => 0,
      isCurrentZoomed: () => true,
      goTo: () => assert.fail('zoomed wheel must not turn pages'),
      stopMotion: () => {},
      getPageLoadBehavior: () => 'ready',
      onEdgeForward: () => {},
      onEdgeBackward: () => {},
      getImageCount: () => 5,
    });
    const event = wheel(120);
    event.preventDefault = () => { prevented = true; };

    pager.onWheel(event);
    flush();
    assert.equal(prevented, false);
  });
});

test('does not block continuous input when every member of a spread is loading', () => {
  withAnimationFrames(flush => {
    let index = 0;
    const turns: number[] = [];
    const pager = createWheelPager({
      getCurrentIndex: () => index,
      isCurrentZoomed: () => false,
      goTo: target => { index = target; turns.push(target); },
      stopMotion: () => {},
      getPageLoadBehavior: target => target < 3 ? 'ready' : 'frontier',
      onEdgeForward: () => {},
      onEdgeBackward: () => {},
      getImageCount: () => 5,
    });

    pager.onWheel(wheel(120));
    flush(1000);
    flush(1100);
    assert.deepEqual(turns, [1, 2]);
  });
});

test('does not latch after entering a partially readable spread', () => {
  withAnimationFrames(flush => {
    let index = 0;
    const turns: number[] = [];
    const pager = createWheelPager({
      getCurrentIndex: () => index,
      isCurrentZoomed: () => false,
      goTo: target => { index = target; turns.push(target); },
      stopMotion: () => {},
      getPageLoadBehavior: target => target === 1 ? 'ready' : 'frontier',
      onEdgeForward: () => {},
      onEdgeBackward: () => {},
      getImageCount: () => 5,
    });

    pager.onWheel(wheel(120));
    flush(1000);
    flush(1100);
    assert.deepEqual(turns, [1, 2]);
  });
});
