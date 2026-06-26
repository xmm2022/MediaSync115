# MediaSync115 Frontend

React 19 + Tailwind CSS v4 + Vite 前端，对接 FastAPI 后端 (端口 8000)。

## 技术栈

- **React 19** + TypeScript
- **Tailwind CSS v4** (通过 @tailwindcss/vite 插件)
- **Vite 6** 构建工具
- **lucide-react** 图标库
- **motion** 动画库
- **recharts** 图表库
- **axios** HTTP 客户端

## 开发

```bash
npm install
npm run dev        # 启动开发服务器 (端口 5173)
```

Vite 自动将 `/api` 请求代理到 `http://localhost:8000`（后端 FastAPI）。

## 构建

```bash
npm run build      # TypeScript 检查 + Vite 生产构建
npm run preview    # 预览构建产物
```

生产部署使用 `vite build` 产出 `dist/` 静态文件，由 Nginx 托管并提供 `/api` 反向代理。

所有 `/api` 请求经由 Vite dev proxy 或 Nginx 反代转发至 FastAPI 后端（见根目录 `backend/`）。

## 项目结构

```
frontend/
├── src/
│   ├── api/          # axios API 客户端封装
│   │   ├── client.ts     # axios 实例 + 拦截器
│   │   ├── search.ts     # 搜索/探索 API
│   │   ├── pan115.ts     # 115 网盘 API
│   │   ├── settings.ts   # 设置 API
│   │   ├── subscription.ts # 订阅 API
│   │   ├── archive.ts    # 归档 API
│   │   ├── strm.ts       # STRM API
│   │   ├── logs.ts       # 日志 API
│   │   ├── scheduler.ts  # 调度器 API
│   │   ├── workflow.ts   # 工作流 API
│   │   ├── auth.ts       # 认证 API
│   │   ├── watchlist.ts  # 片单 API
│   │   ├── personFollow.ts # 影人关注 API
│   │   ├── license.ts    # 许可证 API
│   │   ├── quark.ts      # 夸克网盘 API
│   │   ├── pansou.ts     # Pansou API
│   │   └── index.ts      # 统一导出
│   ├── components/   # React 组件
│   ├── utils/        # 工具函数（health check 等）
│   ├── types.ts      # 类型定义
│   ├── App.tsx       # 根组件
│   └── main.tsx      # 入口
├── nginx.conf        # Nginx 配置参考
├── vite.config.ts    # Vite 配置
└── package.json
```

## 对接后端

后端 FastAPI 运行在端口 8000，提供会话认证 (Cookie-based session)。API 代理由 Vite dev server 或生产 Nginx 处理。
