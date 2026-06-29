# MediaSync115

MediaSync115 是一个围绕个人媒体库构建的媒体同步工具，覆盖影视发现、资源聚合、115 转存、订阅追更、动漫追番、自动归档、STRM 生成、Emby/飞牛入库状态和播放代理。

当前前端为 React + Vite，后端为 FastAPI + SQLite，推荐通过 Docker Compose 部署。

## 功能概览

- 影视搜索与探索：TMDB、豆瓣榜单、片单、演职员关注。
- 多源资源聚合：Pansou、HDHive、Telegram、SeedHub、不太灵、磁力、ED2K、115 分享。
- 115 转存：详情页、探索页、订阅任务、工作流统一接入转存链路。
- 智能订阅：电影/剧集订阅，支持季、集段、只追新集、固定 115 分享来源。
- 动漫追番：Bangumi 搜番、ANI-RSS API 获取多源精确 RSS、创建/预览/启停、状态闭环。
- ANI-RSS 配置闭环：检测 ANI-RSS 到 qBittorrent 的下载器配置、任务数和安全开关。
- 归档与 STRM：转存后自动归档、生成 STRM，支持 Emby/飞牛影视读取。
- Emby 与飞牛影视：入库角标、缺集判断、媒体库索引同步。
- Emby 代理播放：端口 `8099` 提供 STRM 播放 302 跳转。
- 工作流、调度、日志、健康检查、运行时设置、可选 Kafka 埋点。
- Telegram：TG 索引、TG Bot 搜索/转存/订阅/通知。

## 快速开始

### 默认账号

首次启动后访问 Web UI：

```text
http://127.0.0.1:5173
```

默认登录：

```text
用户名：admin
密码：password
```

首次登录后建议在「配置与终端」里修改账号密码。

### Docker Compose 部署

本地构建并启动主服务：

```bash
docker compose up -d --build
```

启动主服务 + ANI-RSS + qBittorrent：

```bash
docker compose -f compose.yaml -f compose.anirss.yaml up -d --build
```

启动主服务 + Pansou：

```bash
docker compose -f compose.pansou.yaml up -d --build
```

常用访问地址：

| 地址 | 说明 |
| --- | --- |
| `http://127.0.0.1:5173` | Web UI |
| `http://127.0.0.1:5173/healthz` | 容器健康检查 |
| `http://127.0.0.1:9008` | 兼容入口 / STRM 相关入口 |
| `http://127.0.0.1:8099` | Emby 代理播放端口 |
| `http://127.0.0.1:7789` | ANI-RSS Web UI |
| `http://127.0.0.1:8085` | qBittorrent Web UI，仅绑定本机 |

### NAS 部署

NAS 用户建议使用 Docker Hub 镜像版 compose：

默认镜像为 `wangsy1007/mediasync115:latest`。如果需要锁定版本，可以把 compose 里的 tag 改成明确版本号。

| 场景 | Compose 文件 |
| --- | --- |
| 仅 MediaSync115 | `compose.nas.yaml` |
| MediaSync115 + Pansou | `compose.nas.pansou.yaml` |

更新镜像：

```bash
docker compose pull
docker compose up -d
```

数据目录必须持久化，至少保留：

```text
./data:/app/data
```

如果使用 STRM，再挂载：

```text
./strm:/app/strm
```

## 首次配置

进入「配置与终端」后按需填写：

| 配置 | 用途 |
| --- | --- |
| TMDB API Key | 搜索、详情、海报、剧集信息 |
| 115 Cookie | 115 文件、转存、离线与归档 |
| Pansou 地址 | 盘搜资源聚合；集成 compose 时默认使用 `http://pansou:8888/` |
| HDHive 账号或 Cookie | PT/115 资源补充与自动解锁 |
| Telegram API | TG 索引、TG 搜索、TG Bot |
| Emby URL / API Key | 入库角标、缺集判断、STRM 播放 |
| 飞牛 URL / API Key | 飞牛影视入库角标与缺集判断 |
| ANI-RSS 地址 / API Key | 动漫追番和 RSS 状态同步 |
| MoviePilot / Twilight | 可选外部系统集成 |

运行时配置会保存到：

```text
data/runtime_settings.json
```

数据库默认保存到：

```text
data/mediasync.db
```

## 动漫追番工作流

动漫追番页当前链路：

