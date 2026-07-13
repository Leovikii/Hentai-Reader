export interface ResolvedImage {
  src: string;
  nl?: string;
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
