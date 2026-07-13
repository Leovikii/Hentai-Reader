# Hentai Reader 最终标准化重构计划

本文档是最终重构工作的进度基线和验收清单。后续实施必须参照本
文档推进，并在每个子项完成、延期或改变方案时同步更新，不能仅凭文件已经
创建或代码已经接入就将阶段标记为完成。

## 状态定义

- `已完成`：实现、自动化检查和该阶段要求的兼容性验证均已通过。
- `待验收`：主体实现已存在，但缺少专项测试或真实站点回归，不能封板。
- `进行中`：只有部分能力完成，仍存在计划内的结构或行为改动。
- `未开始`：尚未进入实现。
- `延期`：已明确不阻塞当前主线，记录在 backlog 中等待后续处理。

## 总体目标

1. 核心加载、重试、缓存、Reader 和 UI 不包含站点特例。
2. 新站点主要通过标准适配器接入，不复制加载、重试、预取和 Reader 逻辑。
3. 卷轴模式、Reader、预取和缩略图共享同一图片任务与资源所有权。
4. PhotoSwipe 通过 `ReaderDriver` 隔离，未来可升级或替换而不改站点适配器。
5. 保持移动端手势、桌面滚轮、缩放、自动播放和跨页行为兼容。
6. 对网络请求、Blob、Canvas、图片缓存和 DOM 生命周期建立明确所有权。

## 兼容性红线

以下内容除非经过单独评审和真实站点测试，不在结构重构中改变：

- 不改变 4KHD 的站点选择器和图片 URL 生成规则。
- 不改变 E-Hentai/ExHentai 的 viewer 页面协议、`nl` 节点切换语义和限流策略。
- 不改变 18comic 的反乱序算法、章节参数提取方式和站点脚本兼容处理。
- 不改变 PhotoSwipe 的移动端原生拖动、缩放和双指手势语义。
- 不改变桌面端滚轮翻页、缩放状态下原生滚动处理和 UI 区域事件屏蔽。
- 不为了抽象而增加重复下载、重复解码、长期持有 Blob 或大量主线程 Canvas 工作。
- 不在同一阶段混入无关 UI 改版或站点选择器重写。

## 目标架构

最终预期结构如下。实现时允许根据职责边界微调文件名，但不能重新引入跨层
循环依赖或站点特例进入核心组件。

```text
src/
  app/
    create-reader.ts

  core/
    gallery.ts
    gallery-page-loader.ts
    image.ts
    site-adapter.ts

  services/
    image-load-service.ts
    image-load-runtime.ts
    materialize-scheduler.ts
    net-limiter.ts
    thumbnail-service.ts

  reader/
    index.ts
    contracts.ts
    reader-controller.ts
    reader-session.ts
    controllers/
      image-controller.ts
      pagination-controller.ts
      prefetch-controller.ts
      thumbnail-controller.ts
    drivers/
      photoswipe-driver.ts
    shell/
      reader.css
      reader-shell.ts
      status-hud.ts
      thumbnail-panel/
        index.ts
        panel.ts
        progress.ts
        mouse-tracker.ts

  scroll/
    scroll-controller.ts
    scroll-navigation.ts
    image-events.ts

  sites/
    site-manager.ts
    4khd/
      index.ts
    e-hentai/
      index.ts
    18comic/
      index.ts
      materializer.ts
    _template/
      index.ts
      fixtures/
      adapter.test.ts

  state/
    config.ts
    store.ts
    types.ts

  ui/
    float-control.ts
    settings-panel.ts
    global.css

docs/
  final-refactor-plan.md
  new-site-guide.md
  refactor-backlog.md
```

目录决策：共享加载、限流、materialize 调度和缩略图策略统一保留在
`services/`，不再为了领域命名机械改成 `loading/`。应用组装只存在于 `app/` 和
`main.ts`；卷轴生命周期收口到 `scroll-controller.ts`，一次性逻辑页跳转收口到
`scroll-navigation.ts`。Reader 通过注入契约使用卷轴桥接和 UI 状态，不直接导入
卷轴实现、站点适配器或全局 Store。最终删除空的 `features/`、旧 `ui/single-page/`
和仅作中转的 `types/site-adapter.ts`、`types/image-load.ts`。`image-window.ts` 已根据
阶段 9 的真实内存基线否决，不属于目标目录。

