# 订阅运行收尾拆分设计

## 背景

`SubscriptionService.run_channel_check()` 的末尾仍直接构造多组运行收尾数据：

- 从 `hdhive_unlock_context["stats"]` 回填 HDHive 解锁统计到 result。
- 写入 `finished_at`、`status`、`message`。
- 构造 `subscription.check.finish` 背景日志的 message 和 extra。
- 构造 `run_finish` step log 的 payload。

这些都是固定形状的数据整理，不负责数据库写入、异常处理、状态判定或业务调度。继续留在 `run_channel_check()` 会增加总调度的局部噪音，也让后续拆分收尾异常处理和执行日志写入更难看清边界。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/run_completion.py`，提供纯 helper：

- `apply_hdhive_unlock_stats(result, unlock_stats)`
- `complete_run_result(result, status_value, message, finished_at)`
- `build_run_finish_event_message(channel, result)`
- `build_run_finish_event_extra(channel, result)`
- `build_run_finish_step_payload(result)`

`SubscriptionService` 继续负责调用 `resolve_run_status()`、`build_run_message()`、`beijing_now()`、`operation_log_service`、`_create_execution_log()` 和 `_create_step_log()`。

备选方案一：把这些函数合并进 `run_summary.py`。文件更少，但 `run_summary.py` 已经负责 channel/status/message 规则，再塞日志 payload 会模糊职责。

备选方案二：抽一个异步 `finalize_run()` helper，直接接管日志写入和异常处理。减少行数更多，但会一次性迁移 DB session、日志服务和状态枚举，变更面大，不适合作为本轮小拆分。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/run_completion.py`
  - `apply_hdhive_unlock_stats(result, unlock_stats)`：按现有 key 回填 HDHive 解锁统计，缺失值按 0 处理，并使用当前 `int(value or 0)` 行为。
  - `complete_run_result(result, status_value, message, finished_at)`：写入 `finished_at.isoformat()`、`status`、`message`。
  - `build_run_finish_event_message(channel, result)`：返回当前背景完成日志 message。
  - `build_run_finish_event_extra(channel, result)`：返回当前背景完成日志 extra。
  - `build_run_finish_step_payload(result)`：返回当前 `run_finish` step log payload。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 helper。
  - 用 `apply_hdhive_unlock_stats()` 替代 HDHive 统计字面赋值。
  - 用 `complete_run_result()` 替代最终 result 字段赋值。
  - 用 `build_run_finish_event_message()` 和 `build_run_finish_event_extra()` 替代完成背景日志字面量。
  - 用 `build_run_finish_step_payload()` 替代 `run_finish` step payload 字面量。

新增测试：

- `backend/tests/test_subscription_run_completion.py`
  - HDHive 统计回填保持现有 key、默认值和 `int(value or 0)` 转换。
  - 完成 result 保持 `finished_at`、`status`、`message` 字段。
  - 完成背景日志 message 与现有中文格式一致。
  - 完成背景日志 extra 保持当前 key 集合和值。
  - `run_finish` step payload 保持当前 key 集合和值。
  - 模块边界测试：不导入 `subscription_service`、`runtime_settings_service`、`AsyncSession`、`app.models` 或 `app.api`。

## 行为保持

必须保持以下行为不变：

- `resolve_run_status()` 和 `build_run_message()` 的调用位置和参数不变。
- `finished_at` 仍由 `run_channel_check()` 通过 `beijing_now()` 生成。
- `operation_log_service.log_background_event()` 的调用时机、action、status、trace_id 不变。
- `_create_execution_log()`、`_create_step_log()`、`_prune_step_logs()`、`db.commit()`、异常处理和降级为 partial 的逻辑不变。
- 完成日志 message、extra 和 step payload 的 key 名称、取值来源和顺序保持一致。

## 测试策略

先写 `backend/tests/test_subscription_run_completion.py` 并运行红测，确认新模块缺失。实现 helper 后运行该测试，再改 `SubscriptionService` 并跑下列回归：

- `scripts/verify-backend.sh -- tests/test_subscription_run_completion.py tests/test_subscription_run_state.py tests/test_subscription_run_summary.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改订阅处理循环、并发控制或 progress callback。
- 不改状态判定规则、汇总文案规则或执行日志持久化行为。
- 不抽 `_create_execution_log()` 或收尾异常处理。
- 不引入 dataclass 或新的运行状态对象。
