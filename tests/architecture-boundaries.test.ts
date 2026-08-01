import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const srcRoot = fileURLToPath(new URL('../src/', import.meta.url));

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.name.endsWith('.ts') ? [target] : [];
  }));
  return nested.flat();
}

async function assertSourcesDoNotContain(directory: string, patterns: RegExp[]): Promise<void> {
  for (const file of await sourceFiles(directory)) {
    const source = await readFile(file, 'utf8');
    for (const pattern of patterns) {
      assert.equal(
        pattern.test(source),
        false,
        `${path.relative(srcRoot, file)} violates architecture boundary ${pattern}`,
      );
    }
  }
}

test('reader depends on injected ports instead of app, scroll, site, or Store implementations', async () => {
  await assertSourcesDoNotContain(path.join(srcRoot, 'reader'), [
    /state\/store/,
    /features\//,
    /scroll\//,
    /sites\//,
  ]);
});

test('core contracts depend only on other core contracts', async () => {
  await assertSourcesDoNotContain(path.join(srcRoot, 'core'), [/from\s+['"]\.\.\//]);
});

test('site adapters do not mutate the application Store', async () => {
  await assertSourcesDoNotContain(path.join(srcRoot, 'sites'), [/state\/store/]);
});

test('common entry, settings, and UI code do not branch on supported site names', async () => {
  const commonFiles = [
    'main.ts',
    'state/config.ts',
    'state/store.ts',
    'ui/settings-panel.ts',
  ];
  for (const relative of commonFiles) {
    const source = await readFile(path.join(srcRoot, relative), 'utf8');
    assert.equal(/18comic|4KHD|E-Hentai|ExHentai/.test(source), false, relative);
  }
});

test('public image contracts use generic retry terminology', async () => {
  const contracts = await Promise.all([
    readFile(path.join(srcRoot, 'core/image.ts'), 'utf8'),
    readFile(path.join(srcRoot, 'core/site-adapter.ts'), 'utf8'),
  ]);
  assert.equal(/\bnl(?:Token)?\b/.test(contracts.join('\n')), false);
});

test('transitional feature and legacy reader UI files are gone', async () => {
  const removed = [
    'features/scroll-mode.ts',
    'features/single-page-mode.ts',
    'types/image-load.ts',
    'types/site-adapter.ts',
    'types/index.ts',
    'ui/single-page/overlay.css',
  ];
  for (const relative of removed) {
    await assert.rejects(access(path.join(srcRoot, relative)), relative);
  }
});

test('PhotoSwipe package and internal fields stay behind the driver', async () => {
  const files = await sourceFiles(srcRoot);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relative = path.relative(srcRoot, file).replace(/\\/g, '/');
    if (relative === 'reader/drivers/photoswipe-driver.ts' || relative === 'main.ts') continue;
    assert.equal(/from\s+['"]photoswipe['"]/.test(source), false, relative);
    assert.equal(/\bcurrSlide\b|\bcontentLoader\b/.test(source), false, relative);
  }
});

test('dynamic spread changes keep the live Reader driver instead of rebuilding it', async () => {
  const source = await readFile(path.join(srcRoot, 'reader/reader-controller.ts'), 'utf8');
  const branch = source.match(/if \(previousKeys !== nextKeys\) \{([\s\S]*?)\n      \}/)?.[1] ?? '';
  assert.match(source, /previousKeys !== nextKeys && pswp\.isInteracting\(\)/);
  assert.match(branch, /pswp\.syncLayout\(targetSpread\)/);
  assert.doesNotMatch(branch, /destroy\(|initPhotoSwipe\(/);
});

test('owned-image cleanup is observer-driven and expensive materialization is serialized', async () => {
  const scroll = await readFile(path.join(srcRoot, 'scroll/scroll-controller.ts'), 'utf8');
  const config = await readFile(path.join(srcRoot, 'state/config.ts'), 'utf8');
  assert.match(scroll, /ownedImageObserver = new IntersectionObserver/);
  assert.match(scroll, /pendingLoadObserver = new IntersectionObserver/);
  assert.match(scroll, /for \(const placeholder of pendingPlaceholders\)/);
  assert.match(scroll, /\[\.\.\.pendingPlaceholders\]\.forEach\(placeholder => cancelPendingLoad\(placeholder, false\)\)/);
  assert.doesNotMatch(scroll, /querySelectorAll<HTMLElement>\('\.r-img\[data-owns-object-url/);
  assert.match(config, /imageMaterializeConcurrent:\s*1/);
});

test('settings controls explicitly resist host-page button styling', async () => {
  const css = await readFile(path.join(srcRoot, 'ui/settings-panel.css'), 'utf8');
  assert.match(css, /\.settings-backdrop \.segment-item[\s\S]*?background: transparent !important/);
  assert.match(css, /\.settings-backdrop \.segment-item\.active[\s\S]*?color: #fff !important/);
  assert.match(css, /\.settings-backdrop \.settings-close-btn[\s\S]*?background: transparent !important/);
  assert.match(css, /\.settings-backdrop \.stepper-btn[\s\S]*?color: #fff !important/);
});
