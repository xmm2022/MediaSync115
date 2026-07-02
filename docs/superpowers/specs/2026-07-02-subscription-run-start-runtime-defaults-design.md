# 订阅 Run Start Runtime 默认依赖装配设计

## 背景

`SubscriptionService.run_channel_check()` 仍把两个只转发到 runtime adapter 的私有方法传给 `build_default_run_channel_runtime_dependencies()`：

- `_resolve_source_order()` 调用 `resolve_source_order_with_runtime_adapter(channel)`。
- `_build_hdhive_unlock_context()` 调用 `build_hdhive_unlock_context_with_runtime_adapter()`。

这两个 wrapper 不包含业务判断，也不再被资源解析路径直接需要。前几块已经让资源抓取、手动抓取、run channel 资源 IO 都由各自 runtime adapter 装配默认依赖；继续让服务层传这两个 callback，会让 `subscription_service.py` 保留不必要的 run-start 默认依赖噪声。

本块目标是让 `run_channel_runtime_adapter` 自己装配 run-start 阶段的默认来源顺序和 HDHive unlock context，删除 `SubscriptionService._resolve_source_order()` 和 `_build_hdhive_unlock_context()`。

## 方案比较

推荐方案：把 `build_default_run_channel_runtime_dependencies()` 的 `build_hdhive_unlock_context` 和 `resolve_source_order` 参数改为可选，默认绑定现有 runtime adapter helper。

优点：

- 保留测试显式注入能力，run channel adapter tests 仍能传入 fake callback。
- `SubscriptionService.run_channel_check()` 可以少传两个服务私有 callback。
- 删除两个无业务逻辑 wrapper，继续收缩主服务。
- 行为与当前 wrapper 等价，来源顺序和 HDHive unlock 设置仍由现有 runtime settings helper 读取。

备选方案一：在 `SubscriptionService.run_channel_check()` 中直接传 `build_hdhive_unlock_context_with_runtime_adapter` 和 `resolve_source_order_with_runtime_adapter`。这能删除 wrapper，但默认依赖装配仍留在服务层，和已有 resource IO 默认下沉方向不一致。

备选方案二：同时删除 `_prepare_hdhive_locked_resources()`。该方法仍有 HDHive unlock 策略测试直接覆盖，且 resource resolver 默认依赖已在自己的 runtime adapter 中默认绑定 prepare helper；把它一起迁移会扩大本块范围。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
  - import `resolve_source_order_with_runtime_adapter`。
  - import `build_hdhive_unlock_context_with_runtime_adapter`。
  - 将 `build_hdhive_unlock_context` 和 `resolve_source_order` 参数改为可选。
  - 未显式传入时分别使用上述 runtime adapter helper。
  - 保留显式注入优先级，并使用 `is not None` 判断，避免 falsy callable 被覆盖。

- `backend/app/services/subscription_service.py`
  - `run_channel_check()` 不再向默认 builder 传 `build_hdhive_unlock_context=self._build_hdhive_unlock_context`。
  - `run_channel_check()` 不再向默认 builder 传 `resolve_source_order=self._resolve_source_order`。
  - 删除 `_resolve_source_order()` 和 `_build_hdhive_unlock_context()`。
  - 移除不再需要的 `resolve_source_order_with_runtime_adapter` 和 `build_hdhive_unlock_context_with_runtime_adapter` imports。
  - 暂时保留 `_prepare_hdhive_locked_resources()`，因为现有 HDHive unlock 策略测试仍通过服务层入口验证该 adapter。

测试文件：

- `backend/tests/test_subscription_run_channel_runtime_adapter.py`
  - 更新服务 wrapper 测试，断言 builder 不再收到 `build_hdhive_unlock_context` 和 `resolve_source_order`。
  - 新增默认依赖测试，断言未传入这两个 callback 时 builder 绑定 `run_channel_runtime_adapter` 中的默认 helper。
  - 保留显式注入测试，确认传入 fake callback 时仍优先使用 fake。

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 更新静态边界：服务层不再保留 `_build_hdhive_unlock_context`，但仍保留 `_prepare_hdhive_locked_resources`。

- `backend/tests/test_subscription_service_resource_resolver_boundary.py`
  - 更新静态边界：服务层不再保留 `_build_hdhive_unlock_context`，仍保留 `_prepare_hdhive_locked_resources`。

## 行为保持

必须保持以下行为不变：

- `run_channel_check()` 的公开签名、返回结构、并发限制和 progress callback 传递不变。
- run start 仍在同一时机解析 source order 和 HDHive unlock context。
- 来源优先级、TG ready 判断和 HDHive unlock settings 仍来自 runtime settings。
- 显式依赖注入测试仍能替换 source order 和 unlock context callback。
- 不改变资源抓取 waterfall、自动转存、固定来源扫描、清理、通知或 postprocess 行为。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency -q`
- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_run_start_defaults_without_service_callbacks -q`
- `scripts/verify-backend.sh -- tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_resource_resolver_boundary.py -q`

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_service_resource_resolver_boundary.py tests/test_subscription_runtime_preferences_adapter.py tests/test_subscription_hdhive_unlock_runtime_adapter.py tests/test_hdhive_unlock_policy.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不删除 `_prepare_hdhive_locked_resources()`。
- 不改 `resource_resolver_runtime_adapter` 的默认依赖。
- 不改 API 中固定来源手动扫描仍调用的质量过滤入口。
- 不拆日志、记录 loader、自动转存或固定来源扫描 wrapper。

## 自检

- 设计只移动默认依赖装配边界，不改变业务语义。
- 保留显式注入能力，测试可以继续隔离 run start 行为。
- 范围足够小，可由一个实施计划完成。
- 没有占位符、未定项或跨块依赖。
