export interface InteractionSettleSchedulerOptions {
  isBlocked: () => boolean;
  onBlocked?: () => void;
  onSettled: () => void;
  requiredIdleFrames?: number;
  burstFrames?: number;
  retryDelayMs?: number;
  maxBlockedChecks?: number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  setDelay?: (callback: () => void, delayMs: number) => number;
  clearDelay?: (id: number) => void;
}

export interface InteractionSettleScheduler {
  request(): void;
  cancel(): void;
}

/**
 * Coalesces structural Reader refreshes until PhotoSwipe has been idle for a
 * stable number of frames. A short RAF burst keeps normal transitions smooth;
 * a bounded, low-frequency retry tail prevents a stuck animation flag from
 * consuming every frame indefinitely.
 */
export function createInteractionSettleScheduler(
  options: InteractionSettleSchedulerOptions,
): InteractionSettleScheduler {
  const requiredIdleFrames = options.requiredIdleFrames ?? 2;
  const burstFrames = options.burstFrames ?? 8;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const maxBlockedChecks = options.maxBlockedChecks ?? 40;
  const requestFrame = options.requestFrame ?? requestAnimationFrame;
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame;
  const setDelay = options.setDelay ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
  const clearDelay = options.clearDelay ?? (id => window.clearTimeout(id));

  let requested = false;
  let frameId = 0;
  let timerId: number | undefined;
  let idleFrames = 0;
  let blockedChecks = 0;
  let blockedNotified = false;

  function clearScheduled(): void {
    if (frameId) {
      cancelFrame(frameId);
      frameId = 0;
    }
    if (timerId !== undefined) {
      clearDelay(timerId);
      timerId = undefined;
    }
  }

  function scheduleFrame(): void {
    if (!requested || frameId || timerId !== undefined) return;
    frameId = requestFrame(run);
  }

  function scheduleDelayedFrame(): void {
    if (!requested || frameId || timerId !== undefined) return;
    timerId = setDelay(() => {
      timerId = undefined;
      scheduleFrame();
    }, retryDelayMs);
  }

  function run(): void {
    frameId = 0;
    if (!requested) return;

    if (options.isBlocked()) {
      idleFrames = 0;
      blockedChecks++;
      if (!blockedNotified) {
        blockedNotified = true;
        options.onBlocked?.();
      }
      if (blockedChecks >= maxBlockedChecks) {
        requested = false;
        return;
      }
      if (blockedChecks < burstFrames) scheduleFrame();
      else scheduleDelayedFrame();
      return;
    }

    blockedChecks = 0;
    idleFrames++;
    if (idleFrames < requiredIdleFrames) {
      scheduleFrame();
      return;
    }

    requested = false;
    idleFrames = 0;
    blockedNotified = false;
    options.onSettled();
  }

  return {
    request() {
      if (!requested) {
        requested = true;
        idleFrames = 0;
        blockedChecks = 0;
        blockedNotified = false;
      } else {
        // A new source/layout event restarts only the consecutive-idle gate.
        // It must not restart a blocked RAF burst and recreate frame starvation.
        idleFrames = 0;
        if (timerId !== undefined && !options.isBlocked()) {
          clearDelay(timerId);
          timerId = undefined;
        }
      }
      scheduleFrame();
    },
    cancel() {
      requested = false;
      idleFrames = 0;
      blockedChecks = 0;
      blockedNotified = false;
      clearScheduled();
    },
  };
}
