# 订阅收尾失败状态拆分设计

## 背景

`SubscriptionService.run_channel_check()` 的 finalize 阶段已经把完成态日志 payload 抽到 `run_completion.py`，但写入执行日志失败时的 except 分支仍直接维护 result 和失败 step payload：

- 将 `{"stage": "run_finalize", "error": finalize_error}` 追加到 `result["errors"]`。
- 写入 `result["finalize_error"]`。
- 将 `result["message"]` 改成原摘要加 `；收尾阶段异常: ...`。
- 当原状态是 success 时降级为 partial。
- 构造 `run_finalize_failed` step log 的 message 和 payload。

这些操作都是固定的数据变形，数据库 rollback/commit 和 `_create_step_log()` 调用本身仍应留在 service 层。

## 方案比较

推荐方案：继续扩展 `backend/app/services/subscriptions/run_completion.py`，新增：

- `apply_run_finalize_error(result, summary_message, finalize_error, success_status_value, partial_status_value)`
- `build_run_finalize_failed_message(finalize_error)`
- `build_run_finalize_failed_payload(finalize_error, status_before_finalize)`

这样保持“运行收尾数据构造”集中在同一个 helper 中，同时不引入 DB、模型或 service 依赖。

备选方案一：新增 `run_finalize_error.py`。职责更窄，但文件粒度过小，和 `run_completion.py` 同属完成态 result/payload 构造。

备选方案二：把整个 finalize try/except 抽成异步 helper。减少 service 行数更多，但会把 DB session、执行日志写入、step log 写入和异常二次兜底一起迁移，风险高于本轮目标。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/run_completion.py`
  - 增加 `apply_run_finalize_error()`：原地更新 result 的 errors/finalize_error/message/status。
  - 增加 `build_run_finalize_failed_message()`：返回当前失败 step message。
  - 增加 `build_run_finalize_failed_payload()`：返回当前失败 step payload。
- `backend/app/services/subscription_service.py`
  - 导入新 helper。
  - 在 finalize except 分支中保留 `finalize_error = str(exc)`、`await db.rollback()`、`try/except` 二次兜底和 `_create_step_log()` 调用。
  - 用 helper 替代 result 更新、message 字面量和 payload 字面量。

修改测试：

- `backend/tests/test_subscription_run_completion.py`
  - 覆盖 success 状态降级为 partial。
  - 覆盖非 success 状态保持不变。
  - 覆盖异常 message 截断 200 字符。
  - 覆盖失败 step payload 截断 500 字符并保留 `status_before_finalize`。
  - 继续保留模块边界测试。

## 行为保持

必须保持以下行为不变：

- finalize exception 捕获范围不变。
- `finalize_error = str(exc)` 的位置不变。
- `await db.rollback()`、失败 step log 写入、`await db.commit()` 和二次失败 rollback 不变。
- 只有当前 result status 等于 success 时才降级为 partial。
- result message 的前缀仍使用 finalize 前的 `message` 变量，而不是已经被修改后的 `result["message"]`。
- step log message 使用 200 字符截断，payload error 使用 500 字符截断。

## 测试策略

先修改 `backend/tests/test_subscription_run_completion.py`，导入新 helper 并添加失败分支测试，运行红测确认新函数缺失。实现 helper 后运行该测试，再改 `SubscriptionService` 并跑下列回归：

- `scripts/verify-backend.sh -- tests/test_subscription_run_completion.py tests/test_subscription_run_summary.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 finalize try/except 的控制流。
- 不改执行日志、step log 或 pruning 的调用顺序。
- 不改 run status 判定规则。
- 不引入新的状态对象或 dataclass。