## 标准契约目标

站点能力应拆分为可组合契约，而不是让 UI 读取站点 DOM 或调用站点私有逻辑：

- `GalleryAdapter`：解析初始页和后续页，返回标准 `GalleryPage/GalleryItem`。
- `ImageResolver`：把 viewer URL 解析为可下载来源，可返回节点切换信息。
- `ImageMaterializer`：把来源转换为可显示资源；直接 URL 可透传，18comic 可在
  此处下载、反乱序、解码并转为受管理 Blob。
- `PreviewProvider`：声明 URL、Sprite、派生缩略图或无缩略图能力。
- `SiteLifecycle`：仅处理确实属于站点的进入/退出同步，不能直接控制 Reader UI。
- `ReaderDriver`：封装 PhotoSwipe 的导航、事件、缩放、手势和 UI 挂载能力。

加载服务负责完整生命周期：

```text
viewer URL
  -> resolve
  -> materialize
  -> byte validation / dimensions
  -> shared cache
  -> leases for scroll / reader / prefetch / thumbnail
  -> delayed eviction and Blob revoke
```

## 阶段总览

| 阶段 | 状态 | 当前结论 |
| --- | --- | --- |
| 1. 现状冻结和契约设计 | 已完成 | 已明确共享加载生命周期和站点边界 |
| 2. Gallery 标准模型 | 已完成 | `GalleryItem/GalleryPage/GalleryPageLoader` 已接入 |
| 3. 统一加载和重试 | 已完成 | 完整生命周期去重、租约、重试和 LRU 已建立 |
| 4. Reader 核心标准化 | 已完成 | 桌面、移动端和三站真实功能回归通过 |
| 5. 迁移 4KHD | 已完成 | 标准接口、跨页、缩略图和 Reader 真实回归通过 |
| 6. 迁移 E-Hentai | 已完成 | viewer、节点、Sprite、翻页和 Reader 真实回归通过 |
| 7. 迁移 18comic | 已完成 | `materialize()`、反乱序、跨章节和资源清理真实回归通过 |
| 8. 卷轴生命周期和定位 | 已完成 | 三站真实回归通过，采用一次逻辑页居中并接受后续自然布局变化 |
| 9. 性能和内存回收 | 已完成 | 208 页 18comic 实测无持续内存增长，窗口化因收益不足延期 |
| 10. 清理和新站点模板 | 已完成 | 旧路径清理、新站点模板和三站真实回归通过 |
| 11. 最终依赖边界收口 | 已完成 | 静态边界、浏览器 smoke、桌面和移动端最终测试通过 |

## 阶段 1：现状冻结和契约设计

状态：`已完成`

已完成：

- 明确卷轴、Reader、预取和缩略图必须共享同一加载服务。
- 明确站点适配器只提供站点能力，不拥有通用重试和 UI。
- 明确 PhotoSwipe 必须隔离在 Driver 内。
- 建立兼容性优先、分阶段验证和不同时改动站点协议的原则。

完成条件：已满足。

## 阶段 2：Gallery 标准模型

状态：`已完成`

已完成：

- 建立 `GalleryItem`、`GalleryPage`、`PreviewDescriptor`。
- 建立 `GalleryAdapter/SiteAdapter`。
- 建立 `GalleryPageLoader` 的并发去重、加载记录、空页终止和循环保护。
- 三个现有站点均返回标准 Gallery 数据。
- 已添加 Gallery Page Loader 自动化测试。

完成条件：已满足。

## 阶段 3：统一加载和重试

状态：`已完成`

已完成：

- `ImageLoadService` 统一 resolve、字节加载、重试、状态和结果缓存。
- `acquire/release` 租约支持多个消费者共享一个进行中任务。
- 前台加载可提升后台任务优先级。
- 失败任务可清除并允许后续恢复。
- E-Hentai 节点重试和普通重试预算集中管理。
- 18comic 生成的 Object URL 所有权已交给加载服务。
- 建立受租约保护的图片 LRU 和 Blob revoke 测试。
- 删除旧 `image-resolver.ts`、`page-parser.ts` 和 `image-retry.ts`。

