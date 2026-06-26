import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.165.0/examples/jsm/controls/OrbitControls.js";

const $ = (id) => document.getElementById(id);
const fmt = (value, digits = 3) => value === null || value === undefined || Number.isNaN(value) ? "-" : Number(value).toFixed(digits);

const state = {
  analysis: emptyAnalysis(),
  index: 0,
  playing: false,
  speed: 1,
  lastFrame: 0,
  xyMode: "material",
};

let scene;
let camera;
let renderer;
let controls;
let stockMesh;
let rangeBox;
let toolMesh;
let pathGroup;
let markerGroup;
let animationId;

function emptyAnalysis() {
  return {
    rows: [],
    motionRows: [],
    segments: [],
    tools: [],
    toolEvents: [],
    safety: [],
    inferred: {
      face: "8面",
      materialX: 300,
      materialY: 300,
      materialThickness: 0,
      safeZ: 0,
      approachZ: 0,
      materialTopZ: 0,
      materialBottomZ: 0,
      machineOrigin: { x: 0, y: 0 },
      workOrigin: { x: 0, y: 0, z: 0 },
      minZ: 0,
      timeSeconds: 0,
    },
  };
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

function gName(value) {
  return `G${String(Math.trunc(value)).padStart(2, "0")}`;
}

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function analyzeNc(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows = [];
  const motionRows = [];
  const segments = [];
  const toolEvents = [];
  const safety = [];
  const toolMap = new Map();
  const stateNc = {
    x: 0, y: 0, z: 0, f: null, s: null, t: null, tool: null,
    mode: "G90", motion: null, spindle: false, toolLoaded: false,
    hasG92: false, hasM21: false, hasP9000: false, hasP9900: false,
    hasG218: false, hasG219: false, hasM92: false, hasM95: false,
  };
  const inferred = {
    face: "8面",
    materialX: 300,
    materialY: 300,
    materialThickness: null,
    safeZ: null,
    approachZ: null,
    materialTopZ: null,
    materialBottomZ: null,
    machineOrigin: { x: 0, y: 0 },
    workOrigin: { x: 0, y: 0, z: 0 },
    minX: null, maxX: null, minY: null, maxY: null, minZ: null, maxZ: null,
    start: null,
    end: null,
    timeSeconds: 0,
  };
  let lastMachineMove = { x: 0, y: 0, z: 0 };
  let sawG92 = false;
  let firstPlungeDone = false;
  let activeMotionIndex = -1;

  const addSafety = (level, line, message) => safety.push({ level, line, message });
  const toolInfo = () => {
    const key = stateNc.tool || stateNc.t || "未取得";
    if (!toolMap.has(key)) {
      toolMap.set(key, { tool: key, p9000: null, p9900: null, spindle: null, count: 0, minZ: null, warnings: 0 });
    }
    return toolMap.get(key);
  };
  const updateBounds = (p) => {
    inferred.minX = inferred.minX === null ? p.x : Math.min(inferred.minX, p.x);
    inferred.maxX = inferred.maxX === null ? p.x : Math.max(inferred.maxX, p.x);
    inferred.minY = inferred.minY === null ? p.y : Math.min(inferred.minY, p.y);
    inferred.maxY = inferred.maxY === null ? p.y : Math.max(inferred.maxY, p.y);
    inferred.minZ = inferred.minZ === null ? p.z : Math.min(inferred.minZ, p.z);
    inferred.maxZ = inferred.maxZ === null ? p.z : Math.max(inferred.maxZ, p.z);
  };

  lines.forEach((raw, i) => {
    const line = i + 1;
    const cleaned = cleanLine(raw).toUpperCase().replace(/\s+/g, " ").trim();
    if (!cleaned || cleaned === "%") return;
    const words = wordsFromLine(cleaned);
    const before = { x: stateNc.x, y: stateNc.y, z: stateNc.z };
    let isDwell = false;
    let hasAxis = false;
    let hasMoveAxis = false;
    let hasG92Line = false;
    let pCode = null;
    let mCodes = [];
    let nNumber = null;
    let oNumber = null;

    words.forEach(({ letter, value }) => {
      if (letter === "N") nNumber = Math.trunc(value);
      if (letter === "O") oNumber = Math.trunc(value);
      if (letter === "P") pCode = Math.trunc(value);
      if (letter === "M") mCodes.push(Math.trunc(value));
      if (letter === "G") {
        const code = Math.trunc(value);
        if ([0, 1, 2, 3].includes(code)) stateNc.motion = gName(code);
        else if (code === 4) isDwell = true;
        else if (code === 90 || code === 91) stateNc.mode = `G${code}`;
        else if (code === 92) {
          hasG92Line = true;
          stateNc.hasG92 = true;
          sawG92 = true;
        } else if (code === 218) stateNc.hasG218 = true;
        else if (code === 219) stateNc.hasG219 = true;
      }
    });

    words.forEach(({ letter, value }) => {
      if (letter === "F") stateNc.f = value;
      if (letter === "S") {
        stateNc.s = value;
        stateNc.spindle = value > 0;
        if (value > 0) toolInfo().spindle = value;
      }
      if (letter === "T") stateNc.t = Math.trunc(value);
    });

    if (mCodes.includes(3) || mCodes.includes(23)) stateNc.spindle = true;
    if (mCodes.includes(5)) stateNc.spindle = false;
    if (mCodes.includes(21)) stateNc.hasM21 = true;
    if (mCodes.includes(92)) stateNc.hasM92 = true;
    if (mCodes.includes(95)) stateNc.hasM95 = true;

    if (cleaned.includes("G65") && pCode === 9000) {
      stateNc.hasP9000 = true;
      stateNc.toolLoaded = true;
      stateNc.tool = stateNc.t || stateNc.tool;
      toolInfo().p9000 = line;
      toolEvents.push({ line, type: "P9000", x: stateNc.x, y: stateNc.y, z: stateNc.z, tool: stateNc.tool });
    }
    if (cleaned.includes("G65") && pCode === 9900) {
      stateNc.hasP9900 = true;
      toolInfo().p9900 = line;
      toolEvents.push({ line, type: "P9900", x: stateNc.x, y: stateNc.y, z: stateNc.z, tool: stateNc.tool });
      stateNc.toolLoaded = false;
    }

    words.forEach(({ letter, value }) => {
      if (!["X", "Y", "Z"].includes(letter) || isDwell) return;
      hasAxis = true;
      if (hasG92Line) {
        stateNc[letter.toLowerCase()] = value;
        return;
      }
      hasMoveAxis = true;
      const key = letter.toLowerCase();
      stateNc[key] = stateNc.mode === "G91" ? stateNc[key] + value : value;
    });

    const after = { x: stateNc.x, y: stateNc.y, z: stateNc.z };
    if (!sawG92 && hasMoveAxis) lastMachineMove = { ...after };
    if (hasG92Line) {
      inferred.machineOrigin = { x: lastMachineMove.x, y: lastMachineMove.y };
      inferred.workOrigin = { ...after };
    }

    let segment = null;
    if (sawG92 && hasMoveAxis && ["G00", "G01", "G02", "G03"].includes(stateNc.motion)) {
      activeMotionIndex += 1;
      if (!inferred.start) inferred.start = { ...after, line };
      inferred.end = { ...after, line };
      updateBounds(after);

      if (!firstPlungeDone && stateNc.mode === "G91" && after.z < before.z) {
        inferred.approachZ = before.z;
        inferred.materialTopZ = after.z;
        inferred.materialThickness = after.z;
        firstPlungeDone = true;
      }
      if (!firstPlungeDone && stateNc.mode === "G90" && after.z > 0) {
        inferred.safeZ = Math.max(inferred.safeZ ?? after.z, after.z);
      }
      if (firstPlungeDone && stateNc.mode === "G90" && after.z > 0) {
        inferred.safeZ = Math.max(inferred.safeZ ?? after.z, after.z);
      }

      const length = dist(before, after);
      const rapidFeed = 10000;
      const feed = stateNc.motion === "G00" ? rapidFeed : (stateNc.f || 1000);
      const duration = Math.max(0.02, length / feed * 60);
      inferred.timeSeconds += duration;
      segment = {
        index: activeMotionIndex,
        line,
        raw,
        nNumber,
        type: stateNc.motion,
        mode: stateNc.mode,
        from: before,
        to: after,
        f: stateNc.f,
        s: stateNc.s,
        t: stateNc.t,
        tool: stateNc.tool || stateNc.t,
        duration,
        startTime: inferred.timeSeconds - duration,
        endTime: inferred.timeSeconds,
      };
      segments.push(segment);
      toolInfo().count += 1;
      toolInfo().minZ = toolInfo().minZ === null ? after.z : Math.min(toolInfo().minZ, after.z);
      if (!stateNc.toolLoaded && ["G01", "G02", "G03"].includes(stateNc.motion)) {
        addSafety("danger", line, "工具取得前に加工しています");
        toolInfo().warnings += 1;
      }
      if (!stateNc.spindle && ["G01", "G02", "G03"].includes(stateNc.motion)) {
        addSafety("danger", line, "主軸ON前に加工しています");
        toolInfo().warnings += 1;
      }
    }

    const row = {
      line, raw, cleaned, oNumber, nNumber,
      motionIndex: segment ? segment.index : null,
      mode: stateNc.mode,
      motion: stateNc.motion,
      x: stateNc.x, y: stateNc.y, z: stateNc.z,
      f: stateNc.f, s: stateNc.s, t: stateNc.t,
      tool: stateNc.tool,
    };
    rows.push(row);
    if (segment) motionRows.push(row);
  });

  inferred.materialTopZ ??= inferred.maxZ ?? 0;
  inferred.materialThickness ??= inferred.materialTopZ;
  inferred.approachZ ??= inferred.materialTopZ;
  inferred.safeZ ??= inferred.maxZ ?? inferred.materialTopZ;
  inferred.materialBottomZ = Math.min(0, inferred.minZ ?? 0);
  inferred.minZ ??= 0;
  inferred.maxZ ??= inferred.safeZ;
  const width = inferred.maxX !== null ? inferred.maxX - Math.min(0, inferred.minX) : 0;
  const depth = inferred.maxY !== null ? inferred.maxY - Math.min(0, inferred.minY) : 0;
  inferred.materialX = Math.max(300, Math.ceil(width / 10) * 10 || 300);
  inferred.materialY = Math.max(300, Math.ceil(depth / 10) * 10 || 300);

  if (!stateNc.hasG92) addSafety("danger", "", "G92がありません");
  if (!stateNc.hasM21) addSafety("warn", "", "M21がありません");
  if (!stateNc.hasP9000) addSafety("danger", "", "P9000工具取得がありません");
  if (!stateNc.hasP9900) addSafety("danger", "", "P9900工具返却がありません");
  if (!stateNc.hasG218 || !stateNc.hasG219) addSafety("warn", "", "G218/G219が不足しています");
  if (!stateNc.hasM92 || !stateNc.hasM95) addSafety("warn", "", "M92/M95が不足しています");
  if (stateNc.toolLoaded) addSafety("danger", "", "工具返却なしで終了しています");
  if (inferred.minZ < inferred.materialBottomZ - 1) addSafety("warn", "", "最深Zが材料下面を超えている可能性があります");

  return { rows, motionRows, segments, toolEvents, tools: Array.from(toolMap.values()), safety, inferred };
}

function initThree() {
  const host = $("threeViewport");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);
  camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.1, 10000);
  camera.position.set(360, -480, 320);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(150, 150, 20);
  controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2f3b45, 1.2));
  const dir = new THREE.DirectionalLight(0xffffff, 1.5);
  dir.position.set(200, -300, 500);
  scene.add(dir);
  scene.add(new THREE.GridHelper(600, 30, 0x52616d, 0x29343d));
  pathGroup = new THREE.Group();
  markerGroup = new THREE.Group();
  scene.add(pathGroup, markerGroup);
  toolMesh = createToolMesh();
  scene.add(toolMesh);
  animate();
}

