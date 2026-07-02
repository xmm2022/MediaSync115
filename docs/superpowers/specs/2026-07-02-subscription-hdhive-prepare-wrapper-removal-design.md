# 订阅 HDHive Prepare Wrapper 删除设计

## 背景

`SubscriptionService._prepare_hdhive_locked_resources()` 现在只做一件事：调用 `prepare_hdhive_locked_resources_with_runtime_adapter(resources, context, traces)`。

生产路径已经不再通过这个服务私有方法装配资源解析依赖：

- `resource_resolver_runtime_adapter.build_default_resource_resolver_runtime_dependencies()` 已默认绑定 `prepare_hdhive_locked_resources_with_runtime_adapter`。
- `run_channel_check()` 已不再传 `_build_hdhive_unlock_context()` 或 `_resolve_source_order()`。
- repo 内对 `_prepare_hdhive_locked_resources()` 的剩余依赖只有一个旧 HDHive 策略测试，以及两个静态边界测试要求它存在。

本块目标是删除这个无生产调用的私有 wrapper，把旧测试改为直接验证 HDHive unlock runtime adapter。

## 方案比较

推荐方案：迁移旧测试到 `prepare_hdhive_locked_resources_with_runtime_adapter()`，然后删除服务 wrapper。

优点：

- 不改变生产行为；生产路径已经使用 runtime adapter 默认依赖。
- 测试更贴近真实边界，覆盖 runtime adapter 的默认依赖绑定。
- 继续收缩 `subscription_service.py`，删除不必要 import 和方法。

备选方案一：保留 wrapper 作为兼容入口。它是私有方法，且当前没有生产调用；保留只会让服务层继续暴露已下沉的 HDHive unlock 运行时细节。

备选方案二：把旧测试迁到纯 `prepare_hdhive_locked_resources()` helper。该 helper 已有独立测试；本轮要验证的是 runtime adapter 入口，因此直接迁到纯 helper 会降低覆盖层级。

## 组件设计

修改文件：

- `backend/tests/test_hdhive_unlock_policy.py`
  - 移除 `SubscriptionService` import。
  - 在旧的 `test_prepare_hdhive_locked_resources_stops_after_first_success()` 中直接调用 `prepare_hdhive_locked_resources_with_runtime_adapter(resources, context, traces)`。
  - 保留对 `runtime_adapter_module.hdhive_service.unlock_resource` 的 monkeypatch，验证默认 runtime dependencies 仍使用现有 HDHive service runner。

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 更新静态边界测试，断言 `_prepare_hdhive_locked_resources` 和 `prepare_hdhive_locked_resources_with_runtime_adapter` 不再出现在 `subscription_service.py`。

- `backend/tests/test_subscription_service_resource_resolver_boundary.py`
  - 更新静态边界测试，断言服务层不再保留 `_prepare_hdhive_locked_resources`。

- `backend/app/services/subscription_service.py`
  - 删除 `prepare_hdhive_locked_resources_with_runtime_adapter` import。
  - 删除 `_prepare_hdhive_locked_resources()` 方法。

## 行为保持

必须保持以下行为不变：

- HDHive locked resource 解锁策略、预算、停止条件和 trace 结构不变。
- `resource_resolver_runtime_adapter` 仍默认使用 `prepare_hdhive_locked_resources_with_runtime_adapter`。
- HDHive unlock runtime adapter 的默认依赖仍绑定 `hdhive_service.unlock_resource`、资源 URL 提取和 HDHive resource normalize helper。
- 不改变 run channel、resource resolver、自动转存、固定来源扫描或 API 行为。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_hdhive_unlock_policy.py::TestHDHiveUnlockPolicy::test_prepare_hdhive_locked_resources_stops_after_first_success tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_resource_resolver_boundary.py -q`

实现前预期失败：

- 静态测试会因为服务层仍保留 `_prepare_hdhive_locked_resources` 而失败。
- 迁移后的 HDHive 策略测试会在实现前继续通过或失败于 import/call 迁移状态；关键红测信号来自服务边界测试。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_hdhive_unlock_policy.py tests/test_subscription_hdhive_unlock_runtime_adapter.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_resource_resolver_boundary.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不修改 HDHive unlock 策略 helper。
- 不修改 resource resolver runtime adapter 默认依赖。
- 不删除 `_check_feiniu_*`、记录 loader、auto-save、fixed source 或日志 wrapper。
- 不改变任何公开 API。

## 自检

- 设计只删除无生产调用的私有 wrapper。
- 测试迁移后仍覆盖 runtime adapter 的默认 runner 绑定。
- 范围足够小，可由一个实施计划完成。
- 没有占位符、未定项或跨块依赖。
