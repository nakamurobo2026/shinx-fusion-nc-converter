from __future__ import annotations


def fmt(value: float) -> str:
    return f"{float(value):.3f}"


def header(config: dict, shinx_tool: int, spindle_speed: int) -> list[str]:
    return [
        "O0000 N000000 M06",
        "O0000 N000001 M95",
        "O0000 N000002 G53",
        "O0000 N000003 G90 G00 Z 0.000",
        "O0000 N000004 M92",
        f"O0000 N000005 T{shinx_tool}",
        "O0000 N000006 G65 P9000 L1",
        "O0000 N000007 M23",
        "O0000 N000008 M03",
        f"O0000 N000009 S{int(spindle_speed)}",
        "O0000 N000010 G04 X1.0",
        "",
    ]


def origin_block(config: dict) -> list[str]:
    return [
        f"O0000 N000012 G90 G00 X{fmt(config['machine_origin_x'])} Y{fmt(config['machine_origin_y'])}",
        "O0000 N000013 G92 X 0.000 Y 0.000",
        "O0000 N000014 M21",
        f"O0000 N000015 G90 G00 Z {fmt(config['safe_z'])}",
        f"O0000 N000016 G91 G01 Z-{fmt(config['cut_start_depth'])} F{int(config['plunge_feed'])}",
        "",
    ]


def footer(config: dict) -> list[str]:
    return [
        "",
        f"O0000 N000015 G90 G00 Z {fmt(config['safe_z'])}",
        "",
        "O0000 N000015 G218",
        "O0000 N000015",
        "O0000 N009508 S0 T100",
        "O0000 N009509 G90 G00 Z 0.000",
        "O0000 N009510 G219",
        "O0000 N009511 G04 X1.0",
        "O0000 N009512 M92 M95",
        "O0000 N009513 G65 P9900 L1",
        "O0000 N009514 G53",
        "O0000 N009515 G90 G00 Y 0.000",
        "O0000 N009516 M30",
    ]
