# 订阅运行加载器拆分设计

## 背景

`SubscriptionService.run_channel_check()` 仍直接包含本轮运行前的订阅加载逻辑：

- 构造 `has_successful_transfer` EXISTS 子查询
- 查询 active 且属于 mediasync115 本地体系的订阅
- 按订阅 ID 升序排序
- 将数据库行转换为 `SubscriptionSnapshot`

这段逻辑是运行调度的输入准备，不涉及抓取、转存、清理、通知或进度回调。抽离后可以让 `run_channel_check()` 更聚焦在调度流程，并复用 `SubscriptionSnapshot` 作为服务层内部边界对象。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/run_loader.py`，提供 `load_active_subscription_snapshots(db)` 和 `snapshot_from_active_subscription_row(row)`。模块可以导入 SQLAlchemy、`Subscription`、`DownloadRecord`、`MediaStatus` 和 `SubscriptionSnapshot`，但不导入 runtime settings、外部服务、API 或 `SubscriptionService`。

备选方案一：把加载逻辑合并进现有 `snapshot.py`。`snapshot.py` 当前是纯 dataclass 模型，加入 DB 查询会破坏其轻量边界。

备选方案二：只抽出 row-to-snapshot 映射，查询仍留在 `run_channel_check()`。变更更小，但保留了大段 SQL 构造，拆分收益有限。

备选方案三：同时复用 `completed_cleanup.py` 里的相似查询。两者字段集和后续处理不同，本轮只抽 `run_channel_check()` 的运行加载路径，避免扩大行为面。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/run_loader.py`
  - `snapshot_from_active_subscription_row(row)`：保持当前类型转换、默认值和布尔转换。
  - `load_active_subscription_snapshots(db)`：执行当前 active 本地订阅查询，并返回 snapshot 列表。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入 `load_active_subscription_snapshots`。
  - 用 helper 替代内联 EXISTS、select 和列表推导。
  - 保留 `set_checked_count()`、run_start 日志、progress callback 和并发调度位置不变。

新增测试：

- `backend/tests/test_subscription_run_loader.py`
  - row 映射保持当前字段、默认值和类型转换。
  - 加载器只返回 active 且 provider/external_system 属于空值或 `mediasync115` 的订阅。
  - 排除 MoviePilot/AniRSS 等外部镜像订阅。
  - 完成或离线完成下载记录会让 snapshot 的 `has_successful_transfer` 为 true。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、pan115/pansou/hdhive/tg 服务或 API。

## 行为保持

必须保持以下行为不变：

- 查询条件仍只包含 active 且 provider/external_system 为 `NULL`、空字符串或 `mediasync115` 的订阅。
- 不排除已有成功转存记录；该状态只写入 `has_successful_transfer`。
- 排序仍为 `Subscription.id.asc()`。
- `SubscriptionSnapshot` 字段默认值保持现状：空 title -> `""`，空 `tv_scope` -> `"all"`，空 `tv_follow_mode` -> `"missing"`。
- 不改变 `checked_count` 计算、run_start 日志 payload、并发处理或事务边界。

## 测试策略

先写 `backend/tests/test_subscription_run_loader.py` 并运行红测，确认新模块缺失。实现 helper 并接入后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_run_loader.py tests/test_subscription_run_state.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不重构 `completed_cleanup.py` 的相似查询。
- 不改变订阅筛选语义。
- 不改变资源抓取、转存、固定来源扫描、清理、通知或执行日志行为。
- 不引入新的 repository class 或 service class。
