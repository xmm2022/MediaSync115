# 订阅服务未调用兼容 Wrapper 清理设计

## 背景

多轮拆分后，`SubscriptionService` 中还留着一些历史兼容薄包装：

- `_build_source_attempt_summary()`
- `_allow_unlock_by_threshold()`
- `_safe_int()`
- `_should_stop_unlocking_on_message()`

这些 wrapper 只把调用转发到已经抽离的 helper：

- `build_source_attempt_summary()`
- `allow_unlock_by_threshold()`
- `safe_int()`
- `should_stop_unlocking_on_message()`

当前 repo 内已无调用这些 `SubscriptionService` 私有 wrapper 的代码。对应 helper 自身仍由独立模块和测试覆盖。继续保留这些 wrapper 会让 `subscription_service.py` 多 import 一组不再需要的 helper，并制造“主服务仍持有资源尝试/HDHive policy 逻辑”的误导。

本块只删除无调用的私有 wrapper，不改变仍被使用的 `_build_hdhive_unlock_context()` 和 `_prepare_hdhive_locked_resources()`。

## 方案比较

推荐方案：删除四个无调用 wrapper 及相关 imports。

备选方案一：保留 wrapper 作为潜在外部兼容。它们都是前导下划线私有方法，repo 内无调用，且用户目标是持续收缩主服务；保留会降低拆分收益。

备选方案二：迁移到新的兼容 adapter。没有实际调用者，只会增加一层无意义 indirection。

## 组件设计

修改文件：

- `backend/app/services/subscription_service.py`
  - 移除 import：
    - `build_source_attempt_summary`
    - `allow_unlock_by_threshold`
    - `safe_int`
    - `should_stop_unlocking_on_message`
  - 删除方法：
    - `_build_source_attempt_summary(...)`
    - `_allow_unlock_by_threshold(...)`
    - `_safe_int(...)`
    - `_should_stop_unlocking_on_message(...)`

新增测试：

- `backend/tests/test_subscription_service_dead_wrapper_cleanup.py`
  - 静态读取 `subscription_service.py`，断言上述 wrapper 名称和 helper import 名称不再存在。
  - 同时断言仍保留 `_build_hdhive_unlock_context` 和 `_prepare_hdhive_locked_resources`，避免误删仍被 run flow/resource resolver 使用的 wrapper。

## 行为保持

必须保持以下行为不变：

- `SubscriptionService` public API 不变。
- `_fetch_resources()`、HDHive 解锁 context 构造和 locked resource prepare 行为不变。
- `subscriptions.source_attempts` 和 `subscriptions.hdhive_unlock` helper 模块不变。
- 现有 helper tests 继续覆盖 source attempts summary、HDHive unlock threshold/safe int/stop-message policy。

## 测试策略

红测：

- 新增静态测试后运行：
  - `scripts/verify-backend.sh -- tests/test_subscription_service_dead_wrapper_cleanup.py -q`
- 预期失败，因为 wrapper 和 import 仍存在。

实现后 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_service_dead_wrapper_cleanup.py tests/test_subscription_source_attempts.py tests/test_hdhive_unlock_policy.py -q`

随后执行每轮完成标准：相关 targeted backend tests、后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不删除 `_build_hdhive_unlock_context()`。
- 不删除 `_prepare_hdhive_locked_resources()`。
- 不改变 resource resolver、HDHive unlock、source attempts helper 行为。
- 不改 API 或调用路径。

## 自检

- 已用 `rg` 确认四个目标 wrapper 在 repo 内无调用。
- 设计范围只删除无调用私有 wrapper。
- 测试覆盖“删除目标”和“保留非目标”两类边界。
