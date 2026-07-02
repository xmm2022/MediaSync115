# 订阅资源 Resolver 默认 Runtime 依赖装配设计

## 背景

`SubscriptionService._fetch_resources()` 已经把实际 waterfall 资源解析委托给 `resource_resolver_runtime_adapter`，但服务层仍负责手动组装一整组默认依赖：

- PanSou、HDHive、TG、离线磁力抓取 wrapper。
- 来源优先级、分辨率偏好、质量过滤偏好 wrapper。
- HDHive unlock context 和 locked resource prepare wrapper。

这些依赖都已经有各自的 runtime adapter。继续由 `SubscriptionService` 逐项装配，会让主服务保留一组只转发到 adapter 的私有方法，并制造“资源抓取流程仍由主服务掌握默认运行时”的边界噪声。

本块目标是让 `resource_resolver_runtime_adapter` 自己提供默认 runtime 依赖装配；`SubscriptionService._fetch_resources()` 只负责调用 resolver runtime adapter，并传递 channel、subscription snapshot、unlock context、source order 和 exclude urls。

## 方案比较

推荐方案：扩展 `build_default_resource_resolver_runtime_dependencies()`，让各依赖参数可选，默认绑定现有 runtime adapter helper。

优点：

- 保留现有注入测试能力，单元测试仍可传入 fake fetcher、resolver、filter、event emitter。
- 服务层可以删除抓取 wrapper 和分辨率 wrapper，降低 `subscription_service.py` 行数。
- 不改变 `fetch_subscription_resources_with_runtime_adapter()` 的执行路径和下层 `resource_resolver_adapter` 契约。

备选方案一：新增第二个 builder，例如 `build_runtime_resource_resolver_dependencies()`。这会保留旧 builder 的必填参数和新 builder 并存，命名更啰嗦，调用方更难判断该用哪个。

备选方案二：直接在 `_fetch_resources()` 内调用各 runtime adapter helper，不再使用 builder。这样会把依赖装配继续留在服务层，与本轮拆分目标相反。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/runtime_preferences_adapter.py`
  - 新增 `resolve_subscription_resolutions_with_runtime_adapter(sub, *, dependencies=None)`。
  - 该函数忽略 `sub`，返回 `RuntimePreferencesDependencies.get_resource_preferred_resolutions()`，与当前服务 wrapper 行为一致。

- `backend/app/services/subscriptions/resource_resolver_runtime_adapter.py`
  - import 现有资源抓取 runtime helper：
    - `fetch_from_hdhive_with_runtime_adapter`
    - `fetch_from_tg_with_runtime_adapter`
    - `fetch_from_pansou_with_runtime_adapter`
    - `fetch_offline_magnets_with_runtime_adapter`
  - import 现有偏好 runtime helper：
    - `resolve_source_order_with_runtime_adapter`
    - `resolve_subscription_resolutions_with_runtime_adapter`
    - `resolve_subscription_quality_filter_with_runtime_adapter`
  - import 现有 HDHive unlock runtime helper：
    - `build_hdhive_unlock_context_with_runtime_adapter`
    - `prepare_hdhive_locked_resources_with_runtime_adapter`
  - 将 `build_default_resource_resolver_runtime_dependencies()` 的核心运行时参数改为可选，未传入时绑定上述默认 helper。

- `backend/app/services/subscription_service.py`
  - `_fetch_resources()` 改为调用 `build_default_resource_resolver_runtime_dependencies()`，不再传入服务私有 wrapper。
  - 删除不再被 repo 使用的私有 wrapper：
    - `_fetch_from_pansou()`
    - `_fetch_from_hdhive()`
    - `_fetch_from_tg()`
    - `_fetch_offline_magnets()`
    - `_resolve_subscription_resolutions()`
  - 移除对应 imports。
  - 保留 `_build_hdhive_unlock_context()` 和 `_prepare_hdhive_locked_resources()`，因为 run channel 默认依赖和现有 HDHive unlock 测试仍使用这些入口。

测试文件：

- `backend/tests/test_subscription_resource_resolver_runtime_adapter.py`
  - 先新增红测，断言默认 builder 在不传入抓取/偏好/unlock 依赖时会绑定现有 runtime helper。
  - 保留现有“显式注入覆盖默认依赖”的测试。

- `backend/tests/test_subscription_runtime_preferences_adapter.py`
  - 覆盖新增 `resolve_subscription_resolutions_with_runtime_adapter()`，验证它通过可注入依赖读取分辨率偏好。

- `backend/tests/test_fetch_resources_waterfall.py`
  - 将针对服务私有 fetch wrapper 的 monkeypatch 更新为针对 resolver runtime adapter 默认 fetcher 的 monkeypatch，避免测试继续依赖将被删除的服务 wrapper。

- `backend/tests/test_subscription_service_resource_resolver_boundary.py`
  - 静态覆盖服务层边界：抓取 wrapper 和分辨率 wrapper 已删除，`_fetch_resources()` 仍存在，HDHive unlock wrapper 仍保留。

## 行为保持

必须保持以下行为不变：

- `_fetch_resources()` 的参数、返回值和下层 waterfall 行为不变。
- 来源顺序、质量过滤、分辨率偏好仍来自 `runtime_settings_service`。
- PanSou、HDHive、TG、离线磁力抓取仍走现有 `resource_fetcher_runtime_adapter`。
- HDHive auto-unlock context 和 locked resource prepare 仍走现有 `hdhive_unlock_runtime_adapter`。
- `fetch_resources_for_media()` 继续通过 `_fetch_resources()` 复用同一资源解析管道。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_resource_resolver_runtime_adapter.py::test_default_runtime_dependencies_bind_resource_resolver_runtime_helpers -q`
- `scripts/verify-backend.sh -- tests/test_subscription_runtime_preferences_adapter.py::test_resolve_subscription_resolutions_with_runtime_adapter_reads_runtime_preferences -q`
- `scripts/verify-backend.sh -- tests/test_subscription_service_resource_resolver_boundary.py -q`

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_subscription_runtime_preferences_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_service_resource_resolver_boundary.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `resource_resolver.py` 的 waterfall 决策。
- 不改 `resource_fetcher_runtime_adapter.py` 的抓取逻辑。
- 不删除 `_build_hdhive_unlock_context()` 和 `_prepare_hdhive_locked_resources()`。
- 不改 run channel 调度、自动转存、通知或 postprocess 行为。

## 自检

- 设计只移动默认依赖装配边界，不改变业务语义。
- 新增 runtime preferences helper 精确复刻当前 `_resolve_subscription_resolutions()` 行为。
- 显式依赖注入能力保留，便于现有 adapter tests 和未来测试继续隔离外部服务。
- 文档内容完整，范围可由一个实施计划完成。
