@echo off
setlocal enabledelayedexpansion

REM xclaw CLI (Windows) — 通过 Electron 内嵌 Node 调用应用内 openclaw.mjs（与全局 openclaw 区分）
REM
REM 从 %USERPROFILE%\.xclaw\xclaw.json 读取运行时路径。
REM
REM 用法:
REM   scripts\xclaw-win.cmd <command> [args...]
REM   scripts\xclaw-win.cmd config get gateway.port
REM   scripts\xclaw-win.cmd cron list
REM   scripts\xclaw-win.cmd skills list

set "META_FILE=%USERPROFILE%\.xclaw\xclaw.json"

REM ============================================================
REM 读取 xclaw 元信息
REM ============================================================

if not exist "%META_FILE%" (
  echo [xclaw-cli] 错误: 元信息文件不存在: %META_FILE%
  echo [xclaw-cli] 请先启动 xclaw 桌面应用
  exit /b 1
)

REM 使用 PowerShell 解析 JSON
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content '%META_FILE%' -Raw | ConvertFrom-Json).cli.nodeBinary"`) do set "NODE_BINARY=%%i"
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content '%META_FILE%' -Raw | ConvertFrom-Json).cli.openclawMjs"`) do set "OPENCLAW_MJS=%%i"
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content '%META_FILE%' -Raw | ConvertFrom-Json).stateDir"`) do set "STATE_DIR=%%i"
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content '%META_FILE%' -Raw | ConvertFrom-Json).configPath"`) do set "CONFIG_PATH=%%i"

REM 验证路径有效性
if not exist "%NODE_BINARY%" (
  echo [xclaw-cli] 错误: Node 二进制不存在: %NODE_BINARY%
  echo [xclaw-cli] 请重启 xclaw 应用以更新元信息
  exit /b 1
)

if not exist "%OPENCLAW_MJS%" (
  echo [xclaw-cli] 错误: openclaw.mjs 不存在: %OPENCLAW_MJS%
  echo [xclaw-cli] 请重启 xclaw 应用以更新元信息
  exit /b 1
)

REM ============================================================
REM 环境变量注入
REM ============================================================

set "ELECTRON_RUN_AS_NODE=1"
set "NODE_OPTIONS=--no-warnings"
set "OPENCLAW_NIX_MODE=1"
set "OPENCLAW_STATE_DIR=%STATE_DIR%"
set "OPENCLAW_CONFIG_PATH=%CONFIG_PATH%"

REM ============================================================
REM 执行 openclaw CLI（应用内入口）
REM ============================================================

"%NODE_BINARY%" "%OPENCLAW_MJS%" %*
