interface MaterializeJob<T> {
  key: string;
  priority: number;
  sequence: number;
  signal: AbortSignal;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  onAbort: () => void;
}

/** Bounded, keyed priority queue for network/CPU materialization work. */
export class MaterializeScheduler {
  private readonly maxConcurrent: number;
  private queue: MaterializeJob<unknown>[] = [];
  private active = 0;
  private sequence = 0;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  run<T>(
    key: string,
    task: () => Promise<T>,
    priority: number,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) return Promise.reject(new DOMException('Materialization cancelled', 'AbortError'));

    return new Promise<T>((resolve, reject) => {
      const job: MaterializeJob<T> = {
        key,
        priority,
        sequence: this.sequence++,
        signal,
        task,
        resolve,
        reject,
        onAbort: () => {},
      };
      job.onAbort = () => {
        const index = this.queue.indexOf(job as MaterializeJob<unknown>);
        if (index === -1) return;
        this.queue.splice(index, 1);
        reject(new DOMException('Materialization cancelled', 'AbortError'));
      };
      signal.addEventListener('abort', job.onAbort, { once: true });
      this.queue.push(job as MaterializeJob<unknown>);
      this.pump();
    });
  }

  promote(key: string, priority: number): void {
    for (const job of this.queue) {
      if (job.key === key && priority > job.priority) job.priority = priority;
    }
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      let bestIndex = 0;
      for (let index = 1; index < this.queue.length; index++) {
        const candidate = this.queue[index];
        const best = this.queue[bestIndex];
        if (candidate.priority > best.priority
            || (candidate.priority === best.priority && candidate.sequence < best.sequence)) {
          bestIndex = index;
        }
      }

      const job = this.queue.splice(bestIndex, 1)[0];
      job.signal.removeEventListener('abort', job.onAbort);
      if (job.signal.aborted) {
        job.reject(new DOMException('Materialization cancelled', 'AbortError'));
        continue;
      }

      this.active++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }
}

