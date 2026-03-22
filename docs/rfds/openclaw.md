# OpenClaw 内置并存方案（xclaw）

## 背景

目标是在 `xclaw` 中内置一个受桌面应用管理的 OpenClaw 实例，同时保留用户已有的外部 OpenClaw 实例（通常位于 `~/.openclaw`）。
两者必须可并存运行，互不影响。

## 目标

- `xclaw` 启动即具备可用网关，无需用户手动配置。
- `xclaw` 内置 OpenClaw 与外部 OpenClaw 实例并存。
- `xclaw` 默认连接内置实例。
- 内置实例使用独立状态目录与固定网关端口。
- 一些技能（skills）与扩展（extensions/plugins）随 app 内置发布。

## 非目标

- 不替换、迁移、覆盖用户已有 `~/.openclaw` 数据。
- 不强制合并外部实例配置到内置实例。
- 不自动修改外部 OpenClaw 的配置。

## 为什么采用“壳层包 + openclaw 内核”

参考 xclaw 的做法，运行时目录本质是一个“宿主壳层包”依赖具体版本的 `openclaw`，而不是直接依赖用户机器上的全局 `openclaw`。这样做的核心收益：

- 版本可控：固定 `openclaw` 版本，构建与运行结果可复现。
- 资源同包：`config/openclaw.json`、`config/skills`、`config/extensions` 可与内核一起发布。
- 路径稳定：启动时总能定位到 app 内置入口（如 `openclaw.mjs`），不依赖用户 PATH。
- 升级可控：可以按版本策略更新内核，避免“用户环境差异”引发问题。

## 参考实现（xclaw）

本方案可直接参考 xclaw 的双目录结构：

- App 内置只读资源目录：`/Applications/xclaw.app/Contents/Resources/openclaw`
  - 典型内容：`node_modules/openclaw`、`config/openclaw.json`、`config/skills/**`、`config/extensions/**`
  - 作用：提供固定版本内核与内置资源，随应用发布。
- 用户可写状态目录：`~/.qclaw`
  - 典型内容：`openclaw.json`、`workspace/`、`agents/`、`cron/`、`plugins/` 等运行态数据。
  - 作用：承载用户配置与运行数据，升级应用时保持不丢失。

xclaw 的推荐映射关系：

- `resources/openclaw` 对齐 xclaw 的 `/Applications/xclaw.app/Contents/Resources/openclaw`
- `~/.xclaw` 对齐 xclaw 的 `~/.qclaw`

## 关键配置对比（`config/openclaw.json` vs `~/.qclaw/openclaw.json`）

以下两份文件是主要参考：

- 模板文件：`/Applications/xclaw.app/Contents/Resources/openclaw/config/openclaw.json`
- 用户运行态文件：`~/.qclaw/openclaw.json`

### 观察结论

- 两者整体 schema 一致（`agents`、`skills`、`models`、`browser`、`gateway`、`channels`、`plugins`、`session`）。
- 模板文件偏“通用默认值”，运行态文件是“注入本机路径和凭据后的最终生效值”。
- xclaw 实际在首次启动或初始化阶段，将模板字段做了“本机化覆盖”。

### 关键差异（可迁移规则）

1. `agents.defaults.workspace`
   - 模板：`~/.openclaw/workspace`
   - 运行态：`/Users/xizhi/.qclaw/workspace`
   - 启示：启动时应写入绝对路径，避免 `~` 展开差异。

2. `skills.load.extraDirs`
   - 模板：空数组
   - 运行态：包含 app 内置 skills + 用户 skills 目录
   - 启示：内置目录与用户目录分层加载，不把所有技能硬编码在模板内。

3. `plugins.load.paths`
   - 模板：空数组
   - 运行态：指向 app 内置 `config/extensions`
   - 启示：插件扩展目录应在运行时注入，保证跨平台路径正确。

