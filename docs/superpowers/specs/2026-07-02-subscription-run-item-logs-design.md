# 订阅单项资源日志构造拆分设计

## 背景

`SubscriptionService.run_channel_check()` 的单个订阅处理流程中仍直接构造多段资源阶段日志：

- 把 `_fetch_resources()` 返回的 `fetch_trace` 转成 step log 参数
- 构造 `fetch_resources_summary` step log
- 构造 `subscription.item.fetch_done` background event
- 构造 `store_new_resources` step log
- 构造 `subscription.item.store_done` background event

这些逻辑只是把已有资源、trace 和入库统计转换为日志 kwargs，不决定抓取、入库、转存、清理或计数行为。抽离后可以减少 `run_channel_check()` 的字面量噪音，让单项处理主线更清楚。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/run_item_logs.py`，提供纯函数构造 step/event kwargs。`run_channel_check()` 仍负责调用 `_create_step_log()` 和 `operation_log_service.log_background_event()`，并保留调用顺序。

备选方案一：新增异步 helper 直接写日志。这样会把 DB session、operation log service 和调用时序一起移出主流程，变更面更大。

备选方案二：把这些函数放进 `execution_logs.py`。该模块当前负责持久化 step/execution log，混入运行事件 payload 构造会让职责变宽。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/run_item_logs.py`
  - `build_fetch_trace_step_log(trace)`
  - `build_fetch_resources_summary_step(resources, source_attempt_info)`
  - `build_fetch_done_event_kwargs(...)`
  - `build_store_new_resources_step(store_stats, created_records)`
  - `build_store_done_event_kwargs(...)`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 helper。
  - 用 helper 返回值替换 fetch/store 阶段的内联字面量。
  - 保持 `_create_step_log()` 和 `operation_log_service.log_background_event()` 的 await 顺序不变。

新增测试：

- `backend/tests/test_subscription_run_item_logs.py`
  - fetch trace step log 保持当前 step/status/message/payload 默认值，非 dict payload 仍转换为 `None`。
  - fetch summary step log 保持成功/警告状态、message 和 payload 形状。
  - fetch done event 保持 action、status、message、trace_id 和 extra 形状，并从 `fetch_source_selected` trace 中提取 `sources_hit`。
  - store step log 保持新增/无新增 message 和 checked/new/duplicate/invalid payload。
  - store done event 保持 action、status、message 和 extra 形状。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、数据库 session、模型、外部服务或 API。

## 行为保持

必须保持以下行为不变：

- 每条 fetch trace 仍写一条 step log。
- `fetch_resources_summary` 的 status 仍由 `bool(resources)` 决定。
- `subscription.item.fetch_done` 的 status、message、extra 字段保持当前形状。
- `store_new_resources` 的 message 和 payload 字段保持当前形状。
- `subscription.item.store_done` 的 status、message、extra 字段保持当前形状。
- 不改变 `_fetch_resources()`、`_store_new_resources()`、result counter、自动转存或事务处理。

## 测试策略

先写 `backend/tests/test_subscription_run_item_logs.py` 并运行红测，确认新模块缺失。实现 helper 并接入后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_run_item_logs.py tests/test_subscription_run_loader.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不抽离自动转存 new/retry 分支。
- 不抽离固定来源扫描或清理日志。
- 不改日志持久化函数。
- 不改变任何用户可见业务语义。
