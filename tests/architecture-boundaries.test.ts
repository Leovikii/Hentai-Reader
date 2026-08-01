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

test('E-Hentai source URL syntax stays inside its site adapter', async () => {
  const files = await sourceFiles(srcRoot);
  for (const file of files) {
    const relative = path.relative(srcRoot, file).replace(/\\/g, '/');
    if (relative.startsWith('sites/e-hentai/')) continue;
    const source = await readFile(file, 'utf8');
    assert.equal(/hath\.network|HATH_SOURCE_PATTERN|keystamp=/.test(source), false, relative);
  }
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
  const sources = await Promise.all((await sourceFiles(srcRoot)).map(file => readFile(file, 'utf8')));
  const userscriptConfig = await readFile(path.resolve(srcRoot, '../vite.config.ts'), 'utf8');
  assert.doesNotMatch(sources.join('\n'), /\bshowControl\b|\bGM_registerMenuCommand\b/);
  assert.doesNotMatch(userscriptConfig, /GM_registerMenuCommand/);
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
  const driver = await readFile(path.join(srcRoot, 'reader/drivers/photoswipe-driver.ts'), 'utf8');
  const refreshFunction = source.match(/function refreshSpreadLayout\([\s\S]*?\n    const onResize/)?.[0] ?? '';
  const syncLayout = driver.match(/syncLayout\(index: number\): void \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  assert.match(source, /idleFrames < 2/);
  assert.match(source, /deferRefresh\(idleFrames \+ 1\)/);
  assert.match(source, /pswp\.isInteracting\(\)/);
  assert.match(refreshFunction, /if \(pswp\.isInteracting\(\)\) \{[\s\S]*?layoutDeferredDuringInteraction = true;[\s\S]*?deferRefresh\(0\)/);
  assert.match(refreshFunction, /requireIdleFrames \|\| previousKeys !== nextKeys \|\| layoutDeferredDuringInteraction/);
  assert.match(refreshFunction, /pswp\.syncLayout\(targetSpread\)/);
  assert.doesNotMatch(refreshFunction, /destroy\(|initPhotoSwipe\(/);
  assert.doesNotMatch(syncLayout, /stopAll|mainScroll\?\.stop/);
  assert.match(driver, /instance\.on\('afterSetContent'/);
  assert.match(driver, /reconcilePhotoSwipeHolder/);
  assert.doesNotMatch(driver, /refreshSlideContent\(/);
  assert.match(driver, /getPhotoSwipeHolderPosition/);
  assert.match(syncLayout, /staleSlide\.destroy\(\)/);
});

test('reader remapping always releases its guard and keeps HUD state image-aware', async () => {
  const source = await readFile(path.join(srcRoot, 'reader/reader-controller.ts'), 'utf8');
  const afterPrepend = source.match(/afterPrepend: itemCount => \{([\s\S]*?)\n    \},/)?.[1] ?? '';
  const onPageAdded = source.match(/onPageAdded: direction => \{([\s\S]*?)\n    \},/)?.[1] ?? '';
  const syncImages = source.match(/function syncImages\(\): void \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  const refreshFunction = source.match(/function refreshSpreadLayout\([\s\S]*?\n    refreshActiveLayout/)?.[0] ?? '';
  const closeHandler = source.match(/pswp\.on\('close',[\s\S]*?\n    \}\);/)?.[0] ?? '';
  assert.doesNotMatch(afterPrepend, /pswp|spreadLayout|startReinitializing/);
  assert.match(onPageAdded, /refreshActiveLayout\(\)/);
  assert.match(syncImages, /if \(!pswp\) \{[\s\S]*?spreadLayout = calculateSpreadLayout\(\)/);
  assert.doesNotMatch(syncImages, /refreshSlide\(/);
  assert.equal((refreshFunction.match(/finally \{/g) ?? []).length >= 2, true);
  assert.match(refreshFunction, /finishReinitializing\(\)/);
  assert.match(source, /onIdle: \(\) => refreshActiveHud\(\)/);
  assert.doesNotMatch(source, /onIdle: \(\) => shell\.hideStatus\(\)/);
  assert.equal(
    (source.match(/const isActiveIndex = activeLogicalIndices\(\)\.includes\(index\)/g) ?? []).length,
    2,
  );
  assert.match(source, /if \(isActiveIndex\) refreshHudForCurrent\(\)/);
  assert.match(source, /if \(isActiveIndex\) syncUiAvailabilityForCurrent\(\)/);
  assert.doesNotMatch(source, /refreshSlide:\s*index/);
  assert.match(source, /refreshSpreadLayout\(session\.currentIndex, index, true\)/);
  assert.match(source, /phase === 'loaded' && !pswp\.isCurrentContentLoaded\(\)/);
  assert.match(source, /pswp\.init\(\);\s*refreshHudForCurrent\(\)/);
  const mobileTimeout = source.match(/function triggerMobileUITimeout\(\) \{([\s\S]*?)\n    \}/)?.[1] ?? '';
  const syncUi = source.match(/function syncUiAvailabilityForCurrent\(\): void \{([\s\S]*?)\n    \}/)?.[1] ?? '';
  assert.doesNotMatch(mobileTimeout, /isCurrentContentLoaded/);
  assert.match(mobileTimeout, /pswp\?\.hideUi\(\)/);
  assert.match(syncUi, /if \(hasTouchInput\) return;/);
  assert.match(syncUi, /if \(!pswp\.isCurrentContentLoaded\(\)\)[\s\S]*?pswp\.showUi\(\)/);
  assert.doesNotMatch(closeHandler, /isReinitializing/);
  assert.match(source, /function close\(\): void \{\s*if \(!isActive\) return;/);
});

test('stable spread slots do not collapse while the partner source is pending', async () => {
  const css = await readFile(path.join(srcRoot, 'reader/shell/reader.css'), 'utf8');
  const pageRule = css.match(/\.hr-reader-spread__page \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const pendingRule = css.match(/\.hr-reader-spread__page--pending \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(pageRule, /flex:\s*0 0 calc\(50% - 10px\)/);
  assert.doesNotMatch(pendingRule, /min-width:\s*1px/);
  assert.match(pendingRule, /background:/);
  assert.doesNotMatch(pendingRule, /background:\s*transparent/);
  assert.match(css, /\.hr-reader-spread__page--pending::after[\s\S]*?animation:\s*hr-reader-pending-spin/);
  assert.match(css, /\.hr-reader-spread__page:not\(:only-child\):first-child[\s\S]*?object-position:\s*right center/);
  assert.match(css, /\.hr-reader-spread__page:not\(:only-child\):last-child[\s\S]*?object-position:\s*left center/);
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

test('floating controls avoid sticky mobile tap and hover feedback', async () => {
  const css = await readFile(path.join(srcRoot, 'ui/float-control.css'), 'utf8');
  assert.match(css, /\.bookmark-control \{[\s\S]*?-webkit-tap-highlight-color:\s*transparent/);
  assert.match(css, /\.bm-btn \{[\s\S]*?-webkit-tap-highlight-color:\s*transparent/);
  assert.match(css, /@media \(hover: hover\) \{[\s\S]*?\.bm-btn:hover/);
  assert.match(css, /@media \(hover: hover\) \{[\s\S]*?\.bm-mode-btn:hover/);
});
