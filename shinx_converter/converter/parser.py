from __future__ import annotations

import re
from dataclasses import dataclass, field


WORD_RE = re.compile(r"([A-Z])\s*([-+]?\d+(?:\.\d*)?|\.\d+)", re.IGNORECASE)
N_PREFIX_RE = re.compile(r"^(?:O\d+\s+)?N\d+\s*", re.IGNORECASE)


@dataclass
class ParsedProgram:
    original_lines: list[str]
    clean_lines: list[str]
    body_lines: list[str]
    removed_lines: list[str]
    tools: list[int]
    spindle_speeds: list[int]
    ranges: dict[str, float | None] = field(default_factory=dict)
    modal: dict[str, str | None] = field(default_factory=dict)


def strip_comments(line: str) -> str:
    line = re.sub(r"\([^)]*\)", "", line)
    line = re.sub(r";.*$", "", line)
    return line.strip()


def normalize_line(line: str) -> str:
    line = strip_comments(line).upper()
    line = N_PREFIX_RE.sub("", line).strip()
    line = re.sub(r"\s+", " ", line)
    line = re.sub(r"([A-Z])\s+([-+]?\d)", r"\1\2", line)
    return line


def words(line: str) -> list[tuple[str, float]]:
    return [(letter.upper(), float(value)) for letter, value in WORD_RE.findall(line)]


def has_word(line: str, letter: str, value: int | None = None) -> bool:
    for found_letter, found_value in words(line):
        if found_letter == letter.upper() and (value is None or int(found_value) == value):
            return True
    return False


def parse_program(text: str) -> ParsedProgram:
    original_lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    clean_lines: list[str] = []
    body_lines: list[str] = []
    removed_lines: list[str] = []
    tools: list[int] = []
    spindle_speeds: list[int] = []
    ranges: dict[str, float | None] = {
        "min_x": None,
        "max_x": None,
        "min_y": None,
        "max_y": None,
        "min_z": None,
        "max_z": None,
    }
    modal = {"distance": None, "motion": None}
    allowed_g = {0, 1, 2, 3, 40, 41, 42, 90, 91}
    allowed_letters = {"G", "X", "Y", "Z", "R", "F", "S"}
    hazardous_m = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 21, 23, 30, 92, 95}

    for raw in original_lines:
        clean = normalize_line(raw)
        if not clean:
            continue
        clean_lines.append(clean)
        line_words = words(clean)

        for letter, value in line_words:
            if letter == "T":
                tool = int(value)
                if tool not in tools:
                    tools.append(tool)
            elif letter == "S":
                speed = int(value)
                if speed > 0:
                    spindle_speeds.append(speed)

        if any(letter == "M" and int(value) in hazardous_m for letter, value in line_words):
            removed_lines.append(clean)
            continue
        if any(letter == "G" and int(value) not in allowed_g for letter, value in line_words):
            removed_lines.append(clean)
            continue

        kept_words: list[str] = []
        for letter, value in line_words:
            if letter not in allowed_letters:
                continue
            if letter == "G" and int(value) not in allowed_g:
                continue
            if letter == "G":
                code = int(value)
                kept_words.append(f"G{code:02d}")
                if code in {0, 1, 2, 3}:
                    modal["motion"] = f"G{code:02d}"
                if code in {90, 91}:
                    modal["distance"] = f"G{code}"
            elif letter in {"X", "Y", "Z", "R"}:
                kept_words.append(f"{letter}{value:.3f}")
                axis_key_min = f"min_{letter.lower()}"
                axis_key_max = f"max_{letter.lower()}"
                if axis_key_min in ranges:
                    ranges[axis_key_min] = value if ranges[axis_key_min] is None else min(ranges[axis_key_min], value)
                    ranges[axis_key_max] = value if ranges[axis_key_max] is None else max(ranges[axis_key_max], value)
            elif letter == "F":
                kept_words.append(f"F{value:g}")
            elif letter == "S":
                kept_words.append(f"S{int(value)}")

        if kept_words and any(item[0] in {"G", "X", "Y", "Z", "R", "F", "S"} for item in kept_words):
            body_lines.append(" ".join(kept_words))
        else:
            removed_lines.append(clean)

    return ParsedProgram(original_lines, clean_lines, body_lines, removed_lines, tools, spindle_speeds, ranges, modal)