4. `gateway.port` 与 `gateway.auth.token`
   - 模板：端口默认值 + 空 token
   - 运行态：实际端口（xclaw 为 `28789`）+ 已生成 token
   - 启示：端口和 token 必须在用户态配置中落盘，且 token 不应放在只读模板里。

5. `gateway.controlUi.allowedOrigins`
   - 模板：最小集合（如 `null`）
   - 运行态：增加 `file://` 等桌面端 origin
   - 启示：需按桌面加载方式追加 origin，避免控制台被 CORS 限制。

6. `channels` 与 `plugins.entries`
   - 模板：包含较多可选通道与插件项（多数关闭）
   - 运行态：收敛为当前产品启用集（例如只启用必要项）
   - 启示：运行态配置可以裁剪，避免未使用插件带来复杂度与风险。

### xclaw 推荐落地规则

将 `resources/openclaw/config/openclaw.json` 视为“种子模板”，在首次运行生成 `~/.xclaw/openclaw.json` 时执行以下覆盖：

- 路径类字段改为 `~/.xclaw` 对应绝对路径：
  - `agents.defaults.workspace`
  - `skills.load.extraDirs`（加入 `resources/openclaw/config/skills`、`~/.xclaw/skills`、`~/.xclaw/workspace/skills`）
  - `plugins.load.paths`（加入 `resources/openclaw/config/extensions`）
- 网关类字段写入运行态：
  - `gateway.port = 20064`
  - `gateway.auth.token = <首次生成>`
  - `gateway.bind = loopback`
- UI 访问控制按桌面场景补齐：
  - `gateway.controlUi.allowedOrigins` 至少含 `null` 与 `file://`
- 渠道和插件按 xclaw 产品能力集收敛，不盲目照搬全部预置项。

后续升级遵循“模板补丁 + 最小合并”：

- 新增字段可从模板补入；
- 用户已修改字段不覆盖；
- 凭据（token、secret）始终以用户态文件为准。

## 运行时元信息文件模式（`qclaw.json` 参考）

除 `openclaw.json`（业务配置）外，xclaw 还使用了一个轻量“运行时元信息文件”：

- 参考文件：`~/.qclaw/qclaw.json`
- 典型字段：`cli.nodeBinary`、`cli.openclawMjs`、`cli.pid`、`stateDir`、`configPath`、`port`、`platform`

该文件的设计目的不是承载完整业务配置，而是作为“进程管理与诊断的路由索引”：

- 告诉宿主进程当前应启动哪个入口（`nodeBinary + openclawMjs`）
- 告诉外部工具当前实例使用的状态目录与配置路径（`stateDir + configPath`）
- 暴露当前运行事实（`pid + port + platform`），便于 health/doctor/status 使用

### 设计边界

- `openclaw.json`：业务配置源（模型、网关认证策略、skills/plugins/channels 等）
- 元信息文件：运行态索引（入口路径、PID、端口、路径定位）

两者分离的好处：

- 降低配置文件职责耦合，避免把“瞬时运行态”写进业务配置
- 提升诊断与运维可观测性（无需解析大量业务配置即可定位进程）
- 升级和回滚更安全（元信息损坏可重建，不影响核心业务配置）

### xclaw 建议

xclaw 可引入等价文件（建议命名：`~/.xclaw/xclaw.json`），用于记录：

- `cli.nodeBinary`
- `cli.openclawEntry`（如 `resources/openclaw/node_modules/openclaw/openclaw.mjs`）
- `pid`
- `stateDir`（`~/.xclaw`）
- `configPath`（`~/.xclaw/openclaw.json`）
- `port`（固定 `20064`）
- `platform`

维护策略建议：

- 启动成功后写入/刷新；
- 退出时清理或标记过期 PID；
- 每次读取前校验 PID 是否仍存活，避免“陈旧元信息”误导诊断。

### 内置 Node 版本要求

