# 订阅手动资源抓取 Runtime Adapter 拆分设计

## 背景

`SubscriptionService.fetch_resources_for_media()` 是手动转存搜索 API 使用的 public helper。它当前在主服务中完成两件事：

- 将 API 参数 `media_type`、`tmdb_id`、`douban_id`、`title`、`year`、`season_number` 映射为一个临时 `SubscriptionSnapshot`。
- 调用 `_fetch_resources(channel="all", sub=snapshot)` 复用订阅资源抓取管道。

这段逻辑不包含资源搜索规则，只是 public/manual entry 的 runtime wiring 和快照构造。把它抽到 runtime adapter 后，主服务里可继续保留 `fetch_resources_for_media()` 的 public 方法签名，但不再直接构造临时 snapshot 或局部 import `MediaType`。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/manual_resource_fetch_runtime_adapter.py`，提供：

- `ManualResourceFetchRuntimeDependencies`
- `build_default_manual_resource_fetch_runtime_dependencies(fetch_resources=...)`
- `fetch_resources_for_media_with_runtime_adapter(...)`

adapter 负责：

- 将 `media_type == "tv"` 映射到 `MediaType.TV`，其他值保持当前行为映射到 `MediaType.MOVIE`。
- 构造 `SubscriptionSnapshot`，保持所有当前字段默认值。
- 调用注入的 `fetch_resources(channel="all", sub=snapshot)`。
- 返回原始三元组 `(resources, traces, meta)`。

备选方案一：把 snapshot 构造放进 `resource_resolver_runtime_adapter.py`。这会把 public/manual entry 的 API 参数映射混进通用订阅资源 resolver，职责变宽。

备选方案二：继续留在 `SubscriptionService`。改动为零，但主服务仍持有手动入口的临时模型构造细节和局部 `MediaType` import，不利于后续清理资源抓取尾巴。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/manual_resource_fetch_runtime_adapter.py`
  - `ManualResourceFetchRuntimeDependencies`
    - `snapshot_class`
    - `tv_media_type`
    - `movie_media_type`
    - `fetch_resources`
  - `build_default_manual_resource_fetch_runtime_dependencies(fetch_resources=...)`
    - 绑定 `SubscriptionSnapshot`。
    - 绑定 `MediaType.TV` / `MediaType.MOVIE`。
    - 保留注入的 `fetch_resources` callback。
  - `fetch_resources_for_media_with_runtime_adapter(...)`
    - 参数与 `SubscriptionService.fetch_resources_for_media()` 对齐。
    - 构造 snapshot。
    - 调用 `fetch_resources(channel="all", sub=snapshot)`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入 manual resource fetch runtime adapter builder 和 wrapper。
  - `fetch_resources_for_media()` 改为调用 adapter。
  - 移除方法内局部 `MediaType` import。

## 行为保持

必须保持以下行为不变：

- `SubscriptionService.fetch_resources_for_media(...)` 签名不变。
- 返回值仍为 `_fetch_resources()` 的三元组。
- 手动入口仍固定使用 `channel="all"`。
- `media_type == "tv"` 使用 TV，其他值都按 Movie 处理。
- `SubscriptionSnapshot` 字段保持当前默认：
  - `id=0`
  - `douban_id=douban_id`
  - `title=title or ""`
  - `auto_download=False`
  - `tv_scope="all"`
  - `tv_season_number=season_number`
  - `tv_episode_start=None`
  - `tv_episode_end=None`
  - `tv_follow_mode="missing"`
  - `tv_include_specials=False`
  - `has_successful_transfer=False`
- 不改变 `_fetch_resources()`、resource resolver、source order、质量过滤或实际资源抓取策略。

## 测试策略

新增测试：

- `backend/tests/test_subscription_manual_resource_fetch_runtime_adapter.py`
  - adapter 为 TV 参数构造正确 `SubscriptionSnapshot` 并调用 `fetch_resources(channel="all", sub=snapshot)`。
  - adapter 对非 TV media type 仍映射为 Movie，保持现有宽松行为。
  - default builder 绑定 `SubscriptionSnapshot`、`MediaType.TV`、`MediaType.MOVIE` 和注入的 fetch callback。
  - `SubscriptionService.fetch_resources_for_media()` wrapper 透传 public 参数和 `_fetch_resources` callback 给 adapter。
  - module boundary 不 import `subscription_service`、`app.api` 或 `AsyncSession`。

红测预期：

- 首次运行失败于缺少 `app.services.subscriptions.manual_resource_fetch_runtime_adapter`。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py -q`
- `scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py tests/test_fetch_resources_waterfall.py -q`

随后执行每轮完成标准：相关 targeted backend tests、后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改手动转存搜索 API。
- 不改资源抓取顺序、HDHive 解锁、TG/Pansou/HDHive/offline fetcher。
- 不删除其他兼容 wrapper；后续单独处理无调用尾巴。
- 不改质量过滤、资源排序或日志格式。

## 自检

- 设计只移动 manual resource fetch public entry 的 runtime wiring。
- 行为保持项覆盖当前 snapshot 字段和 media type 映射。
- 测试策略包含 adapter、default builder、service wrapper 和 module boundary。
