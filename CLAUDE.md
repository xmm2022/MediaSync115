# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

MediaSync115 是一个面向个人媒体库管理的全栈应用，围绕"找片、找资源、转存、订阅、入库同步"构建。

- **后端**: Python FastAPI + SQLAlchemy async (PostgreSQL)
- **前端**: React 19 + Tailwind CSS v4 + lucide-react + motion + Vite，axios 调真实后端，路由用 PageName state（无 vue-router）
- **前端旧版（参考）**: frontend-legacy-vue/ (Vue 3 + Element Plus + Pinia + Vue Router)
- **测试**: pytest (backend)；Playwright 前端冒烟测试暂缺（新前端尚未装 Playwright）

### 核心功能

1. TMDB/豆瓣搜索探索
2. 115网盘资源获取、一键转存
3. 影视订阅与自动扫描（支持季/集粒度订阅）
4. 自动归档与 STRM 文件生成
5. Emby/飞牛影视集成（已入库标记、缺集判断、同步）
6. Emby 代理 302 播放（端口 8099）
7. Telegram Bot 集成
8. 资源画质筛选（分辨率/编码/HDR/音频/字幕/排除标签/体积范围）

## 常用命令

### 后端 (Python)

```bash
cd backend

# 安装依赖
pip install -r requirements.txt
pip install -r requirements-dev.txt

# 运行所有测试
pytest

# 运行单个测试文件
pytest tests/test_health.py

# 运行单个测试函数
pytest tests/test_health.py::TestHealth::test_root_endpoint

# 启动开发服务器 (端口 8000)
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 前端 (React)

```bash
cd frontend

# 安装依赖
npm install

# 开发服务器 (端口 5173, Vite proxy /api → localhost:8000)
npm run dev

# TypeScript 检查
npm run lint

# 生产构建 (tsc --noEmit + vite build → dist/)
npm run build
```

### Docker

```bash
# 构建并运行
docker build -t mediasync115:local .
docker compose up -d

# 或使用单独的容器部署（本地开发常用）
# 应用必须连接 PostgreSQL；单独运行应用容器前先准备同网络下的数据库容器。
docker network create mediasync115-net
docker volume create mediasync115-postgres-data
docker run -d \
  --name mediasync115-postgres \
  --network mediasync115-net \
  -e POSTGRES_DB=mediasync115 \
  -e POSTGRES_USER=mediasync \
  -e POSTGRES_PASSWORD=mediasync \
  -e TZ=Asia/Shanghai \
  -v mediasync115-postgres-data:/var/lib/postgresql/data \
  --restart unless-stopped \
  postgres:16-alpine

docker run -d \
  --name mediasync115 \
  --network mediasync115-net \
  -p 5173:5173 \
  -p 9008:9008 \
  -p 8099:8099 \
  -e TZ=Asia/Shanghai \
  -e DATABASE_URL=postgresql+asyncpg://mediasync:mediasync@mediasync115-postgres:5432/mediasync115 \
  -v mediasync115-data:/app/data \
  --restart unless-stopped \
  mediasync115:local
```

## 代码修改后的工作流

**每次修改代码后，必须自动执行以下步骤：**

1. Git commit（使用中文提交信息）
2. 重新构建 Docker 镜像
3. 部署到本地 Docker 容器
4. 检查服务启动预热完成

这是用户明确要求的工作流，不要跳过。

> 注意：只提交到本地 Git，不要 push 到远程，除非用户明确要求。

## 项目架构

```
MediaSync115/
├── backend/
│   ├── app/
│   │   ├── api/              # FastAPI 路由处理器
│   │   ├── core/             # 配置、数据库初始化
│   │   ├── models/           # SQLAlchemy 模型
│   │   ├── services/         # 业务逻辑服务层
│   │   └── scheduler.py      # APScheduler 定时任务
│   ├── tests/                # pytest 测试
│   └── main.py               # FastAPI 入口
├── frontend/                  # React 19 新前端（当前主力）
│   ├── src/
│   │   ├── api/              # Axios API 客户端封装 + types.ts
│   │   ├── components/       # React 组件 (各 Tab)
│   │   ├── types.ts          # 顶层共享类型 (PageName, SyncDirectory, SyncLog, MediaResource)
│   │   └── utils/            # 工具函数 (health check)
│   ├── vite.config.ts
│   └── nginx.conf
├── frontend-legacy-vue/      # Vue 3 旧前端（保留参考）
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── views/
│   │   └── utils/
│   └── vite.config.js
├── docker/                   # Docker 配置
├── data/                     # 运行时设置、本地 TMDB 库、缓存等持久化文件
├── compose.yaml              # Docker Compose 配置
└── Dockerfile                # All-in-one 镜像构建
```

### 后端架构关键点

- **数据库**: PostgreSQL + SQLAlchemy 2.0 async，schema 变更通过 Alembic 管理
- **认证**: 会话认证，中间件拦截 `/api/*`（白名单除外）
- **生命周期**: FastAPI lifespan 管理启动/关闭
- **定时任务**: APScheduler，管理订阅扫描、Emby/飞牛同步、归档等
- **服务层**: 所有业务逻辑在 `app/services/` 中

### 前端架构关键点

- **路由**: 无 vue-router，用 `PageName` enum + React state (`activePage`) 切换视图
- **状态管理**: 无全局 store，组件间通过 props 传递（directories/logs/workflows 等 state 由 App.tsx 托管）
- **UI 组件**: 纯 Tailwind CSS v4 + lucide-react 图标 + motion 动画，无第三方组件库
- **API 调用**: `src/api/` 目录下 axios 封装，每个 API 模块独立文件，通过 `index.ts` 统一导出
- **构建**: Vite 6 + @vitejs/plugin-react + @tailwindcss/vite 插件

## 重要说明

- 数据持久化在 `data/` 目录，开发时不要删除
- `.env` 和密钥不要提交到 Git
- 后端默认端口: 8000，前端开发端口: 5173
- 生产部署端口: 5173 (UI), 9008 (API/STRM), 8099 (Emby 代理)
- 需要的关键配置: TMDB_API_KEY, PAN115_COOKIE, EMBY_URL/EMBY_API_KEY, FEINIU_URL/FEINIU_API_KEY

## 代码风格

- Python: `snake_case`，中文 docstring，完整类型提示
- Vue: `<script setup>` Composition API，`PascalCase.vue` 组件
- Git 提交信息: 使用中文，格式如 `feat: xxx`, `fix: xxx`, `chore: xxx`
