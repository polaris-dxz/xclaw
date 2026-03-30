# 源项目 -> XClaw 迁移 TODO

> 目标：把源项目的核心能力完整迁移到 `xclaw`，并保持 `xclaw` 主页面风格不变。

## 使用规则（每次会话必做）

- [ ] 开始实现前，先阅读本文件并同步勾选状态。
- [ ] 每完成一个功能点，立即更新「已完成 / 待完成」。
- [ ] 会话结束前，补一条「本次更新记录」。

---

## 已完成（当前确认）

### 全局与架构
- [x] 迁移策略调整为「功能优先对齐源项目」。
- [x] 主页面保持 `xclaw` 风格（`chat/studio`），不塞入多面板。
- [x] 实时层接入：SSE + WebSocket（任务/智能体/会话等实时更新）。

### Chat
- [x] Chat 状态统一到 `useXClawStore`。
- [x] 对接真实接口：`/api/chat/messages`、`/api/chat/conversations`。
- [x] 消息渲染支持 `thinking` 元信息与流式状态。
- [x] 首页聊天体验增强：会话搜索、`@mention` 智能体补全、附件发送（图片/文件）与消息附件展示。
- [x] 首页聊天链路修复：默认路由到协调智能体并支持 Markdown 渲染（列表/代码块/表格等）。

### Settings - Tasks
- [x] `settings/tasks` 使用完整任务看板（`TaskBoardPanel`）。
- [x] 支持拖拽流转、创建任务、分配、批量状态变更。
- [x] 评论能力：线程回复、@mention 建议、高亮、定位与折叠。

### Settings - Agents
- [x] `settings/agents` 使用完整智能体面板（`AgentSquadPanelPhase3`）。
- [x] 详情标签扩展（overview/tasks/activity/tools/channels/cron/models/soul/memory/files）。
- [x] 编排栏（`OrchestrationBar`）：消息下发、spawn、workflow 模板能力。
- [x] 补齐 channels / cron / diagnostics 的关键交互动作。
- [x] 补齐头部关键运维能力：`Live/Manual` 自动轮询、`同步配置` / `同步本地`、`显示隐藏` 切换、同步反馈 toast。

### Settings - Overview
- [x] 概览页按源项目核心能力补齐：
  - [x] 指标卡（会话/智能体/任务队列/安全/Token/用户等）
  - [x] 运行健康（状态、内存、磁盘、uptime）
  - [x] 网关健康与 Golden Signals（在线性/流量/错误/饱和/延迟）
  - [x] 事件流（最近日志实时视角）
  - [x] 会话工作台
  - [x] 任务流统计
  - [x] 安全审计摘要
  - [x] 维护资产摘要
  - [x] GitHub 与成本摘要
  - [x] 最近活动 + 快捷入口

---

## 待完成（继续补齐）

### 页面级对齐（Settings 其余页面）
- [ ] `settings/chats` 与源项目 chat 页面深度能力对齐（会话管理细节、工具流可视化等）。
- [ ] `settings/channels` 全量能力对齐（更多渠道动作、状态探测与故障处理）。
- [ ] `settings/memory` 对齐 memory graph / 浏览 / 检索体验。
- [ ] `settings/skills` 对齐技能管理、同步、启停与诊断。
- [ ] `settings/monitoring/*` 各监控页面功能核对补齐。
- [ ] `settings/automation/*`（cron/webhook/alerts/github）交互细节核对补齐。
- [ ] `settings/management/*`（security/users/audit/gateway/integrations/debug/settings）逐页核对补齐。

### 体验与一致性
- [ ] 评论输入体验增强（键盘选择 mention、快捷发送等）收尾。
- [ ] 概览支持自动轮询刷新与可配置布局（可选）。
- [ ] 统一 loading / empty / error 态文案和行为。

### 工程质量
- [ ] 清理并修复当前前端遗留类型错误（如 `EmptyIcon` / `chart.tsx` 相关）。
- [ ] 执行完整 smoke 测试清单（关键 API + 关键页面路径）。
- [ ] 补必要的回归测试（优先任务流、智能体操作、评论线程）。

### 远控通道（仅微信客服号卡片临时隐藏）
- [ ] **微信客服号**（`wechat_access` / `wechat-access`）已从「远控通道」Sheet 注释隐藏（腾讯通路未调通）。**企业微信**（`wecom`）正常展示。
- [ ] 恢复微信客服号：编辑 `apps/web/components/remote/remote-channel-sheet.tsx` 中 `PLATFORMS`，取消 `wechat_access` 块注释；回归 `POST /api/remote-channels` 与插件。

---

## 本次更新记录

- 2026-03-23：
  - 远控通道：仅隐藏「微信客服号」卡片；「企业微信」正常展示（见上节 TODO）。

- 2026-03-20：
  - 新建本文件作为迁移总清单。
  - 清理 `docs` 下历史文档，仅保留本 `TODO.md` 用于持续跟踪。
  - 概览页已补齐源项目核心能力版（Settings Overview）。
  - 概览页继续补齐：新增「网关健康与信号」「事件流」两块，并接入 `gateways` / `logs` 实时数据源。
  - 完成旧驼峰命名清理：统一替换为 XClaw 命名。
  - 智能体面板继续补齐：新增同步配置/本地、自动轮询开关、显示隐藏智能体、可关闭错误提示与同步结果反馈。
  - 首页对话区补齐关键交互：会话搜索、`@mention` 选择、附件发送与展示，并补充聊天辅助函数测试。
  - 修复首页消息“无返回”问题：发送目标自动解析（mention > 当前会话 > 选中智能体 > 协调智能体兜底），并切换为 Markdown 渲染。
  - 进一步修复首页对话体验：消除消息重复 key 渲染问题，并为普通会话补充即时状态回包（已接收/投递失败）。

