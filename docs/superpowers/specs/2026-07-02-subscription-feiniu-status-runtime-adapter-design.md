# 订阅飞牛状态 Runtime Adapter 拆分设计

## 背景

`SubscriptionService` 目前仍直接承载飞牛媒体库状态查询逻辑：

- `_check_feiniu_movie_status()` 读取 runtime 飞牛地址、优先查同步索引、再回退 live 飞牛服务，并把结果归一成 `{"checked": bool, "exists": bool, "item_ids": list}`。
- `_check_feiniu_tv_missing_status()` 读取 runtime 飞牛地址、优先查同步索引、再回退 live 飞牛服务，然后读取 TMDB 剧集详情并计算缺失集数，返回 `{"checked": bool, "missing_count": int}`。

这两段逻辑被预扫描清理和完成后清理当作 callable 注入使用。它们不依赖 `SubscriptionService` 自身状态，也不需要数据库事务；主类直接导入 `runtime_settings_service`、`feiniu_service`、`feiniu_sync_index_service` 和延迟导入 `tmdb_service` 只是 runtime wiring。把它们抽到 subscriptions 子模块中的 runtime adapter 后，主服务只保留兼容 wrapper，并减少后续总调度拆分时的全局服务耦合。

用户已要求连续推进，不在每轮之间等待确认；本设计自检通过后直接进入实施计划。

## 方案比较

推荐方案：新增 `backend/app/services/subscriptions/feiniu_status_runtime_adapter.py`，提供：

- `FeiniuStatusRuntimeDependencies`
- `build_default_feiniu_status_runtime_dependencies()`
- `check_feiniu_movie_status_with_runtime_adapter(...)`
- `check_feiniu_tv_missing_status_with_runtime_adapter(...)`

服务方法保留原签名，只调用 runtime adapter。

备选方案一：把查询逻辑抽成纯 core 文件，再额外加 runtime adapter。这样边界最纯，但当前逻辑只有两个运行时入口，尚无多个调用层需要复用 core dataclass；拆成两层会增加文件和计划成本，不符合本轮“小而稳”的目标。

备选方案二：把飞牛状态查询并入 `pre_scan_cleanup.py` 或 `completed_cleanup.py`。这样会让两个清理 flow 重新直接依赖飞牛/TMDB/runtime settings，破坏已经抽出的依赖注入边界，也会让同一查询语义在两个清理阶段更难复用。

## 组件设计

新增文件：

- `backend/app/services/subscriptions/feiniu_status_runtime_adapter.py`
  - `FeiniuStatusRuntimeDependencies`
    - `get_feiniu_url`
    - `get_indexed_movie_status`
    - `get_live_movie_status`
    - `get_indexed_tv_existing_episodes`
    - `get_live_tv_episode_status`
    - `get_tv_detail`
    - `logger`
  - `build_default_feiniu_status_runtime_dependencies()`
    - 绑定 `runtime_settings_service.get_feiniu_url`。
    - 绑定 `feiniu_sync_index_service.get_movie_status`。
    - 绑定 `feiniu_service.get_movie_status_by_tmdb`。
    - 绑定 `feiniu_sync_index_service.get_tv_existing_episodes`。
    - 绑定 `feiniu_service.get_tv_episode_status_by_tmdb`。
    - 绑定 `tmdb_service.get_tv_detail`。
    - 绑定模块 logger。
  - `check_feiniu_movie_status_with_runtime_adapter(tmdb_id, dependencies=None)`
    - 飞牛 URL 为空时返回 `{"checked": False}`。
    - 优先使用 indexed movie status；存在且 `status == "ok"` 且 `exists` 为真时返回已检查、存在和 `item_ids`。
    - indexed movie status 不为空但未命中存在时返回已检查、不存在和空 `item_ids`。
    - indexed movie status 为空时查询 live movie status；`not_logged_in` 返回 `{"checked": False}`，其他 status 保持现有 checked/exists 归一规则。
    - 异常时记录 `飞牛电影状态查询失败: tmdb_id=%s` 并返回 `{"checked": False}`。
  - `check_feiniu_tv_missing_status_with_runtime_adapter(tmdb_id, dependencies=None)`
    - 飞牛 URL 为空时返回 `{"checked": False}`。
    - 优先使用 indexed TV existing episodes；为空时回退 live TV episode status。
    - 非 `ok` status 返回 `{"checked": False}`。
    - 仅把 list/set 中的二元 list/tuple episode pair 转成 `(season, episode)` 集合；其他形态沿用原值，保持现有行为。
    - 从 TMDB seasons 构造非第 0 季的 episode pair 集合；无可用 TMDB pair 时返回 `{"checked": False}`。
    - 返回 `{"checked": True, "missing_count": len(tmdb_pairs - feiniu_existing_pairs)}`。
    - 异常时记录 `飞牛剧集缺集状态查询失败: tmdb_id=%s` 并返回 `{"checked": False}`。

