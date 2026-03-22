# XClaw

> AI Agent 平台，包含 Web UI、桌面应用和后端 API

[English](README.md) | 中文

## 概述

XClaw 是一个 AI Agent 平台，提供现代化的 Web 界面与 AI Agent 交互。主要包含三个组件：

- **Web 应用** (Next.js 16) - 基于 React 的现代 UI
- **桌面应用** (Electron 33) - 原生桌面客户端
- **Studio API** (Python Flask) - 后端服务

## 功能特性

- 与 AI Agent 实时聊天
- 支持多 Agent 和技能
- 任务管理与监控
- Gateway 集成用于 AI 处理
- 桌面应用支持离线访问
- 丰富的消息渲染（Markdown、代码块、表格）

## 环境要求

- Node.js 18+
- pnpm 10+
- Python 3.11+ (用于 Studio API)
- OpenClaw Gateway (默认运行在 20064 端口)

## 快速开始

```bash
# 安装依赖
pnpm install

# 运行开发服务器 (web + desktop)
pnpm dev

# 或运行所有服务 (web + desktop + studio-api)
pnpm dev:all

# 构建生产版本
pnpm build

# 构建 Electron 应用
pnpm electron:build
```

## 项目结构

```
xclaw-monorepo/
├── apps/
│   ├── web/           # Next.js 16 Web 应用
│   ├── desktop/       # Electron 桌面应用
│   └── studio-api/    # Python Flask 后端
├── docs/              # 文档
├── packages/          # 共享包
└── scripts/           # 构建脚本
```

## 环境变量

默认配置（通常无需修改）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENCLAW_STATE_DIR` | `$HOME/.xclaw` | 状态目录 |
| `OPENCLAW_CONFIG_PATH` | `$HOME/.xclaw/openclaw.json` | 配置文件路径 |
| `OPENCLAW_GATEWAY_PORT` | `20064` | Gateway 端口 |
| `OPENCLAW_GATEWAY_HOST` | `127.0.0.1` | Gateway 主机 |

## 开发

### 运行单个服务

```bash
# 仅 Web
pnpm dev:web

# 仅桌面应用
pnpm dev:desktop

# 仅 Studio API
pnpm dev:studio-api
```

### 代码质量

```bash
# 代码检查
pnpm lint

# 类型检查
pnpm typecheck

# 运行测试
pnpm test
```

## API 端点

- `/api/chat/*` - 聊天消息
- `/api/gateways/*` - Gateway 管理
- `/api/skills/*` - 技能注册
- `/api/sessions` - 会话管理
- `/api/agents/*` - Agent 管理

## 技术栈

- **前端**: React 19, Next.js 16, Tailwind CSS 4
- **状态管理**: Zustand
- **UI 组件**: Radix UI, Framer Motion
- **桌面端**: Electron 33
- **后端**: Python Flask
- **数据库**: SQLite (better-sqlite3)

## 贡献指南

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开 Pull Request

## 许可证

MIT 许可证 - 详见 [LICENSE](LICENSE)

## 支持

- 提交 Issue 报告 Bug 或功能请求
- 查看 [docs/](docs/) 了解详细文档
