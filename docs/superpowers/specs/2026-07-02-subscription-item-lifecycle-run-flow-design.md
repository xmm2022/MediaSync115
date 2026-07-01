# 订阅单项 Lifecycle Run Flow 拆分设计

## 背景

`SubscriptionService.run_channel_check()` 的 `_process_subscription()` 现在主要由已抽出的阶段 flow 组成，但仍内联两个 lifecycle 小尾巴：

- 订阅开始时写 `subscription_start` step。
- `finally` 中在 `result_lock` 内递增 processed count 并构造 progress payload，然后在锁外调用 `progress_callback`。

这些逻辑不参与资源抓取、转存或 cleanup 业务判断，只负责单订阅生命周期的开头日志和处理进度推进。把它们抽成小 flow 后，主流程会更接近“调度各阶段”的结构。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/item_lifecycle_run_flow.py`，提供 `start_subscription_item_processing(...)` 和 `publish_subscription_item_progress(...)` 两个函数。新模块复用 `run_lifecycle_logs.py`、`run_counters.py` 和 `run_state.py` 的纯 helper，不导入 ORM、runtime settings 或外部服务。

备选方案一：只抽 progress finally。改动更小，但 `build_subscription_start_step()` 仍由主流程直接处理，lifecycle 入口没有统一。

备选方案二：把 start、progress、success、failure 都合并进一个 lifecycle flow。成功/失败已经有 `item_outcome_run_flow.py`，合并会造成职责回退。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/item_lifecycle_run_flow.py`
  - `SubscriptionItemLifecycleDependencies`
    - `create_step_log(...)`
  - `start_subscription_item_processing(...)`
    - 写 `build_subscription_start_step(subscription_title)`。
  - `publish_subscription_item_progress(...)`
    - 在传入的 async lock 内调用 `increment_processed_count(result)`。
    - 在同一临界区构造 `build_processing_progress_payload(result)`。
    - 离开锁后，如果 `progress_callback` 存在，调用它。
    - 返回 progress payload，方便测试和后续复用。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 flow 和 dependencies。
  - 将 start step block 替换为 `start_subscription_item_processing(...)`。
  - 将 `finally` progress block 替换为 `publish_subscription_item_progress(...)`。
  - 移除主服务中不再直接使用的 `build_subscription_start_step` 和 `increment_processed_count` imports。

新增测试：

- `backend/tests/test_subscription_item_lifecycle_run_flow.py`
  - start flow 写当前 `subscription_start` step shape。
  - progress flow 在 lock 内递增 processed count 并构造 payload。
  - progress callback 在 lock 退出后调用。
  - 没有 progress callback 时仍递增并返回 payload。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部服务、API、ORM 模型或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- start step 字段、status 和 message 仍由 `run_lifecycle_logs.py` 现有 helper 生成。
- processed count 仍每个订阅处理结束后递增一次，包括早退、成功和失败。
- progress payload 仍在持锁期间基于递增后的 result 构造。
- `progress_callback` 仍在释放 `result_lock` 后调用。
- 没有 callback 时不做额外副作用。

## 测试策略

先写 `backend/tests/test_subscription_item_lifecycle_run_flow.py` 并运行红测，确认新模块缺失。实现新 flow 并接入 `run_channel_check()` 后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_item_lifecycle_run_flow.py tests/test_subscription_run_lifecycle_logs.py tests/test_subscription_run_state.py tests/test_subscription_run_counters.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变成功/失败收尾 flow。
- 不改变资源抓取、转存、固定来源或 cleanup 业务。
- 不改变 run-level start progress payload。
- 不改变并发数量或 semaphore 调度。
