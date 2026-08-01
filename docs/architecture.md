# 当前架构与兼容性基线

状态：v3.3.0 已实现架构基线。

## 总体原则

1. 站点适配器只提供站点能力，不复制 Reader、卷轴、重试、缓存、预取或 UI 逻辑。
2. Reader、卷轴、预取和缩略图通过统一图片生命周期共享任务、结果与资源所有权。
3. `GalleryItem.key` 是逻辑图片的稳定身份；DOM、URL 和表现 slide index 都不能替代它。
4. PhotoSwipe 只能通过 `ReaderDriver` 集成，Reader 其他模块不访问其包或内部字段。
5. 网络、Blob、Canvas、Object URL、DOM、Observer、监听器和 Timer 必须有明确释放方。
6. 优化不得引入重复下载、重复解码、无限重试、持续滚动纠偏或站点名称分支。

## 目录职责

```text
src/
  main.ts                 应用入口和初始化
  app/                    依赖组装
  core/                   Gallery、图片和站点契约
  services/               图片生命周期、调度、限流、缩略图
  reader/                 Reader 控制器、Session、Driver 和 Shell
  scroll/                 卷轴加载、分页观察和关闭返回定位
  sites/                  站点适配器与新站点模板
  state/                  应用设置和 Store
  ui/                     悬浮控制与设置面板
  utils/                  i18n、图标和视口工具
tests/                    单元、集成和架构边界测试
docs/                     开发者与 Agent 文档
```

应用组装只存在于 `main.ts` 和 `app/`。`core/` 不反向依赖服务、Reader、UI、Store 或具体
站点；Reader 不直接导入卷轴实现、具体站点或 UI Store。

## Gallery 与站点契约

- `GalleryPageLoader` 负责页面请求去重、重试、空页终止、已加载 URL 和分页循环保护。
- `GalleryItem` 必须提供稳定唯一的 `key`、`viewerUrl` 和标准 `preview`。
- `GalleryPage.position` 可提供初始全局索引和每页数量；适配器不得直接写 Store。
- `dimensions` 只有在站点确实提前知道原图尺寸时才能提供，不能为了几何额外请求图片。
- `ResolvedImage.sourceDimensions` 是适配器在解析显示源后提供的可靠可选尺寸元数据；它只可
  用于提前几何判定，不能冒充已解码结果或跳过图片字节加载。
- `SiteAdapter` 负责匹配、页面解析、图片解析/转换、容器和必要的站点生命周期回调。
- 站点确实需要 Reader 关闭时同步 URL，才实现 `onReaderClose()`。
- Reader 预取范围可以由通用 `readerPrefetch` 能力覆盖；默认值与阶段策略由共享层管理。

三类图片来源：

```text
直接 URL        resolveImage() -> { src }
viewer 页面     resolveImage() -> 原图 URL + 可选重试 token
下载后转换      resolveImage() -> materializeData
                materializeImage() -> 可显示资源
```

## 统一图片生命周期

```text
viewer URL
  -> resolve
  -> optional materialize
  -> byte load / dimensions
  -> shared cache
  -> leases: foreground / neighbor / scroll / thumbnail / warmup
  -> eviction and optional Object URL revoke
```

- `ImageLoadService` 是进行中任务、重试、缓存、phase 和租约的唯一所有者。
- 同一 viewer URL 的多个消费者共享一个生命周期；更高优先级需求提升原任务。
- 只有前台、Reader 邻页和卷轴等实时需求可以使用完整来源恢复链；纯投机任务失败后不应
  扩大节点切换和重试成本。
- 默认图片缓存有界并保护活跃租约；淘汰受管 Object URL 时由服务 revoke。
- `materializeImage()` 必须传递 `AbortSignal`、释放 Bitmap/Canvas 临时资源，并用
  `ownsObjectUrl: true` 转移 Object URL 所有权；已经完成解码的转换器可以返回可靠
  `decodedDimensions`，避免共享加载层立刻对新 Blob 做第二次预解码。
- 站点限流与共享生命周期职责不同：E-Hentai 的 viewer/page 请求仍由站点 limiter 保护，
  高内存 materialize 阶段串行执行；直接 URL 和 viewer 下载仍使用公共 4/2 调度，不受其影响。

## Reader 边界

