// Run with READER_BROWSER pointing to a Chromium executable (isolated profile only).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';

const executable = process.env.READER_BROWSER;
assert.ok(executable, 'Set READER_BROWSER to an Edge or Chrome executable');
const root = path.resolve(import.meta.dirname, '..');
const bundle = await build({
  stdin: {
    contents: `
      import 'photoswipe/style.css';
      import './src/ui/global.css';
      import {createReaderController} from './src/reader/reader-controller';
      import {createPhotoSwipeDriver} from './src/reader/drivers/photoswipe-driver';
      import {Comic18Adapter} from './src/sites/18comic';
      import {store} from './src/state/store';
      import {createFloatControl} from './src/ui/float-control';
      import {getImageLoadStats} from './src/services/image-load-runtime';
      window.__test = {createReaderController, createPhotoSwipeDriver, Comic18Adapter, store, getImageLoadStats, createFloatControl};
    `,
    resolveDir: root,
  },
  bundle: true, write: false, format: 'iife', logLevel: 'silent',
  plugins: [{ name: 'browser-test-inputs', setup(builder) {
    builder.onResolve({filter: /^\$$/}, () => ({path: 'gm', namespace: 'test'}));
    builder.onLoad({filter: /.*/, namespace: 'test'}, () => ({contents: `
      export const GM_getValue = (key, fallback) => fallback;
      export const GM_setValue = () => {};
    `}));
    builder.onLoad({filter: /\.css$/}, async ({path: file}) => ({
      contents: `document.head.appendChild(Object.assign(document.createElement('style'), {textContent:${JSON.stringify(await readFile(file, 'utf8'))}}));`,
      loader: 'js',
    }));
  }}],
});
const profile = await mkdtemp(path.join(os.tmpdir(), 'reader-regression-'));
const browser = spawn(executable, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-extensions', 'about:blank',
], {windowsHide: true, stdio: 'ignore'});
let socket;
let closeBrowser = async () => {};
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await delay(100); }
  }
  assert.ok(port, 'Browser did not start');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({data}) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30000);
    pending.set(id, {resolve, reject, timer});
    socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  closeBrowser = () => cdp('Browser.close');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
  await evaluate('window.unsafeWindow = window; void 0');
  await evaluate(bundle.outputFiles[0].text);
  console.log('Isolated browser and production modules ready.');

  // Exercise both adapter entry points with actual DOMParser and foreign current-page globals.
  assert.equal(await evaluate(`(async () => {
    const adapter = __test.Comic18Adapter;
    window.aid = 999999; window.scramble_id = 888888;
    const html = '<div data-aid="2"></div><script>var next_aid=0;var aid=1448845;var scramble_id=220980;<\/script><div class="scramble-page"><img id="p1" data-original="https://cdn.invalid/00001.webp"></div>';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const initial = await adapter.loadInitialPage(doc, 'https://18comic.ink/photo/1448845');
    const nativeFetch = window.fetch;
    try {
      window.fetch = async () => new Response(html.replace('1448845', '1443509'));
      const fetched = await adapter.loadPage('https://18comic.ink/photo/1443509');
      window.fetch = async () => new Response(html.replace('var aid=1448845;', '').replace('var scramble_id=220980;', ''));
      const absent = await adapter.loadPage('https://18comic.ink/photo/2');
      return new URL(initial.items[0].viewerUrl).searchParams.get('18aid') === '1448845'
        && new URL(fetched.items[0].viewerUrl).searchParams.get('18aid') === '1443509'
        && !new URL(absent.items[0].viewerUrl).searchParams.has('18aid');
    } finally { window.fetch = nativeFetch; }
  })()`), true);
  console.log('Adapter initial/fetched page metadata passed.');

  await evaluate(`(() => {
    const t = __test;
    t.delayMs = 0; t.failInit = false; t.created = 0; t.closed = 0; t.scrollListeners = 0; t.renderedEvents = 0;
    document.body.style.height = '5000px';
    document.documentElement.style.overflow = 'auto'; document.body.style.overflow = 'visible';
    t.items = Array.from({length: 40}, (_, i) => {
      const w = i % 3 === 0 ? 1200 : 600, h = i % 3 === 0 ? 600 : 1000;
      const src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="hsl('+i*37+',70%,50%)"/><text x="40" y="100" font-size="70">'+i+'</text></svg>');
      const item = {key: String(i), viewerUrl: src, dimensions: {width:w,height:h}, preview:{kind:'none'}};
      const element = document.createElement('div'); element.className = 'r-ph';
      element.dataset.itemKey = item.key; element.dataset.url = src; element.dataset.index = String(i);
      document.body.append(element); return item;
    });
    t.store.activeAdapter = {resolveImage: async (src, {signal}) => {
      if (t.delayMs) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, t.delayMs);
        signal.addEventListener('abort', () => {clearTimeout(timer); reject(new DOMException('cancelled','AbortError'));}, {once:true});
      });
      return {src};
    }};
    t.double = false; t.direction = 'ltr'; t.settingsListeners = new Set();
    t.reader = t.createReaderController({
      pageLoader: {}, onLoadNextPage: () => {}, onLoadPrevPage: () => {},
      createDriver: options => {
        t.driver = t.createPhotoSwipeDriver({...options, onRenderedImageStateChange: event => {
          t.renderedEvents++; options.onRenderedImageStateChange(event);
        }}); t.created++;
        if (t.failInit) t.driver.on('change', () => {throw new Error('Expected init failure');});
        return t.driver;
      },
      scroll: {
        pause: () => {t.paused = true;}, resume: () => {t.paused = false;},
        requestImage: () => {},
        subscribeImageLoaded: () => {t.scrollListeners++; return () => {t.scrollListeners--;};},
        restore: request => {t.restore = request; window.scrollTo(0, request.entryScrollY);},
      },
      context: {
        getGalleryItems: () => t.items, isScrollMode: () => true,
        isDoublePageModeEnabled: () => t.double, getDoublePageDirection: () => t.direction,
        isAutoPlayEnabled: () => false, setAutoPlayEnabled: () => {}, getAutoPlayInterval: () => 5000,
        getThumbnailPosition: () => 'bottom', getImageOffset: () => 0, setImageOffset: () => {},
        getNextUrl: () => null, setNextUrl: () => {}, getPrevUrl: () => null, setPrevUrl: () => {},
        isPageFetching: () => false, setPageFetching: () => {},
        subscribeSettingsChanged: fn => {t.settingsListeners.add(fn); return () => t.settingsListeners.delete(fn);},
        subscribeReaderModeChanged: () => () => {}, emitReaderModeChanged: () => {},
        onReaderClose: () => {t.closed++;},
      },
    });
    t.snapshot = () => ({active:t.reader.isActive(), roots:document.querySelectorAll('.pswp').length,
      listeners:t.getImageLoadStats().listeners, leases:t.getImageLoadStats().activeLeases+t.getImageLoadStats().cachedLeases,
      scrollListeners:t.scrollListeners, paused:t.paused, overflow:[document.documentElement.style.overflow,document.body.style.overflow]});
    t.createFloatControl(t.reader);
  })()`);
  const baselineScrollListeners = await evaluate('__test.scrollListeners');
  const clean = async label => {
    const state = await evaluate('__test.snapshot()');
    assert.deepEqual(state, {active:false, roots:0, listeners:0, leases:0, scrollListeners:baselineScrollListeners, paused:false, overflow:['auto','visible']}, label);
  };
  await evaluate('window.scrollTo(0,500); document.querySelector(".bm-mode-btn").click()');
  await delay(30);
  await evaluate('document.querySelector(".bm-mode-btn").click(); document.querySelector(".bm-mode-btn").click()');
  await delay(700);
  await clean('floating mode button clicked during opening');
  assert.equal(await evaluate('window.scrollY'), 500, 'Close restores entry scroll position');
  // Close at different points of the opening animation, then attempt immediate re-entry.
  for (const milliseconds of [0, 10, 30, 100, 250, 600, 30, 0]) {
    await evaluate(`__test.reader.open(1)`);
    if (milliseconds) await delay(milliseconds);
    assert.equal(await evaluate(`(() => {
      const t=__test, count=t.created; t.reader.close(); t.reader.close(); t.reader.open(5);
      return t.created===count && document.querySelectorAll('.pswp').length<=1;
    })()`), true, 'Close must retain ownership until destruction finishes');
    await delay(700);
    await clean(`close after ${milliseconds}ms`);
  }
  // Unfinished asynchronous sources must neither retain leases nor mutate a reopened session.
  await evaluate('__test.delayMs=1200; __test.reader.open(35)');
  await delay(30);
  await evaluate('__test.reader.close()');
  await delay(700);
  await clean('pending source cancellation');
  await evaluate('__test.delayMs=0; __test.reader.open(2)');
  await delay(700);
  await evaluate('__test.driver.instance.close()');
  await delay(700);
  await clean('native animated close');

  await evaluate('__test.failInit=true; __test.reader.open(1)');
  await delay(100);
  await clean('initialization failure');
  await evaluate('__test.failInit=false; __test.reader.open(1)');
  await delay(700);
  await evaluate(`(() => {
    const image=document.querySelector('.pswp .hr-reader-spread__page[src]');
    __test.lateLoad=image.onload; __test.lateError=image.onerror;
    __test.reader.close();
  })()`);
  await delay(100);
  await evaluate('__test.reader.open(2)');
  await delay(700);
  assert.equal(await evaluate(`(() => {
    const count=__test.renderedEvents;
    __test.lateLoad(); __test.lateError();
    return __test.renderedEvents===count;
  })()`), true, 'Destroyed image callbacks cannot reach a new Reader session');
  // Navigation, mapping, direction changes and resizing still use the actual Driver.
  for (let i = 0; i < 40; i++) {
    const index = (i * 17) % 40;
    assert.equal(await evaluate(`(() => {
      const t=__test; t.driver.goTo(${index});
      return t.driver.currentIndex===${index};
    })()`), true);
    const presentation = await evaluate(`(async () => {
      for(let attempt=0;attempt<100;attempt++) {
        const slide=__test.driver.instance.currSlide;
        const nodes=[...slide.container.querySelectorAll('img[data-logical-index]')];
        const state={slide:slide.index, current:__test.driver.currentIndex,
          logical:nodes.map(node=>Number(node.dataset.logicalIndex)),
          source:nodes.map(node=>node.getAttribute('src')===__test.items[${index}].viewerUrl),
          ready:__test.driver.isCurrentContentLoaded()};
        if(state.ready) return state;
        if(attempt===99) return {...state, blocked:__test.driver.isInteracting(),
          stats:__test.getImageLoadStats(), html:slide.container.innerHTML.slice(0,500),
          spread:slide.data.hrSpread.map(page=>({index:page.index,hasSource:!!page.src}))};
        await new Promise(resolve=>setTimeout(resolve,20));
      }
    })()`);
    assert.deepEqual(presentation, {slide:index,current:index,logical:[index],source:[true],ready:true},
      'Current holder and image source agree with the requested logical page');
  }
  await cdp('Input.dispatchKeyEvent', {type:'keyDown', key:'ArrowLeft', code:'ArrowLeft', windowsVirtualKeyCode:37});
  await cdp('Input.dispatchKeyEvent', {type:'keyUp', key:'ArrowLeft', code:'ArrowLeft', windowsVirtualKeyCode:37});
  await delay(500);
  for (const [width, height] of [[375,829],[829,375],[1280,300],[1600,900]]) {
    await cdp('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
    await evaluate('__test.double=true; __test.direction="rtl"; __test.settingsListeners.forEach(fn=>fn())');
    await delay(400);
    assert.equal(await evaluate('__test.driver.isCurrentContentLoaded()'), true, 'Rendered content after resize');
  }
  await evaluate('__test.reader.close()');
  await delay(700);
  await clean('navigation and resize');
  assert.deepEqual(errors, [], 'No unhandled browser exceptions');
  console.log('Browser regressions passed: adapter initial/fetched metadata; opening/normal/native close; re-entry; pending sources; init failure; navigation and resize.');

  if (process.env.READER_LIVE_URL) {
    await cdp('Page.navigate', {url:process.env.READER_LIVE_URL});
    for (let i=0; i<60; i++) {
      if (await evaluate('!!document.querySelector(".scramble-page img[id]") && typeof window.get_num === "function"')) break;
      await delay(500);
    }
    await evaluate('window.unsafeWindow=window; void 0');
    await evaluate(bundle.outputFiles[0].text);
    const result = await evaluate(`(async () => {
      const page=await __test.Comic18Adapter.loadInitialPage(document,location.href);
      if (!page.items.length) throw new Error('No chapter images; access may be blocked');
      const first=page.items[0].viewerUrl;
      const resolved=await __test.Comic18Adapter.resolveImage(first,{priority:100});
      const image=await __test.Comic18Adapter.materializeImage(resolved,new AbortController().signal);
      try { return {count:page.items.length, aid:String(window.aid), parsedAid:new URL(first).searchParams.get('18aid'),
        materialized:!!image.ownsObjectUrl, dimensions:image.decodedDimensions}; }
      finally {if(image.ownsObjectUrl) URL.revokeObjectURL(image.src);}
    })()`);
    assert.equal(result.parsedAid, result.aid);
    assert.equal(result.materialized, true);
    console.log('Live 18comic:', JSON.stringify(result));
  }
} finally {
  await closeBrowser().catch(() => {});
  socket?.close();
  browser.kill();
  await delay(1000);
  await rm(profile, {recursive:true, force:true, maxRetries:5, retryDelay:300}).catch(() => {});
}