最终清理：`ImageLoadCoordinator` 已删除。完整生命周期去重、重试、最终 URL
发布和缓存均由 `ImageLoadService` 负责，避免双重 in-flight Map 和双缓存所有权。

完成条件：已满足。后续阶段可以调整文件位置，但不能破坏已验证语义。

## 阶段 4：Reader 核心标准化

状态：`已完成`

已完成：

- 抽出 Reader 图片控制器。
- 抽出 Reader 翻页控制器。
- 抽出预取控制器。
- PhotoSwipe 内部访问集中到现有 `photo-swipe-driver.ts`。
- 抽出 Reader Shell、状态 HUD 和缩略图 UI 的部分挂载逻辑。
- 桌面滚轮捕获和移动端边缘翻页已由 Driver 管理。
- 已创建正式 `src/reader/` 目录。
- 已定义不引用 PhotoSwipe 类型的 `ReaderDriver` 和 Driver Factory。
- 已创建 `ReaderSession`，接管 Reader 当前索引和 live DOM 图片注册表。
- 已创建 `ReaderController`，原 `overlay.ts` 已缩减为兼容导出。
- 图片、翻页、预取、缩略图、自动播放和滚轮控制器已迁入
  `reader/controllers/`。
- Driver 已迁入 `reader/drivers/`，ReaderController 不再依赖具体 PhotoSwipe 类。
- Shell、HUD 和缩略图面板已迁入 `reader/shell/`。
- 已用模块内订阅和直接回调替换三个 `sp-*` 全局 DOM 事件。
- 缩略图面板已通过 ThumbnailController 请求共享图片加载，不再直接导入
  `loadPlaceholderImage()`。

最终验收：

- 2026-07-14 桌面和移动端真实站点确认 Reader 打开、关闭、缩略图、自动播放和跨页正常。
- 移动端单指翻页、双指缩放、垂直关闭和 UI/面板交互正常。
- 旧兼容入口、Store UI 镜像和旧 `overlay.css` 路径已在阶段 10、11 清理。

完成条件：

- 核心 Reader 文件不导入任何站点适配器实现。
- 除 PhotoSwipe Driver 外没有文件导入 PhotoSwipe 或访问其内部字段。
- Reader Shell 只依赖 `ReaderDriver`，不依赖 `PhotoSwipeDriver`。
- Reader 生命周期不直接依赖全局 DOM 事件。
- 桌面滚轮、移动端手势、缩放、自动播放、缩略图跳转、前后翻页和关闭清理通过。

## 阶段 5：迁移 4KHD

状态：`已完成`

已完成：

- 4KHD 已实现标准 `SiteAdapter`。
- 图片以直接 URL 进入统一加载服务，不额外抓取 viewer 页面。
- 标准 Gallery Item 同时提供原图和轻量缩略图 URL。
- 4KHD 正文 `width/height` 经真实站点追踪证实是通用展示值，可能与原图比例不同；
  适配器不发布该不可靠几何，统一使用公共未知尺寸降级。
- 页面加载支持 `AbortSignal`。
- 卷轴、Reader、预取和缩略图已通过共享调用链运行。
- 已添加 URL 变换、过滤和数值前后页 fixture 契约测试。

最终验收：

- 首页和非首页的全局索引、卷轴加载、Reader、相邻预取、缩略图和跨页均通过真实站点验证。
- 4KHD 保持为 `_template` 的最简直接 URL 参考实现，不向模板复制站点选择器。

完成条件：

- 上述契约测试通过。
- 真实站点卷轴和 Reader 基本回归通过。
- Network 面板确认一个 viewer URL 不发生重复图片下载。

## 阶段 6：迁移 E-Hentai

状态：`已完成`

已完成：

- Gallery 页面返回标准 Items、前后页和页数。
- 每次 resolve 尝试只解析一次 viewer 页面。
- `nl` 节点信息进入统一加载服务的节点切换流程。
- 429/503 会暂停共享 `NetLimiter`。
- viewer 页面和 Gallery 页面请求共用限流器并支持优先级。
- 普通缩略图和 Sprite Crop 均迁移到标准 Preview Descriptor。
- 大幅跳转会取消低优先级排队预取。
- 已添加普通缩略图、Sprite crop、分页范围、viewer URL 和 `nl` 解析测试。

最终验收：

