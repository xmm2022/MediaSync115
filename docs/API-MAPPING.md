# MediaSync115 API 映射文档

> 生成日期: 2026-06-26 | 只读侦察，勿修改源码

---

## 一、后端真实 API 清单

### 1.1 Router 挂载总览 (main.py)

| Router | 前缀 | 来源文件 | 需要认证 |
|--------|------|----------|----------|
| search | `/api/search` | `backend/app/api/search.py` | 是 |
| archive | `/api/archive` | `backend/app/api/archive.py` | 是 |
| auth | `/api/auth` | `backend/app/api/auth.py` | 白名单豁免 |
| subscriptions | `/api/subscriptions` | `backend/app/api/subscriptions.py` | 是 |
| watchlists | `/api/watchlists` | `backend/app/api/watchlists.py` | 是 |
| person_follows (详情) | `/api/persons` | `backend/app/api/person_follows.py` | 是 |
| person_follows (CRUD) | `/api/person-follows` | `backend/app/api/person_follows.py` | 是 |
| pan115 | `/api/pan115` | `backend/app/api/pan115.py` | 是 |
| quark | `/api/quark` | `backend/app/api/quark.py` | 是 |
| pansou | `/api/pansou` | `backend/app/api/pansou.py` | 是 |
| settings | `/api/settings` | `backend/app/api/settings.py` | 是 |
| strm | `/api/strm` | `backend/app/api/strm.py` | 是(play/免) |
| scheduler | `/api/scheduler` | `backend/app/api/scheduler.py` | 是 |
| workflow | `/api/workflow` | `backend/app/api/workflow.py` | 是 |
| logs | `/api/logs` | `backend/app/api/logs.py` | 是 |
| license | `/api/license` | `backend/app/api/license.py` | 是 |
| root (健康) | `/` `/health` | `backend/main.py` | 否 |

**认证中间件白名单** (`UNAUTHENTICATED_API_PATHS`): `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`
**认证前缀豁免** (`UNAUTHENTICATED_API_PREFIXES`): `/api/strm/play/`

---

### 1.2 端点逐表

#### 1.2.1 auth — `/api/auth`

| 方法 | 路径 | 认证 | 请求体 Schema / 字段 | 响应 |
|------|------|------|----------------------|------|
| GET | /api/auth/session | 否 | 无 (Session cookie) | `{authenticated: bool, username: str, expires_at: str}` |
| POST | /api/auth/login | 否 | `LoginRequest{username: str, password: str}` | `{success: bool, username: str}` + Set-Cookie |
| POST | /api/auth/logout | 否 | 无 | `{success: bool}` + Delete-Cookie |
| POST | /api/auth/change-credentials | 是 | `ChangeCredentialsRequest{current_password: str, username?: str, new_password?: str}` | `{success: bool, username: str}` + Set-Cookie |

#### 1.2.2 search — `/api/search`

