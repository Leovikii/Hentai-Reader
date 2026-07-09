# <img src="src/assets/icon.png" width="48" height="48" align="top" /> Hentai Reader (原 E-Hentai Plus)

面向图库的高性能通用阅读器。现已适配移动端和触控设备，并持续适配更多站点。

目前已适配（未来将适配更多）：
- E-Hentai / ExHentai
- 18comic（禁漫天堂）
- 4KHD

[English](README.md)

## 为什么选择 Hentai Reader

- **为性能而生。** DOM 虚拟化自动卸载视口外的图片，配合方向性预取提前加载即将浏览的内容，上千张高清大图也能保持稳定帧率、不撑爆内存。
- **随处可用。** 完整的桌面端操作（滚轮翻页、键盘、点击区）与一流的触控支持并存——点击翻页区、滑动翻页、双指缩放、自动隐藏界面——两端体验皆如原生。
- **一套阅读器，通吃所有站点。** 基于适配器的统一内核在各站点提供一致的阅读体验；新增站点无需改动阅读器本身。
- **稳健容错。** 加载失败自动重试并切换节点，配合「加载感知」的滚动门控，避免翻页冲过尚未加载完成的图片。

## 功能特性

- **无限卷轴模式** — 将多页图库转换为连续纵向滚动并自动预取，同时保留原生页面元数据（标签、标题、评论）。支持随时开关与即时刷新。
- **沉浸式阅读器** — 全屏无干扰阅读，支持键盘、滚轮、点击、滑动多种翻页方式，内置虚拟滚动缩略图面板用于快速跳转。
- **性能引擎** — DOM 虚拟化与智能内存回收，在上千张高清大图下保持稳定帧率、告别内存溢出。
- **桌面与触控** — 完整的桌面端操作（滚轮翻页、键盘、点击区），以及一流的触控支持：边缘点击翻页、滑动翻页、双指缩放、定时自动隐藏界面，专为单手阅读设计。
- **18comic 解码引擎** — 采用 HTML5 硬件加速反乱序与快速 JPEG 重组，以极低 CPU 占用解码 18comic 的乱序图片，且不卡死浏览器。
- **智能防屏蔽** — 域名特征匹配与重定向跟随，确保脚本在 4KHD 等频繁更换域名的站点上持续可用。
- **稳健加载** — 图片失败自动重试并切换 hath 节点，统一状态 HUD 显示加载进度，「加载感知」滚动门控在未加载页面处止步。
- **自动播放** — 可调速的幻灯片模式，解放双手。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 从 [Sleazy Fork](https://sleazyfork.org/zh-CN/scripts/565718-hentai-reader) 或 [GitHub release](https://github.com/Leovikii/Hentai-Reader/releases/latest/download/hentai-reader.user.js) 安装脚本

## 从源码构建

```bash
npm install
npm run dev    # 开发模式（热重载）
npm run build  # 生产构建
```

输出：`dist/hentai-reader.user.js`

## 技术栈

- **TypeScript** + **Vite** + **vite-plugin-monkey**
- **PhotoSwipe**（阅读器）+ **UnoCSS**

## 项目结构

```
src/
├── main.ts                       # 入口文件
├── sites/                        # 各站点适配器（新增站点在此）
│   ├── site-manager.ts           # 适配器选择
│   ├── e-hentai/ · 18comic/ · 4khd/
├── features/
│   ├── scroll-mode.ts            # 无限卷轴模式
│   ├── single-page-mode.ts       # 阅读模式门面
│   ├── image-retry.ts            # 共享的解析/字节加载重试
│   └── prefetch-controller.ts    # 方向性预取
├── services/
│   ├── net-limiter.ts            # 并发与优先级限流器
│   └── page-parser.ts            # 页面 URL 与范围解析
├── ui/
│   ├── float-control.ts          # 悬浮控制按钮
│   ├── settings-panel.ts         # 设置面板
│   ├── components/status-hud.ts  # 加载状态 HUD
│   └── single-page/
│       ├── overlay.ts            # 阅读器覆盖层（PhotoSwipe）
│       ├── wheel-pager.ts        # 速度驱动滚轮翻页 + 加载门控
│       ├── auto-play.ts          # 自动播放逻辑
│       └── thumbnail-panel/      # 虚拟滚动缩略图
├── state/                        # config.ts · store.ts
├── types/                        # index.ts · site-adapter.ts
└── utils/                        # dom · i18n · icons · viewport
```

## 许可证

MIT
