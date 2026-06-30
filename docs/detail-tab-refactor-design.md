# MediaDetailTab 资源详情页 + 订阅弹窗 重构设计

> 状态：**设计定稿，待实施**。本文档汇总与用户确认后的最终方案，作为动工前唯一参考。
> 动工顺序：先后端两个新端点（TMDB 推荐端点、MP 立即下载端点），再前端重组。
> 创建时间：2026-06-30。

## 1. 背景

当前详情页（`MediaDetailTab.tsx`）的"资源通道"是页内嵌入式区块，把"浏览资源 / 转存 / 订阅"三件事堆在一起，存在多处逻辑与交互问题：

- 订阅入口（头部按钮）只弹一个 280px 下拉，太挤，承载不下渠道说明、当前订阅状态、PT 改写 provider 预警。
- 115 订阅只走 toggle，没办法精确订阅某季某集（toggle 不支持 `tv_*` 字段）。
- 后端有 `POST /subscriptions/{id}/sources` 能力（把某条 115 分享链接绑成订阅固定来源），但前端从没用上——"选订阅源"实际是空的。
- 用户要在"资源通道"切来切去再回头选订阅，交互割裂。
- 详情页缺少"相似影片推荐"内容填充。

重构目标：资源（链接/种子）就是订阅的真实输入，**应当进入订阅弹窗内陈列和勾选**；原资源通道区块从详情页删除并替换为"相似影片推荐"。

## 2. 后端调研结论（已实测）

### 2.1 115 来源（4 类，全部返回 115 分享链接）

| 子分类 | 后端端点 | 备注 |
|---|---|---|
| Pansou | `GET /api/search/{movie\|tv}/{tmdb_id}/115/pansou` | Pansou 聚合 115 网盘 |
| HDHive | `GET /api/search/{movie\|tv}/{tmdb_id}/115/hdhive` | 返回 `slug` 字段，未解锁需先调 `searchApi.unlockHdhiveResource(slug)` 解锁后才能转存/绑定 |
| TG | `GET /api/search/{movie\|tv}/{tmdb_id}/115/tg` | TG 频道聚合 |
| 固定链接 | 无专门端点 | 用户手粘一条 115 分享 URL，订阅创建后 `POST /api/subscriptions/{id}/sources` 绑定（`SubscriptionSourceCreate{share_url, receive_code, display_name}`） |

聚合端点 `GET /api/search/{type}/{tmdb_id}/115`（一次取三源）也存在，但弹窗内按子分类分组陈列更清晰，所以**前端按勾选的子来源调对应单端点**，不用聚合端点。

返回项通用字段：`share_link / size / resolution / source_service / slug(仅 HDHive) / receive_code / unlocked`。

### 2.2 磁力来源（不进 115 渠道子选项，独立陈列）

| 子分类 | 后端端点 | 返回 |
|---|---|---|
| SeedHub | `GET /api/search/{type}/{tmdb_id}/magnet`（异步任务，需轮询 `GET /magnet/seedhub/tasks/{task_id}`，可 `DELETE` 取消） | 磁力链接 |
| 不淘 | `GET /api/search/{type}/{tmdb_id}/magnet/butailing` | 磁力链接 |

磁力与 115 渠道概念不同：磁力只能走离线下载（到 115/夸克），不能直接做 115 订阅固定来源。设计中磁力作为另一类工作台。**是否进本次订阅弹窗待用户最终决定——本设计当前版本未把磁力进弹窗，只放 115/PT 两渠道**；若后续要把磁力也放进来作"离线到 115"输入，再迭代。

### 2.3 PT/MoviePilot 当前能力

- `POST /api/moviepilot/search` → 调 MP `/api/v1/search/title`，返回种子列表。字段由 MP 站点插件决定，可能含 `hash / name / title / size / seeders / pubdate / source / torrent_url / page_url / description / free / hr` 等。前端按"有就显示"渲染。
- `POST /api/moviepilot/subscriptions` → 创建 TMDB 级订阅，由 MP 调度下载。
- **后端目前没有"立即下载某颗种子"的封装**（`moviepilot_client.py` 只 6 个方法）。本次新增。

### 2.4 PT 立即下载（本次新增，待动工前先验证 MP 端点签名）

