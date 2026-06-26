const DEFAULT_CONFIG = {
  machine_origin_x: -1303.52,
  machine_origin_y: -2610.91,
  safe_z: 60.0,
  spindle_speed: 5000,
  plunge_feed: 1500,
  cut_start_depth: 31.0,
  max_cut_depth: 31.0,
  material_size_x: 100.0,
  material_size_y: 100.0,
  material_thickness: 30.0,
  clearance: 30.0,
  stroke: {
    min_x: -3000.0,
    max_x: 3000.0,
    min_y: -3500.0,
    max_y: 500.0,
    min_z: -300.0,
    max_z: 300.0,
  },
  tool_mapping: { 1: 9, 2: 10, 3: 11, 4: 12, 5: 13, 6: 14, 7: 15 },
  faces: {
    1: { name: "加工面1", machine_origin_x: 0.0, machine_origin_y: 0.0 },
    2: { name: "加工面2", machine_origin_x: 0.0, machine_origin_y: 0.0 },
    3: { name: "加工面3", machine_origin_x: 0.0, machine_origin_y: 0.0 },
    4: { name: "加工面4", machine_origin_x: 0.0, machine_origin_y: 0.0 },
    5: { name: "加工面5", machine_origin_x: 0.0, machine_origin_y: 0.0 },
    6: { name: "加工面6", machine_origin_x: 0.0, machine_origin_y: 0.0 },
    7: { name: "加工面7", machine_origin_x: 0.0, machine_origin_y: 0.0 },
    8: { name: "加工面8 左下", machine_origin_x: -1303.52, machine_origin_y: -2610.91 },
  },
};

const fields = [
  "machine_origin_x",
  "machine_origin_y",
  "safe_z",
  "spindle_speed",
  "plunge_feed",
  "cut_start_depth",
  "max_cut_depth",
  "material_size_x",
  "material_size_y",
  "material_thickness",
  "clearance",
];

const allowedG = new Set([0, 1, 2, 3, 17, 18, 19, 40, 41, 42, 90, 91]);
const hazardousM = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 21, 23, 30, 92, 95]);
const $ = (id) => document.getElementById(id);
let currentConfig = loadConfig();
let convertedText = "";

function deepMerge(base, override) {
  const merged = structuredClone(base);
  Object.entries(override || {}).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof merged[key] === "object") {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  });
  return merged;
}

