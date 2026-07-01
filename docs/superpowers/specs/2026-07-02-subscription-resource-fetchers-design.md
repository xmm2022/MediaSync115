# 订阅资源来源抓取拆分设计

## 背景

`SubscriptionService._fetch_resources()` 已经委托给 `backend/app/services/subscriptions/resource_resolver.py`，但具体来源抓取仍留在主服务中：

- `_fetch_from_pansou()`
- `_fetch_from_hdhive()`
- `_fetch_from_tg()`
- `_fetch_offline_magnets()`

这些函数负责关键词构造、TMDB 优先查询、关键词兜底、HDHive 免费资源排序、Telegram 频道搜索、SeedHub/不太灵磁力并发抓取，以及离线来源操作日志。它们不应该继续占用 `SubscriptionService` 主体。

本轮目标是先抽离 provider-specific 来源抓取函数。`_fetch_resources()` resolver 适配层和 `_store_new_resources()` 入库流程保持不变，后续再单独处理。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/resource_fetchers.py`，提供 `ResourceFetcherDependencies` 和四个 async helper：`fetch_from_pansou()`、`fetch_from_hdhive()`、`fetch_from_tg()`、`fetch_offline_magnets()`。新模块使用现有关键词/规范化 helper，外部服务调用、运行时设置读取、HDHive 免费排序和操作日志通过依赖注入进入。`SubscriptionService` 保留原方法签名，构造依赖后委托新模块。

备选方案一：把四个函数直接移到模块里并继续导入全局 service。行数收益明显，但新模块会依赖 runtime settings、PanSou、HDHive、TG、SeedHub、不太灵和操作日志全局单例，测试隔离差。

备选方案二：把 resolver 和所有来源 fetcher 一起重写成一个 class。这个方案能统一状态，但会扩大本轮变更面，容易顺手改 waterfall 语义，不适合当前拆分节奏。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/resource_fetchers.py`
  - `ResourceFetcherDependencies`
  - `fetch_from_pansou(sub, dependencies)`
  - `fetch_from_hdhive(sub, dependencies)`
  - `fetch_from_tg(sub, dependencies)`
  - `fetch_offline_magnets(sub, dependencies)`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新模块。
  - `_fetch_from_pansou()`、`_fetch_from_hdhive()`、`_fetch_from_tg()`、`_fetch_offline_magnets()` 改为薄包装。
  - `_fetch_resources()` 继续构造 `ResourceResolverDependencies`，不改变 waterfall。

新增测试：

- `backend/tests/test_subscription_resource_fetchers.py`
  - PanSou TMDB 命中时直接返回，不调用关键词兜底。
  - PanSou TMDB 空结果时按关键词兜底。
  - HDHive TMDB 命中时规范化、按免费资源偏好排序，并不调用关键词兜底。
  - Telegram 缺少关键词时返回 skip trace，不调用 TG 搜索。
  - 离线磁力关闭时不调用 SeedHub/不太灵。
  - 离线磁力开启时合并成功来源，记录失败来源 warning 和成功来源日志。
  - 模块边界测试：不导入 `subscription_service`、`runtime_settings_service`、`operation_log_service`、各 provider service、`AsyncSession`、`app.models` 或 `app.api`。

## 数据流

1. `SubscriptionService._fetch_from_pansou()` 构造依赖：
   - TMDB 查询回调使用 `_search_pansou_pan115_resources`
   - 关键词查询回调使用 `pansou_service.search_115`
   - 列表规范化使用 `_normalize_pansou_pan115_list`
2. `fetch_from_pansou()` 保留原顺序：TMDB 查询优先；命中直接返回；空或异常时关键词兜底；缺少关键词返回 skip trace。
3. `SubscriptionService._fetch_from_hdhive()` 注入 HDHive TMDB/关键词查询、规范化、免费资源偏好读取和排序。
4. `fetch_from_hdhive()` 保留原顺序：TMDB 查询优先；命中返回；空或异常时关键词兜底。
5. `SubscriptionService._fetch_from_tg()` 注入 TG 搜索回调。
6. `fetch_from_tg()` 只负责关键词构造、skip/start/done trace 和媒体类型传递。
7. `SubscriptionService._fetch_offline_magnets()` 注入离线开关、SeedHub、不太灵和操作日志。
8. `fetch_offline_magnets()` 保留并发抓取和逐来源日志语义。

## 行为保持

必须保持以下行为不变：

- PanSou media_type 仍为 `tv`/`movie`，TV 时传入 `tv_season_number`。
- PanSou TMDB 有结果时不执行关键词兜底。
- PanSou TMDB 空结果或异常时记录 warning trace 后尝试关键词。
- HDHive TMDB 与关键词结果都继续执行 `normalize_hdhive_subscription_items()`。
- HDHive 免费优先开关开启时继续调用 `hdhive_service.sort_free_first()`。
- Telegram 缺关键词时返回 `fetch_tg_keyword_skip`。
- 离线磁力关闭时返回空资源和空 traces。
- SeedHub/不太灵仍并发抓取，单一来源异常不影响另一个来源。
- 离线来源成功/失败的 operation log action、status、message 和 extra 字段保持兼容。

## 测试策略

先写 `backend/tests/test_subscription_resource_fetchers.py` 并运行红测，确认新模块缺失。实现后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_resource_fetchers.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_metadata.py tests/test_subscription_source_attempts.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `_fetch_resources()` 的来源顺序、质量过滤、排除 URL 或离线资源拼接逻辑。
- 不改 `_store_new_resources()` 入库和去重逻辑。
- 不改 HDHive 解锁、资源质量过滤、自动转存、通知或清理逻辑。
