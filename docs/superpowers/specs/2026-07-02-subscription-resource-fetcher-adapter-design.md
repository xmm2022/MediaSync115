# 订阅资源来源抓取适配层拆分设计

## 背景

`SubscriptionService` 中资源来源抓取相关逻辑已拆出核心 helper：

- `resource_fetchers.fetch_from_pansou()`
- `resource_fetchers.fetch_from_hdhive()`
- `resource_fetchers.fetch_from_tg()`
- `resource_fetchers.fetch_offline_magnets()`

服务层剩余的 `_resource_fetcher_dependencies()` 主要把运行时服务单例和 helper 函数适配为 `ResourceFetcherDependencies`，四个 `_fetch_from_*` 方法也只是重复构造依赖后调用对应 flow。本轮应把这层来源服务适配抽到独立 helper。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/resource_fetcher_adapter.py`，提供 adapter dependencies、`build_resource_fetcher_dependencies()` 以及四个 `fetch_*_with_adapter()` 包装函数。新模块不导入 runtime settings、服务单例、ORM、模型或 API，只通过注入 callables 适配 Pansou/HDHive/TG/离线来源。

备选方案一：把适配逻辑并入 `resource_fetchers.py`。会把核心来源抓取规则和运行时服务适配混在一起，降低现有模块边界清晰度。

备选方案二：只保留当前 service 方法。行为安全，但 `subscription_service.py` 仍承担大量可测试的依赖装配。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/resource_fetcher_adapter.py`
  - `ResourceFetcherAdapterDependencies`
    - Pansou TMDB 搜索 callable
    - Pansou 关键词搜索 callable
    - Pansou normalize callable
    - HDHive TMDB/关键词 callable、normalize、免费优先配置、免费排序
    - TG 关键词搜索 callable
    - 离线转存开关
    - SeedHub/不太灵磁力搜索 callable
    - background event logger
    - 四个核心 fetcher runner
  - `build_resource_fetcher_dependencies(dependencies)`
    - 保持 Pansou 关键词搜索调用 `res="results"`。
    - 保持离线来源日志委托到注入的 background event logger。
    - 其他服务方法按当前签名透传。
  - `fetch_from_pansou_with_adapter(sub, dependencies)`
  - `fetch_from_hdhive_with_adapter(sub, dependencies)`
  - `fetch_from_tg_with_adapter(sub, dependencies)`
  - `fetch_offline_magnets_with_adapter(sub, dependencies)`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 adapter。
  - 将 `_resource_fetcher_dependencies()` 替换为 `_resource_fetcher_adapter_dependencies()`，只注入运行时服务和核心 runner。
  - 四个 `_fetch_from_*` 方法调用 adapter 包装函数。
  - 移除对 `ResourceFetcherDependencies` 和四个 core fetcher flow 的直接导入。

新增测试：

- `backend/tests/test_subscription_resource_fetcher_adapter.py`
  - `build_resource_fetcher_dependencies()` 保持 Pansou 关键词搜索 `res="results"`。
  - 离线来源日志委托到注入 logger。
  - 四个 adapter wrapper 把 sub 和构造后的 `ResourceFetcherDependencies` 传给对应 runner。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、数据库 session、模型、外部服务单例或 API。

## 行为保持

必须保持以下行为不变：

- Pansou TMDB 搜索参数不变。
- Pansou 关键词搜索仍使用 `res="results"`。
- HDHive TV/Movie TMDB 搜索、关键词搜索、normalize、免费优先排序不变。
- TG 搜索仍传递 media_type。
- 离线磁力仍由 core fetcher 控制是否并发调用 SeedHub/不太灵。
- 离线来源抓取日志仍写入 `operation_log_service.log_background_event()`。
- 四个 `_fetch_from_*` 方法的签名和返回值不变。

## 测试策略

先写 `backend/tests/test_subscription_resource_fetcher_adapter.py` 并运行红测，确认新模块缺失。实现 adapter 并接入后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_resource_fetcher_adapter.py tests/test_subscription_resource_fetchers.py tests/test_fetch_resources_waterfall.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `resource_fetchers.py` 的来源抓取规则。
- 不改变 Pansou/HDHive/TG/SeedHub/不太灵调用语义。
- 不改变资源 resolver、资源入库或自动转存逻辑。
