# 订阅链接回退转存拆分设计

## 背景

`backend/app/services/subscription_service.py` 中的 `_auto_save_records_with_link_fallback()` 负责自动转存批次的链接回退流程：写批次日志、调用 `_auto_save_resources()`、合并转存统计、判断是否继续回退、重新抓取资源、过滤已尝试链接、保存新资源并继续下一轮。该函数已经成为资源抓取和自动转存之间的编排层，仍留在 `SubscriptionService` 内会让主服务同时持有过多流程细节。

本轮目标是抽离链接回退转存 flow，保持行为兼容，并为后续拆 `_auto_save_resources()` 和资源抓取 flow 留出清晰边界。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/link_fallback_flow.py`，提供 `LinkFallbackDependencies` 和 `auto_save_records_with_link_fallback()`。新模块只依赖注入的回调，不直接导入 `SubscriptionService`、数据库 session 类型、运行时服务、资源搜索服务或 API 层。`SubscriptionService._auto_save_records_with_link_fallback()` 保留薄包装，负责把现有 `_create_step_log()`、`_auto_save_resources()`、`_load_subscription_resource_urls()`、`_fetch_resources()` 和 `_store_new_resources()` 适配为依赖。

备选方案一：只把默认统计字典和部分日志 payload 抽成小函数。这个方案风险最低，但不能减少主函数对回退循环和资源补充的控制职责，对后续拆分帮助有限。

备选方案二：把链接回退做成持有 `db/run_id/channel/sub` 状态的 class。这个方案可以减少参数传递，但会引入新的生命周期对象，和当前 `subscriptions/` 下 callback/dataclass helper 风格不一致，测试也更容易变成对象状态验证。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/link_fallback_flow.py`
  - `LinkFallbackDependencies`
  - `auto_save_records_with_link_fallback(...) -> dict[str, Any]`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新模块。
  - `_auto_save_records_with_link_fallback()` 改为构造依赖并委托给新 flow。
  - 保留原方法签名和返回结构，调用方不需要变化。

新增测试：

- `backend/tests/test_subscription_link_fallback_flow.py`
  - 覆盖空记录直接返回默认统计且不调用依赖。
  - 覆盖首轮转存成功时只执行一轮，统计和 batch-start 日志保持兼容。
  - 覆盖首轮失败后抓取、过滤、保存新资源并进行 fallback 轮次。
  - 覆盖到达链接回退上限时记录 `auto_transfer_link_fallback_limit`。
  - 覆盖 `enable_link_refetch=False` 时不会重新抓取。
  - 覆盖模块依赖边界，避免导入 `subscription_service`、运行时全局服务、`Pan115Service`、`AsyncSession` 和 `app.api`。

## 数据流

1. `SubscriptionService._auto_save_records_with_link_fallback()` 按原调用入口接收 `db/run_id/channel/sub/records`。
2. 薄包装创建 `LinkFallbackDependencies`，把现有实例方法包装为异步回调。
3. 新 flow 初始化与旧实现一致的合并统计结构。
4. 每轮先写 `auto_transfer_batch_start`，再调用注入的 `auto_save_resources()`。
5. 使用既有 `merge_auto_save_stats()` 和 `should_continue_link_fallback()` 判断是否继续。
6. 需要回退时，写 `auto_transfer_link_fallback_fetch`，读取已尝试 URL，调用注入的资源抓取回调。
7. 把抓取 trace 逐条转成 step log，继续使用既有 step/status/message/payload。
8. 使用既有 `filter_resources_excluding_urls()` 过滤已尝试资源。
9. 无新资源时写 `auto_transfer_link_fallback_empty` 并结束。
10. 有新资源时调用注入的 `store_new_resources()`，写 `auto_transfer_link_fallback_stored`，把新建记录作为下一轮 pending records。

## 行为保持

必须保持以下行为不变：

- 默认返回结构包含 `saved`、`failed`、`errors`、`subscription_completed`、`cleanup_step`、`cleanup_message`、`cleanup_payload`、`remaining_missing_count`、`link_fallback_rounds`。
- 空记录不写日志、不调用转存或抓取，直接返回默认统计。
- 首轮 source 使用 `transfer_source`，后续轮次使用 `{transfer_source}_fallback`。
- `link_fallback_rounds` 记录最后一次执行的轮次索引。
- 只有 `should_continue_link_fallback()` 判断需要继续且 `enable_link_refetch=True` 时才补充搜索。
- 达到 `MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS` 上限时只写 limit warning，不再抓取。
- 补充搜索时先加载已记录 URL，再抓取资源，再记录 fetch trace。
- 过滤后无资源时写 empty warning，payload 保留 `round`、`excluded_url_count`、`summary`。
- 保存新资源后写 stored 日志，payload 保留 `round`、`new_count`、`fetched_count`、`summary`。

## 测试策略

先写新模块直接测试并运行 targeted 测试确认红测失败。实现新模块和薄包装后，运行：

- `scripts/verify-backend.sh -- tests/test_subscription_link_fallback_flow.py tests/test_subscription_link_fallback.py tests/test_subscription_auto_transfer_failure.py tests/test_subscription_auto_transfer_share.py`
- `scripts/verify-backend.sh`
- `npm --prefix frontend run build`
- `scripts/verify.sh --quick`
- `docker compose up -d --build mediasync115`
- `/healthz` 和容器 health 检查

## 非目标

- 不拆 `_auto_save_resources()` 内部的具体转存分支。
- 不拆 `_fetch_resources()`、PanSou、HDHive、Telegram 或离线磁力抓取逻辑。
- 不改变资源去重、入库、失败记录、TV 缺集判断、通知、后处理或清理语义。
- 不修改前端、API schema、数据库 schema 或 Docker 配置。