后端要新增**MoviePilot 立即下载接口**链路：
1. `moviepilot_client.py` 加方法 `add_download(meta)`，调 MP 的下载端点。
2. `moviepilot_provider_service.py` 加 service 方法 `push_download(...)`，封装 client + 日志 + 错误透传。
3. `backend/app/api/moviepilot.py` 加路由 `POST /api/moviepilot/downloads`，请求体字段（待 MP 实测后定）至少含种子的识别信息（`torrent_url` 或 `meta_url` 或其它 MP 要的字段）+ `save_path`（可选）。

**实施前必须先验证 MP `/api/v1/download/` 或同等端点的请求/响应签名**——本仓库代码无任何此类调用，MoviesPilot 官方 API 文档需要单独查证。如果在实施时验证失败（MP 不支持外部推送下载），退路是 PT 渠道在弹窗内仍只展示种子 + 创建 TMDB 订阅（沿用现状），并把"立即可下载"能力的实现推迟到下次迭代，并在弹窗内明确文案告知用户。

### 2.5 TMDB 推荐端点（本次新增）

后端新增端点 `GET /api/search/{media_type}/{tmdb_id}/recommendations`：
- media_type ∈ `{movie, tv}`
- 调 TMDB 官方 `/movie/{id}/recommendations` 或 `/tv/{id}/recommendations`
- 返回结构对齐既有 `ExploreItem` 形态：`{items: [...], page, total_pages}`，每项含 `id / title|name / poster_path / vote_average / release_date|first_air_date / overview`
- 实现位置：`backend/app/api/search.py` 新增路由 + 复用既有 TMDB client（若 `tmdb_service` 已有则直接用，否则在 `search.py` 现有的 TMDB 调用路径上加一个函数）

## 3. 前端 UI 设计

### 3.1 详情页布局重构

```
[Hero 头部] — 保留：海报 / 标题 / 评分 / 演员 / 简介 / 入库状态徽章
[订阅入口按钮] — "添加订阅 / 管理订阅"（打开 SubscriptionDialog 弹窗）
[~原资源通道块删除~]
[新增: 相似影片推荐网格] — 调后端新端点 /api/search/{type}/{tmdb_id}/recommendations
  - 卡片样式与 ExploreTab grid 一致
  - 点击跳转该 TMDB 的详情页（returnTo=当前页）
  - 失败/空显示静默占位，不影响主区
[底部 hint 区] — 保留 115/夸克默认转存目录提示
```

移除详情页内以下逻辑（这些能力搬到 SubscriptionDialog 内）：
- `handleTransfer` / `handleQuarkTransfer` 转存
- `handleUnlock` HDHive 解锁
- `activeSource` / `resources` / `resourcesLoading` / `seedhubTask` 等资源通道 state
- `RESOURCE_SOURCES` / `fetchResourceLinks` / `handleSwitchSource` / `cancelSeedhubTask`
- `visibleResourceSources` runtime tabs
- `progress` / `Pan115Progress` 弹窗（如弹窗内需要进度反馈就由 SubscriptionDialog 自带）

### 3.2 SubscriptionDialog 弹窗（两步流程，720px 宽）

