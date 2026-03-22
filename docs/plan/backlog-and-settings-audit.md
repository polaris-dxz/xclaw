# XClaw 待办与问题跟踪（计划表）

> 创建日期：2026-03-22  
> 范围：`xclaw/apps/web` 主应用及相关后端接口。  
> 说明：本表汇总当前已知产品缺口、Bug，并对**设置（Settings）**各子页完成度做代码侧核对，便于排期与验收。

---

## 一、待完成工作（按优先级建议）

| ID | 主题 | 现状摘要 | 建议方向 |
|----|------|----------|----------|
| W1 | 点赞 / 点踩 | `message-item.tsx` 中已渲染 `ThumbsUp` / `ThumbsDown`，**无 `onClick`、无 API** | 设计反馈模型（消息 id、会话、用户/匿名）；新增或复用 `POST /api/chat/...` 类接口；持久化并可选展示统计 |
| W2 | Studio 前后端迁移 | 当前 `StudioPanel` 以 iframe 嵌入 `buildStudioEmbedUrl`，独立资源在 `apps/studio-api` | 明确迁移目标：仅打包部署一体化，还是将 Star 办公室逻辑迁入 Next；对齐健康检查、静态资源路径与 Electron `getStudioBaseUrl` |
| W3 | Studio 复用现有后端 | 嵌入页若仍自管数据，易重复 | 会话、状态、装修/资产等优先走现有 `/api/*` 与网关；在迁移清单中逐接口映射 |
| W4 | Studio 三按钮（对话 / 日志 / 装修）布局 | 原版在 `studio-api` 的 `electron-standalone.html` 等处（如 status-fab、control-bar）；**当前 Web 壳层未复刻等价入口** | 在 `AppHeader` + Studio 区域或 iframe 桥接层恢复三入口；避免与侧栏「灵感/MCP/技能」挤在一起，统一信息架构 |
| W5 | MCP 广场 | 侧栏「MCP 广场」按钮**无 `onClick`**（与「技能广场」「灵感广场」不一致） | 新增 `McpPlazaSheet` 或独立页；对接 MCP 配置/工具列表（可结合 `mcp_call_log` 与安全审计已有能力） |
| W6 | 新会话默认快捷操作 | 默认新建已走 `gw:`（失败回退 `conv-*`）；空会话时输入区仍无引导 | 空会话时在 `ChatPanel` / `MessageInput` 展示快捷 chip（常见问题、技能、附件等），可配置 |
| W7 | 设置页交互补全 | 见下文「设置页分项审计」；`docs/TODO.md` 已列多页「对齐源项目」 | 按模块分批：先高频（chats/channels/skills/memory），再 monitoring/automation/management |
| W8 | 侧栏「定时任务」入口 | **已做**：`router.push('/settings/automation/cron')` | 进阶（可选）：弹出与 Cron 设置联动的 Sheet |

---

## 附录 A：`docs/TODO.md` 中尚未并入上表工作项的条目

以下已在 [`docs/TODO.md`](../TODO.md)「待完成」中列出，上次计划表未逐条展开，此处单独备忘：

| 类别 | 内容 |
|------|------|
| 体验 | **任务评论**：键盘选择 `@mention`、快捷发送等收尾（任务看板相关）。 |
| 体验 | **概览页**：自动轮询刷新、可配置布局（可选）。 |
| 体验 | **全应用**：统一 loading / empty / error 文案与行为。 |
| 工程质量 | 清理前端遗留类型问题（历史记录曾提 `EmptyIcon` / `chart.tsx` 等，以当前 `pnpm typecheck` 为准）。 |
| 工程质量 | 完整 smoke 测试清单（关键 API + 关键路径）。 |
| 工程质量 | 回归测试（优先任务流、智能体操作、评论线程）。 |

---

## 附录 B：桌面 / 运行时（非 Web 主路径，按需跟进）

| 位置 | 说明 |
|------|------|
| `apps/desktop/.../wechat-access/.../message-context.ts` | 注释 TODO：微信 `CreateTime` 秒级时间戳与毫秒转换。 |
| `apps/desktop/.../tool-sandbox/index.ts` | macOS 暂不支持降权执行（`lowpriv-exec.sh` 未实现），与 Linux 行为不一致。 |

---

## 二、已知 Bug

| ID | 问题 | 可能原因（代码侧） | 验证建议 |
|----|------|-------------------|----------|
| B1 | Agent 回复与 Agent 图标未对齐 | `message-item.tsx` 助手行使用 `items-start` + 头像 `mt-0.5`；多段内容（思考折叠、工具块）导致**首行文本基线与头像视觉不齐** | 调整助手消息外层为 `items-start` 且头像与**第一条主内容列**顶对齐（或对最终正文单独成块与头像对齐）；各消息类型回归截图 |
| B2 | 侧栏删除会话后刷新又出现 | **已修**：DELETE 失败或网络异常时也会 `addDismissedConversationId`，再 `loadRemote`，合并逻辑继续 `filter dismissed` | 若需从服务端彻底删除，仍应修后端或权限；全页刷新依赖 localStorage dismissed |

---

## 三、设置（Settings）分项审计

以下为侧栏路由（`components/settings/settings-sidebar.tsx`）与实现文件的对应关系及**完成度判断**（以「可操作的完整业务闭环」为准，非仅列表展示）。

