# 历史版本与已关闭决策摘要

本文件只用于追溯设计原因。当前实现边界见 `architecture.md`，当前目标见活动版本计划。

## v3.2.0：标准化重构

结果：已完成并在 4KHD、E-Hentai/ExHentai 和 18comic 验收。

- 建立标准 `GalleryItem/GalleryPage/SiteAdapter` 和 `GalleryPageLoader`。
- 将 resolve、materialize、字节验证、重试、缓存、租约与 Object URL 所有权合并到
  `ImageLoadService`。
- Reader 拆分为 Session、Controller、Driver 和 Shell；PhotoSwipe 访问收口到 Driver。
- 卷轴、Reader、预取和缩略图复用同一图片任务。
- 18comic 反乱序迁入可取消 materializer；Bitmap、Canvas、Blob 和 Object URL 释放有测试。
- 新站点模板与契约测试建立，适配器不再复制 Reader 和通用加载逻辑。

### 已关闭：无廉价预览站点的派生缩略图

- Reader 打开或面板自动定位不触发全图下载。
- 用户主动滚动面板并稳定 300 ms 后，只处理实际可视项，中心优先、并发 2。
- 复用共享全图任务，生成约 300 px 缩略图后释放全图租约。
- 18comic、E-Hentai 和 4KHD 真实测试通过。

### 已关闭：Reader 关闭后的卷轴位置漂移

曾尝试 DOM 引用、图片完成后二次校正和 12 秒 ResizeObserver 稳定器。真实 4KHD 移动测试
出现抖动，且稳定器会在用户点击置顶后把页面拉回旧位置，因此全部撤销。

最终策略：

- 未导航时一次恢复进入前 scrollY。
- 已导航时用稳定 item key 解析当前卷轴元素，只执行一次即时定位。
- 只投影共享缓存中已有的有限邻域尺寸；不请求图片、不等待、不做关闭后二次纠偏。
- E-Hentai、18comic 和 4KHD 回归通过；未知尺寸后续自然布局变化被明确接受。

### 已关闭：普通图片 DOM 全量窗口化

208 张 18comic 真实样本中，标签页内存从初始约 270 MiB 到 22、104、208 张阶段没有持续
线性增长，浏览器能回收离屏解码/渲染资源。当时否决为普通图片引入高度骨架、DOM 恢复和
重复下载风险。只有出现可复现崩溃、持续线性增长或浏览器无法回收时才重新评审。

## v3.2.1：加载恢复与预取优化

结果：已完成，三个站点回归通过。

- Resolver 上下文加入 priority、force、AbortSignal 和通用 retry token。
- E-Hentai 队列支持提升和取消；图片尝试按前台/后台使用有界 deadline 与串行节点恢复。
- Reader 预取窗口曾扩到 10/4；大幅跳转释放旧窗口，卷轴/分页失败改为有界自动恢复。
- 固定/可配置卷轴行为通过通用 `scrollPolicy` 声明，不在入口或 UI 中判断站点名称。

## v3.2.2：网络稳定性

结果：已完成。类型检查、57 项测试、生产构建和 E-Hentai 真实链路通过。

- 许可证统一为 GPL-3.0-only。
- 公共 Reader 预取调整为 6/3，E-Hentai 使用 5/2 适配器覆盖。
- E-Hentai 429/503 在 limiter 任务结束前启动 cooldown，避免释放槽位后的竞态。
- 来源切换增加通用 `switching-source` phase；同一生命周期不重访已失败来源。
- 纯 warm-up/thumbnail 失败不会启动昂贵节点切换；实时需求加入后可提升共享任务并恢复。
- 生产脚本为 316.89 kB，gzip 76.43 kB。

## v3.3.0：动态双页与统一调度

结果：正式候选的 103/103 项测试、生产构建与最终实机验收通过；脚本为 365,996 字节，
gzip 77,912 字节。E-Hentai、18comic、4KHD、Chrome、Firefox + Violentmonkey、EhSyringe 共存
与移动端交互均通过；版本等待维护者手动发布。

- 新增默认开启的动态双页，固定配对且按可靠尺寸、方向和视口安全拆分；计数、缩略图、
  导航、自动播放和关闭返回继续使用逻辑页身份。
- 公共预取统一为 5/2，保留未被现有站点使用的适配器覆盖能力；图片生命周期使用总 4、
  后台 2 的前台优先调度，并按页面可见性、Save-Data 和 2g 条件降级。
- 卷轴首屏提升优先级；无限分页使用 1/2/4 秒有界退避、错误哨兵和手动重试。
- 18comic 受管资源使用 24 个 Object URL / 96 MiB Blob 双预算，并只对所有权型离屏图片
  恢复占位、释放租约。
- 设置与控制改为语义化按钮，补齐 inert、aria、焦点恢复和自动播放下限；删除从未形成
  用户功能的 `showControl` 遗留状态与恢复菜单。
- Reader UI 统一使用输入能力快照；fine-hover 指针采用桌面交互，纯 coarse 指针采用触摸端
  自动隐藏，避免异常 `maxTouchPoints` 让桌面缩略图误触移动端计时器。
- PNG 图标替换为纯 SVG；当前 SVG 源文件为 1,990 字节，userscript 图标 data URL 为
  2,500 字符，较旧 PNG 元数据减少约 14 KiB。
