/**
  SHINX 20ZXGN post processor for Autodesk Fusion 360.

  Design rule:
  - Do not recalculate Fusion toolpath coordinates, Z depths, feeds, or arcs.
  - Keep Fanuc-style motion output simple and modal.
  - Add only SHINX-specific machine preparation, tool macro, origin, and footer code.
*/

description = "SHINX 20ZXGN";
vendor = "SHINX";
vendorUrl = "";
legal = "Use at your own risk. Verify with dry-run before machining.";
certificationLevel = 2;
minimumRevision = 45821;

longDescription = "SHINX 20ZXGN post based on Fanuc-style Fusion motion output with SHINX tool macros and G92 origin setup.";

extension = "nc";
programNameIsInteger = false;
setCodePage("ascii");

var SHINX_POST_VERSION = "2026-06-26-auto-height1";

capabilities = CAPABILITY_MILLING;
tolerance = spatial(0.002, MM);
minimumChordLength = spatial(0.25, MM);
minimumCircularRadius = spatial(0.01, MM);
maximumCircularRadius = spatial(1000, MM);
minimumCircularSweep = toRad(0.01);
maximumCircularSweep = toRad(180);
allowHelicalMoves = true;
allowedCircularPlanes = undefined;

properties = {
  machiningFace: {
    title: "Machining face",
    description: "Registered machining face number. Face 8 defaults to the template origin.",
    group: "shinx",
    type: "integer",
    value: 8,
    scope: "post"
  },
  machineOriginX: {
    title: "Machine origin X",
    description: "Machine-side machining origin X.",
    group: "shinx",
    type: "number",
    value: -1303.520,
    scope: "post"
  },
  machineOriginY: {
    title: "Machine origin Y",
    description: "Machine-side machining origin Y.",
    group: "shinx",
    type: "number",
    value: -2610.910,
    scope: "post"
  },
  safeZ: {
    title: "Safe Z",
    description: "Manual SHINX safe Z used when autoSafeHeight is false.",
    group: "shinx",
    type: "number",
    value: 60.0,
    scope: "post"
  },
  autoSafeHeight: {
    title: "Auto safe height",
    description: "Calculate SHINX safe/approach heights from stock or model thickness.",
    group: "shinx",
    type: "boolean",
    value: true,
    scope: "post"
  },
  safeClearance: {
    title: "Safe clearance",
    description: "Clearance added to material thickness for safe Z.",
    group: "shinx",
    type: "number",
    value: 20.0,
    scope: "post"
  },
  approachClearance: {
    title: "Approach clearance",
    description: "Clearance added to material thickness for approach Z.",
    group: "shinx",
    type: "number",
    value: 5.0,
    scope: "post"
  },
  manualMaterialThickness: {
    title: "Manual material thickness",
    description: "Fallback material thickness when stock/model thickness cannot be read.",
    group: "shinx",
    type: "number",
    value: 30.0,
    scope: "post"
  },
  spindleSpeedOverride: {
    title: "Spindle speed override",
    description: "0 uses Fusion operation spindle speed. Non-zero forces this S value.",
    group: "shinx",
    type: "integer",
    value: 0,
    scope: "post"
  },
  useToolMapping: {
    title: "Use tool mapping",
    description: "Map Fusion tool numbers to SHINX magazine tool numbers.",
    group: "tools",
    type: "boolean",
    value: true,
    scope: "post"
  },
  tool1Mapped: {title:"Fusion T1 -> SHINX T", group:"tools", type:"integer", value:9, scope:"post"},
  tool2Mapped: {title:"Fusion T2 -> SHINX T", group:"tools", type:"integer", value:10, scope:"post"},
  tool3Mapped: {title:"Fusion T3 -> SHINX T", group:"tools", type:"integer", value:11, scope:"post"},
  tool4Mapped: {title:"Fusion T4 -> SHINX T", group:"tools", type:"integer", value:12, scope:"post"},
  tool5Mapped: {title:"Fusion T5 -> SHINX T", group:"tools", type:"integer", value:13, scope:"post"},
  tool6Mapped: {title:"Fusion T6 -> SHINX T", group:"tools", type:"integer", value:14, scope:"post"},
  tool7Mapped: {title:"Fusion T7 -> SHINX T", group:"tools", type:"integer", value:15, scope:"post"}
};

