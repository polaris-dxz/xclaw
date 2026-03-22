# XClaw 会话与 OpenClaw Gateway Session 统一（RFD）

> 状态：**阶段 A 已部分落地**（`POST /api/chat/sessions` + `gw:` 发消息解析）；其余见下文。  
> 关联：`apps/web` 聊天侧栏、`/api/chat/*`、`/api/sessions`、`lib/openclaw-gateway.ts`、`app/api/chat/history-sync`。

## 背景

当前 xclaw 存在两套会话概念并行：

- **本地占位**：`draft-*`、`conv-*` 多为前端或默认服务端生成的 `conversation_id`，新建对话不必经过 Gateway。
- **网关会话**：`history-sync` 与部分链路使用 `gw:${sessionKey}`，与 OpenClaw 磁盘/网关 Session 对齐；删除 `gw:` 会话时会先调用 `sessions.delete`（见 `app/api/sessions/route.ts`），再清理本地库。

这导致：侧栏合并逻辑复杂、ID 迁移边界多、与「一条对话 = 一个 Session」的心智不一致。

## 目标

- **一条侧栏会话 ≡ 一个 Gateway Session**（长期）。
- 本地 SQLite 中 **`conversation_id` 与 UI 统一采用** `gw:${sessionKey}`，与 `history-sync` 已有约定一致（`gw:${session.key}`）。
- **新建 / 删除 / 发消息**均围绕 Session 生命周期；减少 `conv-*` 与 `gw:*` 双轨分支。

## 非目标

- 本文不规定 OpenClaw 网关内部实现细节（仅约定通过 `callOpenClawGateway` 可调用的 RPC 行为）。
- 不要求一次性迁移历史 `conv_*` 数据（可通过阶段策略处理）。

## 术语

| 名词 | 含义 |
|------|------|
| `sessionKey` | Gateway 侧会话主键（与 history-sync 中 `session.key` 一致） |
| `conversation_id` | 统一为 `gw:${sessionKey}` |
| 本地占位 | 仅在「创建 Session 请求未返回」前短暂存在；最终须收敛到 `gw:` |

## 目标架构（逻辑）

```
用户点「新建」
  → `POST /api/chat/sessions` → `sessions.patch`（对新 `agent:main:ui-*` key 写入 session store）
  → 返回 `sessionKey` / `conversation_id`
  → 前端 setActiveConversation(`gw:${sessionKey}`)，侧栏插入一条
  → 首条及后续消息均使用同一 conversation_id

用户发消息
  → POST /api/chat/messages，conversation_id = gw:...
  → forward 时从 id 解析或显式传入 sessionKey，chat.send 使用同一 sessionKey

用户删会话
  → DELETE Gateway sessions.delete（已有）
  → 再删/隐藏本地 messages + hidden_conversations（与现逻辑一致）

列表 / 同步
  → history-sync、GET conversations 以 gw: 为主键合并
```

## Gateway 契约（OpenClaw 2026.3.x 实测）

网关通过 `openclaw gateway call <method>` 调用（见 `lib/openclaw-gateway.ts`）。

1. **创建 Session（等价）**：无独立 `sessions.create`。对**尚未存在**的 canonical `key` 调用 **`sessions.patch`**，参数至少含 `{ "key": "<agent-scoped-key>" }`（其余字段均可选），会在 session store 中新建条目并返回 `key` / `entry`。xclaw 使用 `agent:main:ui-<随机>` 作为新侧栏线程的 main 分支名。
2. **`chat.send`**：仍需已有 `sessionKey`；与 `gw:` 解析后的 key 一致即可。
3. **返回值**：`sessions.patch` 响应含 `key`（canonical）、`entry`、`resolved`（模型解析）等。
4. **删除**：`sessions.delete`（`DELETE /api/sessions`），保持不变。
5. **`sessions.reset`**：`reason: "new"` 时在同一 key 上换新 `sessionId`，**不**用于「侧栏多开并行线程」（多线程 = 多个不同 key）。

**交付物**：方法名与参数以本文 + `app/api/chat/sessions/route.ts` 为准；升级 OpenClaw 后请对照其 `SessionsPatchParamsSchema`。

## 数据与 ID 约定

1. **新写入**的 `messages.conversation_id` 以 `gw:${sessionKey}` 为准。
2. **sessionKey 解析**：复用侧栏思路：`conversation_id.startsWith('gw:')` 时 `slice(3)` 得到 key（见 `chat-sidebar.tsx` 中 `extractSessionKey`）。
3. **去重 / 合并**：保持按会话过滤；全局 store 去重键建议 `(conversation_id, message.id)`，避免跨会话 id 语义混淆。
4. **`hidden_conversations` / dismissed**：仍以 `conversation_id` 字符串为准；统一 `gw:` 后语义更简单。

