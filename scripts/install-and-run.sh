#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
PYPROJECT_DIR="${ROOT_DIR}/apps/studio-api/apps/api"

# Strategy A: runtime extensions take precedence.
# If the same plugin id exists in ~/.xclaw/extensions, temporarily move it away
# before starting OpenClaw, then restore on exit.
RUNTIME_EXT_DIR="${ROOT_DIR}/apps/desktop/openclaw-runtime/config/extensions"
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

MOVES_FILE=""

cleanup_restore_extensions() {
  # Restore ~/.xclaw/extensions after dev exits.
  if [[ -z "${MOVES_FILE}" || ! -f "${MOVES_FILE}" ]]; then
    return 0
  fi
  if [[ ! -d "${DISABLED_EXT_DIR}" ]]; then
    return 0
  fi

  while IFS='|' read -r dst id; do
    [[ -d "${dst}" ]] || continue
    mkdir -p "${USER_EXT_DIR}"
    local dest="${USER_EXT_DIR}/${id}"
    if [[ -e "${dest}" ]]; then
      dest="${USER_EXT_DIR}/${id}.restore-$(date +%s%N)"
    fi
    mv "${dst}" "${dest}"
  done < "${MOVES_FILE}"

  rm -f "${MOVES_FILE}"
  log "已还原用户插件目录: ${USER_EXT_DIR}"
}

apply_runtime_priority_strategy_a() {
  # Only move plugins that also exist in runtime extensions.
  if [[ ! -d "${RUNTIME_EXT_DIR}" ]]; then
    log "未找到 runtime extensions: ${RUNTIME_EXT_DIR}，跳过策略 A"
    return 0
  fi
  if [[ ! -d "${USER_EXT_DIR}" ]]; then
    log "未找到用户 extensions: ${USER_EXT_DIR}，跳过策略 A"
    return 0
  fi

  mkdir -p "${DISABLED_EXT_DIR}"
  MOVES_FILE="${DISABLED_EXT_DIR}/.moves-$(date +%Y%m%d%H%M%S)-$$.txt"
  : > "${MOVES_FILE}"

  local moved_any=false
  for p in "${RUNTIME_EXT_DIR}"/*; do
    [[ -d "${p}" ]] || continue
    local id
    id="$(basename "${p}")"
    local src="${USER_EXT_DIR}/${id}"
    [[ -d "${src}" ]] || continue

    local dst="${DISABLED_EXT_DIR}/${id}"
    if [[ -e "${dst}" ]]; then
      dst="${DISABLED_EXT_DIR}/${id}.bak-$(date +%s%N)"
    fi

    mv "${src}" "${dst}"
    echo "${dst}|${id}" >> "${MOVES_FILE}"
    moved_any=true
  done

  if [[ "${moved_any}" == "false" ]]; then
    rm -f "${MOVES_FILE}"
    MOVES_FILE=""
    log "策略 A：未检测到需要禁用的重复插件"
  else
    log "策略 A：已禁用重复插件，启动前避免冲突"
  fi
}

log "应用策略 A：runtime extension 优先（避免重复插件 id）"
apply_runtime_priority_strategy_a
trap cleanup_restore_extensions EXIT INT TERM

log "环境准备完成，启动开发环境 (pnpm dev:all)"
pnpm dev:all
