# 订阅 Fixed Source Scan Wrapper 删除设计

## 背景

`SubscriptionService.run_channel_check()` 仍向
`build_default_run_channel_runtime_dependencies()` 传入
`self._scan_fixed_sources_for_subscription`。该 service 私有方法只做默认依赖装配：

- 调用 `scan_fixed_sources_with_runtime_adapter()`。
- 传入 `build_default_fixed_source_scan_runtime_dependencies(create_step_log=self._create_step_log)`。
- 原样转发 `db`、`run_id`、`channel`、`sub`、`tv_missing_snapshot` 和
  `force_auto_download`。

固定来源扫描 flow 和 runtime adapter 已经位于
`backend/app/services/subscriptions/`。服务层继续保留这层 wrapper，会让
`run_channel_check()` 仍了解固定来源扫描 runtime adapter 的默认依赖细节。

本块目标是让 run channel runtime adapter 自己装配固定来源扫描默认运行时依赖，
并删除 `SubscriptionService._scan_fixed_sources_for_subscription()` 及其 imports。

## 方案比较

推荐方案：在 `run_channel_runtime_adapter.py` 新增
`scan_fixed_sources_for_subscription_with_default_runtime_dependencies()` helper，并让
`build_default_run_channel_runtime_dependencies()` 的
`scan_fixed_sources_for_subscription` 参数变为可选。未显式传入时，默认绑定该 helper。

优点：

- 保留显式注入能力，run channel、item processing 和 transfer phase tests 仍可传
  fake scan callback。
- `SubscriptionService.run_channel_check()` 不再知道 fixed source scan runtime adapter。
- service 可删除 `_scan_fixed_sources_for_subscription()`、
  `scan_fixed_sources_with_runtime_adapter` 和
  `build_default_fixed_source_scan_runtime_dependencies` imports。
- 与 link fallback、resource fetch 和 fixed source policy 默认下沉模式一致。

备选方案一：在 `SubscriptionService.run_channel_check()` 中直接传一个闭包。这样能删除私有方法，
但默认依赖装配仍留在 service 层，不能继续收缩 `subscription_service.py` 职责。

备选方案二：保留 wrapper，等处理 pre-scan cleanup 或 Feiniu status wrapper 时一起删。
当前 fixed source scan wrapper 已经和这些相邻拆分目标没有必要耦合，单独拆分风险更低。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
  - import `scan_fixed_sources_with_runtime_adapter`。
  - import `build_default_fixed_source_scan_runtime_dependencies`。
  - 新增默认 helper：
    `scan_fixed_sources_for_subscription_with_default_runtime_dependencies()`。
  - helper 签名兼容 transfer phase 传入的 callback 参数，内部调用 fixed source scan
    runtime adapter，并用传入的 `create_step_log` 构建默认依赖。
  - `build_default_run_channel_runtime_dependencies()` 的
    `scan_fixed_sources_for_subscription` 参数改为可选。
  - 未显式传入时默认绑定该 helper。
  - 使用 `is not None` 判断默认值，保留 falsy callable 显式注入能力。

- `backend/app/services/subscription_service.py`
  - `run_channel_check()` 调用默认 builder 时不再传
    `scan_fixed_sources_for_subscription=self._scan_fixed_sources_for_subscription`。
  - 删除 `_scan_fixed_sources_for_subscription()`。
  - 移除 fixed source scan runtime adapter imports。

测试文件：

- `backend/tests/test_subscription_run_channel_runtime_adapter.py`
  - 更新 service wrapper 测试，断言 builder 不再收到
    `scan_fixed_sources_for_subscription`。
  - 新增默认依赖测试，断言未显式传入时绑定 run channel runtime module 中的默认 helper。
  - 新增 falsy callable 显式注入测试，断言 falsy callback 不被默认 helper 覆盖。
  - 新增默认 helper 转发测试，确认它构建 fixed source scan runtime dependencies 并调用
    fixed source scan runtime adapter，且参数形状不变。

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 新增静态测试，断言 service 不再包含 fixed source scan wrapper 和 runtime adapter
    helper 名称。

## 行为保持

必须保持以下行为不变：

- 固定来源扫描仍走 `scan_fixed_sources_with_runtime_adapter()`。
- 固定来源扫描默认依赖仍由
  `build_default_fixed_source_scan_runtime_dependencies(create_step_log=...)` 构建。
- `tv_missing_snapshot` 和 `force_auto_download` 的传递形状不变。
- 显式测试注入仍可覆盖 `scan_fixed_sources_for_subscription`。
- `run_channel_check()` public API 和固定来源扫描执行顺序不变。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_fixed_source_scan_default_without_service_callback tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_fixed_source_scan_injection tests/test_subscription_run_channel_runtime_adapter.py::test_default_fixed_source_scan_helper_builds_fixed_source_runtime_dependencies tests/test_subscription_service_dead_wrapper_cleanup.py -q`

实现前预期失败：

- service wrapper 测试会发现 builder 仍收到 `scan_fixed_sources_for_subscription`。
- 新默认依赖测试会因为 builder 仍要求 scan callback 参数而失败。
- 默认 helper 测试会因为 helper 尚不存在而失败。
- service 静态测试会发现 wrapper/import 仍存在。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_fixed_source_scan_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_service_dead_wrapper_cleanup.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、
`/healthz` 和最终工作区检查。

## 非目标

- 不修改 fixed source scan flow、adapter 或 runtime adapter 的业务语义。
- 不修改 fixed source policy。
- 不修改 pre-scan cleanup、completed cleanup、Feiniu status 或删除服务。
- 不改变 run channel public API。

## 自检

- 设计只移动默认依赖装配并删除无业务逻辑 wrapper。
- 显式注入、falsy callable 和 helper 转发边界都有测试覆盖。
- 范围足够小，可由一个实施计划完成。
- 没有占位符、未定项或跨块依赖。
