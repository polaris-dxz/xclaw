"""Talk to local OpenClaw Gateway via HTTP OpenAI-compatible Chat Completions.

The Gateway WebSocket protocol requires a full ``connect`` handshake (challenge + device
signature). Star Office uses the HTTP endpoint instead:

  POST http://<host>:<port>/v1/chat/completions

Enable in ``~/.openclaw/openclaw.json``::

  gateway.http.endpoints.chatCompletions.enabled = true

See: https://docs.openclaw.ai/gateway/openai-http-api
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import requests


def _read_gateway_port_from_openclaw_json() -> int:
    port = int((os.environ.get("OPENCLAW_GATEWAY_PORT") or "20064").strip() or "20064")
    config_path = (
        (os.environ.get("OPENCLAW_CONFIG_PATH") or "").strip()
        or str(Path((os.environ.get("OPENCLAW_STATE_DIR") or str(Path.home() / ".xclaw")).strip()) / "openclaw.json")
    )
    if not os.path.isfile(config_path):
        return port
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        gw = cfg.get("gateway") or {}
        if isinstance(gw, dict) and gw.get("port") is not None:
            port = int(gw["port"])
    except Exception:
        pass
    return port


def get_gateway_http_base() -> str:
    """Base URL without trailing slash, e.g. http://127.0.0.1:20064"""
    env = (os.environ.get("OPENCLAW_GATEWAY_HTTP_BASE") or "").strip().rstrip("/")
    if env:
        return env
    host = (os.environ.get("OPENCLAW_GATEWAY_HOST") or "127.0.0.1").strip()
    port = _read_gateway_port_from_openclaw_json()
    return f"http://{host}:{port}"


def get_gateway_ws_url() -> str:
    """Kept for diagnostics / docs; chat no longer uses WebSocket."""
    host = (os.environ.get("OPENCLAW_GATEWAY_HOST") or "127.0.0.1").strip()
    port = _read_gateway_port_from_openclaw_json()
    from urllib.parse import quote

    url = f"ws://{host}:{port}"
    token = (os.environ.get("OPENCLAW_GATEWAY_TOKEN") or "").strip()
    if token:
        url = f"{url}?token={quote(token, safe='')}"
    return url


def _get_gateway_bearer_token() -> str | None:
    """Prefer env; else read token/password from local openclaw.json (same machine only)."""
    t = (os.environ.get("OPENCLAW_GATEWAY_TOKEN") or "").strip()
    if t:
        return t
    p = (os.environ.get("OPENCLAW_GATEWAY_PASSWORD") or "").strip()
    if p:
        return p
    config_path = (
        (os.environ.get("OPENCLAW_CONFIG_PATH") or "").strip()
        or str(Path((os.environ.get("OPENCLAW_STATE_DIR") or str(Path.home() / ".xclaw")).strip()) / "openclaw.json")
    )
    if not os.path.isfile(config_path):
        return None
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        auth = (cfg.get("gateway") or {}).get("auth") or {}
        if not isinstance(auth, dict):
            return None
        mode = str(auth.get("mode") or "").strip().lower()
        if mode == "token" and auth.get("token"):
            return str(auth["token"]).strip()
        if mode == "password" and auth.get("password"):
            return str(auth["password"]).strip()
    except Exception:
        pass
    return None


def _default_agent_id() -> str:
    env = (os.environ.get("OPENCLAW_CHAT_AGENT_ID") or "").strip()
    if env:
        return env
    config_path = (
        (os.environ.get("OPENCLAW_CONFIG_PATH") or "").strip()
        or str(Path((os.environ.get("OPENCLAW_STATE_DIR") or str(Path.home() / ".xclaw")).strip()) / "openclaw.json")
    )
    if not os.path.isfile(config_path):
        return "main"
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        lst = (cfg.get("agents") or {}).get("list")
        if isinstance(lst, list) and lst and isinstance(lst[0], dict):
            aid = lst[0].get("id")
            if aid:
                return str(aid).strip()
    except Exception:
        pass
    return "main"


def _read_model_from_config(config_path: str) -> str | None:
    if not config_path or not os.path.isfile(config_path):
        return None
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        model = ((cfg.get("agents") or {}).get("defaults") or {}).get("model") or {}
        if isinstance(model, dict):
            primary = str(model.get("primary") or "").strip()
            if primary:
                return primary
    except Exception:
        pass
    return None