function loadConfig() {
  try {
    return deepMerge(DEFAULT_CONFIG, JSON.parse(localStorage.getItem("shinx_converter_config") || "{}"));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function saveConfig() {
  currentConfig = collectConfig();
  localStorage.setItem("shinx_converter_config", JSON.stringify(currentConfig));
}

function renderConfig() {
  fields.forEach((name) => {
    $(name).value = currentConfig[name] ?? "";
  });
  const faceSelect = $("faceSelect");
  faceSelect.innerHTML = "";
  Object.entries(currentConfig.faces || {}).forEach(([key, face]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = `${key}: ${face.name || "加工面" + key}`;
    faceSelect.appendChild(option);
  });
  faceSelect.value = "8";

  const toolMapping = $("toolMapping");
  toolMapping.innerHTML = "";
  for (let i = 1; i <= 7; i += 1) {
    const row = document.createElement("label");
    row.className = "tool-row";
    row.innerHTML = `<span>T${i}</span><input id="tool_${i}" type="number" step="1" value="${currentConfig.tool_mapping?.[i] ?? ""}" />`;
    toolMapping.appendChild(row);
  }
}

function collectConfig() {
  const cfg = structuredClone(currentConfig || DEFAULT_CONFIG);
  fields.forEach((name) => {
    cfg[name] = Number($(name).value);
  });
  cfg.tool_mapping = {};
  for (let i = 1; i <= 7; i += 1) {
    cfg.tool_mapping[String(i)] = Number($(`tool_${i}`).value);
  }
  return cfg;
}

function stripComments(line) {
  return line.replace(/\([^)]*\)/g, "").replace(/;.*$/g, "").trim();
}

function normalizeLine(line) {
  return stripComments(line)
    .toUpperCase()
    .replace(/^(?:O\d+\s+)?N\d+\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/([A-Z])\s+([-+]?\d)/g, "$1$2")
    .trim();
}

function getWords(line) {
  const found = [];
  const re = /([A-Z])\s*([-+]?\d+(?:\.\d*)?|\.\d+)/gi;
  let match = re.exec(line);
  while (match) {
    found.push([match[1].toUpperCase(), Number(match[2])]);
    match = re.exec(line);
  }
  return found;
}

function parseProgram(text) {
  const cleanLines = [];
  const bodyLines = [];
  const removedLines = [];
  const tools = [];
  const spindleSpeeds = [];
  const ranges = { min_x: null, max_x: null, min_y: null, max_y: null, min_z: null, max_z: null };
  const modal = { distance: null, motion: null };

  text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").forEach((raw) => {
    const clean = normalizeLine(raw);
    if (!clean) return;
    cleanLines.push(clean);
    const lineWords = getWords(clean);

    lineWords.forEach(([letter, value]) => {
      if (letter === "T" && !tools.includes(Math.trunc(value))) tools.push(Math.trunc(value));
      if (letter === "S" && value > 0) spindleSpeeds.push(Math.trunc(value));
    });

    if (lineWords.some(([letter, value]) => letter === "M" && hazardousM.has(Math.trunc(value)))) {
      removedLines.push(clean);
      return;
    }
    if (lineWords.some(([letter, value]) => letter === "G" && !allowedG.has(Math.trunc(value)))) {
      removedLines.push(clean);
      return;
    }

    const kept = [];
    lineWords.forEach(([letter, value]) => {
      if (letter === "G") {
        const code = Math.trunc(value);
        if (!allowedG.has(code)) return;
        kept.push(`G${String(code).padStart(2, "0")}`);
        if ([0, 1, 2, 3].includes(code)) modal.motion = `G${String(code).padStart(2, "0")}`;
        if ([90, 91].includes(code)) modal.distance = `G${code}`;
      } else if (["X", "Y", "Z", "I", "J", "K", "R"].includes(letter)) {
        kept.push(`${letter}${value.toFixed(3)}`);
        const axis = letter.toLowerCase();
        if (!["i", "j", "k", "r"].includes(axis)) {
          const minKey = `min_${axis}`;
          const maxKey = `max_${axis}`;
          ranges[minKey] = ranges[minKey] === null ? value : Math.min(ranges[minKey], value);
          ranges[maxKey] = ranges[maxKey] === null ? value : Math.max(ranges[maxKey], value);
        }
      } else if (letter === "F") {
        kept.push(`F${formatNumber(value)}`);
      } else if (letter === "S") {
        kept.push(`S${Math.trunc(value)}`);
      }
    });

    if (kept.length && kept.some((item) => /^[GXYZRFS]/.test(item))) {
      bodyLines.push(kept.join(" "));
    } else {
      removedLines.push(clean);
    }
  });

  return { cleanLines, bodyLines, removedLines, tools, spindleSpeeds, ranges, modal };
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function fmt(value) {
  return Number(value).toFixed(3);
}

function header(config, shinxTool, spindleSpeed) {
  return [
    "O0000 N000000 M06",
    "O0000 N000001 M95",
    "O0000 N000002 G53",
    "O0000 N000003 G90 G00 Z 0.000",
    "O0000 N000004 M92",
    `O0000 N000005 T${shinxTool}`,
    "O0000 N000006 G65 P9000 L1",
    "O0000 N000007 M23",
    "O0000 N000008 M03",
    `O0000 N000009 S${Math.trunc(spindleSpeed)}`,
    "O0000 N000010 G04 X1.0",
    "",
  ];
}

