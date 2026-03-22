# RFD: xclaw 内置 OpenClaw 模型来源（阶段性方案）

## 背景

当前 `xclaw` 采用内置 OpenClaw（状态目录 `~/.xclaw`）运行，以保证与用户外部 OpenClaw（`~/.openclaw`）并存且互不覆盖。  
但在实际使用中，内置实例若没有独立配置 provider key，会出现工作台调用模型时报错（例如 `No API key found for provider ...` / `HTTP 500`）。

## 目标

在不破坏内置实例隔离性的前提下，先保证“可用性优先”：

1. 内置实例可优先复用用户已有 `~/.openclaw` 模型配置；
2. 内置实例可优先复用用户已有 `~/.openclaw` 的主 agent 认证材料；
3. 为后续“统一模型配置入口”预留演进空间。

## 当前实现（本次）

变更文件：`apps/desktop/main.js`

### 1) 模型优先级

在生成/修正 `~/.xclaw/openclaw.json` 时：

- 若 `~/.xclaw` 的 `agents.defaults.model.primary` 缺失或无效（如 `xclaw/*`），
- 则尝试读取 `~/.openclaw/openclaw.json` 的 `agents.defaults.model.primary` 并写入 `~/.xclaw`。

即当前优先级：

1. `~/.xclaw/openclaw.json` 中显式有效配置；
2. `~/.openclaw/openclaw.json` 中 `agents.defaults.model.primary`；
3. 都没有时保持未设置（不再硬编码默认 provider 模型）。

### 2) 主 agent 认证同步

启动内置实例时，会同步：

- 源：`~/.openclaw/agents/main/agent/auth-profiles.json`
- 目标：`~/.xclaw/agents/main/agent/auth-profiles.json`

该同步是“复制”策略（非软链接），用于让内置实例先可直接使用外部已存在的 provider 认证信息。

### 3) 首页自定义模型配置入口（对齐 xclaw 交互）

新增首页输入区模型下拉中的“自定义模型”入口，支持在 UI 中配置：

- 模型厂商（`openai` / `anthropic` / `openai-compatible`）
- API Key
- 模型名称
- Base URL（仅 `openai-compatible` 需要）

对应后端接口：

- `GET /api/chat/model-config`
- `PUT /api/chat/model-config`

支持厂商：

- OpenAI
- Anthropic
- OpenAI Compatible
- MiniMax（Anthropic 兼容）
- 智谱 GLM（OpenAI 兼容）

并提供预置模型候选（如 `gpt-4o-mini`、`claude-3-7-sonnet-latest`、`MiniMax-M2.5`、`glm-4.5`）。

### 4) 设置页模型管理菜单

新增设置页入口：`/settings/management/models`，用于完整管理模型与凭据：

- 启用/停用自定义模型
- 选择厂商、填写 API Key、模型名、Base URL
- 直接使用预置模型候选进行一键填充

定位：

- 对话页负责“快速切换/快速配置”
- 设置页负责“完整管理/长期维护”

配置写入 `~/.xclaw/openclaw.json`，落在 `models.providers.xclaw-custom`，并将
`agents.defaults.model.primary` 设为 `xclaw-custom/<model>`。

说明：

- 当前阶段默认仍优先使用 `~/.openclaw` 的模型来源；
- 该入口主要用于后续切换到“以 xclaw 内置配置为主”的统一入口时平滑迁移。

## 取舍说明

- **优点**：能快速恢复可用，避免内置实例因缺少 provider key 导致聊天失败。
- **风险**：外部认证内容被复制到 `~/.xclaw`，两边后续可能出现配置漂移（非双向实时同步）。
- **边界**：本次仅同步 `main` agent，未覆盖所有 agent。

## 后续建议（下一阶段）

建议新增“模型配置入口”并明确单一来源（SSOT），推荐方案：

1. 在 `xclaw` 设置页提供“模型与凭据”配置；
2. 明确支持三种模式：
   - **内置独立模式**：仅使用 `~/.xclaw`；
   - **复用外部模式**：显式从 `~/.openclaw` 读取；
   - **手动指定模式**：用户指定配置文件路径；
3. 通过 UI 提示当前生效来源（内置/外部/手动），避免排障时来源不透明。

