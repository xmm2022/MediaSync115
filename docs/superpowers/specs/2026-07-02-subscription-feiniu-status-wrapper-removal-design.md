# 订阅 Feiniu Status Wrapper 删除设计

## 背景

`SubscriptionService` 仍保留两个 Feiniu 状态私有 wrapper：

- `_check_feiniu_movie_status()` 只转发到
  `check_feiniu_movie_status_with_runtime_adapter()`。
- `_check_feiniu_tv_missing_status()` 只转发到
  `check_feiniu_tv_missing_status_with_runtime_adapter()`，当前没有生产调用点。

`_check_feiniu_movie_status()` 仍被 service 用于两个默认依赖装配场景：

- `_evaluate_pre_scan_cleanup()` 调用
  `build_default_pre_scan_cleanup_runtime_dependencies()`。
- `cleanup_completed_subscriptions()` 和 `cleanup_single_subscription()` 调用
  `build_default_completed_cleanup_runtime_dependencies()`。

Feiniu 状态 runtime adapter 已经是独立模块。服务层继续保留这些 wrapper，会让
`subscription_service.py` 继续承担下游状态检查默认依赖装配职责。

本块目标是把 movie Feiniu status 的默认绑定下沉到 pre-scan cleanup 和 completed cleanup
runtime adapters，并删除两个 service Feiniu 私有 wrapper 及其 imports。

## 方案比较

推荐方案：让 `build_default_pre_scan_cleanup_runtime_dependencies()` 和
`build_default_completed_cleanup_runtime_dependencies()` 的 `check_feiniu_movie_status`
参数变为可选，未传入时默认绑定
`check_feiniu_movie_status_with_runtime_adapter()`。

优点：

- 保留显式注入能力，现有 flow/unit tests 仍可传 fake movie status callback。
- service 的 pre-scan 和 completed cleanup wrapper 不再知道 Feiniu status runtime adapter。
- 可同时删除 `_check_feiniu_movie_status()`、`_check_feiniu_tv_missing_status()` 和
  Feiniu status imports。
- 行为保持在 runtime adapter 边界内，cleanup/pre-scan core flow 不变。

备选方案一：在 service 中直接传
`check_feiniu_movie_status_with_runtime_adapter`。这能删除私有方法，但默认依赖仍留在服务层。

备选方案二：只删除未使用的 `_check_feiniu_tv_missing_status()`。这能减少死代码，但
`_check_feiniu_movie_status()` 仍会保留服务层默认依赖装配职责。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py`
  - import `check_feiniu_movie_status_with_runtime_adapter`。
  - 将 `build_default_pre_scan_cleanup_runtime_dependencies()` 的
    `check_feiniu_movie_status` 参数改为可选。
  - 未显式传入时默认绑定 Feiniu movie status runtime adapter。
  - 使用 `is not None` 判断，保留 falsy callable 显式注入能力。

- `backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py`
  - import `check_feiniu_movie_status_with_runtime_adapter`。
  - 将 `build_default_completed_cleanup_runtime_dependencies()` 的
    `check_feiniu_movie_status` 参数改为可选。
  - 未显式传入时默认绑定 Feiniu movie status runtime adapter。
  - 使用 `is not None` 判断，保留 falsy callable 显式注入能力。

- `backend/app/services/subscription_service.py`
  - `_evaluate_pre_scan_cleanup()` 不再向 pre-scan 默认 builder 传
    `check_feiniu_movie_status=self._check_feiniu_movie_status`。
  - completed cleanup 两个 public wrapper 不再向 completed cleanup 默认 builder 传
    `check_feiniu_movie_status=self._check_feiniu_movie_status`。
  - 删除 `_check_feiniu_movie_status()` 和 `_check_feiniu_tv_missing_status()`。
  - 移除 Feiniu status runtime adapter imports。

测试文件：

- `backend/tests/test_subscription_pre_scan_cleanup_runtime_adapter.py`
  - 更新默认依赖测试，断言未显式传入时绑定 Feiniu movie status runtime adapter。
  - 新增 falsy callback 显式注入测试。

- `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py`
  - 更新默认依赖测试，断言未显式传入时绑定 Feiniu movie status runtime adapter。
  - 新增 falsy callback 显式注入测试。

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 新增静态测试，断言 service 不再包含 Feiniu status wrapper 和 runtime adapter helper 名称。

## 行为保持

必须保持以下行为不变：

- pre-scan cleanup 和 completed cleanup 仍通过 Feiniu movie status runtime adapter 检查飞牛电影状态。
- 显式注入的 `check_feiniu_movie_status` 仍优先于默认值。
- TV missing status 仍由 cleanup/pre-scan runtime adapter 的 `tv_missing_service.get_tv_missing_status`
  负责，不通过 service 的 Feiniu TV wrapper。
- `cleanup_completed_subscriptions()`、`cleanup_single_subscription()` 和
  `_evaluate_pre_scan_cleanup()` 调用形状不变。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_pre_scan_cleanup_runtime_adapter.py::test_default_runtime_dependencies_bind_existing_services_and_runner tests/test_subscription_pre_scan_cleanup_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_feiniu_movie_status_injection tests/test_subscription_completed_cleanup_runtime_adapter.py::test_default_runtime_dependencies_bind_existing_services_sleep_and_runners tests/test_subscription_completed_cleanup_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_feiniu_movie_status_injection tests/test_subscription_service_dead_wrapper_cleanup.py -q`

实现前预期失败：

- 默认依赖测试会因为 builder 仍要求 `check_feiniu_movie_status` 参数而失败。
- 新 falsy 注入测试在 pre-scan/completed builder 可选逻辑实现前无法覆盖目标行为。
- service 静态测试会发现 Feiniu status wrapper/import 仍存在。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_subscription_completed_cleanup_runtime_adapter.py tests/test_pre_scan_cleanup.py tests/test_completed_cleanup.py tests/test_subscription_service_dead_wrapper_cleanup.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、
`/healthz` 和最终工作区检查。

## 非目标

- 不修改 Feiniu status runtime adapter 行为。
- 不修改 pre-scan cleanup 或 completed cleanup core flow。
- 不删除 `_evaluate_pre_scan_cleanup()`、`_delete_subscription_with_records()`、
  `_create_step_log()` 或 `_create_execution_log()`。
- 不改变任何 public API。

## 自检

- 设计只移动默认依赖装配并删除无业务逻辑 wrapper。
- 显式注入和 falsy callable 边界都有测试覆盖。
- 范围足够小，可由一个实施计划完成。
- 没有占位符、未定项或跨块依赖。
