/**
 * Velocity-driven wheel paging for PhotoSwipe.
 *
 * Each wheel event feeds a signed velocity that a per-frame ticker decays and
 * converts into single-page turns (±1 only). Velocity is topped up only while
 * the wheel moves, so paging halts a few frames after lift-off.
 */

export interface WheelPagerConfig {
  getCurrentIndex: () => number;
  isCurrentZoomed: () => boolean;
  goTo: (index: number) => void;
  stopMotion: () => void;
  isPageLoading: (index: number) => boolean;
  onEdgeForward: () => void;
  onEdgeBackward: () => void;
  getImageCount: () => number;
}

export interface WheelPager {
  onWheel: (event: WheelEvent) => void;
  stop: () => void;
}

const WHEEL_DECAY = 0.82;        // per-frame decay; ~100ms to halt after lift-off
const MIN_VELOCITY = 20;         // dead zone: below this the ticker stops
const MAX_VELOCITY = 150;        // velocity reaching the fastest cadence (measured: a quick wheel spin peaks ~150)
const TURN_INTERVAL_SLOW = 150;  // ms/turn at MIN_VELOCITY (a single wheel notch)
const TURN_INTERVAL_FAST = 50;   // ms/turn at MAX_VELOCITY
const GESTURE_GAP = 150;         // ms between wheel events that starts a new gesture

export function createWheelPager(config: WheelPagerConfig): WheelPager {
  let wheelVelocity = 0;
  let scrollRafId: number | null = null;
  let lastTurnTime = 0;
  // Loading-frontier latch: set when a gesture reaches a still-loading image,
  // cleared only by a new gesture (see onWheel). While set, no turns fire.
  let gestureConsumed = false;
  let lastWheelTime = 0;

  function stop(): void {
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
    wheelVelocity = 0;
  }

  function scrollTick(now: number): void {
    scrollRafId = null;
    // Decay every frame; only live scrolling replenishes it, so paging halts on lift-off.
    wheelVelocity *= WHEEL_DECAY;
    if (Math.abs(wheelVelocity) < MIN_VELOCITY) {
      wheelVelocity = 0;
      return;
    }

    const dir = wheelVelocity > 0 ? 1 : -1;

    // Latched at the loading frontier: keep decaying velocity but turn nothing.
    if (gestureConsumed) {
      scrollRafId = requestAnimationFrame(scrollTick);
      return;
    }

    const v = Math.min(MAX_VELOCITY, Math.abs(wheelVelocity));
    // sqrt easing: low velocity ramps to a fast cadence quickly so paging stays responsive.
    const t = Math.sqrt((v - MIN_VELOCITY) / (MAX_VELOCITY - MIN_VELOCITY));
    const interval = TURN_INTERVAL_SLOW + t * (TURN_INTERVAL_FAST - TURN_INTERVAL_SLOW);

    if (now - lastTurnTime >= interval) {
      const target = config.getCurrentIndex() + dir;
      if (target < 0) {
        stop();
        config.onEdgeBackward();
        return;
      }
      if (target >= config.getImageCount()) {
        stop();
        config.onEdgeForward();
        return;
      }
      config.stopMotion();
      config.goTo(target);
      lastTurnTime = now;

      // Landed on a still-loading image: latch so one gesture advances only to
      // the frontier, not past it. User must lift off and scroll again.
      if (config.isPageLoading(target)) {
        gestureConsumed = true;
      }
    }

    scrollRafId = requestAnimationFrame(scrollTick);
  }

  function onWheel(event: WheelEvent): void {
    // Zoomed in: let PhotoSwipe pan natively.
    if (config.isCurrentZoomed()) return;

    event.preventDefault();
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 33;
    else if (event.deltaMode === 2) delta *= window.innerHeight;

    // A gap since the last event marks a new gesture: clear the latch. Continuous
    // cranking stays under GESTURE_GAP, so the latch holds and blocks coasting through.
    const now = event.timeStamp;
    if (now - lastWheelTime > GESTURE_GAP) {
      gestureConsumed = false;
    }
    lastWheelTime = now;

    // Reversing direction cancels built-up velocity so a back-flick turns at once.
    if (Math.sign(delta) !== Math.sign(wheelVelocity) && wheelVelocity !== 0) {
      wheelVelocity = 0;
    }

    wheelVelocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, wheelVelocity + delta));

    if (scrollRafId === null) {
      scrollRafId = requestAnimationFrame(scrollTick);
    }
  }

  return { onWheel, stop };
}
