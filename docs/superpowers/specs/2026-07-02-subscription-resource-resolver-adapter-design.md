# 订阅资源抓取调度适配层拆分设计

## 背景

`SubscriptionService._fetch_resources()` 当前不直接实现资源抓取算法，主要做三件事：

- 构造来源抓取结果日志 `subscription.item.fetch_source`。
- 构造并发送 Kafka `source_attempt` 事件。
- 组装 `ResourceResolverDependencies` 后调用 `resolve_subscription_resources()`。

核心调度、优先级瀑布、HDHive 解锁、离线资源追加和质量过滤已经在 `resource_resolver.py`。本轮应把 `_fetch_resources()` 的适配层抽到独立 helper，让服务层只保留运行时依赖注入。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/resource_resolver_adapter.py`，提供 `fetch_subscription_resources_with_adapter()` 和依赖 dataclass。新模块负责构造 resolver 依赖、日志闭包和事件闭包，不直接导入 operation log、Kafka、runtime settings、服务单例、ORM 或 API。

备选方案一：把日志和事件逻辑并入 `resource_resolver.py`。会让核心调度 helper 直接承担运行时观测职责，不利于保持纯依赖注入边界。

备选方案二：保留 `_fetch_resources()` 现状，先拆 `_resource_fetcher_dependencies()`。也可行，但 `_fetch_resources()` 是资源抓取总入口，先抽调度适配层能让后续来源 fetcher 拆分更集中。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/resource_resolver_adapter.py`
  - `ResourceResolverAdapterDependencies`
    - `fetch_from_hdhive(sub)`
    - `fetch_from_tg(sub)`
    - `fetch_from_pansou(sub)`
    - `fetch_offline_magnets(sub)`
    - `resolve_source_order(channel)`
    - `resolve_subscription_resolutions(sub)`
    - `resolve_subscription_quality_filter(sub)`
    - `prepare_hdhive_locked_resources(resources, context, traces)`
    - `build_hdhive_unlock_context()`
    - `filter_resources_excluding_urls(resources, exclude_urls)`
    - `log_background_event(**kwargs)`
    - `emit_source_attempt_event(subscription_id, data)`
    - `run_resolver(...)`
  - `fetch_subscription_resources_with_adapter(...)`
    - 构造 `log_source_fetch()`，保持当前 background event shape。
    - 构造 `emit_source_attempt()`，保持当前 Kafka payload shape。
    - 构造 `ResourceResolverDependencies`。
    - 调用注入的 `run_resolver`，生产路径注入 `resolve_subscription_resources()`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 adapter。
  - 将 `_fetch_resources()` 缩减为 Kafka emit wrapper 和 adapter 调用。
  - 保持 `_fetch_from_hdhive()`、`_fetch_from_tg()`、`_fetch_from_pansou()`、`_fetch_offline_magnets()` 等既有依赖注入方法不变。

新增测试：

- `backend/tests/test_subscription_resource_resolver_adapter.py`
  - adapter 调用 `run_resolver` 时传递 channel、sub、source_order、exclude_urls 和 HDHive context。
  - adapter 构造的 `log_source_fetch()` 保持当前 event kwargs、status 和 extra shape。
  - adapter 构造的 `emit_source_attempt()` 保持当前 payload shape，并默认 status/count。
  - adapter 传入 resolver 的 fetcher、排序、质量过滤、HDHive 解锁和 URL 排除依赖保持注入对象。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、数据库 session、模型、外部服务、Kafka 或 API。

## 行为保持

必须保持以下行为不变：

- `subscription.item.fetch_source` 的 source_type、module、action、status、message 和 extra 不变。
- source attempt Kafka event 的 event_type、data 字段和 key 仍由服务层 wrapper 保持。
- Kafka 未启用时仍不发送事件。
- `resolve_subscription_resources()` 的入参、返回值和异常处理语义不变。
- 来源 fetcher、source order、质量过滤、HDHive 解锁和 URL 排除依赖不变。
- 不改变各来源抓取、离线磁力、入库或自动转存逻辑。

## 测试策略

先写 `backend/tests/test_subscription_resource_resolver_adapter.py` 并运行红测，确认新模块缺失。实现 adapter 并接入后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_resource_resolver_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_fetchers.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `resource_resolver.py` 的核心调度逻辑。
- 不拆 `_resource_fetcher_dependencies()`。
- 不改各来源 fetcher 或资源入库逻辑。
- 不改变质量过滤、HDHive 解锁或离线磁力追加语义。