- 429/503、节点切换和重试预算由统一限流及自动化测试覆盖，真实使用未观察到请求风暴。
- E-Hentai/ExHentai 的前后翻页、全局计数、Sprite/普通缩略图和关闭同步通过真实回归。

完成条件：

- 限流、节点切换和翻页契约测试通过。
- 真实站点未出现重复 viewer 请求、无限重试或错误节点缓存。

## 阶段 7：迁移 18comic

状态：`已完成`

已完成：

- Gallery 页面返回标准 Items 和章节翻页 URL。
- `aid/scramble_id` 已随 viewer identity 保存，支持跨章节解析。
- 外层统一加载服务可以去重同一图片的下载和解码请求。
- 反乱序结果使用受加载服务管理的 Object URL。
- 无原始缩略图明确表示为 `PreviewDescriptor` 的无预览能力。
- 派生缩略图方向已记录到 `refactor-backlog.md`。
- 已在标准契约中加入 `materializeImage()` 和 opaque `materializeData`。
- 原图下载、`createImageBitmap`、反乱序、Canvas 导出和 Blob 创建已迁入
  `18comic/materializer.ts`。
- 中央 `MaterializeScheduler` 统一管理并发、取消和优先级提升。
- 适配器内部 `Mutex`、`bumpPriority()` 和 `cancelPrefetch()` 已删除。
- 已添加 URL metadata、直通条件、条带绘制顺序、Bitmap 释放、队列优先级和
  queued abort 测试。
- 真实站点首轮测试发现迁移时把 `OffscreenCanvas.getContext('2d')` 误写为
  无参数调用，导致静默回退到原始乱序图；现已恢复 `'2d'` 参数并增加参数断言。
- 解码环境不可用时不再展示原始乱序图，而是进入统一重试并最终显示加载错误。

最终验收：

- 原 DOM 属性、反乱序、章节前后翻页、Reader 和关闭清理通过真实站点回归。
- 解码失败、取消、队列优先级、Bitmap 释放及 Blob 生命周期由自动化和长篇内存基线覆盖。
- 无廉价原始缩略图时维持当前非阻塞占位/已加载图派生策略；进一步体验优化保留在 backlog，
  不阻塞架构封板。

完成条件：

- 适配器不再拥有独立并发队列。
- 同一图片在卷轴、Reader、预取和缩略图间只下载/解码一次。
- 真实站点章节切换、阅读和关闭清理通过。

## 阶段 8：卷轴生命周期和定位

状态：`已完成`

确认保留：

- Reader 打开时显式暂停新的卷轴 IntersectionObserver 任务。
- Reader 关闭时重新观察未加载占位符。
- 已完成卷轴图片通过租约继续保留资源。
- 正在进行的卷轴任务可被 Reader 复用并提升优先级。
- Reader 打开时隐藏卷轴但保留布局几何，减少背景闪烁。
- 已删除最长 12 秒的布局稳定器执行路径，不再使用 ResizeObserver、全局 DOM
  MutationObserver、双 RAF 重复校正或退出后的 scrollTo 拉回。

已否决并撤回：

- 不再以“图片加载后仍保持精确像素位置或居中”为完成目标。未知图片尺寸、短图
  一屏多页、前方占位符刷新和站点布局变化使该目标必须依赖额外加载或持续校正，
  与兼容性优先原则不符。
- 删除 `.hr-image-slot` 的几何所有权、`aspect-ratio/max-width` 同步和尺寸注册表。
- 删除专为槽位同步建立的全局图片资产事件；加载服务只保留 Reader 和当前目标
  几何投影本来就需要的尺寸缓存。
- 删除 Reader 关闭时的尺寸同步、锚点高度计算和精确相对位置恢复工具。
- 当前槽位实现仅为阶段 8 定位服务，不作为阶段 9 窗口化基础继续保留；窗口化
  需要独立评审其高度估算、节点回收和长篇内存边界。

已实施：

- Reader 打开时仅记录原始 `window.scrollY`、起始索引和稳定 `GalleryItem.key`。
- Reader 内没有导航：关闭时恢复原始 `scrollY` 一次。
- Reader 内发生导航：使用 `ReaderSession.currentIndex -> GalleryItem.key` 找到对应
  `.r-ph/.r-img`。退出前只在当前索引前后最多 5 项内，把共享缓存中已经存在的尺寸
  投影到 placeholder，然后按图片整体几何统一居中；尺寸未知时也以当前 placeholder
  几何居中，不等待图片任务。
