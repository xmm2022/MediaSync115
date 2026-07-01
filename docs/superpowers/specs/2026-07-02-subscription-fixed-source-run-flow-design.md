# 订阅固定来源运行 Flow 拆分设计

## 背景

`SubscriptionService.run_channel_check()` 当前仍内联处理固定来源补扫后的运行层逻辑：

- 在自动转存未触发订阅清理时判断是否扫描固定来源。
- 调用 `_scan_fixed_sources_for_subscription()` 获取 `saved` / `failed` 统计。
- 将固定来源转存统计累加到单订阅 saved/failed 计数。
- 将固定来源统计写入本轮 result。
- 当电影固定来源转存成功时删除订阅和关联记录，并写 cleanup 事件与 step。
- 将电影 cleanup 计入本轮 cleanup 统计。

实际固定来源扫描规则已经在 `fixed_source_scan.py`，日志构造已经在 `run_cleanup_logs.py`。本次拆分应只提取运行层 orchestration，降低 `run_channel_check()` 对这段细节的直接了解。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/fixed_source_run_flow.py`，使用依赖注入封装固定来源扫描调用、结果累计、result 统计应用和电影 cleanup。该模块不导入 ORM、runtime settings 或外部服务，只接收订阅上下文和必要回调。

备选方案一：继续只使用 `fixed_source_scan.py`，把结果应用保留在 `run_channel_check()`。改动最少，但总调度仍需要知道固定来源 cleanup 和统计细节。

备选方案二：把固定来源扫描和结果应用合并进 `fixed_source_scan.py`。会让 scan helper 既负责扫描也负责运行 result 和订阅删除，破坏当前模块的纯扫描边界。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/fixed_source_run_flow.py`
  - `FixedSourceRunDependencies`
    - `should_scan_fixed_sources(sub, force_auto_download=...)`
    - `scan_fixed_sources_for_subscription(db, run_id, channel, sub, tv_missing_snapshot, force_auto_download)`
    - `create_step_log(...)`
    - `log_background_event(...)`
    - `delete_subscription_with_records(db, subscription_id)`
    - `apply_fixed_source_transfer_stats(saved, failed)`
    - `apply_cleanup_stats(media_type)`
  - `FixedSourceRunResult`
    - `sub_saved_count_delta`
    - `sub_failed_transfer_count_delta`
    - `fixed_source_stats`
    - `movie_cleanup_applied`
  - `run_fixed_source_for_subscription(...)`
    - 如果 `cleanup_after_auto` 非空，直接跳过，避免和自动转存 cleanup 重复删除订阅。
    - 如果 policy 不允许固定来源扫描，直接返回零增量。
    - 调用注入的 scan 回调，转换 `saved` / `failed` 为整数。
    - 调用注入的 result 统计回调。
    - 当订阅为电影且 `saved > 0` 时，删除订阅与关联记录，写固定来源 cleanup event/step，并调用 cleanup 统计回调。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 flow 和 dependencies。
  - 将固定来源补扫内联块替换成一次 flow 调用。
  - 将返回的 saved/failed delta 累加到 `sub_saved_count` 和 `sub_failed_transfer_count`。
  - 保留 `_should_scan_fixed_sources()` 与 `_scan_fixed_sources_for_subscription()` 作为注入边界。

新增测试：

- `backend/tests/test_subscription_fixed_source_run_flow.py`
  - `cleanup_after_auto` 非空时跳过 policy 和 scan。
  - policy 返回 false 时跳过 scan，并返回零增量。
  - TV 固定来源扫描后只应用 saved/failed 统计，不删除订阅。
  - 电影固定来源 saved > 0 时删除订阅、写 cleanup event/step，并应用 cleanup 统计。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部服务、API 或 SQLAlchemy session。

## 行为保持

必须保持以下行为不变：

- 自动转存已经触发 cleanup 时不再扫描固定来源。
- 固定来源扫描是否执行仍由 `_should_scan_fixed_sources()` 现有策略决定。
- 固定来源扫描本体仍由 `_scan_fixed_sources_for_subscription()` 现有实现执行。
- `saved` 和 `failed` 仍通过 `int(stats.get(...) or 0)` 规范化。
- 固定来源 saved/failed 仍累加到单订阅完成日志使用的 `sub_saved_count` 和 `sub_failed_transfer_count`。
- 本轮 result 仍通过 `apply_fixed_source_transfer_stats(result, saved=..., failed=...)` 更新。
- 只有电影且固定来源 saved > 0 时才删除订阅并计入 cleanup。
- TV 固定来源成功不在该尾部删除订阅，仍交给既有缺集/完成清理策略。
- 事务边界仍由 `run_channel_check()` 的 inner session commit/rollback 控制。

## 测试策略

先写 `backend/tests/test_subscription_fixed_source_run_flow.py` 并运行红测，确认新模块缺失。实现新 flow 并接入 `run_channel_check()` 后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_fixed_source_run_flow.py tests/test_fixed_source_scan.py tests/test_subscription_run_cleanup_logs.py tests/test_subscription_run_counters.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变固定来源扫描条件、手动来源扫描、文件选择或质量过滤逻辑。
- 不改变自动转存 cleanup 逻辑。
- 不改变 TV 订阅完成清理策略。
- 不改变运行终态、进度回调或失败处理逻辑。
