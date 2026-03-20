# nano-banana-pro `generate_image.py`（随仓库分发）

本目录下的 `generate_image.py` 与 OpenClaw skill `nano-banana-pro` 中的脚本一致，用于 Star Office UI 的「AI 生图装修」。

- 依赖由 **apps/api** 的 `requirements.txt` / `pyproject.toml` 提供（`requests`、`pillow`）。
- 后端默认用 **当前运行 Flask 的解释器**（`sys.executable`）执行该脚本，因此 `uv run python app.py` 时无需再配单独 venv。

若需改用本机其他 skill 副本，可设置环境变量 `STAR_OFFICE_GEMINI_SCRIPT` / `STAR_OFFICE_GEMINI_PYTHON`。
