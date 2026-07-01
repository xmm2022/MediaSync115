# 订阅清理计数器拆分设计

## 背景

`SubscriptionService` 里还保留了一个 `_apply_cleanup_stats()` 静态方法，用来在订阅被自动清理时更新 result：

- `cleanup_deleted_count` 总数加 1。
- 当 `media_type == MediaType.TV` 时，`cleanup_tv_deleted_count` 加 1。
- 其他类型进入 `cleanup_movie_deleted_count` 分支。

这个方法只做 result 计数变更，已经和 `run_counters.py` 的职责一致。把它移到计数器 helper 可以让 `SubscriptionService` 少保留一个与服务依赖无关的静态方法。

## 方案比较

推荐方案：扩展 `backend/app/services/subscriptions/run_counters.py`，新增 `apply_cleanup_stats(result, media_type, tv_media_type)`。helper 只比较调用方传入的 TV 类型值，不导入 `MediaType` 或模型层。`SubscriptionService` 在原来的 `result_lock` 内调用 helper，并传入 `MediaType.TV`。

备选方案一：保留 `_apply_cleanup_stats()`。改动最小，但它已经是纯计数逻辑，继续留在 service 中会让 result 统计分散。

备选方案二：让 helper 直接导入 `MediaType`。调用更短，但会破坏当前 helper 模块不依赖模型层的边界。

## 组件设计

修改文件：

- `backend/app/services/subscriptions/run_counters.py`
  - 新增 `apply_cleanup_stats(result, media_type, tv_media_type)`。
  - 保持现有行为：TV 加 TV 计数，非 TV 加电影计数。
- `backend/app/services/subscription_service.py`
  - 导入 `apply_cleanup_stats`。
  - 三个清理计数调用点改为新 helper。
  - 删除 `_apply_cleanup_stats()` 静态方法。

修改测试：

- `backend/tests/test_subscription_run_counters.py`
  - 覆盖 TV 清理统计。
  - 覆盖非 TV 清理统计进入电影计数。
  - 保持模块边界测试。

## 行为保持

必须保持以下行为不变：

- 三个调用点仍在原来的 `result_lock` 内执行。
- `cleanup_deleted_count` 继续使用 `int(result.get(...) or 0) + 1`。
- `cleanup_tv_deleted_count` 只在 media type 等于 TV 类型时增加。
- 非 TV 类型继续进入电影清理计数分支。
- 不改自动清理触发条件、删除订阅、日志或 step payload。

## 测试策略

先修改 `backend/tests/test_subscription_run_counters.py`，导入 `apply_cleanup_stats` 并添加清理计数测试，运行红测确认新函数缺失。实现 helper 后运行该测试，再改 `SubscriptionService` 并跑下列回归：

- `scripts/verify-backend.sh -- tests/test_subscription_run_counters.py tests/test_subscription_run_completion.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改清理策略。
- 不改 `cleanup_completed_subscriptions` 或预扫描清理 helper。
- 不改变 movie/TV 分类规则。
- 不引入新的 result 对象。
