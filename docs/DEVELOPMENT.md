# MediaSync115 开发文档

本文面向参与开发和维护 MediaSync115 的人，记录当前仓库结构、启动方式、测试命令、Docker 热更新和关键业务约束。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19、Vite 6、TypeScript、Tailwind CSS、lucide-react、axios、motion |
| 后端 | FastAPI、SQLAlchemy 2、SQLite、APScheduler、httpx |
| 数据 | `data/mediasync.db`、`data/runtime_settings.json` |
| 部署 | Docker / Docker Compose / Nginx all-in-one |
| 可选服务 | ANI-RSS、qBittorrent、Pansou、Emby、飞牛影视、Telegram、MoviePilot、Twilight |

## 目录结构

```text
.
├── backend/                  # FastAPI 应用
│   ├── app/api/              # API 路由
│   ├── app/services/         # 业务服务
│   ├── app/models/           # SQLAlchemy 模型
│   ├── app/core/             # 配置、数据库初始化
│   └── tests/                # 后端测试
├── frontend/                 # 当前 React 前端
│   ├── src/api/              # 前端 API client 和类型
│   ├── src/components/       # 页面和组件
│   └── src/utils/            # 前端工具函数
├── frontend-legacy-vue/      # 历史 Vue 前端，默认不要改
├── data/                     # 本地运行数据，通常不提交
├── docs/                     # 文档
├── docker/all-in-one/        # all-in-one 容器启动脚本与 Nginx 配置
├── compose.yaml              # 本地构建主服务
├── compose.anirss.yaml       # 叠加 ANI-RSS + qBittorrent
└── compose.pansou.yaml       # 叠加 Pansou
```

## 本地 Docker 开发

仅启动主服务：

```bash
docker compose up -d --build
```

启动主服务、ANI-RSS、qBittorrent：

```bash
docker compose -f compose.yaml -f compose.anirss.yaml up -d --build
```

启动主服务、Pansou：

```bash
docker compose -f compose.pansou.yaml up -d --build
```

健康检查：

```bash
curl -fsS http://127.0.0.1:5173/healthz
```

查看日志：

```bash
docker logs -f mediasync115
docker logs -f ani-rss
docker logs -f qbittorrent
```

## 前端开发

安装依赖：

```bash
cd frontend
npm install
```

连接本地后端 `127.0.0.1:8000`：

```bash
npm run dev
```

如果后端跑在现有 Docker all-in-one 的 `5173` 上，另开 Vite 端口并代理到 Docker：

```bash
VITE_API_PROXY_TARGET=http://127.0.0.1:5173 npm run dev -- --port 5174 --strictPort false
```

类型检查：

```bash
cd frontend
npx tsc --noEmit
```

生产构建：

```bash
cd frontend
npm run build
```

当前构建可能出现 Vite chunk size warning，这是体积提示，不代表构建失败。

## 后端开发

安装依赖：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
```

启动后端：

```bash
cd backend
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

本地后端默认读写相对路径下的：

```text
backend/data/
```

Docker all-in-one 容器内读写：

```text
/app/data
```

运行单测：

```bash
cd backend
pytest
```

如果当前机器没有安装 `pytest` 或后端依赖，可以用现有镜像挂载当前工作区做轻量检查：

```bash
docker run --rm \
  -v /home/nax/MediaSync115/backend:/work \
  -v /home/nax/MediaSync115/data:/work/data \
  -w /work \
  mediasync115:latest \
  python -m py_compile app/api/anime.py app/services/anirss_provider_service.py
```

## 热更新运行容器

当 Docker Hub 拉取基础镜像失败，或只想快速验证当前改动时，可以热更新已有 `mediasync115` 容器。

后端文件：

```bash
docker cp backend/app/api/anime.py mediasync115:/app/app/api/anime.py
docker cp backend/app/services/anirss_provider_service.py mediasync115:/app/app/services/anirss_provider_service.py
```

前端构建产物：

```bash
cd frontend
npm run build
docker cp dist/. mediasync115:/usr/share/nginx/html/
```

重启主服务：

```bash
docker restart mediasync115
curl -fsS http://127.0.0.1:5173/healthz
```

