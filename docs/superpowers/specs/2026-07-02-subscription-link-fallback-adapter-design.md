# 订阅链接回退 Adapter 拆分设计

## 背景

`link_fallback_flow.py` 已经承载 `_auto_save_records_with_link_fallback()` 的核心业务：转存失败或剧集仍缺集时补充搜索新链接、入库并继续转存。但 `SubscriptionService._auto_save_records_with_link_fallback()` 仍保留了一段 runtime adapter 代码：

- 定义 `create_step_log()` 闭包转调 `self._create_step_log()`。
- 定义 `auto_save_resources()` 闭包转调 `self._auto_save_resources()`。
- 定义 `load_subscription_resource_urls()` 闭包转调 `_load_subscription_resource_urls()`。
- 定义 `fetch_resources()` 闭包转调 `_fetch_resources()`。
- 定义 `store_new_resources()` 闭包转调 `_store_new_resources()`。
- 构造 `LinkFallbackDependencies` 并调用核心 flow。

这些闭包没有业务判断，只是在服务方法和纯 flow 之间做依赖装配。把它们抽成 adapter 后，服务层的 `_auto_save_records_with_link_fallback()` 可以和已有 `resource_fetcher_adapter.py`、`resource_resolver_adapter.py`、`auto_save_resources_adapter.py` 保持同一风格。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/link_fallback_adapter.py`，提供 `auto_save_records_with_link_fallback_with_adapter(...)` 和 `LinkFallbackAdapterDependencies`。新 adapter 接收服务方法依赖和 `run_link_fallback` 回调，内部构造 `LinkFallbackDependencies` 并调用核心 flow。

备选方案一：把闭包保留在服务中。零风险，但无法继续降低 `subscription_service.py` 的运行 adapter 体积。

备选方案二：直接把 `_auto_save_records_with_link_fallback()` 删除，让调用方直接使用核心 flow。调用方仍需要构造一组依赖，反而会把装配逻辑泄漏到 item/transfer phase。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/link_fallback_adapter.py`
  - `LinkFallbackAdapterDependencies`
    - `create_step_log(...)`
    - `auto_save_resources(...)`
    - `load_subscription_resource_urls(db, subscription_id)`
    - `fetch_resources(...)`
    - `store_new_resources(db, subscription_id, resources)`
    - `run_link_fallback(...)`
  - `auto_save_records_with_link_fallback_with_adapter(...)`
    - 接收当前 `_auto_save_records_with_link_fallback()` 的 runtime 参数。
    - 构造 `LinkFallbackDependencies`。
    - 调用 `dependencies.run_link_fallback(...)`。
    - 透传 `tv_missing_snapshot`、`hdhive_unlock_context`、`source_order`、`enable_link_refetch` 和 `max_rounds`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 用新 adapter import 替换直接 `LinkFallbackDependencies` 和核心 flow alias 的装配。
  - `_auto_save_records_with_link_fallback()` 只负责把 `self._create_step_log`、`self._auto_save_resources`、`self._load_subscription_resource_urls`、`self._fetch_resources`、`self._store_new_resources` 和核心 flow 注入 adapter。
  - 保持方法签名不变，调用方无需改动。

新增测试：

- `backend/tests/test_subscription_link_fallback_adapter.py`
  - adapter 正确构造核心 `LinkFallbackDependencies`，并把生成的依赖转调到传入的 runtime callbacks。
  - adapter 透传 `run_id`、`channel`、`sub`、`records`、`transfer_source`、`tv_missing_snapshot`、`hdhive_unlock_context`、`source_order`、`enable_link_refetch` 和 `max_rounds`。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、外部服务、API、ORM 模型或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- `_auto_save_records_with_link_fallback()` 的公开方法签名不变。
- 核心回退策略仍由 `link_fallback_flow.py` 决定。
- `MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS` 仍由服务层传入 adapter。
- step log、auto save、已尝试 URL 加载、资源抓取、资源入库仍使用同一批服务方法。
- `enable_link_refetch=False` 时的行为仍由核心 flow 原逻辑处理。

## 测试策略

先写 `backend/tests/test_subscription_link_fallback_adapter.py` 并运行红测，确认新模块缺失。实现 adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_link_fallback_adapter.py tests/test_subscription_link_fallback_flow.py tests/test_subscription_auto_transfer_run_flow.py tests/test_subscription_transfer_phase_run_flow.py tests/test_subscription_item_processing_run_flow.py tests/test_subscription_source_run_integration.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变链接回退轮次、停止条件、资源过滤或 stats merge 规则。
- 不改变 `_auto_save_resources()` 批量转存 adapter。
- 不改变资源抓取、入库或 retry selection 规则。
