# 订阅自动转存批处理适配层拆分设计

## 背景

`SubscriptionService._auto_save_resources()` 当前主要承担适配职责：

- 读取 115 cookie、默认转存目录和离线目录。
- 创建 `Pan115Service`。
- 为 `auto_save_resources_batch()` 组装 step log、剧集缺集查询、离线任务提交、精准选集、Kafka 事件、通知、postprocess 和操作日志依赖。
- 构造 `AutoTransferBatchStatuses` 并调用批处理 helper。

真正的逐条转存流程已在 `auto_transfer_batch.py`。本轮应把 `_auto_save_resources()` 的适配层移入独立 helper，使 `subscription_service.py` 只负责把运行时服务依赖注入进去。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/auto_save_resources_adapter.py`，提供 `auto_save_resources_with_adapter()` 和依赖 dataclass。新模块不直接导入 runtime settings、ORM、`Pan115Service`、Kafka、外部服务或 API，只通过注入的 callables 获取这些能力。

备选方案一：把 adapter 直接合入 `auto_transfer_batch.py`。`auto_transfer_batch.py` 当前是核心批处理逻辑，继续加入运行时适配会让职责混在一起。

备选方案二：只把 `AutoTransferBatchDependencies` 构造抽成 `subscription_service.py` 内部私有方法。文件行数能降一些，但无法形成可独立测试的边界。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/auto_save_resources_adapter.py`
  - `AutoSaveResourcesAdapterDependencies`
    - `get_pan115_cookie()`
    - `create_pan_service(cookie)`
    - `get_pan115_default_folder()`
    - `get_pan115_offline_folder()`
    - `resolve_quality_filter(sub)`
    - `get_tv_missing_status(tmdb_id, **kwargs)`
    - `create_step_log(db, **kwargs)`
    - `emit_transfer_success(subscription_id, data)`
    - `select_tv_missing_episode_files(...)`
    - `apply_precise_postprocess_status(record)`
    - `notify_transfer_success(...)`
    - `trigger_archive_after_transfer(...)`
    - `log_operation(...)`
    - `now()`
    - `is_video_file(filename)`
    - `run_batch(...)`
  - `auto_save_resources_with_adapter(...)`
    - 创建 pan service。
    - 解析 parent folder 和 offline folder。
    - 构造 `AutoTransferBatchDependencies`。
    - 调用注入的 `run_batch`，生产环境注入现有 `auto_save_resources_batch()`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 adapter。
  - 将 `_auto_save_resources()` 缩减为运行时依赖注入和 adapter 调用。
  - 保留 `MediaStatus` 到 `AutoTransferBatchStatuses` 的映射。
  - Kafka producer 仍由服务层通过注入闭包访问，避免 adapter 直接依赖 analytics 模块。

新增测试：

- `backend/tests/test_subscription_auto_save_resources_adapter.py`
  - adapter 使用默认转存目录、质量过滤和 statuses 调用 batch。
  - adapter 生成的 batch dependencies 能补齐 step log 上下文。
  - adapter 的剧集缺集查询使用订阅 `tmdb_id`，并忽略 batch 传入的 `tmdb_id` 覆盖。
  - adapter 的离线任务、离线目录、精准选集和事件回调委托到注入依赖。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、数据库 session、模型、外部服务、Kafka 或 API。

## 行为保持

必须保持以下行为不变：

- 自动转存仍使用“默认转存文件夹”作为分享转存 parent folder。
- 离线任务仍使用“离线下载目录”。
- 剧集缺集查询仍使用当前订阅的 `tmdb_id`。
- step log 仍携带 `run_id`、`channel`、`subscription_id`、`subscription_title`。
- 精准选集仍使用当前 pan service 的 `pick_best_video_file`。
- 分享码提取、递归文件列表、直接保存、通知、归档触发、操作日志和时间函数仍保持现有依赖。
- Kafka transfer success event 的启用判断和发送行为不改变。
- `auto_save_resources_batch()` 的业务逻辑不改。

## 测试策略

先写 `backend/tests/test_subscription_auto_save_resources_adapter.py` 并运行红测，确认新模块缺失。实现 adapter 并接入后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_auto_save_resources_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变 `auto_transfer_batch.py` 的逐条转存逻辑。
- 不拆分 `_auto_save_records_with_link_fallback()`。
- 不改变 pan115、离线任务、精准选集、通知或 postprocess 语义。
- 不改变资源抓取或资源入库 flow。
