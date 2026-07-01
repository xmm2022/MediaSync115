# 订阅运行派发 Flow 拆分设计

## 背景

`SubscriptionService.run_channel_check()` 经过前几轮拆分后，单项处理内部已经主要由阶段 flow 组成，但入口处仍内联了运行派发结构：

- 创建 `_SUBSCRIPTION_SCAN_CONCURRENCY` 对应的 `asyncio.Semaphore`。
- 定义 `_bounded_subscription()` 在 semaphore 内调用 `_process_subscription()`。
- 非空订阅列表通过 `asyncio.gather()` 并发执行。

这部分不承担资源抓取、转存、cleanup、统计或通知业务，只负责把已加载的订阅快照按固定并发上限派发到单项处理函数。把它抽成独立 helper 后，`run_channel_check()` 会更接近“准备运行上下文 -> 派发单项 -> finalize”的结构。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/run_dispatch_flow.py`，提供依赖注入式 `dispatch_subscription_checks(...)`。该函数接收订阅快照序列、并发上限和 `process_subscription(sub)` 回调，在内部创建 semaphore 并用 `asyncio.gather()` 执行。新模块只导入标准库，不导入 ORM、runtime settings、外部服务或 `subscription_service`。

备选方案一：直接把 `_process_subscription()` 整体抽到新模块。收益更大，但需要一次性迁移大量服务依赖和 result 统计闭包，改动面过宽。

备选方案二：只把 `_bounded_subscription()` 抽成内部方法。文件行数略降，但仍让主服务直接管理 semaphore/gather，测试价值有限。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/run_dispatch_flow.py`
  - `SubscriptionRunDispatchDependencies`
    - `process_subscription(sub)`
  - `dispatch_subscription_checks(...)`
    - 参数：
      - `subscriptions`
      - `concurrency`
      - `dependencies`
    - 内部创建 `asyncio.Semaphore(concurrency)`。
    - 对每个订阅快照创建 bounded coroutine。
    - 当订阅列表非空时 `await asyncio.gather(...)`。
    - 空列表时直接返回，不调用 `process_subscription`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入 `SubscriptionRunDispatchDependencies` 和 `dispatch_subscription_checks`。
  - 保留 `_process_subscription()` 在 `run_channel_check()` 内部，维持当前 session、result lock、progress callback 和阶段依赖装配边界。
  - 将 inline `Semaphore` / `_bounded_subscription()` / `asyncio.gather()` 替换为 `dispatch_subscription_checks(...)`。
  - 如果主服务不再直接使用 `asyncio`，移除对应 import。

新增测试：

- `backend/tests/test_subscription_run_dispatch_flow.py`
  - 空订阅列表不调用 `process_subscription`。
  - 多订阅按传入并发上限运行，且每个订阅处理一次。
  - `process_subscription` 抛出的异常仍由 dispatch flow 向上游传播。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部服务、API、ORM 模型或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- 并发上限仍由 `SubscriptionService` 传入 `_SUBSCRIPTION_SCAN_CONCURRENCY`。
- 每个订阅仍通过同一个 `_process_subscription(sub)` 逻辑处理。
- 单项处理内部仍独立打开 `async_session_maker()` session。
- 单项处理异常仍在 `_process_subscription()` 内部转换为 failure 结果；如果派发层或回调外侧出现未捕获异常，仍由 `asyncio.gather()` 向上游传播。
- 空订阅列表不创建额外任务。

## 测试策略

先写 `backend/tests/test_subscription_run_dispatch_flow.py` 并运行红测，确认新模块缺失。实现新 flow 并接入 `run_channel_check()` 后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_run_dispatch_flow.py tests/test_subscription_item_lifecycle_run_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变 `_SUBSCRIPTION_SCAN_CONCURRENCY` 的值。
- 不迁移 `_process_subscription()` 的业务编排。
- 不改变 result lock、progress callback 或 run finalize 行为。
- 不改变资源抓取、转存、固定来源、cleanup、质量过滤或通知业务。