- `GalleryItem.key` 是持久身份；页码只由 `store.imageOffset + currentIndex + 1`
  派生并供 Reader/缩略图显示，不写入需要在 prepend 后全量更新的 DOM 状态。
- Reader 最终返回进入时同一个 item key 时，无论中途是否翻页，都恢复进入前的
  原始 `scrollY`；目标已经处于中心容差内时不再调用滚动 API。
- placeholder 替换为 image 时继续复制 `data-item-key`，不增加永久 wrapper、Map、
  ResizeObserver、MutationObserver、计时器或额外网络任务。
- 适配器可选提供 `GalleryItem.dimensions`；公共卷轴在 placeholder 创建时统一消费。
  只有能保证原图比例可靠的站点才能提供，其他站点使用默认占位安全降级。
- 有界几何投影最多检查 11 项，只设置已有尺寸对应的
  `aspect-ratio/max-width/min-height`；不创建图片、不获取新租约、不等待下载或解码。
  范围覆盖现有 Reader 预取窗口，用于避免已预取邻项在卷轴恢复时改变附近几何。
- 定位、显示卷轴和恢复懒加载仍在 PhotoSwipe 覆盖期间同步完成；覆盖消失后不再
  写入滚动位置。
- 删除关闭时挂载目标图片并监听替换的二次纠偏；真实站点曾在 4KHD 观察到该路径
  不能改善最终位置且会产生一次可见抖动。
- 清理无调用的居中、双 RAF 和相对锚点工具及其过时测试。
- 跳转使用目标实时矩形计算文档中心坐标并执行一次 `window.scrollTo()`，不依赖站点
  的 `scrollIntoView`、`scroll-padding` 或 `scroll-margin` 行为。跳转时临时强制文档
  `scroll-behavior: auto !important`，完成后立即恢复站点原样式。
- 已知尺寸 placeholder 同时投影最终图片的 20px 下边距，避免占位符原 50px
  间距在替换时把后续逻辑页推移约 30px。
- 未知尺寸 `.r-ph` 的 `contain-intrinsic-size` 与实际 `min-height: 400px` 对齐，
  避免远距离跳转时多个离屏 `100vh` 估算在进入渲染范围后同时收缩。真实图片仍
  保留离屏渲染优化；该修复不增加网络、DOM、观察器或滚动校正。
- 浏览器 smoke 验证已知尺寸目标在有界投影后接近视口中心，随后一秒无漂移；
  移动端 UI 样式路径结果相同，置顶后未被旧 Reader 状态拉回。
- 居中 smoke：`1080px` 长图在 `720px` 视口中顶部约 `-182px`，理论中心为
  `-180px`；`360px` 短图顶部约 `178px`，理论中心为 `180px`。随后 500ms 内
  位置不变。
- 浏览器 smoke 验证尺寸未知且跳转后约 30ms 立即关闭时不等待图片任务；后续
  自然布局变化不触发任何二次定位。
- 浏览器 smoke 验证 Reader 中离开后返回进入时相同 item key，退出立即及随后
  500ms 均保持原 `scrollY = 900`。
- 浏览器 smoke 验证 Reader 未导航时恢复原 `scrollY`，打开期间插入前置内容后仍
  通过 key/index 找到正确目标。

验收结果：

- E-Hentai 和 18comic 真实站点确认退出定位正常。
- 4KHD 真实跟踪确认退出瞬间能够准确居中；站点 HTML 的通用展示尺寸不可靠，
  已撤销该适配器的静态尺寸发布，后续上方未知图片加载造成的自然布局变化按既定
  降级语义接受。
- 三站均不执行关闭后的二次滚动，不会在用户置顶、触摸或滚轮操作后拉回旧位置。
- 本阶段完成条件已满足；后续窗口化不得重新使用已否决的精确定位槽位或稳定器。

完成条件：

- 未导航或最终返回进入 item 时恢复进入前位置；切换到其他 item 时最多执行一次
  有界几何投影和一次居中逻辑页跳转。
