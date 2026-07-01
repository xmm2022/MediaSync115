# 订阅运行状态拆分设计

## 背景

`SubscriptionService.run_channel_check()` 仍直接维护本轮运行的 result dict 和 progress callback payload：

- 初始化 `checked_count`、`processed_count`、转存统计、资源统计、HDHive 解锁统计、清理统计和错误列表
- 任务开始时构造初始 progress payload
- 每个订阅处理完后构造 running progress payload

这些结构是总调度状态的固定形状，不涉及数据库、转存、搜索或清理业务。把它们抽到 helper 可以降低 `run_channel_check()` 的局部噪音，并为后续继续拆总调度铺路。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/run_state.py`，提供 `build_initial_run_result()`、`build_start_progress_payload()`、`build_processing_progress_payload()`。helper 只做 dict 构造，不导入 runtime settings、数据库、模型、API 或 `SubscriptionService`。`run_channel_check()` 继续持有并更新 result dict。

备选方案一：引入 dataclass 管理 run state。类型更清晰，但需要改大量 `result["..."]` 访问，变更面太大。

备选方案二：直接把 progress callback 逻辑抽到一个 service class。这个方向会把异步回调和并发锁也纳入本轮，容易影响总调度行为。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/run_state.py`
  - `build_initial_run_result(channel, run_id, started_at)`
  - `build_start_progress_payload(result)`
  - `build_processing_progress_payload(result)`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 helper。
  - 用 `build_initial_run_result()` 替代 result 字面量。
  - 用 `build_start_progress_payload()` 替代任务开始 progress payload 字面量。
  - 用 `build_processing_progress_payload()` 替代 finally 中的 progress payload 字面量。

新增测试：

- `backend/tests/test_subscription_run_state.py`
  - 初始 result 保持所有当前 key、默认计数和 `started_at.isoformat()`。
  - start progress payload 保持当前字段和 `"任务开始执行"`。
  - processing progress payload 反映当前 result 计数，并生成 `"已处理 X/Y 项订阅"`。
  - 模块边界测试：不导入 `subscription_service`、`runtime_settings_service`、`AsyncSession`、`app.models` 或 `app.api`。

## 行为保持

必须保持以下行为不变：

- result dict 的 key 名称和默认值不变。
- start progress payload 的 key 名称、默认值和 message 不变。
- processing progress payload 的 key 名称和 message 格式不变。
- result 仍由 `run_channel_check()` 原地更新，helper 不隐藏状态突变。
- 不改并发锁、progress callback 调用时机或异常处理。

## 测试策略

先写 `backend/tests/test_subscription_run_state.py` 并运行红测，确认新模块缺失。实现 helper 后运行该测试，再改 `SubscriptionService` 并跑相关回归：

- `scripts/verify-backend.sh -- tests/test_subscription_run_state.py tests/test_subscription_run_summary.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `run_channel_check()` 的处理顺序。
- 不改订阅查询、资源抓取、转存、固定来源扫描、清理或日志写入语义。
- 不把 result dict 改成 dataclass 或对象。