| 方法 | 路径 | 认证 | 请求体/参数 | 响应关键字段 |
|------|------|------|-------------|-------------|
| GET | /api/search | 是 | `query: str`, `page: int=1` | TMDB multi-search 结果 + `emby_status_map`, `feiniu_status_map` |
| GET | /api/search/explore/meta | 是 | `source: douban\|tmdb` | `{source, fetched_at, sections[{key,title,tag}]}` |
| GET | /api/search/explore/home | 是 | `source, refresh` | `{source, sections[{key,title,items[]}], emby_status_map, feiniu_status_map}` |
| GET | /api/search/explore/sections | 是 | `source, limit, refresh` | 同上, sections 带 items |
| GET | /api/search/explore/section/{key} | 是 | `source, limit, start, refresh` | 单个 section 详情 + emby/feiniu status |
| GET | /api/search/explore/douban-sections | 是 | `limit, refresh` | 豆瓣榜单 sections |
| GET | /api/search/explore/douban-section/{key} | 是 | `limit, start, refresh` | 单个豆瓣 section |
| GET | /api/search/explore/popular | 是 | `limit, refresh` | Popular movies (stevenlu) |
| GET | /api/search/explore/popular-sections | 是 | `limit, refresh` | All popular sections |
| GET | /api/search/explore/poster | 是 | `url, size` | 图片代理 (doubanio/tmdb) |
| POST | /api/search/emby/status-map | 是 | `EmbyStatusMapRequest{items[{media_type, tmdb_id}]}` | `{items: {key: {exists_in_emby, status, matched_type}}}` |
| POST | /api/search/feiniu/status-map | 是 | `FeiniuStatusMapRequest{items[{media_type, tmdb_id}]}` | `{items: {key: {exists_in_feiniu, status}}}` |
| POST | /api/search/explore/resolve | 是 | `dict{source, media_type, tmdb_id?, douban_id?, title, ...}` | `{resolved, media_type, tmdb_id, confidence, reason, candidates}` |
| POST | /api/search/explore/queue/subscribe | 是 | `ExploreQueueSubscribeRequest{source, douban_id?, title, media_type, tmdb_id?, ...}` | `{task_id, status, ...}` |
| POST | /api/search/explore/queue/save | 是 | `ExploreQueueBaseRequest{source, douban_id?, title, media_type, ...}` | `{task_id, status, ...}` |
| GET | /api/search/explore/queue/tasks/{task_id} | 是 | — | 队列任务状态 |
| GET | /api/search/explore/queue/active | 是 | `queue_type: all\|subscribe\|save` | 活跃任务列表 |
| GET | /api/search/douban/subject/{douban_id} | 是 | `media_type: movie\|tv` | 豆瓣条目详情 |
| GET | /api/search/collection/{collection_id} | 是 | — | TMDB 合集详情 |
| GET | /api/search/movie/{tmdb_id} | 是 | — | TMDB 电影详情 |
| GET | /api/search/tv/{tmdb_id} | 是 | — | TMDB 剧集详情 |
| GET | /api/search/tv/{tmdb_id}/season/{sn} | 是 | — | TMDB 季详情 |
| GET | /api/search/tv/{tmdb_id}/season/{sn}/episode/{en} | 是 | — | TMDB 集详情 |
| GET | /api/search/movie/{tmdb_id}/115 | 是 | `page, refresh` | 115 pansou 资源 |
| GET | /api/search/movie/{tmdb_id}/115/pansou | 是 | `page, refresh` | 同上(显式) |
| GET | /api/search/movie/{tmdb_id}/115/hdhive | 是 | `page, refresh` | HDHive 115 资源 |
| GET | /api/search/movie/{tmdb_id}/115/tg | 是 | `page, refresh` | TG 115 资源 |
| GET | /api/search/movie/{tmdb_id}/quark/pansou | 是 | `page, refresh` | 夸克 pansou 资源 |
| GET | /api/search/movie/{tmdb_id}/quark/hdhive | 是 | `page, refresh` | HDHive 夸克资源 |
| GET | /api/search/movie/{tmdb_id}/quark/tg | 是 | `page, refresh` | TG 夸克资源(暂空) |
| GET | /api/search/tv/{tmdb_id}/115 | 是 | `page, refresh, season` | TV 115 pansou |
| GET | /api/search/tv/{tmdb_id}/115/pansou | 是 | `page, refresh, season` | TV 115 pansou(显式) |
| GET | /api/search/tv/{tmdb_id}/115/hdhive | 是 | `page, refresh, season` | TV HDHive 115 |
| GET | /api/search/tv/{tmdb_id}/115/tg | 是 | `page, refresh, season` | TV TG 115 |
| GET | /api/search/tv/{tmdb_id}/quark/pansou | 是 | `page, refresh, season` | TV 夸克 pansou |
| GET | /api/search/tv/{tmdb_id}/quark/hdhive | 是 | `page, refresh, season` | TV HDHive 夸克 |
| GET | /api/search/tv/{tmdb_id}/quark/tg | 是 | `page, refresh, season` | TV TG 夸克(暂空) |
| GET | /api/search/{media_type}/{tmdb_id}/resources | 是 | `refresh, season` | 统一资源获取(全来源管道) |
| GET | /api/search/movie/{tmdb_id}/magnet | 是 | `limit` | SeedHub 磁力 |
| GET | /api/search/movie/{tmdb_id}/magnet/seedhub | 是 | `limit` | SeedHub 磁力(显式) |
| GET | /api/search/movie/{tmdb_id}/magnet/butailing | 是 | — | 不肽灵磁力 |
| GET | /api/search/tv/{tmdb_id}/magnet | 是 | `season, episode, limit` | TV SeedHub 磁力 |
| GET | /api/search/tv/{tmdb_id}/magnet/seedhub | 是 | `season, limit` | TV SeedHub(显式) |
| GET | /api/search/tv/{tmdb_id}/magnet/butailing | 是 | `season` | TV 不肽灵磁力 |
| POST | /api/search/movie/{tmdb_id}/magnet/seedhub/tasks | 是 | `limit, force_refresh` | 创建 SeedHub 异步任务 |
| POST | /api/search/tv/{tmdb_id}/magnet/seedhub/tasks | 是 | `limit, force_refresh` | 创建 SeedHub TV 异步任务 |
| GET | /api/search/magnet/seedhub/tasks/{task_id} | 是 | — | SeedHub 任务状态 |
| DELETE | /api/search/magnet/seedhub/tasks/{task_id} | 是 | — | 取消 SeedHub 任务 |
| GET | /api/search/hdhive/115/by-keyword | 是 | `keyword, media_type` | HDHive 关键词搜索 |
| GET | /api/search/tg/115/by-keyword | 是 | `keyword, media_type` | TG 关键词搜索 |
| GET | /api/search/seedhub/{media_type}/magnet/by-keyword | 是 | `keyword, limit` | SeedHub 关键词搜索 |
| POST | /api/search/hdhive/resource/unlock | 是 | `HDHiveUnlockRequest{slug: str}` | 解锁 HDHive 资源 |
| GET | /api/search/bridge/imdb/{imdb_id} | 是 | `media_type` | IMDB→TMDB+豆瓣桥接 |

#### 1.2.3 subscriptions — `/api/subscriptions`