- `ReaderSession` 持有当前逻辑索引和 live DOM 注册，不持有 PhotoSwipe 或站点状态。
- Reader Controller 组织图片、预取、分页、缩略图、滚轮和自动播放控制器。
- Spread Layout 以固定 0+1、2+3 配对槽位把逻辑页映射为表现页；宽屏且尚无横图/失败反证
  时，未知尺寸使用待确认双页并预留两个稳定槽位。横图、失败页或宽度不足时拆为单页，
  重算时以稳定 key 保持主逻辑页。
- Reader Shell 只依赖 Reader 契约和 Driver，不直接读取全局 Store。
- PhotoSwipe 包导入、`currSlide` 等内部访问和手势挂载只允许在 Driver。
- 单页与双页共用稳定的 Spread DOM 容器；双页成员各占一个不随来源到达而塌缩的等分槽，
  左右页分别朝书脊对齐。尺寸或来源迟到时 Driver 原位更新图片节点并同步三个表现 holder，
  不销毁 PhotoSwipe 根实例。结构重映射至少等待连续两个空闲帧，不强停 PhotoSwipe 动画、
  手势或垂直关闭回弹。
- 每个 PhotoSwipe item holder 在任何时刻只能保留一个活动 `pswp__zoom-wrap`。强制内容重映射
  若先丢失旧 Slide 引用，Driver 必须在新内容挂载完成时销毁仍连接的旧 Slide，并清除无法
  追踪的孤儿 wrapper；缓存失效不得只销毁 Content 而遗留 Slide 容器。
- 桌面滚轮、键盘、点击区、移动滑动、双指缩放、垂直关闭和 UI 区域事件屏蔽是兼容红线。
- 双页成员的加载状态不得阻塞滚轮、键盘、点击或滑动导航；未就绪成员由稳定槽内加载动画和
  聚合 HUD 反馈。单页加载边界仍采用落页后结束本次滚轮手势的旧语义。
- 自定义 Spread 的 mouse 点击分类只允许由 PhotoSwipe Driver 补偿；隐藏 UI 的 Spread、
  pending 槽和中缝按背景点击处理，可见图片按图片点击处理。touch/pen 保持 PhotoSwipe 原生
  tap 路径，Reader 通用层不得识别 PhotoSwipe DOM 类名。
- 当前 Spread 的 HUD 必须聚合所有逻辑成员，Gallery 分页空闲不得覆盖图片下载状态。结构
  重映射与 prepend 的状态锁必须在 `finally` 中释放，Reader 关闭不得被该临时状态锁忽略。
- 图片来源填充和结构重映射均不得在 Driver 手势、主滚动或动画期间刷新 Slide；交互结束后
  至少等待连续两个空闲帧再原位更新。新的来源完成事件必须重新开始空闲帧计数，不得在统一
  调度前直接调用 Driver 刷新。过渡期间保持 HUD；当前 Spread 未完整挂载时，桌面和触摸设备
  都保持 UI 可见，pending 槽不得是无反馈的纯黑区域。
- Driver 刷新前一页、当前页和下一页时，必须根据稳定 `currIndex` 映射到 holder 位置 0/1/2；
  不得依赖可能已过期的 `currSlide` 反推 holder，也不得使用会先移除缓存再重新推断 holder 的
  PhotoSwipe 公共索引刷新。屏外页只失效缓存；可见目标缺少 Slide 或 Spread DOM 时只重建精确
  holder，重建当前页后同步 `currSlide` 与 active 状态。
- Reader 的“当前内容已加载”不仅要求图片生命周期完成，还要求索引一致的当前 Slide 容器仍
  挂在当前 holder，且所有 Spread 成员均已有图片节点。资源完成但 DOM 缺失时必须继续显示 HUD
  和控件，并在正常 `change` 结束后的空闲帧防御性修复当前 holder。
- Gallery 追加或前插改变表现页总数时，必须在 Session 索引调整完成后进入同一空闲帧重映射
  路径；不得先直接替换活动 `SpreadLayout` 再只刷新相邻 Slide。PhotoSwipe 可能已经为旧末页
  之后缓存越界 Content，只有完整 `syncLayout()` 才能清除该缓存并同步三个 holder 与新总数。
- Reader 关闭未导航时恢复进入前 scrollY；已导航时按稳定 key 找到卷轴元素并执行一次直接
  定位。关闭后不得用 Observer/Timer 再次抢夺用户滚动位置。
