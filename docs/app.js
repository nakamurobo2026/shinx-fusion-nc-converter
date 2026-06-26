const DEFAULT_CONFIG = {
  materialThickness: 30,
  safeClearance: 20,
  approachClearance: 5,
  allowOvercut: 1,
  materialX: 300,
  materialY: 300,
  machineOriginX: -1303.52,
  machineOriginY: -2610.91,
  machiningFace: 8,
  faces: {
    1: { name: "加工面1", machineOriginX: 0, machineOriginY: 0 },
    2: { name: "加工面2", machineOriginX: 0, machineOriginY: 0 },
    3: { name: "加工面3", machineOriginX: 0, machineOriginY: 0 },
    4: { name: "加工面4", machineOriginX: 0, machineOriginY: 0 },
    5: { name: "加工面5", machineOriginX: 0, machineOriginY: 0 },
    6: { name: "加工面6", machineOriginX: 0, machineOriginY: 0 },
    7: { name: "加工面7", machineOriginX: 0, machineOriginY: 0 },
    8: { name: "加工面8", machineOriginX: -1303.52, machineOriginY: -2610.91 },
  },
};

const STORAGE_KEY = "shinx_nc_viewer_config";
const fields = ["materialThickness", "safeClearance", "approachClearance", "allowOvercut", "materialX", "materialY", "machineOriginX", "machineOriginY"];
const $ = (id) => document.getElementById(id);

let config = loadConfig();
let analysis = null;

