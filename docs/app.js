const $ = (id) => document.getElementById(id);
const fmt = (value, digits = 3) => value === null || value === undefined || Number.isNaN(value) ? "-" : Number(value).toFixed(digits);

const state = {
  analysis: emptyAnalysis(),
  index: 0,
  playing: false,
  speed: 1,
  lastFrame: 0,
  activeLineOverride: null,
  xyMode: "work",
  viewMode: "3d",
  followTool: false,
  playTime: 0,
  displayPos: null,
  xyView: { zoom: 1, panX: 0, panY: 0 },
  xyUserView: false,
  layout: { mode: "field", zHidden: false, ncHidden: false, xyFullscreen: false, sideWidth: 320, bottomHeight: 210 },
  threeOptions: { labels: false, axis: true, safeZ: true, origin: true, coords: false },
};

const perf = {
  lastHud: 0,
  lastNc: 0,
  lastNcScroll: 0,
  lastCanvas: 0,
  lastDoneTrace: 0,
  lastProfile: 0,
  frameCount: 0,
  fps: 0,
  drawMs: 0,
};

const quality = {
  mode: "standard",
  lightweight: false,
  smooth: true,
};

const LAYOUT_KEY = "shinxMotionViewerLayoutV2";

let scene;
let camera;
let renderer;
let controls;
let THREE;
let OrbitControls;
let threeReady = false;
let stockMesh;
let rangeBox;
let toolMesh;
let pathGroup;
let donePathGroup;
let markerGroup;
let referenceGroup;
let dynamicGroup;
let animationId;
let xyCacheCanvas;
let xyCacheInfo = null;
let sectionCacheCanvas;
let sectionCacheInfo = null;
let ncWindowStart = -1;
let lastDone3dIndex = -1;

function emptyAnalysis() {
  return {
    rows: [],
    motionRows: [],
    segments: [],
    motionBlocks: [],
    tools: [],
    toolEvents: [],
    important: {},
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
  const important = {
    g92: [],
    tool: [],
    spindleOn: [],
    spindleStop: [],
    materialTop: [],
    minZ: [],
    zDown: [],
    lowRapid: [],
    modeSwitch: [],
    warning: [],
  };
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
  const addPoint = (type, item) => {
    if (!important[type]) important[type] = [];
    important[type].push(item);
  };
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
        else if (code === 90 || code === 91) {
          const nextMode = `G${code}`;
          if (stateNc.mode !== nextMode) addPoint("modeSwitch", { line, label: `${nextMode}切替`, motionIndex: null });
          stateNc.mode = nextMode;
        }
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
      addPoint("tool", { line, label: "工具取得", motionIndex: null });
    }
    if (cleaned.includes("G65") && pCode === 9900) {
      stateNc.hasP9900 = true;
      toolInfo().p9900 = line;
      toolEvents.push({ line, type: "P9900", x: stateNc.x, y: stateNc.y, z: stateNc.z, tool: stateNc.tool });
      addPoint("tool", { line, label: "工具返却", motionIndex: null });
      stateNc.toolLoaded = false;
    }
    if (mCodes.includes(3) || cleaned.includes("M23")) addPoint("spindleOn", { line, label: "主軸ON", motionIndex: null });
    if ((words.some((w) => w.letter === "S" && w.value === 0)) || mCodes.includes(5)) addPoint("spindleStop", { line, label: "主軸停止", motionIndex: null });

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
      addPoint("g92", { line, label: "加工原点設定", motionIndex: null });
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
        addPoint("materialTop", { line, label: "材料上面へ下降", motionIndex: activeMotionIndex });
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
      if (stateNc.mode === "G91" && after.z < before.z) addPoint("zDown", { line, label: "Z下降", motionIndex: segment.index });
      if (stateNc.motion === "G00" && after.z <= (inferred.materialTopZ ?? 0) && (before.x !== after.x || before.y !== after.y)) {
        addPoint("lowRapid", { line, label: "G00低Z移動", motionIndex: segment.index });
      }
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
      desc: describeRow({ cleaned, mCodes, hasG92Line, segment, before, after, mode: stateNc.mode, motion: stateNc.motion }),
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
  safety.forEach((item) => {
    if (item.line) important.warning.push({ line: Number(item.line), label: item.message, motionIndex: motionIndexForLineInSegments(segments, Number(item.line)) });
  });
  if (segments.length) {
    const minSeg = segments.reduce((best, seg) => seg.to.z < best.to.z ? seg : best, segments[0]);
    important.minZ.push({ line: minSeg.line, label: "最深Z", motionIndex: minSeg.index });
  }

  const motionBlocks = segments.map((seg) => ({
    lineIndex: seg.line,
    ncLine: seg.raw,
    x: seg.to.x,
    y: seg.to.y,
    z: seg.to.z,
    f: seg.f,
    s: seg.s,
    t: seg.t,
    mode: seg.mode,
    type: seg.type,
    estimatedTime: seg.duration,
    cumulativeTime: seg.endTime,
    drawSegment: { from: seg.from, to: seg.to },
  }));

  return { rows, motionRows, segments, motionBlocks, toolEvents, important, tools: Array.from(toolMap.values()), safety, inferred };
}

function motionIndexForLineInSegments(segments, line) {
  if (!segments.length) return 0;
  const exact = segments.find((seg) => seg.line >= line);
  return exact ? exact.index : segments.length - 1;
}

