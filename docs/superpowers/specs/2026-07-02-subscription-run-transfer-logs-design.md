# 订阅自动转存日志构造拆分设计

## 背景

`SubscriptionService.run_channel_check()` 的自动转存分支仍直接构造多段 new/retry 日志：

- `auto_transfer_new_start` step log
- `subscription.item.transfer_new_start` background event
- `auto_transfer_new_done` step log
- `subscription.item.transfer_new_done` background event
- `auto_transfer_retry_start` step log
- `subscription.item.transfer_retry_start` background event
- `auto_transfer_retry_done` step log
- `subscription.item.transfer_retry_done` background event
- `auto_transfer_summary` step log
- `auto_transfer_skip` step log

这些逻辑只负责把记录数量和转存统计转成日志 kwargs，不决定是否转存、如何转存、如何计数、是否清理订阅或是否扫描固定来源。抽离后可以进一步降低 `run_channel_check()` 的局部噪音。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/run_transfer_logs.py`，提供纯函数构造自动转存相关 step/event kwargs。`run_channel_check()` 仍负责判断分支、调用 `_auto_save_records_with_link_fallback()`、更新 result counter、设置 `cleanup_after_auto` 和写日志顺序。

备选方案一：把 new/retry 自动转存整体抽成异步 flow。收益更大，但会移动较多状态变量和锁内计数，本轮风险偏高。

备选方案二：并入 `run_item_logs.py`。资源抓取/入库日志与自动转存日志阶段不同，拆成独立模块便于后续继续拆自动转存调度。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/run_transfer_logs.py`
  - `build_auto_transfer_start_step(transfer_source, record_count)`
  - `build_auto_transfer_start_event_kwargs(...)`
  - `build_auto_transfer_done_step(transfer_source, stats)`
  - `build_auto_transfer_done_event_kwargs(...)`
  - `build_auto_transfer_summary_step(...)`
  - `build_auto_transfer_skip_step()`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 helper。
  - 用 helper 替换自动转存 new/retry/summary/skip 的内联日志字面量。
  - 保留所有自动转存调用、计数更新、cleanup 判断、固定来源扫描判断和事务边界。

新增测试：

- `backend/tests/test_subscription_run_transfer_logs.py`
  - new/retry start step 保持 step 和 message。
  - new/retry start event 保持 action、status、message、trace_id 和 extra。
  - new/retry done step 保持 success/partial 状态和 message。
  - new/retry done event 保持 success/warning 状态、message 和 extra。
  - summary step 保持 success/partial 状态和当前拼接格式。
  - skip step 保持当前 message。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、数据库 session、模型、外部服务或 API。

## 行为保持

必须保持以下行为不变：

- 日志写入顺序不变。
- new/retry 的 action 名、step 名、message 和 extra 字段保持现状。
- done 状态仍由 `stats["failed"] == 0` 决定，event 失败态仍为 `warning`。
- summary 状态仍由 `sub_failed_transfer_count == 0` 决定。
- summary message 仍包含新资源数量，并仅在存在 retry 记录时追加重试数量。
- 未启用自动转存时仍只写 `auto_transfer_skip` step log。
- 不改变 `_auto_save_records_with_link_fallback()` 调用参数、result counter 或 cleanup 行为。

## 测试策略

先写 `backend/tests/test_subscription_run_transfer_logs.py` 并运行红测，确认新模块缺失。实现 helper 并接入后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_run_transfer_logs.py tests/test_subscription_run_item_logs.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不抽离自动转存执行流程。
- 不抽离转存完成后的订阅清理日志。
- 不抽离固定来源扫描日志。
- 不改变任何业务语义或用户可见结果。
