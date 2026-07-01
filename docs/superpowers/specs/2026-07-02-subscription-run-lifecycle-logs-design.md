# 订阅单项生命周期日志构造拆分设计

## 背景

`SubscriptionService.run_channel_check()` 的单项处理里仍直接构造生命周期日志：

- `subscription_start` step log
- 预扫描清理命中后的 `subscription_done` step log
- 预扫描清理命中后的 `subscription.item.done` background event
- 正常处理结束的 `subscription_done` step log
- 正常处理结束的 `subscription.item.done` background event
- 异常处理的 `subscription_failed` step log
- 异常处理的 `subscription.item.failed` background event

这些日志只描述单个订阅处理的开始、结束和失败，不决定资源抓取、入库、自动转存、清理或计数行为。抽离后可以让 `run_channel_check()` 更接近流程骨架。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/run_lifecycle_logs.py`，提供纯函数构造生命周期 step/event kwargs。`run_channel_check()` 继续负责调用 `_create_step_log()`、`operation_log_service.log_background_event()`、异常回滚、失败计数和进度更新。

备选方案一：把整个 `_process_subscription()` 抽成 flow。收益更大，但会移动 session、锁、异常处理和多个服务依赖，本轮风险偏高。

备选方案二：把生命周期日志并入 `run_item_logs.py`。资源阶段日志和生命周期日志可以分开，避免单个 helper 模块继续膨胀。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/run_lifecycle_logs.py`
  - `build_subscription_start_step(subscription_title)`
  - `build_subscription_auto_cleaned_step()`
  - `build_subscription_auto_cleaned_event_kwargs(...)`
  - `build_subscription_done_step()`
  - `build_subscription_done_event_kwargs(...)`
  - `build_subscription_failed_step(error)`
  - `build_subscription_failed_event_kwargs(...)`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 helper。
  - 用 helper 替换单项开始、已清理、正常完成和失败日志字面量。
  - 保持事务、异常处理、result counter 和进度回调不变。

新增测试：

- `backend/tests/test_subscription_run_lifecycle_logs.py`
  - start/auto-cleaned/done/failed step log kwargs 保持当前 step、status、message。
  - auto-cleaned event 保持当前 action、status、message 和 extra。
  - normal done event 保持自动转存启用/未启用两种 message 和 extra。
  - failed event 保持 message 截断到 200 字符，extra error 截断到 500 字符。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、数据库 session、模型、外部服务或 API。

## 行为保持

必须保持以下行为不变：

- 日志写入顺序不变。
- `subscription.item.done` 的 status 仍由本订阅转存失败数是否为 0 决定。
- 正常完成 event 的 message 仍由 `item_parts` 当前拼接格式表达。
- 未启用自动转存时 event extra 的 `auto_saved` 和 `auto_failed` 仍为 `None`。
- 失败 step message 仍截断 `str(exc)[:200]`。
- 失败 event extra error 仍截断 `str(exc)[:500]`。
- 不改变 rollback、失败计数、commit 或 progress callback。

## 测试策略

先写 `backend/tests/test_subscription_run_lifecycle_logs.py` 并运行红测，确认新模块缺失。实现 helper 并接入后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_run_lifecycle_logs.py tests/test_subscription_run_cleanup_logs.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不抽离 `_process_subscription()`。
- 不改变任何异常处理或事务行为。
- 不改变资源、转存、清理、固定来源扫描逻辑。
- 不改变任何业务语义或用户可见结果。