| 方法 | 路径 | Schema | 说明 |
|------|------|--------|------|
| GET | /api/subscriptions | `?is_active, media_type` | 订阅列表(含 sources) |
| POST | /api/subscriptions | `SubscriptionCreate{douban_id?, tmdb_id?, title, media_type, poster_path?, ...tv_scope...}` | 创建订阅 |
| GET | /api/subscriptions/status-map | `?is_active=true, media_type` | 订阅状态映射(douban_id→sub, imdb_id→sub) |
| GET | /api/subscriptions/{id} | — | 单订阅详情(含 sources) |
| PUT | /api/subscriptions/{id} | `SubscriptionUpdate{title?, is_active?, tv_scope?, ...}` | 更新订阅 |
| DELETE | /api/subscriptions/{id} | — | 删除订阅+关联下载记录 |
| DELETE | /api/subscriptions/batch/{media_type} | — | 按类型批量删除(movie/tv) |
| POST | /api/subscriptions/toggle | `SubscriptionToggleRequest{douban_id?, tmdb_id?, title, media_type, ...}` | 切换订阅(有则删无则建) |
| POST | /api/subscriptions/cleanup | — | 批量清理已完成订阅 |
| POST | /api/subscriptions/{id}/cleanup | — | 单订阅清理检查 |
| GET | /api/subscriptions/missing-status/tv | `?only_missing, limit, refresh` | TV 缺集状态列表 |
| GET | /api/subscriptions/{id}/tv/missing-status | `?refresh` | 单 TV 订阅缺集详情 |
| GET | /api/subscriptions/{id}/sources | — | 订阅来源列表 |
| POST | /api/subscriptions/{id}/sources | `SubscriptionSourceCreate{share_url, receive_code?, display_name?}` | 添加手动来源 |
| PATCH | /api/subscriptions/{id}/sources/{sid} | `SubscriptionSourceUpdate{enabled?, display_name?}` | 更新来源 |
| DELETE | /api/subscriptions/{id}/sources/{sid} | — | 删除来源 |
| POST | /api/subscriptions/{id}/sources/{sid}/scan | — | 手动扫描来源(含转存) |
| GET | /api/subscriptions/{id}/downloads | `?status` | 下载记录列表 |
| POST | /api/subscriptions/{id}/downloads | `DownloadRecordCreate{resource_name, resource_url, resource_type, file_id?}` | 创建下载记录 |
| GET | /api/subscriptions/{id}/downloads/{rid} | — | 单下载记录 |
| PUT | /api/subscriptions/{id}/downloads/{rid} | `DownloadRecordUpdate{status?, error_message?, offline_info_hash?, ...}` | 更新下载记录 |
| DELETE | /api/subscriptions/{id}/downloads/{rid} | — | 删除下载记录 |
| POST | /api/subscriptions/{id}/downloads/{rid}/complete | — | 标记完成+自动清理 |
| POST | /api/subscriptions/{id}/downloads/{rid}/fail | `?error_message` | 标记失败 |
| POST | /api/subscriptions/system/run | `SubscriptionRunRequest{channel, force_auto_download}` | 同步触发订阅检查 |
| POST | /api/subscriptions/system/run/background | 同上 | 后台启动订阅检查 |
| GET | /api/subscriptions/system/run/tasks/{task_id} | — | 后台任务状态 |
| GET | /api/subscriptions/system/logs | `?channel, status, limit` | 执行日志 |
| GET | /api/subscriptions/system/logs/steps | `?channel, run_id, subscription_id, limit` | 步骤日志 |
| (兼容) POST | /api/subscriptions/actions/run | 同上 `/system/run` | 旧路由别名 |
| (兼容) POST | /api/subscriptions/actions/run/background | 同上 | 旧路由别名 |
| (兼容) GET | /api/subscriptions/actions/run/tasks/{id} | 同上 | 旧路由别名 |
| (兼容) GET | /api/subscriptions/actions/logs | 同上 | 旧路由别名 |
| (兼容) GET | /api/subscriptions/actions/logs/steps | 同上 | 旧路由别名 |

#### 1.2.4 settings — `/api/settings`

| 方法 | 路径 | Schema | 说明 |
|------|------|--------|------|
| GET | /api/settings/runtime | — | 全部运行时设置 |
| PUT | /api/settings/runtime | `RuntimeSettingsRequest{...90+ 可选字段}` | 更新设置(含调度同步) |
| GET | /api/settings/app-info | — | 应用版本+更新源信息 |
| GET | /api/settings/update-check | — | DockerHub 更新检查 |
| GET | /api/settings/hdhive/check | — | HDHive 连接检查(缓存5min) |
| POST | /api/settings/hdhive/login | `HDHiveLoginRequest{username, password, base_url?}` | HDHive 登录存Cookie |
| POST | /api/settings/hdhive/checkin | `HDHiveCheckinRequest{mode?, method?, cookie?, base_url?}` | 手动签到 |
| GET | /api/settings/tg/check | — | TG 凭证检查 |
| GET | /api/settings/tmdb/check | — | TMDB API 配置检查 |
| GET | /api/settings/pansou/check | — | Pansou 可用性检查 |
| GET | /api/settings/emby/check | `?emby_url, emby_api_key` | Emby 连接检查 |
| GET | /api/settings/feiniu/check | `?feiniu_url, feiniu_secret, feiniu_api_key` | 飞牛连接检查 |
| POST | /api/settings/feiniu/login | `FeiniuLoginRequest{username, password, url?}` | 飞牛登录存token |
| GET | /api/settings/emby/sync/status | — | Emby 同步索引状态 |
| POST | /api/settings/emby/sync/run | — | 手动触发 Emby 同步 |
| GET | /api/settings/feiniu/sync/status | — | 飞牛同步索引状态 |
| POST | /api/settings/feiniu/sync/run | — | 手动触发飞牛同步 |
| GET | /api/settings/proxy | — | 代理配置 |
| GET | /api/settings/health/all | — | 全部外部服务健康检查 |
| POST | /api/settings/tg/login/verify-password | `TgVerifyPasswordRequest{password, session}` | TG 密码验证 |
| POST | /api/settings/tg/login/qr/start | — | TG 扫码登录启动 |
| POST | /api/settings/tg/login/qr/status | `TgQrStatusRequest{token}` | TG 扫码状态 |
| POST | /api/settings/tg/logout | — | TG 登出 |
| GET | /api/settings/tg/index/status | — | TG 索引状态 |
| POST | /api/settings/tg/index/status/refresh | — | 刷新 TG 索引状态 |
| POST | /api/settings/tg/index/backfill/start | `TgIndexBackfillRequest{rebuild?}` | 启动 TG 回填 |
| POST | /api/settings/tg/index/incremental/run | — | 增量同步一次 |
| POST | /api/settings/tg/index/stop | `TgIndexStopRequest{job_type}` | 停止 TG 索引任务 |
| GET | /api/settings/tg/index/jobs/{job_id} | — | TG 索引 job 状态 |
| POST | /api/settings/tg/index/rebuild | — | 重建 TG 索引 |
| GET | /api/settings/tg-bot/status | — | TG Bot 状态 |
| POST | /api/settings/tg-bot/restart | — | 后台重启 Bot |
| POST | /api/settings/tg-bot/stop | — | 停止 Bot |
| GET | /api/settings/chart-subscription/charts | — | 可用榜单订阅源 |
| POST | /api/settings/chart-subscription/run | — | 手动执行榜单订阅 |
| POST | /api/settings/person-follow/run | — | 手动执行演职员关注同步 |

