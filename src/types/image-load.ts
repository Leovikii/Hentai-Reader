export interface ResolvedImage {
  src: string;
  nl?: string;
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
  | 'ready'
  | 'error'
  | 'cancelled';

export interface ImageLoadDiagnostics {
  resolveStarted: number;
  resolveDeduped: number;
  resolveForced: number;
  resolveSucceeded: number;
  resolveFailed: number;
  priorityPromoted: number;
}
