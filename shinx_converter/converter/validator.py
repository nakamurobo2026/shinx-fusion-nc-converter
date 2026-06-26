from __future__ import annotations

from .parser import ParsedProgram


def validate(parsed: ParsedProgram, config: dict, output_lines: list[str]) -> list[str]:
    warnings: list[str] = []
    clean_text = "\n".join(parsed.clean_lines)
    output_text = "\n".join(output_lines)

    min_z = parsed.ranges.get("min_z")
    if min_z is not None and min_z < -abs(float(config["max_cut_depth"])):
        warnings.append(f"Z最小値 {min_z:.3f} が最大深さ -{float(config['max_cut_depth']):.3f} を超えています。")

    if clean_text.count("M30") > 1:
        warnings.append("Fusion側コードにM30が複数あります。")
    if "G92" in clean_text:
        warnings.append("Fusion側コードに既存のG92があります。原点補正の二重適用に注意してください。")
    for fixture in ("G54", "G55", "G56", "G57", "G58", "G59"):
        if fixture in clean_text:
            warnings.append(f"Fusion側コードに{fixture}が含まれています。SHINX用G92補正と競合する可能性があります。")

    first_tool_line = next((i for i, line in enumerate(parsed.clean_lines) if "T" in line or "G65P9000" in line.replace(" ", "")), None)
    first_spindle_line = next((i for i, line in enumerate(parsed.clean_lines) if "M03" in line or "M3" in line), None)
    if first_spindle_line is not None and (first_tool_line is None or first_spindle_line < first_tool_line):
        warnings.append("Fusion側コードに工具取得前のM03があります。変換後はSHINXヘッダー側へ移動しています。")

    if parsed.modal.get("distance") == "G91":
        warnings.append("入力本文がG91のまま終了している可能性があります。")
    if "S0" not in output_text and "M05" not in output_text:
        warnings.append("主軸停止コードが見つかりません。")
    if "G65 P9900" not in output_text:
        warnings.append("工具返却 G65 P9900 L1 が見つかりません。")

    min_x = parsed.ranges.get("min_x")
    max_x = parsed.ranges.get("max_x")
    min_y = parsed.ranges.get("min_y")
    max_y = parsed.ranges.get("max_y")
    if min_x is not None and max_x is not None and (min_x < -float(config["clearance"]) or max_x > float(config["material_size_x"]) + float(config["clearance"])):
        warnings.append(f"X移動範囲 {min_x:.3f} .. {max_x:.3f} が材料X寸法+逃げ幅を超える可能性があります。")
    if min_y is not None and max_y is not None and (min_y < -float(config["clearance"]) or max_y > float(config["material_size_y"]) + float(config["clearance"])):
        warnings.append(f"Y移動範囲 {min_y:.3f} .. {max_y:.3f} が材料Y寸法+逃げ幅を超える可能性があります。")

    stroke = config.get("stroke", {})
    origin_x = float(config["machine_origin_x"])
    origin_y = float(config["machine_origin_y"])
    machine_min_x = origin_x + (min_x or 0)
    machine_max_x = origin_x + (max_x or 0)
    machine_min_y = origin_y + (min_y or 0)
    machine_max_y = origin_y + (max_y or 0)
    if machine_min_x < float(stroke.get("min_x", -999999)) or machine_max_x > float(stroke.get("max_x", 999999)):
        warnings.append(f"原点補正後X機械座標 {machine_min_x:.3f} .. {machine_max_x:.3f} が設定ストローク外です。")
    if machine_min_y < float(stroke.get("min_y", -999999)) or machine_max_y > float(stroke.get("max_y", 999999)):
        warnings.append(f"原点補正後Y機械座標 {machine_min_y:.3f} .. {machine_max_y:.3f} が設定ストローク外です。")

    return warnings
