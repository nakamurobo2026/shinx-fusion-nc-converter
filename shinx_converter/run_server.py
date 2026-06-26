from __future__ import annotations

import sys
from pathlib import Path

import uvicorn


BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR.parent / "work"
LOG_DIR.mkdir(exist_ok=True)

sys.stdout = (LOG_DIR / "shinx_converter_server.log").open("a", encoding="utf-8", buffering=1)
sys.stderr = sys.stdout

if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, log_level="info")
