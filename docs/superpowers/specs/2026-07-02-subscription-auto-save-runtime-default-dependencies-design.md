# 订阅自动转存 Runtime 默认依赖装配设计

## 背景

`auto_save_resources_runtime_adapter.py` 已经承接 `_auto_save_resources()` 的运行时适配层，但当前默认 builder 仍要求 `SubscriptionService` 传入四个 callback：

- `resolve_quality_filter`
- `create_step_log`
- `apply_precise_postprocess_status`
- `notify_transfer_success`

其中三个已经有稳定 runtime helper：

- `resolve_subscription_quality_filter_with_runtime_adapter`
- `apply_precise_transfer_postprocess_status_with_runtime_adapter`
- `notify_transfer_success_with_runtime_adapter`

`create_step_log` 也已经由 `subscriptions.execution_logs.create_step_log` 提供。继续在服务层手动传这些 callback，会让 `_auto_save_resources()` 保留默认依赖装配职责，并使 `_apply_precise_transfer_postprocess_status()`、`_notify_transfer_success()` 两个服务私有 wrapper 只为自动转存存在。

本块目标是让 `build_default_auto_save_resources_runtime_dependencies()` 支持无参默认装配，并让 `_auto_save_resources()` 只调用默认 builder。

## 方案比较

推荐方案：扩展 `build_default_auto_save_resources_runtime_dependencies()`，将四个 callback 参数改为可选；未传入时绑定现有 runtime helper。

优点：

- 保留显式注入能力，现有 adapter tests 仍可传 fake callback。
- 服务层可以删除自动转存专用的 postprocess/notify wrapper。
- 与前一块 `resource_resolver_runtime_adapter` 的默认依赖自装配模式一致。
- `link_fallback_runtime_adapter` 可复用无参默认 builder，避免在新 runtime adapter 中重复传同一组默认 helper。

备选方案一：新增第二个 builder，例如 `build_runtime_auto_save_resources_dependencies()`。这会产生两个默认 builder，后续调用方更难判断使用哪一个。

备选方案二：保留服务层显式传参。改动最小，但无法继续收缩 `subscription_service.py`。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/auto_save_resources_runtime_adapter.py`
  - import：
    - `subscriptions.execution_logs.create_step_log as create_subscription_step_log`
    - `postprocess_status_runtime_adapter.apply_precise_transfer_postprocess_status_with_runtime_adapter`
    - `runtime_preferences_adapter.resolve_subscription_quality_filter_with_runtime_adapter`
    - `transfer_notification_runtime_adapter.notify_transfer_success_with_runtime_adapter`
  - `build_default_auto_save_resources_runtime_dependencies()` 的四个参数改为可选。
  - 使用 `x if x is not None else default` 选择显式注入或默认 helper，确保 falsy callable 也能作为显式注入保留。

- `backend/app/services/subscriptions/link_fallback_runtime_adapter.py`
  - `auto_save_resources_with_default_runtime_dependencies()` 改为调用 `build_default_auto_save_resources_runtime_dependencies()`，不再重复传默认 helper。
  - 移除不再需要的四个 helper imports。

- `backend/app/services/subscription_service.py`
  - `_auto_save_resources()` 调用 `build_default_auto_save_resources_runtime_dependencies()`，不再传服务方法。
  - 删除 `_apply_precise_transfer_postprocess_status()`。
  - 删除 `_notify_transfer_success()`。
  - 移除对应 imports：
    - `apply_precise_transfer_postprocess_status_with_runtime_adapter`
    - `notify_transfer_success_with_runtime_adapter`
  - 保留 `_resolve_subscription_quality_filter()`，因为 API 和固定来源扫描仍使用它。

测试文件：

- `backend/tests/test_subscription_auto_save_resources_runtime_adapter.py`
  - 新增默认 builder 无参绑定现有 runtime helper 的测试。
  - 新增 falsy callable 显式注入保留测试。
  - 更新既有显式注入测试，确认覆盖能力不变。

- `backend/tests/test_subscription_service_auto_save_runtime_boundary.py`
  - 静态断言服务层不再包含自动转存 callback 装配和两个删除的 wrapper。
  - 断言 `_auto_save_resources()` 仍存在并调用无参默认 builder。

- `backend/tests/test_subscription_precise_transfer_status.py`
  - 从服务 wrapper 调用改为直接调用 `apply_precise_transfer_postprocess_status_with_runtime_adapter()`，保持原行为断言。

- `backend/tests/test_subscription_link_fallback_runtime_adapter.py`
  - 更新默认 auto-save helper 测试，断言它调用无参默认 builder。

## 行为保持

必须保持以下行为不变：

- `_auto_save_resources()` 的参数和返回值不变。
- 自动转存仍使用同一批 runtime settings、Pan115、TV missing、postprocess、通知、operation log、时间函数和状态映射。
- Kafka transfer success event 行为不变。
- 精确转存 postprocess 状态转换行为不变。
- Link fallback 触发自动转存时仍走 `auto_save_resources_with_runtime_adapter()`。
- 显式依赖注入测试能力保留。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_runtime_adapter.py::test_default_runtime_dependencies_bind_runtime_helpers_without_service_callbacks -q`
- `scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_explicit_injections -q`
- `scripts/verify-backend.sh -- tests/test_subscription_service_auto_save_runtime_boundary.py -q`

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_service_auto_save_runtime_boundary.py tests/test_subscription_auto_save_resources_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_precise_transfer_status.py tests/test_subscription_link_fallback_runtime_adapter.py tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_transfer_phase_run_flow.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `auto_save_resources_adapter.py` 和 `auto_transfer_batch.py` 的业务逻辑。
- 不删除 `_resolve_subscription_quality_filter()`。
- 不拆固定来源扫描或 run channel 总调度。
- 不改变通知、postprocess 或 Kafka 事件语义。

## 自检

- 设计只移动默认依赖装配，不改变业务语义。
- 显式注入保留，且覆盖 falsy callable 边界。
- 服务层删除项仅限自动转存专用 wrapper。
- 文档内容完整，范围可由一个实施计划完成。
