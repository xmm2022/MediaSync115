# 订阅手动资源抓取默认依赖装配设计

## 背景

`manual_resource_fetch_runtime_adapter.py` 已经承接 `SubscriptionService.fetch_resources_for_media()` 的手动资源抓取适配层，但默认依赖 builder 仍要求服务层传入 `fetch_resources` callback：

```python
build_default_manual_resource_fetch_runtime_dependencies(
    fetch_resources=self._fetch_resources,
)
```

`_fetch_resources()` 本身只是调用 `fetch_subscription_resources_with_runtime_adapter()` 并装配 `build_default_resource_resolver_runtime_dependencies()` 的薄 wrapper。前一块已经让 run channel 自己装配同类默认资源抓取 helper，本块继续把手动资源抓取路径也改为 runtime adapter 自装配。

`_fetch_resources()` 目前还被 `explore_action_queue_service` 和 waterfall 兼容测试直接使用，因此本块不删除 `_fetch_resources()`。

## 方案比较

推荐方案：扩展 `build_default_manual_resource_fetch_runtime_dependencies()`，把 `fetch_resources` 参数改为可选；未传入时绑定一个新的 `fetch_resources_with_default_runtime_dependencies()` helper。

优点：

- `fetch_resources_for_media()` 不再传服务私有 wrapper。
- 保留显式注入能力，现有 adapter 测试仍可传 fake callback。
- 默认资源抓取路径继续使用同一套 resource resolver runtime adapter。
- 与 run channel 资源 IO 默认装配模式一致。

备选方案一：直接让 `fetch_resources_for_media()` 调用 `fetch_subscription_resources_with_runtime_adapter()`。这会把 snapshot 构建和 resource resolver 默认装配混在服务层，违背本次拆分方向。

备选方案二：同步迁移 explore 队列并删除 `_fetch_resources()`。这会扩大范围，且 explore 队列还依赖其它服务私有 helper，适合后续单独处理。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/manual_resource_fetch_runtime_adapter.py`
  - import：
    - `build_default_resource_resolver_runtime_dependencies`
    - `fetch_subscription_resources_with_runtime_adapter`
  - 新增 `fetch_resources_with_default_runtime_dependencies(channel, sub)` helper。
  - `build_default_manual_resource_fetch_runtime_dependencies()` 的 `fetch_resources` 参数改为可选。
  - 默认值使用 `fetch_resources if fetch_resources is not None else fetch_resources_with_default_runtime_dependencies`，保留 falsy callable 显式注入。

- `backend/app/services/subscription_service.py`
  - `fetch_resources_for_media()` 调用 `build_default_manual_resource_fetch_runtime_dependencies()` 时不再传 `fetch_resources=self._fetch_resources`。
  - 保留 `_fetch_resources()` 和 resource resolver imports。

测试文件：

- `backend/tests/test_subscription_manual_resource_fetch_runtime_adapter.py`
  - 更新默认 builder 测试，新增无参默认绑定断言。
  - 新增 falsy callable 显式注入保留测试。
  - 新增默认 fetch helper 测试，断言它构建 resource resolver 默认依赖并调用 runtime adapter。
  - 更新 service wrapper 测试，断言 service 不再向 builder 传 `fetch_resources`。

- `backend/tests/test_subscription_service_manual_fetch_runtime_boundary.py`
  - 静态断言 `fetch_resources_for_media()` 的 builder 调用不再包含 `fetch_resources=self._fetch_resources`。
  - 静态断言 `_fetch_resources()` 仍保留。

## 行为保持

必须保持以下行为不变：

- `fetch_resources_for_media()` 的 public API、参数、返回值不变。
- 手动资源抓取构建的 `SubscriptionSnapshot` 字段不变。
- 默认资源抓取仍走 resource resolver runtime adapter 和其默认依赖。
- 显式依赖注入测试能力保留。
- `_fetch_resources()` 继续可用，供 explore 队列和现有兼容测试使用。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py::test_default_dependencies_bind_runtime_fetch_helper_without_service_callback -q`
- `scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py::test_default_fetch_helper_builds_resource_resolver_runtime_dependencies -q`
- `scripts/verify-backend.sh -- tests/test_subscription_service_manual_fetch_runtime_boundary.py -q`

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_manual_resource_fetch_runtime_adapter.py tests/test_subscription_service_manual_fetch_runtime_boundary.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_run_channel_runtime_adapter.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不删除 `_fetch_resources()`。
- 不改 explore 队列。
- 不改 resource resolver、resource fetcher 或 resource storage 业务语义。
- 不改 API 层 `fetch_resources_for_media()` 调用。

## 自检

- 范围只覆盖手动资源抓取默认依赖装配。
- 服务层仅减少 callback 传递，不改变 public 方法行为。
- `_fetch_resources()` 保留，避免影响仍存在的调用面。
- 显式注入和 falsy callable 边界纳入测试。
