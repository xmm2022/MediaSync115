# 订阅质量过滤 Wrapper 删除设计

## 背景

`SubscriptionService` 仍保留 `_resolve_subscription_quality_filter()` 私有方法。该方法只转发：

```python
return resolve_subscription_quality_filter_with_runtime_adapter(sub)
```

当前有两个调用面：

- `SubscriptionService._scan_fixed_sources_for_subscription()` 在构建
  `build_default_fixed_source_scan_runtime_dependencies()` 时显式传入该 wrapper。
- `backend/app/api/subscriptions.py` 的手动固定来源扫描接口直接调用
  `subscription_service._resolve_subscription_quality_filter(snapshot)`。

质量过滤默认依赖已经属于 `runtime_preferences_adapter`，继续通过 service 私有 wrapper 暴露会保留不必要的反向依赖，也让 API 直接依赖 service 私有方法。

本块目标是让 fixed source runtime adapter 自己默认绑定质量过滤 helper，并让 API 直接调用 runtime preferences adapter，最终删除 service 中的质量过滤 wrapper。

## 方案比较

推荐方案：把 `build_default_fixed_source_scan_runtime_dependencies()` 的
`resolve_quality_filter` 参数改为可选，默认绑定
`resolve_subscription_quality_filter_with_runtime_adapter`；API 直接 import 并调用该 runtime helper。

优点：

- 保留 fixed source tests 的显式注入能力。
- service 不再 import runtime preferences adapter。
- API 不再调用 service 私有方法。
- 与 auto-save/resource resolver runtime adapter 的默认依赖模式一致。

备选方案一：只把 API 改为直接调用 runtime helper，service 内 fixed source 仍传 wrapper。这样能去掉 API 私有调用，但无法删除 service wrapper。

备选方案二：把质量过滤逻辑复制到 API 或 fixed source runtime adapter。这样会重复业务规则，后续设置语义变更时容易分叉。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py`
  - import `resolve_subscription_quality_filter_with_runtime_adapter`。
  - 将 `build_default_fixed_source_scan_runtime_dependencies()` 的
    `resolve_quality_filter` 参数改为可选。
  - 未显式传入时默认绑定 runtime preferences helper。
  - 使用 `is not None` 判断，保留 falsy callable 显式注入能力。

- `backend/app/services/subscription_service.py`
  - `_scan_fixed_sources_for_subscription()` 调用默认 builder 时不再传
    `resolve_quality_filter=self._resolve_subscription_quality_filter`。
  - 删除 `_resolve_subscription_quality_filter()`。
  - 移除 `resolve_subscription_quality_filter_with_runtime_adapter` import。

- `backend/app/api/subscriptions.py`
  - import `resolve_subscription_quality_filter_with_runtime_adapter`。
  - 手动固定来源扫描接口改为
    `quality_filter=resolve_subscription_quality_filter_with_runtime_adapter(snapshot)`。
  - 保持其它参数和事务行为不变。

测试文件：

- `backend/tests/test_subscription_fixed_source_scan_runtime_adapter.py`
  - 更新默认依赖测试，断言未显式传入时绑定 runtime preferences helper。
  - 新增 falsy callable 显式注入测试。

- `backend/tests/test_subscription_run_channel_runtime_adapter.py`
  - service wrapper 测试仍应期望 `scan_fixed_sources_for_subscription`，但不需要额外传质量过滤 wrapper。

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 新增静态测试，断言 `_resolve_subscription_quality_filter` 和
    `resolve_subscription_quality_filter_with_runtime_adapter` 不再出现在
    `subscription_service.py`。

- `backend/tests/test_subscription_source_api.py` 或新增/扩展现有 API 边界测试
  - 静态断言 `backend/app/api/subscriptions.py` 不再包含
    `subscription_service._resolve_subscription_quality_filter`。
  - 断言 API 文件包含 `resolve_subscription_quality_filter_with_runtime_adapter`。

## 行为保持

必须保持以下行为不变：

- 质量过滤计算仍由 `resolve_subscription_quality_filter_with_runtime_adapter()` 完成。
- fixed source 显式注入测试仍可覆盖 `resolve_quality_filter`。
- 手动固定来源扫描接口的事务、错误处理、返回结构和 scan 参数不变。
- `SubscriptionService.run_channel_check()` public API 不变。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_fixed_source_scan_runtime_adapter.py::test_default_runtime_dependencies_bind_existing_runtime_services tests/test_subscription_fixed_source_scan_runtime_adapter.py::test_default_runtime_dependencies_bind_quality_filter_default_without_service_callback tests/test_subscription_fixed_source_scan_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_quality_filter_injection tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_source_api.py::test_subscription_source_api_does_not_call_service_quality_filter_wrapper -q`

实现前预期失败：

- 新默认依赖测试会因为 builder 仍要求 `resolve_quality_filter` 而失败。
- falsy 注入测试在参数改为可选前无法验证。
- service 静态测试会发现 wrapper/import 仍存在。
- API 静态测试会发现仍调用 service 私有方法。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_fixed_source_scan_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_source_api.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_run_channel_runtime_adapter.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、
`/healthz` 和最终工作区检查。

## 非目标

- 不修改质量过滤规则。
- 不修改 runtime settings 读取逻辑。
- 不修改 fixed source 扫描业务语义。
- 不处理 Feiniu status、step log、pre-scan cleanup 或 run channel 总调度尾巴。

## 自检

- 设计只移动默认依赖装配并删除 service 转发 wrapper。
- API 私有 service 调用被替换为直接 runtime helper。
- 显式注入和 falsy callable 边界都有测试覆盖。
- 没有占位符、未定项或跨块依赖。