- 双页只存在于 Reader 表现层；Driver 以两个独立图片元素挂入同一缩放容器，缓存、租约和
  下载生命周期仍按逻辑图片独立复用。

## 卷轴与缩略图

- 卷轴按视口附近的 placeholder 启动共享图片任务；快速滚动时，约 6 个视口外仍未完成的
  卷轴租约会从有界 pending 集合释放。Reader 打开时取消全部未完成卷轴租约并暂停观察，
  关闭后只恢复当前视口附近的 placeholder，避免旧位置任务与 Reader 前台图片竞争。
- 图片生命周期默认总并发 4、后台最多 2；公共 Reader 预取窗口为前方 5、后方 2，适配器
  可以按真实站点证据覆盖范围，但当前站点均使用公共默认值。
- 已知可靠原图尺寸、适配器解析后的标准源尺寸提示、URL preview size 或 Sprite crop 可以
  稳定 placeholder 和双页预判；未知尺寸使用公共待确认/单页降级，不额外下载图片。
- 4KHD 正文静态 `width/height` 已证实可能与原图比例不同，不得作为可靠 `dimensions`。
- Reader 关闭定位只使用共享缓存中已经存在的自然尺寸，不为定位创建新图片任务。
- URL/Sprite 缩略图直接使用 Preview Descriptor。
- 没有廉价预览时，只有用户主动滚动缩略图面板并稳定 300 ms 才加载实际可视项；中心优先、
  并发 2、释放全图租约后保留约 300 px 的有界缩略图缓存。

## 站点事实

### 4KHD

- 直接使用标准完整图片 URL，不需要 viewer 解析或 materialize。
- 保留 URL 变换、avatar 过滤、数值分页和镜像域名兼容；修改前必须有真实页面与 fixture。
- 静态展示尺寸不可靠，使用公共未知尺寸降级。

### E-Hentai / ExHentai

- Gallery Item 指向 viewer 页面；解析后才得到 hath 图片 URL。
- 已验证的 hath 原图 URL 路径包含源宽高；解析语法、域名约束和异常值校验只存在于
  E-Hentai 适配器，并通过标准 `sourceDimensions` 发布。共享加载层和 Reader 不识别该 URL。
- viewer 和 Gallery 页面请求共享站点 limiter；429/503 在释放槽位前触发 cooldown。
- `nl` token 驱动串行节点切换；不得并行竞速或重复已经失败的来源。
- 普通缩略图和 Sprite crop 均通过标准 Preview Descriptor。

### 18comic

- `aid/scramble_id` 属于不透明站点元数据；反乱序实现位于 materializer。
- 下载、`createImageBitmap`、Canvas 重排和 Blob 导出必须可取消；转换并发为 1，导出后立即
  关闭 Bitmap、缩小 OffscreenCanvas backing store，并把已知尺寸交给共享加载层复用。
- 解码结果是受统一生命周期管理的 Object URL；正在显示的卷轴图片持有租约。
- 所有权型资源按 24 个 Object URL 和 96 MiB Blob 软上限治理；仅这类卷轴图片由
  IntersectionObserver 在约 6 个视口外恢复占位并释放租约，普通远程图片不虚拟化。
- 普通站点没有廉价预览时的缩略图策略适用于该站点，不增加名称分支。

## 已确认的设计取舍

- 不使用持久 ResizeObserver/Timer 修正 Reader 关闭位置；真实测试证明会引起抖动并覆盖用户
  后续滚动。
- 不根据不可靠 4KHD 静态尺寸建立全局几何注册表。
- v3.2.0 的 208 张 18comic 样本没有出现随 22 -> 104 -> 208 张持续线性增长的标签页
  内存；因此当时没有实施普通图片 DOM 窗口化。v3.3.0 只重新评审所有权型资源，并保留
  “活跃资源不可 revoke”和“普通远程图不虚拟化”红线。
- 不为没有廉价预览的站点在 Reader 打开时批量下载全图缩略图。

## 验证要求

每轮实现至少执行：

```text
npm run typecheck
npm test
npm run build
git diff --check
```

架构测试持续禁止 Reader 反向依赖、站点写 Store、core 跨层依赖、旧路径复活和 PhotoSwipe
内部访问扩散。涉及真实网络、浏览器布局、内存或手势的改动还必须完成 Chrome DevTools 与
真实站点验证；桌面设备模拟不能替代移动端手势人工验收。
