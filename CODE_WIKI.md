# XClaw 项目 Code Wiki

## 项目概述

XClaw 是一个 AI Agent 平台，提供现代化的 Web 界面与 AI 代理进行交互。项目采用 monorepo 架构，包含三个主要组件：

- **Web 应用** (Next.js 16) - 基于 React 的现代化 UI
- **桌面应用** (Electron 33) - 原生桌面封装
- **Studio API** (Python Flask) - 后端服务

### 核心功能

- 与 AI 代理的实时聊天
- 多代理和技能支持
- 任务管理和监控
- AI 处理网关集成
- 桌面应用支持离线访问
- 富消息渲染（Markdown、代码块、表格）

---

## 项目架构

### 目录结构

```
xclaw-monorepo/
├── apps/
│   ├── web/                    # Next.js Web 应用
│   │   ├── app/               # App Router 路由
│   │   ├── components/        # React 组件
│   │   ├── hooks/            # 自定义 Hooks
│   │   ├── lib/              # 核心工具库
│   │   ├── messages/         # 国际化消息
│   │   ├── store/            # Zustand 状态管理
│   │   ├── styles/           # 样式文件
│   │   └── types/            # TypeScript 类型定义
│   ├── desktop/              # Electron 桌面应用
│   │   └── openclaw-runtime/ # OpenClaw 运行时
│   └── studio-api/           # Python Flask 后端
│       ├── apps/api/         # API 应用
│       └── config/           # 配置文件
├── docs/                     # 文档
├── native/                   # 原生模块
├── scripts/                  # 构建脚本
├── package.json              # 根 package.json
└── turbo.json                # Turborepo 配置
```

---

## 主要模块说明

### 1. Web 应用 (apps/web)

#### 核心依赖
- **Next.js 16** - React 框架
- **React 19** - UI 库
- **Tailwind CSS 4** - 样式框架
- **Zustand** - 状态管理
- **TanStack Query** - 数据获取
- **Radix UI** - 无样式组件库
- **Framer Motion** - 动画库
- **TypeScript** - 类型安全
- **better-sqlite3** - SQLite 数据库
- **Zod** - 数据验证

#### 主要目录结构详解

