# 订阅转存阶段组合 Run Flow 拆分设计

## 背景

`SubscriptionService.run_channel_check()` 的 `_process_subscription()` 里，资源抓取入库之后仍内联了一段较长的转存阶段编排：

- 计算 `should_auto_download = force_auto_download or bool(sub.auto_download)`。
- 构造自动转存重试记录选择回调。
- 构造自动转存统计和 cleanup 统计回调。
- 调用 `run_auto_transfer_for_subscription()`。
- 读取自动转存 saved/failed 和 `cleanup_after_auto`。
- 构造固定来源转存统计和 cleanup 统计回调。
- 调用 `run_fixed_source_for_subscription()`。
- 将固定来源 saved/failed delta 合并到本订阅 saved/failed 计数。

其中自动转存和固定来源各自的业务已经拆到独立 flow，但两者的组合阶段仍让主流程承担过多依赖装配和计数合并。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/transfer_phase_run_flow.py`，封装重试记录选择、自动转存 flow、固定来源 flow 的组合调用和 saved/failed 计数合并。新模块只导入本地已拆分 helper/flow，不导入 ORM、runtime settings 或外部服务。

备选方案一：只抽自动转存依赖装配。改动较小，但固定来源 delta 合并仍留在主流程。

备选方案二：把资源抓取、转存阶段和成功收尾一起抽成完整单订阅成功路径。收益更大，但会把三个已拆出的 flow 再包成过大的集成层，红测很难保持窄。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/transfer_phase_run_flow.py`
  - `SubscriptionTransferPhaseDependencies`
    - `load_retryable_records(db, subscription_id)`
    - `load_force_retry_records(db, subscription_id, duplicate_urls)`
    - `auto_save_records_with_link_fallback(...)`
    - `should_scan_fixed_sources(sub, force_auto_download=...)`
    - `scan_fixed_sources_for_subscription(...)`
    - `create_step_log(...)`
    - `log_background_event(...)`
    - `delete_subscription_with_records(db, subscription_id)`
    - `apply_auto_transfer_stats(stats, transfer_source)`
    - `apply_fixed_source_transfer_stats(saved, failed)`
    - `apply_cleanup_stats(media_type)`
  - `SubscriptionTransferPhaseResult`
    - `should_auto_download`
    - `sub_saved_count`
    - `sub_failed_transfer_count`
    - `auto_transfer_result`
    - `fixed_source_result`
  - `run_subscription_transfer_phase(...)`
    - 计算 `should_auto_download`。
    - 通过 `select_auto_transfer_retry_records()` 构造并执行 retry selection。
    - 调用 `run_auto_transfer_for_subscription()`。
    - 调用 `run_fixed_source_for_subscription()`。
    - 将 fixed-source delta 累加到本订阅 saved/failed 计数。
    - 返回组合结果。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 flow 和 dependencies。
  - 将资源入库之后、成功收尾之前的转存阶段块替换为一次 `run_subscription_transfer_phase(...)` 调用。
  - 保留 `result_lock` 包装的 run-level result 统计回调作为注入边界。
  - 移除主服务中不再直接使用的 auto-transfer/fixed-source/retry selection imports。

新增测试：

- `backend/tests/test_subscription_transfer_phase_run_flow.py`
  - 自动转存启用时执行新资源转存、重试选择和固定来源补扫，并合并 saved/failed 计数。
  - 自动转存完成 cleanup 时固定来源补扫被跳过，cleanup 统计仍通过注入回调执行。
  - 未启用自动转存时仍返回 `should_auto_download=False`，不加载 retry records，固定来源策略仍按现有规则由 fixed-source flow 判断。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部服务、API、ORM 模型或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- `should_auto_download` 仍等于 `force_auto_download or bool(sub.auto_download)`。
- retry records 仍由 `select_auto_transfer_retry_records()` 和现有 loader 回调决定。
- 自动转存 flow 仍先于固定来源 flow 执行。
- 自动转存产生 `cleanup_after_auto` 时，固定来源 flow 仍由现有 `run_fixed_source_for_subscription()` 逻辑跳过。
- 自动转存 stats 仍按 `transfer_source` 应用到 run-level result。
- 固定来源 stats 仍通过 saved/failed delta 应用到 run-level result。
- movie cleanup / TV cleanup 统计仍由 auto/fixed 子 flow 决定，组合层只透传 `apply_cleanup_stats`。
- 成功 done event 的 `new_record_count` 仍由主流程使用 `len(created_records)` 计算，不由组合层改写。

## 测试策略

先写 `backend/tests/test_subscription_transfer_phase_run_flow.py` 并运行红测，确认新模块缺失。实现新 flow 并接入 `run_channel_check()` 后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_fixed_source_run_flow.py tests/test_subscription_auto_transfer_retry_records.py tests/test_subscription_run_counters.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变自动转存、固定来源扫描或重试记录选择的内部业务规则。
- 不改变资源抓取入库 flow。
- 不改变单订阅成功/失败收尾 flow。
- 不移动 processed count 和 progress callback。
