# 订阅质量过滤拆分设计

## 背景

`SubscriptionService._resolve_subscription_quality_filter()` 仍在主服务里直接读取运行时资源偏好，并拼装传给资源瀑布流、固定来源扫描和自动转存的 `quality_filter`：

- `preferred_resolutions`
- `preferred_formats`，由 HDR 偏好和编码偏好按顺序拼接
- `exclude_labels`
- `preferred_languages`
- `preferred_subtitles`
- `min_size_gb`
- `max_size_gb`

这段逻辑属于资源质量过滤配置解析，不需要占用 `SubscriptionService`。本轮目标是把“偏好值如何组合成 filter dict”的规则移到订阅 helper 模块；主服务继续负责读取 runtime settings。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/quality_filter.py`，提供 `SubscriptionQualityPreferences` 和 `build_subscription_quality_filter()`。helper 只接收已经读取好的偏好值，不导入 runtime settings、数据库、API 或 `SubscriptionService`。`SubscriptionService._resolve_subscription_quality_filter()` 保留原签名，构造 preferences 后委托 helper。

备选方案一：让 `_resolve_subscription_quality_filter()` 直接调用现有 `app.utils.resource_tags.build_quality_filter_from_settings()`。代码最少，但会把 runtime settings 读取藏进通用工具，主服务也无法注入或测试“订阅偏好组合规则”。

备选方案二：把所有资源过滤逻辑合并到 `app.utils.resource_tags` 并同步修改调用方。这个方向可能减少重复，但会扩大本轮影响面，触及手动转存、探索队列和 Pan115 选择逻辑，不适合作为订阅服务拆分的一小步。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/quality_filter.py`
  - `SubscriptionQualityPreferences`
  - `build_subscription_quality_filter(preferences)`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 helper。
  - `_resolve_subscription_quality_filter()` 改为薄包装：读取 runtime settings，构造 `SubscriptionQualityPreferences`，调用 helper。
  - `_resolve_subscription_resolutions()` 暂不改语义，继续返回当前 runtime resolutions。

新增测试：

- `backend/tests/test_subscription_quality_filter.py`
  - HDR 和 Codec 偏好按当前顺序合并为 `preferred_formats`。
  - 空列表转换为 `None`，尺寸上下限按原值透传。
  - 排除标签、音轨、字幕偏好保留原列表。
  - 模块边界测试：不导入 `subscription_service`、`runtime_settings_service`、`AsyncSession`、`app.models` 或 `app.api`。

## 数据流

1. `SubscriptionService._resolve_subscription_quality_filter(sub)` 保留原方法签名，继续忽略 `sub`。
2. wrapper 从 `runtime_settings_service` 读取现有偏好 getter。
3. wrapper 构造 `SubscriptionQualityPreferences`：
   - `preferred_resolutions`
   - `preferred_hdr`
   - `preferred_codec`
   - `exclude_labels`
   - `preferred_audio`
   - `preferred_subtitles`
   - `min_size_gb`
   - `max_size_gb`
4. `build_subscription_quality_filter()` 返回与当前方法同形状的 dict。
5. `_fetch_resources()`、`_scan_fixed_sources_for_subscription()` 和 `_auto_save_resources()` 的调用方式不变。

## 行为保持

必须保持以下行为不变：

- `preferred_formats` 仍为 `(hdr or []) + (codec or [])`。
- 空列表继续转为 `None`，避免下游把空偏好当作启用过滤。
- `min_size_gb` 和 `max_size_gb` 不做真假值转换，原样保留 `None` 或数字。
- dict key 名称不变。
- `_resolve_subscription_quality_filter()` 继续接受 `SubscriptionSnapshot` 参数，即使当前不使用。
- 不改变质量过滤如何应用到资源列表；本轮只移动配置拼装。

## 测试策略

先写 `backend/tests/test_subscription_quality_filter.py` 并运行红测，确认新模块缺失。实现 helper 后运行该测试，再改 `SubscriptionService` wrapper 并跑相关回归：

- `scripts/verify-backend.sh -- tests/test_subscription_quality_filter.py tests/test_resource_tags_quality.py tests/test_fetch_resources_waterfall.py tests/test_fixed_source_scan.py tests/test_subscription_auto_transfer_batch.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改 `app.utils.resource_tags.build_quality_filter_from_settings()`。
- 不改资源过滤算法、排序算法或 Pan115 文件选择逻辑。
- 不引入订阅级独立偏好覆盖；本轮只保留当前全局 runtime settings 行为。