function loadConfig() {
  try {
    return { ...structuredClone(DEFAULT_CONFIG), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function saveConfig() {
  config = collectConfig();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function renderConfig() {
  fields.forEach((name) => {
    $(name).value = config[name] ?? "";
  });
  const faceSelect = $("machiningFace");
  faceSelect.innerHTML = "";
  Object.entries(config.faces || DEFAULT_CONFIG.faces).forEach(([key, face]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = `${key}: ${face.name || "加工面" + key}`;
    faceSelect.appendChild(option);
  });
  faceSelect.value = String(config.machiningFace || 8);
  renderZSummary();
}

function collectConfig() {
  const next = { ...config };
  fields.forEach((name) => {
    next[name] = Number($(name).value);
  });
  next.machiningFace = Number($("machiningFace").value);
  return next;
}

function zValues() {
  return {
    materialTopZ: config.materialThickness,
    safeZ: config.materialThickness + config.safeClearance,
    approachZ: config.materialThickness + config.approachClearance,
    materialBottomZ: 0,
    minAllowedZ: -config.allowOvercut,
  };
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toFixed(digits);
}

function cleanLine(line) {
  return line.replace(/\([^)]*\)/g, "").replace(/;.*$/g, "").trim();
}

function wordsFromLine(line) {
  const words = [];
  const re = /([A-Z])\s*([-+]?\d+(?:\.\d*)?|\.\d+)/gi;
  let match = re.exec(line);
  while (match) {
    words.push({ letter: match[1].toUpperCase(), value: Number(match[2]) });
    match = re.exec(line);
  }
  return words;
}

function normalizeMotion(value) {
  return `G${String(Math.trunc(value)).padStart(2, "0")}`;
}

function isMotion(g) {
  return ["G00", "G01", "G02", "G03"].includes(g);
}

function distance(a, b) {
  return Math.hypot((b.x ?? a.x) - a.x, (b.y ?? a.y) - a.y, (b.z ?? a.z) - a.z);
}

function analyzeNc(text, cfg) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const programUsesG92 = lines.some((line) => /G\s*92(?!\d)/i.test(line));
  const rows = [];
  const checks = [];
  const tools = new Map();
  const toolEvents = [];
  const segments = [];
  const zTrace = [];
  const modeHistory = [];
  const state = {
    x: 0,
    y: 0,
    z: 0,
    f: null,
    s: null,
    t: null,
    tool: null,
    motion: null,
    mode: "G90",
    plane: "G17",
    hasG92: false,
    hasM21: false,
    hasP9000: false,
    hasP9900: false,
    hasG218: false,
    hasG219: false,
    hasM92: false,
    hasM95: false,
    spindleOn: false,
    toolLoaded: false,
  };
  const stats = {
    minX: null, maxX: null, minY: null, maxY: null, minZ: null, maxZ: null,
    zDown: 0, zUp: 0, g91ZTotal: 0,
    firstMove: null,
    g92: null,
    estimatedMinutes: 0,
  };

  function addCheck(severity, line, message) {
    checks.push({ severity, line, message });
  }

  function updateRange(pos) {
    stats.minX = stats.minX === null ? pos.x : Math.min(stats.minX, pos.x);
    stats.maxX = stats.maxX === null ? pos.x : Math.max(stats.maxX, pos.x);
    stats.minY = stats.minY === null ? pos.y : Math.min(stats.minY, pos.y);
    stats.maxY = stats.maxY === null ? pos.y : Math.max(stats.maxY, pos.y);
    stats.minZ = stats.minZ === null ? pos.z : Math.min(stats.minZ, pos.z);
    stats.maxZ = stats.maxZ === null ? pos.z : Math.max(stats.maxZ, pos.z);
  }

  function currentTool() {
    const key = state.tool || state.t || "未取得";
    if (!tools.has(key)) {
      tools.set(key, {
        tool: key,
        p9000Line: null,
        p9900Line: null,
        spindle: null,
        minX: null, maxX: null, minY: null, maxY: null, minZ: null, maxZ: null,
        estimatedMinutes: 0,
        warnings: 0,
      });
    }
    return tools.get(key);
  }

  function updateToolRange(toolInfo, pos) {
    toolInfo.minX = toolInfo.minX === null ? pos.x : Math.min(toolInfo.minX, pos.x);
    toolInfo.maxX = toolInfo.maxX === null ? pos.x : Math.max(toolInfo.maxX, pos.x);
    toolInfo.minY = toolInfo.minY === null ? pos.y : Math.min(toolInfo.minY, pos.y);
    toolInfo.maxY = toolInfo.maxY === null ? pos.y : Math.max(toolInfo.maxY, pos.y);
    toolInfo.minZ = toolInfo.minZ === null ? pos.z : Math.min(toolInfo.minZ, pos.z);
    toolInfo.maxZ = toolInfo.maxZ === null ? pos.z : Math.max(toolInfo.maxZ, pos.z);
  }

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const cleaned = cleanLine(raw).toUpperCase().replace(/\s+/g, " ").trim();
    if (!cleaned || cleaned === "%") return;
    const words = wordsFromLine(cleaned);
    const before = { x: state.x, y: state.y, z: state.z };
    const warnings = [];
    let gCode = state.motion || "";
    let hasMoveAxis = false;
    let hasXY = false;
    let hasZ = false;
    let hasG92Line = false;
    let isDwellLine = false;
    let pCode = null;
    let mCodes = [];
    let oNumber = null;
    let nNumber = null;

    words.forEach(({ letter, value }) => {
      if (letter === "O") oNumber = Math.trunc(value);
      if (letter === "N") nNumber = Math.trunc(value);
      if (letter === "P") pCode = Math.trunc(value);
      if (letter === "M") mCodes.push(Math.trunc(value));
      if (letter === "G") {
        const code = Math.trunc(value);
        if ([0, 1, 2, 3].includes(code)) {
          state.motion = normalizeMotion(code);
          gCode = state.motion;
        } else if (code === 4) {
          isDwellLine = true;
          gCode = "G04";
        } else if (code === 90 || code === 91) {
          const nextMode = `G${code}`;
          if (state.mode !== nextMode) {
            modeHistory.push({ line: lineNumber, from: state.mode, to: nextMode });
          }
          state.mode = nextMode;
        } else if ([17, 18, 19].includes(code)) {
          state.plane = `G${code}`;
        } else if (code === 92) {
          state.hasG92 = true;
          hasG92Line = true;
        } else if (code === 218) {
          state.hasG218 = true;
        } else if (code === 219) {
          state.hasG219 = true;
        }
      }
    });

    words.forEach(({ letter, value }) => {
      if (letter === "F") state.f = value;
      if (letter === "S") {
        state.s = value;
        if (value > 0) state.spindleOn = true;
        if (value === 0) state.spindleOn = false;
        currentTool().spindle = value > 0 ? value : currentTool().spindle;
      }
      if (letter === "T") {
        state.t = Math.trunc(value);
      }
    });

    if (mCodes.includes(21)) state.hasM21 = true;
    if (mCodes.includes(23)) state.spindleOn = true;
    if (mCodes.includes(23)) currentTool().spindle = state.s;
    if (mCodes.includes(92)) state.hasM92 = true;
    if (mCodes.includes(95)) state.hasM95 = true;
    if (mCodes.includes(3)) state.spindleOn = true;
    if (mCodes.includes(5)) state.spindleOn = false;

    if (cleaned.includes("G65") && pCode === 9000) {
      state.hasP9000 = true;
      state.toolLoaded = true;
      state.tool = state.t || state.tool;
      currentTool().p9000Line = lineNumber;
      toolEvents.push({ type: "P9000", line: lineNumber, x: state.x, y: state.y, tool: state.tool || state.t || "" });
    }
    if (cleaned.includes("G65") && pCode === 9900) {
      state.hasP9900 = true;
      currentTool().p9900Line = lineNumber;
      toolEvents.push({ type: "P9900", line: lineNumber, x: state.x, y: state.y, tool: state.tool || state.t || "" });
      state.toolLoaded = false;
    }

    words.forEach(({ letter, value }) => {
      if (!["X", "Y", "Z"].includes(letter)) return;
      if (isDwellLine) return;
      if (hasG92Line) {
        state[letter.toLowerCase()] = value;
        return;
      }
      hasMoveAxis = true;
      if (letter === "X") hasXY = true;
      if (letter === "Y") hasXY = true;
      if (letter === "Z") hasZ = true;
      const key = letter.toLowerCase();
      if (state.mode === "G91") {
        state[key] += value;
        if (letter === "Z") {
          stats.g91ZTotal += value;
        }
      } else {
        state[key] = value;
      }
    });

    const after = { x: state.x, y: state.y, z: state.z };
    if (hasG92Line) {
      stats.g92 = { line: lineNumber, x: after.x, y: after.y, z: after.z };
    }
    const inWorkCoordinates = !programUsesG92 || state.hasG92;
    if (hasMoveAxis && isMotion(gCode) && inWorkCoordinates) {
      const isFirstWorkMove = !stats.firstMove;
      if (isFirstWorkMove) stats.firstMove = { line: lineNumber, x: after.x, y: after.y, z: after.z };
      if (!state.toolLoaded && ["G01", "G02", "G03"].includes(gCode)) warnings.push("工具取得前に加工");
      if (!state.spindleOn && ["G01", "G02", "G03"].includes(gCode)) warnings.push("主軸ON前に加工");
      if (!isFirstWorkMove && gCode === "G00" && hasXY && !hasZ && after.z < cfg.materialThickness + cfg.approachClearance - 0.001) {
        warnings.push("低いZでG00 XY移動");
      }
      if (after.z < -cfg.allowOvercut) warnings.push("材料下面より深いZ");
      if (hasZ) {
        const dz = after.z - before.z;
        if (dz < 0) stats.zDown += Math.abs(dz);
        if (dz > 0) stats.zUp += dz;
      }
      const len = distance(before, after);
      const feed = state.f || 0;
      const minutes = feed > 0 && gCode !== "G00" ? len / feed : 0;
      stats.estimatedMinutes += minutes;
      const toolInfo = currentTool();
      toolInfo.estimatedMinutes += minutes;
      updateToolRange(toolInfo, after);
      segments.push({
        line: lineNumber,
        type: gCode,
        from: before,
        to: after,
        warning: warnings.length > 0,
      });
      updateRange(after);
      zTrace.push({ line: lineNumber, z: after.z, warning: warnings.length > 0 });
    }

    warnings.forEach((message) => {
      addCheck(message.includes("深い") || message.includes("低いZ") ? "danger" : "warn", lineNumber, message);
      currentTool().warnings += 1;
    });

    rows.push({
      line: lineNumber,
      raw,
      oNumber,
      nNumber,
      gCode,
      mode: state.mode,
      x: state.x,
      y: state.y,
      z: state.z,
      f: state.f,
      s: state.s,
      t: state.t,
      tool: state.tool || "",
      warnings,
    });
  });

  if (!state.hasG92) addCheck("danger", "", "G92がありません");
  if (!state.hasM21) addCheck("warn", "", "M21がありません");
  if (!state.hasP9000) addCheck("danger", "", "P9000工具取得がありません");
  if (!state.hasP9900) addCheck("danger", "", "P9900工具返却がありません");
  if (state.mode === "G91") addCheck("warn", "", "G91のまま終了しています");
  if (state.z < zValues().safeZ - 0.001) addCheck("warn", "", "加工終了時にSafeZへ戻っていません");
  if (stats.minZ !== null && stats.minZ < -cfg.allowOvercut) addCheck("danger", "", `最深Z ${fmt(stats.minZ)} が許容突抜 ${fmt(cfg.allowOvercut)} を超えています`);
  if (!state.hasM92 || !state.hasM95) addCheck("warn", "", "M92/M95が不足しています");
  if (!state.hasG218 || !state.hasG219) addCheck("warn", "", "G218/G219が不足しています");
  if (state.toolLoaded) addCheck("danger", "", "工具返却なしで終了しています");
  const hasM30 = rows.some((row) => /(^|\s)M\s*30(\s|$)/i.test(row.raw));
  if (hasM30 && !state.hasP9900) addCheck("danger", "", "工具返却なしでM30があります");
  if (modeHistory.length > 12) addCheck("warn", "", `G90/G91切替が多いです (${modeHistory.length}回)`);

  return {
    config: cfg,
    z: zValues(),
    rows,
    checks,
    tools: Array.from(tools.values()),
    toolEvents,
    segments,
    zTrace,
    modeHistory,
    stats,
  };
}

