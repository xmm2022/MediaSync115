# 订阅运行收尾 Flow 拆分设计

## 背景

`SubscriptionService.run_channel_check()` 在完成所有订阅处理后仍内联 run-level 收尾逻辑：

- 根据失败计数解析运行状态。
- 将 HDHive unlock 统计写入 result。
- 构造运行摘要 message 和 finished_at。
- 写入 result 的 `status`、`message`、`finished_at`。
- 写 `subscription.check.finish` background event。
- 写 execution log、run_finish step，并 prune 旧 step logs。
- 对 execution log 写入失败做 rollback、result 降级和 `run_finalize_failed` step 兜底记录。

这些逻辑已经大量依赖 `run_summary.py` 和 `run_completion.py` 的纯 helper，剩余可以抽成一个依赖注入 flow，让 `run_channel_check()` 的尾部只负责传入上下文并返回 result。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/run_finalize_flow.py`，封装 `asyncio.gather(...)` 之后的 run-level 收尾。该模块允许导入 `run_summary.py` 和 `run_completion.py` 的纯 helper，但不导入 ORM 模型、runtime settings 或外部服务；DB commit/rollback 仍通过传入的 db 对象执行，和当前事务边界一致。

备选方案一：只抽出 execution log 写入和 finalize failure 兜底。改动更小，但状态解析、finish event 和 result completion 仍留在总调度里。

备选方案二：把 run start、订阅处理并发和 run finalize 一起抽成“完整 run orchestration”。拆分收益更大，但会把单订阅处理和最终收尾混在一个新模块里，测试面过宽。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/run_finalize_flow.py`
  - `RunFinalizeDependencies`
    - `log_background_event(...)`
    - `create_execution_log(...)`
    - `create_step_log(...)`
    - `prune_step_logs(db)`
    - `now()`
  - `RunFinalizeResult`
    - `status`
    - `message`
    - `finished_at`
    - `finalize_error`
  - `finalize_subscription_run(...)`
    - 输入 `db`、`channel`、`run_id`、`result`、`started_at`、`hdhive_unlock_context` 和三种 status enum-like 对象。
    - 使用 `resolve_run_status()` 保持当前状态解析规则。
    - 使用 `apply_hdhive_unlock_stats()` 将 unlock stats 写入 result。
    - 使用 `build_run_message()`、`dependencies.now()`、`complete_run_result()` 完成 result。
    - 写 finish background event。
    - 尝试写 execution log、run_finish step、prune step logs 并 `db.commit()`。
    - 如果写入失败：
      - `db.rollback()`。
      - 使用 `apply_run_finalize_error()` 修改 result。
      - 尝试写 `run_finalize_failed` step 并 `db.commit()`。
      - 如果兜底 step 也失败，则 `db.rollback()`。
      - 返回 `finalize_error`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 flow 和 dependencies。
  - 将 `asyncio.gather(...)` 后的收尾段替换为一次 `finalize_subscription_run(...)` 调用。
  - 保留 `_create_execution_log()`、`_create_step_log()` 和 `_prune_step_logs()` 作为注入边界。

新增测试：

- `backend/tests/test_subscription_run_finalize_flow.py`
  - 成功收尾时：
    - 应用 unlock stats。
    - result 写入 status/message/finished_at。
    - 写 finish event。
    - 写 execution log、run_finish step、prune，并 commit 一次。
  - execution log 写入失败时：
    - rollback。
    - result 降级并记录 `finalize_error`。
    - 写 `run_finalize_failed` step 并 commit。
  - 兜底 step 写入也失败时：
    - 第二次 rollback。
    - 返回 finalize error，不吞掉 result 降级。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部服务、API、ORM 模型或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- 状态解析仍使用 `failed_count`、`checked_count` 和 `auto_failed_count`。
- `status` 仍使用传入 enum-like 对象的 `.value` 写入 result 和 finish event。
- HDHive unlock stats 仍在构造 message 前写入 result。
- finish event 仍在 execution log 写入尝试前记录。
- execution log 字段保持 `channel`、`status`、`message`、`checked_count`、`new_resource_count`、`failed_count`、`details`、`started_at`、`finished_at`。
- run_finish step payload 仍由 `build_run_finish_step_payload(result)` 构造。
- execution log 写入成功后仍 prune step logs 并 commit。
- execution log 写入失败时仍 rollback、降级 success 为 partial、写 `run_finalize_failed` step，并尝试 commit。
- `run_finalize_failed` step 写入失败时仍 rollback，不再抛出异常中断返回 result。

## 测试策略

先写 `backend/tests/test_subscription_run_finalize_flow.py` 并运行红测，确认新模块缺失。实现新 flow 并接入 `run_channel_check()` 后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_run_finalize_flow.py tests/test_subscription_run_completion.py tests/test_subscription_run_summary.py tests/test_subscription_execution_logs.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变单订阅处理、并发限制或进度回调逻辑。
- 不改变 run start 日志。
- 不改变 execution log 或 step log 表结构。
- 不改变 `run_summary.py` 和 `run_completion.py` 的纯 helper 语义。