def _default_chat_model() -> str:
    env = (os.environ.get("OPENCLAW_CHAT_MODEL") or "").strip()
    if env:
        return env

    embedded_cfg = (
        (os.environ.get("OPENCLAW_CONFIG_PATH") or "").strip()
        or str(Path((os.environ.get("OPENCLAW_STATE_DIR") or str(Path.home() / ".xclaw")).strip()) / "openclaw.json")
    )
    # If custom provider is configured in embedded config, prefer embedded model first.
    try:
        if os.path.isfile(embedded_cfg):
            with open(embedded_cfg, "r", encoding="utf-8") as f:
                embedded_raw = json.load(f)
            custom_enabled = bool(
                ((embedded_raw.get("models") or {}).get("providers") or {}).get("xclaw-custom")
            )
            embedded_model = _read_model_from_config(embedded_cfg)
            if custom_enabled and embedded_model:
                return embedded_model
    except Exception:
        pass

    # Phase-1 compatibility: default to user's existing ~/.openclaw model config.
    external_cfg = str(Path.home() / ".openclaw" / "openclaw.json")
    external_model = _read_model_from_config(external_cfg)
    if external_model:
        return external_model

    embedded_model = _read_model_from_config(embedded_cfg)
    if embedded_model:
        return embedded_model

    return "openclaw"


def _agent_auth_profiles_path(agent_id: str) -> Path:
    state_dir = Path((os.environ.get("OPENCLAW_STATE_DIR") or str(Path.home() / ".xclaw")).strip())
    return state_dir / "agents" / agent_id / "agent" / "auth-profiles.json"


def send_chat_message(text: str, timeout: float = 180.0) -> dict:
    """
    Returns:
      {"ok": bool, "reply": str | None, "error": str | None}
    """
    text = (text or "").strip()
    if not text:
        return {"ok": False, "reply": None, "error": "消息为空"}

    base = get_gateway_http_base()
    url = f"{base}/v1/chat/completions"
    token = _get_gateway_bearer_token()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    agent_id = _default_agent_id()
    headers["x-openclaw-agent-id"] = agent_id

    # 同一 user 字符串会复用会话（网关文档）；办公室页可视为一个稳定客户端
    user_id = (os.environ.get("OPENCLAW_CHAT_USER_ID") or "star-office-web").strip()

    model = _default_chat_model()
    body = {
        "model": model,
        "messages": [{"role": "user", "content": text}],
        "stream": False,
        "user": user_id,
    }

    try:
        r = requests.post(url, headers=headers, json=body, timeout=timeout)
    except requests.RequestException as e:
        return {
            "ok": False,
            "reply": None,
            "error": f"无法连接网关 {base}: {e}",
        }

    if r.status_code == 404:
        return {
            "ok": False,
            "reply": None,
            "error": (
                "网关未开放 Chat Completions（HTTP 404）。请在 ~/.openclaw/openclaw.json 中加入并重启网关：\n"
                "（xclaw 内置实例默认在 ~/.xclaw/openclaw.json）\n"
                '  "gateway": { "http": { "endpoints": { "chatCompletions": { "enabled": true } } } }\n'
                "说明见 https://docs.openclaw.ai/gateway/openai-http-api"
            ),
        }

    if r.status_code == 401:
        return {
            "ok": False,
            "reply": None,
            "error": "网关认证失败（401）。请设置环境变量 OPENCLAW_GATEWAY_TOKEN，或与 openclaw.json 里 gateway.auth 一致。",
        }

    if r.status_code != 200:
        msg = None
        try:
            err = r.json()
            if isinstance(err.get("error"), dict):
                msg = err["error"].get("message")
            else:
                msg = err.get("message") or err.get("error")
        except Exception:
            pass
        tail = (r.text or "")[:400]
        if r.status_code == 500 and (msg or "").strip().lower() == "internal error":
            auth_profiles = _agent_auth_profiles_path(agent_id)
            if not auth_profiles.is_file():
                return {
                    "ok": False,
                    "reply": None,
                    "error": (
                        "网关返回 500（internal error），根因通常是未配置模型提供商密钥。"
                        f"当前 agent 的认证文件不存在：{auth_profiles}。"
                        "请先为该 agent 配置 provider key（例如 Anthropic/OpenAI），再重试。"
                    ),
                }
            return {
                "ok": False,
                "reply": None,
                "error": (
                    "网关返回 500（internal error），通常是模型鉴权失败。"
                    f"请检查 {auth_profiles} 中是否存在当前模型对应 provider 的 API key。"
                ),
            }
        return {
            "ok": False,
            "reply": None,
            "error": f"网关 HTTP {r.status_code}: {msg or tail}",
        }

    try:
        data = r.json()
    except Exception:
        return {"ok": False, "reply": None, "error": "网关返回体不是合法 JSON"}

    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return {"ok": False, "reply": None, "error": "网关返回缺少 choices"}

    first = choices[0] if isinstance(choices[0], dict) else {}
    message = first.get("message") if isinstance(first.get("message"), dict) else {}
    content = message.get("content")
    if content is None:
        content = ""
    return {"ok": True, "reply": str(content), "error": None}
