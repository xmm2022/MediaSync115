# 订阅运行计数器拆分设计

## 背景

`SubscriptionService.run_channel_check()` 的主处理循环仍在多个分支里直接更新 result 统计字段：

- 设置本轮 `checked_count`。
- 资源入库后累加 `new_resource_count`、`resource_checked_count`、`resource_duplicate_count`。
- 新资源转存后累加总转存统计和 `auto_new_*` 统计，并合并错误列表。
- 历史重试转存后累加总转存统计和 `auto_retry_*` 统计，并合并错误列表。
- 固定来源转存后累加总转存统计。
- 单个订阅异常时累加 `failed_count` 并追加错误详情。
- finally 中累加 `processed_count`。

这些都是纯 result 计数变更，不负责锁、日志、数据库、转存、资源抓取或状态判定。抽到 helper 后，`run_channel_check()` 可以保留“何时加锁、何时调用”的调度职责，减少散落的字段级写入。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/run_counters.py`，提供纯函数：

- `set_checked_count(result, checked_count)`
- `apply_resource_store_stats(result, store_stats)`
- `apply_auto_transfer_stats(result, auto_stats, transfer_source)`
- `apply_fixed_source_transfer_stats(result, saved, failed)`
- `apply_subscription_failure(result, subscription_id, title, error)`
- `increment_processed_count(result)`

所有 helper 只接收 dict 和标量，不导入 DB、模型、service 或 API。`SubscriptionService` 继续在原来的 `result_lock` 内调用这些函数。

备选方案一：把计数逻辑合并进 `run_state.py`。文件更少，但 `run_state.py` 当前负责初始化和 progress payload 构造，继续塞运行中计数变更会混合职责。

备选方案二：引入 `RunResult` 类封装所有状态。类型更清晰，但需要替换大量 `result["..."]` 读写，变更面大，不适合本轮小拆分。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/run_counters.py`
  - `set_checked_count()`：写入 `checked_count`。
  - `apply_resource_store_stats()`：读取 `created_records`、`checked_count`、`duplicate_count`，按现有方式累加统计。
  - `apply_auto_transfer_stats()`：按 `transfer_source == "new"` 或 `"retry"` 累加总转存统计和对应来源统计，并在 `errors` 非空时 extend 到 result。
  - `apply_fixed_source_transfer_stats()`：累加固定来源转存的总成功/失败数。
  - `apply_subscription_failure()`：累加失败数并追加当前错误详情。
  - `increment_processed_count()`：累加已处理订阅数。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 helper。
  - 用 helper 替换上述 result 直接写入。
  - 保持所有 helper 调用仍在原来的 `result_lock` 范围内。

新增测试：

- `backend/tests/test_subscription_run_counters.py`
  - 资源入库统计保持当前计数规则。
  - 新资源转存统计写入总计和 `auto_new_*`。
  - 重试转存统计写入总计和 `auto_retry_*`。
  - 固定来源统计只写入总转存计数。
  - 订阅失败统计保留当前错误详情结构。
  - checked/processed 计数 helper 保留当前赋值和累加行为。
  - 模块边界测试：不导入 `subscription_service`、`runtime_settings_service`、`AsyncSession`、`app.models` 或 `app.api`。

## 行为保持

必须保持以下行为不变：

- 不改变 result_lock 的持有范围。
- 不改变任何日志、DB commit/rollback、资源抓取或转存调用顺序。
- `apply_resource_store_stats()` 继续对 `checked_count` 和 `duplicate_count` 使用 `int(...)`。
- 自动转存 stats 的 `saved`、`failed` 和 `errors` 继续按当前 key 读取。
- 新资源和重试来源分别只写入自己的来源统计字段。
- 单项失败错误详情仍是 `subscription_id`、`title`、`error` 三个字段。

## 测试策略

先写 `backend/tests/test_subscription_run_counters.py` 并运行红测，确认新模块缺失。实现 helper 后运行该测试，再改 `SubscriptionService` 并跑下列回归：

- `scripts/verify-backend.sh -- tests/test_subscription_run_counters.py tests/test_subscription_run_completion.py tests/test_subscription_run_state.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不移动 `_apply_cleanup_stats()`；清理计数涉及 media type 分类，留到单独小块处理。
- 不删除或改写订阅 item 日志。
- 不修正既有未使用局部变量。
- 不引入 dataclass 或新的 result 对象。