function renderZSummary(result = null) {
  const z = zValues();
  const rows = [
    ["materialThickness", config.materialThickness],
    ["safeClearance", config.safeClearance],
    ["approachClearance", config.approachClearance],
    ["materialTopZ", z.materialTopZ],
    ["safeZ", z.safeZ],
    ["approachZ", z.approachZ],
  ];
  if (result) {
    rows.push(
      ["最深Z", result.stats.minZ],
      ["Z下降量", result.stats.zDown],
      ["Z上昇量", result.stats.zUp],
      ["G91 Z累積", result.stats.g91ZTotal],
      ["G90/G91切替", `${result.modeHistory.length} 回`],
    );
  }
  $("zSummary").innerHTML = rows.map(([label, value]) => `<div class="metric"><b>${label}</b><span>${typeof value === "string" ? escapeHtml(value) : fmt(value)}</span></div>`).join("");
}

function renderChecks(result) {
  const danger = result.checks.filter((c) => c.severity === "danger").length;
  const warn = result.checks.filter((c) => c.severity === "warn").length;
  $("checkSummary").innerHTML = `<div class="metric ${danger ? "check-danger" : warn ? "check-warn" : "check-ok"}"><b>${danger ? "要確認" : warn ? "注意" : "OK"}</b><span>危険 ${danger} / 警告 ${warn}</span></div>`;
  $("checkList").innerHTML = result.checks.length
    ? result.checks.map((c) => `<div class="check-item check-${c.severity}"><b>${c.line || "-"}</b> ${escapeHtml(c.message)}</div>`).join("")
    : `<div class="check-item check-ok">警告はありません</div>`;
}

