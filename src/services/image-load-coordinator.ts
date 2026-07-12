import type { ResolvedImage, ImageLoadDiagnostics } from '../types/image-load';

export interface ImageResolver {
  resolveImage: (url: string, ...args: any[]) => Promise<ResolvedImage | null>;
  bumpPriority?: (url: string) => void;
}

export interface ImageLoadCoordinatorDeps {
  getResolver: () => ImageResolver | null;
  getCachedSource: (url: string) => string | undefined;
  setCachedSource: (url: string, src: string) => void;
}

const emptyDiagnostics = (): ImageLoadDiagnostics => ({
  resolveStarted: 0,
  resolveDeduped: 0,
  resolveForced: 0,
  resolveSucceeded: 0,
  resolveFailed: 0,
  priorityPromoted: 0,
});

/**
 * Behavior-preserving coordinator for the resolve stage. The byte-load and
 * display stages remain with their current consumers until the next migration.
 */
export class ImageLoadCoordinator {
  private readonly inFlight = new Map<string, Promise<ResolvedImage | null>>();
  private readonly inFlightForce = new Map<string, Promise<ResolvedImage | null>>();
  private readonly latestGeneration = new Map<string, number>();
  private readonly cachedGeneration = new Map<string, number>();
  private readonly diagnostics = emptyDiagnostics();
  private readonly deps: ImageLoadCoordinatorDeps;

  constructor(deps: ImageLoadCoordinatorDeps) {
    this.deps = deps;
  }

  resolve(
    url: string,
    nlToken?: string,
    force = false,
    priority = 0,
  ): Promise<ResolvedImage | null> {
    if (!force) {
      const cached = this.deps.getCachedSource(url);
      if (cached) return Promise.resolve({ src: cached });
    } else {
      this.diagnostics.resolveForced++;
    }

    const map = force ? this.inFlightForce : this.inFlight;
    if (force) {
      const pendingForce = map.get(url);
      if (pendingForce) {
        this.diagnostics.resolveDeduped++;
        this.promote(url);
        return pendingForce;
      }
    } else {
      // Preserve the legacy preference for a force refresh when both a normal
      // resolve and a fresher force resolve happen to be active concurrently.
      const pending = this.inFlightForce.get(url) || this.inFlight.get(url);
      if (pending) {
        this.diagnostics.resolveDeduped++;
        this.promote(url);
        return pending;
      }
    }

    const resolver = this.deps.getResolver();
    if (!resolver) return Promise.resolve(null);

    const generation = (this.latestGeneration.get(url) ?? 0) + 1;
    this.latestGeneration.set(url, generation);
    this.diagnostics.resolveStarted++;
    const task = (async () => {
      try {
        const result = await resolver.resolveImage(url, nlToken, priority);
        if (!result?.src) {
          this.diagnostics.resolveFailed++;
          return null;
        }
        // A force refresh may start after an ordinary resolve but finish first.
        // Never let that older ordinary task overwrite the fresher cached node.
        if (generation >= (this.cachedGeneration.get(url) ?? 0)) {
          this.deps.setCachedSource(url, result.src);
          this.cachedGeneration.set(url, generation);
        }
        this.diagnostics.resolveSucceeded++;
        return result;
      } catch {
        this.diagnostics.resolveFailed++;
        return null;
      } finally {
        map.delete(url);
      }
    })();

    map.set(url, task);
    return task;
  }

  getDiagnostics(): ImageLoadDiagnostics {
    return { ...this.diagnostics };
  }

  private promote(url: string): void {
    const bumpPriority = this.deps.getResolver()?.bumpPriority;
    if (!bumpPriority) return;
    bumpPriority(url);
    this.diagnostics.priorityPromoted++;
  }
}