注意：热更新适合本地验证，不替代正式镜像构建。

## 运行时配置

运行时配置集中由 `RuntimeSettingsService` 管理，持久化到：

```text
data/runtime_settings.json
```

典型原则：

- 用户可在设置页修改的值，优先走运行时配置。
- 密码、Token、API Key 需要加密或脱敏，不直接返回明文。
- `backend/.env` 仍兼容，但不是 Docker 部署的主要配置入口。

## 数据库

默认 SQLite：

```text
sqlite+aiosqlite:///./data/mediasync.db
```

启动时会自动创建表和补齐部分缺失列。新增字段时要同时考虑：

- SQLAlchemy 模型。
- `backend/app/core/database.py` 里的轻量迁移。
- 旧数据兼容。
- 前端类型。

## 前后端 API 约定

前端 API 封装在：

```text
frontend/src/api/
```

后端路由在：

```text
backend/app/api/
```

新增接口建议同时更新：

- `frontend/src/api/*.ts`
- `frontend/src/api/types.ts`
- 对应的 `*.contract.test.ts`
- README 或开发文档中的关键说明

当前主要 API 前缀：

| 前缀 | 说明 |
| --- | --- |
| `/api/search` | 搜索和探索 |
| `/api/subscriptions` | 影视订阅 |
| `/api/anime` | Bangumi / ANI-RSS 多源 RSS / ANI-RSS |
| `/api/settings` | 运行时设置和健康检查 |
| `/api/pan115` | 115 网盘 |
| `/api/quark` | 夸克网盘 |
| `/api/archive` | 自动归档 |
| `/api/strm` | STRM |
| `/api/scheduler` | 定时任务 |
| `/api/workflow` | 工作流 |
| `/api/moviepilot` | MoviePilot |
| `/api/twilight` | Twilight |

## ANI-RSS 追番开发注意事项

当前追番链路：

```text
Bangumi 条目 -> ANI-RSS API 精确获取多源 RSS -> ANI-RSS 预览 -> 创建停用订阅 -> 用户手动启用追新
```

必须保持的安全约束：

- 创建订阅默认 `enable=false`。
- 保存位置留空时不要发送 `download_path`。
- RSS 自动获取走 ANI-RSS API，聚合 Mikan、AniBT、AnimeGarden，并且只允许 Bangumi ID 精确匹配当前 Bangumi 条目。
- 不要在健康检查、预览、状态同步中启用订阅。
- 不要在开发验证中主动添加 qBittorrent 下载任务。
- 验证后确认 qBittorrent 任务数仍为 0。

关键文件：

```text
backend/app/api/anime.py
backend/app/services/anirss_client.py
backend/app/services/anirss_provider_service.py
backend/app/services/bangumi_client.py
frontend/src/components/AnimeTab.tsx
frontend/src/components/SettingsTab.tsx
frontend/src/api/anime.ts
frontend/src/api/types.ts
```

ANI-RSS 配置文件：

```text
data/ani-rss/config/config.v2.json
data/ani-rss/config/ani.v2.json
```

qBittorrent 任务数检查：

```bash
curl -fsS -H 'Host: localhost:8080' \
  http://127.0.0.1:8085/api/v2/torrents/info \
  | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'
```

## Git 工作区规则

当前仓库里可能存在不属于功能改动的未跟踪目录：

```text
.claude/
frontend-legacy-vue/
```

普通功能提交不要混入这些目录。

提交前建议执行：

```bash
git status --short
git diff --check
cd frontend && npx tsc --noEmit
cd ../backend && python3 -m py_compile app/api/anime.py app/services/anirss_provider_service.py
```

## 发布前检查清单

- Web UI 可访问。
- `/healthz` healthy。
- 前端 `npm run build` 通过。
- 后端关键测试或 `py_compile` 通过。
- 运行时设置能保存并重载。
- 115 Cookie、TMDB、Pansou 等健康检查按场景可用。
- 如果改到 ANI-RSS，确认订阅仍默认停用，qBittorrent 任务数仍为 0。
- `git status --short` 不包含无关目录或构建产物。