function createToolMesh() {
  const group = new THREE.Group();
  const holder = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5, 42, 20),
    new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.35, roughness: 0.35 })
  );
  holder.rotation.x = Math.PI / 2;
  holder.position.z = 22;
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(6, 20, 24),
    new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.3, roughness: 0.4 })
  );
  tip.rotation.x = Math.PI;
  tip.position.z = -10;
  group.add(holder, tip);
  return group;
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.geometry?.dispose?.();
    child.material?.dispose?.();
  }
}

function lineObject(points, color, dashed = false) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 6, gapSize: 4 })
    : new THREE.LineBasicMaterial({ color });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  return line;
}

function rebuildScene() {
  const a = state.analysis;
  if (stockMesh) {
    scene.remove(stockMesh);
    stockMesh.geometry.dispose();
    stockMesh.material.dispose();
  }
  if (rangeBox) {
    scene.remove(rangeBox);
    rangeBox.geometry.dispose();
    rangeBox.material.dispose();
  }
  clearGroup(pathGroup);
  clearGroup(markerGroup);

  const inf = a.inferred;
  const stockGeo = new THREE.BoxGeometry(inf.materialX, inf.materialY, Math.max(1, inf.materialThickness));
  const stockMat = new THREE.MeshStandardMaterial({ color: 0x9fb6aa, transparent: true, opacity: 0.48, roughness: 0.7 });
  stockMesh = new THREE.Mesh(stockGeo, stockMat);
  stockMesh.position.set(inf.materialX / 2, inf.materialY / 2, inf.materialThickness / 2);
  scene.add(stockMesh);

  const box = new THREE.Box3(
    new THREE.Vector3(inf.minX ?? 0, inf.minY ?? 0, inf.minZ ?? 0),
    new THREE.Vector3(inf.maxX ?? 1, inf.maxY ?? 1, inf.maxZ ?? 1)
  );
  rangeBox = new THREE.Box3Helper(box, 0x9333ea);
  scene.add(rangeBox);

  a.segments.forEach((seg) => {
    const color = seg.type === "G00" ? 0x9ca3af : ["G02", "G03"].includes(seg.type) ? 0x2563eb : 0x0f766e;
    pathGroup.add(lineObject([vec(seg.from), vec(seg.to)], color, seg.type === "G00"));
  });

  addMarker(inf.workOrigin, 0x7c3aed, "cross");
  addMarker({ x: inf.machineOrigin.x, y: inf.machineOrigin.y, z: 0 }, 0xdc2626, "diamond");
  if (inf.start) addMarker(inf.start, 0x111827, "sphere", 5);
  if (inf.end) addMarker(inf.end, 0x111827, "box", 7);
  a.toolEvents.forEach((event) => addMarker(event, event.type === "P9000" ? 0xf59e0b : 0xdc2626, "cone", 7));

  const cx = (inf.materialX || 300) / 2;
  const cy = (inf.materialY || 300) / 2;
  controls.target.set(cx, cy, Math.max(20, (inf.materialThickness || 30) / 2));
  camera.position.set(cx + 260, cy - 390, Math.max(240, (inf.safeZ || 80) + 170));
  controls.update();
  updateToolAtIndex(0);
}