**app/** - 页面路由
- `app/api/` - API 路由
- `app/settings/` - 设置页面
- `app/login/` - 登录页面
- `app/setup/` - 安装页面

**components/** - UI 组件
- `chat/` - 聊天相关组件
  - `chat-panel.tsx` - 聊天面板
  - `chat-sidebar.tsx` - 聊天侧边栏
  - `message-input.tsx` - 消息输入
  - `markdown-content.tsx` - Markdown 渲染
- `layout/` - 布局组件
- `panels/` - 面板组件
- `studio/` - Studio 相关组件
- `ui/` - 通用 UI 组件库（基于 Radix UI）

**lib/** - 核心逻辑库
- `config.ts` - 配置管理
- `db.ts` - 数据库
- `gateway.ts` - 网关集成
- `openclaw-gateway.ts` - OpenClaw 网关调用
- `store/` - 数据存储
- `websocket.ts` - WebSocket 处理
- `agent-card-helpers.ts` - 代理卡片辅助函数
- `chat-utils.ts` - 聊天工具
- `models.ts` - 模型管理
- `themes.ts` - 主题管理
- `utils.ts` - 通用工具函数

**lib/adapters/** - 适配器
- `adapter.ts` - 基础适配器接口
- `claude-sdk.ts` - Claude SDK 适配器
- `openclaw.ts` - OpenClaw 适配器
- `langgraph.ts` - LangGraph 适配器
- `crewai.ts` - CrewAI 适配器

**lib/chat-messages/** - 消息处理
- `chat-reply-writer.ts` - 聊天回复写入
- `coordinator-thread-strategy.ts` - 协调器线程策略
- `forward-info.ts` - 转发信息
- `gateway-attachments.ts` - 网关附件
- `gateway-delivery.ts` - 网关交付

**store/** - Zustand 状态存储
- `index.ts` - 主状态 store

#### 状态管理 (Zustand)

`useXClawStore` 管理以下核心状态：

- **Dashboard 模式** - full/local
- **连接状态** - WebSocket 连接信息
- **任务管理** - 任务列表和选中任务
- **代理管理** - 代理列表和选中代理
- **聊天** - 消息、会话、输入状态
- **技能** - 技能列表和分组
- **用户** - 当前用户信息
- **UI 状态** - 标签页、侧边栏、面板状态

### 2. 桌面应用 (apps/desktop)

- **Electron 33** - 桌面应用框架
- **Main Process** - `main.js`
- **Preload Scripts** - 安全预加载脚本
- **OpenClaw Runtime** - 包含 OpenClaw 运行时和技能配置

### 3. Studio API (apps/studio-api)

#### 核心功能
- **像素办公室 UI 后端** - 提供状态服务
- **AI 图像生成** - 支持 nano-banana-pro 模型
- **代理接入** - 多代理连接和管理
- **资产管理** - 图像、精灵表处理

#### 主要 API 端点
- `/` - 主页（像素办公室 UI）
- `/electron-standalone` - Electron 独立页面
- `/join` - 代理加入页面
- `/invite` - 邀请页面
- `/agents` - 获取代理列表
- `/agent-approve` - 批准代理
- `/agent-reject` - 拒绝代理
- `/join-agent` - 代理接入
- `/leave-agent` - 代理离开
- `/status` - 获取当前状态
- `/openclaw-chat` - OpenClaw 聊天

#### 核心模块
- `app.py` - Flask 应用主文件
- `security_utils.py` - 安全工具
- `memo_utils.py` - 备忘录工具
- `openclaw_gateway_chat.py` - 网关聊天
- `store_utils.py` - 存储工具

---

## 关键类与函数

### Web 应用核心模块

#### 1. config.ts
```typescript
// 配置管理
export const config = {
  claudeHome: string,
  dataDir: string,
  dbPath: string,
  openclawStateDir: string,
  openclawConfigPath: string,
  gatewayHost: string,
  gatewayPort: number,
  memoryDir: string,
  // ...
}

export function ensureDirExists(dirPath: string)
```

#### 2. openclaw-gateway.ts
```typescript
// 解析网关 JSON 输出
export function parseGatewayJsonOutput(raw: string): unknown | null

// 解包网关 RPC 结果
export function unwrapGatewayRpcResult<T>(payload: unknown): T

// 调用 OpenClaw 网关
export async function callOpenClawGateway<T>(
  method: string,
  params: unknown,
  timeoutMs = 10000
): Promise<T>
```

#### 3. store/index.ts - Zustand Store
```typescript
// 主要接口
interface XClawStore {
  // Dashboard 模式
  dashboardMode: 'full' | 'local'
  gatewayAvailable: boolean
  
  // 连接状态
  connection: ConnectionStatus
  
  // 任务管理
  tasks: Task[]
  selectedTask: Task | null
  
  // 代理管理
  agents: Agent[]
  selectedAgent: Agent | null
  
  // 聊天
  chatMessages: ChatMessage[]
  conversations: Conversation[]
  activeConversation: string | null
  
  // 用户
  currentUser: CurrentUser | null
  
  // UI 状态
  activeTab: string
  sidebarExpanded: boolean
}
```

### Studio API 核心函数

#### 1. app.py - Flask 应用
```python
# 加载状态
def load_state() -> dict

# 保存状态
def save_state(state: dict)

# 加载代理状态
def load_agents_state() -> list

# 保存代理状态
def save_agents_state(agents: list)

# 标准化代理状态
def normalize_agent_state(s: str) -> str

# 状态到区域映射
def state_to_area(state: str) -> str

# 生成 RPG 风格背景
def _generate_rpg_background_to_webp(
    out_webp_path: str,
    width: int = 1280,
    height: int = 720,
    custom_prompt: str = "",
    speed_mode: str = "fast"
)
```

---

## 依赖关系

### 根项目依赖 (package.json)
```json
{
  "devDependencies": {
    "concurrently": "^9.0.0",
    "turbo": "^2.5.8"
  }
}
```

### Web 应用依赖 (apps/web/package.json)

**核心框架：**
- `next@^16.1.6`
- `react@^19.0.1`
- `react-dom@^19.0.1`

**状态管理：**
- `zustand@^5.0.11`
- `@tanstack/react-query@^5.99.0`

**UI 组件：**
- `@radix-ui/*` - Radix UI 组件集合
- `tailwindcss@^4.2.0`
- `framer-motion@^11.18.0`
- `lucide-react@^0.564.0`

**数据库：**
- `better-sqlite3@^12.6.2`

**工具库：**
- `zod@^4.3.6`
- `date-fns@4.1.0`
- `react-markdown@^10.1.0`

### Desktop 应用依赖 (apps/desktop/package.json)
```json
{
  "dependencies": {
    "electron-updater": "^6.6.2"
  },
  "devDependencies": {
    "electron": "^35.7.5",
    "electron-builder": "^25.0.0",
    "wait-on": "^8.0.0"
  }
}
```

---

## 项目运行方式

### 前置条件
- Node.js 18+
- pnpm 10+
- Python 3.11+ (Studio API)
- OpenClaw Gateway (默认运行在 20064 端口)

### 快速启动

```bash
# 安装依赖
pnpm install

# 准备 OpenClaw 运行时（首次需要）
cd apps/desktop
npm run prepare:openclaw-runtime
cd ../..

# 一键安装并启动（推荐）
pnpm run install:run

# 或直接运行开发服务器（Web + Desktop）
pnpm dev

# 或运行所有服务（Web + Desktop + Studio API）
pnpm dev:all

# 构建生产版本
pnpm build

# 构建 Electron 应用
pnpm electron:build
```

### 单独运行各服务

```bash
# 仅 Web 应用
pnpm dev:web

# 仅 Desktop 应用
pnpm dev:desktop

# 仅 Studio API
pnpm dev:studio-api
```

### 代码质量

```bash
# Lint
pnpm lint

# 类型检查
pnpm typecheck

# 运行测试
pnpm test
```

---

## 配置与环境变量

### 主要环境变量

| 变量名 | 默认值 | 描述 |
|--------|--------|------|
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | OpenClaw 状态目录 |
| `OPENCLAW_CONFIG_PATH` | `~/.openclaw/openclaw.json` | 配置文件路径 |
| `OPENCLAW_GATEWAY_PORT` | `20064` | 网关端口 |
| `OPENCLAW_GATEWAY_HOST` | `127.0.0.1` | 网关主机 |
| `XCLAW_DATA_DIR` | `<repo>/.data` | XClaw 数据目录 |
| `XCLAW_DB_PATH` | `<data>/xclaw.db` | 数据库路径 |
| `FLASK_SECRET_KEY` | - | Flask 密钥 |

---

## 数据库与存储

### SQLite 数据库
- 使用 `better-sqlite3` 进行同步访问
- 数据库文件位置：`<dataDir>/xclaw.db`
- 包含：会话、聊天历史、用户、任务、代理、技能等

### 状态文件
- Studio API 使用 JSON 文件存储状态
- `state.json` - 主状态
- `agents-state.json` - 代理状态
- `join-keys.json` - 接入密钥
- `asset-positions.json` - 资产位置
- `asset-defaults.json` - 资产默认值
- `runtime-config.json` - 运行时配置

---

## API 架构

### Web 应用 API (Next.js Route Handlers)

**聊天相关：**
- `/api/chat/conversations` - 会话管理
- `/api/chat/messages` - 消息管理
- `/api/chat/sessions` - 会话管理

**代理相关：**
- `/api/agents` - 代理列表
- `/api/agents/[id]` - 代理详情
- `/api/agents/comms` - 代理通信

**网关相关：**
- `/api/gateways` - 网关列表
- `/api/gateways/connect` - 网关连接
- `/api/gateways/health` - 网关健康检查

**技能相关：**
- `/api/skills` - 技能列表
- `/api/skills/registry` - 技能注册中心

**其他：**
- `/api/auth/*` - 认证
- `/api/status` - 状态
- `/api/setup` - 安装检查
- `/api/settings` - 设置

---

## 开发指南

### 项目使用 pnpm workspace + Turborepo
- 工作区配置：`pnpm-workspace.yaml`
- Turborepo 配置：`turbo.json`

### 代码规范
- TypeScript 严格模式
- ESLint 进行代码检查
- 使用 Zod 进行数据验证

### 组件开发
- 遵循 Radix UI 组件模式
- 使用 Tailwind CSS 4 进行样式
- 支持浅色/深色主题
- 国际化支持（messages/ 目录）

---

## 贡献指南

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开 Pull Request

---

## 许可证

MIT License - 详见 [LICENSE](LICENSE)
