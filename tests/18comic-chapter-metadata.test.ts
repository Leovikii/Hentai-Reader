import test from 'node:test';
import assert from 'node:assert/strict';
import { get18ComicChapterMetadata } from '../src/sites/18comic/chapter-metadata.ts';
import { resolve18ComicSource } from '../src/sites/18comic/materializer.ts';

function documentWithScripts(...scripts: string[]): Document {
  return {
    querySelectorAll: () => scripts.map(textContent => ({ textContent })),
  } as unknown as Document;
}

test('18comic reads exact chapter assignments after next_aid and other suffixes', () => {
  for (const next of [0, 900002]) {
    const metadata = get18ComicChapterMetadata(documentWithScripts(`
      var scramble_id = 220980;
      var next_aid = ${next};
      var series_aid = 123, data_aid = 3, $aid = 4;
      var aid = 1448845;
    `));
    assert.deepEqual(metadata, { aid: '1448845', scrambleId: '220980' });
    const resolved = resolve18ComicSource(
      `https://cdn.invalid/media/photos/1448845/00001.webp?18aid=${metadata.aid}&18scid=${metadata.scrambleId}`,
    );
    assert.equal((resolved.materializeData as { aid: string }).aid, '1448845');
  }
});

test('18comic supports numeric, quoted, window and comma declarations', () => {
  for (const script of [
    'let aid = 900001, scramble_id = 220980;',
    'const aid = "900001"; const scramble_id = \'220980\';',
    'window.aid = 900001; window.scramble_id = 220980;',
  ]) {
    assert.deepEqual(get18ComicChapterMetadata(documentWithScripts(script)), {
      aid: '900001', scrambleId: '220980',
    });
  }
});

test('18comic uses fallback only when explicitly supplied and page-local values win', () => {
  const fallback = { aid: '900001', scramble_id: '220980' };
  const doc = documentWithScripts('var next_aid = 0;');
  assert.deepEqual(get18ComicChapterMetadata(doc, fallback), { aid: '900001', scrambleId: '220980' });
  assert.deepEqual(get18ComicChapterMetadata(doc), { aid: '', scrambleId: '' });
  assert.deepEqual(get18ComicChapterMetadata(documentWithScripts(
    'var aid = 86076;', 'var scramble_id = 0;',
  ), fallback), { aid: '86076', scrambleId: '0' });
});
