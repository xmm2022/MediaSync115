# 订阅运行启动 Flow 拆分设计

## 背景

`SubscriptionService.run_channel_check()` 当前只剩三段主结构：运行启动上下文准备、订阅派发、运行 finalize。其中启动段仍内联了多项 run-level 副作用：

- 生成 `run_id` 和 `started_at`。
- 写 `subscription.check.start` background event。
- 构造初始 result。
- 构造本轮共享的 HDHive unlock context 和 source order。
- 加载 active subscription snapshots。
- 设置 checked count。
- 写 `run_start` step log。
- 发布 start progress payload。

这些逻辑不涉及单订阅处理、资源抓取、转存或 finalize，只负责建立一轮订阅检查的共享上下文。把它抽成 start flow 后，`run_channel_check()` 会保留更清晰的结构：normalize channel -> start run -> dispatch items -> finalize run。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/run_start_flow.py`，提供 `start_subscription_run(...)`。该函数接收已归一化频道、`force_auto_download`、外层 db、progress callback 和依赖 dataclass，返回一个 `SubscriptionRunStartResult`，包含 `run_id`、`started_at`、`result`、`hdhive_unlock_context`、`source_order` 和 `subscriptions`。

备选方案一：只抽 `run_start` step log payload。改动很小，但仍无法收缩 `run_channel_check()` 的上下文准备结构。

备选方案二：把 start、dispatch、finalize 全部合成一个 run orchestration flow。收益大，但会把刚拆出的 dispatch/item/finalize 边界重新压成大集成层。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/run_start_flow.py`
  - `SubscriptionRunStartDependencies`
    - `log_background_event(...)`
    - `create_step_log(...)`
    - `load_active_subscriptions(db)`
    - `build_hdhive_unlock_context()`
    - `resolve_source_order(channel)`
    - `now()`
    - `make_run_id()`
  - `SubscriptionRunStartResult`
    - `run_id`
    - `started_at`
    - `result`
    - `hdhive_unlock_context`
    - `source_order`
    - `subscriptions`
  - `start_subscription_run(...)`
    - 生成 run id 和 started time。
    - 写当前 `subscription.check.start` event shape。
    - 构造初始 result。
    - 构造 unlock context 和 source order。
    - 加载 active subscription snapshots。
    - 调用 `set_checked_count(result, len(subscriptions))`。
    - 写当前 `run_start` step shape。
    - 如果 `progress_callback` 存在，调用 `build_start_progress_payload(result)`。
    - 返回 `SubscriptionRunStartResult`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入 `SubscriptionRunStartDependencies` 和 `start_subscription_run`。
  - 在 `run_channel_check()` 中保留 `normalized_channel = normalize_subscription_channel(channel)`。
  - 用 `start_subscription_run(...)` 替换 run id/start/result/context/subscription loading/start log/start progress block。
  - 将返回值拆回当前局部变量供 dispatch 和 finalize 使用。
  - 移除主服务中不再直接使用的 `uuid4`、`build_initial_run_result`、`build_start_progress_payload`、`load_active_subscription_snapshots`、`set_checked_count` imports。

新增测试：

- `backend/tests/test_subscription_run_start_flow.py`
  - start flow 写 start event、run_start step、checked count 和 start progress。
  - 没有 progress callback 时仍返回完整上下文且不发布 progress。
  - 依赖调用顺序保持：run id/time -> start event -> context/source order -> load subscriptions -> run_start step -> progress。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部服务、API、ORM 模型或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- 频道归一化仍在 `run_channel_check()` 入口发生。
- `run_id` 仍由注入的 `uuid4().hex` 等价行为生成。
- `started_at` 仍由注入的 `beijing_now` 等价行为生成。
- start event action、status、message、trace_id 和 extra shape 不变。
- result 初始字段仍由 `build_initial_run_result()` 生成。
- checked count 仍等于加载到的 active subscription snapshots 数量。
- `run_start` step payload 的 `source_order` 和 `scope` shape 不变。
- start progress callback 仍在 dispatch 前调用，且 payload shape 仍由 `build_start_progress_payload()` 生成。
- HDHive unlock context 和 source order 仍是一轮运行共享一次，不在每个订阅内重建。

## 测试策略

先写 `backend/tests/test_subscription_run_start_flow.py` 并运行红测，确认新模块缺失。实现新 flow 并接入 `run_channel_check()` 后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_run_start_flow.py tests/test_subscription_run_state.py tests/test_subscription_run_loader.py tests/test_subscription_run_dispatch_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变 dispatch 并发或 item processing 行为。
- 不改变 run finalize 行为。
- 不改变 active subscription snapshot 查询规则。
- 不改变 HDHive unlock policy 或 source order policy。
