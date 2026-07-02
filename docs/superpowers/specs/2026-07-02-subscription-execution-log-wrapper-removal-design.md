# 订阅 Execution Log Wrapper 删除设计

## 背景

`SubscriptionService.run_channel_check()` 仍向
`build_default_run_channel_runtime_dependencies()` 传入三个 service 私有日志
wrapper：

- `self._create_execution_log`
- `self._create_step_log`
- `self._prune_step_logs`

这些 wrapper 只把参数原样转发到
`backend/app/services/subscriptions/execution_logs.py` 中的纯日志 helper。
日志 helper 已经有独立测试覆盖序列化、截断和保留数量策略。service 层继续保留
wrapper，会让 `SubscriptionService` 仍承担 run channel 默认 runtime 依赖装配细节。

本块目标是把执行日志默认 callback 绑定下沉到
`run_channel_runtime_adapter.py`，删除 service 里的三个日志 wrapper 和对应 imports。

## 方案比较

推荐方案：让 `build_default_run_channel_runtime_dependencies()` 的
`create_execution_log`、`create_step_log` 和 `prune_step_logs` 参数变为可选。
未显式传入时，默认使用 `execution_logs.py` 中的
`create_execution_log`、`create_step_log` 和 `prune_step_logs`。

优点：

- 保留测试和特殊调用方的显式注入能力。
- 使用 `is not None` 判断，保留 falsy callable 的显式注入行为。
- `SubscriptionService.run_channel_check()` 不再引用日志 wrapper。
- 与已完成的资源抓取、自动转存、固定来源扫描和 pre-scan cleanup 默认依赖下沉模式一致。

备选方案一：在 service 层传入从日志模块 import 的函数。这样能删除私有方法，但
service 仍负责 run channel 日志默认依赖装配，不符合拆分目标。

备选方案二：同时删除 `_delete_subscription_with_records()`。删除订阅 callback 同时被
run channel、pre-scan cleanup 和 completed cleanup 使用，依赖传播范围更大。将它单独作为
下一块处理，能降低本块风险。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
  - import `create_execution_log`、`create_step_log` 和 `prune_step_logs`，使用别名避免和参数同名混淆。
  - 将 `build_default_run_channel_runtime_dependencies()` 的
    `create_execution_log`、`create_step_log`、`prune_step_logs` 改为可选参数，默认值为
    `None`。
  - 构建 `RunChannelRuntimeDependencies` 时，未显式传入则使用日志模块 helper。
  - 需要把 resolved `create_step_log` 保存为局部变量，再用于：
    - dataclass 字段 `create_step_log`
    - pre-scan cleanup 默认 factory
    - fixed source scan 默认 factory
  - 保持显式注入优先级和 callable 传递签名不变。

- `backend/app/services/subscription_service.py`
  - `run_channel_check()` 调用默认 builder 时不再传
    `create_execution_log`、`create_step_log`、`prune_step_logs`。
  - 删除 `_create_execution_log()`、`_create_step_log()` 和 `_prune_step_logs()`。
  - 移除 `ExecutionStatus`、`datetime` 和日志 helper imports。

测试文件：

- `backend/tests/test_subscription_run_channel_runtime_adapter.py`
  - 更新 service wrapper 测试，断言 builder 不再收到三个日志 callback。
  - 新增默认依赖测试，断言未显式传入时 runtime dependencies 使用日志模块 helper。
  - 新增默认日志 callback 会绑定进 pre-scan cleanup factory 的测试。
  - 新增默认日志 callback 会绑定进 fixed source scan factory 的测试。
  - 新增 falsy 日志 callback 显式注入测试。

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 新增静态测试，断言 service 不再包含三个日志 wrapper 和日志 helper import 别名。

## 行为保持

必须保持以下行为不变：

- run channel 流程仍写 execution log、step log，并按原逻辑 prune step logs。
- `execution_logs.py` 中的序列化、截断和保留数量策略不变。
- 显式注入的日志 callback 仍优先于默认 helper。
- pre-scan cleanup 和 fixed source scan 默认 factory 仍获得同一个 create-step callback。
- `run_channel_check()` public API、并发数和执行顺序不变。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_execution_log_defaults_without_service_callbacks tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_pass_default_step_log_to_pre_scan_cleanup_factory tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_pass_default_step_log_to_fixed_source_scan_factory tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_execution_log_injections tests/test_subscription_service_dead_wrapper_cleanup.py -q`

实现前预期失败：

- service wrapper 测试会发现 builder 仍收到三个日志 callback。
- 新默认依赖测试会因为 builder 仍要求日志 callback 参数而失败。
- factory 绑定测试会发现默认 builder 不能自行提供 create-step callback。
- service 静态测试会发现 wrapper/import 仍存在。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_execution_logs.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_subscription_fixed_source_scan_runtime_adapter.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、
`/healthz` 和最终工作区检查。

## 非目标

- 不修改 `execution_logs.py` 的业务逻辑。
- 不删除 `_delete_subscription_with_records()`。
- 不修改 completed cleanup 或 manual fetch public wrapper。
- 不改变 run channel public API。

## 自检

- 设计只移动默认依赖装配并删除无业务逻辑 wrapper。
- 显式注入、falsy callable 和默认 callback 传播都有测试覆盖。
- 范围足够小，可由一个实施计划完成。
- 没有占位符、未定项或跨块依赖。
