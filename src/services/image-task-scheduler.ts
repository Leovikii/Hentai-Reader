export type ImageTaskLane = 'foreground' | 'background';

export interface ImageTaskLimits {
  total: number;
  background: number;
}

export interface ImageTaskRunOptions {
  priority: number;
  lane: ImageTaskLane;
  signal: AbortSignal;
}

interface ImageTaskJob<T> {
  key: string;
  priority: number;
  lane: ImageTaskLane;
  sequence: number;
  signal: AbortSignal;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  onAbort: () => void;
}

export interface ImageTaskSchedulerStats {
  active: number;
  activeBackground: number;
  queued: number;
  queuedBackground: number;
}

const DEFAULT_LIMITS: ImageTaskLimits = { total: 4, background: 2 };

/**
 * Priority gate for complete image lifecycles.
 *
 * Background work can never consume every slot, so a current single page or
 * both pages in a spread can start without waiting behind queued speculation.
 */
export class ImageTaskScheduler {
  private readonly getLimits: () => ImageTaskLimits;
  private readonly queue: ImageTaskJob<unknown>[] = [];
  private readonly activeJobs = new Set<ImageTaskJob<unknown>>();
  private sequence = 0;
  private activeBackground = 0;

  constructor(getLimits: () => ImageTaskLimits = () => DEFAULT_LIMITS) {
    this.getLimits = getLimits;
  }

  run<T>(
    key: string,
    task: () => Promise<T>,
    options: ImageTaskRunOptions,
  ): Promise<T> {
    if (options.signal.aborted) {
      return Promise.reject(new DOMException('Image task cancelled', 'AbortError'));
    }

    return new Promise<T>((resolve, reject) => {
      const job: ImageTaskJob<T> = {
        key,
        priority: options.priority,
        lane: options.lane,
        sequence: this.sequence++,
        signal: options.signal,
        task,
        resolve,
        reject,
        onAbort: () => {},
      };
      job.onAbort = () => {
        const index = this.queue.indexOf(job as ImageTaskJob<unknown>);
        if (index === -1) return;
        this.queue.splice(index, 1);
        reject(new DOMException('Image task cancelled', 'AbortError'));
      };
      options.signal.addEventListener('abort', job.onAbort, { once: true });
      this.queue.push(job as ImageTaskJob<unknown>);
      this.pump();
    });
  }

  /** Promote a shared queued/running task when live demand adopts it. */
  promote(key: string, priority: number, lane: ImageTaskLane = 'foreground'): void {
    for (const job of this.queue) {
      if (job.key !== key) continue;
      if (priority > job.priority) job.priority = priority;
      if (lane === 'foreground') job.lane = 'foreground';
    }

    for (const job of this.activeJobs) {
      if (job.key !== key) continue;
      if (priority > job.priority) job.priority = priority;
      if (lane === 'foreground' && job.lane === 'background') {
        job.lane = 'foreground';
        this.activeBackground--;
      }
    }
    this.pump();
  }

  /** Re-evaluate queued work after visibility or network policy changes. */
  notifyLimitsChanged(): void {
    this.pump();
  }

  getStats(): ImageTaskSchedulerStats {
    return {
      active: this.activeJobs.size,
      activeBackground: this.activeBackground,
      queued: this.queue.length,
      queuedBackground: this.queue.filter(job => job.lane === 'background').length,
    };
  }

  private normalizedLimits(): ImageTaskLimits {
    const limits = this.getLimits();
    const total = Math.max(1, Math.floor(limits.total));
    return {
      total,
      background: Math.max(0, Math.min(total, Math.floor(limits.background))),
    };
  }

  private pump(): void {
    const limits = this.normalizedLimits();
    while (this.activeJobs.size < limits.total) {
      let bestIndex = -1;
      for (let index = 0; index < this.queue.length; index++) {
        const candidate = this.queue[index];
        if (candidate.lane === 'background' && this.activeBackground >= limits.background) continue;
        if (bestIndex === -1) {
          bestIndex = index;
          continue;
        }
        const best = this.queue[bestIndex];
        if (candidate.priority > best.priority
            || (candidate.priority === best.priority && candidate.sequence < best.sequence)) {
          bestIndex = index;
        }
      }
      if (bestIndex === -1) return;

      const job = this.queue.splice(bestIndex, 1)[0];
      job.signal.removeEventListener('abort', job.onAbort);
      if (job.signal.aborted) {
        job.reject(new DOMException('Image task cancelled', 'AbortError'));
        continue;
      }

      this.activeJobs.add(job);
      if (job.lane === 'background') this.activeBackground++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
        this.activeJobs.delete(job);
        if (job.lane === 'background') this.activeBackground--;
        this.pump();
      });
    }
  }
}

