# 订阅资源入库拆分设计

## 背景

`SubscriptionService._store_new_resources()` 仍留在主服务中，负责把 `_fetch_resources()` 返回的候选资源转换成 `DownloadRecord`：

- 查询当前订阅已记录的 `resource_url`
- 按候选资源提取 115 分享 URL
- 离线转存开启时，从候选中提取 magnet/ed2k 等离线 URL
- 跳过无有效 URL 的候选
- 跳过同一订阅已存在的 URL，并返回重复 URL 列表
- 创建 `DownloadRecord`，状态固定为 `MediaStatus.MATCHED`
- 返回 `created_records`、`checked_count`、`duplicate_count`、`duplicate_urls`、`invalid_count`

这段逻辑本身不大，但它混在 1900 行以上的 `subscription_service.py` 里，并直接读取运行时设置和 ORM 模型。当前拆分目标是把资源候选入库规则移到独立 helper，让主服务继续承担数据库适配和运行时依赖注入。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/resource_storage.py`，提供 `ResourceStorageDependencies` 和 `store_new_resources()`。helper 不直接导入 `SubscriptionService`、`AsyncSession`、runtime settings、API 层或全局 service；它只依赖注入的 `load_existing_resource_urls()`、`add_record()`、`offline_transfer_enabled()` 和 `record_status_matched`。`SubscriptionService._store_new_resources()` 保留原签名，构造依赖后委托 helper。

备选方案一：把 `_store_new_resources()` 原样移动到新模块，继续直接导入 `DownloadRecord`、`MediaStatus`、`runtime_settings_service` 和 SQLAlchemy。这个方案行数收益明显，但会把 DB/runtime 边界带到 helper，和已有 `resource_resolver.py`、`resource_fetchers.py` 的依赖注入模式不一致。

备选方案二：把 `_store_new_resources()` 与 `_load_retryable_records()`、`_load_force_retry_records()` 一起抽成 repository。这个方向最终可能合理，但会扩大本轮改动面，触及历史重试和链接回退调用路径，不适合当前窄切。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/resource_storage.py`
  - `ResourceStorageDependencies`
  - `store_new_resources(subscription_id, resources, dependencies)`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 helper。
  - `_store_new_resources()` 改为薄包装。
  - wrapper 内保留 ORM 查询、`DownloadRecord` 构造、`MediaStatus.MATCHED` 和 runtime 设置接线。

新增测试：

- `backend/tests/test_subscription_resource_storage.py`
  - 空资源直接返回默认统计，不调用依赖。
  - 新 115 资源创建记录，并将新 URL 加入本轮去重集合。
  - 已存在 URL 返回 duplicate 统计和 URL 列表。
  - 同一批候选内重复 URL 只创建第一条，后续计为重复。
  - 离线转存关闭时，没有 115 分享链接的磁力候选计为 invalid。
  - 离线转存开启时，磁力候选可创建 `resource_type` 为 `magnet` 的记录。
  - 模块边界测试：不导入 `subscription_service`、`runtime_settings_service`、`AsyncSession`、`app.models` 或 `app.api`。

## 数据流

1. `SubscriptionService._store_new_resources(db, subscription_id, resources)` 调用 `store_new_resources()`。
2. wrapper 注入 `load_existing_resource_urls()`，内部继续使用当前查询：
   - `select(DownloadRecord.resource_url).where(DownloadRecord.subscription_id == subscription_id)`
   - `with db.no_autoflush`
3. helper 如果 `resources` 为空，直接返回现有默认统计，不触发查询或写入。
4. helper 复制一份 `existing_urls` 作为本轮去重集合。
5. 对每个候选：
   - 先用 `extract_resource_url()` 取 115 资源 URL，默认 `resource_type = "pan115"`
   - 如果没有 115 URL 且离线转存开启，则用 `extract_offline_url()` 取离线 URL，并用 `determine_resource_type()` 识别类型
   - 仍没有 URL 时增加 `invalid_count`
   - URL 已存在时增加 `duplicate_count`，并加入 `duplicate_urls`
   - 否则调用注入的 `add_record()` 创建记录，加入 `created_records` 和本轮 `existing_urls`
6. helper 返回与当前方法同形状的统计 dict。

## 行为保持

必须保持以下行为不变：

- 空资源返回：
  - `created_records: []`
  - `checked_count: 0`
  - `duplicate_count: 0`
  - `duplicate_urls: []`
  - `invalid_count: 0`
- 115 分享 URL 优先于离线 URL。
- 离线转存关闭时，不使用 `extract_offline_url()` 的结果。
- `duplicate_count` 包含数据库已存在 URL 和同一批次内重复 URL。
- `duplicate_urls` 返回去重后的 URL 列表。
- 新记录继续使用 `extract_resource_name()` 生成 `resource_name`。
- 新记录继续使用 `MediaStatus.MATCHED`。
- 新记录创建后立刻加入本轮 `existing_urls`，避免同批重复入库。
- helper 不提交事务；事务边界继续由调用方控制。

## 测试策略

先写 `backend/tests/test_subscription_resource_storage.py` 并运行红测，确认新模块缺失。实现 helper 后运行该测试，再改 `SubscriptionService._store_new_resources()` wrapper 并跑相关回归：

- `scripts/verify-backend.sh -- tests/test_subscription_resource_storage.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `_fetch_resources()` 来源瀑布流。
- 不改 `_load_retryable_records()` 或 `_load_force_retry_records()`。
- 不改自动转存、链接回退、固定来源扫描、HDHive 解锁或清理逻辑。
- 不引入新的数据库事务提交或 flush 行为。
