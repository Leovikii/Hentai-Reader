export interface ResolvedImage {
  src: string;
  /**
   * Reliable display-source dimensions known before its bytes finish loading.
   * This is metadata only and must never be used to skip the byte-load step.
   */
  sourceDimensions?: {
    width: number;
    height: number;
  };
  /** Opaque token for resolving an alternate source after this source fails. */
  retryToken?: string;
  /** Optional deadline for one byte-load attempt; adapters choose the policy. */
  loadTimeoutMs?: number;
  /** Opaque adapter-owned data consumed by its optional materializer. */
  materializeData?: unknown;
  /** True only when the resolver transfers object-URL ownership to the loader. */
  ownsObjectUrl?: boolean;
  /** Exact managed Blob bytes when ownership is transferred to the loader. */
  byteSize?: number;
  /**
   * Reliable dimensions when a materializer has already decoded the source.
   * The shared loader may use these to avoid immediately decoding its freshly
   * generated Blob a second time before a visible consumer mounts it.
   */
  decodedDimensions?: {
    width: number;
    height: number;
  };
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
  | 'switching-source'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'cancelled';