function vec(p) {
  return new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0);
}

function addMarker(p, color, type, size = 6) {
  let mesh;
  if (type === "box") mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial({ color }));
  else if (type === "cone") mesh = new THREE.Mesh(new THREE.ConeGeometry(size, size * 2, 16), new THREE.MeshBasicMaterial({ color }));
  else if (type === "diamond") mesh = new THREE.Mesh(new THREE.OctahedronGeometry(size), new THREE.MeshBasicMaterial({ color }));
  else mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 18, 12), new THREE.MeshBasicMaterial({ color }));
  mesh.position.set(p.x || 0, p.y || 0, p.z || 0);
  markerGroup.add(mesh);
}

function animate(time = 0) {
  animationId = requestAnimationFrame(animate);
  const dt = state.lastFrame ? (time - state.lastFrame) / 1000 : 0;
  state.lastFrame = time;
  if (state.playing && state.analysis.segments.length) {
    advancePlayback(dt * state.speed);
  }
  controls?.update();
  renderer?.render(scene, camera);
}

function advancePlayback(seconds) {
  let remaining = seconds;
  while (remaining > 0 && state.analysis.segments.length) {
    const seg = state.analysis.segments[state.index];
    const local = (seg.playhead || 0) + remaining;
    if (local >= seg.duration) {
      seg.playhead = seg.duration;
      if (state.index >= state.analysis.segments.length - 1) {
        state.playing = false;
        remaining = 0;
      } else {
        remaining = local - seg.duration;
        seg.playhead = 0;
        state.index += 1;
        state.analysis.segments[state.index].playhead = 0;
      }
      continue;
    }
    seg.playhead = local;
    remaining = 0;
  }
  updateToolAtIndex(state.index);
}