#### 1.2.5 pan115 — `/api/pan115`

| 方法 | 路径 | Schema | 说明 |
|------|------|--------|------|
| GET | /api/pan115/cookie | — | Cookie 脱敏信息 |
| GET | /api/pan115/cookie/check | — | Cookie 有效性检查 |
| POST | /api/pan115/cookie/update | `UpdateCookieRequest{cookie}` | 更新 Cookie |
| GET | /api/pan115/login/qr/apps | — | 扫码应用列表 |
| POST | /api/pan115/login/qr/start | `Pan115QrStartRequest{app?}` | 启动扫码 |
| GET | /api/pan115/login/qr/image | `?token` | 二维码图片 PNG |
| POST | /api/pan115/login/qr/status | `Pan115QrStatusRequest{token}` | 扫码状态 |
| POST | /api/pan115/login/qr/cancel | `Pan115QrCancelRequest{token}` | 取消扫码 |
| GET | /api/pan115/user | — | 用户信息 |
| GET | /api/pan115/offline/quota | — | 离线配额 |
| GET | /api/pan115/health/risk | — | 115 风控健康检查 |
| GET | /api/pan115/files | `?cid, offset, limit` | 文件列表 |
| POST | /api/pan115/folder | `CreateFolderRequest{pid, name}` | 创建文件夹 |
| POST | /api/pan115/rename | `RenameFileRequest{fid, name}` | 重命名 |
| DELETE | /api/pan115/files | `?fid` | 删除文件 |
| POST | /api/pan115/copy | `?fid, pid` | 复制 |
| POST | /api/pan115/move | `?fid, pid` | 移动 |
| GET | /api/pan115/files/{fid} | — | 文件信息 |
| GET | /api/pan115/search | `?search_value, cid` | 搜索文件 |
| GET | /api/pan115/download/{pick_code} | — | 下载链接 |
| POST | /api/pan115/offline/task | `OfflineTaskCreate{url, wp_path_id?, title?}` | 添加离线任务 |
| GET | /api/pan115/offline/tasks | `?page` | 离线任务列表 |
| DELETE | /api/pan115/offline/tasks | `?hash_list` | 删除离线任务 |
| POST | /api/pan115/offline/restart | `?info_hash` | 重试离线任务 |
| POST | /api/pan115/offline/clear | `?mode` (completed/failed/all) | 清空离线任务 |
| GET | /api/pan115/offline/default-folder | — | 离线默认文件夹 |
| POST | /api/pan115/offline/default-folder | `DefaultFolderRequest{folder_id, folder_name?}` | 设置离线默认文件夹 |
| POST | /api/pan115/share/parse | `?share_url` | 解析分享链接 |
| GET | /api/pan115/share/files | `?share_code, receive_code, cid, offset, limit` | 分享文件列表 |
| POST | /api/pan115/share/save | `SaveShareRequest{share_code, file_id, pid, receive_code}` | 转存单文件 |
| POST | /api/pan115/share/save-batch | `SaveShareFilesRequest{share_code, file_ids[], pid, receive_code}` | 批量转存 |
| POST | /api/pan115/share/save-all | `?share_code, pid, receive_code` | 全量转存 |
| POST | /api/pan115/share/save-to-folder | `SaveShareToFolderRequest{share_url, folder_name, parent_id, receive_code, tmdb_id?}` | 一键转存到文件夹 |
| POST | /api/pan115/share/extract-files | `ShareExtractFilesRequest{share_url, receive_code}` | 提取分享文件列表 |
| POST | /api/pan115/share/save-files-to-folder | `SaveShareFilesToFolderRequest{share_url, file_ids[], folder_name, parent_id, receive_code}` | 选集转存 |
| GET | /api/pan115/default-folder | — | 默认转存文件夹 |
| POST | /api/pan115/default-folder | `DefaultFolderRequest{folder_id, folder_name?}` | 设置默认转存文件夹 |

#### 1.2.6 archive — `/api/archive`

| 方法 | 路径 | Schema | 说明 |
|------|------|--------|------|
| GET | /api/archive/subdir-options | — | 二级目录配置选项 |
| GET | /api/archive/naming-options | — | 命名格式模板选项 |
| GET | /api/archive/config | — | 归档配置+运行状态 |
| PUT | /api/archive/config | `ArchiveConfigRequest{archive_enabled?, archive_watch_cid?, archive_output_cid?, archive_interval_minutes?, ...}` | 更新归档配置 |
| GET | /api/archive/folders | `?cid` | 115 目录浏览(文件夹) |
| GET | /api/archive/tasks | `?status, limit, offset` | 归档任务列表 |
| POST | /api/archive/scan | — | 手动触发归档扫描 |
| POST | /api/archive/tasks/{task_id}/retry | — | 重试归档任务 |
| DELETE | /api/archive/tasks/clear | `?include_failed` | 清除归档任务 |

#### 1.2.7 strm — `/api/strm`

| 方法 | 路径 | 认证 | Schema | 说明 |
|------|------|------|--------|------|
| GET | /api/strm/config | 是 | — | STRM 配置+建议 base_url |
| PUT | /api/strm/config | 是 | `StrmConfigRequest{strm_enabled?, strm_output_dir?, strm_base_url?, strm_redirect_mode?, ...}` | 更新配置 |
| POST | /api/strm/generate | 是 | — | 手动生成 STRM |
| GET | /api/strm/diagnose | 是 | — | STRM 诊断 |
| GET\|HEAD | /api/strm/play/{token} | 否 | — | STRM 播放(302/代理) |

#### 1.2.8 logs — `/api/logs`

