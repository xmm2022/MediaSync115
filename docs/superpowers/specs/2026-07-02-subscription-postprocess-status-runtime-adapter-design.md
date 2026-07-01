# 订阅后处理状态 Runtime Adapter 拆分设计

## 背景

`postprocess_status.py` 已经承载精准转存后处理状态的核心规则：

- 调用注入的归档触发器，固定传入 `trigger="subscription_transfer"`。
- 归档触发时把转存记录置为 `ARCHIVING`，并清空 `completed_at`。
- 归档未触发时把转存记录置为 `COMPLETED`，并写入注入的当前时间。
- 两种路径都清空 `error_message`，并返回归档触发结果。

`SubscriptionService._apply_precise_transfer_postprocess_status()` 目前仍在主服务里绑定运行时依赖：

- `media_postprocess_service.trigger_archive_after_transfer`
- `MediaStatus.ARCHIVING`
- `MediaStatus.COMPLETED`
- `beijing_now`

这些绑定不改变状态业务规则，只是 runtime wiring。把它抽到 runtime adapter 后，自动转存批处理仍通过服务兼容方法调用后处理状态，但主服务不再直接构造 `PostprocessStatusDependencies`。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/postprocess_status_runtime_adapter.py`，提供：

- `PostprocessStatusRuntimeDependencies`
- `build_default_postprocess_status_runtime_dependencies()`
- `apply_precise_transfer_postprocess_status_with_runtime_adapter(...)`

服务方法保留原签名，只调用 runtime wrapper。

备选方案一：把默认 builder 放进 `postprocess_status.py`。这样文件更少，但会把 `media_postprocess_service`、`MediaStatus`、`beijing_now` 等运行时依赖带入核心 helper，破坏已建立的依赖注入边界。

备选方案二：把 `_apply_precise_transfer_postprocess_status()` 直接内联到 `auto_save_resources_runtime_adapter.py`。这样可以少一个 adapter 文件，但会把后处理状态 wiring 绑定到自动转存 batch 适配器，后续 share、precise、already-received 分支复用和测试都会更窄。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/postprocess_status_runtime_adapter.py`
  - `PostprocessStatusRuntimeDependencies`
    - `trigger_archive_after_transfer`
    - `archiving_status`
    - `completed_status`
    - `now`
    - `run_apply_precise_transfer_postprocess_status`
  - `build_default_postprocess_status_runtime_dependencies()`
    - 绑定 `media_postprocess_service.trigger_archive_after_transfer`。
    - 绑定 `MediaStatus.ARCHIVING` 与 `MediaStatus.COMPLETED`。
    - 绑定 `beijing_now`。
    - 绑定核心 `apply_precise_transfer_postprocess_status()`。
  - `apply_precise_transfer_postprocess_status_with_runtime_adapter(record, dependencies=None)`
    - 使用默认或注入的 runtime dependencies。
    - 构造 `PostprocessStatusDependencies(...)`。
    - 调用 `run_apply_precise_transfer_postprocess_status(record, dependencies=...)`。

修改文件：

- `backend/app/services/subscription_service.py`
  - `_apply_precise_transfer_postprocess_status()` 改为调用 `apply_precise_transfer_postprocess_status_with_runtime_adapter(record)`。
  - 移除不再由主服务直接使用的 `PostprocessStatusDependencies`、`apply_postprocess_status_flow`、`media_postprocess_service`、`beijing_now`、`MediaStatus` 相关 import。

新增测试：

- `backend/tests/test_subscription_postprocess_status_runtime_adapter.py`
  - runtime wrapper 正确把运行时依赖转换为 `PostprocessStatusDependencies`。
  - wrapper 透传 record，并返回核心 runner 的返回值。
  - lower dependencies 可调用注入的归档触发器、状态值和时间函数。
  - 默认 builder 绑定现有归档服务、状态枚举、时间函数和 core runner。
  - runtime adapter 不 import `subscription_service`、`app.api` 或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- `_apply_precise_transfer_postprocess_status()` 方法签名不变。
- `postprocess_status.py` 的状态规则不变。
- trigger 字符串仍由核心 helper 固定为 `subscription_transfer`。
- 自动转存 precise、already-received 和 batch 分支仍通过同一服务 wrapper 调用后处理状态。
- 不改变事务提交、flush、归档触发条件或转存记录字段语义。

## 测试策略

先写 `backend/tests/test_subscription_postprocess_status_runtime_adapter.py` 并运行红测，确认新模块缺失。实现 runtime adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_postprocess_status_runtime_adapter.py tests/test_subscription_postprocess_status.py tests/test_subscription_precise_transfer_status.py tests/test_subscription_auto_save_resources_runtime_adapter.py tests/test_subscription_auto_transfer_batch.py tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_already_received.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改归档服务实现。
- 不改 `postprocess_status.py` 的核心状态规则。
- 不改自动转存失败处理、普通分享转存、离线转存或通知逻辑。
- 不引入新的后处理配置。

## 自检

- 文档已完整描述范围、组件和验证方式。
- 设计范围只覆盖 runtime wiring 抽离，不和核心后处理状态 helper 重叠。
- 测试策略包含红测、边界测试和相关回归。
