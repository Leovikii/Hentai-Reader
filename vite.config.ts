import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { readFileSync } from 'fs';

const iconBase64 = readFileSync('src/assets/icon.png', 'base64');

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: {
          '': 'Hentai Reader',
          'zh-CN': '绅士阅读器',
        },
        namespace: 'http://tampermonkey.net/',
        homepageURL: 'https://github.com/Leovikii/Hentai-Reader',
        icon: `data:image/png;base64,${iconBase64}`,

        description: {
          '': 'A high-performance universal reader for image galleries, now with mobile and touch device support, plus infinite scroll, immersive reader mode, and smart image loading, with ongoing multi-site support (E-Hentai, 18comic, 4KHD).',
          'zh-CN': '面向图库的高性能通用阅读器，现已适配移动端与触控设备。支持无限卷轴、沉浸式阅读器与智能图片加载，多网站持续适配（E-Hentai、禁漫天堂、4KHD）',
        },
        author: 'Leovikii',
        updateURL: 'https://github.com/Leovikii/Hentai-Reader/releases/latest/download/hentai-reader.user.js',
        downloadURL: 'https://github.com/Leovikii/Hentai-Reader/releases/latest/download/hentai-reader.user.js',
        match: [
          'https://e-hentai.org/g/*',
          'https://exhentai.org/g/*',
          'https://e-hentai.org/s/*',
          'https://exhentai.org/s/*',
          '*://*.4khd.com/*',
          '*://*.xxtt.ink/*',
          '*://*.uuss.uk/*',
          '*://*.ssuu.uk/*',
          '*://*.18comic.vip/*',
          '*://*.18comic.ink/*',
        ],
        grant: [
          'GM_getValue',
          'GM_setValue',
          'GM_registerMenuCommand',
          'unsafeWindow',
        ],
        license: 'GPL-3.0-only',
      },
      build: {
        fileName: 'hentai-reader.user.js',
        autoGrant: true,
      },
    }),
  ],
});
