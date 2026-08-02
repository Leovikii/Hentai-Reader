# 新站点接入指南

新站点只实现站点适配能力。不要复制 Reader、卷轴加载、重试、预取、缓存、
Blob 回收或缩略图面板逻辑。开始前先阅读 `architecture.md` 的兼容性红线；涉及当前版本
行为调整时，再按 `README.md` 的最小阅读顺序读取活动计划。

## 1. 选择图片能力

站点通常属于以下两类：

1. 有廉价缩略图：Gallery Item 使用 `preview.kind = 'url'`；Sprite 图使用
   `preview.kind = 'sprite'` 并提供准确 crop。
2. 没有缩略图：使用 `derived` 或 `none`。不要在适配器中批量下载原图充当
   缩略图。用户主动滚动缩略图面板并稳定 300ms 后，Reader 的 ThumbnailController
   会把实际可视范围按中心优先、并发 2 接入共享图片管线；再次滚动或 Reader 关闭时
   自动释放缩略图租约。

图片来源分为三个阶段：

- 直接 URL：`resolveImage()` 返回 `{ src: url }`。
- viewer 页面：`resolveImage()` 只抓取并解析一次 viewer，返回原图 URL 和可选
  节点信息。
- 下载后转换：`resolveImage()` 返回来源及 `materializeData`，
  `materializeImage()` 执行解码/转换并返回受管理 Blob。

适配器内部不得实现通用重试循环、图片结果缓存或独立预取队列。

## 2. 创建适配器

复制 `src/sites/_template/` 的配置方式，在 `src/sites/<site>/index.ts` 中创建
`SiteAdapter`。必须提供：

- `name` 和无副作用的 `match()`。
- `loadInitialPage()` 与支持 `AbortSignal` 的 `loadPage()`。
- 每项稳定且唯一的 `key`、`viewerUrl` 和标准 `preview`。
- 正确的 `nextUrl/prevUrl`，没有下一页时返回 `null`。
- `resolveImage()`；只有来源不能直接显示时才提供 `materializeImage()`。
- 原页面容器和必要的隐藏规则。

契约从 `src/core/site-adapter.ts` 导入；图片来源类型从 `src/core/image.ts` 导入。
初始页索引、每页数量等信息通过 `GalleryPage.position` 返回，不得由适配器直接写
全局 Store。

不要从适配器直接控制 Reader、Toast、HUD、缩略图面板或全局 Store。站点确实需要
同步 URL 时才实现 `onReaderClose()`，并只使用回调显式提供的生命周期上下文。

Reader、缩略图和卷轴通过稳定 `GalleryItem.key` 绑定同一逻辑页。页码由当前
Gallery 索引派生，不是站点适配器提供的持久身份。新站点不需要创建定位槽位、
监听布局变化或实现滚动校正；只需保证每项 key 稳定且唯一。`dimensions` 仅在
站点确实提前知道原图尺寸时提供，不得为了退出定位额外请求图片。公共卷轴会在
创建占位元素时自动使用该字段稳定几何；尺寸缺失时由公共层安全降级。

## 3. 限流与 materialize

需要保护 viewer 请求的站点可以使用共享 `NetLimiter`，并把 429/503 转为明确
错误和 cooldown。节点切换次数与普通重试次数由 `ImageLoadService` 控制，适配器
不能再嵌套重试。

Reader 默认保留前方 5 张、后方 2 张的字节预取窗口。需要先请求 viewer HTML、
限流严格或单图成本较高的站点，可通过通用 `readerPrefetch: { ahead, behind }`
声明更保守的窗口；直接 URL 站点通常无需覆盖。该配置只限制窗口规模，不替代
`NetLimiter` 的并发、优先级和 429/503 cooldown。

`materializeImage()` 必须：

- 接收并传递 `AbortSignal`。
- 释放 `ImageBitmap`、Canvas 临时对象和其他 CPU/GPU 资源。
- 生成 Object URL 时返回 `ownsObjectUrl: true`。
- 生成 Object URL 时同时返回真实 `byteSize`，供共享层执行 Blob 字节预算。
- 不自行 revoke 已交给统一加载服务的 Object URL。
- 对同一 viewer URL 保持确定性，去重由统一加载服务负责。

## 4. 契约测试

为站点添加无网络 fixture，至少覆盖：

- 图片选择器、去重和稳定 key。
- 直接缩略图、Sprite crop 或无预览声明。
- 下一页、上一页、首页、末页和自循环链接。
- viewer 成功、缺少图片、节点 token 和限流状态。
- materialize 直通、转换、取消、失败回退和资源释放。

使用 `tests/site-adapter-contract.ts` 检查标准 Gallery Page。测试加入
`package.json` 后执行：

```text
npm run typecheck
npm test
npm run build
git diff --check
```

## 5. 真实站点验收

每个新站点必须分别验证卷轴、Reader、预取、缩略图、前后翻页和关闭恢复。
Network 面板应确认同一 viewer URL 不会因多个消费者重复下载或转换。移动端还
需人工验证单指翻页、双指缩放、垂直关闭和 UI 自动隐藏。

完成测试后才把适配器注册到 `src/sites/site-manager.ts`。注册前不要扩大
userscript 的 `@match` 范围。
