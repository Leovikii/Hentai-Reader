# <img src="src/assets/icon.png" width="48" height="48" align="top" /> Hentai Reader (Formerly E-Hentai Plus)

A high-performance universal reader for image galleries. Now with mobile and touch device support, and ongoing adaptation for more sites.

Currently supported (more on the way):
- E-Hentai / ExHentai
- 18comic (JMComic)
- 4KHD

[中文](README.zh-CN.md)

## Why Hentai Reader

- **Built for performance.** DOM virtualization unmounts off-screen images and directional prefetching loads what you're about to see, so thousands of high-resolution pages scroll at a stable frame rate without exhausting memory.
- **Works everywhere.** Full desktop controls (wheel paging, keyboard, click zones) alongside first-class touch support — tap zones, swipe paging, pinch-zoom, and an auto-hiding UI — so it feels native on both.
- **One reader, every site.** A single adapter-based core delivers the same reading experience across sites; new sites plug in without touching the reader.
- **Resilient by design.** Automatic retry with node switching recovers failed loads, and a load-aware scroll gate keeps you from overshooting onto still-loading pages.

## Features

- **Infinite Scroll Mode** — Converts multi-page galleries into a continuous vertical scroll with auto-prefetching, while preserving native page metadata (tags, titles, comments). Toggle on the fly with instant reload.
- **Immersive Reader Mode** — A distraction-free, full-screen viewer with keyboard, wheel, tap, and swipe navigation, plus a virtual-scrolling thumbnail panel for quick jumps.
- **Performance Engine** — DOM virtualization and smart memory recycling hold a stable frame rate through thousands of high-resolution images without memory overflow.
- **Desktop & Touch** — Full desktop controls (wheel paging, keyboard, click zones) plus first-class touch: edge tap-to-page, swipe paging, pinch-zoom, and a timed auto-hiding UI for one-handed reading.
- **18comic Decoding Engine** — HTML5 hardware-accelerated descrambling with fast JPEG reconstruction, decoding 18comic's scrambled images with minimal CPU load and no browser freezes.
- **Smart Anti-Blocking** — Domain feature-matching and redirect following keep the script working on sites like 4KHD that frequently change domains.
- **Robust Loading** — Automatic retry with hath-node switching for failed images, a unified status HUD for load progress, and a load-aware scroll gate that stops paging at unloaded pages.
- **Auto Play** — Adjustable slideshow mode for hands-free reading.

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Install the userscript from [Sleazy Fork](https://sleazyfork.org/zh-CN/scripts/565718-hentai-reader) or [GitHub release](https://github.com/Leovikii/Hentai-Reader/releases/latest/download/hentai-reader.user.js)

## Build from Source

```bash
npm install
npm run dev    # Development (hot reload)
npm run build  # Production
```

Output: `dist/hentai-reader.user.js`

## Tech Stack

- **TypeScript** + **Vite** + **vite-plugin-monkey**
- **PhotoSwipe** (reader) + **UnoCSS**

## Project Structure

```
src/
├── main.ts                       # Entry point
├── sites/                        # Per-site adapters (add a site here)
│   ├── site-manager.ts           # Adapter selection
│   ├── e-hentai/ · 18comic/ · 4khd/
├── features/
│   ├── scroll-mode.ts            # Infinite scroll mode
│   ├── single-page-mode.ts       # Reader mode facade
│   ├── image-retry.ts            # Shared resolve/byte-load retry
│   └── prefetch-controller.ts    # Directional prefetching
├── services/
│   ├── net-limiter.ts            # Concurrency & priority limiter
│   └── page-parser.ts            # Page URL and range parsing
├── ui/
│   ├── float-control.ts          # Floating controls
│   ├── settings-panel.ts         # Settings panel
│   ├── components/status-hud.ts  # Load status HUD
│   └── single-page/
│       ├── overlay.ts            # Reader overlay (PhotoSwipe)
│       ├── wheel-pager.ts        # Velocity wheel paging + load gate
│       ├── auto-play.ts          # Auto-play logic
│       └── thumbnail-panel/      # Virtual-scrolling thumbnails
├── state/                        # config.ts · store.ts
├── types/                        # index.ts · site-adapter.ts
└── utils/                        # dom · i18n · icons · viewport
```

## License

MIT
