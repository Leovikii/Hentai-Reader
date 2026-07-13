import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEHentaiViewerUrl,
  extractEHentaiItems,
  getEHentaiNextUrl,
  getEHentaiPrevUrl,
  parseEHentaiPageMetadata,
  parseEHentaiResolvedDimensions,
  parseEHentaiViewer,
} from '../src/sites/e-hentai/gallery.ts';

function anchorWithSprite(href: string, style: string): Element {
  const sprite = { getAttribute: (name: string) => name === 'style' ? style : null };
  return {
    href,
    querySelector: (selector: string) => selector.includes('background') ? sprite : null,
  } as unknown as Element;
}

function anchorWithImage(href: string, src: string): Element {
  return {
    href,
    querySelector: (selector: string) => selector === 'img' ? { src } : null,
  } as unknown as Element;
}

test('extracts E-Hentai sprite crops and standalone previews into standard descriptors', () => {
  const anchors = [
    anchorWithSprite(
      'https://e-hentai.org/s/token/1',
      "width: 100px; height: 140px; background: transparent url('https://ehgt.org/sprite.jpg') -800px 0 no-repeat",
    ),
    anchorWithImage('https://e-hentai.org/s/token/2', 'https://ehgt.org/thumb-2.jpg'),
  ];
  const doc = {
    querySelectorAll: (selector: string) => selector === '#gdt a' ? anchors : [],
  } as unknown as Document;

  assert.deepEqual(extractEHentaiItems(doc), [
    {
      key: 'https://e-hentai.org/s/token/1',
      viewerUrl: 'https://e-hentai.org/s/token/1',
      preview: {
        kind: 'sprite',
        src: 'https://ehgt.org/sprite.jpg',
        crop: { x: 800, y: 0, width: 100, height: 140 },
      },
    },
    {
      key: 'https://e-hentai.org/s/token/2',
      viewerUrl: 'https://e-hentai.org/s/token/2',
      preview: { kind: 'url', src: 'https://ehgt.org/thumb-2.jpg' },
    },
  ]);
});

test('parses E-Hentai page range and neighbouring pagination links', () => {
  const links = [
    { textContent: '<', href: 'https://e-hentai.org/g/id/token/?p=1' },
    { textContent: '>', href: 'https://e-hentai.org/g/id/token/?p=3' },
  ];
  const pagination = { querySelectorAll: () => links };
  const doc = {
    querySelector(selector: string) {
      if (selector === '.ptt') return pagination;
      if (selector === '.gpc') return { textContent: '81 - 120 of 162 images' };
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === '.ptt td') {
        return [{ textContent: '1' }, { textContent: '2' }, { textContent: '3' }, { textContent: '4' }, { textContent: '5' }];
      }
      return [];
    },
  } as unknown as Document;

  assert.deepEqual(parseEHentaiPageMetadata(doc, 40), {
    totalPages: 5,
    imageOffset: 80,
    perPage: 40,
  });
  assert.equal(getEHentaiPrevUrl(doc), 'https://e-hentai.org/g/id/token/?p=1');
  assert.equal(getEHentaiNextUrl(doc), 'https://e-hentai.org/g/id/token/?p=3');
});

test('builds and parses E-Hentai viewer node-switch data once per document', () => {
  assert.equal(
    buildEHentaiViewerUrl('https://e-hentai.org/s/token/1?foo=bar', 'node-token'),
    'https://e-hentai.org/s/token/1?foo=bar&nl=node-token',
  );

  const image = {
    src: 'https://ehgt.org/full-image.jpg',
    getAttribute: (name: string) => name === 'onerror' ? "return nl('next-node')" : null,
  };
  const doc = {
    querySelector: (selector: string) => selector === '#img' ? image : null,
  } as unknown as Document;
  assert.deepEqual(parseEHentaiViewer(doc), {
    src: 'https://ehgt.org/full-image.jpg',
    nl: 'next-node',
  });
});

test('extracts original dimensions from an E-Hentai hath image URL', () => {
  const url = 'https://host.hath.network/h/hash-69240-800-1400-wbp/'
    + 'keystamp=1;fileindex=2;xres=800/Ansha_0117.webp';
  assert.deepEqual(parseEHentaiResolvedDimensions(url), { w: 800, h: 1400 });
});
