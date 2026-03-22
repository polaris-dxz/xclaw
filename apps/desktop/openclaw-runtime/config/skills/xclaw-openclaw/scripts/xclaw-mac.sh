#!/usr/bin/env bash
set -euo pipefail

# xclaw CLI — 通过 Electron 内置 Node 调用应用内 openclaw.mjs（与全局 openclaw 命令区分）
#
# 从 ~/.xclaw/xclaw.json 读取运行时路径。
#
# 用法:
#   bash scripts/xclaw-mac.sh <command> [args...]
#   bash scripts/xclaw-mac.sh config get gateway.port
#   bash scripts/xclaw-mac.sh cron list
#   bash scripts/xclaw-mac.sh skills list
#
# 安装为终端命令 xclaw（推荐）: 见同目录下无后缀文件 `xclaw` 或 SKILL.md。

PREFIX="[xclaw-cli]"
META_FILE="${HOME}/.xclaw/xclaw.json"

# ============================================================
# 读取 xclaw 元信息
# ============================================================

if [ ! -f "${META_FILE}" ]; then
  echo "${PREFIX} 错误: 元信息文件不存在: ${META_FILE}"
  echo "${PREFIX} 请先启动 xclaw 桌面应用"
  exit 1
fi

# 使用 python3 解析 JSON（macOS 自带）
NODE_BINARY=$(python3 -c "import sys,json; print(json.load(sys.stdin)['cli']['nodeBinary'])" < "${META_FILE}")
OPENCLAW_MJS=$(python3 -c "import sys,json; print(json.load(sys.stdin)['cli']['openclawMjs'])" < "${META_FILE}")
STATE_DIR=$(python3 -c "import sys,json; print(json.load(sys.stdin)['stateDir'])" < "${META_FILE}")
CONFIG_PATH=$(python3 -c "import sys,json; print(json.load(sys.stdin)['configPath'])" < "${META_FILE}")

# 验证路径有效性
if [ ! -f "${NODE_BINARY}" ]; then
  echo "${PREFIX} 错误: Node 二进制不存在: ${NODE_BINARY}"
  echo "${PREFIX} 请重启 xclaw 应用以更新元信息"
  exit 1
fi

if [ ! -f "${OPENCLAW_MJS}" ]; then
  echo "${PREFIX} 错误: openclaw.mjs 不存在: ${OPENCLAW_MJS}"
  echo "${PREFIX} 请重启 xclaw 应用以更新元信息"
  exit 1
fi

# ============================================================
# 环境变量注入
# ============================================================

export ELECTRON_RUN_AS_NODE=1
export NODE_OPTIONS="--no-warnings"
export OPENCLAW_NIX_MODE=1
export OPENCLAW_STATE_DIR="${STATE_DIR}"
export OPENCLAW_CONFIG_PATH="${CONFIG_PATH}"

# ============================================================
# 执行 openclaw CLI（应用内入口）
# ============================================================

# 过滤 Electron 内部 ELECTRON_RUN_AS_NODE 模式下的无害告警
exec "${NODE_BINARY}" "${OPENCLAW_MJS}" "$@" 2> >(grep -v 'node_main.cc' >&2)