1. 使用 Bangumi 搜索并选择番剧条目。
2. 通过 ANI-RSS API 使用 Bangumi ID 精确获取 Mikan、AniBT、AnimeGarden RSS 候选。
3. 预览 ANI-RSS 命中结果。
4. 创建 ANI-RSS 订阅。
5. 订阅默认停用，不会立即下载。
6. 在订阅卡片中查看暂停/追新中/错误、集数、RSS、保存路径、命中、去重忽略和最近错误。

安全约束：

- 创建订阅后端默认 `enable=false`。
- 保存位置留空时不传 `download_path`，由 ANI-RSS 使用自己的默认路径。
- 只有用户显式启用追新，ANI-RSS 才可能向 qBittorrent 添加任务。
- 设置页的「下载器配置闭环」只检测和同步安全默认配置，不会启用订阅。
- 当前推荐先确认 qBittorrent 任务数为 `0`，再启用任何真实追新。

相关 compose：

```bash
docker compose -f compose.yaml -f compose.anirss.yaml up -d --build
```

ANI-RSS 数据目录：

```text
data/ani-rss/config
```

qBittorrent 数据目录：

```text
data/qbittorrent/config
data/downloads
data/media
```

## 订阅与转存

MediaSync115 内置影视订阅系统，适合电影和电视剧：

- 订阅范围：全剧、指定季、指定集段。
- 追更模式：补缺、只追新集。
- 资源优先级：HDHive、Pansou、TG，可在设置中调整。
- 画质偏好：分辨率、编码、HDR、音频、字幕、排除标签、体积范围。
- 固定来源：可把手动 115 分享链接保存为订阅来源，后续重复扫描并只处理缺失/新增集。
- 自动清理：已入库或已完成范围可清理订阅。

普通影视订阅和 ANI-RSS 动漫追番是两条不同链路：

- 普通影视订阅由 MediaSync115 负责搜索和 115 转存。
- 动漫追番由 ANI-RSS 负责 RSS 去重和 qBittorrent 下载。

## 归档、STRM 与播放

归档链路：

```text
115 转存 / 离线完成 -> 归档 -> 生成 STRM -> Emby/飞牛读取
```

常用设置：

- STRM 输出目录建议设为 `/app/strm`。
- Docker 部署时把宿主机目录挂载到 `/app/strm`。
- Emby 代理端口为 `8099`。
- `EMBY_PROXY_HOST` 指向真实 Emby 服务。
- `EMBY_PROXY_PORT` 默认为 `8096`。

示例：

```bash
STRM_HOST_DIR=/volume1/media/strm
EMBY_PROXY_HOST=192.168.1.10
EMBY_PROXY_PORT=8096
```

## Compose 文件说明

| 文件 | 说明 |
| --- | --- |
| `compose.yaml` | 本地构建 MediaSync115 |
| `compose.anirss.yaml` | 叠加 ANI-RSS 与 qBittorrent |
| `compose.pansou.yaml` | 本地构建 MediaSync115 + Pansou |
| `compose.nas.yaml` | NAS 使用 Docker Hub 镜像部署 |
| `compose.nas.pansou.yaml` | NAS 使用 Docker Hub 镜像部署 + Pansou |

## 常用命令

查看服务：

```bash
docker compose -f compose.yaml -f compose.anirss.yaml ps
```

查看主服务日志：

```bash
docker logs -f mediasync115
```

查看 ANI-RSS 日志：

```bash
docker logs -f ani-rss
```

确认 qBittorrent 当前任务数：

```bash
curl -fsS -H 'Host: localhost:8080' \
  http://127.0.0.1:8085/api/v2/torrents/info \
  | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'
```

输出 `0` 表示当前没有 qBittorrent 任务。如果你的 qB Web UI 已关闭本机免登录，请先登录 Web UI 或用固定密码登录 API 后再带 cookie 查询。

## 开发文档

开发环境、目录结构、运行方式、测试、热更新、接口约定和注意事项见：

```text
docs/DEVELOPMENT.md
```

## 更新日志

完整更新记录见：

```text
CHANGELOG.md
```

当前仓库仍保留旧版前端目录 `frontend-legacy-vue/` 作为历史参考，新功能开发默认使用 `frontend/`。

## 社区

Telegram 群：

```text
https://t.me/+EkEBz7x7i9NlYzFl
```