function describeRow({ cleaned, mCodes, hasG92Line, segment, before, after, mode, motion }) {
  if (hasG92Line || cleaned.includes("G92")) return "加工原点設定";
  if (cleaned.includes("G65") && cleaned.includes("P9000")) return "工具取得";
  if (cleaned.includes("G65") && cleaned.includes("P9900")) return "工具返却";
  if (mCodes.includes(30)) return "終了";
  if (mCodes.includes(3) || cleaned.includes("M23")) return "主軸ON";
  if (mCodes.includes(5) || /\bS\s*0(?:\.0*)?\b/.test(cleaned)) return "主軸停止";
  if (cleaned.includes("M21")) return "加工準備";
  if (!segment) {
    if (cleaned.includes("G90") || cleaned.includes("G91")) return `${mode}モード`;
    return "NCブロック";
  }
  const xyMove = before.x !== after.x || before.y !== after.y;
  const zMove = before.z !== after.z;
  if (motion === "G00" && xyMove && !zMove) return "加工開始XYへ移動";
  if (motion === "G00" && zMove && after.z > before.z) return "Z上昇";
  if (motion === "G00" && zMove && after.z < before.z) return after.z > 0 ? "SafeZ/接近高さへ移動" : "Z下降";
  if (mode === "G91" && zMove && after.z < before.z) return "材料上面へ下降";
  if (["G01", "G02", "G03"].includes(motion) && zMove && after.z > before.z) return "Z上昇";
  if (["G01", "G02", "G03"].includes(motion)) return "切削中";
  return "移動";
}

async function initThree() {
  const threeModule = await import("https://unpkg.com/three@0.165.0/build/three.module.js");
  const controlsModule = await import("https://unpkg.com/three@0.165.0/examples/jsm/controls/OrbitControls.js");
  THREE = threeModule;
  OrbitControls = controlsModule.OrbitControls;
  const host = $("threeViewport");
  if (!host) return;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);
  camera = new THREE.PerspectiveCamera(45, Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight), 0.1, 10000);
  camera.position.set(360, -480, 320);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
  host.innerHTML = "";
  host.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(150, 150, 20);
  controls.update();
  controls.addEventListener("change", renderThreeScene);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2f3b45, 1.2));
  const dir = new THREE.DirectionalLight(0xffffff, 1.5);
  dir.position.set(200, -300, 500);
  scene.add(dir);
  scene.add(new THREE.GridHelper(600, 30, 0x52616d, 0x29343d));
  pathGroup = new THREE.Group();
  donePathGroup = new THREE.Group();
  markerGroup = new THREE.Group();
  referenceGroup = new THREE.Group();
  dynamicGroup = new THREE.Group();
  scene.add(pathGroup, donePathGroup, markerGroup, referenceGroup, dynamicGroup);
  toolMesh = createToolMesh();
  scene.add(toolMesh);
  threeReady = true;
  if (state.analysis.segments.length) rebuildScene();
  renderThreeScene();
}

function createToolMesh() {
  const group = new THREE.Group();
  const holder = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 2.8, 48, 20),
    new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.35, roughness: 0.35 })
  );
  holder.rotation.x = Math.PI / 2;
  holder.position.z = 24;
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(6.5, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.3, roughness: 0.4 })
  );
  tip.position.z = 0;
  group.add(holder, tip);
  return group;
}

function clearGroup(group) {
  if (!group) return;
  while (group.children.length) {
    const child = group.children.pop();
    child.geometry?.dispose?.();
    if (child.material?.map) child.material.map.dispose();
    child.material?.dispose?.();
  }
}

function lineObject(points, color, dashed = false, opacity = 1) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 6, gapSize: 4, transparent: opacity < 1, opacity })
    : new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  return line;
}

function rebuildScene() {
  if (!threeReady || !scene) return;
  const a = state.analysis;
  if (stockMesh) {
    scene.remove(stockMesh);
    stockMesh.geometry.dispose();
    stockMesh.material.dispose();
    stockMesh = null;
  }
  if (rangeBox) {
    scene.remove(rangeBox);
    rangeBox.geometry.dispose();
    rangeBox.material.dispose();
    rangeBox = null;
  }
  clearGroup(pathGroup);
  clearGroup(donePathGroup);
  clearGroup(markerGroup);
  clearGroup(referenceGroup);
  clearGroup(dynamicGroup);
  lastDone3dIndex = -1;

  const inf = a.inferred;
  a.segments.forEach((seg) => {
    const color = seg.type === "G00" ? 0x9ca3af : ["G02", "G03"].includes(seg.type) ? 0x2563eb : 0x0f766e;
    pathGroup.add(lineObject([vec(seg.from), vec(seg.to)], color, seg.type === "G00", 0.22));
  });

  addReferenceLines(inf);
  if (state.threeOptions.origin) {
    addMarker(inf.workOrigin, 0x7c3aed, "cross");
    addMarker({ x: inf.machineOrigin.x, y: inf.machineOrigin.y, z: 0 }, 0xdc2626, "diamond");
  }
  if (inf.start) addMarker(inf.start, 0x111827, "sphere", 5);
  if (inf.end) addMarker(inf.end, 0x111827, "box", 7);
  a.toolEvents.forEach((event) => addMarker(event, event.type === "P9000" ? 0xf59e0b : 0xdc2626, "cone", 7));

  reset3dCamera();
  updateToolAtIndex(0);
}

