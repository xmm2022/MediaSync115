# 订阅预扫描清理拆分设计

## 背景

`backend/app/services/subscription_service.py` 当前还有 2862 行。固定来源扫描已抽离后，订阅主循环里仍然保留一大块“预扫描清理”逻辑：电影已转存、电影已在 Emby/飞牛入库、电视剧缺集状态检查、电视剧不缺集自动删除，以及对应 step log 和 operation log。它们集中在 `_evaluate_pre_scan_cleanup()`，入口单一，返回值也很稳定：`{"deleted": bool, "tv_missing_snapshot": ...}`。

本轮目标是把这段预扫描清理流程抽到 `app.services.subscriptions.pre_scan_cleanup`，让 `SubscriptionService` 只负责把数据库删除、状态查询、日志写入等运行时依赖注入进去。

## 方案比较

推荐方案：新增 `pre_scan_cleanup.py`，提供 `PreScanCleanupDependencies` 和 `evaluate_pre_scan_cleanup()`。新模块保留清理分支、step 名称、operation log action、返回结构和 TV missing snapshot 复用行为；外部服务调用通过依赖注入传入。`SubscriptionService._evaluate_pre_scan_cleanup()` 保留兼容包装。

备选方案一：只抽 `_apply_cleanup_stats()` 或质量过滤 helper。风险更低，但只能减少十几行，对主文件职责改善有限。

备选方案二：把预扫描清理和手动清理、离线完成清理、电影固定来源转存后清理一起合并成一个大清理服务。结构上更彻底，但会一次触碰多条路径，涉及 DB 事务、API 手动清理和主循环并发，风险不适合当前稳定拆分节奏。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/pre_scan_cleanup.py`
  - `PreScanCleanupDependencies`
  - `evaluate_pre_scan_cleanup(db, *, run_id, channel, sub, dependencies)`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新模块。
  - `_evaluate_pre_scan_cleanup()` 变成薄包装，构造依赖并委托新模块。

新增测试：

- `backend/tests/test_pre_scan_cleanup.py`
  - 电影已有成功转存：删除订阅、写 `subscription_cleanup_movie_transferred` step、写 operation log。
  - 电影已在 Emby：写 `movie_emby_check_done` 和 `subscription_cleanup_movie_emby_exists`，并删除订阅。
  - TV 缺集状态 ok 且无需清理：返回 `tv_missing_snapshot`，不删除订阅。
  - TV 缺集状态 ok 且可以清理：删除订阅、写 `subscription_cleanup_tv_no_missing`，返回 snapshot。
  - TV 缺集状态失败：写 `tv_missing_fetch_failed`，不删除订阅。
  - 模块边界：不导入 `subscription_service`、`runtime_settings_service`、`AsyncSession`、Emby/飞牛服务实例或 API 层。

## 数据流

1. `run_channel_check()` 继续调用 `SubscriptionService._evaluate_pre_scan_cleanup()`。
2. 包装方法创建依赖：
   - 删除订阅：`_delete_subscription_with_records`
   - step log：`_create_step_log`
   - operation log：`operation_log_service.log_background_event`
   - Emby 电影查询：`emby_service.get_movie_status_by_tmdb`
   - 飞牛电影查询：`_check_feiniu_movie_status`
   - TV 缺集查询：`tv_missing_service.get_tv_missing_status`
   - 待播判断：`has_upcoming_episodes_in_subscription_scope`
3. 新模块按现有逻辑执行清理判断和日志写入。
4. 包装方法返回原结构，主循环继续按 `deleted` 和 `tv_missing_snapshot` 更新统计或复用 TV 缺集结果。

## 行为保持

必须保持以下行为不变：

- 电影已有成功转存记录时，预扫描阶段直接删除订阅。
- 电影 `tmdb_id is None` 时不做入库检查，不删除。
- Emby 电影查询成功且存在时删除订阅；查询失败时只写 warning 并继续飞牛检查。
- 飞牛电影检查存在时删除订阅。
- 非 TV 或无 TMDB 的订阅不删除。
- TV 预扫描先写 `tv_missing_fetch_start`。
- TV 缺集查询 ok 时写 `tv_missing_fetch_done`，并把结果作为 `tv_missing_snapshot` 返回。
- TV 清理仍使用 `normalize_tv_follow_mode()`、`has_upcoming_episodes_in_subscription_scope()` 和 `evaluate_tv_cleanup()`。
- TV 缺集查询失败时写 `tv_missing_fetch_failed`，不删除。
- step 名称、operation log action 和主要 payload 字段保持兼容。

## 非目标

- 不改 `cleanup_completed_subscriptions()`、`cleanup_single_subscription()` 或 `_evaluate_subscription_cleanup_eligibility()`。
- 不改电影固定来源转存成功后的清理分支。
- 不改清理策略函数 `subscription_cleanup_policy.py`。
- 不改 Emby、飞牛、TV missing 服务行为。
