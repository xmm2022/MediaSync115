# 订阅资源抓取 Wrapper 删除设计

## 背景

`SubscriptionService._fetch_resources()` 已经只剩一个薄 wrapper：调用 `fetch_subscription_resources_with_runtime_adapter()` 并装配 `build_default_resource_resolver_runtime_dependencies()`。

前几块已经让 run channel 和手动资源抓取路径自行装配资源解析默认依赖。当前剩余直接调用面：

- `explore_action_queue_service.py` 调用 `subscription_service._fetch_resources()`。
- `test_fetch_resources_waterfall.py` 通过服务 wrapper 覆盖 resource resolver waterfall 行为。
- 若干服务边界测试仍断言 `_fetch_resources()` 保留。

同时，`explore_action_queue_service.py` 还调用了 `subscription_service._extract_resource_url()` 和 `subscription_service._extract_offline_url()`，但这些 helper 已经不在 `subscription_service.py` 中；真实 URL 提取 helper 位于 `subscriptions.resource_candidates`。

本块目标是把 explore 队列和 waterfall 测试迁到 subscriptions helper，删除 `SubscriptionService._fetch_resources()`，并清理服务层 resource resolver 默认依赖 imports。

## 方案比较

推荐方案：在 explore 队列中直接使用现有 runtime/candidate helper：

- `SubscriptionSnapshot` 从 `subscriptions.snapshot` 引入。
- `resolve_source_order_with_runtime_adapter("all")` 替代 `subscription_service._resolve_source_order("all")`。
- `fetch_subscription_resources_with_runtime_adapter()` + `build_default_resource_resolver_runtime_dependencies()` 替代 `subscription_service._fetch_resources()`。
- `extract_resource_url()` 和 `extract_offline_url()` 替代不存在的 service 私有 URL helper。

优点：

- 删除 `_fetch_resources()` 不需要新增转发层。
- explore 队列不再依赖 `SubscriptionService` 私有实现。
- waterfall 测试继续覆盖 resource resolver runtime adapter 的真实默认依赖装配。
- 行为与当前 `_fetch_resources()` wrapper 等价。

备选方案一：新增 `resource_resolver_runtime_adapter.fetch_resources_with_default_runtime_dependencies()` 并复用。当前 run channel 和 manual fetch 已各自有调用形状适配 helper；再新增全局 helper会增加一个非常薄的别名，本块没有必要。

备选方案二：保留 `_fetch_resources()`，只修复 explore 的 URL helper。这不能继续收缩 `subscription_service.py`。

## 组件设计

修改文件：

- `backend/app/services/explore_action_queue_service.py`
  - 顶部 import：
    - `SubscriptionSnapshot` from `app.services.subscriptions.snapshot`
    - `extract_resource_url`, `extract_offline_url` from `app.services.subscriptions.resource_candidates`
    - `resolve_source_order_with_runtime_adapter`
    - `build_default_resource_resolver_runtime_dependencies`
    - `fetch_subscription_resources_with_runtime_adapter`
  - `_execute_save()` 中不再 import `subscription_service`。
  - `source_order` 由 `resolve_source_order_with_runtime_adapter("all")` 得到。
  - 每个 source 调用 `fetch_subscription_resources_with_runtime_adapter()`，传入默认 resource resolver dependencies 和 `source_order=[source]`。
  - URL 提取改为 `extract_resource_url(resource)` 和 `extract_offline_url(resource)`。

- `backend/app/services/subscription_service.py`
  - 删除 `_fetch_resources()`。
  - 移除 `build_default_resource_resolver_runtime_dependencies` 和 `fetch_subscription_resources_with_runtime_adapter` imports。

测试文件：

- `backend/tests/test_fetch_resources_waterfall.py`
  - 从 `subscriptions.snapshot` 引入 `SubscriptionSnapshot`。
  - 不再实例化 `SubscriptionService`。
  - 两个 service wrapper 测试改为直接调用 `resolver_runtime_module.fetch_subscription_resources_with_runtime_adapter()`，并传入 `resolver_runtime_module.build_default_resource_resolver_runtime_dependencies()`。

- `backend/tests/test_subscription_service_resource_resolver_boundary.py`
  - 更新断言：服务层不再包含 `_fetch_resources()` 和 resource resolver 默认 runtime imports。
  - 保留 HDHive wrapper 保留断言。

- `backend/tests/test_subscription_service_run_channel_resource_io_boundary.py`
  - 更新断言：`_fetch_resources()` 已删除。

- `backend/tests/test_subscription_service_manual_fetch_runtime_boundary.py`
  - 更新断言：`_fetch_resources()` 已删除。

- `backend/tests/test_explore_action_queue_resource_boundary.py`
  - 新增静态边界测试，断言 explore 队列不再调用 `subscription_service._fetch_resources`、`subscription_service._extract_resource_url`、`subscription_service._extract_offline_url`。
  - 断言 explore 队列引用 resource resolver runtime helper 和 resource candidate helper。

## 行为保持

必须保持以下行为不变：

- explore 保存动作的 route 解析、snapshot 字段、source order 语义不变。
- 每个 source 仍单独尝试一次，`source_attempts` 仍从 `meta["attempts"]` 累积。
- 分享转存和离线下载分支的成功/失败返回结构不变。
- waterfall 行为仍由 resource resolver runtime adapter 覆盖。
- run channel 和手动资源抓取行为不变。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_explore_action_queue_resource_boundary.py -q`
- `scripts/verify-backend.sh -- tests/test_subscription_service_resource_resolver_boundary.py tests/test_subscription_service_run_channel_resource_io_boundary.py tests/test_subscription_service_manual_fetch_runtime_boundary.py -q`

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_explore_action_queue_resource_boundary.py tests/test_fetch_resources_waterfall.py tests/test_subscription_service_resource_resolver_boundary.py tests/test_subscription_service_run_channel_resource_io_boundary.py tests/test_subscription_service_manual_fetch_runtime_boundary.py tests/test_subscription_manual_resource_fetch_runtime_adapter.py tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_resource_resolver_runtime_adapter.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 resource resolver、resource fetcher 或 resource storage 业务语义。
- 不改 explore 队列的转存、离线下载、postprocess 或返回结构。
- 不拆 `_resolve_source_order()`，因为 run start 仍通过服务层 wrapper 注入它。
- 不拆 HDHive unlock wrapper。

## 自检

- 删除项只限已经没有必要的 `_fetch_resources()` wrapper。
- explore 队列迁移使用现有 helper，不新增业务分支。
- waterfall 覆盖迁移到真实 runtime adapter，保留行为验证。
- 边界测试会阻止服务私有资源 wrapper 再次被引用。