function addReferenceLines(inf) {
  const maxX = Math.max(inf.materialX || 300, inf.maxX || 0, 300);
  const maxY = Math.max(inf.materialY || 300, inf.maxY || 0, 300);
  const zMax = Math.max(inf.safeZ || 80, inf.maxZ || 0, 80);
  if (state.threeOptions.axis) {
    referenceGroup.add(lineObject([new THREE.Vector3(0, 0, 0), new THREE.Vector3(maxX, 0, 0)], 0xdc2626, false, 0.9));
    referenceGroup.add(lineObject([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, maxY, 0)], 0x16a34a, false, 0.9));
    referenceGroup.add(lineObject([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, zMax)], 0x2563eb, false, 0.9));
    if (state.threeOptions.labels) {
      referenceGroup.add(labelSprite("X", "#dc2626", { x: maxX + 18, y: 0, z: 0 }, 20));
      referenceGroup.add(labelSprite("Y", "#16a34a", { x: 0, y: maxY + 18, z: 0 }, 20));
      referenceGroup.add(labelSprite("Z", "#2563eb", { x: 0, y: 0, z: zMax + 14 }, 20));
    }
  }
  if (state.threeOptions.origin) {
    markerGroup.add(labelSprite("G92 X0 Y0", "#a78bfa", { x: 0, y: 0, z: Math.max(8, inf.materialTopZ || 0) }, 22));
  }
  [
    ["MaterialTop", inf.materialTopZ, 0xffffff],
    ["MaterialBottom", inf.materialBottomZ, 0xb45309],
    ["SafeZ", inf.safeZ, 0x0f766e],
    ["ApproachZ", inf.approachZ, 0x2563eb],
  ].forEach(([label, z, color]) => {
    if (!state.threeOptions.safeZ) return;
    const pts = [
      new THREE.Vector3(0, 0, z),
      new THREE.Vector3(maxX, 0, z),
      new THREE.Vector3(maxX, maxY, z),
      new THREE.Vector3(0, maxY, z),
      new THREE.Vector3(0, 0, z),
    ];
    referenceGroup.add(lineObject(pts, color, true, 0.6));
    if (state.threeOptions.labels) {
      referenceGroup.add(labelSprite(label, `#${color.toString(16).padStart(6, "0")}`, { x: maxX + 18, y: maxY, z }, 16));
    }
  });
}

function reset3dCamera() {
  set3dView("iso");
}

function set3dView(view) {
  if (!threeReady || !controls || !camera) return;
  const inf = state.analysis.inferred;
  const cx = (inf.materialX || 300) / 2;
  const cy = (inf.materialY || 300) / 2;
  const cz = Math.max(20, (inf.materialThickness || 30) / 2);
  const span = Math.max(inf.materialX || 300, inf.materialY || 300, (inf.safeZ || 80) * 2, 300);
  controls.target.set(cx, cy, cz);
  camera.up.set(0, 0, 1);
  if (view === "top") {
    camera.up.set(0, 1, 0);
    camera.position.set(cx, cy, Math.max(320, span * 1.45));
  } else if (view === "front") {
    camera.position.set(cx, -span * 1.45, cz + span * 0.25);
  } else if (view === "side") {
    camera.position.set(span * 1.45, cy, cz + span * 0.25);
  } else {
    camera.position.set(cx + span * 0.9, cy - span * 1.15, cz + Math.max(260, span * 0.75));
  }
  controls.update();
  renderThreeScene();
}

function vec(p) {
  return new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0);
}

function labelSprite(text, color, p, size = 32) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = "700 28px Segoe UI";
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width + 28);
  canvas.width = Math.max(96, width);
  canvas.height = 48;
  ctx.font = font;
  ctx.fillStyle = "rgba(16, 24, 32, .72)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 14, canvas.height / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(p.x || 0, p.y || 0, p.z || 0);
  sprite.scale.set(size * (canvas.width / canvas.height), size, 1);
  return sprite;
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

function updateThreeDonePath() {
  if (!threeReady || !donePathGroup) return;
  const current = state.index;
  if (current < lastDone3dIndex) {
    clearGroup(donePathGroup);
    lastDone3dIndex = -1;
  }
  const light = quality.lightweight || quality.mode === "light";
  const step = light ? 4 : 1;
  for (let idx = lastDone3dIndex + 1; idx <= current && idx < state.analysis.segments.length; idx += step) {
    const seg = state.analysis.segments[idx];
    const color = seg.type === "G00" ? 0x6b7280 : ["G02", "G03"].includes(seg.type) ? 0x2563eb : 0x0f766e;
    donePathGroup.add(lineObject([vec(seg.from), vec(seg.to)], color, seg.type === "G00", 0.95));
  }
  lastDone3dIndex = current;
}

function updateThreeTool(pos) {
  if (!threeReady || !toolMesh) return;
  toolMesh.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
  updateThreeDonePath();
  updateThreeDynamicGuides(pos);
  if (state.followTool && controls) {
    controls.target.set(pos.x || 0, pos.y || 0, pos.z || 0);
    controls.update();
  }
}

function updateThreeDynamicGuides(pos) {
  if (!threeReady || !dynamicGroup) return;
  clearGroup(dynamicGroup);
  const x = pos.x || 0;
  const y = pos.y || 0;
  const z = pos.z || 0;
  dynamicGroup.add(lineObject([new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, z)], 0xfbbf24, true, 0.9));
  dynamicGroup.add(new THREE.Mesh(
    new THREE.SphereGeometry(8, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xef4444 })
  ));
  dynamicGroup.children[dynamicGroup.children.length - 1].position.set(x, y, z);
  dynamicGroup.add(new THREE.Mesh(
    new THREE.SphereGeometry(4, 16, 10),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
  ));
  dynamicGroup.children[dynamicGroup.children.length - 1].position.set(x, y, 0);
  if (state.threeOptions.coords) {
    dynamicGroup.add(labelSprite(`X${fmt(x)} Y${fmt(y)} Z${fmt(z)}`, "#fbbf24", { x: x + 18, y: y + 18, z: z + 18 }, 16));
  }
}

function renderThreeScene() {
  if (!threeReady || !renderer || !camera || !$("threeViewport")) return;
  if (state.viewMode === "2d") return;
  const host = $("threeViewport");
  const w = Math.max(1, host.clientWidth);
  const h = Math.max(1, host.clientHeight);
  if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  renderer.render(scene, camera);
}

function animate(time = 0) {
  animationId = requestAnimationFrame(animate);
  updateFps(time);
  if (state.playing && state.analysis.segments.length) {
    advancePlayback(time);
  } else {
    throttledRender(time, false);
  }
  state.lastFrame = time;
}

function playbackBlockStep() {
  if ($("speedSelect").value === "max") return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.trunc(Number($("speedSelect").value) || 1));
}

