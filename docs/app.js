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
let analyzeTimer = null;
let selectedLine = null;
let previewMode = "material";
const xyView = { scale: 1, offsetX: 0, offsetY: 0, initialized: false, hitItems: [] };
const zView = { hitItems: [] };
const panState = { active: false, x: 0, y: 0 };

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
      const dz = after.z - before.z;
      const len = distance(before, after);
      const feed = state.f || 0;
      const minutes = feed > 0 && gCode !== "G00" ? len / feed : 0;
      stats.estimatedMinutes += minutes;
      const toolInfo = currentTool();
      toolInfo.estimatedMinutes += minutes;
      updateToolRange(toolInfo, after);
      segments.push({
        line: lineNumber,
        raw,
        type: gCode,
        mode: state.mode,
        from: before,
        to: after,
        f: state.f,
        s: state.s,
        t: state.t,
        tool: state.tool || "",
        warning: warnings.length > 0,
      });
      updateRange(after);
      zTrace.push({ line: lineNumber, z: after.z, dz, mode: state.mode, warning: warnings.length > 0, f: state.f, s: state.s, t: state.t, tool: state.tool || "" });
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
    <tr data-line="${row.line}" class="${row.warnings.length ? "warn-row" : ""} ${selectedLine === row.line ? "selected-row" : ""}">
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

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width || canvas.width));
  const height = Math.max(180, Math.round(rect.height || canvas.height));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height };
}

