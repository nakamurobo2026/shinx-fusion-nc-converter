from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from converter.config import load_config, save_config
from converter.transformer import convert


BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"

app = FastAPI(title="SHINX Fusion NC Converter")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


class ConvertRequest(BaseModel):
    text: str
    config: dict[str, Any] | None = None


@app.get("/")
def index() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    return load_config(CONFIG_PATH)


@app.post("/api/config")
def post_config(config: dict[str, Any]) -> dict[str, Any]:
    return save_config(CONFIG_PATH, config)


@app.post("/api/convert")
def post_convert(payload: ConvertRequest) -> dict[str, Any]:
    config = load_config(CONFIG_PATH)
    if payload.config:
        config = save_config(CONFIG_PATH, payload.config)
    return convert(payload.text, config)


@app.post("/api/convert-file")
async def convert_file(file: UploadFile) -> dict[str, Any]:
    data = await file.read()
    text = data.decode("utf-8", errors="replace")
    return convert(text, load_config(CONFIG_PATH))
