# 订阅资源抓取入库运行 Flow 拆分设计

## 背景

`SubscriptionService.run_channel_check()` 的单订阅处理仍内联资源抓取和入库运行层逻辑：

- 调用 `_fetch_resources()` 获取 resources、fetch trace 和 source attempt 信息。
- 为每条 fetch trace 写 step log。
- 写资源抓取 summary step。
- 写 `subscription.item.fetch_done` background event。
- 调用 `_store_new_resources()` 入库。
- 将 store stats 应用到本轮 result。
- 写入库 step log 和 `subscription.item.store_done` background event。
- 将 `created_records` 和 `duplicate_urls` 交给后续自动转存 flow。

资源来源解析、fetcher adapter、DB storage adapter 已经拆分；本次只提取 run-level orchestration，减少单订阅主体里对抓取/入库日志和 result 统计细节的直接处理。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/resource_ingest_run_flow.py`，使用依赖注入封装 fetch、fetch logs、store、store stats 和 store logs。该模块复用 `run_item_logs.py` 的纯 helper，不导入 ORM、runtime settings 或外部服务。

备选方案一：只抽出 fetch logs 或 store logs。改动更小，但 `run_channel_check()` 仍需要理解抓取和入库两个连续阶段。

备选方案二：把 pre-scan cleanup、fetch/store、auto transfer 都合成一个“单订阅成功路径 flow”。减行更多，但依赖面过宽，测试会同时覆盖太多职责。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/resource_ingest_run_flow.py`
  - `ResourceIngestRunDependencies`
    - `fetch_resources(channel, sub, hdhive_unlock_context, source_order=...)`
    - `store_new_resources(db, subscription_id, resources)`
    - `create_step_log(...)`
    - `log_background_event(...)`
    - `apply_resource_store_stats(store_stats)`
  - `ResourceIngestRunResult`
    - `resources`
    - `fetch_trace`
    - `source_attempt_info`
    - `store_stats`
    - `created_records`
    - `duplicate_urls`
  - `run_resource_ingest_for_subscription(...)`
    - 调用 fetch 回调并保留返回三元组。
    - 逐条写 fetch trace step。
    - 写 fetch summary step 和 fetch done event。
    - 调用 store 回调。
    - 从 store stats 读取 `created_records` 和 `duplicate_urls`。
    - 调用 result 统计回调。
    - 写 store step 和 store done event。
    - 返回后续自动转存需要的数据。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 flow 和 dependencies。
  - 将 pre-scan cleanup 后、自动转存前的 fetch/store 内联块替换为一次 flow 调用。
  - 保留 `_fetch_resources()`、`_store_new_resources()` 和 result_lock 包装回调作为注入边界。

新增测试：

- `backend/tests/test_subscription_resource_ingest_run_flow.py`
  - fetch/store 成功路径写 trace、summary、fetch event、store step 和 store event，并返回 created/duplicate。
  - 空资源路径仍写 warning fetch summary/event、store stats 和 info store event。
  - store stats 会通过注入回调应用到 result。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部服务、API、ORM 模型或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- fetch 回调参数仍为 `channel`、`sub`、`hdhive_unlock_context` 和 keyword-only `source_order`。
- fetch trace step 仍逐条使用 `build_fetch_trace_step_log(trace)`。
- fetch summary 仍使用 `build_fetch_resources_summary_step(resources, source_attempt_info)`。
- fetch done event 仍使用 `build_fetch_done_event_kwargs(...)`。
- store 回调仍传入 `db`、`subscription_id` 和 `resources`。
- `created_records` 仍来自 `store_stats["created_records"]`。
- `duplicate_urls` 仍来自 `store_stats["duplicate_urls"]`。
- result 统计仍在 store 后、store logs 前应用。
- store step 和 event 仍使用现有 `run_item_logs.py` helper。
- 事务边界仍由 `run_channel_check()` 的 inner session commit/rollback 控制。

## 测试策略

先写 `backend/tests/test_subscription_resource_ingest_run_flow.py` 并运行红测，确认新模块缺失。实现新 flow 并接入 `run_channel_check()` 后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_resource_ingest_run_flow.py tests/test_subscription_run_item_logs.py tests/test_subscription_run_counters.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_storage.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变任何资源来源顺序、fallback、quality filter 或 fetcher 规则。
- 不改变资源入库去重、无效资源、离线资源或 DB 记录创建规则。
- 不改变自动转存、固定来源补扫或订阅完成日志。
