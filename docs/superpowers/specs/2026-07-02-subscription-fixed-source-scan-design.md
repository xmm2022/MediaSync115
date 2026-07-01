# 订阅固定来源扫描拆分设计

## 背景

`backend/app/services/subscription_service.py` 仍然承担订阅主循环、资源搜索、自动转存、固定来源扫描、清理和通知等多种职责。固定来源扫描逻辑集中在 `_should_scan_fixed_sources()` 与 `_scan_fixed_sources_for_subscription()`，边界相对清楚，但当前仍直接塞在 `SubscriptionService` 内，使大文件继续保留数据库查询、缺集状态判断、固定来源日志和扫描循环的细节。

本轮目标是先抽离固定来源扫描流程，不改变固定来源功能行为，也不改手动扫描 API。

## 方案比较

推荐方案：新增 `app.services.subscriptions.fixed_source_scan`，提供 `should_scan_fixed_sources()`、`FixedSourceScanDependencies` 和 `scan_fixed_sources_for_subscription()`。新模块承载固定来源扫描流程，外部服务、数据库查询、115 服务构造、缺集查询和日志写入都通过依赖注入进入。`SubscriptionService` 只保留薄包装，负责把现有全局服务适配为依赖。

备选方案一：只抽离 `_should_scan_fixed_sources()` 和画质过滤 helper。这个方案风险最低，但只能减少十几行，对大文件职责改善不明显。

备选方案二：把固定来源扫描做成独立 class，并直接在新 class 内引用数据库模型和全局服务。这个方案行数收益更大，但会把新模块和运行时全局状态绑死，测试需要更多 monkeypatch，后续迁移成本更高。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/fixed_source_scan.py`
  - `should_scan_fixed_sources(sub, force_auto_download=False) -> bool`
  - `FixedSourceScanDependencies`
  - `scan_fixed_sources_for_subscription(...) -> dict[str, Any]`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新模块函数和依赖 dataclass。
  - `_should_scan_fixed_sources()` 改为调用新模块纯函数，保持旧调用兼容。
  - `_scan_fixed_sources_for_subscription()` 改为构造依赖并调用新模块。

新增测试：

- `backend/tests/test_fixed_source_scan.py`
  - 覆盖自动转存关闭时跳过。
  - 覆盖 TV 缺集状态不可用时记录 warning 并返回 checked。
  - 覆盖多个固定来源成功/失败时累计 saved、failed、checked，并记录 start/done/failed 日志。
  - 覆盖模块边界，避免新模块导入 `subscription_service`、`runtime_settings_service`、`Pan115Service`、`AsyncSession` 和 `app.api`。

## 数据流

`run_channel_check()` 仍按原顺序在自动转存之后调用固定来源扫描：

1. `SubscriptionService._should_scan_fixed_sources()` 判断订阅是否应扫描固定来源。
2. `SubscriptionService._scan_fixed_sources_for_subscription()` 查询启用的手动 115 固定来源。
3. 薄包装构造 `FixedSourceScanDependencies`。
4. 新模块根据订阅类型处理 TV 缺集状态。
5. 新模块逐个固定来源调用 `subscription_source_service.scan_manual_pan115_source()` 对应的注入函数。
6. 新模块通过注入的 `create_step_log` 写入原有 step 名称和消息。
7. 返回 `{"saved": int, "failed": int, "checked": int}`，由现有主循环继续累计。

## 行为保持

必须保持以下行为不变：

- 只有电影/电视剧、有 `tmdb_id`，且开启自动转存或强制自动转存时才扫描固定来源。
- 没有启用固定来源时返回零计数。
- TV 缺集状态不可用时不抛出异常，记录 `fixed_source_missing_status_unavailable` warning，并返回 `checked=len(sources)`。
- 单个固定来源扫描失败只增加 `failed`，不阻断后续来源。
- 成功来源按 `transferred_count` 累加 `saved`。
- step 名称、核心消息和 payload 中的 `source_id` 保持兼容。

## 测试策略

先写 `backend/tests/test_fixed_source_scan.py`，直接调用新模块函数，使用简单 fake subscription、fake source 和 fake dependency，先验证模块缺失导致红测失败。实现后运行该测试，再运行固定来源集成测试与订阅关键回归，最后运行后端/前端/compose 快速验证和 Docker 健康检查。

## 非目标

- 不改固定来源数据库表、API、前端展示。
- 不改 `subscription_source_service.scan_manual_pan115_source()` 的内部选择逻辑。
- 不改自动转存、HDHive 解锁、离线下载或补充搜索流程。
- 不把手动扫描 API 一起迁移；它仍可继续复用现有服务。
