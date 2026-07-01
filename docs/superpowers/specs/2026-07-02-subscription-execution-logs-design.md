# 订阅执行日志拆分设计

## 背景

`backend/app/services/subscription_service.py` 仍包含步骤日志和执行日志的持久化细节：

- `_create_step_log()` 构造 `SubscriptionStepLog`，截断 message，并序列化 payload。
- `_prune_step_logs()` 保留最近 1000 条 step log。
- `_create_execution_log()` 写 `SubscriptionExecutionLog`，序列化 details，并保留最近 5 条执行日志。

这些函数不依赖 `SubscriptionService` 状态，也不包含订阅业务决策。把它们抽到独立模块，可以让主服务少承担日志表结构和保留策略细节。

## 方案比较

推荐方案：新增 `app.services.subscriptions.execution_logs`，提供 `create_step_log()`、`prune_step_logs()`、`create_execution_log()`。新模块允许依赖 SQLAlchemy、`AsyncSession` 和日志模型，因为职责就是数据库持久化；但禁止依赖 `subscription_service`、运行时设置、外部服务实例或 API 层。`SubscriptionService` 内保留原私有方法名，作为薄 wrapper。

备选方案一：把日志 helper 并入 `run_summary.py`。这个模块目前是纯函数，不依赖 DB；合并会破坏现有清晰边界。

备选方案二：直接全局替换所有 `_create_step_log()` 调用点。行数收益更大，但调用点很多，容易制造无意义 diff；保留 wrapper 更稳。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/execution_logs.py`
  - `create_step_log(db, *, run_id, channel, step, status, message, subscription_id=None, subscription_title=None, payload=None) -> None`
  - `prune_step_logs(db, *, keep_limit=1000) -> None`
  - `create_execution_log(db, *, channel, status, message, checked_count, new_resource_count, failed_count, details, started_at, finished_at, keep_limit=5) -> None`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入上述三个函数，必要时别名避免和 wrapper 重名。
  - `_create_step_log()` 委托新模块。
  - `_prune_step_logs()` 委托新模块。
  - `_create_execution_log()` 委托新模块。

新增测试：

- `backend/tests/test_subscription_execution_logs.py`
  - step log 会截断 message 到 500 字符，并按 `ensure_ascii=False` 序列化 payload。
  - step log 空 payload 保持 `None`。
  - prune step logs 可按 `keep_limit` 保留最新记录。
  - execution log 会序列化 details，并按 `keep_limit` 保留最新记录。
  - 模块边界：不导入 `subscription_service`、`runtime_settings_service`、`pan115_service`、`pansou_service`、`hdhive_service`、`tg_service` 或 `app.api`。

## 行为保持

必须保持以下行为不变：

- step log `message` 仍截断到 500 字符。
- step log `payload` 为空时仍写 `None`，非空时用 `json.dumps(..., ensure_ascii=False)`。
- step log 默认保留最近 1000 条，排序按 `created_at desc, id desc`。
- execution log `details` 为空时仍写 `None`，非空时用 `json.dumps(..., ensure_ascii=False)`。
- execution log 写入后仍 `flush()`，再保留最近 5 条，排序按 `started_at desc, id desc`。
- `SubscriptionService` 原私有方法签名保持兼容。

## 非目标

- 不改执行状态计算和运行消息生成，它们仍在 `run_summary.py`。
- 不改 operation log。
- 不改任何业务流程的 step 名称、状态、消息或 payload。
- 不批量改所有调用点，只改 wrapper 内部实现。
