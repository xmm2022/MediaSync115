# 订阅 Fixed Source Policy Wrapper 删除设计

## 背景

`SubscriptionService` 仍保留 `_should_scan_fixed_sources()` 私有方法。该方法只转发：

```python
return should_scan_fixed_sources_policy(sub, force_auto_download=force_auto_download)
```

当前唯一生产调用是在 `run_channel_check()` 构建
`build_default_run_channel_runtime_dependencies()` 时传入
`should_scan_fixed_sources=self._should_scan_fixed_sources`。

固定来源扫描 policy 已经是纯函数，位于 `fixed_source_scan.py`。服务层无需保留这层转发 wrapper。

本块目标是让 run channel runtime adapter 默认绑定 fixed source policy，并删除
`SubscriptionService._should_scan_fixed_sources()` 及其 import。

## 方案比较

推荐方案：把 `build_default_run_channel_runtime_dependencies()` 的
`should_scan_fixed_sources` 参数改为可选，默认绑定
`fixed_source_scan.should_scan_fixed_sources`。

优点：

- 保留显式注入能力，run channel 和 transfer phase tests 仍可传 fake policy。
- `SubscriptionService.run_channel_check()` 不再传 fixed source policy wrapper。
- service 可删除 `_should_scan_fixed_sources()` 和 policy import。
- 与前几块 run channel 默认依赖下沉模式一致。

备选方案一：在 service 中直接传 `should_scan_fixed_sources_policy`。这能删除私有方法，
但默认依赖仍留在 service 层。

备选方案二：保留 wrapper 等 `_scan_fixed_sources_for_subscription()` 一起处理。当前 policy
wrapper 已经没有必要耦合，单独删除风险更低。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
  - import `should_scan_fixed_sources` from `fixed_source_scan`，可 alias 为
    `should_scan_fixed_sources_policy`。
  - 将 `build_default_run_channel_runtime_dependencies()` 的
    `should_scan_fixed_sources` 参数改为可选。
  - 未显式传入时默认绑定该 policy。
  - 使用 `is not None` 判断，保留 falsy callable 显式注入能力。

- `backend/app/services/subscription_service.py`
  - `run_channel_check()` 不再传 `should_scan_fixed_sources=self._should_scan_fixed_sources`。
  - 删除 `_should_scan_fixed_sources()`。
  - 移除 `should_scan_fixed_sources_policy` import。

测试文件：

- `backend/tests/test_subscription_run_channel_runtime_adapter.py`
  - 更新 service wrapper 测试，断言 builder 不再收到 `should_scan_fixed_sources`。
  - 新增默认 fixed source policy 绑定测试。
  - 新增 falsy policy 显式注入测试。

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 新增静态测试，断言 service 不再包含 `_should_scan_fixed_sources` 和
    `should_scan_fixed_sources_policy`。

## 行为保持

必须保持以下行为不变：

- fixed source 扫描启停判断仍由 `fixed_source_scan.should_scan_fixed_sources()` 完成。
- 显式注入 policy 仍可覆盖默认值。
- `run_channel_check()` public API 和固定来源扫描执行顺序不变。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_fixed_source_policy_default_without_service_callback tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_fixed_source_policy_injection tests/test_subscription_service_dead_wrapper_cleanup.py -q`

实现前预期失败：

- service wrapper 测试会发现 builder 仍收到 `should_scan_fixed_sources`。
- 新默认依赖测试会因为 builder 仍要求 policy 参数而失败。
- service 静态测试会发现 wrapper/import 仍存在。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_service_dead_wrapper_cleanup.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、
`/healthz` 和最终工作区检查。

## 非目标

- 不修改 fixed source policy 规则。
- 不删除 `_scan_fixed_sources_for_subscription()`。
- 不修改固定来源扫描 adapter 或 source service 行为。
- 不处理日志、Feiniu status、cleanup 或 run channel 总调度尾部。

## 自检

- 设计只移动默认 policy 装配并删除无业务逻辑 wrapper。
- 显式注入和 falsy callable 边界都有测试覆盖。
- 范围足够小，可由一个实施计划完成。
- 没有占位符、未定项或跨块依赖。
