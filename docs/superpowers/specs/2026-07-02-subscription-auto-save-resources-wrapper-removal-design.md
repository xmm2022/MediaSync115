# 订阅 Auto Save Resources Wrapper 删除设计

## 背景

`SubscriptionService` 仍保留 `_auto_save_resources()` 私有方法。该方法只做默认依赖装配：

- 调用 `auto_save_resources_with_runtime_adapter()`。
- 传入 `build_default_auto_save_resources_runtime_dependencies()`。
- 原样转发 `db`、`run_id`、`channel`、`sub`、`records`、`source` 和
  `tv_missing_snapshot`。

前面的 link fallback 拆分已经让 `link_fallback_runtime_adapter` 自己默认绑定
`auto_save_resources_with_default_runtime_dependencies()`。当前代码中
`_auto_save_resources()` 不再有生产调用，只剩静态测试固定中间态。

本块目标是删除这个已无调用的 service wrapper，让自动转存批处理适配层完全停留在
`backend/app/services/subscriptions/auto_save_resources_runtime_adapter.py` 和其下游模块中。

## 方案比较

推荐方案：直接删除 `SubscriptionService._auto_save_resources()` 及其 service imports。

优点：

- 删除无生产调用的 service wrapper，继续收缩 `subscription_service.py`。
- 保持 link fallback runtime adapter 的默认 helper 不变。
- 不触碰自动转存 batch、adapter、通知、postprocess、精确转存等业务语义。
- 风险集中在静态边界和 import 清理，targeted tests 可以覆盖。

备选方案一：把 `_auto_save_resources()` 的默认 helper 再复制到 run channel runtime adapter。
这会增加无调用代码，且 run channel 已经通过 link fallback runtime adapter 间接使用自动转存默认 helper。

备选方案二：保留 wrapper 等后续统一删除。当前 wrapper 已经没有生产调用，继续保留只会让服务层边界测试表达错误的目标状态。

## 组件设计

修改文件：

- `backend/app/services/subscription_service.py`
  - 删除 `_auto_save_resources()`。
  - 移除 `auto_save_resources_with_runtime_adapter` 和
    `build_default_auto_save_resources_runtime_dependencies` imports。
  - 如果 `DownloadRecord` 只被该 wrapper 使用，同步从 `app.models.models` import 中移除。

测试文件：

- `backend/tests/test_subscription_service_auto_save_runtime_boundary.py`
  - 删除 `_auto_save_resources_source()` helper。
  - 将边界测试改为断言 service 不再包含：
    - `async def _auto_save_resources`
    - `auto_save_resources_with_runtime_adapter`
    - `build_default_auto_save_resources_runtime_dependencies`
    - `DownloadRecord`
  - 保留现有断言：service 不包含已下沉的 precise postprocess / notification 装配。

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 新增死 wrapper 静态测试，断言 `_auto_save_resources` 和 auto-save runtime helper/import 名称不再出现在 service 中。

## 行为保持

必须保持以下行为不变：

- 自动转存执行仍由 `auto_save_resources_with_runtime_adapter()` 和
  `auto_save_resources_batch()` 提供。
- link fallback runtime adapter 仍通过
  `auto_save_resources_with_default_runtime_dependencies()` 绑定自动转存默认依赖。
- 自动转存的 quality filter、缺集查询、step log、Kafka event、通知、postprocess 和归档触发不变。
- 不改变 `SubscriptionService.run_channel_check()`、`fetch_resources_for_media()` 或清理接口的 public API。

## 测试策略

红测：

- `scripts/verify-backend.sh -- tests/test_subscription_service_auto_save_runtime_boundary.py tests/test_subscription_service_dead_wrapper_cleanup.py -q`

实现前预期失败：

- auto-save 边界测试会发现 `_auto_save_resources()` 仍存在。
- dead wrapper 测试会发现 service 仍包含 auto-save runtime adapter imports 和 wrapper 名称。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_service_auto_save_runtime_boundary.py tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_auto_save_resources_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_link_fallback_runtime_adapter.py tests/test_subscription_link_fallback_flow.py -q`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、
`/healthz` 和最终工作区检查。

## 非目标

- 不修改 `auto_save_resources_runtime_adapter.py`。
- 不修改 `auto_save_resources_adapter.py`。
- 不修改 `auto_transfer_batch.py`。
- 不改通知、postprocess、归档触发或精确转存语义。
- 不处理 fixed source、资源抓取 flow 或 run channel 调度尾部。

## 自检

- 设计只删除无生产调用 wrapper 和 imports。
- 行为依赖留在现有 runtime adapter。
- 范围足够小，可由一个实施计划完成。
- 没有占位符、未定项或跨块依赖。