var xyzFormat = createFormat({decimals:3, forceDecimal:true});
var feedFormat = createFormat({decimals:0});
var rpmFormat = createFormat({decimals:0});
var toolFormat = createFormat({decimals:0});
var dFormat = createFormat({decimals:0});

var sequenceNumber = 0;
var currentFusionTool = undefined;
var currentShinxTool = undefined;
var currentFeed = undefined;
var currentMotion = undefined;
var currentPlane = undefined;
var currentRadiusCompensation = -1;
var firstOutputDone = false;
var spindleIsOn = false;
var xOutput = undefined;
var yOutput = undefined;
var zOutput = undefined;
var materialThickness = undefined;
var materialThicknessSource = undefined;

function pad(value, width) {
  var text = String(value);
  while (text.length < width) {
    text = "0" + text;
  }
  return text;
}

function fmt(value) {
  return xyzFormat.format(value);
}

function sameCoordinate(a, b) {
  return a !== undefined && b !== undefined && Math.abs(a - b) <= 0.001;
}

function writeShinxBlock() {
  var words = [];
  for (var i = 0; i < arguments.length; ++i) {
    var word = arguments[i];
    if (word !== undefined && word !== null && word !== "") {
      words.push(word);
    }
  }
  if (words.length == 0) {
    return;
  }
  writeln("O0000 N" + pad(sequenceNumber, 6) + " " + words.join(" "));
  sequenceNumber += 1;
}

function writeFixedBlock(n, words) {
  writeln("O0000 N" + pad(n, 6) + (words ? " " + words : ""));
}

function resetMotionModals() {
  currentMotion = undefined;
  currentPlane = undefined;
  currentFeed = undefined;
  currentRadiusCompensation = -1;
  xOutput = undefined;
  yOutput = undefined;
  zOutput = undefined;
}

function motionWord(code) {
  if (currentMotion == code) {
    return undefined;
  }
  currentMotion = code;
  return code;
}

function planeWord(code) {
  if (currentPlane == code) {
    return undefined;
  }
  currentPlane = code;
  return code;
}

function feedWord(feed) {
  if (feed === undefined) {
    return undefined;
  }
  var formatted = feedFormat.format(feed);
  if (currentFeed == formatted) {
    return undefined;
  }
  currentFeed = formatted;
  return "F" + formatted;
}

function axisWord(axis, value) {
  if (value === undefined) {
    return undefined;
  }
  if (axis == "X") {
    if (sameCoordinate(value, xOutput)) {
      return undefined;
    }
    xOutput = value;
  } else if (axis == "Y") {
    if (sameCoordinate(value, yOutput)) {
      return undefined;
    }
    yOutput = value;
  } else if (axis == "Z") {
    if (sameCoordinate(value, zOutput)) {
      return undefined;
    }
    zOutput = value;
  }
  return axis + fmt(value);
}

function forceXYZ(x, y, z) {
  xOutput = x;
  yOutput = y;
  zOutput = z;
}

function extractBoxThickness(candidate) {
  if (!candidate) {
    return undefined;
  }
  try {
    var upper = undefined;
    var lower = undefined;
    if (candidate.upper && candidate.lower) {
      upper = candidate.upper;
      lower = candidate.lower;
    } else if (candidate.maximum && candidate.minimum) {
      upper = candidate.maximum;
      lower = candidate.minimum;
    } else if (candidate.max && candidate.min) {
      upper = candidate.max;
      lower = candidate.min;
    } else if (candidate.high && candidate.low) {
      upper = candidate.high;
      lower = candidate.low;
    } else if (typeof candidate.getUpper == "function" && typeof candidate.getLower == "function") {
      upper = candidate.getUpper();
      lower = candidate.getLower();
    } else if (typeof candidate.getMaximum == "function" && typeof candidate.getMinimum == "function") {
      upper = candidate.getMaximum();
      lower = candidate.getMinimum();
    }
    if (upper && lower && upper.z !== undefined && lower.z !== undefined) {
      return Math.abs(upper.z - lower.z);
    }
  } catch (e) {
  }
  return undefined;
}

