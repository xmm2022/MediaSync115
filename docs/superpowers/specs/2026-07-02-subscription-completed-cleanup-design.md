# 订阅完成后清理拆分设计

## 背景

`backend/app/services/subscription_service.py` 已降到 2622 行，但仍保留一组和主订阅扫描不同步的清理流程：

- `cleanup_completed_subscriptions()`：离线下载、Emby/飞牛同步后批量检查并删除已完成订阅。
- `_subscription_has_successful_transfer()`：判断某订阅是否已有完成转存记录。
- `_evaluate_subscription_cleanup_eligibility()`：按电影/剧集策略判断是否可删除。
- `cleanup_single_subscription()`：API 手动触发单个订阅清理。

这些逻辑和预扫描清理共享清理策略，但调用时机不同：它们是“完成后/手动清理”，入口来自 API、离线监控和同步任务。把它们从 `SubscriptionService` 抽离，可以继续降低主文件体积，同时让完成后清理具备独立单测。

## 方案比较

推荐方案：新增 `app.services.subscriptions.completed_cleanup`，提供 `CompletedCleanupDependencies`、`cleanup_completed_subscriptions()`、`cleanup_single_subscription()`、`evaluate_subscription_cleanup_eligibility()`。新模块可以直接持有数据库查询和事务重试逻辑，但外部运行时服务（Emby、飞牛、TV missing、operation log、删除订阅）通过依赖注入传入。`SubscriptionService` 保留同名公开方法作为薄包装。

备选方案一：只抽 `_evaluate_subscription_cleanup_eligibility()`。风险低，但只能减少约 50 行，批量/单项清理流程仍留在主服务中，收益偏小。

备选方案二：把预扫描清理、完成后清理和自动转存完成清理合并成一个统一清理服务。结构更完整，但会一次触碰订阅主循环、自动转存、API、同步任务等多条路径，风险过高。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/completed_cleanup.py`
  - `CompletedCleanupDependencies`
  - `cleanup_completed_subscriptions(db, *, dependencies)`
  - `cleanup_single_subscription(db, subscription_id, *, dependencies)`
  - `evaluate_subscription_cleanup_eligibility(sub, *, has_successful_transfer, dependencies)`
  - `_subscription_has_successful_transfer(db, subscription_id)`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新模块。
  - `cleanup_completed_subscriptions()` 变成依赖注入包装。
  - `cleanup_single_subscription()` 变成依赖注入包装。
  - 删除主类内 `_subscription_has_successful_transfer()` 和 `_evaluate_subscription_cleanup_eligibility()`。

新增测试：

- `backend/tests/test_completed_cleanup.py`
  - 电影 Emby 查询失败但飞牛存在时仍可清理。
  - 剧集“只追新集”且仍有待播集时不清理。
  - `cleanup_single_subscription()` 对本地已完成电影执行删除并写手动清理日志。
  - `cleanup_single_subscription()` 跳过外部渠道订阅。
  - 模块边界不导入 `subscription_service`、runtime settings、Emby/飞牛/TV missing 实例或 API 层。

## 数据流

1. API、离线监控、同步任务继续调用 `subscription_service.cleanup_completed_subscriptions()` 或 `cleanup_single_subscription()`。
2. `SubscriptionService` 包装方法创建依赖：
   - 删除订阅：`_delete_subscription_with_records`
   - operation log：`operation_log_service.log_background_event`
   - Emby 电影查询：`emby_service.get_movie_status_by_tmdb`
   - 飞牛电影查询：`_check_feiniu_movie_status`
   - TV 缺集查询：`tv_missing_service.get_tv_missing_status`
   - 待播判断：`has_upcoming_episodes_in_subscription_scope`
   - 重试 sleep：`asyncio.sleep`
3. 新模块执行原有查询、策略判断、删除、commit 重试和日志写入。
4. 包装方法原样返回原有结果结构。

## 行为保持

必须保持以下行为不变：

- 批量清理只扫描本地 MediaSync115 订阅，不删除 MoviePilot、AniRSS 等外部镜像订阅。
- 电影清理仍使用成功转存、Emby 已存在、飞牛已存在三类依据。
- Emby 电影查询异常只记录异常并继续飞牛判断。
- TV 清理仍使用 `build_tv_missing_status_kwargs()`、`normalize_tv_follow_mode()`、`has_upcoming_episodes_in_subscription_scope()` 和 `evaluate_tv_cleanup()`。
- 批量清理删除后仍执行最多 3 次 commit 重试，只对死锁、序列化冲突、锁超时做退避重试。
- 批量清理仍在 commit 成功后写 `subscription.item.cleanup_offline_completed` 操作日志。
- 手动单项清理仍保留“不存在”“未激活”“外部渠道订阅不参与 MediaSync115 自动清理”“未命中清理条件”的返回结构。
- 手动单项清理成功后仍写 `subscription.item.cleanup_manual` 操作日志。

## 非目标

- 不改 `subscription_cleanup_policy.py` 的清理策略。
- 不改预扫描清理模块 `pre_scan_cleanup.py`。
- 不改自动转存主流程 `_auto_save_resources()`。
- 不改 Emby、飞牛、TV missing 服务行为。
- 不删除或重写当前未使用的飞牛 TV 缺集检查方法；是否清理死代码单独处理。
