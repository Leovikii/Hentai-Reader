import test from 'node:test';
import assert from 'node:assert/strict';
import {
  get18ComicImageLoadTimeout,
  materialize18ComicImage,
  resolve18ComicSource,
} from '../src/sites/18comic/materializer.ts';

test('separates 18comic source cleanup from anti-scramble materialization metadata', () => {
  assert.deepEqual(
    resolve18ComicSource('https://cdn.example/12345.webp?18aid=900&18scid=800'),
    {
      src: 'https://cdn.example/12345.webp',
      materializeData: {
        kind: '18comic-scramble',
        aid: '900',
        imageId: '12345',
      },
    },
  );
  assert.deepEqual(
    resolve18ComicSource('https://cdn.example/12345.webp?18aid=700&18scid=800'),
    { src: 'https://cdn.example/12345.webp' },
  );
});

test('publishes bounded foreground and background source-attempt deadlines', () => {
  assert.equal(get18ComicImageLoadTimeout(100), 20_000);
  assert.equal(get18ComicImageLoadTimeout(90), 20_000);
  assert.equal(get18ComicImageLoadTimeout(89), 30_000);
  assert.equal(get18ComicImageLoadTimeout(5), 30_000);
});

test('materializes 18comic strips in the original order and closes the bitmap', async () => {
  const draws: any[][] = [];
  let closed = 0;
  let releasedCanvas = 0;
  let requestedContext = '';
  const resolved = resolve18ComicSource('https://cdn.example/12345.webp?18aid=900&18scid=800');
  const result = await materialize18ComicImage(
    resolved,
    new AbortController().signal,
    {
      fetchBlob: async () => new Blob(['source']),
      createBitmap: async () => ({ width: 5, height: 10, close: () => { closed++; } }),
      createCanvas: () => ({
        getContext: contextId => {
          requestedContext = contextId;
          return {
            fillStyle: '',
            fillRect: () => {},
            drawImage: (...args: any[]) => draws.push(args),
          };
        },
        convertToBlob: async () => new Blob(['output'], { type: 'image/jpeg' }),
      }),
      releaseCanvas: () => { releasedCanvas++; },
      createObjectUrl: () => 'blob:decoded',
      getSegmentCount: () => 3,
    },
  );

  assert.deepEqual(result, {
    src: 'blob:decoded',
    ownsObjectUrl: true,
    byteSize: 6,
    decodedDimensions: { width: 5, height: 10 },
  });
  assert.equal(requestedContext, '2d');
  assert.equal(closed, 1);
  assert.equal(releasedCanvas, 1);
  assert.deepEqual(draws.map(args => args.slice(2)), [
    [6, 5, 4, 0, 0, 5, 4],
    [3, 5, 3, 0, 4, 5, 3],
    [0, 5, 3, 0, 7, 5, 3],
  ]);
});

test('fails instead of silently displaying the scrambled source when decoding is unavailable', async () => {
  let closed = 0;
  let fetched = 0;
  const resolved = resolve18ComicSource('https://cdn.example/12345.webp?18aid=900&18scid=800');
  await assert.rejects(materialize18ComicImage(
    resolved,
    new AbortController().signal,
    {
      fetchBlob: async () => { fetched++; return new Blob(['source']); },
      createBitmap: async () => ({ width: 5, height: 10, close: () => { closed++; } }),
      createCanvas: () => ({
        getContext: () => null,
        convertToBlob: async () => new Blob(),
      }),
      createObjectUrl: () => 'blob:unused',
      getSegmentCount: () => undefined,
    },
  ), /segment count is unavailable/);
  assert.equal(fetched, 0);
  assert.equal(closed, 0);
});

test('does not fetch or decode an 18comic source that needs no rearrangement', async () => {
  let fetched = 0;
  let decoded = 0;
  const resolved = resolve18ComicSource('https://cdn.example/12345.webp?18aid=900&18scid=800');
  const result = await materialize18ComicImage(
    resolved,
    new AbortController().signal,
    {
      fetchBlob: async () => { fetched++; return new Blob(); },
      createBitmap: async () => {
        decoded++;
        return { width: 1, height: 1, close: () => {} };
      },
      createCanvas: () => ({
        getContext: () => null,
        convertToBlob: async () => new Blob(),
      }),
      createObjectUrl: () => 'blob:unused',
      getSegmentCount: () => 1,
    },
  );

  assert.deepEqual(result, { src: 'https://cdn.example/12345.webp' });
  assert.equal(fetched, 0);
  assert.equal(decoded, 0);
});