function resolveMaterialThickness() {
  if (materialThickness !== undefined) {
    return materialThickness;
  }

  var thickness = undefined;
  try {
    if (currentSection && typeof currentSection.getWorkpiece == "function") {
      thickness = extractBoxThickness(currentSection.getWorkpiece());
      if (thickness !== undefined) {
        materialThickness = thickness;
        materialThicknessSource = "currentSection.getWorkpiece";
        return materialThickness;
      }
    }
  } catch (e1) {
  }
  try {
    if (typeof getWorkpiece == "function") {
      thickness = extractBoxThickness(getWorkpiece());
      if (thickness !== undefined) {
        materialThickness = thickness;
        materialThicknessSource = "getWorkpiece";
        return materialThickness;
      }
    }
  } catch (e2) {
  }
  try {
    if (currentSection && typeof currentSection.getSetup == "function") {
      var setup = currentSection.getSetup();
      thickness = extractBoxThickness(setup && (setup.stock || setup.workpiece));
      if (thickness !== undefined) {
        materialThickness = thickness;
        materialThicknessSource = "currentSection.getSetup.stock";
        return materialThickness;
      }
    }
  } catch (e3) {
  }

  try {
    if (typeof getModelBoundingBox == "function") {
      thickness = extractBoxThickness(getModelBoundingBox());
      if (thickness !== undefined) {
        materialThickness = thickness;
        materialThicknessSource = "getModelBoundingBox";
        return materialThickness;
      }
    }
  } catch (e4) {
  }
  try {
    if (currentSection && typeof currentSection.getModelBoundingBox == "function") {
      thickness = extractBoxThickness(currentSection.getModelBoundingBox());
      if (thickness !== undefined) {
        materialThickness = thickness;
        materialThicknessSource = "currentSection.getModelBoundingBox";
        return materialThickness;
      }
    }
  } catch (e5) {
  }

  materialThickness = getProperty("manualMaterialThickness");
  materialThicknessSource = "manualMaterialThickness";
  warning("Could not read Fusion stock/model thickness. Using manualMaterialThickness " + fmt(materialThickness) + ".");
  return materialThickness;
}

function getSafeZ() {
  if (!getProperty("autoSafeHeight")) {
    return getProperty("safeZ");
  }
  return resolveMaterialThickness() + getProperty("safeClearance");
}

function getApproachZ() {
  if (!getProperty("autoSafeHeight")) {
    return undefined;
  }
  return resolveMaterialThickness() + getProperty("approachClearance");
}

function getMappedToolNumber(fusionToolNumber) {
  if (!getProperty("useToolMapping")) {
    return fusionToolNumber;
  }
  var key = "tool" + fusionToolNumber + "Mapped";
  if (fusionToolNumber < 1 || fusionToolNumber > 7 || !properties[key]) {
    error("Tool T" + fusionToolNumber + " is outside the configured SHINX mapping range T1-T7.");
    return fusionToolNumber;
  }
  return getProperty(key);
}

function getSpindleSpeed() {
  var override = getProperty("spindleSpeedOverride");
  if (override && override > 0) {
    return override;
  }
  if (spindleSpeed && spindleSpeed > 0) {
    return spindleSpeed;
  }
  warning("Spindle speed was not set by Fusion. Using S5000 as fallback.");
  return 5000;
}

