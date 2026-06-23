# 手动 115 固定来源追新设计

## 背景

当前订阅模式以影视条目为中心：定时从 HDHive、Pansou、Telegram 等来源搜索资源，发现新的资源 URL 后转存。电视剧会结合 TMDB、Emby/飞牛缺集状态做精准转存。

这个模式不覆盖“同一个 115 分享链接后续新增文件”的场景，因为现有去重粒度是 `DownloadRecord.resource_url`。同一个分享链接首次处理后，即使链接内新增剧集，后续也会被视为重复资源。

## 目标

新增一个可选的“手动 115 固定来源”能力：

- 只有用户手动导入的 115 分享链接可以作为固定追新来源。
- 固定来源不替换现有自动搜索订阅，老订阅默认行为不变。
- 一个电视剧订阅可以同时启用现有自动搜索和一个或多个手动 115 固定来源。
- 订阅页能看到固定来源来自哪个链接、最近扫描状态、最近错误和操作入口。
- 定时任务会反复扫描固定来源链接内部文件，发现订阅范围内缺失的新集后精准转存。

## 非目标

- 第一阶段不把 HDHive 解锁得到的 115 链接自动保存为固定来源。
- 第一阶段不接入 HDHive 官方 OpenAPI/OAuth。
- 第一阶段不改变 HDHive、Pansou、Telegram 自动搜索逻辑。
- 第一阶段不做跨来源资源质量打分，只沿用已有画质偏好和最佳文件选择逻辑。

用户仍然可以从 HDHive 解锁后手动复制 115 链接，再用“手动导入 115 分享”加入固定来源。

## 数据模型

新增 `subscription_sources` 表，表示订阅的固定来源。

核心字段：

- `id`
- `subscription_id`
- `source_type`: 第一阶段固定为 `manual_pan115_share`
- `display_name`: 用户可见名称，默认取分享目录名或订阅标题
- `share_url`: 原始 115 分享链接
- `receive_code`: 提取码
- `enabled`
- `last_scanned_at`
- `last_scan_status`: `never`、`success`、`warning`、`failed`
- `last_error`
- `last_found_episode`
- `last_transferred_count`
- `created_at`
- `updated_at`

新增 `subscription_source_files` 表，记录固定来源内已识别/已处理的文件。

核心字段：

- `id`
- `source_id`
- `share_file_id`
- `file_name`
- `file_size`
- `season_number`
- `episode_number`
- `fingerprint`: 优先由 `share_file_id` 组成，缺失时用文件名和大小
- `status`: `seen`、`matched`、`transferred`、`skipped`、`failed`
- `download_record_id`
- `last_seen_at`
- `transferred_at`
- `error_message`

这个表避免同一个固定链接新增文件时被 `DownloadRecord.resource_url` 去重逻辑挡住，也能让订阅页展示“链接内最近发现了什么”。

## 后端流程

### 创建来源

在电视剧详情页现有“导入 115 分享”弹窗中增加选项：

- `立即转存`
- `作为固定追新来源`
- `立即转存并作为固定追新来源`

创建固定来源时，后端会：

1. 校验分享链接能解析出 115 分享码。
2. 保存 `share_url` 和 `receive_code`。
3. 关联到当前电视剧订阅；如果该剧尚未订阅，可按现有订阅创建流程先创建订阅。
4. 可选触发一次立即扫描。

### 定时扫描

订阅任务处理电视剧时，保持现有自动搜索管道不变，然后额外处理启用的固定来源。

固定来源扫描步骤：

1. 根据订阅设置计算缺集状态，沿用 `tv_missing_service`：
   - `tv_scope`
   - `tv_season_number`
   - `tv_episode_start`
   - `tv_episode_end`
   - `tv_follow_mode`
   - `tv_include_specials`
2. 调用 `Pan115Service.get_share_all_files_recursive` 读取固定分享链接内所有文件。
3. 只保留视频文件，使用现有 `name_parser.parse_episode` 解析季/集。
4. 与缺集集合匹配。
5. 每集有多个候选文件时，沿用已有 `pick_best_video_file` 和画质偏好。
6. 调用 `save_share_files_directly` 精准转存选中文件。
7. 写入或更新 `subscription_source_files`，并关联必要的 `DownloadRecord`。
8. 更新来源的 `last_scanned_at`、`last_scan_status`、`last_transferred_count` 和 `last_error`。

如果固定来源没有匹配到缺集，不视为任务失败；状态为 `success`，转存数为 0。只有链接失效、提取码错误、115 Cookie 无效、接口风控等才记录为 `failed` 或 `warning`。

## 前端体验

### 详情页

电视剧详情页的“导入 115 分享”弹窗扩展为：

- 分享链接
- 提取码
- 目标文件夹名称
- 操作模式：立即转存 / 固定追新 / 两者都做

默认保持现有“立即转存”行为，避免改变老用户习惯。

### 订阅页

订阅卡片或订阅设置内新增“固定来源”区域：

- 来源类型：手动 115 分享
- 来源名称
- 脱敏链接，可复制完整链接
- 启用状态
- 最近扫描时间
- 最近转存数量
- 最近错误
- 操作：立即扫描、启用/停用、删除来源

没有固定来源的旧订阅不显示额外干扰信息。

## 错误处理

- 115 Cookie 无效：停留在当前页面，提示更新 115 Cookie，不跳应用登录页。
- 分享链接失效或提取码错误：来源标记 `failed`，保留订阅，等待用户更新或删除来源。
- 115 风控/限流：来源标记 `warning`，按现有任务周期下次重试。
- TMDB/媒体库缺集状态不可用：不执行精准转存，记录警告，避免误转整包。
- 固定来源未更新：状态为成功但转存 0；如果现有自动搜索也启用，自动搜索仍可兜底。

## 迁移与兼容

- 新表通过当前项目的启动时表结构保障机制创建。
- 现有订阅不自动创建固定来源。
- 现有 `DownloadRecord` 去重逻辑不改变。
- 固定来源扫描不依赖 HDHive 配置。
- HDHive 官方 OpenAPI 后续可单独添加 adapter，不影响本设计的数据模型。

## 测试

后端测试：

- 手动 115 来源创建时保存分享链接和提取码。
- 同一个分享链接第一次扫描无缺集时不创建重复转存记录。
- 同一个分享链接第二次新增文件时能识别新集并转存。
- `missing` 和 `new` 两种追踪模式分别按订阅范围匹配集数。
- 链接失效、提取码错误、115 Cookie 无效时更新来源状态，不删除订阅。

前端测试：

- 导入弹窗默认仍是立即转存。
- 选择固定追新后调用创建固定来源 API。
- 订阅页展示来源链接、扫描状态和操作按钮。
- `/pan115/*` 资源凭证类 401 不触发应用登录跳转。

手动验证：

1. 创建一个电视剧订阅。
2. 手动导入一个 115 分享链接作为固定来源。
3. 执行一次订阅扫描，确认只转存缺失集。
4. 模拟链接内新增一集，再执行扫描，确认同一 URL 仍会被重新扫描并只转存新集。