function currentPosition() {
  const seg = state.analysis.segments[state.index];
  if (!seg) return { x: 0, y: 0, z: 0, f: null, s: null, t: null, line: null };
  const t = Math.max(0, Math.min(1, (seg.playhead || 0) / Math.max(0.001, seg.duration)));
  return {
    x: seg.from.x + (seg.to.x - seg.from.x) * t,
    y: seg.from.y + (seg.to.y - seg.from.y) * t,
    z: seg.from.z + (seg.to.z - seg.from.z) * t,
    f: seg.f, s: seg.s, t: seg.t, line: seg.line, nNumber: seg.nNumber,
  };
}

function updateToolAtIndex(index) {
  if (!state.analysis.segments.length) {
    state.index = 0;
    updateHud(currentPosition());
    updateTimeline();
    return;
  }
  state.index = Math.max(0, Math.min(index, state.analysis.segments.length - 1));
  const pos = currentPosition();
  toolMesh.position.set(pos.x, pos.y, pos.z);
  updateHud(pos);
  renderNcList();
  drawSection();
  drawXY();
  updateTimeline();
}

function jumpToIndex(index) {
  state.analysis.segments.forEach((seg) => { seg.playhead = 0; });
  updateToolAtIndex(index);
}

function updateHud(pos) {
  $("hudX").textContent = fmt(pos.x);
  $("hudY").textContent = fmt(pos.y);
  $("hudZ").textContent = fmt(pos.z);
  $("hudF").textContent = fmt(pos.f, 0);
  $("hudS").textContent = fmt(pos.s, 0);
  $("hudT").textContent = fmt(pos.t, 0);
  $("currentLineLabel").textContent = pos.nNumber !== null && pos.nNumber !== undefined ? `N${String(pos.nNumber).padStart(6, "0")}` : (pos.line ? `L${pos.line}` : "----");
}

