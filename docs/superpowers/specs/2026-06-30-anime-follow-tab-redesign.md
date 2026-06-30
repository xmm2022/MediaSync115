# 动漫追番 Tab 重设计

状态：已实现。看板重排、单卡命中预览、纯只读列表、远端删除和后端强制新建停用均已落地。
日期：2026-06-30。

## 背景

当前 `动漫追番` 页面把日常追番管理和新增 ANI-RSS 订阅流程放在同一首屏：左侧是 Bangumi 搜番，右侧是创建 ANI-RSS 订阅，已有外部订阅列表在页面底部。这对首次添加订阅是直接的，但对日常使用不够顺手。用户进入追番页时更常见的任务是确认哪些番在追新、哪些已暂停、最近是否命中、是否有错误，以及必要时手动同步外部 ANI-RSS 状态。

这页同时不是孤立 UI。它背后连接了 Bangumi、ANI-RSS、qBittorrent 安全配置、本地 `Subscription` 镜像和普通订阅中心的通道隔离。重设计必须先尊重这些联动关系，再调整信息架构。

## 现有链路

当前追番链路：

```text
Bangumi 条目 -> ANI-RSS API 精确获取多源 RSS -> ANI-RSS 预览 -> 创建停用订阅 -> 用户手动启用追新
```

前端核心行为：

- 页面加载先读取 `/api/anime/anirss/config`。
- ANI-RSS 已启用且 API Key 已配置时，页面默认调用 `/api/anime/anirss/subscriptions?sync_local=false&include_preview=false` 只读加载外部订阅。
- 搜索 Bangumi 后，选择条目会自动调用 `/api/anime/anirss/rss-candidates` 获取 Mikan、AniBT、AnimeGarden 候选。
- 创建前可调用 `/api/anime/anirss/preview` 做命中预览。
- 创建订阅调用 `/api/anime/anirss/subscriptions`。
- 删除订阅调用 `DELETE /api/anime/anirss/subscriptions/{external_id}`，后端固定 `deleteFiles=false`。
- 启停追新调用 `/api/anime/anirss/subscriptions/{external_id}/enabled`。

后端真实副作用：

- `GET /api/anime/anirss/subscriptions` 和 `POST /api/anime/anirss/subscriptions/sync` 都支持 `sync_local`：`false` 时只读外部 ANI-RSS，不写 DB；`true` 时同步本地 `Subscription` 镜像，并可能提交数据库变更。
- `GET /api/anime/anirss/health` 不传 DB，不同步本地镜像，但会访问外部 ANI-RSS。
- `POST /api/anime/anirss/preview` 不写 DB，不添加外部订阅。
- `POST /api/anime/anirss/subscriptions` 会创建外部 ANI-RSS 订阅，并创建或更新本地 `Subscription(provider="anirss", external_system="anirss")` 镜像；后端强制忽略 `enable=true`，新建永远停用。
- `DELETE /api/anime/anirss/subscriptions/{external_id}` 会调用外部 ANI-RSS `/api/deleteAni` 删除订阅，并清理本地 ANI-RSS 镜像；固定不删除已下载文件。
- `POST /api/anime/anirss/subscriptions/{external_id}/enabled` 会调用外部 ANI-RSS `setAni`，并同步本地 `is_active/external_status/auto_download`。
- `POST /api/anime/anirss/download-client/apply-defaults` 会写 `data/ani-rss/config/config.v2.json`，不是只读诊断。

普通订阅中心边界：

- `/api/subscriptions` 默认 `scope=media`，排除 `anirss`。
- `scope=anime` 才返回 ANI-RSS 本地镜像。
- 115 缺集、固定来源扫描和批量删除不应处理 ANI-RSS。
- 普通 `/api/subscriptions/{id}` 的单条删除只会删本地行，不会删除外部 ANI-RSS 订阅，因此 AnimeTab 不应使用它做删除。

## 目标

- 让 `动漫追番` 首屏成为日常追番看板，而不是新增订阅表单。
- 保留现有安全链路：创建默认停用、预览不启用、同步不启用、启停必须显式操作。
- 保留 Bangumi -> 多源 RSS 候选 -> 预览 -> 创建 的新增流程，但移动到“添加追番”次级入口。
- 在页面顶部清晰展示 ANI-RSS 配置、连接和下载器安全状态入口。
- 把会产生外部或本地副作用的操作用准确文案表达，避免把“同步外部状态”写成普通“刷新”。
- 已新增必要后端能力，避免前端用普通订阅删除或隐式同步写库来模拟追番管理。

## 非目标

- 不把 ANI-RSS 订阅重新混入普通 `订阅中心` 默认列表。
- 不把 MoviePilot、115 缺集补齐逻辑合并到 AnimeTab。
- 不自动启用新建追番订阅。
- 不在健康检查、预览、同步、诊断中添加 qBittorrent 下载任务。