function advancePlayback(now) {
  if (!state.analysis.segments.length) return;
  const speedValue = $("speedSelect").value;
  const light = quality.lightweight || quality.mode === "light";
  const useSmooth = quality.smooth && !light && speedValue !== "max";
  if (!useSmooth) {
    const next = Math.min(state.analysis.segments.length - 1, state.index + playbackBlockStep());
    state.index = next;
    state.displayPos = null;
    state.playTime = state.analysis.segments[next]?.endTime ?? state.playTime;
    if (state.index >= state.analysis.segments.length - 1) state.playing = false;
    throttledRender(now, true);
    return;
  }
  const dt = Math.max(0, Math.min(150, now - (state.lastFrame || now))) / 1000;
  const speed = Math.max(0.1, Number(speedValue) || 1);
  state.playTime += dt * speed;
  const total = state.analysis.inferred.timeSeconds || 0;
  if (state.playTime >= total) {
    state.playTime = total;
    state.index = state.analysis.segments.length - 1;
    state.displayPos = null;
    state.playing = false;
  } else {
    const seg = segmentAtTime(state.playTime);
    if (seg) {
      state.index = seg.index;
      state.displayPos = interpolateSegment(seg, state.playTime);
    }
  }
  throttledRender(performance.now(), true);
}

function currentPosition() {
  if (state.displayPos) return state.displayPos;
  const seg = state.analysis.segments[state.index];
  if (!seg) return { x: 0, y: 0, z: 0, f: null, s: null, t: null, line: null };
  return {
    x: seg.to.x,
    y: seg.to.y,
    z: seg.to.z,
    f: seg.f, s: seg.s, t: seg.t, line: seg.line, nNumber: seg.nNumber,
  };
}

function segmentAtTime(seconds) {
  const segments = state.analysis.segments;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = segments[mid];
    if (seconds < seg.startTime) hi = mid - 1;
    else if (seconds > seg.endTime) lo = mid + 1;
    else return seg;
  }
  return segments[Math.max(0, Math.min(segments.length - 1, lo))];
}

function interpolateSegment(seg, seconds) {
  const ratio = Math.max(0, Math.min(1, (seconds - seg.startTime) / Math.max(0.001, seg.duration)));
  const lerp = (a, b) => a + (b - a) * ratio;
  return {
    x: lerp(seg.from.x, seg.to.x),
    y: lerp(seg.from.y, seg.to.y),
    z: lerp(seg.from.z, seg.to.z),
    f: seg.f,
    s: seg.s,
    t: seg.t,
    line: seg.line,
    nNumber: seg.nNumber,
    segment: seg,
    ratio,
  };
}

function updateToolAtIndex(index, options = {}) {
  if (!state.analysis.segments.length) {
    state.index = 0;
    state.displayPos = null;
    state.playTime = 0;
    if (!options.keepActiveLine) state.activeLineOverride = null;
    updateHud(currentPosition());
    updateTimeline();
    return;
  }
  state.index = Math.max(0, Math.min(index, state.analysis.segments.length - 1));
  state.displayPos = null;
  state.playTime = state.analysis.segments[state.index]?.startTime ?? 0;
  if (!options.keepActiveLine) state.activeLineOverride = null;
  renderAllNow();
}

function jumpToIndex(index) {
  updateToolAtIndex(index);
}

function renderAllNow() {
  const now = performance.now();
  const pos = currentPosition();
  if (toolMesh) toolMesh.position.set(pos.x, pos.y, pos.z);
  updateThreeTool(pos);
  updateHud(pos);
  ncWindowStart = -1;
  renderNcList(true);
  drawSection(true);
  drawXY(true);
  renderThreeScene();
  updateTimeline();
  perf.lastHud = now;
  perf.lastNc = now;
  perf.lastNcScroll = now;
  perf.lastCanvas = now;
}

function throttledRender(now, playing) {
  const light = quality.lightweight || quality.mode === "light";
  const hudInterval = playing ? 100 : 0;
  const ncInterval = playing ? (light ? 500 : 200) : 0;
  const canvasInterval = playing ? (light ? 100 : 33) : 0;
  const pos = currentPosition();
  if (!playing || now - perf.lastHud >= hudInterval) {
    updateHud(pos);
    updateTimeline();
    perf.lastHud = now;
  }
  if (!playing || now - perf.lastCanvas >= canvasInterval) {
    const start = performance.now();
    updateThreeTool(pos);
    drawXY(false);
    drawSection(false);
    renderThreeScene();
    perf.drawMs = performance.now() - start;
    perf.lastCanvas = now;
  }
  if (!playing || now - perf.lastNc >= ncInterval) {
    const shouldScroll = !light && now - perf.lastNcScroll > 300;
    renderNcList(shouldScroll);
    perf.lastNc = now;
    if (shouldScroll) perf.lastNcScroll = now;
  }
  if (!playing || now - perf.lastProfile > 250) {
    updateProfile();
    perf.lastProfile = now;
  }
}

function updateHud(pos) {
  $("hudX").textContent = fmt(pos.x);
  $("hudY").textContent = fmt(pos.y);
  $("hudZ").textContent = fmt(pos.z);
  $("hudF").textContent = fmt(pos.f, 0);
  $("hudS").textContent = fmt(pos.s, 0);
  $("hudT").textContent = fmt(pos.t, 0);
  const line = activeLine();
  const row = state.analysis.rows.find((item) => item.line === line);
  const nNumber = row?.nNumber ?? pos.nNumber;
  $("currentLineLabel").textContent = nNumber !== null && nNumber !== undefined ? `N${String(nNumber).padStart(6, "0")}` : (line ? `L${line}` : "----");
  $("currentDescLabel").textContent = row?.desc || "NCブロック";
}

function updateFps(time) {
  perf.frameCount += 1;
  if (!perf.fpsStart) perf.fpsStart = time;
  const elapsed = time - perf.fpsStart;
  if (elapsed >= 500) {
    perf.fps = perf.frameCount / elapsed * 1000;
    perf.frameCount = 0;
    perf.fpsStart = time;
  }
}

