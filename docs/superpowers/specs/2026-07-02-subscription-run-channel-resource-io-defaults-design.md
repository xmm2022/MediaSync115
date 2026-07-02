# 订阅 Run Channel 资源 IO 默认依赖装配设计

## 背景

`subscription_service.py` 已经把资源解析和资源入库主体逻辑下沉到 runtime adapter：

- `resource_resolver_runtime_adapter.fetch_subscription_resources_with_runtime_adapter`
- `resource_resolver_runtime_adapter.build_default_resource_resolver_runtime_dependencies`
- `resource_storage_runtime_adapter.store_new_resources_with_runtime_adapter`

但 `run_channel_check()` 仍在调用 `build_default_run_channel_runtime_dependencies()` 时传入两个服务层 wrapper：

- `fetch_resources=self._fetch_resources`
- `store_new_resources=self._store_new_resources`

其中 `_store_new_resources()` 只剩 run channel 默认依赖装配使用。`_fetch_resources()` 仍被手动资源抓取和 explore 队列路径引用，不能在本块直接删除。

本块目标是让 run channel 默认依赖 builder 自己绑定资源抓取和资源入库 runtime adapter，减少 `SubscriptionService.run_channel_check()` 的 callback 传递，并删除只为 run channel 存在的 `_store_new_resources()`。

## 方案比较

推荐方案：扩展 `build_default_run_channel_runtime_dependencies()`，把 `fetch_resources` 和 `store_new_resources` 参数改为可选；未传入时默认绑定现有 runtime adapter helper。

优点：

- 保留显式注入能力，现有 run channel adapter 测试仍可传 fake callback。
- `run_channel_check()` 不再负责资源 IO 默认依赖装配。
- `_store_new_resources()` 可从服务层删除。
- 与前面资源 resolver、auto-save runtime 默认依赖装配模式一致。

备选方案一：一次性删除 `_fetch_resources()`，并同步改手动抓取、explore 队列和 waterfall 测试。这会扩大改动面，且 explore 队列还存在 `_extract_resource_url` 私有调用问题，适合单独拆分。

备选方案二：保持 run channel 显式传这两个 wrapper。改动最小，但无法继续收缩服务层职责。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
  - import `fetch_subscription_resources_with_runtime_adapter` 和 `build_default_resource_resolver_runtime_dependencies`。
  - import `store_new_resources_with_runtime_adapter`。
  - 新增 `fetch_resources_with_default_runtime_dependencies()`，签名兼容 run item flow 调用，内部调用 resource resolver runtime adapter 并传入默认依赖。
  - `build_default_run_channel_runtime_dependencies()` 的 `fetch_resources`、`store_new_resources` 参数改为可选。
  - 默认值使用 `x if x is not None else default`，保留 falsy callable 显式注入。

- `backend/app/services/subscription_service.py`
  - `run_channel_check()` 调用 `build_default_run_channel_runtime_dependencies()` 时不再传 `fetch_resources` 和 `store_new_resources`。
  - 删除 `_store_new_resources()`。
  - 移除 `store_new_resources_with_runtime_adapter` import。
  - 保留 `_fetch_resources()` 和 resource resolver imports。

测试文件：

- `backend/tests/test_subscription_run_channel_runtime_adapter.py`
  - 更新 service wrapper 测试：不再期望 builder 收到 `fetch_resources` / `store_new_resources`。
  - 新增默认 builder 无参资源 IO 绑定测试。
  - 新增 falsy callable 显式注入保留测试。
  - 新增默认 fetch helper 测试，断言它构建 resource resolver 默认依赖并调用 runtime adapter。

- `backend/tests/test_subscription_service_run_channel_resource_io_boundary.py`
  - 静态断言 `subscription_service.py` 不再包含 `store_new_resources=self._store_new_resources` 和 `_store_new_resources` 方法。
  - 静态断言 run channel builder 调用不再包含 `fetch_resources=self._fetch_resources`。
  - 静态断言 `_fetch_resources()` 仍保留。

## 行为保持

必须保持以下行为不变：

- `run_channel_check()` 的 public API、参数、返回值不变。
- run channel 执行时的资源抓取仍走 resource resolver runtime adapter。
- run channel 执行时的资源入库仍走 resource storage runtime adapter。
- 显式测试注入仍可覆盖 `fetch_resources` 和 `store_new_resources`。
- `_fetch_resources()` 行为不变，继续服务手动资源抓取和现有外部调用。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_resource_io_defaults_without_service_callbacks -q`
- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_default_resource_fetch_helper_builds_resource_resolver_runtime_dependencies -q`
- `scripts/verify-backend.sh -- tests/test_subscription_service_run_channel_resource_io_boundary.py -q`

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_service_run_channel_resource_io_boundary.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_subscription_resource_storage_runtime_adapter.py tests/test_subscription_manual_resource_fetch_runtime_adapter.py tests/test_fetch_resources_waterfall.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不删除 `_fetch_resources()`。
- 不改手动资源抓取的默认依赖装配。
- 不改 explore 队列的资源抓取调用。
- 不改 resource resolver、resource fetcher 或 resource storage 业务语义。
- 不处理 run channel 的其它 callback。

## 自检

- 范围聚焦在 run channel 的资源 IO 默认依赖装配。
- 删除项仅限不再需要的 `_store_new_resources()`。
- `_fetch_resources()` 保留，避免影响仍存在的调用面。
- 显式注入和 falsy callable 边界在测试策略中覆盖。
