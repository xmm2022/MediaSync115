# 订阅资源入库 Runtime Adapter 拆分设计

## 背景

`resource_storage.py` 已经承载资源入库的核心规则，`resource_storage_db_adapter.py` 已经承载 DB 查询和 `DownloadRecord` 创建：

- core storage 负责资源 URL 归一、重复统计、离线资源开关判断和新增记录统计。
- DB adapter 负责在 `db.no_autoflush` 内查询已有 URL，并通过回调创建 `DownloadRecord`。

`SubscriptionService._store_new_resources()` 目前只剩运行时依赖组装：

- `runtime_settings_service.get_subscription_offline_transfer_enabled`
- `MediaStatus.MATCHED`
- `resource_storage.store_new_resources`
- `store_new_resources_with_db_adapter`

这段组装不需要留在主服务。新增 runtime adapter 后，`SubscriptionService` 只保留兼容 wrapper，主类可移除 `ResourceStorageDbAdapterDependencies`、`store_new_resources_flow` 和 `MediaStatus` 的直接使用，为后续总调度拆分减少运行时依赖面。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/resource_storage_runtime_adapter.py`，提供：

- `ResourceStorageRuntimeDependencies`
- `build_default_resource_storage_runtime_dependencies()`
- `store_new_resources_with_runtime_adapter(...)`

服务方法保留原签名，只调用 runtime wrapper。

备选方案一：把默认 builder 放进 `resource_storage_db_adapter.py`。这样文件更少，但会把 runtime settings 和 `MediaStatus` 放进 DB adapter，模糊 DB 边界；现有 DB adapter 测试明确要求不导入 runtime settings。

备选方案二：暂时保留 `_store_new_resources()` 当前实现。改动更少，但主服务继续持有资源入库 runtime wiring，不利于最后把 `run_channel_check()` 收敛为更薄的调度入口。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/resource_storage_runtime_adapter.py`
  - `ResourceStorageRuntimeDependencies`
    - `offline_transfer_enabled`
    - `record_status_matched`
    - `run_store_new_resources`
    - `run_store_new_resources_with_db_adapter`
  - `build_default_resource_storage_runtime_dependencies()`
    - 绑定 `runtime_settings_service.get_subscription_offline_transfer_enabled`。
    - 绑定 `MediaStatus.MATCHED`。
    - 绑定核心 `resource_storage.store_new_resources()`。
    - 绑定 DB adapter `store_new_resources_with_db_adapter()`。
  - `store_new_resources_with_runtime_adapter(db, subscription_id, resources, dependencies=None)`
    - 使用默认或注入的 runtime dependencies。
    - 构造 `ResourceStorageDbAdapterDependencies(...)`。
    - 调用 `run_store_new_resources_with_db_adapter(db, subscription_id, resources, dependencies=...)`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入 `store_new_resources_with_runtime_adapter`。
  - `_store_new_resources()` 改为薄 wrapper。
  - 移除主服务不再使用的 `ResourceStorageDbAdapterDependencies`、`store_new_resources_flow` 和 `MediaStatus` imports。

新增测试：

- `backend/tests/test_subscription_resource_storage_runtime_adapter.py`
  - runtime wrapper 正确把 runtime dependencies 转成 `ResourceStorageDbAdapterDependencies`。
  - wrapper 透传 `db`、`subscription_id` 和 `resources`，并返回 DB adapter runner 的结果。
  - lower DB adapter dependencies 暴露离线开关、匹配状态和 core runner。
  - 默认 builder 绑定现有 runtime settings、`MediaStatus.MATCHED`、core storage runner 和 DB adapter runner。
  - runtime adapter 不 import `subscription_service`、`app.api` 或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- `_store_new_resources(db, subscription_id, resources)` 方法签名不变。
- 入库仍通过 `store_new_resources_with_db_adapter()` 访问数据库。
- DB adapter 的查询、`DownloadRecord` 创建和事务边界不变。
- 离线转存开关仍来自 `runtime_settings_service.get_subscription_offline_transfer_enabled()`。
- 新增记录状态仍是 `MediaStatus.MATCHED`。
- core storage runner 仍是 `resource_storage.store_new_resources()`。
- 不改变资源抓取、资源过滤、自动转存或日志语义。

## 测试策略

先写 `backend/tests/test_subscription_resource_storage_runtime_adapter.py` 并运行红测，确认新模块缺失。实现 runtime adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_resource_storage_runtime_adapter.py tests/test_subscription_resource_storage_db_adapter.py tests/test_subscription_resource_storage.py tests/test_fetch_resources_waterfall.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：相关 targeted backend tests、后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `resource_storage.py` 的去重、离线资源和统计规则。
- 不改 `resource_storage_db_adapter.py` 的查询和模型构造行为。
- 不改 `DownloadRecord` 字段、状态值或事务提交时机。
- 不改资源抓取、自动转存、固定来源扫描或通知逻辑。

## 自检

- 文档已完整描述范围、组件和验证方式。
- 设计范围只覆盖资源入库 runtime wiring，不改变 core storage 或 DB adapter 语义。
- 测试策略包含红测、默认绑定、wrapper 转换和相关资源入库回归。