function updateProfile() {
  $("profileLabel").textContent = `FPS ${fmt(perf.fps, 0)} / B${state.index + 1} / draw ${fmt(perf.drawMs, 1)}ms`;
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

function renderNcList(autoScroll = false) {
  const activeLine = activeLine();
  const activeRowIndex = Math.max(0, state.analysis.rows.findIndex((row) => row.line === activeLine));
  const radius = quality.lightweight || quality.mode === "light" ? 18 : 50;
  const start = Math.max(0, activeRowIndex - radius);
  const end = Math.min(state.analysis.rows.length, activeRowIndex + radius + 1);
  if (ncWindowStart === start && $("ncList").dataset.activeLine === String(activeLine)) {
    return;
  }
  ncWindowStart = start;
  $("ncList").dataset.activeLine = String(activeLine);
  const topPad = start > 0 ? `<div class="nc-pad">... ${start} lines above ...</div>` : "";
  const bottomPad = end < state.analysis.rows.length ? `<div class="nc-pad">... ${state.analysis.rows.length - end} lines below ...</div>` : "";
  const rowsHtml = state.analysis.rows.slice(start, end).map((row) => {
    const active = row.line === activeLine ? " active" : "";
    const label = row.nNumber !== null && row.nNumber !== undefined ? `N${String(row.nNumber).padStart(6, "0")}` : `L${row.line}`;
    const block = row.motionIndex !== null && row.motionIndex !== undefined ? `B${String(row.motionIndex + 1).padStart(4, "0")}` : "----";
    return `<div class="nc-row${active}" data-motion="${row.motionIndex ?? ""}" data-line="${row.line}"><span class="line"><b>${block}</b>${label}</span><span>${escapeHtml(row.raw)}</span></div>`;
  }).join("");
  $("ncList").innerHTML = topPad + rowsHtml + bottomPad;
  if (autoScroll) {
    const active = $("ncList").querySelector(".nc-row.active");
    if (active) active.scrollIntoView({ block: "center" });
  }
}

function drawSection(forceCache = false) {
  const canvas = $("sectionCanvas");
  const ctx = canvas.getContext("2d");
  fitCanvas(canvas);
  const w = canvas.width;
  const h = canvas.height;
  const inf = state.analysis.inferred;
  const pos = currentPosition();
  const cacheKey = `${w},${h},${inf.safeZ},${inf.approachZ},${inf.materialTopZ},${inf.materialBottomZ},${inf.minZ},${inf.maxZ}`;
  if (forceCache || !sectionCacheCanvas || sectionCacheInfo !== cacheKey) {
    sectionCacheCanvas = document.createElement("canvas");
    sectionCacheCanvas.width = w;
    sectionCacheCanvas.height = h;
    const cctx = sectionCacheCanvas.getContext("2d");
    cctx.fillStyle = "#fff";
    cctx.fillRect(0, 0, w, h);
    drawSectionStatic(cctx, w, h, inf);
    sectionCacheInfo = cacheKey;
  }
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(sectionCacheCanvas, 0, 0);
  drawSectionTool(ctx, w, h, inf, pos);
}

function drawSectionStatic(ctx, w, h, inf) {
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
}

function drawSectionTool(ctx, w, h, inf, pos) {
  const minZ = Math.min(inf.materialBottomZ, inf.minZ, 0);
  const maxZ = Math.max(inf.safeZ, inf.maxZ, inf.materialThickness + 20);
  const yFor = (z) => h - 28 - ((z - minZ) / Math.max(1, maxZ - minZ)) * (h - 54);
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

function drawXY(forceCache = false) {
  const canvas = $("xyCanvas");
  const ctx = canvas.getContext("2d");
  fitCanvas(canvas);
  const w = canvas.width;
  const h = canvas.height;
  const a = state.analysis;
  const inf = a.inferred;
  const cacheKey = `${w},${h},${state.xyMode},${state.xyView.zoom},${state.xyView.panX},${state.xyView.panY},${inf.materialX},${inf.materialY},${inf.minX},${inf.maxX},${inf.minY},${inf.maxY},${a.segments.length},${quality.mode},${quality.lightweight}`;
  const transform = xyTransform(w, h, inf);
  if (forceCache || !xyCacheCanvas || xyCacheInfo !== cacheKey) {
    xyCacheCanvas = document.createElement("canvas");
    xyCacheCanvas.width = w;
    xyCacheCanvas.height = h;
    const cctx = xyCacheCanvas.getContext("2d");
    drawXYStatic(cctx, w, h, a, inf, transform);
    xyCacheInfo = cacheKey;
    perf.lastDoneTrace = -1;
  }
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(xyCacheCanvas, 0, 0);
  drawXYDynamic(ctx, a, transform);
}

function xyTransform(w, h, inf) {
  const bounds = state.xyMode === "work"
    ? padBounds({ minX: inf.minX ?? 0, maxX: inf.maxX ?? inf.materialX, minY: inf.minY ?? 0, maxY: inf.maxY ?? inf.materialY }, 0.18)
    : { minX: 0, maxX: inf.materialX, minY: 0, maxY: inf.materialY };
  const pad = 18;
  const baseScale = Math.min((w - pad * 2) / Math.max(1, bounds.maxX - bounds.minX), (h - pad * 2) / Math.max(1, bounds.maxY - bounds.minY));
  const scale = baseScale * state.xyView.zoom;
  const baseX = pad + state.xyView.panX;
  const baseY = h - pad + state.xyView.panY;
  return { pad, scale, bounds, h, px: (p) => ({ x: baseX + (p.x - bounds.minX) * scale, y: baseY - (p.y - bounds.minY) * scale }) };
}

function drawXYStatic(ctx, w, h, a, inf, transform) {
  const px = transform.px;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const m0 = px({ x: 0, y: 0 });
  const m1 = px({ x: inf.materialX, y: inf.materialY });
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(m0.x, m1.y, m1.x - m0.x, m0.y - m1.y);
  ctx.strokeStyle = "#8b95a1";
  ctx.lineWidth = 2;
  ctx.strokeRect(m0.x, m1.y, m1.x - m0.x, m0.y - m1.y);
  const r0 = px({ x: inf.minX ?? 0, y: inf.minY ?? 0 });
  const r1 = px({ x: inf.maxX ?? inf.materialX, y: inf.maxY ?? inf.materialY });
  ctx.strokeStyle = "#9333ea";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([7, 5]);
  ctx.strokeRect(r0.x, r1.y, r1.x - r0.x, r0.y - r1.y);
  ctx.setLineDash([]);
  a.segments.forEach((seg, idx) => {
    if ((quality.mode === "light" || quality.lightweight) && idx % 3 !== 0) return;
    const p0 = px(seg.from);
    const p1 = px(seg.to);
    ctx.strokeStyle = "#cbd5df";
    ctx.lineWidth = 1.5;
    ctx.setLineDash(seg.type === "G00" ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  drawCross2d(ctx, px({ x: 0, y: 0 }), 10, "#111827");
  if (inf.start) {
    const p = px(inf.start);
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  if (inf.end) {
    const p = px(inf.end);
    ctx.fillStyle = "#111827";
    ctx.fillRect(p.x - 6, p.y - 6, 12, 12);
  }
  a.toolEvents.forEach((event) => {
    const p = px(event);
    ctx.fillStyle = event.type === "P9000" ? "#f59e0b" : "#dc2626";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 8);
    ctx.lineTo(p.x + 8, p.y + 8);
    ctx.lineTo(p.x - 8, p.y + 8);
    ctx.closePath();
    ctx.fill();
  });
}

function drawXYDynamic(ctx, a, transform) {
  const px = transform.px;
  const current = state.index;
  const light = quality.lightweight || quality.mode === "light";
  const drawEvery = light ? 4 : 1;
  const start = light ? Math.max(0, current - 200) : 0;
  for (let idx = start; idx <= current && idx < a.segments.length; idx += drawEvery) {
    drawXYSegment(ctx, px, a.segments[idx], idx === current);
  }
  if (light && current % drawEvery !== 0 && a.segments[current]) {
    drawXYSegment(ctx, px, a.segments[current], true);
  }
  ctx.setLineDash([]);
  const currentPos = currentPosition();
  const pos = px(currentPos);
  drawDirectionArrow(ctx, px, currentPos);
  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawXYSegment(ctx, px, seg, active) {
  const p0 = px(seg.from);
  const p1 = px(seg.to);
  const cutColor = ["G02", "G03"].includes(seg.type) ? "#2563eb" : "#0f766e";
  ctx.strokeStyle = seg.type === "G00" ? "#6b7280" : cutColor;
  ctx.lineWidth = active ? 4 : 2;
  ctx.setLineDash(seg.type === "G00" ? [5, 4] : []);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
}

function drawDirectionArrow(ctx, px, pos) {
  const seg = pos.segment || state.analysis.segments[state.index];
  if (!seg) return;
  const p0 = px(seg.from);
  const p1 = px(seg.to);
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  if (!Number.isFinite(angle) || Math.hypot(p1.x - p0.x, p1.y - p0.y) < 2) return;
  const tip = px(pos);
  const size = 18;
  ctx.strokeStyle = "#dc2626";
  ctx.fillStyle = "#dc2626";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(tip.x - Math.cos(angle) * size, tip.y - Math.sin(angle) * size);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - Math.cos(angle - 0.55) * 10, tip.y - Math.sin(angle - 0.55) * 10);
  ctx.lineTo(tip.x - Math.cos(angle + 0.55) * 10, tip.y - Math.sin(angle + 0.55) * 10);
  ctx.closePath();
  ctx.fill();
}

function drawCross2d(ctx, p, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x - size, p.y);
  ctx.lineTo(p.x + size, p.y);
  ctx.moveTo(p.x, p.y - size);
  ctx.lineTo(p.x, p.y + size);
  ctx.stroke();
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
  const block = state.analysis.motionBlocks[state.index];
  const elapsed = state.playing && quality.smooth ? state.playTime : block ? block.cumulativeTime : 0;
  $("timeLabel").textContent = `${formatTime(elapsed)} / ${formatTime(state.analysis.inferred.timeSeconds)}`;
}

function activeLine() {
  return state.activeLineOverride || currentPosition().line;
}

function motionIndexForLine(line) {
  if (!state.analysis.segments.length) return 0;
  const exact = state.analysis.segments.find((seg) => seg.line >= line);
  return exact ? exact.index : state.analysis.segments.length - 1;
}

function jumpToPoint(type) {
  const points = state.analysis.important?.[type] || [];
  if (!points.length) return;
  const currentLine = activeLine() || 0;
  const point = points.find((item) => Number(item.line || 0) > currentLine) || points[0];
  state.activeLineOverride = Number(point.line || 0) || null;
  updateToolAtIndex(point.motionIndex ?? motionIndexForLine(Number(point.line || 0)), { keepActiveLine: true });
}

function jumpToFirstCut() {
  const target = state.analysis.segments.find((seg) => ["G01", "G02", "G03"].includes(seg.type));
  if (target) jumpToIndex(target.index);
}

function jumpToNextToolChange() {
  jumpToPoint("tool");
}

function jumpToNextWarning() {
  jumpToPoint("warning");
}

function jumpToMinZ() {
  jumpToPoint("minZ");
}

function jumpToEnd() {
  if (state.analysis.segments.length) jumpToIndex(state.analysis.segments.length - 1);
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
  state.playTime = 0;
  state.displayPos = null;
  state.activeLineOverride = null;
  invalidateCanvasCaches();
  ncWindowStart = -1;
  state.analysis.segments.forEach((s) => { s.playhead = 0; });
  updateCountLabels();
  $("viewerStatus").textContent = `${state.analysis.segments.length} motion blocks / ${state.analysis.rows.length} lines`;
  renderSummary();
  renderSafety();
  renderNcList();
  rebuildScene();
  updateToolAtIndex(0);
}

function invalidateCanvasCaches() {
  xyCacheCanvas = null;
  xyCacheInfo = null;
  sectionCacheCanvas = null;
  sectionCacheInfo = null;
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

function startPlayback() {
  if (!state.analysis.segments.length) return;
  state.activeLineOverride = null;
  if (state.index >= state.analysis.segments.length - 1) {
    state.index = 0;
    state.playTime = 0;
  } else {
    state.playTime = state.displayPos ? state.playTime : state.analysis.segments[state.index]?.startTime ?? 0;
  }
  state.displayPos = null;
  state.lastFrame = 0;
  state.playing = true;
}

function saveLayout() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...state.layout, xyView: state.xyView, viewMode: state.viewMode, followTool: state.followTool, threeOptions: state.threeOptions }));
  } catch {
    // localStorage may be disabled in some embedded browsers.
  }
}

