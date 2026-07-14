import test from 'node:test';
import assert from 'node:assert/strict';
import { createWheelPager } from '../src/reader/controllers/wheel-pager.ts';

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

function wheel(deltaY: number): WheelEvent {
  return {
    deltaY,
    deltaMode: 0,
    timeStamp: 500,
    preventDefault() {},
  } as WheelEvent;
}

test('turns one page for an unzoomed wheel gesture', () => {
  withAnimationFrames(flush => {
    let index = 0;
    const turns: number[] = [];
    const pager = createWheelPager({
      getCurrentIndex: () => index,
      isCurrentZoomed: () => false,
      goTo: target => { index = target; turns.push(target); },
      stopMotion: () => {},
      isPageLoading: () => true,
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
      isPageLoading: () => false,
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
