# 订阅 Runtime Preferences Adapter 拆分设计

## 背景

`source_attempts.py` 已经提供纯函数 `resolve_source_order()`，`quality_filter.py` 已经提供纯函数 `build_subscription_quality_filter()`。但 `SubscriptionService` 仍保留两段 runtime settings 装配：

- `_resolve_source_order()` 读取资源来源优先级和 TG 配置完整性，再调用 `resolve_source_order()`。
- `_resolve_subscription_quality_filter()` 读取分辨率、HDR、编码、排除标签、音频、字幕和大小偏好，再构造 `SubscriptionQualityPreferences`。

这两段逻辑本质上是运行时偏好读取与纯 helper 适配，不决定资源抓取、排序或过滤业务规则。把它们迁入 runtime adapter 后，资源 resolver、固定来源扫描和自动转存仍通过 `SubscriptionService` 兼容方法拿到同样结果，但主服务不再承载这些 settings 读取细节。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/runtime_preferences_adapter.py`，同时承载 source order 与 quality filter 的 runtime settings 读取。该模块提供：

- `RuntimePreferencesDependencies`
- `build_default_runtime_preferences_dependencies()`
- `resolve_source_order_with_runtime_adapter(...)`
- `resolve_subscription_quality_filter_with_runtime_adapter(...)`

服务方法只调用两个 runtime wrapper，保留原方法签名。

备选方案一：分别新增 `source_order_runtime_adapter.py` 和 `quality_filter_runtime_adapter.py`。边界更细，但两个模块都很薄，会增加文件数量和重复测试模板。

备选方案二：把 runtime settings 读取放进 `source_attempts.py` 和 `quality_filter.py`。这会破坏这两个模块当前的纯函数边界，也与已有依赖注入测试方向相反。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/runtime_preferences_adapter.py`
  - `RuntimePreferencesDependencies`
    - source order 依赖：
      - `get_resource_priority()`
      - `get_tg_api_id()`
      - `get_tg_api_hash()`
      - `get_tg_session()`
      - `get_tg_channel_usernames()`
      - `run_resolve_source_order(priority, tg_ready=...)`
    - quality filter 依赖：
      - `get_resource_preferred_resolutions()`
      - `get_resource_preferred_hdr()`
      - `get_resource_preferred_codec()`
      - `get_resource_exclude_tags()`
      - `get_resource_preferred_audio()`
      - `get_resource_preferred_subtitles()`
      - `get_resource_min_size_gb()`
      - `get_resource_max_size_gb()`
      - `build_quality_filter(preferences)`
  - `build_default_runtime_preferences_dependencies()`
    - 绑定 `runtime_settings_service` 的现有 getter。
    - 绑定 `resolve_source_order()` 和 `build_subscription_quality_filter()`。
  - `resolve_source_order_with_runtime_adapter(channel, dependencies=None)`
    - 保留 `channel` 参数但不改变当前忽略 channel 的行为。
    - 用 strip 后的 TG API id/hash/session 与频道列表判断 `tg_ready`。
  - `resolve_subscription_quality_filter_with_runtime_adapter(sub, dependencies=None)`
    - 保留 `sub` 参数但不改变当前忽略 sub 的行为。
    - 读取 runtime settings 并构造 `SubscriptionQualityPreferences` 后调用 builder。

修改文件：

- `backend/app/services/subscription_service.py`
  - `_resolve_source_order()` 改为调用 `resolve_source_order_with_runtime_adapter(channel)`。
  - `_resolve_subscription_quality_filter()` 改为调用 `resolve_subscription_quality_filter_with_runtime_adapter(sub)`。
  - 移除不再由服务直接使用的 `SubscriptionQualityPreferences`、`build_subscription_quality_filter` 和 `resolve_source_order` imports。
  - `runtime_settings_service` 仍保留，因为主服务其他 wrappers 还直接使用它。

新增测试：

- `backend/tests/test_subscription_runtime_preferences_adapter.py`
  - source order wrapper 使用注入的 priority/TG getters，并把 `tg_ready` 传给核心 resolver。
  - TG 凭据缺失或空白时 source order 会过滤 TG。
  - quality filter wrapper 使用注入 settings 构造 `SubscriptionQualityPreferences` 并调用 builder。
  - 默认 builder 绑定现有 runtime getter 和核心 helper。
  - runtime preferences adapter 不 import `subscription_service`、`app.api`、`AsyncSession` 或 ORM model。

## 行为保持

必须保持以下行为不变：

- `_resolve_source_order(channel)` 和 `_resolve_subscription_quality_filter(sub)` 方法签名不变。
- source order 仍只支持 `hdhive`、`pansou`、`tg`，不改变来源过滤和 TG readiness 语义。
- quality filter 输出 key 和空列表转 `None` 行为不变。
- 资源 resolver、固定来源扫描、自动转存批处理继续通过服务 wrapper 获取 source order 和 quality filter。
- `source_attempts.py` 与 `quality_filter.py` 的核心业务规则不改。

## 测试策略

先写 `backend/tests/test_subscription_runtime_preferences_adapter.py` 并运行红测，确认新模块缺失。实现 runtime adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_runtime_preferences_adapter.py tests/test_subscription_source_attempts.py tests/test_subscription_quality_filter.py tests/test_resource_tags_quality.py tests/test_fetch_resources_waterfall.py tests/test_subscription_resource_resolver_runtime_adapter.py tests/test_fixed_source_scan.py tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_run_start_flow.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变来源优先级配置格式或 TG readiness 规则。
- 不改变质量过滤字段含义、排序偏好或排除规则。
- 不拆 `run_channel_check()` 总调度结构。
- 不处理通知、postprocess 或固定来源扫描的其他 runtime wiring。