- 不承诺图片后续加载后的精确居中或像素位置保持。
- 关闭完成后任何置顶、滚轮、触摸或键盘滚动均不会被旧 Reader 状态拉回。
- 定位不增加图片请求、图片节点、解码、长期观察器、定时器或按图片数量增长的
  第二套尺寸缓存。

## 阶段 9：性能和内存回收

状态：`已完成`

已完成：

- Reader 预取窗口离开后释放租约。
- Reader 关闭时清理全部预取租约。
- 图片资源使用默认 80 项 LRU，受活跃租约保护。
- 受管理 Blob 在淘汰时 revoke。
- 缩略图 Canvas 使用 60 项 LRU 并限制到约 300px。
- 缩略图条目已有 UI 池化和可视范围渲染基础。
- LRU 淘汰会同步清理 resolved URL、尺寸和内部 phase 元数据。
- 已添加 1000 项 Gallery 回归，确认默认缓存稳定保留 80 项并回收其余 920 项。
- 已完成 Reader、卷轴、预取和缩略图 acquire/release 审计；Reader 图片窗口、预取窗口、
  关闭清理和订阅释放均对称，缩略图 Shell 是脚本生命周期单例，不会按 Reader 开关累积。
- `ImageLoadService.getStats()` 按调用即时计算 active load、缓存、租约、Blob、phase 和监听器
  数量，不增加常驻采样、定时器或正式 UI。
- 已补充 Reader -> 卷轴立即复用受管理 Blob、300 项全租约保护与最终释放、反向命中缓存、
  1000 项淘汰和 Object URL revoke 回归。
- 浏览器基线确认 300/1000 个未加载占位节点初始化约为 3.2ms/11.8ms；300 项桌面与
  412x915 移动视口均只加载视口附近 6-7 张，Reader 关闭后 active load 和监听器归零，
  无额外 Canvas 或控制台异常。
- 缓存策略首轮评审结论：现有 80 项图片 LRU 已覆盖 Reader 关闭后立即回卷轴复用；
  目前没有重复下载/解码证据，因此不增加 Blob 延迟定时器、设备/站点特例或估算字节上限。
- 真实 Edge/18comic 208 页完整卷轴基线：初始 `276720K`；22 张 Blob 时 `430416K`；
  104 张时 `397612K`；208 张时 `421460K`，Canvas 始终为 0。Blob URL/DOM 随图库长度
  增长，但标签页内存未随 `22 -> 104 -> 208` 持续增长，浏览器能够回收离屏解码/渲染资源。
- 基于真实基线否决当前实施 DOM 窗口化：它需要重新引入高度骨架、节点恢复、租约重建和
  定位兼容逻辑，而当前没有可复现的持续内存增长足以覆盖这些风险。

延期：

- 卷轴离屏 DOM/图片窗口化仅在未来出现超长图库崩溃、持续线性内存增长或浏览器无法
  回收离屏解码资源时重新评审；不得仅根据 Blob URL 数量增长启动实现。

第一批结果与下一步评审：

1. **首批已完成**：生命周期审计、只读统计、300/1000 项 fixture、Reader -> 卷轴
   Blob 复用和 LRU/revoke 回归均通过，且没有改变生产加载行为。
2. **已确认的边界**：卷轴中的 18comic Blob 必须由当前 `<img>` 持有租约；已浏览图片
   永久留在 DOM 时，受租约保护的缓存可以超过 80。这个上限不能靠字节预算或定时淘汰
   解决，否则可能 revoke 正在显示的图片。
3. **DOM 窗口化评审结论**：208 页真实基线无持续内存增长，不创建 `image-window.ts`。
   保留当前 `content-visibility + 浏览器离屏解码回收 + 租约保护`，避免重新引入阶段 8
   已消除的几何和定位复杂度。

完成条件：

- active load、非使用中缓存和 Canvas 数量保持有界；卷轴 DOM/Blob 受当前图库长度约束，
  不随 Reader 开关或重试次数重复增长。
- 前后快速浏览不会因过早回收造成明显重复下载/解码。
- 真实长篇阅读不出现与已加载图片数量同步的持续内存增长。

## 阶段 10：清理和新站点模板

状态：`已完成`

已完成：

