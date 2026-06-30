# MoviePilot 缺集补齐与订阅通道隔离设计

状态：已实现，自动化验证通过；真实 MoviePilot/115 环境待接入后验收。
日期：2026-06-30。

## 背景

MediaSync115 已支持 115 自动搜索/固定来源补缺，也已支持 MoviePilot 订阅、搜索、推送下载和手动同步状态。当前缺口是：MoviePilot 订阅不能复用本系统的缺集清单做精准补缺；同时 `subscriptions.tmdb_id / douban_id / imdb_id` 的全局唯一约束会阻止同一 TMDB 同时存在 115 与 MoviePilot 两条订阅，甚至可能在创建 MoviePilot 订阅时改写已有 115 订阅。

## 目标

- 同一媒体允许 115 与 MoviePilot 两个通道显式并存。
- 115 追新继续由 `subscription.check` 搜索 HDHive/Pansou/TG 与固定来源扫描。
- MoviePilot 追新继续交给 MoviePilot 自身订阅。
- MoviePilot 订阅也能显示本系统计算出的 TV 缺集状态，但不进入 115 自动转存逻辑。
- 新增“用 MoviePilot 补缺”：缺集列表 -> MoviePilot 搜索 -> 单集精准匹配 -> 推送 MoviePilot 下载。
- 第一版只自动推送明确匹配的单集资源；季包、全集包、多集包和模糊资源只进入人工确认/跳过状态。
- 记录已推送、失败、无匹配、模糊匹配，避免重复推送。
- 增加 MoviePilot 定时同步任务。
- 引入 Alembic，为后续 Postgres 支持和 schema 演进打基础。

## 非目标

- 不把 MoviePilot 外部订阅塞进 MediaSync115 的 115 自动转存流程。
- 不在第一版自动处理季包/全集包。
- 应用主数据库强制使用 Postgres。
- 不在生产容器启用热重载。
- 追新日历本轮只做评估或接口形状预留，不做完整 UI。

## 订阅通道模型

`Subscription` 的全局唯一身份不再由 `tmdb_id / douban_id / imdb_id` 单列保证。实际唯一语义变为“同一媒体在同一通道内唯一”。

通道判定：

- 115：`provider` 为空或 `mediasync115`，且 `external_system` 为空或 `mediasync115`。
- MoviePilot：`provider == "moviepilot"` 或 `external_system == "moviepilot"`。

创建行为：

- 创建 115 订阅时只检查 115 通道内是否已存在同一媒体。
- 创建 MoviePilot 订阅时只检查 MoviePilot 通道内是否已存在同一媒体。
- MoviePilot 创建逻辑不能复用并改写已有 115 订阅；已有 115 时应新建 MoviePilot 本地订阅记录并保存 `external_subscription_id`。

数据库：

- 移除 ORM 中 `douban_id/tmdb_id/imdb_id` 的 `unique=True`。
- 为这些列保留普通索引。
- 本轮不保留 SQLite 应用主数据库兼容路径。
- 同通道重复由 API/service 层继续拦截。

## Alembic 与 Postgres 支持

引入 Alembic 后，复杂 schema 变化走版本化 migration。`init_db()` 保留轻量建表/补列兜底，但不再承担复杂约束迁移。

本轮应至少覆盖：

- Alembic 配置和 baseline。
- 去除 `subscriptions` 全局唯一约束的 migration。
- 新建 MoviePilot 补缺记录表的 migration。

Postgres 支持落地：

- 添加 `asyncpg` 依赖。
- `DATABASE_URL` 默认使用 Postgres。
- 正式 Compose 内置 Postgres，并注入 `postgresql+asyncpg://...`。
- 测试环境使用临时 Postgres 或 `TEST_DATABASE_URL` 指定的 Postgres 测试库。

## MoviePilot 补缺记录

新增 `moviepilot_completion_records` 表，用于记录每个缺集的匹配与推送结果。

核心字段：

- `subscription_id`
- `tmdb_id`
- `season_number`
- `episode_number`
- `resource_title`
- `resource_url`
- `resource_hash`
- `status`: `matched / pushed / failed / no_match / ambiguous / skipped`
- `error_message`
- `raw_item_json`
- `created_at`
- `updated_at`

`DownloadRecord` 仍用于已提交给 MoviePilot 后的下载/转移状态同步；补缺记录表只表达“针对某个缺集尝试过什么、结果是什么”。

## MoviePilot 补缺流程

新增 `moviepilot_completion_service.py`。

流程：

1. 读取 MoviePilot TV 订阅。
2. 调 `tv_missing_service.get_tv_missing_status(...)` 计算缺集。
3. 使用订阅标题调用 `moviepilot_provider_service.search_title(title)`。
4. 用 `name_parser.parse_episode(...)` 解析种子标题。
5. 只选择明确单集：
   - 可解析出唯一 `(season, episode)`。
   - 集数属于缺集集合。
   - 标题未表现为季包、全集包或多集包。
   - 本地没有已推送或正在处理的同集记录。
6. 调 `moviepilot_provider_service.push_download(...)` 推送下载。
7. 写入或更新 `moviepilot_completion_records`。

## API

新增 MoviePilot 路由：

- `GET /api/moviepilot/subscriptions/{subscription_id}/missing-completion/preview`
  - 返回缺集、可自动推送、模糊匹配、无匹配、已处理记录。
- `POST /api/moviepilot/subscriptions/{subscription_id}/missing-completion/run`
  - 只推送明确单集匹配。
  - 支持 `dry_run`，用于复用预览逻辑。

调整现有订阅缺集路由：

- `/api/subscriptions/{subscription_id}/tv/missing-status` 对 MoviePilot TV 订阅也返回缺集状态。
- 响应中明确标注 MoviePilot 不参与 115 自动转存。

## MoviePilot 自动同步

现有 `job_registry` 已注册 `moviepilot.sync`。本轮补齐调度配置：

- runtime settings:
  - `moviepilot_sync_enabled`
  - `moviepilot_sync_interval_minutes`
- 新增 `moviepilot_sync_scheduler_service.py`。
- 设置保存时 ensure `SchedulerTask(job_key="moviepilot.sync")`。
- 默认间隔 60 分钟，最小 15 或 30 分钟。

## 前端

`SubscriptionTab`：

- MoviePilot TV 订阅展开时显示缺集明细。
- 增加“预览补缺”和“用 MoviePilot 补缺”操作。
- 预览结果按可推送、已处理、无匹配、需人工确认、失败分组。
- 115 固定来源管理仍只对 115 订阅展示。

`SettingsTab`：

- MoviePilot 配置区增加自动同步开关和同步间隔。
- 保留手动同步入口。

API 类型：

- 增加 MoviePilot completion preview/run 类型。
- 更新 contract test。

## 验证

- `alembic upgrade head`
- 后端 MoviePilot provider/completion/scheduler 相关 pytest。
- 订阅 API 测试覆盖同 TMDB 双通道并存。
- 前端 `npm run build`。
- 当前自动化验证已通过；真实 MoviePilot/115 环境验收需在可用凭据和资源环境中执行。
- 手动验证：
  - 同一 TMDB 可同时存在 115 和 MoviePilot 订阅。
  - MoviePilot 缺集只推明确单集。
  - 115 定时任务不处理 MoviePilot 订阅。
  - MoviePilot sync 可手动触发，也可由 scheduler 创建任务。
