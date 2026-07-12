/**
 * Experience-first network limiter.
 *
 * Goal: cap *bursts* of concurrent requests to a host (so we don't look like an
 * abuser and don't trip 429/503 rate limits) WITHOUT making the reader feel
 * sluggish. It intentionally does NOT add artificial delay between requests —
 * the only throttling is a concurrency ceiling plus an explicit cooldown that is
 * activated *only* when the server actually pushes back (429/503).
 *
 * Foreground work (the image the user is currently looking at) can be given a
 * higher priority so it jumps ahead of bulk/prefetch work whenever a slot frees.
 */

interface Job<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  priority: number;
  seq: number;
}

export interface LimiterClock {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
}

const systemClock: LimiterClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (id) => clearTimeout(id),
};

export class NetLimiter {
  private queue: Job<unknown>[] = [];
  private active = 0;
  private pausedUntil = 0;
  private seq = 0;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxConcurrent: number;
  private readonly clock: LimiterClock;

  constructor(maxConcurrent: number, clock: LimiterClock = systemClock) {
    this.maxConcurrent = maxConcurrent;
    this.clock = clock;
  }

  /**
   * Schedule a network task. Higher `priority` runs first when a slot frees;
   * ties fall back to FIFO so ordering stays predictable.
   */
  run<T>(task: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        priority,
        seq: this.seq++,
      });
      this.pump();
    });
  }

  /** Back off globally for `ms` — used when the server returns 429/503. */
  pauseFor(ms: number): void {
    const until = this.clock.now() + ms;
    if (until <= this.pausedUntil) return;
    this.pausedUntil = until;
    this.schedulePauseWake(true);
  }

  /**
   * Drop still-queued jobs matching `predicate` (already-running jobs are left
   * alone — they can't be un-fetched). Used on a large jump: the resolves queued
   * for the abandoned position are cancelled so their slots free up immediately
   * for the new position instead of draining in insertion order. Rejected jobs
   * settle so awaiting callers don't hang.
   */
  cancel(predicate: (priority: number, seq: number) => boolean): void {
    if (this.queue.length === 0) return;
    const kept: Job<unknown>[] = [];
    for (const job of this.queue) {
      if (predicate(job.priority, job.seq)) {
        job.reject({ cancelled: true });
      } else {
        kept.push(job);
      }
    }
    this.queue = kept;
  }

  private pump(): void {
    const now = this.clock.now();
    if (now < this.pausedUntil) {
      this.schedulePauseWake();
      return;
    }

    if (this.pauseTimer !== null) {
      this.clock.clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }

    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      // Pick the highest-priority job, breaking ties by insertion order (FIFO).
      let bestIdx = 0;
      for (let i = 1; i < this.queue.length; i++) {
        const cand = this.queue[i];
        const best = this.queue[bestIdx];
        if (cand.priority > best.priority || (cand.priority === best.priority && cand.seq < best.seq)) {
          bestIdx = i;
        }
      }
      const job = this.queue.splice(bestIdx, 1)[0];
      this.active++;

      Promise.resolve().then(() => job.run()).then(
        value => { job.resolve(value); this.active--; this.pump(); },
        reason => { job.reject(reason); this.active--; this.pump(); },
      );
    }
  }

  private schedulePauseWake(reschedule = false): void {
    if (reschedule && this.pauseTimer !== null) {
      this.clock.clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    if (this.pauseTimer !== null) return;

    const delay = Math.max(0, this.pausedUntil - this.clock.now() + 10);
    this.pauseTimer = this.clock.setTimeout(() => {
      this.pauseTimer = null;
      this.pump();
    }, delay);
  }
}