function machiningBounds(result) {
  const xs = result.segments.flatMap((s) => [s.from.x, s.to.x]);
  const ys = result.segments.flatMap((s) => [s.from.y, s.to.y]);
  if (!xs.length || !ys.length) {
    return { minX: 0, maxX: config.materialX, minY: 0, maxY: config.materialY };
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function xyBaseBounds(result) {
  if (previewMode === "work") {
    const b = machiningBounds(result);
    const pad = Math.max(5, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.12);
    return { minX: b.minX - pad, maxX: b.maxX + pad, minY: b.minY - pad, maxY: b.maxY + pad };
  }
  return {
    minX: Math.min(0, result.stats.minX ?? 0),
    maxX: Math.max(config.materialX, result.stats.maxX ?? config.materialX),
    minY: Math.min(0, result.stats.minY ?? 0),
    maxY: Math.max(config.materialY, result.stats.maxY ?? config.materialY),
  };
}

function resetXYView(result = analysis) {
  if (!result) return;
  const canvas = $("xyCanvas");
  const { width, height } = resizeCanvas(canvas);
  const b = xyBaseBounds(result);
  const pad = 34;
  const sx = (width - pad * 2) / Math.max(1, b.maxX - b.minX);
  const sy = (height - pad * 2) / Math.max(1, b.maxY - b.minY);
  xyView.scale = Math.max(0.001, Math.min(sx, sy));
  xyView.offsetX = pad - b.minX * xyView.scale + ((width - pad * 2) - (b.maxX - b.minX) * xyView.scale) / 2;
  xyView.offsetY = height - pad + b.minY * xyView.scale - ((height - pad * 2) - (b.maxY - b.minY) * xyView.scale) / 2;
  xyView.initialized = true;
}

function worldToScreen(point) {
  return {
    x: point.x * xyView.scale + xyView.offsetX,
    y: xyView.offsetY - point.y * xyView.scale,
  };
}

function screenToWorld(point) {
  return {
    x: (point.x - xyView.offsetX) / xyView.scale,
    y: (xyView.offsetY - point.y) / xyView.scale,
  };
}

function distanceToSegment(point, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = point.x - a.x;
  const wy = point.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
  const px = a.x + t * vx;
  const py = a.y + t * vy;
  return Math.hypot(point.x - px, point.y - py);
}

function drawCross(ctx, point, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(point.x - size, point.y);
  ctx.lineTo(point.x + size, point.y);
  ctx.moveTo(point.x, point.y - size);
  ctx.lineTo(point.x, point.y + size);
  ctx.stroke();
}

function drawXY(result, keepView = false) {
  const canvas = $("xyCanvas");
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = resizeCanvas(canvas);
  if (!keepView || !xyView.initialized) resetXYView(result);
  xyView.hitItems = [];
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);

  const mat0 = worldToScreen({ x: 0, y: 0 });
  const mat1 = worldToScreen({ x: config.materialX, y: config.materialY });
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(mat0.x, mat1.y, mat1.x - mat0.x, mat0.y - mat1.y);
  ctx.strokeStyle = "#8b95a1";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(mat0.x, mat1.y, mat1.x - mat0.x, mat0.y - mat1.y);

  const b = machiningBounds(result);
  const r0 = worldToScreen({ x: b.minX, y: b.minY });
  const r1 = worldToScreen({ x: b.maxX, y: b.maxY });
  ctx.strokeStyle = "#9333ea";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([7, 5]);
  ctx.strokeRect(r0.x, r1.y, r1.x - r0.x, r0.y - r1.y);
  ctx.setLineDash([]);

  result.segments.forEach((seg) => {
    const a = worldToScreen(seg.from);
    const b = worldToScreen(seg.to);
    xyView.hitItems.push({ type: "segment", line: seg.line, segment: seg, a, b });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = seg.warning ? "#b91c1c" : seg.type === "G00" ? "#6b7280" : ["G02", "G03"].includes(seg.type) ? "#2563eb" : "#0f766e";
    ctx.lineWidth = selectedLine === seg.line ? 5 : seg.type === "G00" ? 1.4 : 2.4;
    ctx.setLineDash(seg.type === "G00" ? [5, 5] : []);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  if (result.stats.g92) {
    drawCross(ctx, worldToScreen(result.stats.g92), 10, "#7c3aed");
  }
  drawCross(ctx, worldToScreen({ x: 0, y: 0 }), 14, "#111827");

  const machineMarker = worldToScreen({ x: config.machineOriginX, y: config.machineOriginY });
  const machineVisible = machineMarker.x > -80 && machineMarker.x < w + 80 && machineMarker.y > -80 && machineMarker.y < h + 80;
  const machineDraw = machineVisible ? machineMarker : { x: 24, y: 24 };
  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.moveTo(machineDraw.x, machineDraw.y - 9);
  ctx.lineTo(machineDraw.x + 9, machineDraw.y);
  ctx.lineTo(machineDraw.x, machineDraw.y + 9);
  ctx.lineTo(machineDraw.x - 9, machineDraw.y);
  ctx.closePath();
  ctx.fill();
  if (!machineVisible) {
    ctx.fillStyle = "#dc2626";
    ctx.font = "12px Segoe UI";
    ctx.fillText(`機械原点 X${fmt(config.machineOriginX)} Y${fmt(config.machineOriginY)}`, machineDraw.x + 14, machineDraw.y + 4);
  }

  if (result.stats.firstMove) {
    const first = worldToScreen(result.stats.firstMove);
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(first.x, first.y, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  const lastSeg = result.segments[result.segments.length - 1];
  if (lastSeg) {
    const end = worldToScreen(lastSeg.to);
    ctx.fillStyle = "#111827";
    ctx.fillRect(end.x - 6, end.y - 6, 12, 12);
  }
  result.toolEvents.forEach((event) => {
    const p = worldToScreen(event);
    ctx.fillStyle = event.type === "P9000" ? "#f59e0b" : "#dc2626";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 7);
    ctx.lineTo(p.x + 7, p.y + 7);
    ctx.lineTo(p.x - 7, p.y + 7);
    ctx.closePath();
    ctx.fill();
    xyView.hitItems.push({ type: "tool", line: event.line, event, a: { x: p.x - 10, y: p.y - 10 }, b: { x: p.x + 10, y: p.y + 10 } });
  });
  $("rangeSummary").textContent = `X ${fmt(result.stats.minX)}..${fmt(result.stats.maxX)} / Y ${fmt(result.stats.minY)}..${fmt(result.stats.maxY)}`;
}

function drawZ(result) {
  const canvas = $("zCanvas");
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = resizeCanvas(canvas);
  zView.hitItems = [];
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const trace = result.zTrace;
  const minZ = Math.min(result.z.minAllowedZ, result.stats.minZ ?? 0);
  const maxZ = Math.max(result.z.safeZ, result.stats.maxZ ?? result.z.safeZ);
  const pad = 30;
  const xFor = (i) => pad + (trace.length <= 1 ? 0 : (i / (trace.length - 1)) * (w - pad * 2));
  const yFor = (z) => h - pad - ((z - minZ) / Math.max(1, maxZ - minZ)) * (h - pad * 2);

  [
    ["safeZ", result.z.safeZ, "#0f766e"],
    ["approachZ", result.z.approachZ, "#2563eb"],
    ["materialTopZ", result.z.materialTopZ, "#111827"],
    ["最深Z", result.stats.minZ, "#b45309"],
    ["limit", result.z.minAllowedZ, "#b91c1c"],
  ].forEach(([label, z, color]) => {
    if (z === null || z === undefined) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(label === "最深Z" ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(pad, yFor(z));
    ctx.lineTo(w - pad, yFor(z));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "12px Segoe UI";
    ctx.fillText(label, pad + 4, yFor(z) - 4);
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
    trace.forEach((point, i) => {
      const x = xFor(i);
      const y = yFor(point.z);
      zView.hitItems.push({ line: point.line, point, x, y });
      if (point.mode === "G91" && point.dz < 0) {
        ctx.fillStyle = "#b91c1c";
        ctx.beginPath();
        ctx.arc(x, y, selectedLine === point.line ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (selectedLine === point.line) {
        ctx.fillStyle = "#2563eb";
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  $("zRangeSummary").textContent = `最深Z ${fmt(result.stats.minZ)} / 下降 ${fmt(result.stats.zDown)} / 上昇 ${fmt(result.stats.zUp)} / G91累積 ${fmt(result.stats.g91ZTotal)}`;
}

function setStatus(text, loading = false) {
  const status = $("analysisStatus");
  status.textContent = text;
  status.classList.toggle("loading", loading);
}

function setPreviewMode(mode) {
  previewMode = mode;
  $("fitMaterialBtn").classList.toggle("active", mode === "material");
  $("fitWorkBtn").classList.toggle("active", mode === "work");
  xyView.initialized = false;
  if (analysis) drawXY(analysis);
}

function rowForLine(line) {
  return $("coordTable").querySelector(`tbody tr[data-line="${line}"]`);
}

function highlightLine(line, scroll = false) {
  selectedLine = line ? Number(line) : null;
  document.querySelectorAll("#coordTable tbody tr").forEach((row) => {
    row.classList.toggle("selected-row", Number(row.dataset.line) === selectedLine);
  });
  if (scroll && selectedLine) {
    const row = rowForLine(selectedLine);
    if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  if (analysis) {
    drawXY(analysis, true);
    drawZ(analysis);
  }
}

function segmentTooltip(segment) {
  return [
    `行 ${segment.line} ${segment.type} ${segment.mode}`,
    `X ${fmt(segment.to.x)}  Y ${fmt(segment.to.y)}  Z ${fmt(segment.to.z)}`,
    `F ${fmt(segment.f, 0)}  S ${fmt(segment.s, 0)}  T ${fmt(segment.t, 0)}`,
  ].join("\n");
}

function showTooltip(id, event, text) {
  const tip = $(id);
  const rect = event.currentTarget.getBoundingClientRect();
  tip.textContent = text;
  tip.hidden = false;
  tip.style.left = `${event.clientX - rect.left + 12}px`;
  tip.style.top = `${event.clientY - rect.top + 12}px`;
}

function hideTooltip(id) {
  $(id).hidden = true;
}

function nearestXYHit(event) {
  if (!analysis) return null;
  const rect = $("xyCanvas").getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  let best = null;
  xyView.hitItems.forEach((item) => {
    let d = Infinity;
    if (item.type === "segment") {
      d = distanceToSegment(point, item.a, item.b);
    } else if (item.type === "tool") {
      d = point.x >= item.a.x && point.x <= item.b.x && point.y >= item.a.y && point.y <= item.b.y ? 0 : Infinity;
    }
    if (d < 9 && (!best || d < best.distance)) {
      best = { ...item, distance: d };
    }
  });
  return best;
}

function nearestZHit(event) {
  if (!analysis) return null;
  const rect = $("zCanvas").getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  let best = null;
  zView.hitItems.forEach((item) => {
    const d = Math.hypot(point.x - item.x, point.y - item.y);
    if (d < 10 && (!best || d < best.distance)) {
      best = { ...item, distance: d };
    }
  });
  return best;
}

function scheduleAnalyze() {
  clearTimeout(analyzeTimer);
  if (!$("ncInput").value.trim()) {
    setStatus("待機中");
    return;
  }
  setStatus("解析待ち", true);
  analyzeTimer = setTimeout(() => {
    setStatus("解析中", true);
    const run = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => setTimeout(callback, 0);
    run(() => analyze());
  }, 300);
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
  setStatus(`解析済み ${result.rows.length}行`);
}

function analyze() {
  saveConfig();
  clearTimeout(analyzeTimer);
  if (!$("ncInput").value.trim()) {
    analysis = null;
    renderZSummary();
    $("lineCount").textContent = "0 行";
    $("coordTable").querySelector("tbody").innerHTML = "";
    $("checkSummary").innerHTML = "";
    $("checkList").innerHTML = "";
    $("toolList").innerHTML = "";
    $("jsonBtn").disabled = true;
    $("coordCsvBtn").disabled = true;
    $("checkCsvBtn").disabled = true;
    setStatus("待機中");
    return;
  }
  analysis = analyzeNc($("ncInput").value, config);
  selectedLine = null;
  xyView.initialized = false;
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
    setStatus("解析中", true);
    analyze();
  };
  reader.readAsText(file);
}

function bindEvents() {
  $("analyzeBtn").addEventListener("click", analyze);
  $("ncInput").addEventListener("input", scheduleAnalyze);
  $("jsonBtn").addEventListener("click", downloadJson);
  $("coordCsvBtn").addEventListener("click", downloadCoordCsv);
  $("checkCsvBtn").addEventListener("click", downloadCheckCsv);
  $("fitMaterialBtn").addEventListener("click", () => setPreviewMode("material"));
  $("fitWorkBtn").addEventListener("click", () => setPreviewMode("work"));
  $("coordTable").querySelector("tbody").addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-line]");
    if (row) highlightLine(row.dataset.line);
  });
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
      if ($("ncInput").value.trim()) scheduleAnalyze();
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
  const xyCanvas = $("xyCanvas");
  xyCanvas.addEventListener("wheel", (event) => {
    if (!analysis) return;
    event.preventDefault();
    const rect = xyCanvas.getBoundingClientRect();
    const mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const before = screenToWorld(mouse);
    const zoom = event.deltaY < 0 ? 1.15 : 0.87;
    xyView.scale *= zoom;
    xyView.offsetX = mouse.x - before.x * xyView.scale;
    xyView.offsetY = mouse.y + before.y * xyView.scale;
    drawXY(analysis, true);
  });
  xyCanvas.addEventListener("mousedown", (event) => {
    panState.active = true;
    panState.x = event.clientX;
    panState.y = event.clientY;
  });
  window.addEventListener("mouseup", () => {
    panState.active = false;
  });
  window.addEventListener("mousemove", (event) => {
    if (!panState.active || !analysis) return;
    xyView.offsetX += event.clientX - panState.x;
    xyView.offsetY += event.clientY - panState.y;
    panState.x = event.clientX;
    panState.y = event.clientY;
    drawXY(analysis, true);
  });
  xyCanvas.addEventListener("dblclick", () => {
    if (!analysis) return;
    resetXYView(analysis);
    drawXY(analysis, true);
  });
  xyCanvas.addEventListener("click", (event) => {
    if (panState.active) return;
    const hit = nearestXYHit(event);
    if (hit) highlightLine(hit.line, true);
  });
  xyCanvas.addEventListener("mousemove", (event) => {
    if (panState.active) return;
    const hit = nearestXYHit(event);
    if (hit?.segment) {
      showTooltip("xyTooltip", event, segmentTooltip(hit.segment));
    } else if (hit?.event) {
      showTooltip("xyTooltip", event, [`行 ${hit.event.line} ${hit.event.type}`, `T${hit.event.tool || "-"}`, `X ${fmt(hit.event.x)}  Y ${fmt(hit.event.y)}`].join("\n"));
    } else {
      hideTooltip("xyTooltip");
    }
  });
  xyCanvas.addEventListener("mouseleave", () => hideTooltip("xyTooltip"));

  const zCanvas = $("zCanvas");
  zCanvas.addEventListener("mousemove", (event) => {
    const hit = nearestZHit(event);
    if (hit) {
      showTooltip("zTooltip", event, [`行 ${hit.line}`, `Z ${fmt(hit.point.z)}`, `dZ ${fmt(hit.point.dz)}`, `${hit.point.mode} F${fmt(hit.point.f, 0)} S${fmt(hit.point.s, 0)} T${fmt(hit.point.t, 0)}`].join("\n"));
    } else {
      hideTooltip("zTooltip");
    }
  });
  zCanvas.addEventListener("click", (event) => {
    const hit = nearestZHit(event);
    if (hit) highlightLine(hit.line, true);
  });
  zCanvas.addEventListener("mouseleave", () => hideTooltip("zTooltip"));
  window.addEventListener("resize", () => {
    if (analysis) {
      xyView.initialized = false;
      drawXY(analysis);
      drawZ(analysis);
    }
  });
}

renderConfig();
bindEvents();
