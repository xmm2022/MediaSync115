# 订阅完成后清理 Runtime Adapter 拆分设计

## 背景

`completed_cleanup.py` 已经承载离线完成后清理订阅的核心规则：

- 扫描本地 MediaSync115 订阅。
- 判断电影是否已有成功转存、已在 Emby 或飞牛。
- 判断 TV 订阅是否已不缺集，并兼容 new follow mode 的 upcoming 逻辑。
- 删除符合条件的订阅，处理 commit 并发冲突重试，写操作日志。
- 支持单订阅手动清理入口。

`SubscriptionService` 目前仍通过 `_completed_cleanup_dependencies()` 组装运行时依赖：

- 本地回调：`_delete_subscription_with_records()`、`_check_feiniu_movie_status()`。
- 全局服务：`operation_log_service.log_background_event`、`emby_service.get_movie_status_by_tmdb`、`tv_missing_service.get_tv_missing_status`。
- 策略 helper：`has_upcoming_episodes_in_subscription_scope`。
- `asyncio.sleep` 重试等待。
- core runners：`cleanup_completed_subscriptions()` 和 `cleanup_single_subscription()`。

这段组装只是 runtime wiring。把它抽到 runtime adapter 后，主服务的完成后清理 public methods 仍保留原签名，但不再直接构造 `CompletedCleanupDependencies`。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py`，提供：

- `CompletedCleanupRuntimeDependencies`
- `build_default_completed_cleanup_runtime_dependencies(...)`
- `cleanup_completed_subscriptions_with_runtime_adapter(...)`
- `cleanup_single_subscription_with_runtime_adapter(...)`

服务 wrapper 只传入删除订阅和飞牛电影状态两个本地回调。

备选方案一：把默认 builder 放进 `completed_cleanup.py`。这样会把 Emby、TV missing、operation log 和全局 sleep 绑定带进 core cleanup 模块，破坏现有依赖注入测试约束。

备选方案二：让 `SubscriptionService` 继续保留 `_completed_cleanup_dependencies()`。改动最小，但完成后清理仍是主服务中的 runtime wiring 尾巴，后续总调度拆分时还会保留不必要依赖。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/completed_cleanup_runtime_adapter.py`
  - `CompletedCleanupRuntimeDependencies`
    - `delete_subscription_with_records`
    - `check_feiniu_movie_status`
    - `log_background_event`
    - `get_movie_status_by_tmdb`
    - `get_tv_missing_status`
    - `has_upcoming_episodes`
    - `sleep`
    - `run_cleanup_completed_subscriptions`
    - `run_cleanup_single_subscription`
  - `build_default_completed_cleanup_runtime_dependencies(...)`
    - 接收 `delete_subscription_with_records` 和 `check_feiniu_movie_status`。
    - 绑定 `operation_log_service.log_background_event`。
    - 绑定 `emby_service.get_movie_status_by_tmdb`。
    - 绑定 `tv_missing_service.get_tv_missing_status`。
    - 绑定 `has_upcoming_episodes_in_subscription_scope`。
    - 绑定 `asyncio.sleep`。
    - 绑定 core batch 和 single cleanup runners。
  - `build_completed_cleanup_dependencies(runtime_dependencies)`
    - 构造 `CompletedCleanupDependencies(...)`。
  - `cleanup_completed_subscriptions_with_runtime_adapter(db, dependencies)`
    - 调用 `run_cleanup_completed_subscriptions(db, dependencies=...)`。
  - `cleanup_single_subscription_with_runtime_adapter(db, subscription_id, dependencies)`
    - 调用 `run_cleanup_single_subscription(db, subscription_id, dependencies=...)`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入 runtime adapter builder 和两个 wrapper。
  - `cleanup_completed_subscriptions()` 改为调用 runtime adapter。
  - `cleanup_single_subscription()` 改为调用 runtime adapter。
  - 移除 `_completed_cleanup_dependencies()`。
  - 移除主服务不再直接使用的 `CompletedCleanupDependencies`、`cleanup_completed_subscriptions_flow`、`cleanup_single_subscription_flow` imports。

新增测试：

- `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py`
  - batch wrapper 正确把 runtime dependencies 转成 `CompletedCleanupDependencies` 并透传 db。
  - single wrapper 透传 db、subscription_id 和相同 lower dependency shape。
  - lower dependencies 可调用删除订阅、operation log、Emby、飞牛、TV missing、upcoming 和 sleep。
  - 默认 builder 绑定现有 runtime 服务、策略 helper、sleep 和 core runners。
  - runtime adapter 不 import `subscription_service`、`app.api` 或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- `cleanup_completed_subscriptions(db)` 方法签名不变。
- `cleanup_single_subscription(db, subscription_id)` 方法签名不变。
- `completed_cleanup.py` 的扫描查询、清理判断、commit 重试、日志和返回字典不变。
- 删除订阅仍调用当前 `SubscriptionService` 实例方法。
- 飞牛电影状态仍通过当前服务 wrapper 查询。
- Emby、TV missing、operation log、upcoming helper 和 `asyncio.sleep` 仍绑定现有实现。
- 不改变预扫描清理、自动转存或固定来源扫描逻辑。

## 测试策略

先写 `backend/tests/test_subscription_completed_cleanup_runtime_adapter.py` 并运行红测，确认新模块缺失。实现 runtime adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_completed_cleanup_runtime_adapter.py tests/test_completed_cleanup.py tests/test_subscription_cleanup_policy.py`

随后执行每轮完成标准：相关 targeted backend tests、后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `completed_cleanup.py` 的清理策略、DB 查询或重试策略。
- 不改单订阅清理的 API 语义。
- 不改预扫描清理；它已经由单独 runtime adapter 接管。
- 不引入新的清理配置或日志格式。

## 自检

- 文档已完整描述范围、组件和验证方式。
- 设计范围只覆盖完成后清理 runtime wiring，不改变 core cleanup 语义。
- 测试策略包含红测、默认绑定、batch/single wrapper 转换和相关清理回归。
