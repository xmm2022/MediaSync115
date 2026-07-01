# 订阅转存后处理状态拆分设计

## 背景

`SubscriptionService._apply_precise_transfer_postprocess_status()` 仍在主服务中负责精准转存后的状态更新：

- 调用 `media_postprocess_service.trigger_archive_after_transfer(trigger="subscription_transfer")`
- 如果归档任务被触发，将记录状态置为 `MediaStatus.ARCHIVING`，并清空 `completed_at`
- 如果未触发归档，将记录状态置为 `MediaStatus.COMPLETED`，并写入当前北京时间
- 清空 `record.error_message`
- 返回归档触发结果

这段逻辑是自动转存后处理状态适配，不需要留在 `SubscriptionService` 主体。目标是把状态决策移到独立 helper，主服务继续注入归档服务、状态枚举和时间函数。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/postprocess_status.py`，提供 `PostprocessStatusDependencies` 和 `apply_precise_transfer_postprocess_status(record, dependencies)`。helper 只依赖注入的归档触发回调、状态值和 `now()`，不直接导入 runtime settings、数据库、模型、API 或 `SubscriptionService`。

备选方案一：把函数原样移动到新模块并直接导入 `media_postprocess_service`、`MediaStatus` 和 `beijing_now`。改动最少，但会把 runtime/service/model 依赖带进 helper，测试隔离差。

备选方案二：把所有自动转存状态更新集中到一个大状态机。这个方向可能更系统，但会触及 share、offline、already-received、failure 等多个 helper，不适合当前小步拆分。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/postprocess_status.py`
  - `PostprocessStatusDependencies`
  - `apply_precise_transfer_postprocess_status(record, dependencies)`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 helper。
  - `_apply_precise_transfer_postprocess_status()` 改为薄包装，注入归档触发器、状态值和 `beijing_now`。

新增测试：

- `backend/tests/test_subscription_postprocess_status.py`
  - 归档触发时记录进入 `ARCHIVING`，`completed_at` 清空，错误清空，并返回归档结果。
  - 归档未触发时记录进入 `COMPLETED`，`completed_at` 使用注入时间，错误清空。
  - helper 调用归档触发器时 trigger 保持 `subscription_transfer`。
  - 模块边界测试：不导入 `subscription_service`、`media_postprocess_service`、`runtime_settings_service`、`AsyncSession`、`app.models` 或 `app.api`。

## 数据流

1. 自动转存批处理 helper 继续调用 `SubscriptionService._apply_precise_transfer_postprocess_status(record)`。
2. wrapper 构造 `PostprocessStatusDependencies`：
   - `trigger_archive_after_transfer=media_postprocess_service.trigger_archive_after_transfer`
   - `archiving_status=MediaStatus.ARCHIVING`
   - `completed_status=MediaStatus.COMPLETED`
   - `now=beijing_now`
3. helper 调用归档触发器，固定传入 `trigger="subscription_transfer"`。
4. helper 根据 `archive_result.get("triggered")` 更新 record。
5. helper 清空 `record.error_message` 并返回 `archive_result`。

## 行为保持

必须保持以下行为不变：

- trigger 字符串仍为 `subscription_transfer`。
- `archive_result.get("triggered")` 为真时状态为 `ARCHIVING`，`completed_at = None`。
- 未触发归档时状态为 `COMPLETED`，`completed_at = beijing_now()`。
- 两种路径都清空 `error_message`。
- 返回值仍是归档触发器返回的 dict。
- 不改变事务提交、flush 或自动转存批处理语义。

## 测试策略

先写 `backend/tests/test_subscription_postprocess_status.py` 并运行红测，确认新模块缺失。实现 helper 后运行该测试，再改 `SubscriptionService` wrapper 并跑相关回归：

- `scripts/verify-backend.sh -- tests/test_subscription_postprocess_status.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_already_received.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改归档服务实现。
- 不改普通分享转存、离线转存、失败处理或已接收处理逻辑。
- 不引入新的 postprocess 配置。
