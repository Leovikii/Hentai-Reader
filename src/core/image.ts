export interface ResolvedImage {
  src: string;
  /** Opaque token for resolving an alternate source after this source fails. */
  retryToken?: string;
  /** Optional deadline for one byte-load attempt; adapters choose the policy. */
  loadTimeoutMs?: number;
  /** Opaque adapter-owned data consumed by its optional materializer. */
  materializeData?: unknown;
  /** True only when the resolver transfers object-URL ownership to the loader. */
  ownsObjectUrl?: boolean;
}

export interface LoadedImage extends ResolvedImage {
  width: number;
  height: number;
}

export type ImageLoadIntent =
  | 'foreground'
  | 'neighbor'
  | 'scroll'
  | 'thumbnail'
  | 'warmup';

export type ImageLoadPhase =
  | 'idle'
  | 'resolving'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'cancelled';
