# 订阅 HDHive 解锁 Runtime Adapter 拆分设计

## 背景

资源入库 `_store_new_resources()` 已经在既有提交中拆成 `resource_storage.py` 和 `resource_storage_db_adapter.py`，当前服务层只保留薄包装。资源抓取链路中，`_fetch_resources()` 已经委托 `resource_resolver_runtime_adapter.py`，四个具体来源 fetcher 也已经委托 `resource_fetcher_runtime_adapter.py`。

主服务里仍有一段与资源抓取直接相连的 HDHive 解锁运行时装配：

- `_build_hdhive_unlock_context()` 从 `runtime_settings_service` 读取 HDHive 解锁配置。
- `_prepare_hdhive_locked_resources()` 把 `normalize_hdhive_subscription_items`、`extract_resource_url`、`normalize_share_url` 和 `hdhive_service.unlock_resource` 注入核心 `hdhive_unlock.py`。
- 三个静态 helper 只是透传 `hdhive_unlock.py` 的纯函数。

这些代码只绑定 runtime services，不改变 HDHive 解锁策略。用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/hdhive_unlock_runtime_adapter.py`，提供默认运行时依赖构造和两个 runtime wrapper：

- `build_hdhive_unlock_context_with_runtime_adapter(...)`
- `prepare_hdhive_locked_resources_with_runtime_adapter(...)`

服务方法继续保留兼容入口，但只调用新 runtime adapter。静态 helper 可改为直接导入纯函数或保留薄包装，避免影响现有测试和潜在调用方。

备选方案一：把 `_build_hdhive_unlock_context()` 和 `_prepare_hdhive_locked_resources()` 直接删掉，让 resolver runtime adapter 直接引用新 runtime 函数。收益更大，但会改变 `SubscriptionService` 的可 monkeypatch seam，不适合当前窄切。

备选方案二：把 runtime settings 绑定放进 `hdhive_unlock.py`。这会破坏该模块当前的纯依赖注入边界，和已有测试约束相冲突。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/hdhive_unlock_runtime_adapter.py`
  - `HDHiveUnlockRuntimeDependencies`
    - 持有 `get_auto_unlock_enabled`、`get_max_points_per_item`、`get_budget_points_per_run`、`get_threshold_inclusive`。
    - 持有 `normalize_items`、`extract_resource_url`、`normalize_share_url`、`unlock_resource`。
    - 持有 `build_context` 和 `prepare_locked_resources`，默认指向 `hdhive_unlock.py` 的纯函数。
  - `build_default_hdhive_unlock_runtime_dependencies()`
    - 绑定现有 concrete runtime 依赖：
      - `runtime_settings_service.get_subscription_hdhive_auto_unlock_enabled`
      - `runtime_settings_service.get_subscription_hdhive_unlock_max_points_per_item`
      - `runtime_settings_service.get_subscription_hdhive_unlock_budget_points_per_run`
      - `runtime_settings_service.get_subscription_hdhive_unlock_threshold_inclusive`
      - `normalize_hdhive_subscription_items`
      - `extract_resource_url`
      - `normalize_share_url`
      - `hdhive_service.unlock_resource`
      - `build_hdhive_unlock_context`
      - `prepare_hdhive_locked_resources`
  - `build_hdhive_unlock_context_with_runtime_adapter(...)`
    - 使用注入的 settings getter 构造核心 context。
  - `prepare_hdhive_locked_resources_with_runtime_adapter(...)`
    - 使用注入的 normalizer、URL helper 和 unlock callback 调用核心解锁流程。

修改文件：

- `backend/app/services/subscription_service.py`
  - `_build_hdhive_unlock_context()` 调用 `build_hdhive_unlock_context_with_runtime_adapter()`。
  - `_prepare_hdhive_locked_resources()` 调用 `prepare_hdhive_locked_resources_with_runtime_adapter()`。
  - 移除不再由服务直接使用的 `hdhive_service`、`normalize_hdhive_subscription_items`、`build_hdhive_unlock_context` 和 `prepare_hdhive_locked_resources` imports。
  - 保留 `_allow_unlock_by_threshold()`、`_safe_int()` 和 `_should_stop_unlocking_on_message()` 的兼容薄包装。

新增测试：

- `backend/tests/test_subscription_hdhive_unlock_runtime_adapter.py`
  - runtime adapter 使用注入 settings 构造 context，参数值与核心 `build_hdhive_unlock_context()` 完全一致。
  - runtime adapter 使用注入 normalizer、URL helper、share URL normalizer 和 unlock callback 调用核心 `prepare_hdhive_locked_resources()`。
  - 默认 builder 绑定现有 concrete helpers 和 core runners。
  - runtime adapter 不 import `subscription_service`、`app.api`、`AsyncSession` 或 ORM model。

## 行为保持

必须保持以下行为不变：

- `_build_hdhive_unlock_context()` 和 `_prepare_hdhive_locked_resources()` 方法签名不变。
- HDHive 解锁启用状态、单资源积分阈值、单轮积分预算和阈值包含策略仍来自同一批 runtime settings getter。
- 资源归一化、资源 URL 提取、分享链接归一化和 `hdhive_service.unlock_resource` 仍使用同一批 concrete helpers。
- `hdhive_unlock.py` 的跳过、解锁、熔断、统计和 trace 规则不改。
- `_fetch_resources()`、resolver adapter、fetcher adapter、资源入库和自动转存逻辑不改。

## 测试策略

先写 `backend/tests/test_subscription_hdhive_unlock_runtime_adapter.py` 并运行红测，确认新模块缺失。实现 runtime adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_hdhive_unlock_runtime_adapter.py tests/test_hdhive_unlock_policy.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_fetcher_runtime_adapter.py tests/test_subscription_resource_ingest_run_flow.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变 HDHive 解锁核心策略、预算语义、最多解锁条数或熔断条件。
- 不改变资源来源 waterfall、来源优先级或质量过滤。
- 不重拆已经完成的 `_store_new_resources()` 入库边界。
- 不删除 `SubscriptionService` 中保留给调用方和测试的兼容方法。