## Next.js API 层建议

| 能力 | 建议 |
|------|------|
| 创建会话 | 新增 `POST /api/chat/sessions`（或 `POST /api/sessions?action=create`），内部 `callOpenClawGateway(createMethod, params)`，返回 `{ sessionKey, conversation_id: 'gw:' + sessionKey }`。权限与限流可复用 `requireRole('operator')`、`mutationLimiter`。 |
| 发消息 | 现有 `POST /api/chat/messages`：当 `conversation_id` 以 `gw:` 开头时，**优先**从 id 解析 `sessionKey` 用于 `chat.send`。 |
| 删除 | 保持先 `DELETE /api/sessions`（body: `sessionKey`），再 `DELETE /api/chat/conversations`。 |
| 列表 | `GET /api/chat/conversations`、`history-sync` 行为保持，以 `gw:` 对齐。 |

## 前端改造要点

1. **`app/page.tsx` — `handleNewChat`**：不再生成 `conv-${Date.now()}`；改为调用创建 Session API，成功后插入 `id: 'gw:' + sessionKey` 并 `setActiveConversation`；失败则 toast，不保留虚假会话（或仅保留一次性重试策略）。
2. **`chat-sidebar.tsx`**：`createDraftConversation` / `draft-*` 仅作网关失败时的兜底时可保留，**默认路径不依赖**；`isLocallyCreatedConversation` 在迁移期兼容 `conv-*`，最终可删除。
3. **`ChatPanel` / `MessageInput`**：发送时 `conversation_id` 与 `activeConversation` 一致；若曾存在「pending 绑定旧 conv id」，首条发送成功后**迁移**为 `gw:*` 并更新 store。
4. **Store**：`Conversation.id` 仍为 string；约定新数据以 `gw:` 为主。

## 迁移与兼容（分阶段）

**阶段 A（并行）**  
新接口上线；新建走 Session；旧 `conv-*` 仍可打开（后端短期内可继续接受旧 id 或提示迁移）。

**阶段 B（数据，可选）**  
脚本或懒迁移：仅本地存在的 `conv_*` 在用户下次发送时创建 Session 并改写 id（复杂度高，可延后）。

**阶段 C（清理）**  
移除默认 `conv-` 生成、收窄侧栏合并逻辑、删除不再需要的 `draft-` 分支。

## 风险与对策

| 风险 | 对策 |
|------|------|
| Gateway 无 create RPC | 采用首条 `chat.send` 创建或请网关侧补 RPC；在方案中二选一写死。 |
| 创建成功但侧栏未显示 | 创建接口返回后前端必须插入会话；必要时 `loadRemote()` 补拉。 |
| 删除远端失败导致列表「复活」 | 继续 `addDismissedConversationId` + 后端 `hidden_conversations`。 |
| 空 Session 堆积 | 产品策略：超时无消息自动删 Session（依赖网关能力或定时任务）。 |

## 测试清单（最小）

- 新建 → 仅出现 `gw:` → 发消息 → `chat.send` 成功。
- 刷新页面 → 同一会话仍在（DB + history-sync）。
- 删除 → 远端 delete + 本地无消息；同步不再出现（或 dismissed 生效）。
- 网关进程停止 → 新建失败有提示；行为符合产品预期。

## 建议执行顺序（里程碑）

1. 确认 Gateway **创建** RPC 与参数（文档/实测）。
2. 实现创建 Session 的 Next API + 最小手测。
3. 改 `handleNewChat` + 侧栏合并逻辑，停止默认 `conv-`。
4. 收紧 `POST /api/chat/messages` 对 `gw:` 的 `sessionKey` 解析路径。
5. 清理 `conv-`/`draft-` 分支与文档；补测试与回归。

## 参考代码位置

| 模块 | 路径 |
|------|------|
| Gateway 调用封装 | `apps/web/lib/openclaw-gateway.ts` |
| 删除 Session | `apps/web/app/api/sessions/route.ts`（`sessions.delete`） |
| 发消息与 forward | `apps/web/app/api/chat/messages/route.ts` |
| history-sync 与 `gw:` | `apps/web/app/api/chat/history-sync/route.ts` |
| 侧栏删除与会话 id | `apps/web/components/chat/chat-sidebar.tsx` |
| 新建对话（`POST /api/chat/sessions`，失败回退 `conv-`） | `apps/web/app/page.tsx`，`apps/web/app/api/chat/sessions/route.ts` |

---

*修订时请更新本 RFD 顶部状态与「Gateway 契约」一节中的实测方法名。*
