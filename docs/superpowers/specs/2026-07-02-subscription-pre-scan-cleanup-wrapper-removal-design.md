# 订阅 Pre-scan Cleanup Wrapper 删除设计

## 背景

`SubscriptionService.run_channel_check()` 仍向
`build_default_run_channel_runtime_dependencies()` 传入
`self._evaluate_pre_scan_cleanup`。该 service 私有方法只负责默认依赖装配：

- 调用 `evaluate_pre_scan_cleanup_with_runtime_adapter()`。
- 传入 `build_default_pre_scan_cleanup_runtime_dependencies()`。
- 绑定 `self._delete_subscription_with_records` 和 `self._create_step_log`。
- 原样转发 `db`、`run_id`、`channel` 和 `sub`。

pre-scan cleanup flow 和 runtime adapter 已经拆出到
`backend/app/services/subscriptions/`。服务层保留这层 wrapper，会让
`run_channel_check()` 继续知道 pre-scan cleanup runtime adapter 的默认依赖细节。

本块目标是让 run channel runtime adapter 自己装配 pre-scan cleanup 默认 callback，并删除
`SubscriptionService._evaluate_pre_scan_cleanup()` 及其 imports。

## 方案比较

推荐方案：在 `run_channel_runtime_adapter.py` 新增
`build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies()` factory，并让
`build_default_run_channel_runtime_dependencies()` 的 `evaluate_pre_scan_cleanup` 参数变为可选。
未显式传入时，factory 使用 `delete_subscription_with_records` 和 `create_step_log` 生成
与 item processing callback 签名兼容的默认 pre-scan cleanup callback。

优点：

- 保留显式注入能力，run channel 和 item processing tests 仍可传 fake cleanup callback。
- `SubscriptionService.run_channel_check()` 不再知道 pre-scan cleanup runtime adapter。
- service 可删除 `_evaluate_pre_scan_cleanup()`、
  `evaluate_pre_scan_cleanup_with_runtime_adapter` 和
  `build_default_pre_scan_cleanup_runtime_dependencies` imports。
- 与 fixed source scan 默认 factory 模式一致。

备选方案一：在 service 中直接传一个闭包。这样能删除私有方法，但默认依赖装配仍留在 service 层。

备选方案二：保留 wrapper，等 `_delete_subscription_with_records()` 和 logging wrappers 一起处理。
当前 pre-scan wrapper 的下沉只需要 run channel runtime adapter 绑定两个已有回调，单独拆分风险更低。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
  - import `evaluate_pre_scan_cleanup_with_runtime_adapter`。
  - import `build_default_pre_scan_cleanup_runtime_dependencies`。
  - 新增默认 callback factory：
    `build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies(delete_subscription_with_records, create_step_log)`。
  - factory 返回的 callback 签名兼容 item processing 传入的参数，内部调用 pre-scan cleanup
    runtime adapter，并用已绑定的 delete/create-step callbacks 构建默认依赖。
  - `build_default_run_channel_runtime_dependencies()` 的 `evaluate_pre_scan_cleanup` 参数改为可选。
  - 未显式传入时默认绑定 factory 返回的 callback。
  - 使用 `is not None` 判断，保留 falsy callable 显式注入能力。

- `backend/app/services/subscription_service.py`
  - `run_channel_check()` 调用默认 builder 时不再传
    `evaluate_pre_scan_cleanup=self._evaluate_pre_scan_cleanup`。
  - 删除 `_evaluate_pre_scan_cleanup()`。
  - 移除 pre-scan cleanup runtime adapter imports。

测试文件：

- `backend/tests/test_subscription_run_channel_runtime_adapter.py`
  - 更新 service wrapper 测试，断言 builder 不再收到 `evaluate_pre_scan_cleanup`。
  - 新增默认依赖测试，断言未显式传入时 builder 使用 run channel runtime module 中的默认
    factory，并把 delete/create-step callbacks 绑定进 cleanup callback。
  - 新增 falsy cleanup callback 显式注入测试。
  - 新增默认 callback 转发测试，确认它构建 pre-scan cleanup runtime dependencies 并调用
    pre-scan cleanup runtime adapter，且参数形状不变。

- `backend/tests/test_pre_scan_cleanup.py`
  - 删除或替换直接调用 `service._evaluate_pre_scan_cleanup()` 的 service wrapper 测试。
  - pre-scan cleanup adapter 本身已有 runtime adapter 测试覆盖默认依赖装配。

- `backend/tests/test_subscription_source_run_integration.py`
  - 将对 `service._evaluate_pre_scan_cleanup` 的 monkeypatch 改为对
    `run_channel_runtime_module.build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies`
    的 monkeypatch，保持 integration 测试仍可控制 pre-scan snapshot。

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 新增静态测试，断言 service 不再包含 pre-scan cleanup wrapper 和 runtime adapter helper 名称。

## 行为保持

必须保持以下行为不变：

- pre-scan cleanup 仍走 `evaluate_pre_scan_cleanup_with_runtime_adapter()`。
- pre-scan cleanup 默认依赖仍由
  `build_default_pre_scan_cleanup_runtime_dependencies()` 构建。
- `delete_subscription_with_records` 和 `create_step_log` 的传递形状不变。
- 显式注入的 `evaluate_pre_scan_cleanup` 仍优先于默认值。
- `run_channel_check()` public API 和 item processing 执行顺序不变。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_pre_scan_cleanup_default_without_service_callback tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_pre_scan_cleanup_injection tests/test_subscription_run_channel_runtime_adapter.py::test_default_pre_scan_cleanup_callback_builds_pre_scan_runtime_dependencies tests/test_subscription_service_dead_wrapper_cleanup.py -q`

实现前预期失败：

- service wrapper 测试会发现 builder 仍收到 `evaluate_pre_scan_cleanup`。
- 新默认依赖测试会因为 builder 仍要求 cleanup callback 参数而失败。
- 默认 callback 测试会因为 factory 尚不存在而失败。
- service 静态测试会发现 wrapper/import 仍存在。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_pre_scan_cleanup.py tests/test_subscription_source_run_integration.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_service_dead_wrapper_cleanup.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、
`/healthz` 和最终工作区检查。

## 非目标

- 不修改 pre-scan cleanup core flow。
- 不删除 `_delete_subscription_with_records()`、`_create_step_log()`、
  `_prune_step_logs()` 或 `_create_execution_log()`。
- 不修改 completed cleanup 或 manual fetch public wrappers。
- 不改变 run channel public API。

## 自检

- 设计只移动默认依赖装配并删除无业务逻辑 wrapper。
- 显式注入、falsy callable 和默认 callback 转发边界都有测试覆盖。
- 范围足够小，可由一个实施计划完成。
- 没有占位符、未定项或跨块依赖。
