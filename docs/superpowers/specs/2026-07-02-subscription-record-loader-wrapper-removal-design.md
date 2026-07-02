# 订阅记录 Loader Wrapper 删除设计

## 背景

`SubscriptionService` 仍保留三个自动转存记录 loader wrapper：

- `_load_retryable_records()` 调用 `load_retryable_records_with_db_adapter(db, subscription_id)`。
- `_load_force_retry_records()` 调用 `load_force_retry_records_with_db_adapter(db, subscription_id, duplicate_urls)`。
- `_load_subscription_resource_urls()` 调用 `load_subscription_resource_urls_with_db_adapter(db, subscription_id)`。

前两者只用于 `run_channel_check()` 给 `build_default_run_channel_runtime_dependencies()` 传默认依赖。第三个已经不再有生产调用：`link_fallback_runtime_adapter` 已经默认绑定 `load_subscription_resource_urls_with_db_adapter`。

本块目标是让 run channel runtime adapter 自己装配自动转存 retry/force retry 记录 loader 默认依赖，并删除服务层三个只转发 DB adapter 的 wrapper。

## 方案比较

推荐方案：把 `build_default_run_channel_runtime_dependencies()` 的 `load_retryable_records` 和 `load_force_retry_records` 参数改为可选，默认绑定 `auto_transfer_record_loaders_db_adapter` 中的 DB adapter helper。

优点：

- 保留显式注入能力，run channel 和 item processing 单元测试仍可传 fake loader。
- `SubscriptionService.run_channel_check()` 不再传两个服务私有 loader wrapper。
- 可同时删除无生产调用的 `_load_subscription_resource_urls()` 和对应 import。
- 行为保持等价，DB 查询条件仍由已有 DB adapter 提供。

备选方案一：在 `SubscriptionService.run_channel_check()` 中直接传 DB adapter helper。这样可以删除 wrapper，但默认依赖装配仍留在服务层，和前几块“默认 runtime 依赖下沉”的方向不一致。

备选方案二：只删除 `_load_subscription_resource_urls()`。这能减少一点行数，但保留 run channel 两个同类转发 wrapper，收益较小。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
  - import `load_retryable_records_with_db_adapter` 和 `load_force_retry_records_with_db_adapter`。
  - 将 `build_default_run_channel_runtime_dependencies()` 的 `load_retryable_records` 和 `load_force_retry_records` 参数改为可选。
  - 未显式传入时分别绑定上述 DB adapter helper。
  - 使用 `is not None` 判断，保留 falsy callable 显式注入能力。

- `backend/app/services/subscription_service.py`
  - `run_channel_check()` 不再向默认 builder 传 `load_retryable_records=self._load_retryable_records`。
  - `run_channel_check()` 不再向默认 builder 传 `load_force_retry_records=self._load_force_retry_records`。
  - 删除 `_load_retryable_records()`、`_load_force_retry_records()`、`_load_subscription_resource_urls()`。
  - 移除 `load_retryable_records_with_db_adapter`、`load_force_retry_records_with_db_adapter`、`load_subscription_resource_urls_with_db_adapter` imports。

测试文件：

- `backend/tests/test_subscription_run_channel_runtime_adapter.py`
  - 更新 service wrapper 测试，断言 builder 不再收到 `load_retryable_records` 和 `load_force_retry_records`。
  - 新增默认依赖测试，断言未传入 loader 时绑定 run channel runtime module 中的 DB adapter helper。
  - 新增 falsy loader 显式注入测试，断言 falsy callable 不被默认值覆盖。

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 更新静态边界测试，断言三个 record loader wrapper 和 DB adapter imports 不再出现在 `subscription_service.py`。

## 行为保持

必须保持以下行为不变：

- retry record 选择仍由 `load_retryable_records_with_db_adapter()` 查询 FAILED/PENDING/MATCHED 记录并调用 `select_retryable_records()`。
- force retry 仍由 `load_force_retry_records_with_db_adapter()` 按 duplicate URLs 查询并 dedupe。
- link fallback 仍由 `link_fallback_runtime_adapter` 默认绑定 `load_subscription_resource_urls_with_db_adapter()`。
- run channel、自动转存、固定来源扫描、清理和通知行为不变。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py::test_subscription_service_wrapper_passes_callbacks_and_concurrency tests/test_subscription_run_channel_runtime_adapter.py::test_default_runtime_dependencies_bind_record_loader_defaults_without_service_callbacks tests/test_subscription_service_dead_wrapper_cleanup.py -q`

实现前预期失败：

- service wrapper 测试会发现 builder 仍收到两个 loader callback。
- 新默认依赖测试会因为 builder 仍要求必填 loader 参数而失败。
- 静态边界测试会发现服务层仍保留三个 loader wrapper/import。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_auto_transfer_record_loaders_db_adapter.py tests/test_subscription_auto_transfer_retry_records.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_service_dead_wrapper_cleanup.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不修改 DB adapter 查询条件。
- 不修改 retry record selection 规则。
- 不修改 link fallback flow 或 auto-save flow。
- 不删除 `_auto_save_records_with_link_fallback()`、`_auto_save_resources()`、fixed source 或日志 wrapper。

## 自检

- 设计只移动默认依赖装配和删除无业务逻辑 wrapper。
- 显式注入能力保留，方便现有 flow tests 继续隔离 DB。
- 范围足够小，可由一个实施计划完成。
- 没有占位符、未定项或跨块依赖。