function getInitialPositionXY() {
  var initial = getFramePosition(currentSection.getInitialPosition());
  return {x:initial.x, y:initial.y, z:initial.z};
}

function writeOriginSetup() {
  var safeZ = getSafeZ();
  writeShinxBlock("G90 G00", "X" + fmt(getProperty("machineOriginX")), "Y" + fmt(getProperty("machineOriginY")));
  writeShinxBlock("G92", "X 0.000", "Y 0.000");
  writeShinxBlock("M21");
  writeShinxBlock("G90 G00", "Z " + fmt(safeZ));
  resetMotionModals();
  forceXYZ(undefined, undefined, safeZ);
}

function writeSpindleStart(speed) {
  if (currentShinxTool === undefined) {
    error("Spindle start requested before a SHINX tool was loaded.");
  }
  writeShinxBlock("M23");
  writeShinxBlock("M03");
  writeShinxBlock("S" + rpmFormat.format(speed));
  writeShinxBlock("G04 X1.0");
  spindleIsOn = true;
}

function writeInitialHeader(shinxTool, speed) {
  sequenceNumber = 0;
  writeFixedBlock(0, "M06");
  writeFixedBlock(1, "M95");
  writeFixedBlock(2, "G53");
  writeFixedBlock(3, "G90 G00 Z 0.000");
  writeFixedBlock(4, "M92");
  writeFixedBlock(5, "T" + toolFormat.format(shinxTool));
  writeFixedBlock(6, "G65 P9000 L1");
  writeFixedBlock(7, "M23");
  writeFixedBlock(8, "M03");
  writeFixedBlock(9, "S" + rpmFormat.format(speed));
  writeFixedBlock(10, "G04 X1.0");
  sequenceNumber = 12;
  currentShinxTool = shinxTool;
  spindleIsOn = true;
  resetMotionModals();
  writeOriginSetup();
}

function writeToolChange(shinxTool, speed) {
  writeShinxBlock("G90 G00", "Z0.000");
  writeShinxBlock("S0 T100");
  writeShinxBlock("M92 M95");
  writeShinxBlock("G65 P9900 L1");
  writeShinxBlock("T" + toolFormat.format(shinxTool));
  writeShinxBlock("G65 P9000 L1");
  currentShinxTool = shinxTool;
  resetMotionModals();
  writeSpindleStart(speed);
  writeOriginSetup();
}

function writeFirstXYMove() {
  var initial = getInitialPositionXY();
  var approachZ = getApproachZ();
  writeShinxBlock("G90 G00", "X" + fmt(initial.x), "Y" + fmt(initial.y));
  if (approachZ !== undefined) {
    writeShinxBlock("G90 G00", "Z " + fmt(approachZ));
  }
  resetMotionModals();
  forceXYZ(initial.x, initial.y, approachZ !== undefined ? approachZ : getSafeZ());
}

function writeMotion(code, x, y, z, feed) {
  var words = [
    motionWord(code),
    axisWord("X", x),
    axisWord("Y", y),
    axisWord("Z", z),
    feedWord(feed)
  ];
  writeShinxBlock.apply(null, words);
}

function writeRadiusCompensationIfNeeded() {
  if (radiusCompensation == currentRadiusCompensation) {
    return;
  }
  if (radiusCompensation == RADIUS_COMPENSATION_LEFT) {
    writeShinxBlock("G41", "D" + dFormat.format(tool.diameterOffset));
  } else if (radiusCompensation == RADIUS_COMPENSATION_RIGHT) {
    writeShinxBlock("G42", "D" + dFormat.format(tool.diameterOffset));
  } else {
    writeShinxBlock("G40");
  }
  currentRadiusCompensation = radiusCompensation;
}

function getArcRadius() {
  try {
    if (typeof getCircularRadius == "function") {
      return getCircularRadius();
    }
  } catch (e) {
  }
  error("Circular radius was not supplied by the Fusion post engine. Arc output stopped to avoid recalculating the toolpath.");
  return undefined;
}

