# 订阅自动转存记录加载 DB Adapter 拆分设计

## 背景

自动转存重试和链接回退已经有独立的核心规则：

- `record_selection.py` 判断失败/待处理记录是否可重试，并按 id/url 去重。
- `auto_transfer_retry_records.py` 决定普通自动转存和强制转存时应加载哪些 retry records。
- `link_fallback_flow.py` 在补充搜索前通过已记录 URL 排除失效或已尝试链接。

但 `SubscriptionService` 仍直接承载三段 DB 查询：

- `_load_retryable_records()` 查询最近失败记录和 pending/matched 记录，再调用 `select_retryable_records()`。
- `_load_force_retry_records()` 根据重复 URL 查询失败/pending/matched 记录，再调用 `dedupe_records_by_resource_url()`。
- `_load_subscription_resource_urls()` 查询订阅下已有 `DownloadRecord.resource_url`，供链接回退排除使用。

这些查询属于 DB adapter 职责。把它们抽到 `subscriptions/` 模块后，主服务只保留兼容 wrapper，不再直接了解 retry 记录加载的 SQL 条件和 limit。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/auto_transfer_record_loaders_db_adapter.py`，提供：

- `AutoTransferRecordLoaderDbDependencies`
- `load_retryable_records_with_db_adapter(...)`
- `load_force_retry_records_with_db_adapter(...)`
- `load_subscription_resource_urls_with_db_adapter(...)`

该 adapter 可以导入 `DownloadRecord`、`MediaStatus` 和 SQLAlchemy `select`，但记录筛选/去重规则继续通过依赖注入调用 `record_selection.py`。

备选方案一：把这些查询放入 `auto_transfer_retry_records.py`。会让当前纯 helper 直接依赖 ORM 和数据库层，破坏已有边界测试。

备选方案二：拆成 retry loader adapter 和 link fallback URL loader adapter 两个文件。边界更细，但当前三段查询都围绕 `DownloadRecord` URL/status 加载，分成两个文件会增加样板。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/auto_transfer_record_loaders_db_adapter.py`
  - `AutoTransferRecordLoaderDbDependencies`
    - `select_retryable_records(failed_rows, pending_rows)`
    - `dedupe_records_by_resource_url(rows)`
  - `build_default_auto_transfer_record_loader_db_dependencies()`
    - 绑定 `record_selection.select_retryable_records()`。
    - 绑定 `record_selection.dedupe_records_by_resource_url()`。
  - `load_retryable_records_with_db_adapter(db, subscription_id, dependencies=None)`
    - 保持 `db.no_autoflush`。
    - 查询当前订阅 `MediaStatus.FAILED`，按 `created_at desc`，limit 8。
    - 查询当前订阅 `MediaStatus.PENDING` / `MediaStatus.MATCHED`，按 `created_at desc`，limit 5。
    - 将 rows 交给 `dependencies.select_retryable_records(...)`。
  - `load_force_retry_records_with_db_adapter(db, subscription_id, duplicate_urls, dependencies=None)`
    - 先按现有规则清理 `duplicate_urls`：`str(item or "").strip()`，过滤空值。
    - 无 URL 时直接返回 `[]`，不查询 DB。
    - 查询当前订阅、URL in 清理后的值、状态在 failed/pending/matched 的记录。
    - 按 `created_at desc` 排序并交给 `dependencies.dedupe_records_by_resource_url(...)`。
  - `load_subscription_resource_urls_with_db_adapter(db, subscription_id)`
    - 保持 `db.no_autoflush`。
    - 查询当前订阅所有 `DownloadRecord.resource_url`。
    - 返回 `{str(row[0]).strip() for row in result.all() if row and row[0]}`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 DB adapter。
  - `_load_retryable_records()`、`_load_force_retry_records()`、`_load_subscription_resource_urls()` 改为薄 wrapper。
  - 移除不再由服务直接使用的 `select`、`select_retryable_records`、`dedupe_records_by_resource_url` import。

新增测试：

- `backend/tests/test_subscription_auto_transfer_record_loaders_db_adapter.py`
  - retry loader 使用 no_autoflush，执行两条查询，并把 failed/pending rows 交给注入 selector。
  - force loader 清理 duplicate URLs；空清单不查询 DB；非空清单查询后调用注入 dedupe。
  - URL loader 使用 no_autoflush，返回 strip 后的非空 URL 集合。
  - 默认 dependencies 绑定现有 record selection helpers。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部搜索/转存服务或 API。

## 行为保持

必须保持以下行为不变：

- retry failed 查询 limit 仍为 8，pending/matched 查询 limit 仍为 5。
- retry 查询仍在 `db.no_autoflush` 内执行。
- retry 状态集合仍是 `FAILED`、`PENDING`、`MATCHED`。
- retry 业务筛选仍由 `select_retryable_records()` 决定。
- force duplicate URL 清理规则、空清单短路、去重规则保持不变。
- 链接回退已记录 URL loader 仍 strip URL，忽略空值。
- 不改变调用方签名、事务边界或自动转存流程顺序。

## 测试策略

先写 `backend/tests/test_subscription_auto_transfer_record_loaders_db_adapter.py` 并运行红测，确认新模块缺失。实现 DB adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_record_loaders_db_adapter.py tests/test_subscription_record_selection.py tests/test_subscription_auto_transfer_retry_records.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_item_processing_run_flow.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 retryable 错误判断、115 链接识别或离线资源识别规则。
- 不改链接回退补充搜索策略。
- 不改自动转存批处理、固定来源扫描、资源入库或通知逻辑。
- 不引入新的 DB 索引或迁移。

## 自检

- 文档已完整描述范围、组件和验证方式。
- 设计范围只覆盖 `DownloadRecord` 查询 adapter，不改变核心选择规则。
- 测试策略包含红测、查询形状/短路验证、默认依赖验证和相关回归。
