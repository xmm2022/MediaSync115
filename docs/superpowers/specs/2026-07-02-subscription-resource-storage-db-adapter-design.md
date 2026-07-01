# 订阅资源入库 DB 适配层拆分设计

## 背景

`SubscriptionService._store_new_resources()` 当前负责数据库适配：

- 查询订阅已有 `DownloadRecord.resource_url`。
- 根据 core storage helper 的回调创建 `DownloadRecord`。
- 注入离线转存开关和 `MediaStatus.MATCHED`。
- 调用 `resource_storage.store_new_resources()` 完成去重、无效资源统计和记录创建。

核心入库规则已经在 `resource_storage.py`，服务层剩余逻辑可以抽到 DB adapter，继续保持 core storage 不依赖 ORM 或 runtime settings。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/resource_storage_db_adapter.py`，允许该模块导入 `DownloadRecord` 和 SQLAlchemy `select`，但 runtime settings、状态枚举和 core runner 仍由服务层注入。这样 DB 查询和模型构造离开 `subscription_service.py`，同时 `resource_storage.py` 保持纯逻辑 helper。

备选方案一：把 DB 查询直接放进 `resource_storage.py`。会破坏该模块当前的纯依赖注入边界。

备选方案二：继续保留 `_store_new_resources()` 现状。改动最小，但资源 flow 最后一段仍留在大服务文件里。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/resource_storage_db_adapter.py`
  - `ResourceStorageDbAdapterDependencies`
    - `offline_transfer_enabled()`
    - `record_status_matched`
    - `run_store_new_resources(subscription_id, resources, dependencies=...)`
  - `load_existing_resource_urls(db, subscription_id)`
    - 保持 `db.no_autoflush`。
    - 查询当前订阅已有 `DownloadRecord.resource_url`。
  - `add_download_record(db, subscription_id, resource_name, resource_url, resource_type, status)`
    - 构造 `DownloadRecord` 并 `db.add(record)`。
  - `store_new_resources_with_db_adapter(db, subscription_id, resources, dependencies)`
    - 构造 `ResourceStorageDependencies`。
    - 调用注入的 core runner。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 DB adapter。
  - 将 `_store_new_resources()` 缩减为 adapter 调用。
  - 移除 `ResourceStorageDependencies` 直接导入。

新增测试：

- `backend/tests/test_subscription_resource_storage_db_adapter.py`
  - adapter 使用 `db.no_autoflush` 查询已有 URL，并过滤空值。
  - adapter 通过 add 回调创建 `DownloadRecord` 并加入 db。
  - adapter 调用 core runner 时传入 `ResourceStorageDependencies`、离线开关和匹配状态。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部服务或 API。

## 行为保持

必须保持以下行为不变：

- 查询已有 URL 时仍使用 `db.no_autoflush`。
- 仍按订阅 ID 查询 `DownloadRecord.resource_url`。
- 已有 URL 仍转为 `str(row[0])`，并忽略空值。
- 新记录字段保持 `subscription_id`、`resource_name`、`resource_url`、`resource_type`、`status`。
- 新记录仍调用 `db.add(record)`，不在 adapter 内 commit。
- 离线转存开关和 `MediaStatus.MATCHED` 仍由服务层注入。
- `resource_storage.store_new_resources()` 的业务语义不改。

## 测试策略

先写 `backend/tests/test_subscription_resource_storage_db_adapter.py` 并运行红测，确认新模块缺失。实现 adapter 并接入后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_resource_storage_db_adapter.py tests/test_subscription_resource_storage.py tests/test_fetch_resources_waterfall.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `resource_storage.py` 的去重、无效资源和离线资源规则。
- 不改变 `DownloadRecord` 字段、状态或事务边界。
- 不改变资源抓取、自动转存或日志逻辑。
