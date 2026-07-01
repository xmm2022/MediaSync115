# 订阅运行清理日志构造拆分设计

## 背景

`SubscriptionService.run_channel_check()` 在单项处理里仍直接构造两类清理日志：

- 自动转存完成后清理订阅：
  - `subscription.item.cleanup_after_transfer` background event
  - cleanup step log
- 电影固定来源转存完成后清理订阅：
  - `subscription.item.cleanup_after_fixed_source` background event
  - `subscription_cleanup_movie_fixed_source` step log

这些逻辑只负责把清理原因、消息和 payload 转成日志 kwargs，不决定是否删除订阅、不执行删除、不更新清理计数。抽离后可以继续降低单项处理流程的字面量密度。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/run_cleanup_logs.py`，提供纯函数构造这两类清理日志 kwargs。`run_channel_check()` 仍负责调用 `_delete_subscription_with_records()`、写日志、更新 result cleanup counter 和事务提交。

备选方案一：把清理日志并入 `run_transfer_logs.py`。转存后清理确实与转存有关，但固定来源清理属于另一条路径，放入独立 cleanup 日志模块更清晰。

备选方案二：把清理分支整体抽成异步 flow。会移动删除调用和计数更新，行为面比本轮需要更大。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/run_cleanup_logs.py`
  - `build_cleanup_after_transfer_event_kwargs(...)`
  - `build_cleanup_after_transfer_step(cleanup_stats)`
  - `build_fixed_source_movie_cleanup_event_kwargs(...)`
  - `build_fixed_source_movie_cleanup_step(fixed_saved)`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 helper。
  - 用 helper 替换自动转存后清理和固定来源电影清理的内联日志字面量。
  - 保持删除调用、计数更新和分支判断不变。

新增测试：

- `backend/tests/test_subscription_run_cleanup_logs.py`
  - 自动转存后清理 event 保持 action、status、message、trace_id 和 extra。
  - 自动转存后清理 step 保持默认 step/message 和 dict-only payload 策略。
  - 电影固定来源清理 event 保持当前 action、message 和 reason。
  - 电影固定来源清理 step 保持当前 step、message 和 `{"fixed_saved": fixed_saved}` payload。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、数据库 session、模型、外部服务或 API。

## 行为保持

必须保持以下行为不变：

- 清理日志写入顺序不变。
- 自动转存后清理的默认 message 仍为 `"订阅已自动清理"`。
- 自动转存后清理的默认 step 仍为 `"subscription_cleanup_after_transfer"`。
- cleanup payload 仍只有在原值是 dict 时写入，否则为 `None`。
- 固定来源电影清理的 reason 仍为 `"movie_fixed_source_transferred"`。
- 不改变 `_delete_subscription_with_records()` 调用位置、`apply_cleanup_stats()` 调用位置或事务边界。

## 测试策略

先写 `backend/tests/test_subscription_run_cleanup_logs.py` 并运行红测，确认新模块缺失。实现 helper 并接入后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_run_cleanup_logs.py tests/test_subscription_run_transfer_logs.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改清理策略。
- 不抽离删除订阅流程。
- 不改固定来源扫描逻辑。
- 不改变任何业务语义或用户可见结果。
