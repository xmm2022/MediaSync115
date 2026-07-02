# 订阅 Link Fallback Wrapper 删除设计

## 背景

`SubscriptionService.run_channel_check()` 仍向
`build_default_run_channel_runtime_dependencies()` 传入
`self._auto_save_records_with_link_fallback`。该 service 私有方法已经只做一件事：

- 调用 `auto_save_records_with_link_fallback_with_runtime_adapter()`。
- 传入 `build_default_link_fallback_runtime_dependencies()`。
- 原样转发 `db`、`run_id`、`channel`、`sub`、`records`、`transfer_source`、
  `tv_missing_snapshot`、`hdhive_unlock_context`、`source_order` 和
  `enable_link_refetch`。

link fallback flow、adapter 和 runtime adapter 已经拆出到
`backend/app/services/subscriptions/`，服务层不再需要保留这层无业务逻辑的
callback wrapper。

本块目标是让 run channel runtime adapter 自己装配 link fallback 默认运行时依赖，
并删除 `SubscriptionService._auto_save_records_with_link_fallback()` 及其 imports。

## 方案比较

推荐方案：在 `run_channel_runtime_adapter.py` 新增
`auto_save_records_with_link_fallback_with_default_runtime_dependencies()` helper，
并让 `build_default_run_channel_runtime_dependencies()` 的
`auto_save_records_with_link_fallback` 参数变为可选。未显式传入时，默认绑定该
helper。

优点：

- 保留显式注入能力，run channel / item processing tests 仍可传 fake callback。
- `SubscriptionService.run_channel_check()` 不再知道 link fallback runtime adapter。
- service 可删除 `_auto_save_records_with_link_fallback()`、对应 runtime adapter import
  和默认依赖 builder import。
- 与前几块 run channel 默认依赖下沉模式一致。

备选方案一：在 `SubscriptionService.run_channel_check()` 中直接传
`auto_save_records_with_link_fallback_with_runtime_adapter` 和默认依赖闭包。这样能删私有方法，
但默认装配仍留在服务层，无法继续收缩 `subscription_service.py` 职责。

备选方案二：保留 wrapper，等 `_auto_save_resources()` 一起处理。这样短期改动最小，
但当前 wrapper 已经和 `_auto_save_resources()` 没有必要的耦合，继续保留会拖慢服务层收敛。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
  - import `auto_save_records_with_link_fallback_with_runtime_adapter`。
  - import `build_default_link_fallback_runtime_dependencies`。
  - 新增默认 helper：
    `auto_save_records_with_link_fallback_with_default_runtime_dependencies()`。
  - helper 签名兼容 run transfer phase 传入的 callback 参数，内部调用 link fallback
    runtime adapter 并传入默认依赖。
  - `build_default_run_channel_runtime_dependencies()` 的
    `auto_save_records_with_link_fallback` 参数改为可选。
  - 使用 `is not None` 判断默认值，保留 falsy callable 显式注入能力。

- `backend/app/services/subscription_service.py`
  - `run_channel_check()` 调用默认 builder 时不再传
    `auto_save_records_with_link_fallback=self._auto_save_records_with_link_fallback`。
  - 删除 `_auto_save_records_with_link_fallback()`。
  - 移除 `auto_save_records_with_link_fallback_with_runtime_adapter` 和
    `build_default_link_fallback_runtime_dependencies` imports。

测试文件：

- `backend/tests/test_subscription_run_channel_runtime_adapter.py`
  - 更新 service wrapper 测试，断言 builder 不再收到
    `auto_save_records_with_link_fallback`。
  - 新增默认依赖测试，断言未显式传入时绑定 run channel runtime module 中的默认 helper。
  - 新增 falsy callable 显式注入测试，断言 falsy callback 不被默认 helper 覆盖。
  - 新增默认 helper 转发测试，确认它构建 link fallback 默认依赖并调用 link fallback
    runtime adapter，且参数形状不变。

- `backend/tests/test_subscription_service_link_fallback_runtime_boundary.py`
  - 更新边界测试，断言服务层不再包含 link fallback runtime adapter import、默认依赖 builder
    import 和 `_auto_save_records_with_link_fallback()`。

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 扩展死 wrapper 测试，覆盖 `_auto_save_records_with_link_fallback` 和 link fallback
    runtime adapter helper 名称。

## 行为保持

必须保持以下行为不变：

- link fallback 执行仍走
  `auto_save_records_with_link_fallback_with_runtime_adapter()`。
- link fallback 默认依赖仍由
  `build_default_link_fallback_runtime_dependencies()` 构建。
- `enable_link_refetch`、`source_order`、`hdhive_unlock_context`、
  `tv_missing_snapshot`、`transfer_source` 的传递形状不变。
- 显式测试注入仍可覆盖 `auto_save_records_with_link_fallback`。
- `_auto_save_resources()` 保留，单独作为下一块拆分目标。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_link_fallback_default_without_service_callback tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_link_fallback_injection tests/test_subscription_run_channel_runtime_adapter.py::test_default_link_fallback_helper_builds_link_fallback_runtime_dependencies tests/test_subscription_service_link_fallback_runtime_boundary.py tests/test_subscription_service_dead_wrapper_cleanup.py -q`

实现前预期失败：

- service wrapper 测试会发现 builder 仍收到
  `auto_save_records_with_link_fallback`。
- 新默认依赖测试会因为 builder 仍要求必填 callback 而失败。
- 默认 helper 测试会因为 helper 尚不存在而失败。
- 静态边界测试会发现服务层仍保留 link fallback wrapper/import。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_service_link_fallback_runtime_boundary.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_link_fallback_runtime_adapter.py tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、
`/healthz` 和最终工作区检查。

## 非目标

- 不修改 link fallback flow、adapter 或 runtime adapter 的业务语义。
- 不修改 `_auto_save_resources()`。
- 不改资源抓取、资源入库、retry record 或 fixed source flow。
- 不改变 run channel public API。

## 自检

- 设计只移动默认依赖装配并删除无业务逻辑 wrapper。
- 显式注入和 falsy callable 边界都有测试覆盖。
- 范围可由一个实施计划完成。
- 没有占位符、未定项或跨块依赖。
