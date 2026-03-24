# 系统级划词浮条与跨端 Sidecar（RFD）

> 状态：**草案** — 供评审与排期；未绑定具体里程碑。  
> 关联：`apps/desktop`（Electron 主进程 / 置顶窗）、OpenClaw 网关与现有 `callOpenClawGateway` 调用链。

## 背景

xclaw 若在 **自家渲染的 Web 页面** 内做「选中即浮条」，可用 DOM `selectionchange` / `getSelection()` 等完成，与本次议题无关。

产品若需要 **在任意第三方 App（浏览器、IDE、Office 等）中选中文本即弹出自有横条**，则：

- Electron **渲染进程无法读取其他进程的选区**；
- 必须在 **操作系统层** 用原生 API 采集「选中文本 / 变化事件 / 尽可能的位置信息」，再通过 **本机 IPC** 交给桌面壳展示 UI 并转发业务（例如走现有网关发 `chat.send`）。

因此引入 **独立、跨端优先的原生 Sidecar 进程**（推荐 **Rust** 单仓多目标构建），与 **Electron 主进程** 协同；**不以 Swift 作为唯一实现**，避免 Windows/Linux 侧重复造轮子（若日后需 Apple 专有优化，可在同协议下增补平台专用模块）。

## 目标

- 提供 **常驻、跨平台（首版至少 macOS + Windows）** 的 **独立二进制** Sidecar，负责：
  - 在权限具备的前提下，**侦测跨应用文本选区变化**（或可靠子集）；
  - 将结构化事件（见下文协议草案）发送至 xclaw 桌面端；
  - **崩溃与权限失败** 与主窗口解耦，可独立重启。
- Electron 主进程负责：
  - 启动/守护 Sidecar（路径随安装包解析）；
  - 根据事件 **定位/显示置顶浮条窗口**（可复用现有「独立 BrowserWindow + alwaysOnTop」思路）；
  - 用户操作后调用 **既有 OpenClaw 网关**（与 Web 侧一致），不新增「第二套」业务协议。
- **协议与日志**：Sidecar 与主进程之间使用 **版本化 JSON 消息**（或等价），便于调试与向后兼容。

## 非目标

- 不承诺 **所有应用** 与 **所有选区形态** 与商业划词工具 100% 一致（系统 API 与各 App 暴露程度不同）。
- 首版不强制 **Linux 桌面** 完整 parity（可在 RFD 中列为后续；架构上预留 `cfg` 分支即可）。
- 不把 **敏感选区默认上传云端** 写进必选路径；隐私策略由产品单独文档规定，本文只要求 **可配置、可审计**。
- 不以 **纯剪贴板轮询 / 全局强制 Cmd+C** 作为唯一主路径（可作为 **显式快捷键兜底**）。

## 术语

| 名词 | 含义 |
|------|------|
| Sidecar | 随安装包发布的 **独立原生进程**（推荐 Rust），负责 OS 层选区侦测与向主进程汇报 |
| 主进程 | Electron `main` 进程：生命周期、窗口、与 Sidecar 的 IPC 服务端或客户端 |
| 浮条 | 无边框、置顶的 **小 BrowserWindow**（或后续可选原生轻量 UI），显示在屏幕坐标处 |
| 选区事件 | Sidecar 发出的「有/无选区、可选文本、可选边界、时间戳、平台元数据」 |

## 约束与平台现实

### macOS

- **辅助功能（Accessibility）**：通过 `AXUIElement` 等读取焦点元素属性（如 `AXSelectedText`、选区范围）；**部分应用不暴露或行为不一致**。
- **输入监控（Input Monitoring）**：若采用 `CGEventTap` / 全局键鼠辅助推断选区变化，需用户授权。
- 需在安装/首次运行流程中 **引导用户打开系统设置**，并提供 **检测授权状态** 的 UX。

### Windows

- **UI Automation（UIA）**：`IUIAutomation` 等获取选区与控件；不同应用支持度不同。
- **WinEvent Hook** 等可用于焦点/窗口变化；具体策略在实现阶段细化，需关注 **权限与杀软误报**。

### 跨端代码组织（Rust）

- **共享**：事件模型、序列化、重连、日志、与主进程的 **线协议**。
- **分平台**：`target_os = "macos"` / `"windows"` 下各自封装系统 API；**禁止**在共享模块里堆砌 `unsafe` 而不分层。

## 目标架构（逻辑）

```
[第三方 App 用户选中文本]
        ↓
[Sidecar：平台层侦测 → 选区事件]
        ↓ 本机 IPC（JSON 行协议或长度前缀帧）
[Electron 主进程：解析事件 / 权限状态]
        ↓
[浮条 BrowserWindow：屏幕坐标定位 + 用户操作]
        ↓
[现有 OpenClaw Gateway：chat.send / sessions 等]
```

- **Web / Next**：继续负责应用内体验；**全局划词**不强制经过 Next SSR，避免把系统权限绑在网页层。
- **网关**：与当前 `lib/openclaw-gateway.ts` 及桌面已连网关方式 **对齐**，浮条仅多一个「触发源」。

