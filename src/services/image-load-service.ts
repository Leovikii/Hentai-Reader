import type {
  ImageLoadIntent,
  ImageLoadPhase,
  LoadedImage,
  ResolvedImage,
} from '../core/image';
import type { ImageResolveContext } from '../core/site-adapter';

export interface ImageAcquireOptions {
  intent: ImageLoadIntent;
  priority: number;
}

export interface ImageLoadLease {
  readonly url: string;
  readonly result: Promise<LoadedImage | null>;
  readonly phase: ImageLoadPhase;
  subscribe(listener: (phase: ImageLoadPhase) => void): () => void;
  release(): void;
}

export interface ImageLoadServiceDeps {
  resolve: (
    url: string,
    context: ImageResolveContext,
  ) => Promise<ResolvedImage | null>;
  loadBytes: (
    src: string,
    signal: AbortSignal,
  ) => Promise<{ width: number; height: number }>;
  materialize?: (
    url: string,
    resolved: ResolvedImage,
    signal: AbortSignal,
    priority: number,
  ) => Promise<ResolvedImage | null>;
  promote?: (url: string, priority: number) => void;
  delay?: (ms: number) => Promise<void>;
  invalidateResolved?: (url: string, src: string) => void;
  setResolvedSource?: (url: string, src: string) => void;
  revokeObjectUrl?: (src: string) => void;
  onEvict?: (url: string, asset: LoadedImage) => void;
  onReady?: (url: string, asset: LoadedImage) => void;
}

export interface ImageLoadPolicy {
  resolveAttempts: number;
  alternateSourceRetries: number;
  freshResolveRetries: number;
  retryDelay: number;
  cacheEntries: number;
}

export interface ImageLoadServiceStats {
  activeLoads: number;
  cachedEntries: number;
  activeLeases: number;
  cachedLeases: number;
  leasedCacheEntries: number;
  ownedObjectUrls: number;
  phases: number;
  listeners: number;
}

const defaultPolicy: ImageLoadPolicy = {
  resolveAttempts: 4,
  alternateSourceRetries: 3,
  freshResolveRetries: 2,
  retryDelay: 1000,
  cacheEntries: 80,
};

interface ActiveLoad {
  controller: AbortController;
  leases: Set<symbol>;
  priority: number;
  result: Promise<LoadedImage | null>;
}

interface CacheEntry {
  asset: LoadedImage;
  leases: Set<symbol>;
}

/** Coordinates one resolve + byte-load lifecycle for every viewer URL. */
export class ImageLoadService {
  private readonly deps: ImageLoadServiceDeps;
  private readonly policy: ImageLoadPolicy;
  private readonly active = new Map<string, ActiveLoad>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly phases = new Map<string, ImageLoadPhase>();
  private readonly listeners = new Map<string, Set<(phase: ImageLoadPhase) => void>>();

  constructor(deps: ImageLoadServiceDeps, policy: Partial<ImageLoadPolicy> = {}) {
    this.deps = deps;
    this.policy = { ...defaultPolicy, ...policy };
  }

  acquire(url: string, options: ImageAcquireOptions): ImageLoadLease {
    const token = Symbol(options.intent);
    const cached = this.cache.get(url);
    if (cached) {
      this.touchCache(url, cached);
      cached.leases.add(token);
      this.setPhase(url, 'ready');
      return this.createLease(url, token, Promise.resolve(cached.asset));
    }

    let load = this.active.get(url);
    if (load) {
      load.leases.add(token);
      if (options.priority > load.priority) {
        load.priority = options.priority;
        this.deps.promote?.(url, options.priority);
      }
      return this.createLease(url, token, load.result);
    }

    const controller = new AbortController();
    load = {
      controller,
      leases: new Set([token]),
      priority: options.priority,
      result: Promise.resolve(null),
    };
    load.result = this.run(url, load)
      .finally(() => {
        if (this.active.get(url) === load) this.active.delete(url);
      });
    this.active.set(url, load);
    return this.createLease(url, token, load.result);
  }

  getPhase(url: string): ImageLoadPhase {
    return this.phases.get(url) ?? 'idle';
  }

  getCached(url: string): LoadedImage | undefined {
    return this.cache.get(url)?.asset;
  }

