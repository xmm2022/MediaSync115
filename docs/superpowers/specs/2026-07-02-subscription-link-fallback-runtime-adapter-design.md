# 订阅链接回退 Runtime Adapter 拆分设计

## 背景

`link_fallback_flow.py` 和 `link_fallback_adapter.py` 已经把“链接转存失败后补充搜索并继续转存”的核心流程从 `SubscriptionService` 中抽出，但 `SubscriptionService._auto_save_records_with_link_fallback()` 仍手动装配 `LinkFallbackAdapterDependencies`：

- `_create_step_log`
- `_auto_save_resources`
- `_load_subscription_resource_urls`
- `_fetch_resources`
- `_store_new_resources`
- `auto_save_records_with_link_fallback_flow`

这些依赖现在大多已有 runtime adapter 或 DB adapter。继续在服务层构造 `LinkFallbackAdapterDependencies` 会让主服务直接 import link fallback flow/adapter，并保留 `MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS` 常量。下一步应把这组默认运行时依赖装配下沉到新的 `link_fallback_runtime_adapter.py`。

## 方案比较

推荐方案：新增 `link_fallback_runtime_adapter.py`，提供 `LinkFallbackRuntimeDependencies`、默认 builder 和 `auto_save_records_with_link_fallback_with_runtime_adapter()`。

优点：

- 保留现有 `link_fallback_flow` 和 `link_fallback_adapter` 的纯依赖注入边界。
- 默认 runtime 依赖集中在 `subscriptions/` 包内，服务层只调用一个 runtime adapter。
- 默认依赖可直接绑定现有 runtime adapters：自动转存、资源解析、资源入库、记录 URL 加载、执行日志。
- 后续拆 `_auto_save_resources()`、`_store_new_resources()`、记录 loader wrapper 时，不需要再改 link fallback flow。

备选方案一：让 `LinkFallbackAdapterDependencies` 的 builder 参数可选并直接 import runtime 服务。这样会污染 adapter 层，让它不再保持“无 runtime/db/service import”的现有边界。

备选方案二：继续由 `SubscriptionService` 传入内部 wrapper。本轮行数收益最小，也保留服务层对 link fallback flow/adapter 的直接耦合。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/link_fallback_runtime_adapter.py`
  - 定义 `LinkFallbackRuntimeDependencies`：
    - `create_step_log`
    - `auto_save_resources`
    - `load_subscription_resource_urls`
    - `fetch_resources`
    - `store_new_resources`
    - `run_adapter`
    - `run_link_fallback`
  - 定义默认常量 `DEFAULT_MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS = 6`。
  - 提供默认 helper：
    - `auto_save_resources_with_default_runtime_dependencies(...)`
    - `fetch_resources_with_default_runtime_dependencies(...)`
  - `build_default_link_fallback_runtime_dependencies()` 绑定：
    - `execution_logs.create_step_log`
    - `auto_save_resources_with_default_runtime_dependencies`
    - `load_subscription_resource_urls_with_db_adapter`
    - `fetch_resources_with_default_runtime_dependencies`
    - `store_new_resources_with_runtime_adapter`
    - `auto_save_records_with_link_fallback_with_adapter`
    - `link_fallback_flow.auto_save_records_with_link_fallback`
  - `auto_save_records_with_link_fallback_with_runtime_adapter()` 将 runtime dependencies 转换为 `LinkFallbackAdapterDependencies` 并调用 adapter。

修改文件：

- `backend/app/services/subscription_service.py`
  - 移除对 `link_fallback_flow` 和 `link_fallback_adapter` 的直接 import。
  - 移除 `MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS` 常量。
  - `_auto_save_records_with_link_fallback()` 调用 `auto_save_records_with_link_fallback_with_runtime_adapter()`，并使用 `build_default_link_fallback_runtime_dependencies()`。
  - 暂时保留 `_auto_save_resources()`、`_load_subscription_resource_urls()`、`_fetch_resources()`、`_store_new_resources()`，因为 run channel 其他阶段仍通过这些服务 wrapper 注入。

测试文件：

- `backend/tests/test_subscription_link_fallback_runtime_adapter.py`
  - 覆盖 runtime adapter 将默认依赖映射为 `LinkFallbackAdapterDependencies` 并转发参数。
  - 覆盖默认 builder 绑定现有 runtime helper、DB adapter、flow runner 和 adapter runner。
  - 覆盖默认 helper 调用自动转存 runtime adapter 和资源 resolver runtime adapter 时会构造各自默认依赖。
  - 覆盖 runtime adapter 模块边界：不 import `subscription_service` 或 API 层。

- `backend/tests/test_subscription_service_link_fallback_runtime_boundary.py`
  - 静态断言 `subscription_service.py` 不再包含：
    - `LinkFallbackAdapterDependencies`
    - `auto_save_records_with_link_fallback_flow`
    - `auto_save_records_with_link_fallback_with_adapter`
    - `MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS`
  - 断言 `_auto_save_records_with_link_fallback()` 仍存在并调用 runtime adapter。

## 行为保持

必须保持以下行为不变：

- `_auto_save_records_with_link_fallback()` 的参数和返回值不变。
- 默认最大链接回退轮次仍为 6。
- link fallback flow 的停止条件、补充搜索、trace step 写入、URL 排除和新增记录入库行为不变。
- 自动转存仍使用 `auto_save_resources_runtime_adapter` 的现有默认依赖。
- 资源补充搜索仍使用 `resource_resolver_runtime_adapter` 的现有默认依赖。
- 新资源入库仍使用 `resource_storage_runtime_adapter` 的现有默认依赖。
- 已有 `link_fallback_flow` 和 `link_fallback_adapter` tests 继续保持纯依赖注入边界。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_link_fallback_runtime_adapter.py::test_runtime_adapter_builds_adapter_dependencies_and_forwards_arguments -q`
- `scripts/verify-backend.sh -- tests/test_subscription_link_fallback_runtime_adapter.py::test_default_runtime_dependencies_bind_existing_helpers_and_runners -q`
- `scripts/verify-backend.sh -- tests/test_subscription_service_link_fallback_runtime_boundary.py -q`

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_link_fallback_runtime_adapter.py tests/test_subscription_service_link_fallback_runtime_boundary.py tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_run_channel_runtime_adapter.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `link_fallback_flow.py` 的业务逻辑。
- 不改 `link_fallback_adapter.py` 的纯 adapter 边界。
- 不拆 `_auto_save_resources()` 批处理适配层；这是下一块。
- 不拆 run channel 总调度结构。
- 不删除 run channel 其他阶段仍使用的服务 wrapper。

## 自检

- 设计只移动默认 runtime 依赖装配，不改变 flow 行为。
- 默认 helper 均绑定已有 runtime/db adapter，避免新增业务语义。
- 测试覆盖 runtime 依赖装配、服务层边界和既有 flow/adapter 回归。
- 文档内容完整，范围可由一个实施计划完成。