- 删除旧 `prefetchImageUrl()` 调用链。
- 删除旧 `PageLink` 兼容字段。
- 删除旧 `image-retry.ts` 重复逻辑。
- 删除旧 `image-resolver.ts` 和 `page-parser.ts`。
- PhotoSwipe 导入和内部字段访问已集中到 Driver 文件。
- 旧 Reader 兼容实现文件已删除，仅保留 Reader 使用的 `overlay.css`。
- `ImageLoadCoordinator` 已合并进统一加载生命周期并删除。
- 已创建 `src/sites/_template/`、共享 Gallery 契约检查和模板测试。
- 已创建 `docs/new-site-guide.md` 并在 README 中链接开发文档。
- 删除只写不读的 `Store.totalPage`；自动播放定时器归 `AutoPlayController` 会话内持有。
- `ReaderSession` 成为 Reader 当前索引和 live DOM 注册表的唯一所有者；缩略图面板和
  进度条通过 Reader Shell 的只读回调获取状态，不再镜像到全局 Store。
- 卷轴 placeholder 替换事件改用稳定 `GalleryItem.key` 解析索引，不依赖 Reader 是否打开过。
- `resolvedUrls/imageDimensions` 镜像已删除；Reader 和退出几何只读取统一加载服务中仍有效的
  缓存资产，淘汰后的 Object URL 不会继续被 Reader 引用。
- README 已改为当前 `core/services/reader/scroll/sites` 目录结构，并删除未实现的卷轴 DOM
  virtualization 宣称，准确描述 `content-visibility`、共享租约和 LRU。
- 全仓审计确认 PhotoSwipe 包导入和 `currSlide` 等内部访问只存在于 Driver；旧加载器、
  Resolver、Page Parser、Reader UI 路径均无代码引用。
- 浏览器 smoke 已覆盖桌面与 412x915 移动视口、卷轴/非卷轴、缩略图跳转和关闭返回；
  目标居中误差约 0-1px，控制台无异常。

最终验收：

- 2026-07-14 在 4KHD、E-Hentai/ExHentai 和 18comic 的桌面、移动端确认卷轴、Reader、
  缩略图跳转、自动播放、关闭返回及站点特有行为没有回归。

完成条件：

- 新站点可仅实现所需适配器能力，不复制 Reader、重试、预取和缩略图逻辑。
- 模板契约测试可以在无真实网络环境下验证基本适配器行为。
- 全仓库不存在旧接口引用和 PhotoSwipe 跨层内部访问。

## 阶段 11：最终依赖边界收口

状态：`已完成`

已完成：

1. 将 `features/scroll-mode.ts` 收口为 `scroll/scroll-controller.ts`，将
   `features/single-page-mode.ts` 收口为 `app/create-reader.ts`，删除过渡目录。
2. 在 Reader 契约中建立 `ReaderScrollBridge`；暂停/恢复懒加载、请求卷轴图片、
   图片替换订阅和退出定位均由应用组装层注入，Reader 不直接导入卷轴实现。
3. Reader Shell 通过只读上下文获得 Gallery Item、缩略图位置和设置变更订阅，
   thumbnail panel、progress 和 mouse tracker 不直接读取全局 Store。
4. 将站点和图片契约从 `types/` 收口到 `core/`；Reader handle 归入 Reader 契约，
   保持 `core` 不依赖 services、Reader、UI、Store 或具体站点。
5. Reader CSS 移入 `reader/shell/`；PhotoSwipe 包导入和内部访问仍只允许存在于 Driver。
6. 站点协议、重试预算、18comic materialize、E-Hentai 限流和 PhotoSwipe 手势保持不变。
7. 建立 `ReaderAppContext`，ReaderSession、分页、自动播放和 Reader Shell 均不再导入
   全局 Store；只有 `app/create-reader.ts` 负责把应用状态映射到 Reader 契约。
8. E-Hentai/4KHD 初始页偏移改由标准 `GalleryPage.position` 返回，适配器不再写 Store；
   `onReaderClose()` 通过显式上下文接收 scroll mode 和 page size。
9. 新增 5 项架构契约测试，持续禁止 Reader 反向依赖、站点写 Store、core 跨层依赖、
   旧过渡路径复活和 PhotoSwipe 内部访问扩散。
10. 本地浏览器 smoke 通过：桌面卷轴/非卷轴、缩略图跳转、自动播放启动与暂停、关闭
    返回、412x915 移动视口及 1000 项基线均正常；控制台无错误或警告。