```
┌──────────────────────────────────────────────────────────┐
│ 添加订阅 / {title}                              ×         │
│ {海报} {年份/类型/评分}                                    │
├──────────────────────────────────────────────────────────┤
│ 已订阅状态区（顶部条）                                     │
│ [绿框] 当前已订阅 115 · 已订阅 PT    [取消 115][取消 PT]   │
├──────────────────────────────────────────────────────────┤
│ Step 1: 渠道单选卡片                                       │
│ ┌── 115 ──┐ ┌── PT ──┐ ┌ 夸克 ┐                            │
│ │徽章/说明│ │徽章/说明│ │禁用 │                            │
│ └─────────┘ └────────┘ └─────┘                            │
├──────────────────────────────────────────────────────────┤
│ Step 2: 所选渠道展开（资源陈列 + 订阅参数 + 转存入口）     │
│                                                          │
│ ▼ 115 渠道                                                │
│   A. 子来源勾选（多选）：                                  │
│      ☑ Pansou   ☑ HDHive   ☐ TG   ☐ 固定链接             │
│   B. 资源陈列（并行调勾选的子来源端点，按子来源分组）：      │
│      [Pansou 组]                                          │
│      ○ 名称 · size · res · 分享链接 [立即转存到 115]       │
│      ● 名称 · size · res · 分享链接 [立即转存到 115]  ★选中 │
│      [HDHive 组]                                          │
│      ○ 名称 · size · res · slug 待解锁 [解锁] [转存]       │
│      ● 名称 · size · res · 已解锁  [转存]           ★选中 │
│      [TG 组]                                              │
│      ○ 名称 · size · res · 分享链接 [立即转存到 115]       │
│   C. 固定链接手动粘贴区（勾选「固定链接」子项时展开）：      │
│      [share_url 输入框]                                   │
│      [receive_code 输入框]                                 │
│   D. 选中规则：                                            │
│      - 单选一条 → 作为「固定来源」绑定                     │
│        (POST /subscriptions + POST /subscriptions/{id}/sources) │
│      - 不选 → 走标准自动搜索订阅（后端聚合三源扫描）         │
│   E. TV 订阅范围（仅 media_type=tv 显示）：                │
│      全季 / 指定季 / 集段 + 季号 + 集                       │
│   F. 夸克转存（同步能力）：每条夸克分享在弹窗内也会陈列？—no │
│      115 渠道只陈列 115 来源；夸克渠道单列(禁用)           │
│                                                          │
│ ▼ PT 渠道                                                 │
│   A. 种子陈列（调 POST /api/moviepilot/search）：           │
│      ○ name · size · pubdate · 分辨率 · source 站点 ·      │
│        免费?HR?（按后端返回字段渲染，缺则隐藏）              │
│      ● name · size · ...  ★选中                          │
│        [种子详情页链接 →]                                  │
│   B. 选中规则：                                            │
│      - 单选一条种子 → 提交按钮文案变「推送下载」             │
│      - 不选 → 提交按钮文案变「创建 TMDB 订阅」              │
│        (后端走 POST /api/moviepilot/subscriptions)         │
│   C. 提交行为：                                            │
│      -「推送下载」→ 调后端新端点 POST /api/moviepilot/downloads │
│        (请求体含种子标识 + save_path 可选)                 │
│      -「创建 TMDB 订阅」→ 不变                             │
├──────────────────────────────────────────────────────────┤
│ 底部: [关闭] [创建/推送]                                   │
└──────────────────────────────────────────────────────────┘
```

注意：原来的"PT 改写 provider 预警"文本**删除**——因为 PT 渠道改成"推种子下载"而非"建 MP 订阅"，不再触发 `_find_existing_subscription` 改写归属。"创建 TMDB 订阅"分支在没有选中种子时才出现，仍可能涉及改写归属问题，但分支按钮文案和上下文都不再是主路径；如果仍要保留预警，文案只在"未选种子 + 已有 115 订阅"时显示，这是次要分支，实施时按情况定。

### 3.3 关键交互规则

**115 子来源勾选 → 后端调用映射：**
- 勾选某子来源 → 前端并行调对应单端点拉资源，按子来源分组陈列。
- 改变勾选 → 已拉过的缓存复用（弹窗内 component state），新勾的才发请求，避免重复请求。
- 资源列表项可单选「作为固定来源」（单选语义，不止一条不能绑定多个来源）。

**HDHive 解锁流程：**
- HDHive 组的资源若有 `slug` 且 `unlocked=false`：「解锁」按钮可点，调 `searchApi.unlockHdhiveResource(slug)`；解锁成功后该卡片刷新成"已解锁"，单选按钮+转存按钮可用。

**115 转存按钮（同步保留）：**
- 每个 115 资源卡片旁既有「选作来源」单选按钮，也有「立即转存到 115」按钮——用户可以只转存不订阅，或选作来源一起订阅。弹窗即资源工作台。
- 转存调用现有 `pan115Api.saveShareToFolder(share_url, folder_name, "0", receive_code, null)`，目标目录是 runtime 默认目录（后端会覆盖 `parent_id`）。在弹窗底部 hint 区显示当前 115/夸克默认转存目录名（沿用之前已实现的 `pan115DefaultFolderName`/`quarkDefaultFolderName` 状态）。

**夸克转存位置：**
- 夸克渠道在 Step 1 卡片里是**禁用占位**（"夸克订阅暂未接入"）。夸克分享转存这条能力不进订阅弹窗（弹窗聚焦订阅），如果用户要转存夸克分享，仍走**现有 Pan115FilesTab 的"分享链接转存"**（既有功能不删）。这点在弹窗里给一个提示链接：「想转存夸克分享？去 115 网盘页」。

**PT 种子选定 + 立即下载：**
- 单选一条种子 → 提交按钮文案变「推送下载」，点击调后端新端点 `POST /api/moviepilot/downloads`。
- 不选种子 → 提交按钮文案变「创建 TMDB 订阅」，点击调现有 `POST /api/moviepilot/subscriptions`。
- 后端端点签名未实测，实施时先验证 MP 下载端点，验证不通过则 fallback：弹窗里 PT 渠道只能选「创建 TMDB 订阅」+ 看种子（不可推送下载），并把"立即可下载"能力推迟到下次迭代。

