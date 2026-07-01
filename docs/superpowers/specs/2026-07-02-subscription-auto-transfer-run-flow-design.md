# 订阅自动转存运行 Flow 拆分设计

## 背景

`SubscriptionService.run_channel_check()` 当前仍内联处理单个订阅的自动转存阶段：

- 判断是否开启自动转存。
- 选择 retry 记录。
- 依次执行新资源转存和历史失败重试。
- 记录开始、完成、汇总和跳过日志。
- 在转存结果标记订阅完成时删除订阅和关联记录。
- 将新资源和 retry 转存统计写回本轮汇总。

这些逻辑已经依赖多个已抽离 helper，但 orchestration 仍占据 `run_channel_check()` 的核心内联块。下一步应把它拆成一个独立 flow，让总调度只负责传入上下文、接收统计和继续后续固定来源补扫。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/auto_transfer_run_flow.py`，使用依赖注入封装日志、转存、retry 记录选择、订阅删除和汇总统计应用。该模块不导入 ORM、runtime settings 或外部服务，只处理一段已准备好的订阅上下文。

备选方案一：把自动转存日志构造继续留在 `run_channel_check()`，只抽出转存调用。改动更小，但 run 方法仍需要理解 new/retry 两轮和 cleanup 分支，拆分收益有限。

备选方案二：把自动转存与固定来源补扫一起抽成“订阅处理 tail flow”。能减少更多行数，但会混合两类不同触发条件，测试会更宽，也更容易无意改变固定来源行为。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/auto_transfer_run_flow.py`
  - `AutoTransferRunDependencies`
    - `select_retry_records(...)`
    - `auto_save_records_with_link_fallback(...)`
    - `create_step_log(...)`
    - `log_background_event(...)`
    - `delete_subscription_with_records(...)`
    - `apply_auto_transfer_stats(...)`
    - `apply_cleanup_stats(...)`
  - `AutoTransferRunResult`
    - `sub_saved_count`
    - `sub_failed_transfer_count`
    - `cleanup_after_auto`
    - `retry_records`
  - `run_auto_transfer_for_subscription(...)`
    - 输入当前订阅、run/channel 上下文、新创建记录、重复 URL、force 标志、TV 缺集快照、HDHive unlock 上下文、source order 和 `result_lock`。
    - 未开启自动转存时仅写 skip step，返回零计数和空 retry。
    - 开启自动转存时选择 retry records。
    - 有新记录时先执行 `transfer_source="new"`，写 start/done 日志，应用 new 统计。
    - 只有 new 未触发 cleanup 时才执行 retry，retry 调用禁用 link refetch。
    - 写 summary step，使用新资源数量和 retry 数量保持当前消息格式。
    - 若任一转存结果包含 `subscription_completed`，删除订阅与记录，写 cleanup event/step，并应用 cleanup 统计。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 flow 和 dependencies。
  - 将 `if should_auto_download ... else ...` 内联块替换为一次 flow 调用。
  - 保留 `sub_saved_count`、`sub_failed_transfer_count`、`cleanup_after_auto` 变量给后续固定来源补扫和完成日志使用。
  - 保留 `_load_retryable_records()`、`_load_force_retry_records()`、`_auto_save_records_with_link_fallback()` 和 `_delete_subscription_with_records()` 方法作为注入边界。

新增测试：

- `backend/tests/test_subscription_auto_transfer_run_flow.py`
  - 未开启自动转存时写 skip 日志，不选择 retry，不执行转存。
  - 新资源转存完成并返回 `subscription_completed` 时：
    - 写 new start/done/summary/cleanup 日志。
    - 不执行 retry。
    - 调用删除订阅回调。
    - 应用 new 统计和 cleanup 统计。
  - new 未完成且 retry 存在时：
    - 先转存 new，再转存 retry。
    - retry 调用 `enable_link_refetch=False`。
    - 累加 saved/failed，并分别应用 new/retry 统计。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部网盘服务、API 或 SQLAlchemy session。

## 行为保持

必须保持以下行为不变：

- `should_auto_download = force_auto_download or bool(sub.auto_download)` 的语义不改。
- retry records 的选择仍由 `select_auto_transfer_retry_records()` 和现有 loader 回调决定。
- `created_records` 非空才执行 new 转存。
- 只有未因 new 转存完成触发 cleanup 时才执行 retry。
- retry 转存仍传入 `enable_link_refetch=False`。
- `sub_saved_count` 和 `sub_failed_transfer_count` 仍累加 new、retry 和后续固定来源统计。
- `cleanup_after_auto` 仍只在 stats 含 `subscription_completed` 时设置。
- 转存完成 cleanup 仍删除订阅与关联记录，并按原 cleanup 日志和 result 统计更新。
- 自动转存关闭时仍只写 skip step，不创建 summary step。
- 事务边界仍由 `run_channel_check()` 的 inner session commit/rollback 控制。

## 测试策略

先写 `backend/tests/test_subscription_auto_transfer_run_flow.py` 并运行红测，确认新模块缺失。实现新 flow 并接入 `run_channel_check()` 后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_auto_transfer_retry_records.py tests/test_subscription_run_transfer_logs.py tests/test_subscription_run_cleanup_logs.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变自动转存业务规则、链接回退策略、离线转存策略或精准转存逻辑。
- 不改变固定来源补扫触发条件和固定来源 cleanup 规则。
- 不改变资源抓取、资源入库、运行终态写入或进度回调逻辑。
- 不新增数据库事务或 commit。
