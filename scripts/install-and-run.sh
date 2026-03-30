#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
PYPROJECT_DIR="${ROOT_DIR}/apps/studio-api/apps/api"

USER_EXT_DIR="${HOME}/.xclaw/extensions"
DISABLED_EXT_DIR="${HOME}/.xclaw/extensions.__disabled"

log() {
  printf '\033[1;34m[install-run]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[install-run]\033[0m %s\n' "$*" >&2
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

log "检查依赖工具 (uv / node / pnpm)"
ensure_cmd uv "可参考: https://docs.astral.sh/uv/getting-started/installation/"
ensure_cmd node "请先安装 Node.js (建议 >= 20)"
ensure_cmd pnpm "可执行: corepack enable && corepack prepare pnpm@latest --activate"

log "进入项目根目录: ${ROOT_DIR}"
cd "${ROOT_DIR}"

if [[ ! -f "${ROOT_DIR}/pnpm-lock.yaml" ]]; then
  fail "未找到 pnpm-lock.yaml，当前目录看起来不是 xclaw 项目根目录。"
fi

log "安装前端依赖 (pnpm install)"
pnpm install

log "创建 Python 虚拟环境: ${VENV_DIR}"
uv venv "${VENV_DIR}"

log "安装 Python 依赖 (uv pip install -e)"
uv pip install --python "${VENV_DIR}/bin/python" -e "${PYPROJECT_DIR}"

restore_disabled_extensions_if_needed() {
  # Earlier versions of this script temporarily moved ~/.xclaw/extensions/* into
  # ~/.xclaw/extensions.__disabled to avoid duplicate plugin ids. However, in the
  # current desktop embedded flow, ~/.xclaw/extensions is also used as the bundled
  # extensions root. If it is emptied, OpenClaw will report "plugin not found".
  #
  # So we only do a one-time best-effort restore here.
  [[ -d "${DISABLED_EXT_DIR}" ]] || return 0
  [[ -d "${USER_EXT_DIR}" ]] || return 0

  # If extensions dir is empty but disabled dir has plugin folders, restore them.
  local user_count disabled_count
  user_count="$(find "${USER_EXT_DIR}" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
  disabled_count="$(find "${DISABLED_EXT_DIR}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "${user_count}" == "0" && "${disabled_count}" != "0" ]]; then
    log "检测到插件目录被禁用（${DISABLED_EXT_DIR}），正在自动还原到 ${USER_EXT_DIR}"
    for p in "${DISABLED_EXT_DIR}"/*; do
      [[ -d "${p}" ]] || continue
      local id
      id="$(basename "${p}")"
      # skip accidental dot dirs / move logs
      [[ "${id}" == .* ]] && continue
      if [[ -e "${USER_EXT_DIR}/${id}" ]]; then
        mv "${p}" "${USER_EXT_DIR}/${id}.restore-$(date +%s%N)"
      else
        mv "${p}" "${USER_EXT_DIR}/${id}"
      fi
    done
    rm -f "${DISABLED_EXT_DIR}"/.moves-*.txt 2>/dev/null || true
    log "已还原插件目录"
  fi
}

restore_disabled_extensions_if_needed

log "环境准备完成，启动开发环境 (pnpm dev:all)"
pnpm dev:all