function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}");
    state.layout = { ...state.layout, ...saved };
    if (saved.xyView) state.xyView = { ...state.xyView, ...saved.xyView };
    if (saved.viewMode) state.viewMode = saved.viewMode;
    if (typeof saved.followTool === "boolean") state.followTool = saved.followTool;
    if (saved.threeOptions) state.threeOptions = { ...state.threeOptions, ...saved.threeOptions };
  } catch {
    // Keep defaults.
  }
  applyLayout();
}

function applyLayout() {
  document.documentElement.style.setProperty("--side-width", `${state.layout.sideWidth}px`);
  document.documentElement.style.setProperty("--bottom-height", `${state.layout.bottomHeight}px`);
  document.body.classList.toggle("field-mode", state.layout.mode === "field");
  document.body.classList.toggle("detail-mode", state.layout.mode === "detail");
  document.body.classList.toggle("z-hidden", state.layout.zHidden);
  document.body.classList.toggle("nc-hidden", state.layout.ncHidden);
  document.body.classList.toggle("xy-fullscreen", state.layout.xyFullscreen);
  document.body.classList.toggle("view-2d", state.viewMode === "2d");
  document.body.classList.toggle("view-3d", state.viewMode === "3d");
  document.body.classList.toggle("view-split", state.viewMode === "split");
  $("fieldModeBtn").classList.toggle("active", state.layout.mode === "field");
  $("detailModeBtn").classList.toggle("active", state.layout.mode === "detail");
  $("toggleZBtn").textContent = state.layout.zHidden ? "表示" : "非表示";
  $("toggleNcBtn").textContent = state.layout.ncHidden ? "NC表示" : "NC非表示";
  $("xyFullscreenBtn").textContent = state.layout.xyFullscreen ? "戻る" : "全画面";
  $("viewModeSelect").value = state.viewMode;
  $("followToolToggle").checked = state.followTool;
  $("labelToggle").checked = state.threeOptions.labels;
  $("axisToggle").checked = state.threeOptions.axis;
  $("safeZToggle").checked = state.threeOptions.safeZ;
  $("originToggle").checked = state.threeOptions.origin;
  $("coordToggle").checked = state.threeOptions.coords;
  $("mainViewTitle").textContent = state.viewMode === "2d" ? "XY Motion" : state.viewMode === "split" ? "2D + 3D Motion" : "3D Motion";
  invalidateCanvasCaches();
  requestAnimationFrame(() => {
    drawXY(true);
    drawSection(true);
    renderThreeScene();
  });
}