## 信息架构

### 1. 顶部运行状态条

顶部保留 `动漫追番` 标题，但文案转向运行管理：

- ANI-RSS 配置状态：未启用、未配置地址、未配置 API Key、已配置。
- 外部连接状态：未检测、正常、异常。
- 下载器安全状态：未检测、正常、存在风险。
- 操作按钮：
  - `检测连接`：调用 `/api/anime/anirss/health`。
  - `检测下载器`：调用 `/api/anime/anirss/download-client/status`。
  - `同步安全配置`：调用 `/api/anime/anirss/download-client/apply-defaults`，必须保留明确风险文案，因为它会写 ANI-RSS 配置文件。
  - `添加追番`：打开新增流程。

如果实现跳转设置页，需要给 `AnimeTab` 增加 `onNavigateToSettings` prop；否则第一版只在本页提供检测与状态，不复制完整设置表单。

### 2. 默认追番看板

首屏展示已有 ANI-RSS 外部订阅状态。

建议分区：

- 概览指标：
  - 全部订阅
  - 追新中
  - 已暂停
  - 异常
  - 外部缺失
- 筛选：
  - 全部
  - 追新中
  - 已暂停
  - 异常
  - 外部缺失
- 排序：
  - 最近命中优先
  - 标题
  - 集数进度
  - 状态
- 订阅卡字段：
  - 标题、字幕组、状态
  - 当前集数 / 总集数
  - RSS 来源和 RSS 地址摘要
  - 保存位置
  - 自定义路径 / 默认路径
  - 最近命中
  - 最近错误
  - 预览命中数和去重忽略数，只在本次加载包含 preview 时展示
- 订阅卡操作：
  - `启用追新` / `暂停追新`
  - `同步外部状态`
  - `预览命中`
  - `删除`

默认进入页面时：

- 自动加载使用 `sync_local=false` 和 `includePreview=false`，只读展示外部状态，减少打开页面时的写库和逐条 `previewAni` 开销。
- 主按钮文案用 `同步外部状态`，调用 `sync_local=true`，明确会同步本地镜像。
- 单独提供 `同步并预览命中`，调用 `includePreview=true`，用于用户需要查看命中和去重结果时。

删除操作必须使用 Anime API 的远端删除接口，不使用普通 `/api/subscriptions/{id}`。

### 3. 添加追番流程

新增流程从首屏按钮进入，可以是右侧抽屉、弹窗或页面内二级面板。第一版建议使用页面内二级面板或抽屉，避免路由复杂化。

流程保持四步：

1. 搜索 Bangumi
2. 选择 Bangumi 条目
3. 获取并确认 ANI-RSS RSS 候选
4. 预览命中并创建订阅

必须保留：

- 选择 Bangumi 条目后自动获取 RSS 候选。
- 候选聚合 Mikan、AniBT、AnimeGarden。
- 只接受匹配当前 Bangumi ID 的候选。
- 自动套用首选候选，但允许用户切换来源或手填 RSS。
- `canSubmitAniRss` 的禁用条件和禁用原因。
- 保存位置为空时不发送 `download_path`。
- 创建默认 `enable=false`。

建议调整：

- 移除或弱化“创建后立即启用订阅”复选框。第一版建议不提供该入口，创建后统一停用，然后用户在看板卡片上显式点 `启用追新`。
- 如果保留该入口，必须默认关闭，并使用更强风险文案：启用可能使 ANI-RSS 向 qBittorrent 添加任务。
- 使用配置里的 `default_download_path` 和 `download_path_presets` 辅助保存位置输入，现有表单目前没有利用这两个字段。

### 4. 诊断面板

诊断面板是辅助能力，不应压过追番看板。

显示内容：

- ANI-RSS base URL
- API Key 是否已配置
- qBittorrent 连接状态
- qBittorrent 任务数
- `downloadNew`
- `autoStart`
- `qbUseDownloadPath`
- 当前下载路径模板
- unsafe flags
- issues

操作边界：

- `检测连接` 只调用 health，不同步本地镜像。
- `检测下载器` 只读配置并探测 qBittorrent。
- `同步安全配置` 会写 ANI-RSS 配置文件，需要明确提示“写入安全默认配置，可能需要重启 ANI-RSS”。
- 不在诊断面板里创建或启用订阅。

## 状态与交互规则

- 页面级 busy 状态需要拆分，避免一个操作阻塞整页：
  - `config`
  - `read`
  - `sync`
  - `sync-preview`
  - `health`
  - `download-client-check`
  - `download-client-apply`
  - `search`
  - `rss-candidates`
  - `preview`
  - `create`
  - `toggle-{external_id}`
  - `delete-{external_id}`