| 方法 | 路径 | Schema | 说明 |
|------|------|--------|------|
| GET | /api/logs | `?source_type, exclude_source_type, module, status, path, trace_id, date_from, date_to, limit, offset` | 操作日志列表(分页) |
| GET | /api/logs/modules | — | 可选 module/source_type/status 值 |
| POST | /api/logs/prune | `?days=30` | 清理旧日志 |
| DELETE | /api/logs/clear | — | 清空所有日志 |

#### 1.2.9 scheduler — `/api/scheduler`

| 方法 | 路径 | Schema |
|------|------|--------|
| GET | /api/scheduler/job-keys | — |
| GET | /api/scheduler/jobs | — |
| POST | /api/scheduler/run/{job_id} | `?force` |
| GET | /api/scheduler/tasks | — |
| POST | /api/scheduler/tasks | `SchedulerTaskCreate{name, job_key, trigger_type, cron_expr?, interval_seconds?, kwargs?, enabled}` |
| PUT | /api/scheduler/tasks/{task_id} | `SchedulerTaskUpdate{...}` |
| POST | /api/scheduler/tasks/{task_id}/enable | — |
| POST | /api/scheduler/tasks/{task_id}/pause | — |
| DELETE | /api/scheduler/tasks/{task_id} | — |

#### 1.2.10 workflow — `/api/workflow`

| 方法 | 路径 | Schema |
|------|------|--------|
| GET | /api/workflow | — |
| GET | /api/workflow/{id} | — |
| POST | /api/workflow | `WorkflowPayload{name, description?, timer?, trigger_type, event_type?, event_conditions?, actions[], flows[], context?, state}` |
| PUT | /api/workflow/{id} | `WorkflowUpdatePayload{...}` |
| DELETE | /api/workflow/{id} | — |
| POST | /api/workflow/{id}/run | — |
| POST | /api/workflow/{id}/start | — |
| POST | /api/workflow/{id}/pause | — |
| POST | /api/workflow/{id}/reset | — |
| GET | /api/workflow/event-types | — |
| POST | /api/workflow/events/trigger | `EventTriggerPayload{event_type, payload}` |

#### 1.2.11 watchlists — `/api/watchlists`

| 方法 | 路径 | Schema |
|------|------|--------|
| GET | /api/watchlists | — |
| POST | /api/watchlists | `WatchlistCreate{name, description?, auto_fill_enabled}` |
| GET | /api/watchlists/status-map | — |
| GET | /api/watchlists/import/catalog | — |
| GET | /api/watchlists/import/sources | — |
| POST | /api/watchlists/import/preview | `WatchlistImportPreviewRequest{source_key?, reference?, source_type?}` |
| POST | /api/watchlists/import | `WatchlistImportRequest{...watchlist_id?, name?, ...}` |
| GET | /api/watchlists/{id} | — |
| PUT | /api/watchlists/{id} | `WatchlistUpdate{name?, description?, auto_fill_enabled?}` |
| DELETE | /api/watchlists/{id} | — |
| POST | /api/watchlists/{id}/items | `WatchlistItemCreate{tmdb_id, media_type, title, poster_path?, year?, rating?, notes?}` |
| DELETE | /api/watchlists/{id}/items/{item_id} | — |
| POST | /api/watchlists/{id}/fill | — |

#### 1.2.12 person_follows — `/api/person-follows` + `/api/persons`

| 方法 | 路径 | Schema |
|------|------|--------|
| GET | /api/person-follows | — |
| GET | /api/person-follows/status-map | — |
| GET | /api/person-follows/feed | `?limit` |
| POST | /api/person-follows | `PersonFollowCreate{tmdb_person_id, name, profile_path?, known_for_department?, auto_subscribe_new_works}` |
| POST | /api/person-follows/toggle | `PersonFollowToggleRequest{tmdb_person_id, name?, profile_path?, ...}` |
| PUT | /api/person-follows/{follow_id} | `PersonFollowUpdate{auto_subscribe_new_works?}` |
| DELETE | /api/person-follows/{follow_id} | — |
| POST | /api/person-follows/sync | — |
| GET | /api/persons/{person_id} | TMDB 影人详情+作品列表 |

#### 1.2.13 pansou — `/api/pansou`

| 方法 | 路径 | Schema |
|------|------|--------|
| GET | /api/pansou/health | `?base_url` |
| GET | /api/pansou/config | — |
| PUT | /api/pansou/config | `PansouConfigRequest{base_url}` |
| POST | /api/pansou/search | `SearchRequest{keyword, cloud_types, res, refresh}` |
| GET | /api/pansou/search | `?keyword, cloud_types, res, refresh` |

#### 1.2.14 quark — `/api/quark`

| 方法 | 路径 | Schema |
|------|------|--------|
| GET | /api/quark/cookie | — |
| POST | /api/quark/cookie/update | `QuarkCookieUpdateRequest{cookie}` |
| GET | /api/quark/cookie/check | — |
| GET | /api/quark/connectivity/check | — |
| GET | /api/quark/folders | `?parent_fid, page, size` |
| GET | /api/quark/default-folder | — |
| POST | /api/quark/default-folder | `QuarkDefaultFolderRequest{folder_id, folder_name}` |
| POST | /api/quark/share/save-to-folder | `QuarkSaveShareRequest{share_url, folder_name?, target_folder_id?, receive_code?, tmdb_id?}` |

#### 1.2.15 license — `/api/license`

| 方法 | 路径 | Schema |
|------|------|--------|
| GET | /api/license/status | — |
| PUT | /api/license/activate | `LicenseKeyRequest{license_key?}` |
| POST | /api/license/check-feature | `?feature` |

#### 1.2.16 根路由 (main.py 直接定义)

| 方法 | 路径 | 认证 |
|------|------|------|
| GET | / | 否 |
| GET | /health | 否 |

---

### 1.3 核心 SQLAlchemy 模型字段 (与 API 响应映射相关)

