#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="${ROOT_DIR}/apps/desktop"
RUNTIME_DIR="${DESKTOP_DIR}/openclaw-runtime"
RUNTIME_ENTRY="${RUNTIME_DIR}/node_modules/openclaw/openclaw.mjs"

log() {
  printf '\033[1;34m[setup-run]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[setup-run]\033[0m %s\n' "$*" >&2
  exit 1
}

ensure_cmd() {
  local cmd="$1"
  local hint="${2:-}"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    if [[ -n "${hint}" ]]; then
      fail "未找到 ${cmd}。${hint}"
    else
      fail "未找到 ${cmd}，请先安装后重试。"
    fi
  fi
}

log "检查依赖工具 (uv / node / pnpm / npm)"
ensure_cmd uv "https://docs.astral.sh/uv/getting-started/installation/"
ensure_cmd node "请先安装 Node.js (建议 >= 20)"
ensure_cmd pnpm "可执行: corepack enable && corepack prepare pnpm@latest --activate"
ensure_cmd npm

log "检查 desktop runtime 依赖是否已安装"
if [[ ! -f "${RUNTIME_ENTRY}" ]]; then
  log "未找到 runtime entry: ${RUNTIME_ENTRY}"
  cd "${DESKTOP_DIR}"
  log "安装 openclaw-runtime 依赖 (npm run prepare:openclaw-runtime)"
  npm run prepare:openclaw-runtime
  cd "${ROOT_DIR}"
else
  log "runtime 依赖已存在，跳过安装"
fi

log "继续执行 install-and-run.sh（一键安装 Python + 启动）"
exec bash "${ROOT_DIR}/scripts/install-and-run.sh"