## IPC 协议（草案）

以下字段供评审；实现时可增 `v` 版本号与 `capabilities` 握手。

**Sidecar → 主进程（示例）**

```json
{
  "v": 1,
  "type": "selection.changed",
  "ts_ms": 1710000000000,
  "text": "可选，脱敏策略由产品定",
  "has_selection": true,
  "rect": { "screen_id": 0, "x": 0, "y": 0, "w": 0, "h": 0 },
  "source": { "bundle_id": "com.apple.TextEdit", "pid": 12345 },
  "confidence": "high"
}
```

**主进程 → Sidecar（示例）**

```json
{ "v": 1, "type": "config.patch", "enabled": true, "debounce_ms": 120 }
{ "v": 1, "type": "ping" }
```

传输载体优先级（实现时二选一为主，另一种可兼容）：

1. **Unix domain socket（macOS/Linux）** + **命名管道（Windows）**，双向；
2. 或 **localhost 仅回环 TCP** 固定端口 + 令牌认证（需防端口冲突与误连）。

## 与安装包、进程生命周期

- **打包**：`electron-builder`（或当前流水线）将 Sidecar 可执行文件放入 **资源目录**，主进程 **绝对路径** 启动。
- **启动**：主应用启动时拉起 Sidecar；Sidecar 异常退出时 **指数退避重连**（上限与日志规范在实现任务中定）。
- **退出**：主应用退出时 **优雅终止** Sidecar（先断 IPC 再 SIGTERM/等价）。

## 分阶段交付（建议）

| 阶段 | 内容 |
|------|------|
| **P0** | macOS：辅助功能授权检测 + 有限 App（如系统文本类）选区事件；主进程收事件 + **日志/调试面板**；浮条占位 UI |
| **P1** | Windows UIA 路径 + 与 macOS 对齐的协议；安装包集成与 CI 构建矩阵 |
| **P2** | 坐标与多显示器细化、防抖与性能、失败兜底（快捷键触发读剪贴板，**显式同意**） |
| **P3** | Linux（可选）与体验对齐 |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 各 App 选区 API 不一致 | 文档写明支持矩阵；产品预期管理；分阶段扩大覆盖 |
| 权限被拒 | 首次运行引导 + 设置页深链；降级为快捷键/托盘入口 |
| 安全与隐私 | 默认最小上传；敏感字段可本地截断；审计日志 |
| 维护成本 | Rust 单仓分模块；协议版本化；Sidecar 独立版本号 |

## 开放问题（需产品/安全确认）

1. 选中文本是否 **默认** 进入模型上下文，还是需用户 **二次确认**？
2. 企业环境是否允许 **辅助功能 / 输入监控** 类权限（可能影响推广策略）？
3. 浮条 UI 是否必须与 **Web 主题** 一致（影响是否纯原生小窗 vs 复用 `BrowserWindow` 加载本地 HTML）。

## 仓库内实现（已落地骨架）

| 项 | 说明 |
|------|------|
| 源码 | `native/selection-sidecar/`（Rust 二进制 `selection-sidecar`）；构建脚本 `scripts/build-selection-sidecar.cjs`（避免 IDE 注入的 `CARGO_TARGET_DIR` 使产物不在 `target/release/`） |
| 传输 | 监听 `127.0.0.1:0`，首行 stdout 输出 NDJSON `{"v":1,"type":"ready","port":...}`；事件为按行 NDJSON |
| macOS | 轮询 `AXUIElementCreateSystemWide` → `AXFocusedUIElement` → `AXSelectedText`（需辅助功能权限） |
| 其他 OS | 占位：`--mock` 时每 5s 发假 `selection.changed`；无 `--mock` 则空闲 |
| Electron | `apps/desktop/main.js`：`startSelectionSidecar` / `stopSelectionSidecar`；开发态二进制路径为仓库根 `native/selection-sidecar/target/release/` |
| 打包 | `apps/desktop/electron-builder.json` 将 `release` 目录下二进制拷入 `extraResources/selection-sidecar/`；**打包前**需已执行 `pnpm build:selection-sidecar`（或 `node scripts/build-selection-sidecar.cjs`） |
| 环境变量 | `XCLAW_DISABLE_SELECTION_SIDECAR=1` 不启动；`XCLAW_SELECTION_SIDECAR_MOCK=1` 传入 `--mock`（便于无权限环境测 IPC） |

## 参考（仓库内）

- 桌面壳与独立窗口：`apps/desktop` 下主进程与窗口创建逻辑（具体文件以当前树为准）。
- 网关调用：`lib/openclaw-gateway.ts` 与 `callOpenClawGateway` 使用处。

---

**结论**：在 xclaw 现有「Electron + OpenClaw 网关」体系内，**全局划词** 通过 **Rust 跨端 Sidecar + 主进程 IPC + 置顶浮条 + 既有网关** 落地；**Tauri 非必需**，除非团队希望用 Tauri 单独承载浮条 UI（仍须自行实现各 OS 选区逻辑）。