  getLatestCached(): LoadedImage | undefined {
    let latest: LoadedImage | undefined;
    for (const entry of this.cache.values()) latest = entry.asset;
    return latest;
  }

  /** Computes a point-in-time diagnostic snapshot without tracking extra state. */
  getStats(): ImageLoadServiceStats {
    let activeLeases = 0;
    let cachedLeases = 0;
    let leasedCacheEntries = 0;
    let ownedObjectUrls = 0;
    let listeners = 0;

    for (const load of this.active.values()) activeLeases += load.leases.size;
    for (const entry of this.cache.values()) {
      cachedLeases += entry.leases.size;
      if (entry.leases.size > 0) leasedCacheEntries++;
      if (entry.asset.ownsObjectUrl) ownedObjectUrls++;
    }
    for (const subscribers of this.listeners.values()) listeners += subscribers.size;

    return {
      activeLoads: this.active.size,
      cachedEntries: this.cache.size,
      activeLeases,
      cachedLeases,
      leasedCacheEntries,
      ownedObjectUrls,
      phases: this.phases.size,
      listeners,
    };
  }

  private async run(url: string, load: ActiveLoad): Promise<LoadedImage | null> {
    const signal = load.controller.signal;
    let resolved: ResolvedImage | null = null;

    for (let attempt = 0; attempt < this.policy.resolveAttempts && !signal.aborted; attempt++) {
      this.setPhase(url, 'resolving');
      const candidate = await this.resolve(url, undefined, attempt > 0, load);
      resolved = await this.materialize(url, candidate, load);
      if (resolved?.src) break;
      if (attempt + 1 < this.policy.resolveAttempts) await this.wait(signal);
    }

    if (!resolved?.src || signal.aborted) {
      this.discard(url, resolved);
      return this.finishWithoutAsset(url, signal);
    }

    let loaded = await this.tryLoad(url, resolved, load);
    let retryToken = resolved.retryToken;
    const alternateCandidates = new Set([this.candidateKey(resolved)]);

    for (let attempt = 0;
      !loaded && retryToken && attempt < this.policy.alternateSourceRetries && !signal.aborted;
      attempt++) {
      const candidate = await this.resolve(url, retryToken, true, load);
      const next = await this.materialize(url, candidate, load);
      if (!next?.src) break;
      const candidateKey = this.candidateKey(next);
      if (alternateCandidates.has(candidateKey)) {
        this.discard(url, next);
        break;
      }
      alternateCandidates.add(candidateKey);
      this.discard(url, resolved);
      retryToken = next.retryToken;
      resolved = next;
      loaded = await this.tryLoad(url, next, load);
    }

    for (let attempt = 0;
      !loaded && attempt < this.policy.freshResolveRetries && !signal.aborted;
      attempt++) {
      await this.wait(signal);
      if (signal.aborted) break;
      const candidate = await this.resolve(url, undefined, true, load);
      const next = await this.materialize(url, candidate, load);
      if (!next?.src) continue;
      this.discard(url, resolved);
      resolved = next;
      loaded = await this.tryLoad(url, next, load);
    }

    if (!loaded || signal.aborted) {
      this.discard(url, resolved);
      return this.finishWithoutAsset(url, signal);
    }

    const asset: LoadedImage = {
      ...resolved,
      width: loaded.width,
      height: loaded.height,
    };
    this.cache.set(url, { asset, leases: load.leases });
    this.deps.setResolvedSource?.(url, asset.src);
    try {
      this.deps.onReady?.(url, asset);
    } catch {
      // Asset publication must not turn a successful image load into failure.
    }
    this.touchCache(url, this.cache.get(url)!);
    this.setPhase(url, 'ready');
    this.trimCache();
    return asset;
  }

  private async tryLoad(
    url: string,
    resolved: ResolvedImage,
    load: ActiveLoad,
  ): Promise<{ width: number; height: number } | null> {
    if (load.controller.signal.aborted) return null;
    this.setPhase(url, 'downloading');
    const parentSignal = load.controller.signal;
    const attemptController = new AbortController();
    const abortAttempt = () => attemptController.abort();
    parentSignal.addEventListener('abort', abortAttempt, { once: true });
    const timeout = resolved.loadTimeoutMs && resolved.loadTimeoutMs > 0
      ? setTimeout(abortAttempt, resolved.loadTimeoutMs)
      : null;
    try {
      return await this.deps.loadBytes(resolved.src, attemptController.signal);
    } catch {
      return null;
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      parentSignal.removeEventListener('abort', abortAttempt);
    }
  }

