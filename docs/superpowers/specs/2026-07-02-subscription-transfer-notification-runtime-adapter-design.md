# 订阅转存通知 Runtime Adapter 拆分设计

## 背景

`transfer_notifications.py` 已经承载订阅转存成功通知的核心逻辑：

- 构造 HTML 转义后的消息。
- 调用注入的 `notify()`。
- 捕获发送异常并调用注入的 `log_warning()`。

但 `SubscriptionService._notify_transfer_success()` 仍在主服务中负责 runtime wiring：

- 定义 `notify()` 闭包。
- 在闭包里懒加载 `tg_bot_notify`。
- 构造 `TransferNotificationDependencies`。
- 调用 `notify_transfer_success()`。

这些代码只绑定 TG Bot runtime 和 logger，不改变通知消息业务规则。把它迁入 runtime adapter 后，自动转存批处理仍通过服务兼容方法调用通知，但主服务不再承载 TG Bot wiring。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/transfer_notification_runtime_adapter.py`，提供：

- `TransferNotificationRuntimeDependencies`
- `send_tg_bot_notification(...)`
- `build_default_transfer_notification_runtime_dependencies()`
- `notify_transfer_success_with_runtime_adapter(...)`

服务方法保留原签名，只调用 runtime wrapper。

备选方案一：直接把 `_notify_transfer_success()` 原样移动到 `transfer_notifications.py`。行数收益直接，但会污染核心 helper 的依赖注入边界。

备选方案二：在 `auto_save_resources_runtime_adapter.py` 中直接绑定 TG Bot 通知。这样会把通知 runtime 绑进自动转存 adapter，降低后续复用性。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/transfer_notification_runtime_adapter.py`
  - `TransferNotificationRuntimeDependencies`
    - `notify`
    - `log_warning`
    - `run_notify_transfer_success`
  - `send_tg_bot_notification(message, poster_path=None)`
    - 延续当前懒加载行为，在函数内部导入 `tg_bot_notify`。
    - 调用 `tg_bot_notify(message, poster_path=poster_path)`。
  - `build_default_transfer_notification_runtime_dependencies()`
    - 绑定 `send_tg_bot_notification`。
    - 绑定模块 logger 的 `warning`。
    - 绑定核心 `notify_transfer_success()`。
  - `notify_transfer_success_with_runtime_adapter(...)`
    - 接收现有 `_notify_transfer_success()` 的参数。
    - 构造 `TransferNotificationDependencies(notify=..., log_warning=...)`。
    - 调用 `run_notify_transfer_success(...)`。

修改文件：

- `backend/app/services/subscription_service.py`
  - `_notify_transfer_success()` 改为调用 `notify_transfer_success_with_runtime_adapter(...)`。
  - 移除不再由服务直接使用的 `TransferNotificationDependencies` 与 `notify_transfer_success_flow` imports。

新增测试：

- `backend/tests/test_subscription_transfer_notification_runtime_adapter.py`
  - runtime wrapper 正确把运行时依赖转换为 `TransferNotificationDependencies` 并调用核心 runner。
  - `sub_title`、`resource_name`、`source`、`method`、`poster_path` 全量透传。
  - 注入的 `notify` 与 `log_warning` 可通过 lower dependencies 调用。
  - 默认 builder 绑定现有 core runner，且 notifier/log warning 为 callable。
  - runtime adapter 不 import `subscription_service`、`app.api`、`AsyncSession` 或 ORM model。

## 行为保持

必须保持以下行为不变：

- `_notify_transfer_success()` 静态方法签名不变。
- 通知消息文案、HTML escape、poster_path 透传和异常吞掉行为仍由 `transfer_notifications.py` 负责且不改。
- TG Bot notifier 仍使用 `tg_bot_notify(message, poster_path=poster_path)`。
- 自动转存 batch、share、precise 和 already-received 分支仍通过同一服务 wrapper 调用通知。

## 测试策略

先写 `backend/tests/test_subscription_transfer_notification_runtime_adapter.py` 并运行红测，确认新模块缺失。实现 runtime adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_transfer_notification_runtime_adapter.py tests/test_subscription_transfer_notifications.py tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_auto_transfer_share.py tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_already_received.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变通知消息内容或 HTML 转义规则。
- 不处理 `subscription_run_task_service.py` 内的独立 TG 通知路径。
- 不改变自动转存、后处理或归档触发语义。
