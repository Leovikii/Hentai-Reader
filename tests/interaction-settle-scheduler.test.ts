import assert from 'node:assert/strict';
import test from 'node:test';
import { createInteractionSettleScheduler } from '../src/reader/controllers/interaction-settle-scheduler.ts';

function createHarness(blocked = false) {
  const frames: FrameRequestCallback[] = [];
  const timers: Array<() => void> = [];
  let nextId = 1;
  let isBlocked = blocked;
  let settled = 0;
  let blockedNotifications = 0;
  const scheduler = createInteractionSettleScheduler({
    isBlocked: () => isBlocked,
    onBlocked: () => { blockedNotifications++; },
    onSettled: () => { settled++; },
    burstFrames: 3,
    maxBlockedChecks: 5,
    requestFrame: callback => {
      frames.push(callback);
      return nextId++;
    },
    cancelFrame: () => {},
    setDelay: callback => {
      timers.push(callback);
      return nextId++;
    },
    clearDelay: () => {},
  });
  return {
    scheduler,
    frames,
    timers,
    setBlocked(value: boolean) { isBlocked = value; },
    get settled() { return settled; },
    get blockedNotifications() { return blockedNotifications; },
    runFrame() { frames.shift()?.(0); },
    runTimer() { timers.shift()?.(); },
  };
}

test('settles only after two consecutive idle frames', () => {
  const harness = createHarness();
  harness.scheduler.request();
  assert.equal(harness.frames.length, 1);
  harness.runFrame();
  assert.equal(harness.settled, 0);
  harness.runFrame();
  assert.equal(harness.settled, 1);
});

test('coalesces repeated requests without restarting a blocked RAF burst', () => {
  const harness = createHarness(true);
  harness.scheduler.request();
  harness.runFrame();
  harness.scheduler.request();
  harness.scheduler.request();
  assert.equal(harness.blockedNotifications, 1);
  harness.runFrame();
  harness.runFrame();
  assert.equal(harness.frames.length, 0);
  assert.equal(harness.timers.length, 1);
});

test('uses a bounded delayed tail and resumes with the idle-frame gate', () => {
  const harness = createHarness(true);
  harness.scheduler.request();
  harness.runFrame();
  harness.runFrame();
  harness.runFrame();
  assert.equal(harness.timers.length, 1);

  harness.setBlocked(false);
  harness.runTimer();
  harness.runFrame();
  assert.equal(harness.settled, 0);
  harness.runFrame();
  assert.equal(harness.settled, 1);
});

test('a new request resumes immediately once a delayed interaction has ended', () => {
  const harness = createHarness(true);
  harness.scheduler.request();
  harness.runFrame();
  harness.runFrame();
  harness.runFrame();
  assert.equal(harness.timers.length, 1);

  harness.setBlocked(false);
  harness.scheduler.request();
  assert.equal(harness.frames.length, 1);
  harness.runFrame();
  harness.runFrame();
  assert.equal(harness.settled, 1);
});

test('stops retrying when a blocked interaction never releases', () => {
  const harness = createHarness(true);
  harness.scheduler.request();
  harness.runFrame();
  harness.runFrame();
  harness.runFrame();
  harness.runTimer();
  harness.runFrame();
  harness.runTimer();
  harness.runFrame();
  assert.equal(harness.frames.length, 0);
  assert.equal(harness.timers.length, 0);
  assert.equal(harness.settled, 0);
  assert.equal(harness.blockedNotifications, 1);
});
