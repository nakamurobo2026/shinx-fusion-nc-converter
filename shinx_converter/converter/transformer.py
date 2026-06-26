from __future__ import annotations

from .parser import parse_program
from .templates import footer, header, origin_block
from .validator import validate


def convert(text: str, config: dict) -> dict:
    parsed = parse_program(text)
    fusion_tool = parsed.tools[0] if parsed.tools else 1
    tool_mapping = {str(k): int(v) for k, v in config.get("tool_mapping", {}).items()}
    shinx_tool = tool_mapping.get(str(fusion_tool), fusion_tool)
    spindle_speed = parsed.spindle_speeds[0] if parsed.spindle_speeds else int(config["spindle_speed"])

    output_lines = [
        *header(config, shinx_tool, spindle_speed),
        *origin_block(config),
        *[f"O0000 N000016 {line}" for line in parsed.body_lines],
        *footer(config),
    ]
    warnings = validate(parsed, config, output_lines)
    if len(parsed.tools) > 1:
        warnings.append(f"MVPは1工具のみ対応です。検出工具 {parsed.tools} のうち T{fusion_tool} を使用しました。")

    inserted = [
        "M06/M95/G53/M92",
        f"T{shinx_tool}",
        "G65 P9000 L1",
        "M23/M03/S/G04",
        "G92 原点補正",
        "G218/G219",
        "G65 P9900 L1",
        "M30",
    ]
    log = {
        "fusion_tool": fusion_tool,
        "shinx_tool": shinx_tool,
        "spindle_speed": spindle_speed,
        "machine_origin": {"x": config["machine_origin_x"], "y": config["machine_origin_y"]},
        "ranges": parsed.ranges,
        "warnings": warnings,
        "removed_lines": parsed.removed_lines,
        "inserted_shinx_codes": inserted,
        "body_line_count": len(parsed.body_lines),
    }
    return {"output": "\n".join(output_lines) + "\n", "log": log}
