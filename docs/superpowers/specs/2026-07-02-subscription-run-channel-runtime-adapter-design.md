# 订阅 Run Channel Runtime Adapter 拆分设计

## 背景

`run_channel_check()` 当前已经把多数业务阶段拆到了独立 flow：

- `start_subscription_run()` 负责 run start 日志、初始 result、订阅快照加载和起始进度。
- `process_subscription_item()` 负责单订阅预清理、抓取、入库、自动转存、固定来源和进度发布。
- `dispatch_subscription_checks()` 负责并发限制和逐项调度。
- `finalize_subscription_run()` 负责最终状态、执行日志、step log prune 和 commit/rollback。

剩余问题是 `SubscriptionService.run_channel_check()` 仍直接构造这些 flow 的 dependency dataclass，并在方法内保留 `_process_subscription()` 闭包。它本身已经不承载业务判断，主要是 runtime wiring：

- 绑定 `operation_log_service.log_background_event`。
- 绑定 `beijing_now`、`uuid4().hex`、`async_session_maker`。
- 绑定 `ExecutionStatus`、`MediaType.TV`、并发常量。
- 把大量服务实例方法传给 item-processing flow。
- 串接 start -> dispatch -> finalize 的执行顺序。

把这层 wiring 抽到 runtime adapter 后，主服务只保留 public API 入口和本实例回调列表，`run_channel_check()` 的调度结构可以继续收缩。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/run_channel_runtime_adapter.py`，提供：

- `RunChannelRuntimeDependencies`
- `build_default_run_channel_runtime_dependencies(...)`
- `run_channel_check_with_runtime_adapter(...)`

adapter 负责：

- 标准化 channel。
- 调用 start flow 并构造 `SubscriptionRunStartDependencies`。
- 创建 result lock。
- 创建 item-processing 闭包并构造 `SubscriptionItemProcessingDependencies`。
- 调用 dispatch flow。
- 调用 finalize flow 并构造 `RunFinalizeDependencies`。
- 返回原始 `result` 字典。

`SubscriptionService.run_channel_check()` 只传入 db、channel、force/progress、并发数，以及自身 callback：

- `_create_execution_log`
- `_create_step_log`
- `_prune_step_logs`
- `_build_hdhive_unlock_context`
- `_resolve_source_order`
- `_evaluate_pre_scan_cleanup`
- `_fetch_resources`
- `_store_new_resources`
- `_load_retryable_records`
- `_load_force_retry_records`
- `_auto_save_records_with_link_fallback`
- `_should_scan_fixed_sources`
- `_scan_fixed_sources_for_subscription`
- `_delete_subscription_with_records`

备选方案一：继续在 `SubscriptionService` 内保留 `_process_subscription()`，只抽 start/finalize dependency builder。这样改动更小，但最重的一段 item-processing wiring 仍留在主服务，无法明显降低总调度复杂度。

备选方案二：把 `run_channel_check()` 的整个流程放进现有 `run_dispatch_flow.py`。这会让 dispatch flow 从单一并发调度责任膨胀成总调度 orchestration，职责边界变差。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/run_channel_runtime_adapter.py`
  - `RunChannelRuntimeDependencies`
    - supplied by runtime/default builder:
      - `log_background_event`
      - `create_execution_log`
      - `create_step_log`
      - `prune_step_logs`
      - `load_active_subscriptions`
      - `build_hdhive_unlock_context`
      - `resolve_source_order`
      - `session_factory`
      - `evaluate_pre_scan_cleanup`
      - `fetch_resources`
      - `store_new_resources`
      - `load_retryable_records`
      - `load_force_retry_records`
      - `auto_save_records_with_link_fallback`
      - `should_scan_fixed_sources`
      - `scan_fixed_sources_for_subscription`
      - `delete_subscription_with_records`
      - `now`
      - `make_run_id`
      - `make_result_lock`
      - `success_status`
      - `failed_status`
      - `partial_status`
      - `tv_media_type`
      - `run_start`
      - `dispatch_checks`
      - `process_item`
      - `finalize_run`
  - `build_default_run_channel_runtime_dependencies(...)`
    - 接收服务实例方法 callbacks。
    - 绑定全局 runtime 服务和 constants。
    - 绑定各 lower flow runner。
  - `run_channel_check_with_runtime_adapter(...)`
    - 接收 `db`、`channel`、`force_auto_download`、`progress_callback`、`concurrency` 和 dependencies。
    - 复刻当前 `run_channel_check()` 的执行顺序和参数 shape。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入 runtime adapter builder 和 wrapper。
  - `run_channel_check()` 改为调用 `run_channel_check_with_runtime_adapter(...)`。
  - 移除主服务不再直接使用的 run-start、dispatch、finalize、item-processing、`beijing_now`、`uuid4`、`async_session_maker`、top-level `MediaType` imports。
  - 保留 `_SUBSCRIPTION_SCAN_CONCURRENCY`，由 service 传入 adapter，避免把已有默认并发行为隐藏到新模块。

## 行为保持

必须保持以下行为不变：

- `run_channel_check(db, channel, force_auto_download=False, progress_callback=None)` 签名不变。
- channel normalization 仍由 `normalize_subscription_channel()` 完成。
- start -> dispatch -> finalize 顺序不变。
- `result` 字典仍由 start flow 创建，并由 item-processing/finalize 原地更新后返回。
- 每轮仍使用同一个 `asyncio.Lock()` 保护 result stats。
- 单订阅处理仍使用 `async_session_maker` 新建 inner session。
- 并发数仍为当前 `_SUBSCRIPTION_SCAN_CONCURRENCY`。
- start/finalize 日志、进度 payload、execution log、step log、commit/rollback 仍由现有 flow 控制。
- item-processing 中预清理、资源抓取、入库、自动转存、固定来源扫描和删除订阅 callbacks 不变。

## 测试策略

新增测试文件：

- `backend/tests/test_subscription_run_channel_runtime_adapter.py`
  - adapter 标准化 channel，并按 start -> dispatch/process -> finalize 调用 lower runners。
  - adapter 构造正确的 `SubscriptionRunStartDependencies`、`SubscriptionItemProcessingDependencies`、`SubscriptionRunDispatchDependencies`、`RunFinalizeDependencies`。
  - item-processing 闭包透传 run id、channel、force flag、context、source order、result、progress callback、TV media type 和服务 callbacks。
  - 默认 builder 绑定现有服务、时间、run id 生成器、lock factory、status/media constants 和 lower runners。
  - runtime adapter 不 import `subscription_service`、`app.api` 或 `AsyncSession`。

红测预期：

- 新测试首次运行失败于缺少 `app.services.subscriptions.run_channel_runtime_adapter`。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_run_channel_runtime_adapter.py tests/test_subscription_run_start_flow.py tests/test_subscription_run_dispatch_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_run_finalize_flow.py -q`

随后执行每轮完成标准：相关 targeted backend tests、后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 start、dispatch、item-processing、finalize flow 的业务实现。
- 不改并发策略或错误传播语义。
- 不改任何日志 message、payload、status 计算或 result 字段。
- 不拆 `_fetch_resources()`、`_auto_save_resources()`、资源抓取等已有 wrapper；它们作为当前 service callbacks 继续传入。

## 自检

- 设计只移动 runtime dependency wiring，不改变 lower flow。
- 覆盖 run-level orchestration 的关键调用顺序、参数透传和默认绑定。
- 保留 public API 和并发默认值。
- 为下一步继续收缩资源抓取、质量过滤、通知等 service wrapper 留出清晰边界。
