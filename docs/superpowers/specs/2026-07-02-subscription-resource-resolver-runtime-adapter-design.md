# 订阅资源解析 Runtime Adapter 拆分设计

## 背景

资源抓取链路已经拆成多层：

- `resource_resolver.py` 负责来源优先级、瀑布式抓取、HDHive 解锁准备、去重排除、离线磁力补充和质量过滤。
- `resource_resolver_adapter.py` 负责把 observability 回调转换为核心 resolver 需要的 `ResourceResolverDependencies`。
- `resource_fetcher_adapter.py` 负责具体来源 fetcher 的依赖装配。

`SubscriptionService._fetch_resources()` 仍保留一段运行时装配：

- 定义 `emit_source_attempt_event()` 闭包并在 Kafka 启用时发送 `source_attempt`。
- 构造 `ResourceResolverAdapterDependencies`。
- 注入 `operation_log_service.log_background_event`、`filter_resources_excluding_urls` 和 `resolve_subscription_resources`。
- 调用 `fetch_subscription_resources_with_adapter(...)`。

这些代码只做服务层 wiring，不决定资源解析业务规则。把它抽成 runtime adapter 后，`_fetch_resources()` 可以只传入当前服务实例方法，后续再按来源拆 `_fetch_from_pansou()`、`_fetch_from_hdhive()`、`_fetch_from_tg()` 和 `_fetch_offline_magnets()`。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/resource_resolver_runtime_adapter.py`。该模块承载 `_fetch_resources()` 的运行时装配，提供：

- `ResourceResolverRuntimeDependencies`
- `build_default_resource_resolver_runtime_dependencies(...)`
- `emit_source_attempt_event(...)`
- `fetch_subscription_resources_with_runtime_adapter(...)`

服务方法只把当前 `self` 相关的 fetcher、排序、质量过滤和 HDHive 解锁方法注入默认 runtime dependencies，然后调用 runtime adapter。

备选方案一：只把 `emit_source_attempt_event()` 抽成 helper，保留 `ResourceResolverAdapterDependencies` 构造在服务中。风险低，但服务方法仍然承载大部分 adapter wiring。

备选方案二：一次性连同 `_fetch_from_pansou()`、`_fetch_from_hdhive()`、`_fetch_from_tg()`、`_fetch_offline_magnets()` 一起迁出。收益更大，但会同时触碰多条来源链路，验证面过宽，不适合作为本块第一步。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/resource_resolver_runtime_adapter.py`
  - `ResourceResolverRuntimeDependencies`
    - 持有当前 `_fetch_resources()` 需要的 fetcher、排序、质量过滤、HDHive 解锁、日志、事件、过滤函数、adapter runner 和核心 resolver runner。
  - `emit_source_attempt_event(subscription_id, data)`
    - 保持现有 Kafka 发送语义：仅当 `kafka_producer._enabled` 为真时发送 `event_type="source_attempt"`、`data=data`、`key=str(subscription_id)`。
  - `build_default_resource_resolver_runtime_dependencies(...)`
    - 接收服务实例相关方法：
      - `fetch_from_hdhive`
      - `fetch_from_tg`
      - `fetch_from_pansou`
      - `fetch_offline_magnets`
      - `resolve_source_order`
      - `resolve_subscription_resolutions`
      - `resolve_subscription_quality_filter`
      - `prepare_hdhive_locked_resources`
      - `build_hdhive_unlock_context`
    - 绑定现有 concrete runtime 依赖：
      - `filter_resources_excluding_urls`
      - `operation_log_service.log_background_event`
      - `emit_source_attempt_event`
      - `fetch_subscription_resources_with_adapter`
      - `resolve_subscription_resources`
  - `fetch_subscription_resources_with_runtime_adapter(...)`
    - 接收当前 `_fetch_resources()` 的运行时参数。
    - 把 `ResourceResolverRuntimeDependencies` 转换为现有 `ResourceResolverAdapterDependencies`。
    - 调用 `dependencies.run_adapter(...)`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 移除 `_fetch_resources()` 内部 `emit_source_attempt_event()` 闭包。
  - 移除 `_fetch_resources()` 内部 `ResourceResolverAdapterDependencies` 构造。
  - 调用 `fetch_subscription_resources_with_runtime_adapter(...)`。
  - 使用 `build_default_resource_resolver_runtime_dependencies(...)` 注入当前服务实例方法。
  - 移除不再由服务直接使用的 `filter_resources_excluding_urls`、`ResourceResolverAdapterDependencies`、`fetch_subscription_resources_with_adapter`、`resolve_subscription_resources` import。

新增测试：

- `backend/tests/test_subscription_resource_resolver_runtime_adapter.py`
  - runtime adapter 正确把运行时依赖转换为 `ResourceResolverAdapterDependencies` 并调用下层 adapter。
  - `channel`、`sub`、`hdhive_unlock_context`、`source_order` 和 `exclude_urls` 全量透传。
  - 生成的 lower dependencies 逐项调用注入的 runtime callbacks。
  - `build_default_resource_resolver_runtime_dependencies(...)` 绑定现有 adapter runner、核心 resolver、过滤函数和服务实例方法。
  - `emit_source_attempt_event()` 在 Kafka 启用/禁用时保持现有发送行为。
  - runtime adapter 不 import `subscription_service` 或 `app.api`；核心 `resource_resolver_adapter.py` 仍由现有测试保证不 import runtime 层。

## 行为保持

必须保持以下行为不变：

- `_fetch_resources()` 方法签名不变。
- `channel`、`sub`、`hdhive_unlock_context`、`source_order` 和 `exclude_urls` 的透传形状不变。
- 来源尝试事件仍只在 Kafka `_enabled` 为真时发送，事件类型、data 和 key 不变。
- 来源抓取、来源优先级解析、质量过滤、HDHive 解锁准备、日志记录和去重过滤仍使用同一批 service 方法或 helper。
- `resource_resolver.py` 和 `resource_resolver_adapter.py` 的业务规则不改。

## 测试策略

先写 `backend/tests/test_subscription_resource_resolver_runtime_adapter.py` 并运行红测，确认新模块缺失。实现 runtime adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_subscription_resource_resolver_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_fetcher_adapter.py tests/test_subscription_resource_fetchers.py tests/test_subscription_resource_ingest_run_flow.py tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_item_processing_run_flow.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变来源优先级、fallback、HDHive 解锁、去重排除或质量过滤规则。
- 不拆具体来源 fetcher 的 runtime dependency builder。
- 不改 `_store_new_resources()`，它会在资源抓取相关后续块中单独处理。
- 不清理 API 层里仍存在的独立 Kafka 发送逻辑。