**Subscription** (`subscriptions` 表):
`id, douban_id, tmdb_id, imdb_id, title, media_type(enum: movie/tv/collection), poster_path, overview, year, rating, tv_scope(all/season/episode_range), tv_season_number, tv_episode_start, tv_episode_end, tv_follow_mode(missing/new), tv_include_specials, is_active, auto_download, created_at, updated_at`

**DownloadRecord** (`download_records` 表):
`id, subscription_id, resource_name, resource_url, resource_type, file_id, offline_info_hash, offline_task_id, offline_status, offline_submitted_at, offline_completed_at, status(enum: pending/matched/downloading/transferring/offline_submitted/offline_completed/archiving/completed/failed), error_message, created_at, completed_at`

**SubscriptionSource** (`subscription_sources` 表):
`id, subscription_id, source_type, display_name, share_url, receive_code, enabled, last_scanned_at, last_scan_status, last_error, last_found_episode, last_transferred_count, created_at, updated_at`

**SubscriptionExecutionLog**: `id, channel, status(enum), message, checked_count, new_resource_count, failed_count, details(JSON), started_at, finished_at`

**SubscriptionStepLog**: `id, run_id, channel, subscription_id, subscription_title, step, status, message, payload(JSON), created_at`

**OperationLog**: `id, trace_id, source_type, module, action, status, http_method, path, status_code, duration_ms, message, request_summary(JSON), response_summary(JSON), extra(JSON), created_at`

---

## 二、旧 Vue 前端 API 封装

### 2.1 认证机制

- **Axios 实例**: `baseURL: '/api'`, `timeout: 30000`
- **请求拦截器**: 自动添加 `X-Client-Timezone` header (值: `Asia/Shanghai`)
- **认证方式**: Cookie-based session (httponly cookie `SESSION_COOKIE_NAME`)，前端无需手动带 token
- **401 处理** (`authErrorPolicy.js`):
  - `/pan115/` 前缀的 401 不重定向(资源凭证问题，非用户会话)
  - `/auth/login`, `/auth/logout`, `/auth/session` 的 401 不重定向
  - 其他 401 → SPA router 跳转到 `/login`
- **错误通知**: `ElMessage.error(detail)` 弹出 Element Plus 错误提示
- **静默错误**: 请求可传 `config.silentError = true` 跳过 toast
- **后端不可用**: `code === 'backend_unavailable'` → 特殊提示，轮询 `/healthz`

### 2.2 函数清单与后端端点对应

#### searchApi (48 函数)
| 函数 | 方法+路径 |
|------|----------|
| `search(query, page)` | GET /api/search |
| `getExploreMeta(source)` | GET /api/search/explore/meta |
| `getExploreSections(source, limit, refresh)` | GET /api/search/explore/sections |
| `getExploreSection(source, sectionKey, limit, refresh, start)` | GET /api/search/explore/section/{sectionKey} |
| `getEmbyStatusMap(items)` | POST /api/search/emby/status-map |
| `getFeiniuStatusMap(items)` | POST /api/search/feiniu/status-map |
| `resolveExploreItem(payload)` | POST /api/search/explore/resolve |
| `enqueueExploreSubscribeTask(payload)` | POST /api/search/explore/queue/subscribe |
| `enqueueExploreSaveTask(payload)` | POST /api/search/explore/queue/save |
| `getExploreQueueTask(taskId)` | GET /api/search/explore/queue/tasks/{taskId} |
| `getExploreActiveQueueTasks(queueType)` | GET /api/search/explore/queue/active |
| `getDoubanSubject(doubanId, mediaType)` | GET /api/search/douban/subject/{doubanId} |
| `getExploreDoubanSections(limit, refresh)` | GET /api/search/explore/douban-sections |
| `getExploreDoubanSection(sectionKey, ...)` | GET /api/search/explore/douban-section/{sectionKey} |
| `getExplorePopularMovies(limit, refresh)` | GET /api/search/explore/popular |
| `getExplorePopularSections(limit, refresh)` | GET /api/search/explore/popular-sections |
| `getMovie(tmdbId)` | GET /api/search/movie/{tmdbId} |
| `getMoviePan115(tmdbId, page, refresh)` | GET /api/search/movie/{tmdbId}/115 |
| `getMoviePan115Pansou(tmdbId, ...)` | GET /api/search/movie/{tmdbId}/115/pansou |
| `getMoviePan115Hdhive(tmdbId, ...)` | GET /api/search/movie/{tmdbId}/115/hdhive |
| `getMoviePan115Tg(tmdbId, ...)` | GET /api/search/movie/{tmdbId}/115/tg |
| `getHdhivePan115ByKeyword(...)` | GET /api/search/hdhive/115/by-keyword |
| `getTgPan115ByKeyword(...)` | GET /api/search/tg/115/by-keyword |
| `getSeedhubMagnetByKeyword(...)` | GET /api/search/seedhub/{media_type}/magnet/by-keyword |
| `unlockHdhiveResource(slug)` | POST /api/search/hdhive/resource/unlock |
| `getMovieMagnet(tmdbId)` | GET /api/search/movie/{tmdbId}/magnet |
| `getMovieMagnetSeedhub(tmdbId, limit)` | GET /api/search/movie/{tmdbId}/magnet/seedhub |
| `getMovieMagnetButailing(tmdbId)` | GET /api/search/movie/{tmdbId}/magnet/butailing |
| `createMovieSeedhubMagnetTask(...)` | POST /api/search/movie/{tmdbId}/magnet/seedhub/tasks |
| `getTv(tmdbId)` | GET /api/search/tv/{tmdbId} |
| `getTvPan115(tmdbId, page, refresh, season)` | GET /api/search/tv/{tmdbId}/115 |
| `getTvPan115Pansou(...)` | GET /api/search/tv/{tmdbId}/115/pansou |
| `getTvPan115Hdhive(...)` | GET /api/search/tv/{tmdbId}/115/hdhive |
| `getTvPan115Tg(...)` | GET /api/search/tv/{tmdbId}/115/tg |
| `getMovieQuarkPansou(...)` | GET /api/search/movie/{tmdbId}/quark/pansou |
| `getMovieQuarkHdhive(...)` | GET /api/search/movie/{tmdbId}/quark/hdhive |
| `getMovieQuarkTg(...)` | GET /api/search/movie/{tmdbId}/quark/tg |
| `getTvQuarkPansou(...)` | GET /api/search/tv/{tmdbId}/quark/pansou |
| `getTvQuarkHdhive(...)` | GET /api/search/tv/{tmdbId}/quark/hdhive |
| `getTvQuarkTg(...)` | GET /api/search/tv/{tmdbId}/quark/tg |
| `getMediaResources(tmdbId, mediaType, season, refresh)` | GET /api/search/{media_type}/{tmdb_id}/resources |
| `getTvSeason(tmdbId, seasonNumber)` | GET /api/search/tv/{tmdbId}/season/{sn} |
| `getTvEpisode(tmdbId, sn, en)` | GET /api/search/tv/{tmdbId}/season/{sn}/episode/{en} |
| `getTvMagnet(tmdbId, season, episode)` | GET /api/search/tv/{tmdbId}/magnet |
| `getTvMagnetSeedhub(tmdbId, season, limit)` | GET /api/search/tv/{tmdbId}/magnet/seedhub |
| `getTvMagnetButailing(tmdbId, season)` | GET /api/search/tv/{tmdbId}/magnet/butailing |
| `createTvSeedhubMagnetTask(...)` | POST /api/search/tv/{tmdbId}/magnet/seedhub/tasks |
| `getSeedhubMagnetTask(taskId)` | GET /api/search/magnet/seedhub/tasks/{taskId} |
| `cancelSeedhubMagnetTask(taskId)` | DELETE /api/search/magnet/seedhub/tasks/{taskId} |
| `getBridgeByImdbId(imdbId, mediaType)` | GET /api/search/bridge/imdb/{imdbId} |
| `getCollection(collectionId)` | GET /api/search/collection/{collectionId} |
| `getPerson(personId)` | GET /api/persons/{personId} |