11. 悬浮控件 SVG 已按填充/描边类型隔离宿主页面样式；浏览器 smoke 在强制 SVG 覆盖场景下
    验证 Reader、卷轴、置顶和设置图标的计算样式正确。

完成条件：

- `reader/` 不导入 `features/`、`scroll/`、具体站点或 UI Store 实现。
- `reader/shell/` 不直接导入全局 Store。
- `core/` 不反向依赖应用层目录，站点适配器只实现 core 契约。
- `features/` 和 `ui/single-page/` 过渡目录删除。
- 类型检查、单元测试、生产构建、桌面/移动浏览器 smoke 通过。
- 2026-07-14 最终三站桌面和移动端真实回归通过，阶段 4–7、10、11 已封板。

## 验证矩阵

每个涉及行为的阶段至少执行以下自动化检查：

```text
npm run typecheck
npm test
npm run build
git diff --check
```

浏览器 smoke 必须覆盖：

- 卷轴模式按视口加载并避免重复任务。
- 非卷轴模式打开 Reader 后才加载图片。
- Reader 当前图片、相邻预取和大幅缩略图跳转。
- 前后翻页、计数更新和自动播放末尾停止。
- 桌面滚轮翻页；缩放状态下不抢夺 PhotoSwipe 行为。
- 缩略图面板不触发无界原图加载。
- Reader 关闭后的 overflow、资源租约、未导航恢复和已导航单次逻辑页跳转。
- Blob 在使用期间有效，并在最终淘汰后 revoke。
- 浏览器控制台无未处理异常。

真实站点回归矩阵：

| 站点 | 卷轴 | Reader | 预取 | 缩略图 | 前后翻页 | 特有行为 |
| --- | --- | --- | --- | --- | --- | --- |
| 4KHD | 必测 | 必测 | 必测 | URL 缩略图 | 必测 | URL 变换 |
| E-Hentai | 必测 | 必测 | 必测 | 普通/Sprite | 必测 | 限流、`nl` |
| ExHentai | 必测 | 必测 | 必测 | 普通/Sprite | 必测 | 登录态、`nl` |
| 18comic | 必测 | 必测 | 必测 | 占位/派生 | 必测 | 反乱序、Blob |

移动端真实手势无法由当前桌面 smoke 完整替代。涉及 Driver、PhotoSwipe 或触摸
事件的阶段完成后，必须请求人工测试以下项目：

- 单指左右翻页和边缘跨页。
- 双指缩放、缩放后拖动和恢复。
- 垂直拖动关闭。
- UI 自动隐藏、面板交互和点击区域。

## 延期项目

- 18comic 派生缩略图属于非阻塞体验优化，主 Reader 结构完成前不恢复大范围
  原图缩略图加载。详细策略见 `docs/refactor-backlog.md`。
- 卷轴 DOM 窗口化必须独立评审高度估算和节点回收，不由退出定位方案预先决定结构。

## 进度维护规则

1. 开始一个阶段前，先核对本文件的已完成项和兼容性红线。
2. 每完成一个子项就更新对应清单，不等整个阶段结束后一次性补记。
3. 只有满足该阶段全部“完成条件”才能标记为 `已完成`。
4. 主体代码完成但缺真实站点测试时标记为 `待验收`。
5. 发现新问题时先判断是否阻塞主线；不阻塞的写入 `refactor-backlog.md`。
6. 修改架构或验收口径时，在实施前更新本文件并说明原因。
7. 每轮交付必须说明本轮完成的阶段、未完成项、自动化结果和需要人工测试的内容。
8. 不以目录生成、类型存在或一次 smoke 通过代替完整阶段验收。

## 下一步执行顺序

1. 阶段 1–11 已完成并封板；后续只接受可复现的兼容回归或独立功能需求。
2. 定位机制维持一次逻辑页跳转，不重新引入关闭后定时器、观察器或二次滚动修正。
3. 维持现有数量 LRU，不增加字节预算、保留定时器、DOM 窗口化或站点特例。
4. 新站点按 `_template` 和 `new-site-guide.md` 接入，不复制 Reader、加载、重试和缩略图逻辑。
5. 非阻塞体验优化只从 `refactor-backlog.md` 单独立项，不再混入架构重构。
