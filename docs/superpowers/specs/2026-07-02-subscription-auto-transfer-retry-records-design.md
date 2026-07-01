# 订阅自动转存重试记录选择拆分设计

## 背景

`SubscriptionService.run_channel_check()` 在自动转存前仍内联选择 retry 记录：

- 自动转存开启时加载可重试历史记录。
- 强制自动转存且本轮发现重复链接时加载重复链接对应记录。
- 合并两类历史记录。
- 排除本轮新创建记录，避免同一资源在 new 和 retry 分支重复转存。

这段逻辑只决定 retry 转存输入集合，不负责执行转存、写日志、更新计数、清理订阅或提交事务。抽离后可以让自动转存阶段的控制流更清晰，并为后续拆 `_auto_save_resources()` 留出更窄的边界。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/auto_transfer_retry_records.py`，提供一个依赖注入的异步 helper，封装 retry 记录加载、强制重复链接补充、合并和排除本轮新记录。`run_channel_check()` 继续负责判断 `should_auto_download`、后续 new/retry 转存执行、日志、计数和清理。

备选方案一：把整个自动转存分支抽成 flow。收益更大，但会同时移动日志、计数、清理和 link fallback 依赖，本轮变化面过大。

备选方案二：把逻辑并入 `record_selection.py`。该模块目前是同步纯选择规则；新增异步 loader 依赖会让模块职责混杂。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/auto_transfer_retry_records.py`
  - `AutoTransferRetryRecordDependencies`
    - `load_retryable_records(db, subscription_id)`
    - `load_force_retry_records(db, subscription_id, duplicate_urls)`
  - `select_auto_transfer_retry_records(...)`
    - 当 `auto_download` 为真时加载历史可重试记录。
    - 当 `force_auto_download` 为真且 `duplicate_urls` 非空时加载重复链接对应记录。
    - 使用现有 `merge_records()` 保持合并去重规则。
    - 使用现有 `exclude_new_records()` 保持排除本轮新记录规则。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新 helper 和 dependencies dataclass。
  - 用 helper 替换自动转存分支开头的 retry 选择内联代码。
  - 移除不再直接使用的 `merge_records` / `exclude_new_records` 导入。

新增测试：

- `backend/tests/test_subscription_auto_transfer_retry_records.py`
  - 自动转存开启时加载可重试记录，并排除本轮新建同 URL 记录。
  - 强制自动转存且有重复链接时加载重复链接记录，即使订阅未开启自动转存。
  - 自动转存与强制转存同时开启时，沿用 `merge_records()` 去重顺序。
  - `duplicate_urls` 为空时不调用强制 loader。
  - 模块边界测试：不导入 `subscription_service`、runtime settings、数据库 session、模型、外部服务或 API。

## 行为保持

必须保持以下行为不变：

- `should_auto_download = force_auto_download or bool(sub.auto_download)` 的判断位置不变。
- 未进入自动转存分支时不加载 retry 记录。
- `sub.auto_download` 为真时才加载普通可重试记录。
- `force_auto_download` 为真且存在 `duplicate_urls` 时才加载重复链接记录。
- 普通 retry 记录和强制 retry 记录仍按 `merge_records()` 的现有规则合并。
- retry 记录仍通过 `exclude_new_records()` 排除本轮 `created_records`。
- new 转存仍先于 retry 转存。
- 所有转存日志、计数、清理和异常处理行为不变。

## 测试策略

先写 `backend/tests/test_subscription_auto_transfer_retry_records.py` 并运行红测，确认新模块缺失。实现 helper 并接入后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_retry_records.py tests/test_subscription_record_selection.py tests/test_subscription_source_run_integration.py tests/test_subscriptions.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不抽离 `_auto_save_records_with_link_fallback()`。
- 不抽离 `_auto_save_resources()`。
- 不改变 `_load_retryable_records()` 或 `_load_force_retry_records()` 的查询条件。
- 不改变自动转存、通知、postprocess、清理或订阅完成判断语义。
