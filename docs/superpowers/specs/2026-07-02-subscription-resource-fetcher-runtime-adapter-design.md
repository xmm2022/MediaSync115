# 订阅资源来源 Fetcher Runtime Adapter 拆分设计

## 背景

`resource_fetchers.py` 已经承载四类具体来源抓取业务：

- `fetch_from_pansou()`
- `fetch_from_hdhive()`
- `fetch_from_tg()`
- `fetch_offline_magnets()`

`resource_fetcher_adapter.py` 也已经把 concrete service 调用转换为 `ResourceFetcherDependencies`。但 `SubscriptionService` 仍保留 `_resource_fetcher_adapter_dependencies()` 和四个薄 wrapper：

- `_fetch_from_pansou()`
- `_fetch_from_hdhive()`
- `_fetch_from_tg()`
- `_fetch_offline_magnets()`

这些代码只绑定 runtime services（Pansou、HDHive、TG、SeedHub、不太灵、runtime settings、operation log）和核心 fetcher runner，不改变来源抓取业务规则。把它们迁入 runtime adapter 后，服务文件可以继续缩短，并为后续处理 `_store_new_resources()` 留出更清晰的边界。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/resource_fetcher_runtime_adapter.py`。该模块提供：

- `build_default_resource_fetcher_runtime_dependencies()`
- `fetch_from_pansou_with_runtime_adapter(...)`
- `fetch_from_hdhive_with_runtime_adapter(...)`
- `fetch_from_tg_with_runtime_adapter(...)`
- `fetch_offline_magnets_with_runtime_adapter(...)`

服务方法只调用这些 runtime wrapper，移除 `_resource_fetcher_adapter_dependencies()`。

备选方案一：只把 `_resource_fetcher_adapter_dependencies()` 移到服务类外的模块函数，四个 wrapper 仍调用 `fetch_*_with_adapter()`。风险低，但服务仍直接依赖纯 adapter wrapper 和 concrete 依赖构造。

备选方案二：直接删除四个服务 wrapper，让 `resource_resolver_runtime_adapter.py` 引用新 runtime adapter 函数。收益更大，但会改变 `_fetch_resources()` 里传入的 service method seam；当前测试里也会 monkeypatch 这些 service wrapper，保留方法签名更稳。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/resource_fetcher_runtime_adapter.py`
  - `build_default_resource_fetcher_runtime_dependencies()`
    - 返回 `ResourceFetcherAdapterDependencies`。
    - 绑定现有 concrete runtime 依赖：
      - `_search_pansou_pan115_resources`
      - `pansou_service.search_115`
      - `_normalize_pansou_pan115_list`
      - `hdhive_service.get_tv_pan115`
      - `hdhive_service.get_movie_pan115`
      - `hdhive_service.get_pan115_by_keyword`
      - `normalize_hdhive_subscription_items`
      - `runtime_settings_service.get_subscription_hdhive_prefer_free`
      - `hdhive_service.sort_free_first`
      - `tg_service.search_115_by_keyword`
      - `runtime_settings_service.get_subscription_offline_transfer_enabled`
      - `seedhub_service.search_magnets_by_keyword`
      - `butailing_service.search_magnets`
      - `operation_log_service.log_background_event`
      - `fetch_from_pansou_flow`
      - `fetch_from_hdhive_flow`
      - `fetch_from_tg_flow`
      - `fetch_offline_magnets_flow`
  - 四个 `*_with_runtime_adapter(...)`
    - 默认使用 `build_default_resource_fetcher_runtime_dependencies()`。
    - 测试可传入自定义 `ResourceFetcherAdapterDependencies`，避免触碰真实外部服务。
    - 调用现有 `resource_fetcher_adapter.py` wrapper。

修改文件：

- `backend/app/services/subscription_service.py`
  - 移除 `_resource_fetcher_adapter_dependencies()`。
  - 四个 `_fetch_from_*()` 方法改为调用新 runtime adapter wrapper。
  - 移除不再由服务直接使用的 Pansou/TG/SeedHub/Butailing imports、resource search aliases、`ResourceFetcherAdapterDependencies`、`fetch_*_with_adapter` 和具体 fetcher flow imports。

新增测试：

- `backend/tests/test_subscription_resource_fetcher_runtime_adapter.py`
  - runtime wrapper 使用传入的 `ResourceFetcherAdapterDependencies` 并调用对应 runner。
  - 默认 builder 绑定现有 concrete helper/runner 函数。
  - runtime adapter 不 import `subscription_service`、`app.api`、`AsyncSession` 或 ORM model。
  - 核心 `resource_fetcher_adapter.py` 仍由现有测试保证不 import runtime 层。

## 行为保持

必须保持以下行为不变：

- `_fetch_from_pansou()`、`_fetch_from_hdhive()`、`_fetch_from_tg()`、`_fetch_offline_magnets()` 方法签名不变。
- Pansou、HDHive、TG、SeedHub、不太灵、runtime settings 和 operation log 仍使用同一批 concrete services。
- 四个来源 fetcher 的核心 runner 不变。
- `resource_fetchers.py` 和 `resource_fetcher_adapter.py` 不改。

## 测试策略

先写 `backend/tests/test_subscription_resource_fetcher_runtime_adapter.py` 并运行红测，确认新模块缺失。实现 runtime adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_resource_fetcher_runtime_adapter.py tests/test_subscription_resource_fetcher_adapter.py tests/test_subscription_resource_fetchers.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_subscription_resource_resolver_adapter.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_ingest_run_flow.py tests/test_subscription_item_processing_run_flow.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变四个具体来源 fetcher 的业务逻辑。
- 不改变来源优先级、质量过滤、HDHive 解锁或资源入库规则。
- 不拆 `_store_new_resources()`，它会作为后续资源相关块单独处理。
