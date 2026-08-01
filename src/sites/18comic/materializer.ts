import type { ResolvedImage } from '../../core/image';

interface Comic18MaterializeData {
  kind: '18comic-scramble';
  aid: string;
  imageId: string;
}

interface BitmapLike {
  width: number;
  height: number;
  close(): void;
}

interface DrawContextLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(...args: any[]): void;
}

interface CanvasLike {
  getContext(contextId: '2d'): DrawContextLike | null;
  convertToBlob(options: { type: string; quality: number }): Promise<Blob>;
}

export interface Comic18MaterializerDeps {
  fetchBlob(src: string, signal: AbortSignal): Promise<Blob>;
  createBitmap(blob: Blob): Promise<BitmapLike>;
  createCanvas(width: number, height: number): CanvasLike;
  releaseCanvas?(canvas: CanvasLike): void;
  createObjectUrl(blob: Blob): string;
  getSegmentCount(aid: string, imageId: string): number | undefined;
}

function isMaterializeData(value: unknown): value is Comic18MaterializeData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<Comic18MaterializeData>;
  return data.kind === '18comic-scramble'
    && typeof data.aid === 'string'
    && typeof data.imageId === 'string';
}

/** Separates URL/metadata parsing from the expensive anti-scramble conversion. */
export function resolve18ComicSource(url: string): ResolvedImage {
  const parsed = new URL(url);
  const aid = parsed.searchParams.get('18aid');
  const scrambleId = parsed.searchParams.get('18scid');
  parsed.searchParams.delete('18aid');
  parsed.searchParams.delete('18scid');
  const src = parsed.toString();

  if (src.includes('.gif') || !aid || !scrambleId || Number(aid) < Number(scrambleId)) {
    return { src };
  }

  const fileName = parsed.pathname.split('/').pop() || '';
  const imageId = fileName.split('.')[0];
  if (!imageId) return { src };
  return {
    src,
    materializeData: { kind: '18comic-scramble', aid, imageId } satisfies Comic18MaterializeData,
  };
}

export async function materialize18ComicImage(
  resolved: ResolvedImage,
  signal: AbortSignal,
  deps: Comic18MaterializerDeps,
): Promise<ResolvedImage> {
  if (!isMaterializeData(resolved.materializeData)) return resolved;

  const { aid, imageId } = resolved.materializeData;
  const segments = deps.getSegmentCount(aid, imageId);
  if (!segments) throw new Error('18comic segment count is unavailable');
  // Avoid fetching and decoding sources that do not require rearrangement.
  if (segments <= 1) return { src: resolved.src };

  const sourceBlob = await deps.fetchBlob(resolved.src, signal);
  if (signal.aborted) throw new DOMException('Materialization cancelled', 'AbortError');
  const bitmap = await deps.createBitmap(sourceBlob);
  let canvas: CanvasLike | undefined;

  try {
    if (signal.aborted) throw new DOMException('Materialization cancelled', 'AbortError');
    canvas = deps.createCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('18comic 2D canvas context is unavailable');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, bitmap.width, bitmap.height);

    const remainder = bitmap.height % segments;
    const segmentHeight = Math.floor(bitmap.height / segments);
    let sourceY = bitmap.height - remainder - segmentHeight;
    let destinationY = remainder + segmentHeight;

    context.drawImage(
      bitmap,
      0,
      sourceY,
      bitmap.width,
      remainder + segmentHeight,
      0,
      0,
      bitmap.width,
      remainder + segmentHeight,
    );

    for (let index = 1; index < segments; index++) {
      sourceY -= segmentHeight;
      context.drawImage(
        bitmap,
        0,
        sourceY,
        bitmap.width,
        segmentHeight,
        0,
        destinationY,
        bitmap.width,
        segmentHeight,
      );
      destinationY += segmentHeight;
    }

    if (signal.aborted) throw new DOMException('Materialization cancelled', 'AbortError');
    const output = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    if (signal.aborted) throw new DOMException('Materialization cancelled', 'AbortError');
    return {
      src: deps.createObjectUrl(output),
      ownsObjectUrl: true,
      byteSize: output.size,
      decodedDimensions: { width: bitmap.width, height: bitmap.height },
    };
  } finally {
    if (canvas) deps.releaseCanvas?.(canvas);
    bitmap.close();
  }
}

export function create18ComicBrowserMaterializer(
  getSegmentCount: (aid: string, imageId: string) => number | undefined,
): (resolved: ResolvedImage, signal: AbortSignal) => Promise<ResolvedImage> {
  const deps: Comic18MaterializerDeps = {
    async fetchBlob(src, signal) {
      const response = await fetch(src, { signal });
      if (!response.ok) throw new Error(`Failed to fetch image: HTTP ${response.status}`);
      return response.blob();
    },
    createBitmap: blob => createImageBitmap(blob),
    createCanvas: (width, height) => new OffscreenCanvas(width, height) as unknown as CanvasLike,
    releaseCanvas: canvas => {
      const offscreen = canvas as unknown as OffscreenCanvas;
      // Drop the potentially very large backing store as soon as export ends;
      // waiting for GC allows consecutive chapter pages to overlap in memory.
      offscreen.width = 1;
      offscreen.height = 1;
    },
    createObjectUrl: blob => URL.createObjectURL(blob),
    getSegmentCount,
  };
  return (resolved, signal) => materialize18ComicImage(resolved, signal, deps);
}
