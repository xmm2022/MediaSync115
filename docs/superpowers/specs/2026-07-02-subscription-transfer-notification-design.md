# 订阅转存通知拆分设计

## 背景

`SubscriptionService._notify_transfer_success()` 仍在主服务中负责订阅自动转存成功后的 TG Bot 通知：

- 构造 HTML 消息
- 对订阅名、资源名、来源和方式做 `html.escape`
- 透传 `poster_path`
- 调用 `tg_bot_notify`
- 任意异常只记录 warning，不影响自动转存流程

这段逻辑属于通知适配，不应继续留在 `SubscriptionService` 主体。当前目标是把消息构造和“通知失败不抛出”的流程移到独立 helper；主服务保留 TG Bot 实际发送函数的导入和 logger 注入。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/transfer_notifications.py`，提供 `TransferNotificationDependencies` 和 `notify_transfer_success()`。helper 只依赖注入的 `notify()` 和 `log_warning()`，不直接导入 TG Bot、runtime settings、数据库、API 或 `SubscriptionService`。`SubscriptionService._notify_transfer_success()` 保留原签名，构造依赖后委托新 helper。

备选方案一：直接把 `_notify_transfer_success()` 原样移动到新模块，并在新模块中导入 `tg_bot_notify`。这个方案行数收益更直接，但新模块会绑定 TG Bot 实现，不符合当前订阅 helper 的依赖注入边界。

备选方案二：把所有通知（操作日志、Kafka、TG Bot）统一抽成通知中心。这会涉及运行日志、事件上报和用户通知多个通道，范围过大，不适合当前小步拆分。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/transfer_notifications.py`
  - `TransferNotificationDependencies`
  - `notify_transfer_success(sub_title, resource_name, source, method, poster_path, dependencies)`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 helper。
  - `_notify_transfer_success()` 改为薄包装，继续在 wrapper 中导入 `tg_bot_notify`，并注入 `logger.warning`。

新增测试：

- `backend/tests/test_subscription_transfer_notifications.py`
  - 成功通知会生成与当前相同的 HTML 消息，并透传 `poster_path`。
  - 消息字段继续做 HTML escape。
  - 发送异常时不抛出，调用 warning logger，且 `exc_info=True`。
  - 模块边界测试：不导入 `subscription_service`、`runtime_settings_service`、`tg_bot`、`AsyncSession`、`app.models` 或 `app.api`。

## 数据流

1. 自动转存 helper 继续调用 `SubscriptionService._notify_transfer_success()`。
2. wrapper 创建 `notify(message, poster_path=...)` 回调，内部导入并调用 `tg_bot_notify`。
3. wrapper 创建 `TransferNotificationDependencies(notify=notify, log_warning=logger.warning)`。
4. `notify_transfer_success()` 构造消息：
   - `<b>订阅 · 转存成功</b>`
   - `订阅：...`
   - `资源：...`
   - `来源：...　方式：...`
5. helper 调用注入的 `notify()`。
6. 如果发送或导入回调抛出异常，helper 调用 `log_warning("订阅转存 TG 通知发送失败", exc_info=True)` 并吞掉异常。

## 行为保持

必须保持以下行为不变：

- 消息标题仍为 `<b>订阅 · 转存成功</b>`。
- 字段标签和全角空格格式保持不变。
- `poster_path` 继续传给 TG Bot 通知函数。
- 通知失败不能影响转存状态更新。
- 失败日志 message 仍为 `订阅转存 TG 通知发送失败`，且带 `exc_info=True`。
- `SubscriptionService._notify_transfer_success()` 的静态方法签名保持不变。

## 测试策略

先写 `backend/tests/test_subscription_transfer_notifications.py` 并运行红测，确认新模块缺失。实现 helper 后运行该测试，再改 `SubscriptionService` wrapper 并跑相关回归：

- `scripts/verify-backend.sh -- tests/test_subscription_transfer_notifications.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_auto_transfer_share.py tests/test_subscription_auto_transfer_already_received.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 TG Bot 通知内容。
- 不改自动转存成功、失败、已接收或 postprocess 状态语义。
- 不改 Kafka 事件、operation log 或其它通知通道。