function originBlock(config) {
  return [
    `O0000 N000012 G90 G00 X${fmt(config.machine_origin_x)} Y${fmt(config.machine_origin_y)}`,
    "O0000 N000013 G92 X 0.000 Y 0.000",
    "O0000 N000014 M21",
    `O0000 N000015 G90 G00 Z ${fmt(config.safe_z)}`,
    `O0000 N000016 G91 G01 Z-${fmt(config.cut_start_depth)} F${Math.trunc(config.plunge_feed)}`,
    "",
  ];
}

function footer(config) {
  return [
    "",
    `O0000 N000015 G90 G00 Z ${fmt(config.safe_z)}`,
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
  ];
}

function validate(parsed, config, outputLines) {
  const warnings = [];
  const cleanText = parsed.cleanLines.join("\n");
  const outputText = outputLines.join("\n");
  const minZ = parsed.ranges.min_z;
  if (minZ !== null && minZ < -Math.abs(config.max_cut_depth)) {
    warnings.push(`Z最小値 ${minZ.toFixed(3)} が最大深さ -${fmt(config.max_cut_depth)} を超えています。`);
  }
  if ((cleanText.match(/M30/g) || []).length > 1) warnings.push("Fusion側コードにM30が複数あります。");
  if (cleanText.includes("G92")) warnings.push("Fusion側コードに既存のG92があります。原点補正の二重適用に注意してください。");
  ["G54", "G55", "G56", "G57", "G58", "G59"].forEach((fixture) => {
    if (cleanText.includes(fixture)) warnings.push(`Fusion側コードに${fixture}が含まれています。SHINX用G92補正と競合する可能性があります。`);
  });
  const firstToolLine = parsed.cleanLines.findIndex((line) => line.includes("T") || line.replaceAll(" ", "").includes("G65P9000"));
  const firstSpindleLine = parsed.cleanLines.findIndex((line) => line.includes("M03") || line.includes("M3"));
  if (firstSpindleLine >= 0 && (firstToolLine < 0 || firstSpindleLine < firstToolLine)) {
    warnings.push("Fusion側コードに工具取得前のM03があります。変換後はSHINXヘッダー側へ移動しています。");
  }
  if (parsed.modal.distance === "G91") warnings.push("入力本文がG91のまま終了している可能性があります。");
  if (!outputText.includes("S0") && !outputText.includes("M05")) warnings.push("主軸停止コードが見つかりません。");
  if (!outputText.includes("G65 P9900")) warnings.push("工具返却 G65 P9900 L1 が見つかりません。");

  const { min_x: minX, max_x: maxX, min_y: minY, max_y: maxY } = parsed.ranges;
  if (minX !== null && maxX !== null && (minX < -config.clearance || maxX > config.material_size_x + config.clearance)) {
    warnings.push(`X移動範囲 ${minX.toFixed(3)} .. ${maxX.toFixed(3)} が材料X寸法+逃げ幅を超える可能性があります。`);
  }
  if (minY !== null && maxY !== null && (minY < -config.clearance || maxY > config.material_size_y + config.clearance)) {
    warnings.push(`Y移動範囲 ${minY.toFixed(3)} .. ${maxY.toFixed(3)} が材料Y寸法+逃げ幅を超える可能性があります。`);
  }

  const machineMinX = config.machine_origin_x + (minX ?? 0);
  const machineMaxX = config.machine_origin_x + (maxX ?? 0);
  const machineMinY = config.machine_origin_y + (minY ?? 0);
  const machineMaxY = config.machine_origin_y + (maxY ?? 0);
  if (machineMinX < config.stroke.min_x || machineMaxX > config.stroke.max_x) {
    warnings.push(`原点補正後X機械座標 ${machineMinX.toFixed(3)} .. ${machineMaxX.toFixed(3)} が設定ストローク外です。`);
  }
  if (machineMinY < config.stroke.min_y || machineMaxY > config.stroke.max_y) {
    warnings.push(`原点補正後Y機械座標 ${machineMinY.toFixed(3)} .. ${machineMaxY.toFixed(3)} が設定ストローク外です。`);
  }
  return warnings;
}

