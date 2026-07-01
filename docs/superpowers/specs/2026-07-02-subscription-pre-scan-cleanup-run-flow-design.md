# 订阅预扫描清理运行 Flow 拆分设计

## 背景

`SubscriptionService.run_channel_check()` 当前已经把预扫描清理判断拆到 `_evaluate_pre_scan_cleanup()`，但 run-level 分支仍内联在单订阅处理主体里：

- 调用 `_evaluate_pre_scan_cleanup()`。
- 如果结果包含 `deleted`，将 cleanup 统计写入本轮 result。
- 写 `subscription_auto_cleaned` step。
- 写 `subscription.item.auto_cleaned` background event。
- commit 当前订阅 inner session 并提前结束。
- 如果未删除，取出 `tv_missing_snapshot` 给后续资源抓取和自动转存使用。

本次拆分只提取这一段 run-level orchestration，让主流程不再直接处理预扫描清理的早退日志和统计细节。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/pre_scan_cleanup_run_flow.py`，封装 evaluate、deleted 早退日志、cleanup 统计和 commit。该模块复用 `run_lifecycle_logs.py` 的纯 helper，不导入 ORM、runtime settings 或外部服务。

备选方案一：只抽出 deleted 分支，不封装 evaluate 调用。改动更小，但主流程仍需要理解 cleanup result 的 shape。

备选方案二：把 subscription start step、pre-scan cleanup、成功 done、失败 failed 和 progress finally 一起抽成生命周期 flow。收益更大，但会把正常路径和异常路径混在一起，测试面过宽。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/pre_scan_cleanup_run_flow.py`
  - `PreScanCleanupRunDependencies`
    - `evaluate_pre_scan_cleanup(db, run_id, channel, sub)`
    - `create_step_log(...)`
    - `log_background_event(...)`
    - `apply_cleanup_stats(media_type)`
  - `PreScanCleanupRunResult`
    - `deleted`
    - `tv_missing_snapshot`
    - `cleanup_result`
  - `run_pre_scan_cleanup_for_subscription(...)`
    - 调用 evaluate 回调。
    - 如果未删除，返回 `deleted=False` 和 `tv_missing_snapshot`。
    - 如果已删除：
      - 调用 cleanup stats 回调。
      - 写 auto-cleaned step。
      - 写 auto-cleaned event。
      - `db.commit()`。
      - 返回 `deleted=True`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 flow 和 dependencies。
  - 将 `_evaluate_pre_scan_cleanup()` 调用和 deleted 早退分支替换为一次 flow 调用。
  - 保留 `_evaluate_pre_scan_cleanup()` 和 result_lock 包装回调作为注入边界。

新增测试：

- `backend/tests/test_subscription_pre_scan_cleanup_run_flow.py`
  - 未删除时返回 `tv_missing_snapshot`，不写日志、不 commit。
  - 已删除时应用 cleanup stats、写 auto-cleaned step/event、commit，并返回 deleted。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部服务、API、ORM 模型或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- 预扫描清理判断仍由 `_evaluate_pre_scan_cleanup()` 现有实现决定。
- `cleanup_result.get("deleted")` 为真才执行早退分支。
- cleanup 统计仍在 auto-cleaned step/event 前应用。
- auto-cleaned step/event 仍使用 `run_lifecycle_logs.py` 现有 helper。
- deleted 分支仍 commit 当前 inner session 并结束该订阅。
- 未删除时不 commit，后续流程继续使用 `tv_missing_snapshot`。
- 事务 rollback 仍由 `run_channel_check()` 外层 `except` 负责。

## 测试策略

先写 `backend/tests/test_subscription_pre_scan_cleanup_run_flow.py` 并运行红测，确认新模块缺失。实现新 flow 并接入 `run_channel_check()` 后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_pre_scan_cleanup_run_flow.py tests/test_pre_scan_cleanup.py tests/test_subscription_run_lifecycle_logs.py tests/test_subscription_run_counters.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变预扫描清理策略。
- 不改变资源抓取、自动转存或固定来源补扫。
- 不改变失败处理和 progress finally 逻辑。
