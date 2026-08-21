import type { ReaderAppContext } from '../contracts';

const AUTO_PLAY_INTERVAL_MIN_MS = 1000;

export interface AutoPlayHandle {
  start: () => void;
  stop: () => void;
  reset: () => void;
  stopAtEnd: () => void;
}

/** Owns the reader's session-scoped autoplay timer. */
export function createAutoPlay(
  nextImageFn: () => void,
  context: ReaderAppContext,
): AutoPlayHandle {
  let timer: ReturnType<typeof setInterval> | null = null;

  function start(): void {
    if (timer) clearInterval(timer);
    if (context.isAutoPlayEnabled()) {
      timer = setInterval(
        nextImageFn,
        Math.max(AUTO_PLAY_INTERVAL_MIN_MS, context.getAutoPlayInterval()),
      );
    }
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function reset(): void {
    if (context.isAutoPlayEnabled()) {
      stop();
      start();
    }
  }

  function stopAtEnd(): void {
    context.setAutoPlayEnabled(false);
    stop();
  }

  return { start, stop, reset, stopAtEnd };
}