function setLayoutMode(mode) {
  state.layout.mode = mode;
  if (mode === "field") {
    state.layout.sideWidth = Math.min(state.layout.sideWidth || 320, 340);
    state.layout.bottomHeight = Math.min(state.layout.bottomHeight || 210, 220);
  } else {
    state.layout.sideWidth = Math.max(state.layout.sideWidth || 420, 420);
    state.layout.bottomHeight = Math.max(state.layout.bottomHeight || 320, 320);
  }
  applyLayout();
  saveLayout();
}

function makeResizer(handle, onDrag) {
  let active = false;
  handle.addEventListener("pointerdown", (event) => {
    active = true;
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener("pointermove", (event) => {
    if (!active) return;
    onDrag(event);
    applyLayout();
  });
  handle.addEventListener("pointerup", (event) => {
    if (!active) return;
    active = false;
    handle.releasePointerCapture(event.pointerId);
    saveLayout();
  });
}

function bindLayoutControls() {
  $("fieldModeBtn").addEventListener("click", () => setLayoutMode("field"));
  $("detailModeBtn").addEventListener("click", () => setLayoutMode("detail"));
  $("toggleZBtn").addEventListener("click", () => {
    state.layout.zHidden = !state.layout.zHidden;
    applyLayout();
    saveLayout();
  });
  $("toggleNcBtn").addEventListener("click", () => {
    state.layout.ncHidden = !state.layout.ncHidden;
    applyLayout();
    saveLayout();
  });
  $("xyFullscreenBtn").addEventListener("click", () => {
    state.layout.xyFullscreen = !state.layout.xyFullscreen;
    applyLayout();
    saveLayout();
  });
  makeResizer($("sideResizer"), (event) => {
    const rect = $("motionLayout").getBoundingClientRect();
    state.layout.sideWidth = Math.max(240, Math.min(560, rect.right - event.clientX - 10));
  });
  makeResizer($("bottomResizer"), (event) => {
    const rect = $("motionLayout").getBoundingClientRect();
    state.layout.bottomHeight = Math.max(80, Math.min(460, rect.bottom - event.clientY - 10));
  });
}

function bindXyPointerControls() {
  const canvas = $("xyCanvas");
  let drag = null;
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const oldZoom = state.xyView.zoom;
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nextZoom = Math.max(0.35, Math.min(12, oldZoom * factor));
    const ratio = nextZoom / oldZoom;
    state.xyView.panX = x - (x - state.xyView.panX) * ratio;
    state.xyView.panY = y - (y - state.xyView.panY) * ratio;
    state.xyView.zoom = nextZoom;
    state.xyUserView = true;
    invalidateCanvasCaches();
    drawXY(true);
    saveLayout();
  }, { passive: false });
  canvas.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY, panX: state.xyView.panX, panY: state.xyView.panY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    state.xyView.panX = drag.panX + event.clientX - drag.x;
    state.xyView.panY = drag.panY + event.clientY - drag.y;
    state.xyUserView = true;
    invalidateCanvasCaches();
    drawXY(true);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!drag) return;
    drag = null;
    canvas.releasePointerCapture(event.pointerId);
    saveLayout();
  });
  canvas.addEventListener("dblclick", () => {
    state.xyView = { zoom: 1, panX: 0, panY: 0 };
    state.xyUserView = false;
    invalidateCanvasCaches();
    drawXY(true);
    saveLayout();
  });
}