修改文件：

- `backend/app/services/subscription_service.py`
  - 导入两个 runtime adapter wrapper。
  - `_check_feiniu_movie_status()` 改为调用 `check_feiniu_movie_status_with_runtime_adapter(tmdb_id)`。
  - `_check_feiniu_tv_missing_status()` 改为调用 `check_feiniu_tv_missing_status_with_runtime_adapter(tmdb_id)`。
  - 移除主服务不再直接使用的 `feiniu_service`、`feiniu_sync_index_service` imports。
  - 如果 `runtime_settings_service` 仍被其他 wrapper 使用则保留；否则移除。

新增测试：

- `backend/tests/test_subscription_feiniu_status_runtime_adapter.py`
  - 飞牛 URL 为空时 movie/TV 查询不调用下游服务并返回 unchecked。
  - movie 查询优先使用 indexed status，命中存在时保留 `item_ids`。
  - movie indexed miss 后不会回退 live，保持现有“索引结果权威”行为。
  - movie live `not_logged_in` 返回 unchecked。
  - TV 查询用 indexed episode pair 与 TMDB seasons 计算缺失数。
  - TV indexed 为空时回退 live TV episode status。
  - movie/TV 异常都记录 logger exception 并返回 unchecked。
  - 默认 builder 绑定现有 runtime 服务、TMDB 服务和 logger。
  - runtime adapter 不 import `subscription_service`、`app.api` 或 `AsyncSession`。

## 行为保持

必须保持以下行为不变：

- `_check_feiniu_movie_status()` 和 `_check_feiniu_tv_missing_status()` 方法签名不变。
- 返回字典 key 和布尔语义不变。
- 飞牛 URL 为空时不访问索引、live 飞牛服务或 TMDB。
- movie 查询仍优先使用索引结果，索引返回非空时不再回退 live。
- TV 查询仍只接受 `status == "ok"`。
- TV TMDB 详情仍只按 seasons 的 `season_number` 与 `episode_count` 构造全集范围，并跳过第 0 季。
- 异常日志消息和 unchecked fallback 不变。
- 预扫描清理与完成后清理继续通过服务 wrapper 注入 callable，不改变清理策略。

## 测试策略

先写 `backend/tests/test_subscription_feiniu_status_runtime_adapter.py` 并运行红测，确认新模块缺失。实现 runtime adapter 并接入服务后运行：

- `scripts/verify-backend.sh -- tests/test_subscription_feiniu_status_runtime_adapter.py tests/test_pre_scan_cleanup.py tests/test_completed_cleanup.py`

随后执行每轮完成标准：相关 targeted backend tests、后端全量、前端 build、quick 验证、Docker build/up、`/healthz` 和最终工作区检查。

## 非目标

- 不改飞牛服务、同步索引服务或 TMDB 服务实现。
- 不改预扫描清理、完成后清理或清理策略。
- 不改 TV 缺集算法的边界行为，即使当前对非 list/set 的 `existing_episodes` 保持原值。
- 不引入新的飞牛配置项或重试策略。

## 自检

- 文档已完整描述范围、组件和验证方式。
- 设计范围只覆盖飞牛状态查询 runtime wiring，不改变清理 flow 或飞牛服务语义。
- 测试策略包含红测、默认绑定、异常兜底和相关清理回归。
