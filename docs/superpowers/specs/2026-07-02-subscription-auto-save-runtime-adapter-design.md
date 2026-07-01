# 订阅自动转存 Runtime Adapter 拆分设计

## 背景

`_auto_save_resources()` 目前已经把核心转存批处理交给 `auto_save_resources_adapter.py` 和 `auto_transfer_batch.py`，但 `subscription_service.py` 中仍保留一段运行时装配逻辑：

- 定义 `emit_transfer_success()` 闭包并在 Kafka 启用时发送 `transfer_success`。
- 构造 `AutoTransferBatchStatuses`，把 `MediaStatus` 映射到批处理状态。
- 构造 `AutoSaveResourcesAdapterDependencies`，接入 runtime settings、Pan115、TV missing、通知、后处理、操作日志和核心 batch runner。
- 调用 `auto_save_resources_with_adapter(...)`。

这些代码不决定转存业务规则，只负责把服务层运行时依赖装配给已经拆出的 adapter。继续把它留在 `subscription_service.py` 会让服务文件保持较多重复 wiring 细节。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/auto_save_resources_runtime_adapter.py`。该模块承载 `_auto_save_resources()` 的运行时装配，提供：

- `AutoSaveResourcesRuntimeDependencies`
- `build_default_auto_save_resources_runtime_dependencies(...)`
- `emit_transfer_success_event(...)`
- `auto_save_resources_with_runtime_adapter(...)`

服务方法只把当前 `self` 相关方法注入默认 runtime dependencies，然后调用 runtime adapter。

备选方案一：只在 `SubscriptionService` 内新增 `_auto_save_resources_adapter_dependencies()` 私有方法。风险最低，但不减少服务文件体积，拆分收益很小。

备选方案二：把 runtime settings、Pan115、Kafka 继续保留在服务方法中，只把 `AutoTransferBatchStatuses` 构造抽出。改动过窄，不能真正拆掉 `_auto_save_resources()` 的适配层。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/auto_save_resources_runtime_adapter.py`
  - `AutoSaveResourcesRuntimeDependencies`
    - 持有当前 `_auto_save_resources()` 需要的运行时依赖、`AutoTransferBatchStatuses`、`run_adapter` 和 `run_batch`。
  - `emit_transfer_success_event(subscription_id, data)`
    - 保持现有 Kafka 发送语义：仅当 `kafka_producer._enabled` 为真时发送 `event_type="transfer_success"`、`data=data`、`key=str(subscription_id)`。
  - `build_default_auto_save_resources_runtime_dependencies(...)`
    - 接收服务实例相关方法：
      - `resolve_quality_filter`
      - `create_step_log`
      - `apply_precise_postprocess_status`
      - `notify_transfer_success`
    - 绑定现有 concrete runtime 依赖：
      - runtime settings getter
      - `Pan115Service`
      - `tv_missing_service.get_tv_missing_status`
      - `select_tv_missing_episode_files`
      - `media_postprocess_service.trigger_archive_after_transfer`
      - `operation_log_service.log_background_event`
      - `beijing_now`
      - `is_video_filename`
      - `auto_save_resources_batch`
      - `auto_save_resources_with_adapter`
  - `auto_save_resources_with_runtime_adapter(...)`
    - 接收当前 `_auto_save_resources()` 的运行时参数。
    - 把 `AutoSaveResourcesRuntimeDependencies` 转换为现有 `AutoSaveResourcesAdapterDependencies`。
    - 调用 `dependencies.run_adapter(...)`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 移除 `_auto_save_resources()` 内部 `emit_transfer_success()` 闭包。
  - 移除 `_auto_save_resources()` 内部 `AutoTransferBatchStatuses` 和 `AutoSaveResourcesAdapterDependencies` 构造。
  - 调用 `auto_save_resources_with_runtime_adapter(...)`。
  - 使用 `build_default_auto_save_resources_runtime_dependencies(...)` 注入当前服务实例方法。

新增测试：

- `backend/tests/test_subscription_auto_save_resources_runtime_adapter.py`
  - runtime adapter 正确把运行时依赖转换为 `AutoSaveResourcesAdapterDependencies` 并调用下层 adapter。
  - `AutoTransferBatchStatuses`、`run_id`、`channel`、`sub`、`records`、`source`、`tv_missing_snapshot` 全量透传。
  - 生成的 `emit_transfer_success` 调用注入的 `emit_transfer_success_event(subscription_id, data)`。
  - 默认 builder 绑定现有 `MediaStatus` 状态值和核心 runner。
  - `emit_transfer_success_event()` 在 Kafka 启用/禁用时保持现有发送行为。
  - runtime adapter 不 import `subscription_service` 或 `app.api`；核心 `auto_save_resources_adapter.py` 仍由现有测试保证不 import runtime 层。

## 行为保持

必须保持以下行为不变：

- `_auto_save_resources()` 方法签名不变。
- `source`、`tv_missing_snapshot`、`run_id` 和 `channel` 透传到现有 adapter 的形状不变。
- `MediaStatus.TRANSFERRING / DOWNLOADING / OFFLINE_SUBMITTED / MATCHED / COMPLETED / FAILED` 的映射不变。
- Pan115 cookie、默认目录、离线目录、TV missing、质量过滤、通知、后处理、归档触发、操作日志和视频文件判断仍使用同一批 runtime 依赖。
- Kafka 成功事件仍只在 `_enabled` 为真时发送，事件类型、data 和 key 不变。
- `auto_save_resources_adapter.py` 与 `auto_transfer_batch.py` 的业务规则不改。

## 测试策略

先写 `backend/tests/test_subscription_auto_save_resources_runtime_adapter.py` 并运行红测，确认新模块缺失。实现 runtime adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_auto_save_resources_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变自动转存批处理循环、失败处理、已接收处理、精确转存或离线提交规则。
- 不拆 `auto_transfer_batch.py` 内部业务分支。
- 不改变 `_notify_transfer_success()`、后处理或归档触发语义。
- 不清理 API 层里仍存在的独立 Kafka 发送逻辑。