function convertText(text, config) {
  const parsed = parseProgram(text);
  const fusionTool = parsed.tools[0] || 1;
  const shinxTool = Number(config.tool_mapping[String(fusionTool)] || fusionTool);
  const spindleSpeed = parsed.spindleSpeeds[0] || Number(config.spindle_speed);
  const outputLines = [
    ...header(config, shinxTool, spindleSpeed),
    ...originBlock(config),
    ...parsed.bodyLines.map((line) => `O0000 N000016 ${line}`),
    ...footer(config),
  ];
  const warnings = validate(parsed, config, outputLines);
  if (parsed.tools.length > 1) warnings.push(`MVPは1工具のみ対応です。検出工具 ${parsed.tools.join(", ")} のうち T${fusionTool} を使用しました。`);
  return {
    output: `${outputLines.join("\n")}\n`,
    log: {
      fusion_tool: fusionTool,
      shinx_tool: shinxTool,
      spindle_speed: spindleSpeed,
      machine_origin: { x: config.machine_origin_x, y: config.machine_origin_y },
      ranges: parsed.ranges,
      warnings,
      removed_lines: parsed.removedLines,
      inserted_shinx_codes: ["M06/M95/G53/M92", `T${shinxTool}`, "G65 P9000 L1", "M23/M03/S/G04", "G92 原点補正", "G218/G219", "G65 P9900 L1", "M30"],
      body_line_count: parsed.bodyLines.length,
    },
  };
}

function convert() {
  saveConfig();
  const result = convertText($("inputCode").value, currentConfig);
  convertedText = result.output;
  $("outputCode").value = convertedText;
  $("logOutput").innerHTML = renderLog(result.log);
  $("saveNcBtn").disabled = !convertedText;
  $("saveTxtBtn").disabled = !convertedText;
}

function renderLog(log) {
  const ranges = log.ranges || {};
  const warnings = (log.warnings || []).map((w) => `! ${escapeHtml(w)}`).join("\n") || "なし";
  const removed = (log.removed_lines || []).slice(0, 80).map(escapeHtml).join("\n") || "なし";
  const removedSuffix = (log.removed_lines || []).length > 80 ? `\n...他 ${(log.removed_lines || []).length - 80} 行` : "";
  const inserted = (log.inserted_shinx_codes || []).map((v) => `+ ${escapeHtml(v)}`).join("\n");
  return [
    `使用工具: Fusion T${log.fusion_tool} -> SHINX T${log.shinx_tool}`,
    `主軸回転数: S${log.spindle_speed}`,
    `機械原点: X${log.machine_origin.x} Y${log.machine_origin.y}`,
    `加工範囲: X ${rangeFmt(ranges.min_x)} .. ${rangeFmt(ranges.max_x)} / Y ${rangeFmt(ranges.min_y)} .. ${rangeFmt(ranges.max_y)} / Z ${rangeFmt(ranges.min_z)} .. ${rangeFmt(ranges.max_z)}`,
    `本文行数: ${log.body_line_count}`,
    "",
    "警告:",
    `<span class="warning">${warnings}</span>`,
    "",
    "削除したコード:",
    removed + removedSuffix,
    "",
    "挿入したSHINX固有コード:",
    inserted,
  ].join("\n");
}

function rangeFmt(value) {
  return value === null || value === undefined ? "-" : Number(value).toFixed(3);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch]);
}

function download(ext) {
  const blob = new Blob([convertedText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shinx_converted.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    $("inputCode").value = reader.result;
    convert();
  };
  reader.readAsText(file);
}

$("convertBtn").addEventListener("click", convert);
$("saveNcBtn").addEventListener("click", () => download("nc"));
$("saveTxtBtn").addEventListener("click", () => download("txt"));
$("fileInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) readFile(file);
});
$("faceSelect").addEventListener("change", () => {
  const face = currentConfig.faces?.[$("faceSelect").value];
  if (!face) return;
  $("machine_origin_x").value = face.machine_origin_x;
  $("machine_origin_y").value = face.machine_origin_y;
});

const dropZone = $("dropZone");
["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("drag");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag");
  });
});
dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files?.[0];
  if (file) readFile(file);
});

renderConfig();