#### 其他模块函数 (摘要)
- **authApi** (3): `getSession`, `login`, `logout`, `changeCredentials`
- **watchlistApi** (11): CRUD + items + fill + import/preview/catalog/sources
- **personFollowApi** (7): CRUD + statusMap + feed + toggle + sync
- **settingsApi** (35): runtime get/put, health checks (hdhive/tg/tmdb/pansou/emby/feiniu), sync status/run, TG login/qr/bot/index, chart/person-follow
- **licenseApi** (3): status, activate, checkFeature
- **logsApi** (4): list, modules, prune, clear
- **archiveApi** (9): subdir/naming options, config get/put, folders, tasks list/retry/clear, scan
- **strmApi** (4): config get/put, generate, diagnose
- **subscriptionApi** (27): CRUD + toggle + batch delete + sources CRUD + scan + downloads CRUD + run channel + logs
- **schedulerApi** (9): jobKeys, jobs, runJob, tasks CRUD + enable/pause
- **workflowApi** (11): CRUD + run/start/pause/reset + eventTypes + triggerEvent
- **pan115Api** (31): cookie(3) + qr login(4) + user/quota/health + files(8) + offline(7) + share(10) + defaultFolder(2)
- **quarkApi** (8): cookie(3) + connectivity + folders + defaultFolder(2) + saveShareToFolder
- **pansouApi** (4): health, search, config get/put

**旧前端 API 函数总数: 214**

---

## 三、新前端 Mock 端点 → 真实后端端点映射

