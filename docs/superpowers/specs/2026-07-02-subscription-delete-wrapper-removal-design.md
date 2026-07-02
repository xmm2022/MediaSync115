# 订阅 Delete Wrapper 删除设计

## 背景

`SubscriptionService` 当前仍保留 `_delete_subscription_with_records()`：

- 接收 `db` 和单个 `subscription_id`。
- 调用 `subscription_delete_service.delete_local_subscriptions(db, [subscription_id])`。
- 被 `run_channel_check()`、`cleanup_completed_subscriptions()` 和
  `cleanup_single_subscription()` 传入各自 runtime dependencies builder。

删除订阅的真实逻辑已经集中在 `app.services.subscription_delete_service`。
service 层这层 wrapper 只做单 id 到列表的形状适配。继续保留它，会让
`SubscriptionService` 仍知道 run channel、pre-scan cleanup 和 completed cleanup 的默认
删除 callback 装配细节。

本块目标是提供一个可复用的默认删除 callback helper，并让相关 runtime adapter 自行绑定它，
从而删除 `SubscriptionService._delete_subscription_with_records()` 和
`subscription_delete_service` import。

## 方案比较

推荐方案：在 `subscription_delete_service.py` 中新增
`delete_subscription_with_records_with_default_service(db, subscription_id)` helper。
该 helper 调用已有 `subscription_delete_service.delete_local_subscriptions(db, [subscription_id])`。
随后让以下 builder 的 `delete_subscription_with_records` 参数变为可选：

- `build_default_run_channel_runtime_dependencies()`
- `build_default_completed_cleanup_runtime_dependencies()`

未显式传入时，两个 builder 都使用该 helper。

优点：

- 单 id 到列表的适配逻辑只有一份。
- run channel、pre-scan cleanup 和 completed cleanup 默认依赖可以共享同一个 callback。
- 保留显式注入能力，测试仍可传 fake delete callback。
- 使用 `is not None` 判断，保留 falsy callable 显式注入行为。
- `SubscriptionService` 不再知道删除服务默认装配细节。

备选方案一：在两个 runtime adapter 中各自定义一个默认删除 callback。这样不需要修改
`subscription_delete_service.py`，但会复制单 id 到列表的适配逻辑。

备选方案二：继续让 service 传 `subscription_delete_service.delete_local_subscriptions`。
这会改变 callback 签名，因为下游传的是单个 `subscription_id`，不是 id 列表。

## 组件设计

修改文件：

- `backend/app/services/subscription_delete_service.py`
  - 新增 async helper：
    `delete_subscription_with_records_with_default_service(db, subscription_id)`。
  - helper 调用 `subscription_delete_service.delete_local_subscriptions(db, [subscription_id])`。
  - 不改变 `SubscriptionDeleteService.delete_local_subscriptions()` 的行为。

- `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
  - import `delete_subscription_with_records_with_default_service`。
  - `build_default_run_channel_runtime_dependencies()` 的
    `delete_subscription_with_records` 参数改为可选。
  - 解析 `resolved_delete_subscription_with_records` 局部变量。
  - dataclass 字段和 pre-scan cleanup 默认 factory 都使用 resolved callback。

- `backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py`
  - import `delete_subscription_with_records_with_default_service`。
  - `build_default_completed_cleanup_runtime_dependencies()` 的
    `delete_subscription_with_records` 参数改为可选。
  - dataclass 字段使用 resolved callback。

- `backend/app/services/subscription_service.py`
  - `run_channel_check()` 不再传 `delete_subscription_with_records`。
  - `cleanup_completed_subscriptions()` 和 `cleanup_single_subscription()` 不再传
    `delete_subscription_with_records`。
  - 删除 `_delete_subscription_with_records()`。
  - 移除 `subscription_delete_service` import。

测试文件：

- `backend/tests/test_subscription_delete_service.py`
  - 新增 helper 测试，monkeypatch `subscription_delete_service.delete_local_subscriptions`，
    断言 helper 传入 `[subscription_id]` 并返回底层结果。

- `backend/tests/test_subscription_run_channel_runtime_adapter.py`
  - 更新 service wrapper 测试，断言 builder 不再收到
    `delete_subscription_with_records`。
  - 新增默认删除 callback 测试，断言未显式传入时使用默认 helper。
  - 新增 pre-scan cleanup factory 测试，断言默认 delete callback 传给 factory。
  - 新增 falsy delete callback 显式注入测试。

- `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py`
  - 更新默认依赖测试，断言未显式传入时使用默认 helper。
  - 新增 falsy delete callback 显式注入测试。

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 新增静态测试，断言 service 不再包含 delete wrapper 和删除服务 import。

- `backend/tests/test_subscription_service_run_channel_resource_io_boundary.py`
  - 将 run_channel 片段结束锚点从 `_delete_subscription_with_records` 改为仍存在的
    `cleanup_completed_subscriptions`。

## 行为保持

必须保持以下行为不变：

- 删除订阅仍通过 `subscription_delete_service.delete_local_subscriptions()` 执行。
- 下游 callback 仍接收 `db` 和单个 `subscription_id`。
- helper 仍把单个 id 包装为单元素列表。
- 显式注入的 delete callback 仍优先于默认 helper。
- run channel、pre-scan cleanup、completed cleanup 的 public API 和执行顺序不变。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_delete_default_without_service_callback tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_pass_default_delete_to_pre_scan_cleanup_factory tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_delete_injection tests/test_subscription_completed_cleanup_runtime_adapter.py::test_default_runtime_dependencies_bind_existing_services_sleep_and_runners tests/test_subscription_completed_cleanup_runtime_adapter.py::test_default_runtime_dependencies_preserve_falsy_delete_injection tests/test_subscription_delete_service.py::test_delete_subscription_with_records_helper_wraps_single_id tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_run_channel_resource_io_boundary.py::test_run_channel_drops_resource_io_callback_assembly -q`

实现前预期失败：

- service wrapper 测试会发现 builder 仍收到 delete callback。
- 默认 delete 测试会发现 builder 仍要求显式 delete callback。
- helper 测试会因为 helper 尚不存在而失败。
- service 静态测试会发现 wrapper/import 仍存在。
- resource IO 边界测试会因为锚点仍指向即将删除的方法而失败。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_completed_cleanup_runtime_adapter.py tests/test_subscription_delete_service.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_run_channel_resource_io_boundary.py tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_completed_cleanup.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、
`/healthz` 和最终工作区检查。

## 非目标

- 不修改 `SubscriptionDeleteService.delete_local_subscriptions()` 的删除范围或事务语义。
- 不删除 `cleanup_completed_subscriptions()`、`cleanup_single_subscription()` 或
  `fetch_resources_for_media()` public wrapper。
- 不改变 API 层删除逻辑。

## 自检

- 设计只删除无业务逻辑的 service 私有 wrapper。
- 默认 helper、builder 默认值、falsy 显式注入和 service 静态边界都有测试覆盖。
- 范围足够小，可由一个实施计划完成。
- 没有占位符、未定项或跨块依赖。
