/**
 * Velocity-driven wheel paging for PhotoSwipe.
 *
 * Each wheel event feeds a signed velocity that a per-frame ticker decays and
 * converts into single-page turns (±1 only). Velocity is topped up only while
 * the wheel moves, so paging halts a few frames after lift-off.
 */

export interface WheelPagerConfig {
  /** Returns the active PhotoSwipe instance (or null if destroyed). */
  getPswp: () => any;

  /** Check if a specific index is still loading. */
  isPageLoading: (index: number) => boolean;

  /** Called when scrolling forward past the last image. */
  onEdgeForward: () => void;

  /** Called when scrolling backward before the first image. */
  onEdgeBackward: () => void;

  /** Get the total number of images. */
  getImageCount: () => number;
}

export interface WheelPager {
  /** Attach to PhotoSwipe's wheel event. */
  onWheel: (e: any) => void;

  /** Stop the ticker and reset velocity. */
  stop: () => void;
}

const WHEEL_DECAY = 0.82;        // per-frame decay; ~100ms to halt after lift-off
const MIN_VELOCITY = 20;         // dead zone: below this the ticker stops
const MAX_VELOCITY = 150;        // velocity reaching the fastest cadence (measured: a quick wheel spin peaks ~150)
const TURN_INTERVAL_SLOW = 150;  // ms/turn at MIN_VELOCITY (a single wheel notch)
const TURN_INTERVAL_FAST = 50;   // ms/turn at MAX_VELOCITY
const SCROLL_BUMP_MULTIPLIER = 2.5; // interval ×N while the next page is still loading

export function createWheelPager(config: WheelPagerConfig): WheelPager {
  let wheelVelocity = 0;
  let scrollRafId: number | null = null;
  let lastTurnTime = 0;

  function stop(): void {
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
    wheelVelocity = 0;
  }

  function scrollTick(now: number): void {
    scrollRafId = null;
    const pswp = config.getPswp();
    if (!pswp) {
      wheelVelocity = 0;
      return;
    }

    // Decay every frame; only live scrolling replenishes it, so paging halts on lift-off.
    wheelVelocity *= WHEEL_DECAY;
    if (Math.abs(wheelVelocity) < MIN_VELOCITY) {
      wheelVelocity = 0;
      return;
    }

    const dir = wheelVelocity > 0 ? 1 : -1;
    const v = Math.min(MAX_VELOCITY, Math.abs(wheelVelocity));
    // sqrt easing: low velocity ramps to a fast cadence quickly so paging stays responsive.
    const t = Math.sqrt((v - MIN_VELOCITY) / (MAX_VELOCITY - MIN_VELOCITY));
    let interval = TURN_INTERVAL_SLOW + t * (TURN_INTERVAL_FAST - TURN_INTERVAL_SLOW);

    // Speed bump: slow the cadence hard when stepping into a still-loading page.
    const nextIdx = pswp.currIndex + dir;
    if (config.isPageLoading(nextIdx)) {
      interval *= SCROLL_BUMP_MULTIPLIER;
    }

    if (now - lastTurnTime >= interval) {
      const target = pswp.currIndex + dir;
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
      // @ts-ignore - PhotoSwipe internal
      if (pswp.mainScroll && pswp.mainScroll.stop) pswp.mainScroll.stop();
      pswp.goTo(target);
      lastTurnTime = now;
    }

    scrollRafId = requestAnimationFrame(scrollTick);
  }

  function onWheel(e: any): void {
    const pswp = config.getPswp();
    const slide = pswp?.currSlide;
    if (!slide) return;

    // Zoomed in: let PhotoSwipe pan natively.
    if (slide.currZoomLevel > slide.zoomLevels.initial) {
      return;
    }

    e.preventDefault();

    const event = e.originalEvent as WheelEvent;
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 33;
    else if (event.deltaMode === 2) delta *= window.innerHeight;

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