function onOpen() {
  writeln("%");
  writeln("(SHINX_20ZXGN_POST " + SHINX_POST_VERSION + ")");
}

function onSection() {
  var fusionTool = tool.number;
  var shinxTool = getMappedToolNumber(fusionTool);
  var speed = getSpindleSpeed();

  if (currentSection.workOffset && currentSection.workOffset > 0) {
    warning("G54-G59 work offsets are not output. SHINX output uses G92 at the configured machine origin.");
  }

  if (!firstOutputDone) {
    writeInitialHeader(shinxTool, speed);
    currentFusionTool = fusionTool;
    firstOutputDone = true;
  } else if (fusionTool != currentFusionTool) {
    writeToolChange(shinxTool, speed);
    currentFusionTool = fusionTool;
  } else {
    var safeZ = getSafeZ();
    writeShinxBlock("G90 G00", "Z" + fmt(safeZ));
    resetMotionModals();
    forceXYZ(undefined, undefined, safeZ);
  }

  writeFirstXYMove();
}

function onRapid(x, y, z) {
  writeRadiusCompensationIfNeeded();
  writeMotion("G00", x, y, z);
}

function onLinear(x, y, z, feed) {
  writeRadiusCompensationIfNeeded();
  writeMotion("G01", x, y, z, feed);
}

function onCircular(clockwise, cx, cy, cz, x, y, z, feed) {
  writeRadiusCompensationIfNeeded();
  if (isFullCircle()) {
    linearize(tolerance);
    return;
  }
  var plane = getCircularPlane() == PLANE_ZX ? "G18" : (getCircularPlane() == PLANE_YZ ? "G19" : "G17");
  var words = [
    planeWord(plane),
    motionWord(clockwise ? "G02" : "G03"),
    axisWord("X", x),
    axisWord("Y", y),
    axisWord("Z", z),
    "R" + fmt(getArcRadius()),
    feedWord(feed)
  ];
  writeShinxBlock.apply(null, words);
}

function onRadiusCompensation() {
  writeRadiusCompensationIfNeeded();
}

function onCycle() {
}

function onCyclePoint(x, y, z) {
  expandCyclePoint(x, y, z);
}

function onCycleEnd() {
}

function onRapid5D() {
  error("5-axis rapid moves are not supported by this SHINX 20ZXGN post.");
}

function onLinear5D() {
  error("5-axis linear moves are not supported by this SHINX 20ZXGN post.");
}

function onDwell(seconds) {
  writeShinxBlock("G04", "X" + fmt(seconds));
}

function onSpindleSpeed(_spindleSpeed) {
  var speed = getProperty("spindleSpeedOverride") > 0 ? getProperty("spindleSpeedOverride") : _spindleSpeed;
  writeShinxBlock("S" + rpmFormat.format(speed));
}

function onCommand(command) {
  switch (command) {
  case COMMAND_STOP_SPINDLE:
    writeShinxBlock("S0");
    spindleIsOn = false;
    return;
  case COMMAND_START_SPINDLE:
    writeSpindleStart(getSpindleSpeed());
    return;
  case COMMAND_COOLANT_ON:
  case COMMAND_COOLANT_OFF:
  case COMMAND_OPTIONAL_STOP:
  case COMMAND_STOP:
    return;
  }
}

function onClose() {
  if (!firstOutputDone) {
    warning("No machining sections were output.");
  }
  writeShinxBlock("G218");
  writeFixedBlock(9508, "S0 T100");
  writeFixedBlock(9509, "G90 G00 Z 0.000");
  writeFixedBlock(9510, "G219");
  writeFixedBlock(9511, "G04 X1.0");
  writeFixedBlock(9512, "M92 M95");
  writeFixedBlock(9513, "G65 P9900 L1");
  writeFixedBlock(9514, "G53");
  writeFixedBlock(9515, "G90 G00 Y 0.000");
  writeFixedBlock(9516, "M30");
  writeln("%");
}