function renderSummary() {
  const inf = state.analysis.inferred;
  const tools = state.analysis.tools.length;
  const toolChanges = state.analysis.toolEvents.filter((e) => e.type === "P9000").length;
  const values = [
    ["加工面", inf.face],
    ["材料サイズ", `${fmt(inf.materialX, 0)}×${fmt(inf.materialY, 0)}`],
    ["推定材料厚", `${fmt(inf.materialThickness)}mm`],
    ["SafeZ", `${fmt(inf.safeZ)}mm`],
    ["ApproachZ", `${fmt(inf.approachZ)}mm`],
    ["工具", state.analysis.tools.map((t) => `T${t.tool}`).join(", ") || "-"],
    ["工具交換", `${toolChanges}回`],
    ["加工時間", formatTime(inf.timeSeconds)],
    ["最深Z", `${fmt(inf.minZ)}mm`],
    ["加工範囲X", `${fmt(inf.minX)}..${fmt(inf.maxX)}`],
    ["加工範囲Y", `${fmt(inf.minY)}..${fmt(inf.maxY)}`],
    ["G92原点", `X${fmt(inf.workOrigin.x)} Y${fmt(inf.workOrigin.y)}`],
  ];
  $("summaryGrid").innerHTML = values.map(([k, v]) => `<div class="metric"><span>${k}</span><strong>${v}</strong></div>`).join("");
}

function renderSafety() {
  const items = state.analysis.safety;
  const danger = items.some((i) => i.level === "danger");
  const warn = items.some((i) => i.level === "warn");
  const box = $("safetyState");
  box.className = `safety-state ${danger ? "danger" : warn ? "warn" : "ok"}`;
  box.textContent = danger ? "危険" : warn ? "注意" : "正常";
  $("safetyList").innerHTML = items.length
    ? items.map((i) => `<div class="safety-item ${i.level === "danger" ? "danger" : ""}">${i.line ? `L${i.line} ` : ""}${escapeHtml(i.message)}</div>`).join("")
    : `<div class="safety-item">異常は検出されていません</div>`;
}

function renderNcList() {
  const activeLine = currentPosition().line;
  $("ncList").innerHTML = state.analysis.rows.map((row) => {
    const active = row.line === activeLine ? " active" : "";
    const label = row.nNumber !== null && row.nNumber !== undefined ? `N${String(row.nNumber).padStart(6, "0")}` : `L${row.line}`;
    const block = row.motionIndex !== null && row.motionIndex !== undefined ? `B${String(row.motionIndex + 1).padStart(4, "0")}` : "----";
    return `<div class="nc-row${active}" data-motion="${row.motionIndex ?? ""}" data-line="${row.line}"><span class="line"><b>${block}</b>${label}</span><span>${escapeHtml(row.raw)}</span></div>`;
  }).join("");
  const active = $("ncList").querySelector(".nc-row.active");
  if (active) active.scrollIntoView({ block: "center" });
}