**TV 订阅范围：** 仅 115 渠道 + media_type=tv 显示。PT 渠道不显示（MP 自己按 TMDB 调度全季）。

**已订阅状态 + 取消：** 顶部条展示当前 `isPan115Subscribed` / `isPtSubscribed`，提供取消按钮，调 `DELETE /api/subscriptions/{id}`。PT 取消走本系统订阅 id（如果之前是通过 MP 创建并写入了本地 `provider=moviepilot` 订阅的）。

### 3.4 SubscriptionDialog Props 调整

```
interface SubscriptionDialogProps {
  open: boolean;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  defaultPoster?: string;
  detail: TmdbDetail | null;
  seasons: TmdbSeason[];
  pan115SubId: string | null;
  ptSubId: string | null;
  pan115DefaultFolderName: string;   // 新增
  quarkDefaultFolderName: string;    // 新增
  addLog: AddLogFn;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}
```

`resources` prop **删除**——弹窗内资源由子来源勾选拉取，不再依赖外部传入。

## 4. 文件改动清单

### 后端

| 文件 | 改动 | 必要性 | 风险 |
|---|---|---|---|
| `backend/app/api/search.py` | 新增路由 `GET /{media_type}/{tmdb_id}/recommendations` 调 TMDB | 必须 | 低 |
| `backend/app/services/moviepilot_client.py` | 新增 `add_download(...)` 方法调 MP 下载端点 | 必须 | **高**：MP 下载端点签名需实施前先验证 |
| `backend/app/services/moviepilot_provider_service.py` | 新增 `push_download(...)` service 包装 | 必须 | 中 |
| `backend/app/api/moviepilot.py` | 新增路由 `POST /downloads` + 请求模型 | 必须 | 中 |
| 其它 | 无 | — | — |

### 前端

| 文件 | 改动 | 必要性 |
|---|---|---|
| `frontend/src/components/MediaDetailTab.tsx` | 删除资源通道块及相关 state/logic；新增"相似影片推荐"网格 | 必须 |
| `frontend/src/components/SubscriptionDialog.tsx` | 新增"资源陈列 + 勾选 + 解锁 + 立即转存"模块；115 子分类多选 + 单选绑定；PT 种子陈列 + 立即下载分支 | 必须 |
| `frontend/src/api/search.ts` | 新增 `getRecommendations(mediaType, tmdbId, page)` 调后端新端点 | 必须 |
| `frontend/src/api/moviepilot.ts` | 新增 `pushDownload(payload)` 调后端新端点 | 必须（如后端 MP 下载端点验证通过） |
| `frontend/src/api/types.ts` | 新增 `RecommendationItem`、`MoviePilotDownloadPayload` 等类型 | 必须 |
| 删除头部下拉相关残留 | 已在上一轮 commit 删除 | — |

## 5. 实施顺序

1. **后端 TMDB 推荐端点**（低风险先做）：路由 + service + 前端 searchApi.getRecommendations + 类型。
2. **后端 MoviePilot 立即下载端点**：先打 MP 真实端点验证签名（curl 一个测试请求到本地 MP 实例），再写 client/service/router。如验证不通过，文档里写明 fallback 路径执行。
3. **前端详情页清理**：删除资源通道块及 state/logic；新增"相似影片推荐"网格。
4. **前端 SubscriptionDialog 重构**：115 子分类多选 + 分组陈列 + 单选绑定 + 解锁 + 立即转存；PT 种子陈列 + 推下载分支。
5. **typecheck + build + commit + 重启 Docker**（沿用工作流）。

## 6. 待实施时再确认的细节

- MP 下载端点真实签名（curl 实测）。
- MP `/api/v1/search/title` 返回字段在本实例的真实表现（不同站点插件字段不同，前端渲染按"有就显示"原则）。
- 115 资源转存时 `handleTransfer` 用的目标 `parent_id="0"` 会被后端 `runtime_settings_service.get_pan115_default_folder_id` 覆盖，所以传 `"0"` 即可，真正目标在设置里配置；弹窗 hint 显示当前默认目录名。
- 单条订阅绑定的固定来源后端模型要求 TV 订阅 + tmdb_id 非空才能扫描；如果用户对 movie 也想绑定，绑定本身可以创建但扫描能力对 movie 不生效，弹窗内会注明。