- 错误展示应按区域就近展示，同时保留页面顶部摘要。
- 搜索、RSS 候选、创建表单应继续使用受控组件。
- 修改 RSS 地址、RSS 来源、保存位置、字幕组后应清空旧预览，避免用户把旧预览误认为当前表单结果。
- 创建成功后关闭新增面板或展示成功状态，并同步外部状态。
- 启停成功后同步对应订阅状态。

## API 使用约定

| 用户操作 | API | 副作用说明 |
| --- | --- | --- |
| 读取配置 | `GET /api/anime/anirss/config` | 只读运行时配置 |
| 检测连接 | `GET /api/anime/anirss/health` | 访问外部 ANI-RSS，不写 DB |
| 默认读取外部状态 | `GET /api/anime/anirss/subscriptions?sync_local=false&include_preview=false` | 只读外部 ANI-RSS，不写 DB |
| 同步外部状态 | `POST /api/anime/anirss/subscriptions/sync?sync_local=true&include_preview=false` | 同步本地镜像，可能写 DB |
| 同步并预览命中 | 同上，`include_preview=true` | 同步本地镜像，并逐条调用外部 `previewAni` |
| 搜索 Bangumi | `GET /api/anime/bangumi/search` | 只读外部搜索 |
| 获取 RSS 候选 | `GET /api/anime/anirss/rss-candidates` | 只读候选发现，不写 DB |
| 预览创建结果 | `POST /api/anime/anirss/preview` | 调外部 `rssToAni` 和 `previewAni`，不写 DB，不创建订阅 |
| 创建追番 | `POST /api/anime/anirss/subscriptions` | 创建外部 ANI-RSS 订阅并写本地镜像；后端强制新建停用 |
| 预览已有追番 | `POST /api/anime/anirss/subscriptions/{external_id}/preview` | 调外部 `previewAni`，不写 DB，不启用订阅 |
| 启停追新 | `POST /api/anime/anirss/subscriptions/{external_id}/enabled` | 修改外部 ANI-RSS 订阅，更新本地镜像 |
| 删除追番 | `DELETE /api/anime/anirss/subscriptions/{external_id}` | 删除外部 ANI-RSS 订阅并清本地镜像；固定不删文件 |
| 检测下载器 | `GET /api/anime/anirss/download-client/status` | 读取配置并探测 qBittorrent |
| 同步安全配置 | `POST /api/anime/anirss/download-client/apply-defaults` | 写 ANI-RSS 配置文件并返回状态 |

## 实现范围

已实现范围：

- 调整 `AnimeTab` 信息架构。
- 把外部订阅看板移动到首屏。
- 把新增追番流程移入次级入口。
- 增加下载器诊断状态卡。
- 调整按钮文案，区分同步、预览、启停、写配置。
- 单卡已有追番命中预览。
- `sync_local=false` 纯只读 ANI-RSS 列表参数。
- 远端删除 ANI-RSS 订阅接口。
- 后端强制忽略 `enable=true`，新建追番永远停用。
- 测试覆盖强制停用、单卡预览、远端删除参数和前端 API 合约。

## 视觉与可用性约束

- 这是运维型 dashboard，不做营销式 hero，也不把添加流程放在首屏中心。
- 订阅看板应信息密度适中，卡片高度稳定，按钮 hover 不应造成布局跳动。
- 所有操作按钮继续使用 Lucide 图标。
- 状态不能只靠颜色表达，需要文字标签。
- 移动端优先保证看板可扫读：状态、标题、启停操作优先，RSS 地址和路径可折叠或截断。
- 表单输入必须有可见 label，不只依赖 placeholder。
- 操作超过 300ms 时显示 loading。

## 验证

实现后至少验证：

- 前端 `npm run build` 通过。
- 页面进入后可以看到已有 ANI-RSS 订阅看板。
- 未配置 ANI-RSS 时，添加追番和同步按钮显示清晰禁用原因。
- 搜索 Bangumi、选择条目后仍自动获取 RSS 候选。
- RSS 候选仍只匹配当前 Bangumi ID。
- 预览不会创建或启用订阅。
- 创建订阅默认停用。
- 即使请求传 `enable=true`，后端创建仍保持停用。
- 页面默认读取追番列表不写本地镜像；手动同步才写本地镜像。
- 删除追番只删除 ANI-RSS 订阅和本地镜像，不删除已下载文件。
- 创建时保存位置为空不发送 `download_path`。
- 启用追新只通过 `/anime/anirss/subscriptions/{external_id}/enabled`。
- 同步外部状态不会把 ANI-RSS 订阅混回普通订阅中心默认列表。
- 检测下载器不会写配置；同步安全配置会明确提示写配置和可能需要重启。
- qBittorrent 任务数在未显式启用追新前保持 0。
