from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any


DEFAULT_CONFIG: dict[str, Any] = {
    "machine_origin_x": -1303.520,
    "machine_origin_y": -2610.910,
    "safe_z": 60.0,
    "approach_z": 5.0,
    "spindle_speed": 5000,
    "plunge_feed": 1500,
    "cut_start_depth": 31.0,
    "max_cut_depth": 31.0,
    "material_size_x": 100.0,
    "material_size_y": 100.0,
    "material_thickness": 30.0,
    "clearance": 30.0,
    "stroke": {
        "min_x": -3000.0,
        "max_x": 3000.0,
        "min_y": -3500.0,
        "max_y": 500.0,
        "min_z": -300.0,
        "max_z": 300.0,
    },
    "tool_mapping": {
        "1": 9,
        "2": 10,
        "3": 11,
        "4": 12,
        "5": 13,
        "6": 14,
        "7": 15,
    },
    "faces": {
        "1": {"name": "加工面1", "machine_origin_x": 0.0, "machine_origin_y": 0.0},
        "2": {"name": "加工面2", "machine_origin_x": 0.0, "machine_origin_y": 0.0},
        "3": {"name": "加工面3", "machine_origin_x": 0.0, "machine_origin_y": 0.0},
        "4": {"name": "加工面4", "machine_origin_x": 0.0, "machine_origin_y": 0.0},
        "5": {"name": "加工面5", "machine_origin_x": 0.0, "machine_origin_y": 0.0},
        "6": {"name": "加工面6", "machine_origin_x": 0.0, "machine_origin_y": 0.0},
        "7": {"name": "加工面7", "machine_origin_x": 0.0, "machine_origin_y": 0.0},
        "8": {"name": "加工面8 左下", "machine_origin_x": -1303.520, "machine_origin_y": -2610.910},
    },
}


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        save_config(path, DEFAULT_CONFIG)
        return deepcopy(DEFAULT_CONFIG)
    data = json.loads(path.read_text(encoding="utf-8"))
    return deep_merge(DEFAULT_CONFIG, data)


def save_config(path: Path, config: dict[str, Any]) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    merged = deep_merge(DEFAULT_CONFIG, config)
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    return merged
