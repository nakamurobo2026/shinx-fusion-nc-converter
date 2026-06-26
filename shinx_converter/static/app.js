const fields = [
  "machine_origin_x",
  "machine_origin_y",
  "safe_z",
  "approach_z",
  "spindle_speed",
  "plunge_feed",
  "cut_start_depth",
  "max_cut_depth",
  "material_size_x",
  "material_size_y",
  "material_thickness",
  "clearance",
];

let currentConfig = null;
let convertedText = "";

const $ = (id) => document.getElementById(id);

async function loadConfig() {
  const res = await fetch("/api/config");
  currentConfig = await res.json();
  renderConfig();
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
  const cfg = structuredClone(currentConfig || {});
  fields.forEach((name) => {
    cfg[name] = Number($(name).value);
  });
  cfg.tool_mapping = {};
  for (let i = 1; i <= 7; i += 1) {
    cfg.tool_mapping[String(i)] = Number($(`tool_${i}`).value);
  }
  return cfg;
}

async function saveConfigOnly() {
  currentConfig = collectConfig();
  await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentConfig),
  });
}

async function convert() {
  await saveConfigOnly();
  const res = await fetch("/api/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: $("inputCode").value, config: currentConfig }),
  });
  const data = await res.json();
  convertedText = data.output;
  $("outputCode").value = convertedText;
  $("logOutput").innerHTML = renderLog(data.log);
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
    `加工開始XY: X${fmt(log.first_cut?.x)} Y${fmt(log.first_cut?.y)}`,
    `加工範囲: X ${fmt(ranges.min_x)} .. ${fmt(ranges.max_x)} / Y ${fmt(ranges.min_y)} .. ${fmt(ranges.max_y)} / Z ${fmt(ranges.min_z)} .. ${fmt(ranges.max_z)}`,
    `本文行数: ${log.body_line_count}`,
    `IJK→R変換: ${log.converted_arc_count || 0} 行`,
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

function fmt(value) {
  return value === null || value === undefined ? "-" : Number(value).toFixed(3);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[ch]);
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

loadConfig();
