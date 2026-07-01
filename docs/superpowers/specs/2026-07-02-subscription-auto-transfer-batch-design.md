# 订阅自动转存批处理拆分设计

## 背景

`SubscriptionService._auto_save_resources()` 当前仍承担自动转存批处理的运行时适配和流程编排。单条记录的 TV 缺集上下文、离线任务、精准转存、普通分享转存、已接收恢复和失败日志已经拆入 `backend/app/services/subscriptions/` 下的 helper，但 `_auto_save_resources()` 仍保留：

- Pan115、默认目录、离线目录、画质过滤等运行时依赖准备。
- 批处理统计字段初始化和返回结构。
- 每条资源的 `auto_transfer_item_start` 日志。
- 离线、精准、普通分享、已接收、普通失败分支的顺序和 loop control。
- `remaining_missing_count` 的返回。

本轮目标是抽离自动转存批处理 flow，让 `SubscriptionService._auto_save_resources()` 只负责把现有运行时服务适配为依赖，保持调用方和业务语义不变。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/auto_transfer_batch.py`，提供 `AutoTransferBatchStatuses`、`AutoTransferBatchDependencies` 和 `auto_save_resources_batch()`。新模块直接复用已有单条记录 helper 和纯策略 helper；运行时服务、Pan115 实例方法、数据库日志上下文、Kafka、当前时间、目录设置仍通过依赖注入传入。`SubscriptionService._auto_save_resources()` 保留原签名，构造 statuses/dependencies 后调用新 flow。

备选方案一：把所有单条记录 helper 也作为回调注入到批处理模块。这个方案测试更容易完全 stub，但 `SubscriptionService` wrapper 会变成几十个参数的转发表，代码可读性较差。

备选方案二：直接把 `_auto_save_resources()` 移到新 class，并在 class 内构造 Pan115 和读取 runtime settings。这个方案行数收益大，但会把新模块重新绑定到运行时全局状态，违背当前 `subscriptions/` helper 的依赖注入方向。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/auto_transfer_batch.py`
  - `AutoTransferBatchStatuses`
  - `AutoTransferBatchDependencies`
  - `auto_save_resources_batch(...) -> dict[str, Any]`

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入新模块。
  - `_auto_save_resources()` 保留原方法签名。
  - 继续在 service 内创建 `Pan115Service`、读取默认转存目录、解析画质过滤、封装 step log、Kafka 和 Pan115 方法。
  - 把 loop 和分支编排委托给 `auto_save_resources_batch()`。

新增测试：

- `backend/tests/test_subscription_auto_transfer_batch.py`
  - 覆盖普通分享转存成功：写 item-start 日志，调用分享转存 helper，返回 cleanup metadata 并停止。
  - 覆盖离线任务：按运行时离线目录提交，movie 分支保存后停止。
  - 覆盖普通分享转存失败：异常进入失败 helper，累计 `failed` 和 `errors`。
  - 覆盖 TV 精准转存：使用传入 snapshot 构建缺集上下文，精准转存后返回 `remaining_missing_count`。
  - 覆盖已接收错误：普通分享抛出已接收错误后走 already-received helper，不落入普通失败。
  - 覆盖模块依赖边界：不导入 `subscription_service`、`runtime_settings_service`、`Pan115Service`、`AsyncSession`、运行时全局服务或 `app.api`。

## 数据流

1. `SubscriptionService._auto_save_resources()` 接收原有 `db/run_id/channel/sub/records/source/tv_missing_snapshot`。
2. service wrapper 创建 `Pan115Service`，读取默认转存文件夹和画质过滤。
3. service wrapper 构造 context-aware `create_step_log()`、`fetch_tv_missing_status()`、`submit_offline_task()`、`emit_transfer_success()`、`select_precise_missing_episode_files()` 等回调。
4. service wrapper 创建 `AutoTransferBatchStatuses`，传入 `MediaStatus` 枚举值。
5. `auto_save_resources_batch()` 构建 TV 缺集上下文。
6. 新 flow 逐条写 `auto_transfer_item_start`。
7. 离线记录走 `submit_offline_transfer_record()`，按 `should_stop` 控制 movie 停止、TV 继续。
8. 普通分享记录先拆 share link/receive code，设置 `TRANSFERRING`。
9. TV 缺集开启时走 `submit_precise_transfer_record()`，按 `should_continue` 和 `should_stop` 控制循环。
10. 非精准场景走 `submit_share_transfer_record()`，成功后按旧语义停止。
11. 异常先识别 already-received，命中时走 `handle_already_received_transfer()`；未命中或 already-received 处理后仍需记录普通失败时，走 `handle_transfer_failure()`。
12. 返回旧结构：`saved`、`failed`、`errors`、`subscription_completed`、`cleanup_step`、`cleanup_message`、`cleanup_payload`、`remaining_missing_count`。

## 行为保持

必须保持以下行为不变：

- Pan115 cookie、默认转存目录、离线目录、画质过滤读取位置和语义不变。
- 每条记录处理前仍写 `auto_transfer_item_start`。
- 离线任务仍使用离线下载目录，不使用默认转存目录。
- 分享记录仍先设置为 `TRANSFERRING`。
- TV 缺集可用时优先精准转存，跳过不含缺集的资源后继续下一条。
- 普通分享成功、电影离线提交、电影已接收恢复仍会停止当前批处理。
- 普通失败仍设置记录为 `FAILED`，写 try-next/item-failed 日志和操作日志，并把 error entry 加入返回结果。
- `remaining_missing_count` 只在 TV 缺集上下文启用时返回缺集集合长度，否则返回 `None`。

## 测试策略

先写 `backend/tests/test_subscription_auto_transfer_batch.py`，直接调用新批处理 helper，确认模块缺失导致红测失败。实现后运行 targeted tests：

- `scripts/verify-backend.sh -- tests/test_subscription_auto_transfer_batch.py tests/test_subscription_auto_transfer_context.py tests/test_subscription_auto_transfer_offline.py tests/test_subscription_auto_transfer_precise.py tests/test_subscription_auto_transfer_share.py tests/test_subscription_auto_transfer_already_received.py tests/test_subscription_auto_transfer_failure.py tests/test_subscription_link_fallback_flow.py`

随后执行每轮完成标准：后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改变任何单条记录 helper 的内部逻辑。
- 不拆资源抓取 `_fetch_resources()` 或来源 waterfall。
- 不改 TV 缺集策略、清理策略、通知、Kafka 事件、后处理或操作日志语义。
- 不改数据库 schema、API、前端或 Docker 配置。
