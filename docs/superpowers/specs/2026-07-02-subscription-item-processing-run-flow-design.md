# 订阅单项处理 Run Flow 拆分设计

## 背景

`SubscriptionService.run_channel_check()` 现在已经把运行状态初始化、订阅派发和运行收尾拆到了较清晰的边界，但内部仍保留一个较长的 `_process_subscription(sub)` 闭包。这个闭包按顺序编排单个订阅的完整处理生命周期：

- 使用独立 session 处理单个订阅。
- 写订阅开始日志。
- 执行预扫描清理，命中清理时早退。
- 抓取并入库资源。
- 执行自动转存和固定来源转存组合阶段。
- 写成功或失败收尾日志。
- 在 `finally` 中推进 processed count 并发布 progress。

这些步骤的业务子阶段已经分别拆成 dependency-injected helper；剩下的主服务代码主要是在做跨阶段编排和 run-level 统计回调装配。把它抽到单项处理 flow 后，`run_channel_check()` 可以只保留运行上下文准备、dispatch 和 finalize。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/item_processing_run_flow.py`，提供 `process_subscription_item(...)`。该函数接收订阅快照、运行上下文、result/result_lock/progress callback、`tv_media_type` 和一个依赖 dataclass。新模块复用已拆出的 lifecycle、pre-scan、resource ingest、transfer phase、outcome 和 run counter helper，不导入 `subscription_service`、runtime settings、外部服务、API 或 `AsyncSession`。

备选方案一：先抽 run-level result stats 回调工厂。改动更小，但 `_process_subscription()` 的阶段编排仍留在主服务，`run_channel_check()` 结构没有明显改善。

备选方案二：把 `run_channel_check()` 整体抽成一个大 flow。收益最大，但会同时迁移 start/finalize/dispatch/单项处理多个边界，风险和测试成本过高。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/item_processing_run_flow.py`
  - `SubscriptionItemProcessingDependencies`
    - `session_factory()`
    - `create_step_log(...)`
    - `log_background_event(...)`
    - `evaluate_pre_scan_cleanup(...)`
    - `fetch_resources(...)`
    - `store_new_resources(...)`
    - `load_retryable_records(db, subscription_id)`
    - `load_force_retry_records(db, subscription_id, duplicate_urls)`
    - `auto_save_records_with_link_fallback(...)`
    - `should_scan_fixed_sources(...)`
    - `scan_fixed_sources_for_subscription(...)`
    - `delete_subscription_with_records(db, subscription_id)`
  - `process_subscription_item(...)`
    - 打开 `dependencies.session_factory()` 得到单项 session。
    - 构造 run-level stats 回调，所有 result mutation 都在传入的 `result_lock` 内完成。
    - 依次调用：
      - `start_subscription_item_processing(...)`
      - `run_pre_scan_cleanup_for_subscription(...)`
      - `run_resource_ingest_for_subscription(...)`
      - `run_subscription_transfer_phase(...)`
      - `complete_subscription_item_success(...)`
    - 任一异常进入 `handle_subscription_item_failure(...)`。
    - `finally` 中调用 `publish_subscription_item_progress(...)`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入 `SubscriptionItemProcessingDependencies` 和 `process_subscription_item`。
  - 将 `_process_subscription()` 函数体替换为一次 `process_subscription_item(...)` 调用。
  - 继续由 `run_channel_check()` 持有 run-level `result`、`result_lock`、`hdhive_unlock_context`、`source_order` 和 `_SUBSCRIPTION_SCAN_CONCURRENCY`。
  - 移除主服务中不再直接使用的 lifecycle、pre-scan run、resource ingest run、transfer phase、item outcome 和 run counter stats imports。
  - 如果主服务不再需要顶层 `async_session_maker` 或 `MediaType`，移除相应顶层 import；`MediaType.TV` 作为参数注入给新 flow。

新增测试：

- `backend/tests/test_subscription_item_processing_run_flow.py`
  - 成功路径：按 start -> pre-scan -> ingest -> transfer -> success -> progress 顺序执行，并更新 resource/auto/progress 统计。
  - 预扫描清理早退：cleanup stats 和 progress 发生，资源抓取、转存和 success 不发生。
  - 失败路径：子阶段异常时 rollback，failure stats/logs/commit 发生，并仍发布 progress。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部服务、API、ORM 模型或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- 每个订阅仍使用独立 `async_session_maker()` session。
- 预扫描清理命中时仍早退，不执行资源抓取、转存和成功收尾。
- 资源入库后仍把 `created_records` 和 `duplicate_urls` 传给转存阶段。
- 转存阶段返回的 `should_auto_download`、`sub_saved_count` 和 `sub_failed_transfer_count` 仍传给成功收尾。
- 任何异常仍由失败收尾处理，不从单项处理流向 dispatch 泄漏。
- failure/resource/transfer/cleanup stats 仍在 `result_lock` 内更新。
- processed count 和 progress callback 仍在 `finally` 执行，包括早退和失败路径。
- progress payload 仍由 lifecycle helper 在锁内基于递增后的 result 构造，callback 仍在锁外调用。

## 测试策略

先写 `backend/tests/test_subscription_item_processing_run_flow.py` 并运行红测，确认新模块缺失。实现新 flow 并接入 `run_channel_check()` 后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_item_processing_run_flow.py tests/test_subscription_run_dispatch_flow.py tests/test_subscription_item_lifecycle_run_flow.py tests/test_subscription_item_outcome_run_flow.py tests/test_subscription_pre_scan_cleanup_run_flow.py tests/test_subscription_resource_ingest_run_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变资源抓取、入库、转存、固定来源或 cleanup 子 flow 的内部规则。
- 不改变 run start、dispatch 或 run finalize 行为。
- 不改变 `_SUBSCRIPTION_SCAN_CONCURRENCY`。
- 不新增跨订阅共享 session。
- 不调整质量过滤、通知或 postprocess 业务语义。