| 新前端 Mock 端点 | 对应真实后端 | 说明 |
|------------------|-------------|------|
| `GET /api/config` | `GET /api/settings/runtime` | 新前端"config"概念对应后端的 runtime settings。需做字段映射：`cookie115` → `pan115_cookie`(脱敏), `localMountPath` → `archive_watch_cid`/`strm_output_dir`, `embyUrl/embyKey` → `emby_url/emby_api_key`, `plexUrl/plexToken` → 后端无 Plex 支持, `maxThreads` → 后端无此字段, `refreshInterval` → `subscription_interval_hours` |
| `POST /api/config` | `PUT /api/settings/runtime` | 同上，字段需转译。新前端传 `{cookie115, localMountPath, embyUrl, embyKey, plexUrl, plexToken, maxThreads, refreshInterval}`，需按 RuntimeSettingsRequest 字段映射后 PUT |
| `GET /api/directories` | **无直接对应** | 新前端 "directories" 概念(SyncDirectory)是虚构的 mock 概念。接近的功能是 `GET /api/archive/folders` (115 目录浏览) 或 `GET /api/archive/config` (归档监听/输出目录配置)。建议：用 `/api/archive/config` 的 `archive_watch_cid/archive_output_cid` + `/api/archive/folders?cid=` 组合数据构建目录列表。`targetClient`(emby/plex/jellyfin) 字段在后端无对应 — 后端只有 Emby 和飞牛 |
| `POST /api/directories` | **无直接对应** | 新前端概念。可映射到 `PUT /api/archive/config` (设置监听/输出目录) + `PUT /api/settings/runtime` (Emby URL等)。建议降级：保存时拆分为多个后端 API 调用 |
| `GET /api/rules` | **无直接对应** | 新前端 "rules"(AutomationRule)是纯 mock 概念。后端有 `GET /api/workflow` (工作流列表) 和 `GET /api/scheduler/tasks` (定时任务)，概念接近但字段完全不同。建议：新 UI 此页降级为"即将推出"或隐藏，待后端工作流引擎完善后再对接 |
| `POST /api/rules` | **无直接对应** | 同上，可映射到 `POST /api/workflow` 但字段语义不同 |
| `GET /api/logs` | `GET /api/logs` | 直接对应。新前端 mock 的 `SyncLog{id, timestamp, level, message}` 对应后端 `OperationLog` 字段。需适配：后端返回 `{items, total, summary, limit, offset}`，每条含 `id, created_at, status, message, module, source_type, ...}`。前端 `level` 字段映射 `status`(success/warning/failed/info) |
| `POST /api/logs` | **无直接对应** | 新前端 mock 用 POST 添加日志。后端无客户端写日志的端点。建议：降级为仅在前端本地状态追加，不调后端 |
| `POST /api/logs/clear` | `DELETE /api/logs/clear` | HTTP 方法不同但语义完全相同 — 清空所有日志 |
| `POST /api/sync/run` | **无直接对应** | 新前端 mock 概念是"全量同步扫描"。后端分散在多个端点：`POST /api/archive/scan` (归档扫描)、`POST /api/subscriptions/system/run` (订阅检查)、`POST /api/strm/generate` (STRM 生成)、`POST /api/settings/emby/sync/run` (Emby 同步)。建议：新前端按钮调用 `POST /api/archive/scan`(最接近"全量同步")，或提供下拉菜单选择具体操作 |
| `POST /api/test/115` | `GET /api/pan115/cookie/check` 或 `GET /api/pan115/health/risk` | 新前端 mock 是测试 115 连接。直接对应 `GET /api/pan115/cookie/check`(检查 Cookie 有效性)。注意新前端 POST 传 `{cookie}` → 后端需先 `POST /api/pan115/cookie/update` 再 `GET /api/pan115/cookie/check` |
| `POST /api/test/emby` | `GET /api/settings/emby/check?emby_url=&emby_api_key=` | 新前端 mock 测试 Emby 连接。直接对应。注意新前端 POST 传 `{url, key}` → 后端 GET 带 query params |
| `GET /api/resources` | `GET /api/search/explore/sections?source=douban` 或 `GET /api/search/{media_type}/{tmdb_id}/resources` | 新前端 mock 的 resources 概念(MediaResource)接近搜索/探索结果。建议：用 `GET /api/search/explore/sections` 取首页推荐列表，或用 `GET /api/search/explore/popular` 取热门。字段需映射：mock `links[{name, size, seeds, pickcode, url}]` → 后端资源列表每条含 `share_link, title, size, source_service` 等 |
| `GET /api/subscriptions` | `GET /api/subscriptions` | 直接对应。新前端 mock `SubscriptionItem{id, title, poster, category, status, progress, lastUpdated, rssSource, autoTransfer, targetDirId}` vs 后端 `{id, title, media_type, poster_path, is_active, tv_scope, sources[], ...}`。`category` 映射 `media_type`(Movie→movie, TV→tv, Anime→tv or movie)，`status` 映射 `is_active`，`rssSource` 映射 `sources[].source_type`，`autoTransfer` 映射 `auto_download`，`targetDirId` 后端无直接字段 |
| `POST /api/subscriptions` | `POST /api/subscriptions` | 直接对应。新前端 mock 传 `[{id, title, ...}]`(全量覆盖) → 后端 `SubscriptionCreate`(单条创建)。如新前端是批量保存订阅列表，需逐条调 `POST /api/subscriptions` 或 `POST /api/subscriptions/toggle` |
| `POST /api/transfer` | `POST /api/pan115/share/save-to-folder` | 新前端 mock 概念是"115 转存"。最直接对应 `POST /api/pan115/share/save-to-folder`(一键转存)。新前端传 `{title, linkName, category}` → 后端需 `{share_url, folder_name, receive_code}`。新前端缺少 `share_url` 和 `receive_code`，需从资源链接中提取 |

---

## 四、映射结论汇总

### 完全有对应 (可直接对接)
`GET /api/logs`, `POST /api/config`(需字段映射到 PUT /api/settings/runtime), `GET /api/subscriptions`, `POST /api/subscriptions`, `GET /api/resources`(需字段映射)

### 有对应但需适配
`GET /api/config`(GET→GET, 字段名不同), `POST /api/logs/clear`(POST→DELETE), `POST /api/test/115`(POST→GET, 需先更新 cookie), `POST /api/test/emby`(POST→GET, 参数位置不同), `POST /api/transfer`(字段需转换)

### 完全无直接对应
- **`GET /api/directories`** — 后端无"同步目录"概念，需用 `/api/archive/config` + `/api/archive/folders` 组合
- **`POST /api/directories`** — 同上，需拆分为多个后端调用
- **`GET /api/rules`** — 纯 mock 概念，接近 `GET /api/workflow` 但字段完全不同
- **`POST /api/rules`** — 同上
- **`POST /api/logs`** — 后端无客户端写日志端点
- **`POST /api/sync/run`** — 无统一同步入口，需拆分为 archive scan + sub run + strm generate

### 后端端点总数
约 **170+** 个端点(含所有 GET/POST/PUT/PATCH/DELETE + 兼容别名路由)

### 旧 Vue API 函数总数
**214** 个封装函数 (分布在 15 个命名对象中)

### 认证机制一句话
Cookie-based session 认证，中间件拦截所有 `/api/*` 请求，白名单豁免 auth/login/logout/session 和 strm/play/；前端 axios 拦截器自动处理 401 跳转登录页，/pan115/ 前缀的 401 不重定向(资源凭证问题)。

### 轮询线索
旧 Vue 前端 `index.js` 第 39-66 行有 `waitForBackendReady()` 函数，轮询 `/healthz` 端点(间隔默认 1500ms，最长等待 45000ms)。旧前端未发现通用数据轮询(polling)机制；API 调用均为用户交互触发或页面初始加载触发，后台任务状态通过手动刷新或 WebSocket 替代方式获取。