### 3.1 概览与业务

| 路由 | 实现文件 | 完成度 | 备注 |
|------|----------|--------|------|
| `/settings` | `app/settings/page.tsx` | **较高** | 仪表盘指标、健康、事件等已较完整（与 `docs/TODO.md`「概览」一致） |
| `/settings/agents` | `app/settings/agents/page.tsx` | **较高** | 使用 `AgentSquadPanelPhase3` |
| `/settings/tasks` | `app/settings/tasks/page.tsx` | **较高** | 任务看板已迁移清单中勾选 |
| `/settings/chats` | `app/settings/chats/page.tsx` | **部分** | 会话列表为主；`TODO.md`：与源项目深度能力仍差（管理细节、工具流等） |
| `/settings/channels` | `app/settings/channels/page.tsx` | **待核对** | `TODO.md`：全量渠道动作与探测待对齐 |
| `/settings/skills` | `app/settings/skills/page.tsx` | **部分** | 已拉 `/api/skills`；`TODO.md`：管理/同步/启停/诊断待加强 |
| `/settings/memory` | `app/settings/memory/page.tsx` | **部分** | 树形浏览；`TODO.md`：graph/检索体验待对齐 |

### 3.2 监控

| 路由 | 实现文件 | 完成度 | 备注 |
|------|----------|--------|------|
| `.../monitoring/activity` | `monitoring/activity/page.tsx` | **中等** | 拉取活动列表 |
| `.../monitoring/logs` | `monitoring/logs/page.tsx` | **待核对** | 需确认与统一日志检索、过滤是否达标 |
| `.../monitoring/costs` | `monitoring/costs/page.tsx` | **待核对** | |
| `.../monitoring/nodes` | `monitoring/nodes/page.tsx` | **待核对** | |
| `.../monitoring/approval` | `monitoring/approval/page.tsx` | **待核对** | |
| `.../monitoring/office` | `monitoring/office/page.tsx` | **中等** | `workload` API |
| `.../monitoring/monitor` | `monitoring/monitor/page.tsx` | **待核对** | |

### 3.3 自动化

| 路由 | 完成度 | 备注 |
|------|--------|------|
| `automation/cron`、`webhooks`、`alerts`、`github` | **待核对** | `TODO.md`：交互细节核对补齐 |

### 3.4 管理

| 路由 | 实现文件 | 完成度 | 备注 |
|------|----------|--------|------|
| `/settings/management/settings` | `management/settings/page.tsx` | **较高** | 系统键值对读写，依赖 `/api/settings`（管理员） |
| `management/security` | `management/security/page.tsx` | **中等** | 安全审计摘要 |
| `management/users` | `management/users/page.tsx` | **待核对** | |
| `management/audit` | `management/audit/page.tsx` | **待核对** | |
| `management/gateway` | `management/gateway/page.tsx` | **待核对** | |
| `management/integrations` | `management/integrations/page.tsx` | **中等** | 集成列表与状态 |
| `management/models` | `management/models/page.tsx` | **待核对** | |
| `management/debug` | `management/debug/page.tsx` | **待核对** | |

### 3.5 设置页通用缺口（体验）

- **统一空态/错误/加载**：`docs/TODO.md` 已列「统一 loading / empty / error」。
- **权限提示**：多页依赖管理员接口，需一致化处理 401/403 与引导登录。
- **模板组件**：存在 `SettingsPageTemplate`（默认「功能开发中」），当前各路由多为独立实现；后续新增子页时可复用以避免半完成页混入生产。

---

## 四、建议执行顺序（迭代）

1. **B2 + W1**：删除会话与反馈涉及数据一致性，影响信任度，优先修。
2. **W5 + W8 + W4**：侧栏 MCP / 定时任务无响应与 Studio 入口缺失均为「显性残缺」，适合同一 UX 批次（W8 可先只做跳转 Cron 页）。
3. **B1**：纯 UI，可与聊天体验小版本一起发布。
4. **W2 + W3**：Studio 迁移与接口复用需架构拍板，单独里程碑。
5. **W6**：产品增强，依赖 W1/W5 稳定后的主聊天区。
6. **W7**：按 `docs/TODO.md` 模块滚动推进，与本表第三节对照勾选。

---

## 五、相关代码位置（便于跳转）

| 主题 | 路径 |
|------|------|
| 消息气泡与点赞 | `apps/web/components/chat/message-item.tsx` |
| 会话列表合并与删除 | `apps/web/components/chat/chat-sidebar.tsx`，`apps/web/lib/chat-dismissed-conversations.ts` |
| Studio 嵌入 | `apps/web/components/studio/studio-panel.tsx`，`apps/web/lib/studio/runtime.ts` |
| 侧栏快捷入口（MCP / 定时任务） | `chat-sidebar.tsx`：定时任务已跳转 Cron；MCP 仍占位（W5） |
| 新建 Gateway 会话 | `app/api/chat/sessions/route.ts`（`sessions.patch`） |
| 设置侧栏菜单 | `apps/web/components/settings/settings-sidebar.tsx` |
| 迁移总清单 | `docs/TODO.md` |

---

*文档随迭代更新；完成项请同步勾选 `docs/TODO.md` 与本表对应行。*