内置 OpenClaw 运行时要求 Node.js `>=22.16.0`。xclaw 启动内置网关时应按以下优先级选择 Node：

1. `OPENCLAW_NODE_BIN`（显式指定，推荐）
2. `XCLAW_OPENCLAW_NODE_BIN`（兼容别名）
3. app 内置 Node（建议路径：`resources/openclaw/node_modules/node/bin/node`，Windows 为 `node.exe`）
4. 系统 `node`

若未找到满足版本要求的 Node，必须明确报错并跳过网关启动，不应以低版本 Node 强行启动。

## 备选方案与取舍

- 方案 A：依赖用户全局 `openclaw`
  - 优点：接入快。
  - 缺点：用户未安装、版本漂移、PATH 差异会直接影响稳定性。
- 方案 B：仅内置二进制或脚本，不做壳层工程
  - 优点：表面结构简单。
  - 缺点：版本追踪、依赖管理、资源组织会逐步失控。
- 方案 C：壳层包依赖 `openclaw`（本方案）
  - 优点：工程可维护性最佳，适合桌面产品长期演进。

## 总体方案

采用“双实例隔离”策略：

- 外部实例（用户已有）
  - 状态目录：`~/.openclaw`
  - 端口：用户现有配置（以用户本地配置为准）
  - 生命周期：由用户自行管理

- xclaw 内置实例（新增）
  - 状态目录：`~/.xclaw`
  - 配置文件：`~/.xclaw/openclaw.json`
  - 网关端口：`20064`（固定）
  - 生命周期：由 `xclaw` desktop 主进程管理（启动、停止、健康检测）

## 目录与资源布局

### 运行时用户目录（可写）

- `~/.xclaw/openclaw.json`
- `~/.xclaw/workspace/`
- `~/.xclaw/skills/`（用户自定义，可选）
- `~/.xclaw/logs/`
- `~/.xclaw/agents/`
- `~/.xclaw/cron/`

### App 内置资源目录（只读）

打包到 `XClaw.app/Contents/Resources/openclaw`（平台等价路径）：

- `config/openclaw.json`（模板）
- `config/skills/**`（内置 skills）
- `config/extensions/**`（内置 extensions/plugins）
- OpenClaw 运行入口与依赖（按平台打包）

## 配置策略

通过“子进程级环境变量注入”确保仅影响内置实例（不写入用户全局环境）：

- 仅在 `xclaw` desktop 主进程拉起的子进程中注入 `OPENCLAW_*`。
- 不写入 `~/.zshrc`、`~/.bashrc` 等 shell 配置文件。
- 不使用系统级全局环境设置（如 `launchctl setenv`）。
- 外部 `~/.openclaw` 实例继续使用其原有环境，不受影响。

子进程注入值：

- `OPENCLAW_STATE_DIR=~/.xclaw`
- `OPENCLAW_CONFIG_PATH=~/.xclaw/openclaw.json`
- `OPENCLAW_GATEWAY_HOST=127.0.0.1`
- `OPENCLAW_GATEWAY_PORT=20064`
- `OPENCLAW_BIN=<app内置openclaw入口>`
- `OPENCLAW_MDNS_HOSTNAME=xclaw-20064`（默认，可通过环境变量覆盖）

## xclaw 落地方式（参考 xclaw 结构）

1. 在仓库中维护独立运行时目录（建议命名：`apps/desktop/openclaw-runtime`）。
2. 该目录使用壳层 `package.json` 固定依赖 `openclaw` 版本。
3. 在运行时目录内维护并打包：
   - `config/openclaw.json` 模板
   - `config/skills/**`
   - `config/extensions/**`
4. `electron-builder` 将运行时目录整体打入 `resources/openclaw`。
5. `desktop` 主进程通过 `resources/openclaw` 路径启动内置 OpenClaw。
6. 首次运行将模板复制到 `~/.xclaw/openclaw.json`，写入端口 `20064` 和首次 token。

### openclaw.json 关键字段

