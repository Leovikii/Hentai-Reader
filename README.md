# <img src="src/assets/icon.svg" width="48" height="48" align="top" /> Hentai Reader (Formerly E-Hentai Plus)

A high-performance universal reader for image galleries, built for mobile and touch with an extensible multi-site architecture.

Currently supported (more on the way):
- E-Hentai / ExHentai
- 18comic (JMComic)
- 4KHD

[中文](README.zh-CN.md)

## Why Hentai Reader

- **Built for performance.** Viewport-aware loading, browser-native off-screen rendering containment, bounded shared caches, and directional prefetching keep long galleries responsive without duplicate downloads.
- **Works everywhere.** Full desktop controls (wheel paging, keyboard, click zones) alongside first-class touch support — tap zones, swipe paging, pinch-zoom, and an auto-hiding UI — so it feels native on both.
- **One reader, every site.** A single adapter-based core delivers the same reading experience across sites; new sites plug in without touching the reader.
- **Resilient by design.** Automatic retry with node switching recovers failed loads, and a load-aware scroll gate keeps you from overshooting onto still-loading pages.

## Features

- **Infinite Scroll Mode** — Converts multi-page galleries into a continuous vertical scroll with auto-prefetching, while preserving native page metadata (tags, titles, comments). Toggle on the fly with instant reload.
- **Immersive Reader Mode** — A distraction-free, full-screen viewer with keyboard, wheel, tap, and swipe navigation, plus a virtual-scrolling thumbnail panel for quick jumps.
- **Dynamic Two-page View** — Enabled by default on wide screens: adjacent portrait pages form a zoomable spread, late size information keeps a stable reserved slot, and landscape pages or narrow screens safely remain single-page.
- **Performance Engine** — Foreground-first image scheduling, staged 5/2 directional prefetch, viewport-aware loading, lease-protected shared tasks, and bounded caches keep current pages fast without duplicate work.
- **Desktop & Touch** — Full desktop controls (wheel paging, keyboard, click zones) plus first-class touch: edge tap-to-page, swipe paging, pinch-zoom, and a timed auto-hiding UI for one-handed reading.
- **18comic Decoding Engine** — Canvas-based descrambling runs through the shared priority scheduler, reuses managed image tasks, and releases Bitmap, Canvas, Blob, and Object URL resources predictably.
- **Smart Anti-Blocking** — Domain feature-matching and redirect following keep the script working on sites like 4KHD that frequently change domains.
- **Robust Loading** — Automatic retry with hath-node switching for failed images, a unified status HUD for load progress, and a load-aware scroll gate that stops paging at unloaded pages.
- **Auto Play** — Adjustable slideshow mode for hands-free reading.

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Install the userscript from [Sleazy Fork](https://sleazyfork.org/zh-CN/scripts/565718-hentai-reader) or [GitHub release](https://github.com/Leovikii/Hentai-Reader/releases/latest/download/hentai-reader.user.js)

## Build from Source

Requires Node.js 22.18 or newer.

```bash
npm install
npm run dev    # Development (hot reload)
npm run build  # Production
npm test       # Regression tests
npm run check  # Typecheck, tests, and production build
```

Output: `dist/hentai-reader.user.js`

## License

GNU General Public License v3.0 only (`GPL-3.0-only`). See [LICENSE](LICENSE).
