# <img src="src/assets/icon.png" width="48" height="48" align="top" /> Hentai Reader (原 E-Hentai Plus)

面向图库的高性能通用阅读器，适配移动端与触控设备，并以可扩展架构支持更多站点。

目前已适配（未来将适配更多）：
- E-Hentai / ExHentai
- 18comic（禁漫天堂）
- 4KHD

[English](README.md)

## 为什么选择 Hentai Reader

- **为性能而生。** 视口感知加载、浏览器原生离屏渲染抑制、有界共享缓存与方向性预取，让长篇图库保持流畅，同时避免重复下载。
- **随处可用。** 完整的桌面端操作（滚轮翻页、键盘、点击区）与一流的触控支持并存——点击翻页区、滑动翻页、双指缩放、自动隐藏界面——两端体验皆如原生。
- **一套阅读器，通吃所有站点。** 基于适配器的统一内核在各站点提供一致的阅读体验；新增站点无需改动阅读器本身。
- **稳健容错。** 加载失败自动重试并切换节点，配合「加载感知」的滚动门控，避免翻页冲过尚未加载完成的图片。

## 功能特性

- **无限卷轴模式** — 将多页图库转换为连续纵向滚动并自动预取，同时保留原生页面元数据（标签、标题、评论）。支持随时开关与即时刷新。
- **沉浸式阅读器** — 全屏无干扰阅读，支持键盘、滚轮、点击、滑动多种翻页方式，内置虚拟滚动缩略图面板用于快速跳转。
- **性能引擎** — 视口感知加载、`content-visibility`、租约保护的共享图片任务与有界 LRU 缓存避免重复工作，并允许浏览器回收离屏渲染资源。
- **桌面与触控** — 完整的桌面端操作（滚轮翻页、键盘、点击区），以及一流的触控支持：边缘点击翻页、滑动翻页、双指缩放、定时自动隐藏界面，专为单手阅读设计。
- **18comic 解码引擎** — Canvas 反乱序由共享优先级调度器统一管理，复用受管图片任务，并明确回收 Bitmap、Canvas、Blob 与 Object URL。
- **智能防屏蔽** — 域名特征匹配与重定向跟随，确保脚本在 4KHD 等频繁更换域名的站点上持续可用。
- **稳健加载** — 图片失败自动重试并切换 hath 节点，统一状态 HUD 显示加载进度，「加载感知」滚动门控在未加载页面处止步。
- **自动播放** — 可调速的幻灯片模式，解放双手。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 从 [Sleazy Fork](https://sleazyfork.org/zh-CN/scripts/565718-hentai-reader) 或 [GitHub release](https://github.com/Leovikii/Hentai-Reader/releases/latest/download/hentai-reader.user.js) 安装脚本

## 从源码构建

需要 Node.js 22.18 或更高版本。

```bash
npm install
npm run dev    # 开发模式（热重载）
npm run build  # 生产构建
npm test       # 回归测试
npm run check  # 类型检查、测试与生产构建
```

输出：`dist/hentai-reader.user.js`

## 技术栈

- **TypeScript** + **Vite** + **vite-plugin-monkey**
- **PhotoSwipe** 阅读器 Driver 与项目自有 CSS
- **Node.js 测试运行器**，覆盖适配器、加载生命周期、调度和架构边界

## 项目结构

```
src/
├── main.ts                       # 入口文件
├── app/                          # 应用组装与依赖注入
├── core/                         # Gallery、图片与站点契约
├── reader/                       # 阅读器控制器、Driver、Shell 与 UI
│   ├── controllers/              # 图片、预取、翻页、滚轮、自动播放
│   ├── drivers/                  # PhotoSwipe 集成边界
│   └── shell/                    # 状态 HUD 与虚拟化缩略图 UI
├── scroll/                       # 卷轴生命周期、定位与图片事件
├── services/                     # 共享加载、重试、调度与缩略图服务
├── sites/                        # 各站点适配器（新增站点在此）
│   ├── site-manager.ts           # 适配器选择
│   ├── e-hentai/ · 18comic/ · 4khd/
│   └── _template/                # 新站点适配器模板
├── ui/
│   ├── float-control.ts          # 悬浮控制按钮
│   └── settings-panel.ts         # 设置面板
├── state/                        # config.ts · store.ts
│   └── types.ts                  # 应用设置与配置类型
└── utils/                        # i18n · icons · viewport

tests/                            # 回归测试与架构契约测试
docs/                             # 架构、新站点指南与待办记录
```

## 许可证

GNU 通用公共许可证第 3 版（仅此版本，`GPL-3.0-only`）。详见 [LICENSE](LICENSE)。

## 开发文档

当前架构以 `src/core/`、`src/services/`、`src/reader/`、`src/scroll/` 和
`src/sites/` 下的站点适配器为核心。

已完成的重构统一了图片解析、物化、重试、缓存、租约和资源所有权。阅读器 UI、
PhotoSwipe 集成、卷轴生命周期与站点适配器通过显式契约隔离，使问题能够收敛在所属组件内。

- [最终重构计划](docs/final-refactor-plan.md)
- [新站点适配器指南](docs/new-site-guide.md)
- [延期优化待办](docs/refactor-backlog.md)