  private async resolve(
    url: string,
    retryToken: string | undefined,
    force: boolean,
    load: ActiveLoad,
  ): Promise<ResolvedImage | null> {
    try {
      return await this.deps.resolve(url, {
        retryToken,
        force,
        priority: load.priority,
        signal: load.controller.signal,
      });
    } catch {
      return null;
    }
  }

  private candidateKey(resolved: ResolvedImage): string {
    return `${resolved.src}\u0000${resolved.retryToken ?? ''}`;
  }

  private async materialize(
    url: string,
    resolved: ResolvedImage | null,
    load: ActiveLoad,
  ): Promise<ResolvedImage | null> {
    if (!resolved?.src || load.controller.signal.aborted) return resolved;
    if (!this.deps.materialize) return resolved;
    try {
      const materialized = await this.deps.materialize(
        url,
        resolved,
        load.controller.signal,
        load.priority,
      );
      if (!materialized) this.discard(url, resolved);
      return materialized;
    } catch {
      this.discard(url, resolved);
      return null;
    }
  }

  private discard(url: string, resolved: ResolvedImage | null): void {
    if (!resolved?.ownsObjectUrl) return;
    this.deps.invalidateResolved?.(url, resolved.src);
    this.deps.revokeObjectUrl?.(resolved.src);
  }

  private finishWithoutAsset(url: string, signal: AbortSignal): null {
    this.setPhase(url, signal.aborted ? 'cancelled' : 'error');
    return null;
  }

  private async wait(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const delay = this.deps.delay ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    await new Promise<void>(resolve => {
      const finish = () => {
        signal.removeEventListener('abort', finish);
        resolve();
      };
      signal.addEventListener('abort', finish, { once: true });
      delay(this.policy.retryDelay).then(finish, finish);
    });
  }

  private createLease(
    url: string,
    token: symbol,
    result: Promise<LoadedImage | null>,
  ): ImageLoadLease {
    let released = false;
    const ownedListeners = new Set<(phase: ImageLoadPhase) => void>();
    const service = this;
    return {
      url,
      result,
      get phase() { return service.getPhase(url); },
      subscribe(listener) {
        let listeners = service.listeners.get(url);
        if (!listeners) {
          listeners = new Set();
          service.listeners.set(url, listeners);
        }
        listeners.add(listener);
        ownedListeners.add(listener);
        listener(service.getPhase(url));
        return () => {
          listeners!.delete(listener);
          ownedListeners.delete(listener);
          if (listeners!.size === 0) service.listeners.delete(url);
        };
      },
      release() {
        if (released) return;
        released = true;
        for (const listener of ownedListeners) service.listeners.get(url)?.delete(listener);
        ownedListeners.clear();
        if (service.listeners.get(url)?.size === 0) service.listeners.delete(url);
        service.release(url, token);
      },
    };
  }

  private release(url: string, token: symbol): void {
    const active = this.active.get(url);
    if (active?.leases.delete(token) && active.leases.size === 0) {
      active.controller.abort();
      this.active.delete(url);
      this.setPhase(url, 'cancelled');
      return;
    }

    const cached = this.cache.get(url);
    if (cached?.leases.delete(token)) this.trimCache();
  }

  private setPhase(url: string, phase: ImageLoadPhase): void {
    if (this.phases.get(url) === phase) return;
    this.phases.set(url, phase);
    this.listeners.get(url)?.forEach(listener => listener(phase));
  }

  private touchCache(url: string, entry: CacheEntry): void {
    this.cache.delete(url);
    this.cache.set(url, entry);
  }

  private trimCache(): void {
    if (this.cache.size <= this.policy.cacheEntries) return;
    for (const [url, entry] of this.cache) {
      if (this.cache.size <= this.policy.cacheEntries) break;
      if (entry.leases.size > 0) continue;
      this.cache.delete(url);
      this.deps.invalidateResolved?.(url, entry.asset.src);
      this.deps.onEvict?.(url, entry.asset);
      if (entry.asset.ownsObjectUrl) {
        this.deps.revokeObjectUrl?.(entry.asset.src);
      }
      if (!this.active.has(url)) this.phases.delete(url);
    }
  }
}