function renderTools(result) {
  $("toolList").innerHTML = result.tools.length
    ? result.tools.map((tool) => `
      <div class="tool-card">
        <b>T${escapeHtml(tool.tool)}</b>
        <span>P9000: ${tool.p9000Line || "-"} / P9900: ${tool.p9900Line || "-"}</span><br />
        <span>S${tool.spindle || "-"} / Z最深 ${fmt(tool.minZ)} / 時間 ${fmt(tool.estimatedMinutes, 2)}分 / 警告 ${tool.warnings}</span><br />
        <span>X ${fmt(tool.minX)}..${fmt(tool.maxX)} / Y ${fmt(tool.minY)}..${fmt(tool.maxY)}</span>
      </div>`).join("")
    : `<div class="tool-card">工具情報なし</div>`;
}

function renderRows(result) {
  $("lineCount").textContent = `${result.rows.length} 行`;
  $("coordTable").querySelector("tbody").innerHTML = result.rows.map((row) => `
    <tr class="${row.warnings.length ? "warn-row" : ""}">
      <td>${row.line}</td>
      <td title="${escapeHtml(row.raw)}">${escapeHtml(row.raw)}</td>
      <td>${row.gCode || "-"}</td>
      <td>${row.mode}</td>
      <td>${fmt(row.x)}</td>
      <td>${fmt(row.y)}</td>
      <td>${fmt(row.z)}</td>
      <td>${fmt(row.f, 0)}</td>
      <td>${fmt(row.s, 0)}</td>
      <td>${fmt(row.t, 0)}</td>
      <td>${escapeHtml(row.tool || "")}</td>
      <td>${escapeHtml(row.warnings.join(" / "))}</td>
    </tr>
  `).join("");
}