function drawSection() {
  const canvas = $("sectionCanvas");
  const ctx = canvas.getContext("2d");
  fitCanvas(canvas);
  const w = canvas.width;
  const h = canvas.height;
  const inf = state.analysis.inferred;
  const pos = currentPosition();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const minZ = Math.min(inf.materialBottomZ, inf.minZ, 0);
  const maxZ = Math.max(inf.safeZ, inf.maxZ, inf.materialThickness + 20);
  const yFor = (z) => h - 28 - ((z - minZ) / Math.max(1, maxZ - minZ)) * (h - 54);
  const lines = [
    ["SafeZ", inf.safeZ, "#0f766e"],
    ["ApproachZ", inf.approachZ, "#2563eb"],
    ["MaterialTop", inf.materialTopZ, "#111827"],
    ["MaterialBottom", inf.materialBottomZ, "#b45309"],
    ["MinZ", inf.minZ, "#b91c1c"],
  ];
  lines.forEach(([label, z, color]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(24, yFor(z));
    ctx.lineTo(w - 24, yFor(z));
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "12px Segoe UI";
    ctx.fillText(label, 28, yFor(z) - 4);
  });
  const toolY = yFor(pos.z);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(w * 0.66, toolY - 40);
  ctx.lineTo(w * 0.66, toolY);
  ctx.stroke();
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.moveTo(w * 0.66, toolY + 12);
  ctx.lineTo(w * 0.66 - 8, toolY);
  ctx.lineTo(w * 0.66 + 8, toolY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.font = "700 13px Consolas";
  ctx.fillText(`Z ${fmt(pos.z)}`, w * 0.66 + 14, toolY + 5);
}

function drawXY() {
  const canvas = $("xyCanvas");
  const ctx = canvas.getContext("2d");
  fitCanvas(canvas);
  const w = canvas.width;
  const h = canvas.height;
  const a = state.analysis;
  const inf = a.inferred;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const bounds = state.xyMode === "work"
    ? padBounds({ minX: inf.minX ?? 0, maxX: inf.maxX ?? inf.materialX, minY: inf.minY ?? 0, maxY: inf.maxY ?? inf.materialY }, 0.18)
    : { minX: 0, maxX: inf.materialX, minY: 0, maxY: inf.materialY };
  const pad = 18;
  const scale = Math.min((w - pad * 2) / Math.max(1, bounds.maxX - bounds.minX), (h - pad * 2) / Math.max(1, bounds.maxY - bounds.minY));
  const px = (p) => ({ x: pad + (p.x - bounds.minX) * scale, y: h - pad - (p.y - bounds.minY) * scale });
  const m0 = px({ x: 0, y: 0 });
  const m1 = px({ x: inf.materialX, y: inf.materialY });
  ctx.strokeStyle = "#8b95a1";
  ctx.lineWidth = 2;
  ctx.strokeRect(m0.x, m1.y, m1.x - m0.x, m0.y - m1.y);
  a.segments.forEach((seg, idx) => {
    const p0 = px(seg.from);
    const p1 = px(seg.to);
    ctx.strokeStyle = idx <= state.index ? (seg.type === "G00" ? "#6b7280" : "#0f766e") : "#cbd5df";
    ctx.lineWidth = idx === state.index ? 4 : 2;
    ctx.setLineDash(seg.type === "G00" ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  const pos = px(currentPosition());
  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
  ctx.fill();
}

function padBounds(b, ratio) {
  const dx = Math.max(1, b.maxX - b.minX);
  const dy = Math.max(1, b.maxY - b.minY);
  return { minX: b.minX - dx * ratio, maxX: b.maxX + dx * ratio, minY: b.minY - dy * ratio, maxY: b.maxY + dy * ratio };
}

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(220, Math.round(rect.width || canvas.width));
  const h = Math.max(160, Math.round(rect.height || canvas.height));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function updateTimeline() {
  const total = state.analysis.segments.length;
  $("timeline").max = Math.max(0, total - 1);
  $("timeline").value = state.index;
  const elapsed = state.analysis.segments.slice(0, state.index).reduce((sum, s) => sum + s.duration, 0);
  $("timeLabel").textContent = `${formatTime(elapsed)} / ${formatTime(state.analysis.inferred.timeSeconds)}`;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function loadNc(text) {
  state.playing = false;
  state.analysis = analyzeNc(text);
  state.index = 0;
  state.analysis.segments.forEach((s) => { s.playhead = 0; });
  updateCountLabels();
  $("viewerStatus").textContent = `${state.analysis.segments.length} motion blocks / ${state.analysis.rows.length} lines`;
  renderSummary();
  renderSafety();
  renderNcList();
  rebuildScene();
  updateToolAtIndex(0);
}

function scheduleAnalyze() {
  clearTimeout(window.ncTimer);
  window.ncTimer = setTimeout(() => {
    if ($("ncInput").value.trim()) loadNc($("ncInput").value);
  }, 300);
}

function updateCountLabels() {
  const blocks = state.analysis.segments.length;
  const lines = state.analysis.rows.length;
  $("blockCountLabel").textContent = `${blocks} blocks / ${lines} lines`;
  $("bottomCountLabel").textContent = `${blocks} motion blocks / ${lines} NC lines`;
}

function readNcFile(file) {
  if (!file) return;
  $("fileNameLabel").textContent = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "");
    $("ncInput").value = text;
    loadNc(text);
  };
  reader.onerror = () => {
    $("viewerStatus").textContent = "ファイル読込エラー";
  };
  reader.readAsText(file);
}

function step(delta) {
  state.playing = false;
  jumpToIndex(state.index + delta);
}

function bindEvents() {
  $("filePickBtn").addEventListener("click", () => $("fileInput").click());
  $("playBtn").addEventListener("click", () => { state.playing = true; });
  $("pauseBtn").addEventListener("click", () => { state.playing = false; });
  $("stopBtn").addEventListener("click", () => { state.playing = false; jumpToIndex(0); });
  $("prevBtn").addEventListener("click", () => step(-1));
  $("nextBtn").addEventListener("click", () => step(1));
  $("speedSelect").addEventListener("change", () => { state.speed = Number($("speedSelect").value); });
  $("timeline").addEventListener("input", () => { state.playing = false; jumpToIndex(Number($("timeline").value)); });
  $("ncInput").addEventListener("input", scheduleAnalyze);
  $("ncList").addEventListener("click", (event) => {
    const row = event.target.closest(".nc-row");
    if (!row) return;
    const motion = row.dataset.motion;
    if (motion !== "") {
      state.playing = false;
      jumpToIndex(Number(motion));
    }
  });
  $("xyMaterialBtn").addEventListener("click", () => {
    state.xyMode = "material";
    $("xyMaterialBtn").classList.add("active");
    $("xyWorkBtn").classList.remove("active");
    drawXY();
  });
  $("xyWorkBtn").addEventListener("click", () => {
    state.xyMode = "work";
    $("xyWorkBtn").classList.add("active");
    $("xyMaterialBtn").classList.remove("active");
    drawXY();
  });
  $("fileInput").addEventListener("change", (event) => {
    readNcFile(event.target.files?.[0]);
    event.target.value = "";
  });
  const drop = $("fileDrop");
  ["dragenter", "dragover"].forEach((name) => drop.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.add("drag");
  }));
  ["dragleave", "drop"].forEach((name) => drop.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.remove("drag");
  }));
  drop.addEventListener("drop", (event) => {
    event.stopPropagation();
    readNcFile(event.dataTransfer.files?.[0]);
  });
  ["dragenter", "dragover"].forEach((name) => document.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.add("drag");
  }));
  ["dragleave", "drop"].forEach((name) => document.addEventListener(name, (event) => {
    event.preventDefault();
    if (name === "drop") readNcFile(event.dataTransfer.files?.[0]);
    drop.classList.remove("drag");
  });
  window.addEventListener("resize", () => {
    const host = $("threeViewport");
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
    drawSection();
    drawXY();
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch]);
}

initThree();
bindEvents();
renderSummary();
renderSafety();
updateCountLabels();
drawSection();
drawXY();
