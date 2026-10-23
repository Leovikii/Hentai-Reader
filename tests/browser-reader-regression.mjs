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
      window.__test = {createReaderController, createPhotoSwipeDriver, Comic18Adapter, store, getImageLoadStats, createFloatControl,
        startLiveApp: () => import('./src/main')};
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
    builder.onLoad({filter: /[\\/]src[\\/]main\.ts$/}, async ({path: file}) => ({
      contents: (await readFile(file, 'utf8')).replace('const readerHandle = createReader(pageLoader);',
        'const readerHandle = createReader(pageLoader); window.__test.liveReader = readerHandle;'), loader:'ts',
    }));
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

  const setupFixture = () => evaluate(`(() => {
    const t = __test;
    document.head.append(Object.assign(document.createElement('meta'), {name:'viewport',content:'width=device-width, initial-scale=1'}));
    t.delayMs = 0; t.failInit = false; t.created = 0; t.closed = 0; t.scrollListeners = 0; t.renderedEvents = 0; t.contentClicks = 0; t.domClicks = 0;
    document.addEventListener('click', () => {t.domClicks++;}, true);
    document.body.style.height = '5000px';
    document.documentElement.style.overflow = 'auto'; document.body.style.overflow = 'visible';
    const batch = document.createElement('div'); batch.className = 'hr-page-batch'; document.body.append(batch);
    t.items = Array.from({length: 40}, (_, i) => {
      const w = i % 3 === 0 ? 1200 : 600, h = i % 3 === 0 ? 600 : 1000;
      const src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="hsl('+i*37+',70%,50%)"/><text x="40" y="100" font-size="70">'+i+'</text></svg>');
      const item = {key: String(i), viewerUrl: src, dimensions: {width:w,height:h}, preview:{kind:'none'}};
      const element = document.createElement('div'); element.className = 'r-ph';
      element.dataset.itemKey = item.key; element.dataset.url = src; element.dataset.index = String(i);
      batch.append(element); return item;
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
        t.driver = t.createPhotoSwipeDriver({...options,
          onContentClick: point => {
            t.contentClicks++; options.onContentClick(point);
            t.uiAfterClick=document.querySelector('.pswp')?.classList.contains('pswp--ui-visible');
          },
          onRenderedImageStateChange: event => {
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
      scrollListeners:t.scrollListeners, paused:t.paused, overflow:[document.documentElement.style.overflow,document.body.style.overflow],
      hidden:document.documentElement.classList.contains('hr-reader-open'), batchVisibility:getComputedStyle(batch).visibility});
    t.createFloatControl(t.reader);
  })()`);
  await setupFixture();
  let baselineScrollListeners = await evaluate('__test.scrollListeners');
  const clean = async label => {
    const state = await evaluate('__test.snapshot()');
    assert.deepEqual(state, {active:false, roots:0, listeners:0, leases:0, scrollListeners:baselineScrollListeners, paused:false, overflow:['auto','visible'], hidden:false, batchVisibility:'visible'}, label);
  };
  const click = async (x, y, input = 'mouse') => {
    if (input === 'touch') {
      await cdp('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x,y}]});
      await cdp('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
    } else {
      await cdp('Input.dispatchMouseEvent', {type:'mouseMoved', x,y});
      await cdp('Input.dispatchMouseEvent', {type:'mousePressed', x,y,button:'left',buttons:1,clickCount:1});
      await cdp('Input.dispatchMouseEvent', {type:'mouseReleased', x,y,button:'left',buttons:0,clickCount:1});
    }
    await delay(100);
  };
  const clickElement = async selector => {
    const point = await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await click(point.x, point.y);
  };
  const drag = async (dx, dy, input = 'mouse') => {
    const {width,height} = await evaluate('({width:innerWidth,height:innerHeight})');
    const x=dx ? width*(dx<0 ? .8 : .2) : width/2, y=height/2;
    if (input === 'touch') await cdp('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
    else await cdp('Input.dispatchMouseEvent', {type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
    for (let step=1;step<=12;step++) {
      const point={x:x+dx*step/12,y:y+dy*step/12};
      if (input === 'touch') await cdp('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[point]});
      else await cdp('Input.dispatchMouseEvent', {type:'mouseMoved',...point,button:'left',buttons:1});
      await delay(25);
    }
    if (input === 'touch') await cdp('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    else await cdp('Input.dispatchMouseEvent', {type:'mouseReleased',x:x+dx,y:y+dy,button:'left',buttons:0,clickCount:1});
    await delay(1000);
  };
  const assertClickZones = async (input, index) => {
    const {width,height} = await evaluate('({width:innerWidth,height:innerHeight})');
    const before = await evaluate('__test.contentClicks');
    await evaluate('__test.driver.showUi()');
    await click(width/2, height/2, input);
    assert.equal(await evaluate('document.querySelector(".pswp").classList.contains("pswp--ui-visible")'), false, `${input}: center hides controls`);
    await click(width*.2, height/2, input);
    assert.equal(await evaluate('__test.driver.currentIndex'), index-1, `${input}: left pages with hidden controls`);
    await delay(300);
    await click(width*.8, height/2, input);
    assert.equal(await evaluate('__test.driver.currentIndex'), index, `${input}: right pages with hidden controls`);
    await delay(300);
    await click(width/2, height/2, input);
    assert.equal(await evaluate('document.querySelector(".pswp").classList.contains("pswp--ui-visible")'), true, `${input}: center reveals controls`);
    assert.equal(await evaluate('__test.contentClicks'), before+4, 'Each physical click/tap produces exactly one action');
    assert.equal(await evaluate('__test.driver.isCurrentZoomed()'), false, 'Single clicks do not zoom');
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

  for (const double of [false,true]) {
    for (const sign of [-1,1]) {
      await evaluate(`__test.double=${double}; __test.reader.open(${double ? 4 : 1})`);
      await delay(700);
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".hr-page-batch")).visibility'), 'hidden');
      const before = await evaluate('({actions:__test.contentClicks,clicks:__test.domClicks})');
      await drag(0,sign*300);
      assert.equal(await evaluate('__test.domClicks'), before.clicks+1, 'Real mouse release generates the post-drag DOM click');
      assert.equal(await evaluate('__test.contentClicks'), before.actions, 'Dragging must not invoke a content click');
      await clean(`mouse vertical ${sign<0 ? 'up' : 'down'}, double=${double}`);
    }
  }
  await evaluate('__test.double=false; __test.reader.open(3)');
  await delay(700);
  await assertClickZones('mouse',3);
  await evaluate('__test.driver.goTo(1)');
  await delay(500);
  await assertClickZones('mouse',1);
  await drag(-500,0);
  assert.equal(await evaluate('__test.driver.currentIndex'), 2, 'Mouse horizontal drag still pages');
  await evaluate('__test.reader.close()');
  await delay(700);
  await clean('single-page mouse clicks and horizontal drag');

  // Sources remain pending while both stable slots and the center gap accept clicks.
  await evaluate('__test.double=true; __test.delayMs=2000; __test.reader.open(28)');
  await delay(700);
  assert.equal(await evaluate('__test.driver.instance.currSlide.container.querySelectorAll(".hr-reader-spread__page--pending").length'), 2);
  await click(500,450);
  assert.equal(await evaluate('__test.uiAfterClick'), false, 'Pending slot uses the same center toggle');
  // The existing desktop loading fallback may reveal controls after the click.
  await evaluate('__test.driver.hideUi()');
  await click(640,450);
  assert.equal(await evaluate('__test.uiAfterClick'), true, 'Spread center gap reveals controls');
  const pendingIndex = await evaluate('__test.driver.currentIndex');
  await click(1152,450);
  assert.equal(await evaluate('__test.driver.currentIndex'), pendingIndex+1, 'Pending slot right pages without waiting for sources');
  await evaluate('__test.reader.close(); __test.delayMs=0; __test.double=false');
  await delay(700);
  await clean('pending pair clicks');

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
  await cdp('Emulation.setDeviceMetricsOverride', {width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate('__test.double=true; __test.reader.open(4)');
  await delay(700);
  const pairIndex = await evaluate('__test.driver.currentIndex');
  await assertClickZones('mouse',pairIndex);
  assert.equal(await evaluate(`(() => {
    const pages=[...__test.driver.instance.currSlide.container.querySelectorAll('img.hr-reader-spread__page')];
    const [left,right]=pages.map(page=>page.getBoundingClientRect()).sort((a,b)=>a.x-b.x);
    return pages.length===2 && left.width>100 && right.width>100 && right.x>=left.right
      && Math.abs(left.width-right.width)<1 && pages.every(page=>getComputedStyle(page).position==='relative');
  })()`), true, 'Native click markers preserve equal, non-overlapping RTL spread slots');
  const beforeZoom = await evaluate('__test.contentClicks');
  await clickElement('.pswp__button--zoom');
  await delay(500);
  assert.equal(await evaluate('__test.driver.isCurrentZoomed()'), true, 'Native zoom button still zooms');
  assert.equal(await evaluate('__test.contentClicks'), beforeZoom, 'Zoom control is isolated from content clicks');
  await drag(120,0);
  assert.equal(await evaluate('__test.driver.currentIndex'), pairIndex, 'Mouse pans a zoomed spread without paging');
  await cdp('Input.dispatchKeyEvent', {type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90});
  await cdp('Input.dispatchKeyEvent', {type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90});
  await delay(500);
  assert.equal(await evaluate('__test.driver.isCurrentZoomed()'), false, 'Z restores initial zoom');
  await clickElement('.pswp__button--close');
  await delay(700);
  await clean('native controls, zoom and pan');
  console.log('Desktop native click zones, pending/RTL layout, mouse drag exits, zoom and pan passed.');

  // A fresh pure-touch context lets the real capability snapshot own UI timing.
  await cdp('Page.navigate', {url:'about:blank'});
  await cdp('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:2});
  await cdp('Emulation.setDeviceMetricsOverride', {width:375,height:829,deviceScaleFactor:1,mobile:true});
  await evaluate('window.unsafeWindow=window; void 0');
  await evaluate(bundle.outputFiles[0].text);
  await setupFixture();
  baselineScrollListeners = await evaluate('__test.scrollListeners');
  assert.equal(await evaluate('matchMedia("(pointer: coarse)").matches && !matchMedia("(any-hover: hover) and (any-pointer: fine)").matches'), true, 'Pure touch capability emulation');
  await evaluate('__test.reader.open(3)');
  await delay(700);
  await assertClickZones('touch',3);
  await delay(2200);
  assert.equal(await evaluate('document.querySelector(".pswp").classList.contains("pswp--ui-visible")'), false, 'Touch controls auto-hide');
  await click(187,414,'touch');
  assert.equal(await evaluate('document.querySelector(".pswp").classList.contains("pswp--ui-visible")'), true, 'Touch center wakes hidden controls');
  await evaluate('__test.driver.goTo(1)');
  await delay(500);
  await drag(-250,0,'touch');
  assert.equal(await evaluate('__test.driver.currentIndex'), 2, 'Touch horizontal swipe still pages');
  await evaluate('__test.reader.close()');
  await delay(700);
  await clean('touch taps and horizontal swipe');
  for (const sign of [-1,1]) {
    await evaluate('__test.reader.open(1)');
    await delay(700);
    const before = await evaluate('__test.contentClicks');
    await drag(0,sign*260,'touch');
    assert.equal(await evaluate('__test.contentClicks'), before, 'Touch drag does not invoke tap');
    await clean(`touch vertical ${sign<0 ? 'up' : 'down'}`);
  }
  await evaluate('__test.reader.open(1)');
  await delay(700);
  const pinchPoints = distance => [{x:187-distance,y:414},{x:187+distance,y:414}];
  await cdp('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:pinchPoints(35)});
  for(let distance=40;distance<=120;distance+=10) {
    await cdp('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:pinchPoints(distance)});
    await delay(25);
  }
  await cdp('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  await delay(500);
  assert.equal(await evaluate('__test.driver.isCurrentZoomed()'), true, 'Native pinch zoom remains enabled');
  await evaluate('__test.reader.close()');
  await delay(700);
  await clean('touch pinch zoom');
  assert.deepEqual(errors, [], 'No unhandled browser exceptions');
  console.log('Browser regressions passed: metadata; lifecycle and cleanup; navigation/resize; mouse/touch click zones and drag exits; zoom controls/pan/pinch. Touch emulation does not replace real-device acceptance.');

  if (process.env.READER_LIVE_URL) {
    await cdp('Emulation.setTouchEmulationEnabled', {enabled:false});
    await cdp('Emulation.setDeviceMetricsOverride', {width:1280,height:900,deviceScaleFactor:1,mobile:false});
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
    await evaluate('window.GM_getValue=(key,fallback)=>fallback; window.GM_setValue=()=>{}; __test.startLiveApp(); void 0');
    for(let i=0;i<60;i++) {
      if(await evaluate('!!__test.liveReader && !!document.querySelector(".hr-page-batch")')) break;
      await delay(500);
    }
    assert.equal(await evaluate('!!__test.liveReader && !!document.querySelector(".hr-page-batch")'), true, 'Live app initialized with the real scroll bridge');
    await evaluate('__test.store.updateSetting("doublePageMode",false)');
    for(const sign of [-1,1]) {
      await evaluate('__test.liveReader.open(1)');
      for(let i=0;i<100;i++) {
        if(await evaluate('!!document.querySelector(".pswp img.hr-reader-spread__page[src]")?.naturalWidth')) break;
        await delay(200);
      }
      await delay(700);
      assert.equal(await evaluate('!!document.querySelector(".pswp img.hr-reader-spread__page[src]")?.naturalWidth'), true, 'Live Reader image decoded');
      await drag(0,sign*300);
      assert.deepEqual(await evaluate(`({active:__test.liveReader.isActive(),roots:document.querySelectorAll('.pswp').length,
        hidden:document.documentElement.classList.contains('hr-reader-open'),
        visible:getComputedStyle(document.querySelector('.hr-page-batch')).visibility,
        locked:document.documentElement.style.overflow==='hidden'||document.body.style.overflow==='hidden'})`),
        {active:false,roots:0,hidden:false,visible:'visible',locked:false}, 'Live scroll bridge resumes after actual mouse drag exit');
    }
    console.log('Live 18comic app: decoded Reader images and actual mouse up/down exit restore the real waterfall.');
  }
} finally {
  await closeBrowser().catch(() => {});
  socket?.close();
  browser.kill();
  await delay(1000);
  await rm(profile, {recursive:true, force:true, maxRetries:5, retryDelay:300}).catch(() => {});
}
