#!/usr/bin/env bash
# 兼容旧文档/自动化；请优先使用 xclaw-mac.sh 或 PATH 中的 xclaw 命令
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/xclaw-mac.sh" "$@"
