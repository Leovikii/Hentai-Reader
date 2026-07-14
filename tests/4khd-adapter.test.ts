import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extract4KHDImages,
  get4KHDNextUrl,
  get4KHDPrevUrl,
} from '../src/sites/4khd/gallery.ts';

function galleryDocument(images: Array<{
  src: string;
  dataSrc?: string;
  dataLazySrc?: string;
}>): Document {
  const elements = images.map(image => ({
    src: image.src,
    getAttribute(name: string) {
      if (name === 'data-src') return image.dataSrc ?? null;
      if (name === 'data-lazy-src') return image.dataLazySrc ?? null;
      return null;
    },
  }));
  return {
    querySelectorAll: () => elements,
    querySelector: () => null,
  } as unknown as Document;
}

function paginationDocument(currentPage: number, urls: Record<number, string>): Document {
  const current = { textContent: String(currentPage) };
  const anchors = Object.entries(urls).map(([page, href]) => ({
    textContent: page,
    href,
  }));
  const pageBox = {
    querySelector(selector: string) {
      if (selector === '.current, .active') return current;
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === 'a') return anchors;
      return [];
    },
  };
  return {
    querySelector(selector: string) {
      if (selector === '.page-link-box, .pagination, .nav-links, .nav-previous') return pageBox;
      return null;
    },
  } as unknown as Document;
}

test('normalizes 4KHD direct and thumbnail URLs without carrying full-image query parameters', () => {
  const items = extract4KHDImages(galleryDocument([
    {
      src: 'https://fallback.invalid/image.jpg',
      dataSrc: 'https://i2.wp.com/pic.4khd.com/w1200-rw/path/image.jpg?quality=90',
    },
    {
      src: 'https://pic.4khd.com/w800-rw/path/avatar-user.jpg',
    },
  ]));

  assert.deepEqual(items, [{
    key: 'https://img.4khd.com/w2500-h2500-rw/path/image.jpg',
    viewerUrl: 'https://img.4khd.com/w2500-h2500-rw/path/image.jpg',
    preview: {
      kind: 'url',
      src: 'https://img.4khd.com/w300-h300-rw/path/image.jpg?quality=90',
    },
  }]);
});

test('prefers numeric 4KHD pagination neighbours and never returns the current URL', () => {
  const currentUrl = 'https://4khd.com/gallery/page/2';
  const doc = paginationDocument(2, {
    1: 'https://4khd.com/gallery/page/1',
    2: currentUrl,
    3: 'https://4khd.com/gallery/page/3',
  });

  assert.equal(get4KHDPrevUrl(doc, currentUrl), 'https://4khd.com/gallery/page/1');
  assert.equal(get4KHDNextUrl(doc, currentUrl), 'https://4khd.com/gallery/page/3');
});
