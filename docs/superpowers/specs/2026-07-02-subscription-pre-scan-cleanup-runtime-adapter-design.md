# 订阅预扫描清理 Runtime Adapter 拆分设计

## 背景

`pre_scan_cleanup.py` 已经承载订阅项预扫描前的清理规则：

- 电影已有成功转存记录时删除订阅并记录 step/event。
- 电影在 Emby 或飞牛已存在时删除订阅并记录 step/event。
- TV 订阅查询缺集状态，根据跟随模式和即将播出信息决定是否清理。
- 查询失败时记录 warning step，返回未删除结果。

`SubscriptionService._evaluate_pre_scan_cleanup()` 目前仍在主服务里组装这些运行时依赖：

- 本地回调：`_delete_subscription_with_records()`、`_create_step_log()`、`_check_feiniu_movie_status()`。
- 全局服务：`operation_log_service.log_background_event`、`emby_service.get_movie_status_by_tmdb`、`tv_missing_service.get_tv_missing_status`。
- 策略 helper：`has_upcoming_episodes_in_subscription_scope`。
- core runner：`evaluate_pre_scan_cleanup()`。

这段逻辑不改变清理策略，只是 runtime wiring。把它抽到 runtime adapter 后，主服务只保留兼容 wrapper，并且 `pre_scan_cleanup.py` 继续保持纯依赖注入边界。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py`，提供：

- `PreScanCleanupRuntimeDependencies`
- `build_default_pre_scan_cleanup_runtime_dependencies(...)`
- `evaluate_pre_scan_cleanup_with_runtime_adapter(...)`

服务 wrapper 只传入三个服务实例方法：删除订阅、写 step log、飞牛电影状态检查。

备选方案一：把默认 builder 放进 `pre_scan_cleanup.py`。这样文件更少，但会把 Emby、TV missing、operation log 等运行时服务引入 core cleanup helper，破坏现有模块边界。

备选方案二：把预扫描清理和完成后清理合并成一个 cleanup runtime adapter。本轮会碰两个业务入口，回归面更大；先拆预扫描入口更小，之后可用同样模式处理 completed cleanup。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/pre_scan_cleanup_runtime_adapter.py`
  - `PreScanCleanupRuntimeDependencies`
    - `delete_subscription_with_records`
    - `create_step_log`
    - `check_feiniu_movie_status`
    - `log_background_event`
    - `get_movie_status_by_tmdb`
    - `get_tv_missing_status`
    - `has_upcoming_episodes`
    - `run_evaluate_pre_scan_cleanup`
  - `build_default_pre_scan_cleanup_runtime_dependencies(...)`
    - 接收 `delete_subscription_with_records`、`create_step_log`、`check_feiniu_movie_status` 三个服务回调。
    - 绑定 `operation_log_service.log_background_event`。
    - 绑定 `emby_service.get_movie_status_by_tmdb`。
    - 绑定 `tv_missing_service.get_tv_missing_status`。
    - 绑定 `has_upcoming_episodes_in_subscription_scope`。
    - 绑定 core `evaluate_pre_scan_cleanup()`。
  - `evaluate_pre_scan_cleanup_with_runtime_adapter(db, run_id, channel, sub, dependencies)`
    - 构造 `PreScanCleanupDependencies(...)`。
    - 调用 `run_evaluate_pre_scan_cleanup(db, run_id=..., channel=..., sub=..., dependencies=...)`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入 `build_default_pre_scan_cleanup_runtime_dependencies` 和 `evaluate_pre_scan_cleanup_with_runtime_adapter`。
  - `_evaluate_pre_scan_cleanup()` 改为薄 wrapper。
  - 移除主服务不再直接使用的 `PreScanCleanupDependencies` 和 `evaluate_pre_scan_cleanup_flow` imports。

新增测试：

- `backend/tests/test_subscription_pre_scan_cleanup_runtime_adapter.py`
  - runtime wrapper 正确把 runtime dependencies 转成 `PreScanCleanupDependencies`。
  - wrapper 透传 `db`、`run_id`、`channel`、`sub` 并返回 core runner 结果。
  - lower dependencies 可调用删除订阅、step log、background event、Emby、飞牛、TV missing 和 upcoming helper。
  - 默认 builder 绑定现有 runtime 服务、策略 helper 和 core runner。
  - runtime adapter 不 import `subscription_service`、`app.api` 或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- `_evaluate_pre_scan_cleanup(db, run_id, channel, sub)` 方法签名不变。
- `pre_scan_cleanup.py` 的电影/TV 清理规则、step 名称、event action 和返回字典不变。
- 删除订阅和写 step log 仍调用当前 `SubscriptionService` 实例方法。
- 飞牛电影状态仍通过当前服务 wrapper 查询。
- Emby、TV missing、operation log 和 upcoming helper 仍绑定现有实现。
- 不改变事务提交、统计累计或后续订阅项处理流程。

## 测试策略

先写 `backend/tests/test_subscription_pre_scan_cleanup_runtime_adapter.py` 并运行红测，确认新模块缺失。实现 runtime adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_pre_scan_cleanup_runtime_adapter.py tests/test_pre_scan_cleanup.py tests/test_subscription_pre_scan_cleanup_run_flow.py tests/test_subscription_item_processing_run_flow.py`

随后执行每轮完成标准：相关 targeted backend tests、后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `pre_scan_cleanup.py` 的清理策略。
- 不改 `pre_scan_cleanup_run_flow.py` 的提交、统计或 done 日志行为。
- 不改 completed cleanup；该入口后续单独处理。
- 不引入新的清理配置或重试策略。

## 自检

- 文档已完整描述范围、组件和验证方式。
- 设计范围只覆盖预扫描清理 runtime wiring，不改变 core cleanup 或 run flow 语义。
- 测试策略包含红测、默认绑定、wrapper 转换和相关清理回归。
