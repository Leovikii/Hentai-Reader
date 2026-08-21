import type { ReaderAppContext } from '../contracts';

const AUTO_PLAY_INTERVAL_MIN_MS = 1000;
export const AUTO_PLAY_LOAD_GRACE_MS = 5000;

export interface AutoPlayHandle {
  start: () => void;
  stop: () => void;
  reset: () => void;
  stopAtEnd: () => void;
}

/** Owns the reader's session-scoped autoplay timer. */
export function createAutoPlay(
  nextImageFn: () => void,
  isCurrentContentLoaded: () => boolean,
  context: ReaderAppContext,
): AutoPlayHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waitingForLoadGrace = false;

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(delay: number): void {
    clearTimer();
    if (!context.isAutoPlayEnabled()) return;
    timer = setTimeout(onTimeout, delay);
  }

  function onTimeout(): void {
    timer = null;
    if (!context.isAutoPlayEnabled()) {
      waitingForLoadGrace = false;
      return;
    }
    if (!waitingForLoadGrace && !isCurrentContentLoaded()) {
      waitingForLoadGrace = true;
      schedule(AUTO_PLAY_LOAD_GRACE_MS);
      return;
    }

    waitingForLoadGrace = false;
    nextImageFn();
    // A successful navigation resets the timer through the Reader change
    // event. If next() is temporarily a no-op while pagination catches up,
    // keep one fallback timer alive without creating a second interval.
    if (context.isAutoPlayEnabled()) {
      schedule(Math.max(AUTO_PLAY_INTERVAL_MIN_MS, context.getAutoPlayInterval()));
    }
  }

  function start(): void {
    waitingForLoadGrace = false;
    schedule(Math.max(AUTO_PLAY_INTERVAL_MIN_MS, context.getAutoPlayInterval()));
  }

  function stop(): void {
    waitingForLoadGrace = false;
    clearTimer();
  }

  function reset(): void {
    if (context.isAutoPlayEnabled()) {
      stop();
      start();
    }
  }

  function stopAtEnd(): void {
    stop();
    context.setAutoPlayEnabled(false);
  }

  return { start, stop, reset, stopAtEnd };
}