- `gateway.port = 20064`
- `gateway.bind = loopback`
- `gateway.auth.mode = token`
- `skills.load.extraDirs` 包含：
  - `<resources>/openclaw/config/skills`
  - `~/.xclaw/skills`
  - `~/.xclaw/workspace/skills`
- `plugins.load.paths` 包含：
  - `<resources>/openclaw/config/extensions`

## 启动流程（desktop 主进程）

1. 解析并确保 `~/.xclaw` 目录存在。
2. 若 `~/.xclaw/openclaw.json` 不存在：
   - 从 app 内置模板复制。
   - 注入首次 token。
   - 强制写入端口 `20064`。
3. 端口探测：
   - 若 `127.0.0.1:20064` 已监听，判定内置网关已可用。
   - 若未监听，拉起内置 OpenClaw 网关进程。
4. 健康检查：
   - 在超时窗口内轮询健康接口或端口。
   - 成功后启动 xclaw web/backend。
5. 关闭流程：
   - app 退出时，优雅停止内置网关子进程。

注意：如果 `20064` 被占用且不是本实例，应显式报错并提示用户处理冲突，不静默改端口，避免固定端口约定失效。

## 网关注册与连接策略

- xclaw 的 gateway 列表中默认主网关为内置实例（`127.0.0.1:20064`）。
- 外部实例可作为 secondary 网关被手动添加或发现。
- UI 默认连接 primary（内置实例），用户可切换到外部实例。

## 打包要求（electron-builder）

`extraResources` 需新增：

- `openclaw/config/openclaw.json`
- `openclaw/config/skills/**`
- `openclaw/config/extensions/**`
- openclaw 运行时文件（mjs/js/node_modules/平台可执行文件）

并确保生产环境路径统一走 `process.resourcesPath` 解析。

## 安全与隔离

- 内置实例 token 独立生成并存储在 `~/.xclaw/openclaw.json`。
- 仅监听 `127.0.0.1`（loopback），避免外网暴露。
- 不读取、不覆写 `~/.openclaw/openclaw.json`。
- 内置与外部实例数据目录完全隔离，避免 skills 和 plugins 互相污染。

## 迁移与兼容

- 现有外部实例用户无感迁移：升级后直接获得内置实例。
- 如用户希望复用外部 skills，可提供“可选导入”能力（默认关闭）。
- 若检测到外部实例正在运行，不做干预。

## 可观测性与诊断

建议在 status/diagnostics 中新增：

- `embeddedOpenClaw.running`
- `embeddedOpenClaw.port`（20064）
- `embeddedOpenClaw.pid`
- `embeddedOpenClaw.configPath`
- `embeddedOpenClaw.stateDir`
- 最近启动错误（端口冲突、配置损坏、资源缺失）

## 风险与对策

- 端口冲突（20064 被占用）
  - 对策：启动前探测，阻断启动并给出明确修复提示。
- 内置资源缺失或路径错误
  - 对策：启动前自检资源完整性并输出诊断信息。
- 配置模板升级兼容性
  - 对策：采用“最小合并”升级策略，不覆盖用户已改字段。

## 验证清单（验收）

1. 外部 OpenClaw（`~/.openclaw`）运行时，xclaw 内置实例仍可在 `20064` 正常启动。
2. `~/.xclaw/openclaw.json` 首次自动创建，且端口为 `20064`。
3. xclaw 默认连接内置实例；可手动切换到外部实例。
4. 内置 skills 与 extensions 可被正常发现与使用。
5. 退出 xclaw 时内置网关进程被回收，不影响外部实例。
6. 升级 xclaw 后，`~/.xclaw` 用户数据保持不丢失。

## 里程碑建议

- M1：目录隔离 + 固定端口 + 内置实例启动
- M2：打包内置 skills/extensions + 发现校验
- M3：网关并存 UI 与诊断增强
- M4：升级策略与回归测试完善
