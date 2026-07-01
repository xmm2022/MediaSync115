# 订阅单项收尾 Run Flow 拆分设计

## 背景

`SubscriptionService.run_channel_check()` 的 `_process_subscription()` 当前仍直接处理单个订阅的成功和失败收尾：

- 成功路径：固定来源结果合并到本订阅转存计数后，写 `subscription_done` step，写 `subscription.item.done` background event，commit 当前 inner session。
- 失败路径：rollback 当前 inner session，将失败计入本轮 result，写 `subscription_failed` step，写 `subscription.item.failed` background event，commit 失败日志。

这些逻辑都属于单订阅处理的 outcome orchestration。它们不决定资源抓取、自动转存或固定来源扫描业务，只负责日志、统计和事务边界。继续留在主流程里会让 `_process_subscription()` 同时承载业务调度和结果收尾。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/item_outcome_run_flow.py`，提供成功和失败两个小函数，并通过依赖注入传入 step/event 日志函数和失败统计回调。新模块复用 `run_lifecycle_logs.py` 的纯 helper，不导入 ORM、runtime settings 或外部服务。

备选方案一：只抽成功路径。改动更小，但失败分支仍留在主流程，直接依赖 failed lifecycle log helper，收尾职责不完整。

备选方案二：把 start step、成功、失败、progress finally 全部抽成单订阅 lifecycle runner。收益更大，但会同时触碰并发、进度回调和异常传播，测试面过宽。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/item_outcome_run_flow.py`
  - `SubscriptionItemOutcomeDependencies`
    - `create_step_log(...)`
    - `log_background_event(...)`
    - `apply_subscription_failure(subscription_id, title, error)`
  - `complete_subscription_item_success(...)`
    - 写 `build_subscription_done_step()`。
    - 写 `build_subscription_done_event_kwargs(...)`。
    - `db.commit()`。
  - `handle_subscription_item_failure(...)`
    - `db.rollback()`。
    - 调用失败统计回调。
    - 写 `build_subscription_failed_step(error)`。
    - 写 `build_subscription_failed_event_kwargs(...)`。
    - `db.commit()`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 flow 和 dependencies。
  - 成功路径替换为一次 `complete_subscription_item_success(...)` 调用。
  - `except` 分支替换为一次 `handle_subscription_item_failure(...)` 调用。
  - 失败统计仍在 `run_channel_check()` 内通过 `result_lock` 包装后注入。

新增测试：

- `backend/tests/test_subscription_item_outcome_run_flow.py`
  - 成功收尾写 done step/event 并 commit，不调用失败统计。
  - 失败收尾先 rollback，再应用失败统计，写 failed step/event 并 commit。
  - 失败统计回调收到 `subscription_id`、`title` 和原始异常对象。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部服务、API、ORM 模型或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- 成功 step/event 的字段、status、message、extra 仍由 `run_lifecycle_logs.py` 现有 helper 生成。
- `new_record_count` 仍使用新抓取入库记录数，不把固定来源补扫记录数加入现有 done event 的 `new_resources` 字段。
- `should_auto_download` 仍由主流程计算并传入。
- `sub_saved_count` 和 `sub_failed_transfer_count` 仍包含自动转存和固定来源转存增量。
- 成功路径仍只 commit 当前 inner session，不修改 run-level result。
- 失败路径仍先 rollback，再更新 run-level failure stats，再写 failed step/event，最后 commit。
- `finally` 中的 processed count 和 progress callback 暂不移动。

## 测试策略

先写 `backend/tests/test_subscription_item_outcome_run_flow.py` 并运行红测，确认新模块缺失。实现新 flow 并接入 `run_channel_check()` 后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_item_outcome_run_flow.py tests/test_subscription_run_lifecycle_logs.py tests/test_subscription_run_counters.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变订阅开始 step。
- 不改变资源抓取、自动转存、固定来源扫描或失败异常传播规则。
- 不改变 processed count 和 progress callback。
- 不改变 done/failed lifecycle helper 的输出格式。