function drawXY(result) {
  const canvas = $("xyCanvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);

  const pad = 34;
  const xs = [0, config.materialX, ...result.segments.flatMap((s) => [s.from.x, s.to.x])];
  const ys = [0, config.materialY, ...result.segments.flatMap((s) => [s.from.y, s.to.y])];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxY - minY));
  const toPx = (p) => ({
    x: pad + (p.x - minX) * scale,
    y: h - pad - (p.y - minY) * scale,
  });

  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1;
  const mat0 = toPx({ x: 0, y: 0 });
  const mat1 = toPx({ x: config.materialX, y: config.materialY });
  ctx.strokeRect(mat0.x, mat1.y, mat1.x - mat0.x, mat0.y - mat1.y);

  result.segments.forEach((seg) => {
    const a = toPx(seg.from);
    const b = toPx(seg.to);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = seg.warning ? "#b91c1c" : seg.type === "G00" ? "#6b7280" : ["G02", "G03"].includes(seg.type) ? "#2563eb" : "#0f766e";
    ctx.lineWidth = seg.type === "G00" ? 1 : 2;
    ctx.setLineDash(seg.type === "G00" ? [5, 5] : []);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  if (result.stats.g92) {
    const g92 = toPx(result.stats.g92);
    ctx.fillStyle = "#7c3aed";
    ctx.beginPath();
    ctx.arc(g92.x, g92.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (result.stats.firstMove) {
    const first = toPx(result.stats.firstMove);
    ctx.fillStyle = "#111827";
    ctx.fillRect(first.x - 4, first.y - 4, 8, 8);
  }
  result.toolEvents.forEach((event) => {
    const p = toPx(event);
    ctx.fillStyle = event.type === "P9000" ? "#f59e0b" : "#dc2626";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 7);
    ctx.lineTo(p.x + 7, p.y + 7);
    ctx.lineTo(p.x - 7, p.y + 7);
    ctx.closePath();
    ctx.fill();
  });
  $("rangeSummary").textContent = `X ${fmt(result.stats.minX)}..${fmt(result.stats.maxX)} / Y ${fmt(result.stats.minY)}..${fmt(result.stats.maxY)}`;
}

function drawZ(result) {
  const canvas = $("zCanvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const trace = result.zTrace;
  const minZ = Math.min(result.z.minAllowedZ, result.stats.minZ ?? 0);
  const maxZ = Math.max(result.z.safeZ, result.stats.maxZ ?? result.z.safeZ);
  const pad = 24;
  const xFor = (i) => pad + (trace.length <= 1 ? 0 : (i / (trace.length - 1)) * (w - pad * 2));
  const yFor = (z) => h - pad - ((z - minZ) / Math.max(1, maxZ - minZ)) * (h - pad * 2);

  [
    ["safeZ", result.z.safeZ, "#0f766e"],
    ["approachZ", result.z.approachZ, "#2563eb"],
    ["materialTopZ", result.z.materialTopZ, "#111827"],
    ["limit", result.z.minAllowedZ, "#b91c1c"],
  ].forEach(([, z, color]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, yFor(z));
    ctx.lineTo(w - pad, yFor(z));
    ctx.stroke();
  });

  if (trace.length) {
    ctx.beginPath();
    trace.forEach((point, i) => {
      const x = xFor(i);
      const y = yFor(point.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#0f766e";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  $("zRangeSummary").textContent = `最深Z ${fmt(result.stats.minZ)} / 下降 ${fmt(result.stats.zDown)} / 上昇 ${fmt(result.stats.zUp)} / G91累積 ${fmt(result.stats.g91ZTotal)}`;
}

function renderAnalysis(result) {
  renderZSummary(result);
  renderChecks(result);
  renderTools(result);
  renderRows(result);
  drawXY(result);
  drawZ(result);
  $("jsonBtn").disabled = false;
  $("coordCsvBtn").disabled = false;
  $("checkCsvBtn").disabled = false;
}

function analyze() {
  saveConfig();
  analysis = analyzeNc($("ncInput").value, config);
  renderAnalysis(analysis);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function download(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJson() {
  if (!analysis) return;
  download("shinx_nc_analysis.json", JSON.stringify(analysis, null, 2), "application/json;charset=utf-8");
}

function downloadCoordCsv() {
  if (!analysis) return;
  const header = ["line", "raw", "gCode", "mode", "x", "y", "z", "f", "s", "t", "tool", "warnings"];
  const rows = analysis.rows.map((row) => header.map((key) => csvEscape(key === "warnings" ? row.warnings.join(" / ") : row[key])).join(","));
  download("shinx_coordinates.csv", [header.join(","), ...rows].join("\n"), "text/csv;charset=utf-8");
}

function downloadCheckCsv() {
  if (!analysis) return;
  const header = ["severity", "line", "message"];
  const rows = analysis.checks.map((check) => header.map((key) => csvEscape(check[key])).join(","));
  download("shinx_safety_checks.csv", [header.join(","), ...rows].join("\n"), "text/csv;charset=utf-8");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch]);
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    $("ncInput").value = reader.result;
    analyze();
  };
  reader.readAsText(file);
}

function bindEvents() {
  $("analyzeBtn").addEventListener("click", analyze);
  $("jsonBtn").addEventListener("click", downloadJson);
  $("coordCsvBtn").addEventListener("click", downloadCoordCsv);
  $("checkCsvBtn").addEventListener("click", downloadCheckCsv);
  $("fileInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) readFile(file);
  });
  $("machiningFace").addEventListener("change", () => {
    const face = config.faces?.[$("machiningFace").value];
    if (!face) return;
    $("machineOriginX").value = face.machineOriginX;
    $("machineOriginY").value = face.machineOriginY;
    saveConfig();
    renderZSummary();
  });
  fields.forEach((name) => {
    $(name).addEventListener("change", () => {
      saveConfig();
      renderZSummary();
      if ($("ncInput").value.trim()) analyze();
    });
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
  window.addEventListener("resize", () => {
    if (analysis) {
      drawXY(analysis);
      drawZ(analysis);
    }
  });
}

renderConfig();
bindEvents();
