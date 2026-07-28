# <img src="src/assets/icon.png" width="48" height="48" align="top" /> Hentai Reader (Formerly E-Hentai Plus)

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
- **Performance Engine** — Viewport-aware loading, `content-visibility`, lease-protected shared image tasks, and bounded LRU caches avoid duplicate work while allowing the browser to reclaim off-screen rendering resources.
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

## Tech Stack

- **TypeScript** + **Vite** + **vite-plugin-monkey**
- **PhotoSwipe** reader driver with project-owned CSS
- **Node.js test runner** for adapter, loading lifecycle, scheduling, and architecture boundary tests

## Project Structure

```
src/
├── main.ts                       # Entry point
├── app/                          # Application composition and dependency wiring
├── core/                         # Gallery, image, and site contracts
├── reader/                       # Reader controller, drivers, shell, and UI
│   ├── controllers/              # Image, prefetch, pagination, wheel, autoplay
│   ├── drivers/                  # PhotoSwipe integration boundary
│   └── shell/                    # Status and virtualized thumbnail UI
├── scroll/                       # Scroll lifecycle, navigation, and image events
├── services/                     # Shared loading, retry, scheduling, thumbnails
├── sites/                        # Per-site adapters (add a site here)
│   ├── site-manager.ts           # Adapter selection
│   ├── e-hentai/ · 18comic/ · 4khd/
│   └── _template/                # New-site starter adapter
├── ui/
│   ├── float-control.ts          # Floating controls
│   └── settings-panel.ts         # Settings panel
├── state/                        # config.ts · store.ts
│   └── types.ts                  # Application settings/config types
└── utils/                        # i18n · icons · viewport

tests/                            # Regression and architecture contract tests
docs/                             # Architecture, new-site guide, and backlog
```

## License

GNU General Public License v3.0 only (`GPL-3.0-only`). See [LICENSE](LICENSE).

## Development Documentation

The architecture is organized around `src/core/`, `src/services/`, `src/reader/`,
`src/scroll/`, and site adapters under `src/sites/`.

The completed refactor centralizes resolve, materialize, retry, cache, lease, and
resource ownership. Reader UI, PhotoSwipe integration, scroll lifecycle, and site
adapters are separated by explicit contracts so fixes remain local to their owner.

- [Final refactor plan](docs/final-refactor-plan.md)
- [New site adapter guide](docs/new-site-guide.md)
- [Deferred refactor backlog](docs/refactor-backlog.md)