function bindEvents() {
  $("filePickBtn").addEventListener("click", () => $("fileInput").click());
  $("playBtn").addEventListener("click", startPlayback);
  $("pauseBtn").addEventListener("click", () => { state.playing = false; renderAllNow(); });
  $("stopBtn").addEventListener("click", () => { state.playing = false; state.displayPos = null; jumpToIndex(0); });
  $("prevBtn").addEventListener("click", () => step(-1));
  $("nextBtn").addEventListener("click", () => step(1));
  $("speedSelect").addEventListener("change", () => { state.speed = Number($("speedSelect").value); });
  $("smoothModeToggle").addEventListener("change", () => {
    quality.smooth = $("smoothModeToggle").checked;
    state.displayPos = null;
    renderAllNow();
  });
  $("lightModeToggle").addEventListener("change", () => {
    quality.lightweight = $("lightModeToggle").checked;
    invalidateCanvasCaches();
    renderAllNow();
  });
  $("qualitySelect").addEventListener("change", () => {
    quality.mode = $("qualitySelect").value;
    quality.lightweight = quality.mode === "light" || $("lightModeToggle").checked;
    invalidateCanvasCaches();
    renderAllNow();
  });
  $("viewModeSelect").addEventListener("change", () => {
    state.viewMode = $("viewModeSelect").value;
    applyLayout();
    saveLayout();
    renderAllNow();
  });
  $("reset3dBtn").addEventListener("click", reset3dCamera);
  $("viewTopBtn").addEventListener("click", () => set3dView("top"));
  $("viewFrontBtn").addEventListener("click", () => set3dView("front"));
  $("viewSideBtn").addEventListener("click", () => set3dView("side"));
  $("viewIsoBtn").addEventListener("click", () => set3dView("iso"));
  $("followToolToggle").addEventListener("change", () => {
    state.followTool = $("followToolToggle").checked;
    saveLayout();
    renderAllNow();
  });
  ["labelToggle", "axisToggle", "safeZToggle", "originToggle", "coordToggle"].forEach((id) => {
    $(id).addEventListener("change", () => {
      state.threeOptions = {
        labels: $("labelToggle").checked,
        axis: $("axisToggle").checked,
        safeZ: $("safeZToggle").checked,
        origin: $("originToggle").checked,
        coords: $("coordToggle").checked,
      };
      saveLayout();
      rebuildScene();
      renderAllNow();
    });
  });
  $("jumpG92Btn").addEventListener("click", () => jumpToPoint("g92"));
  $("jumpMaterialTopBtn").addEventListener("click", () => jumpToPoint("materialTop"));
  $("jumpZDownBtn").addEventListener("click", () => jumpToPoint("zDown"));
  $("jumpLowRapidBtn").addEventListener("click", () => jumpToPoint("lowRapid"));
  $("jumpStartBtn").addEventListener("click", jumpToFirstCut);
  $("jumpToolBtn").addEventListener("click", jumpToNextToolChange);
  $("jumpWarnBtn").addEventListener("click", jumpToNextWarning);
  $("jumpMinZBtn").addEventListener("click", jumpToMinZ);
  $("jumpEndBtn").addEventListener("click", jumpToEnd);
  $("timeline").addEventListener("input", () => { state.playing = false; jumpToIndex(Number($("timeline").value)); });
  $("ncInput").addEventListener("input", scheduleAnalyze);
  $("ncList").addEventListener("click", (event) => {
    const row = event.target.closest(".nc-row");
    if (!row) return;
    const motion = row.dataset.motion;
    if (motion !== "") {
      state.playing = false;
      jumpToIndex(Number(motion));
    } else {
      state.playing = false;
      state.activeLineOverride = Number(row.dataset.line || 0) || null;
      updateToolAtIndex(motionIndexForLine(Number(row.dataset.line || 0)), { keepActiveLine: true });
    }
  });
  $("xyMaterialBtn").addEventListener("click", () => {
    state.xyMode = "material";
    $("xyMaterialBtn").classList.add("active");
    $("xyWorkBtn").classList.remove("active");
    invalidateCanvasCaches();
    drawXY(true);
  });
  $("xyWorkBtn").addEventListener("click", () => {
    state.xyMode = "work";
    $("xyWorkBtn").classList.add("active");
    $("xyMaterialBtn").classList.remove("active");
    invalidateCanvasCaches();
    drawXY(true);
  });
  bindXyPointerControls();
  bindLayoutControls();
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
  }));
  window.addEventListener("resize", () => {
    drawSection();
    drawXY();
    renderThreeScene();
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch]);
}

bindEvents();
loadLayout();
renderSummary();
renderSafety();
updateCountLabels();
drawSection();
drawXY();
initThree().catch(() => {
  $("viewerStatus").textContent = "3D初期化エラー";
});
animate();
