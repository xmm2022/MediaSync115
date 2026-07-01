# 订阅固定来源扫描 Runtime Adapter 拆分设计

## 背景

`fixed_source_scan.py` 已经承载固定来源扫描的核心流程：

- 判断订阅是否应该扫描固定来源。
- 获取启用的手动 115 来源。
- 对 TV 订阅读取缺集状态并解析缺失集数。
- 逐个固定来源调用注入的手动来源扫描函数。
- 记录固定来源 start/done/failed/warning step。
- 返回 `saved`、`failed`、`checked` 统计。

`SubscriptionService._scan_fixed_sources_for_subscription()` 目前仍在主服务中绑定 runtime 依赖：

- 查询 `SubscriptionSource`。
- 构造 `Pan115Service(runtime_settings_service.get_pan115_cookie())`。
- 从 runtime settings 读取 115 默认目录。
- 调用 `tv_missing_service.get_tv_missing_status()`。
- 调用 `subscription_source_service.scan_manual_pan115_source()`。
- 适配 `_create_step_log()`。

这些绑定属于运行时适配，不改变固定来源扫描业务规则。把它们抽进 runtime adapter 后，`SubscriptionService` 只保留兼容 wrapper，并继续向 adapter 注入服务实例上的质量过滤和 step log 回调。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py`，提供：

- `FixedSourceScanRuntimeDependencies`
- `build_default_fixed_source_scan_runtime_dependencies(...)`
- `scan_fixed_sources_with_runtime_adapter(...)`

服务 wrapper 只负责调用默认 builder 并传入 `resolve_quality_filter`、`create_step_log`。

备选方案一：把默认 builder 放进 `fixed_source_scan.py`。这样文件更少，但会把 ORM、runtime settings、`Pan115Service` 和全局服务带入核心扫描 helper，破坏当前依赖注入边界。

备选方案二：把固定来源 runtime wiring 合并进 `fixed_source_run_flow.py`。这会把“是否扫描/扫描本体”和“扫描结果如何累计、清理电影订阅”的两个层级揉在一起，不利于后续处理总调度结构。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py`
  - `FixedSourceScanRuntimeDependencies`
    - `manual_source_type`
    - `source_model`
    - `run_select`
    - `get_pan115_cookie`
    - `create_pan_service`
    - `get_pan115_default_folder`
    - `resolve_quality_filter`
    - `get_tv_missing_status`
    - `scan_manual_source`
    - `create_step_log`
    - `run_scan_fixed_sources_for_subscription`
  - `build_default_fixed_source_scan_runtime_dependencies(resolve_quality_filter, create_step_log)`
    - 绑定 `MANUAL_PAN115_SOURCE`。
    - 绑定 `SubscriptionSource`。
    - 绑定 SQLAlchemy `select`。
    - 绑定 `runtime_settings_service` 读取 cookie 和默认目录。
    - 绑定 `Pan115Service`。
    - 绑定 `tv_missing_service.get_tv_missing_status`。
    - 绑定 `subscription_source_service.scan_manual_pan115_source`。
    - 绑定核心 `scan_fixed_sources_for_subscription()`。
  - `scan_fixed_sources_with_runtime_adapter(...)`
    - 构造 `FixedSourceScanDependencies(...)`。
    - 内部提供 `list_enabled_manual_sources()`、`create_pan_service()`、`get_parent_folder_id()`、`scan_manual_source()` 和 `create_step_log()` runtime wrappers。
    - 调用 `run_scan_fixed_sources_for_subscription(...)`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入 `build_default_fixed_source_scan_runtime_dependencies` 和 `scan_fixed_sources_with_runtime_adapter`。
  - `_scan_fixed_sources_for_subscription()` 改为薄 wrapper，传入原参数、质量过滤回调和 step log 回调。
  - 移除不再由主服务直接使用的 `Pan115Service`、`SubscriptionSource`、`MANUAL_PAN115_SOURCE` 和 `subscription_source_service` imports。`runtime_settings_service` 与 `tv_missing_service` 如果仍被其他 wrapper 使用则保留。

新增测试：

- `backend/tests/test_subscription_fixed_source_scan_runtime_adapter.py`
  - runtime wrapper 正确构造 lower `FixedSourceScanDependencies` 并透传参数。
  - lower dependencies 查询启用的 manual 115 来源时使用注入的 model、source type 和 select runner。
  - lower dependencies 正确读取 115 cookie、默认目录 folder_id、TV 缺集服务、手动来源扫描和 step log。
  - 默认 builder 绑定现有 runtime 服务和核心 runner。
  - runtime adapter 不 import `subscription_service`、`app.api` 或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- `_scan_fixed_sources_for_subscription()` 方法签名不变。
- `fixed_source_scan.py` 的扫描规则、step 名称、消息和统计语义不变。
- 手动来源查询条件仍是当前订阅、`enabled is True`、`source_type == MANUAL_PAN115_SOURCE`。
- 115 目标目录仍从 `runtime_settings_service.get_pan115_default_folder()` 读取，缺省 folder id 仍为 `"0"`。
- 115 服务仍使用当前 runtime cookie 构造。
- TV 缺集状态和手动来源扫描仍调用现有服务。
- 不改变固定来源运行 flow 对 saved/failed/checked 的后续累计和电影 cleanup 语义。

## 测试策略

先写 `backend/tests/test_subscription_fixed_source_scan_runtime_adapter.py` 并运行红测，确认新模块缺失。实现 runtime adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_fixed_source_scan_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改固定来源扫描核心规则。
- 不改手动来源表结构、API 或前端展示。
- 不改自动转存、补充搜索、HDHive 解锁、离线下载或通知逻辑。
- 不改固定来源 run flow 的 cleanup 和统计累计语义。

## 自检

- 文档已完整描述范围、组件和验证方式。
- 设计范围只覆盖固定来源扫描 runtime wiring，不和 `fixed_source_scan.py` 或 `fixed_source_run_flow.py` 的核心职责重叠。
- 测试策略包含红测、adapter lower dependency 验证、默认绑定验证和相关回归。
