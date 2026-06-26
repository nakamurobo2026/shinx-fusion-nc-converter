/**
  SHINX 20ZXGN post processor for Autodesk Fusion 360.

  Outputs SHINX-ready NC code using the machine's existing tool macros.
  Tool pickup/return is intentionally delegated to O9000/O9900 macros:
    T{shinx_tool}
    G65 P9000 L1
    G65 P9900 L1
*/

description = "SHINX 20ZXGN";
vendor = "SHINX";
vendorUrl = "";
legal = "Use at your own risk. Verify with dry-run before machining.";
certificationLevel = 2;
minimumRevision = 45821;

longDescription = "SHINX 20ZXGN post processor with P9000/P9900 tool macro calls and fixed G92 origin setup.";

extension = "nc";
programNameIsInteger = false;
setCodePage("ascii");

capabilities = CAPABILITY_MILLING;
tolerance = spatial(0.002, MM);
minimumChordLength = spatial(0.25, MM);
minimumCircularRadius = spatial(0.01, MM);
maximumCircularRadius = spatial(1000, MM);
minimumCircularSweep = toRad(0.01);
maximumCircularSweep = toRad(180);
allowHelicalMoves = false;
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
    description: "Safe Z after G92 origin setup.",
    group: "shinx",
    type: "number",
    value: 60.0,
    scope: "post"
  },
  approachZ: {
    title: "Approach Z",
    description: "Approach Z before plunging to the machining depth.",
    group: "shinx",
    type: "number",
    value: 5.0,
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
  plungeFeed: {
    title: "Plunge feed",
    description: "Feed used for the initial G91 plunge.",
    group: "shinx",
    type: "integer",
    value: 1500,
    scope: "post"
  },
  maxDepth: {
    title: "Max depth",
    description: "Maximum allowed depth and initial plunge depth.",
    group: "shinx",
    type: "number",
    value: 31.0,
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
var currentPlane = 17;
var currentPosition = {x:0, y:0, z:0};
var currentMode = 90;
var pendingSectionInitial = undefined;
var pendingInitialSkips = 0;
var originWasResetAfterToolChange = false;
var firstOutputDone = false;
var spindleIsOn = false;
var pendingRadiusCompensation = -1;

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

function writeShinxBlock() {
  var words = [];
  for (var i = 0; i < arguments.length; ++i) {
    var word = arguments[i];
    if (word !== undefined && word !== null && word !== "") {
      words.push(word);
    }
  }
  if (words.length == 0) {
    writeln("O0000 N" + pad(sequenceNumber, 6));
  } else {
    writeln("O0000 N" + pad(sequenceNumber, 6) + " " + words.join(" "));
  }
  sequenceNumber += 1;
}

function writeFixedBlock(n, words) {
  writeln("O0000 N" + pad(n, 6) + (words ? " " + words : ""));
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

function getSectionInitialXY() {
  var initial = getFramePosition(currentSection.getInitialPosition());
  return {x:initial.x, y:initial.y, z:initial.z};
}

function writeOriginSetup() {
  writeShinxBlock("G90 G00", "X" + fmt(getProperty("machineOriginX")), "Y" + fmt(getProperty("machineOriginY")));
  writeShinxBlock("G92", "X 0.000", "Y 0.000");
  writeShinxBlock("M21");
  writeShinxBlock("G90 G00", "Z " + fmt(getProperty("safeZ")));
  originWasResetAfterToolChange = true;
  currentMode = 90;
  currentPosition.z = getProperty("safeZ");
}

function writeCutStart(initial) {
  if (!originWasResetAfterToolChange) {
    error("Origin reset sequence is missing before machining start.");
  }
  writeShinxBlock("G90 G00", "X" + fmt(initial.x), "Y" + fmt(initial.y));
  writeShinxBlock("G90 G00", "Z" + fmt(getProperty("approachZ")));
  writeShinxBlock("G91 G01", "Z-" + fmt(getProperty("maxDepth")), "F" + feedFormat.format(getProperty("plungeFeed")));
  currentMode = 91;
  currentPosition.x = initial.x;
  currentPosition.y = initial.y;
  currentPosition.z = -getProperty("maxDepth");
  pendingSectionInitial = initial;
  pendingInitialSkips = 3;
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
  writeSpindleStart(speed);
  writeOriginSetup();
}

function shouldSkipInitialMove(x, y, z) {
  if (!pendingSectionInitial || pendingInitialSkips <= 0) {
    return false;
  }
  if (x !== undefined && Math.abs(x - pendingSectionInitial.x) > 0.001) {
    return false;
  }
  if (y !== undefined && Math.abs(y - pendingSectionInitial.y) > 0.001) {
    return false;
  }
  if (z !== undefined && (Math.abs(z - pendingSectionInitial.z) > 0.001) && (Math.abs(z - getProperty("approachZ")) > 0.001) && (Math.abs(z - getProperty("safeZ")) > 0.001)) {
    return false;
  }
  pendingInitialSkips -= 1;
  return true;
}

function writeMotion(gCode, x, y, z, r, feed) {
  var words = [gCode];
  if (gCode == "G90 G00" && (x !== undefined || y !== undefined) && currentPosition.z < getProperty("approachZ") - 0.001) {
    error("Rapid XY move was requested after Z was lowered. XY positioning must occur at safeZ or approachZ.");
  }
  if (x !== undefined) {
    words.push("X" + fmt(x));
    currentPosition.x = x;
  }
  if (y !== undefined) {
    words.push("Y" + fmt(y));
    currentPosition.y = y;
  }
  if (z !== undefined) {
    if (z < -getProperty("maxDepth") - 0.001) {
      error("Z depth " + fmt(z) + " is deeper than maxDepth " + fmt(getProperty("maxDepth")) + ".");
    }
    words.push("Z" + fmt(z));
    currentPosition.z = z;
  }
  if (r !== undefined) {
    words.push("R" + fmt(r));
  }
  if (feed !== undefined) {
    words.push("F" + feedFormat.format(feed));
  }
  writeShinxBlock.apply(null, words);
}

function writeLinearWithRadiusCompensation(x, y, z, feed) {
  var comp = "G40";
  if (radiusCompensation == RADIUS_COMPENSATION_LEFT) {
    comp = "G41";
  } else if (radiusCompensation == RADIUS_COMPENSATION_RIGHT) {
    comp = "G42";
  }

  var words = ["G90 G01", comp];
  if (comp != "G40") {
    words.push("D" + dFormat.format(tool.diameterOffset));
  }
  if (x !== undefined) {
    words.push("X" + fmt(x));
    currentPosition.x = x;
  }
  if (y !== undefined) {
    words.push("Y" + fmt(y));
    currentPosition.y = y;
  }
  if (z !== undefined) {
    if (z < -getProperty("maxDepth") - 0.001) {
      error("Z depth " + fmt(z) + " is deeper than maxDepth " + fmt(getProperty("maxDepth")) + ".");
    }
    words.push("Z" + fmt(z));
    currentPosition.z = z;
  }
  if (feed !== undefined) {
    words.push("F" + feedFormat.format(feed));
  }
  writeShinxBlock.apply(null, words);
}

function onOpen() {
  writeln("%");
  if (getProperty("machiningFace") == 8) {
    // Face 8 defaults are defined in the post properties.
  }
}

function onSection() {
  var fusionTool = tool.number;
  var shinxTool = getMappedToolNumber(fusionTool);
  var speed = getSpindleSpeed();
  var initial = getSectionInitialXY();

  if (currentSection.workOffset && currentSection.workOffset > 0) {
    warning("G54-G59 work offsets are ignored. SHINX output uses G92 at the configured machine origin.");
  }

  if (!firstOutputDone) {
    writeInitialHeader(shinxTool, speed);
    currentFusionTool = fusionTool;
    firstOutputDone = true;
  } else if (fusionTool != currentFusionTool) {
    writeToolChange(shinxTool, speed);
    currentFusionTool = fusionTool;
  } else {
    writeShinxBlock("G90 G00", "Z" + fmt(getProperty("safeZ")));
    currentMode = 90;
    currentPosition.z = getProperty("safeZ");
  }

  writeCutStart(initial);
}

function onRapid(x, y, z) {
  if (pendingRadiusCompensation >= 0) {
    error("Radius compensation cannot be changed on a rapid move.");
  }
  if (shouldSkipInitialMove(x, y, z)) {
    return;
  }
  writeMotion("G90 G00", x, y, z);
}

function onLinear(x, y, z, feed) {
  if (shouldSkipInitialMove(x, y, z)) {
    return;
  }
  if (pendingRadiusCompensation >= 0) {
    pendingRadiusCompensation = -1;
    writeLinearWithRadiusCompensation(x, y, z, feed);
    return;
  }
  writeMotion("G90 G01", x, y, z, undefined, feed);
}

function onRadiusCompensation() {
  pendingRadiusCompensation = radiusCompensation;
}

function radiusFromCenter(plane, cx, cy, cz) {
  if (plane == 18) {
    return Math.sqrt(Math.pow(cx - currentPosition.x, 2) + Math.pow(cz - currentPosition.z, 2));
  }
  if (plane == 19) {
    return Math.sqrt(Math.pow(cy - currentPosition.y, 2) + Math.pow(cz - currentPosition.z, 2));
  }
  return Math.sqrt(Math.pow(cx - currentPosition.x, 2) + Math.pow(cy - currentPosition.y, 2));
}

function onCircular(clockwise, cx, cy, cz, x, y, z, feed) {
  if (pendingRadiusCompensation >= 0) {
    error("Radius compensation cannot be changed on a circular move.");
  }
  if (isFullCircle()) {
    linearize(tolerance);
    return;
  }
  currentPlane = getCircularPlane() == PLANE_ZX ? 18 : (getCircularPlane() == PLANE_YZ ? 19 : 17);
  var r = radiusFromCenter(currentPlane, cx, cy, cz);
  writeMotion("G" + currentPlane, undefined, undefined, undefined);
  writeMotion(clockwise ? "G02" : "G03", x, y, z, r, feed);
}

function onCycle() {
  // Canned cycles are expanded so no unsupported Fusion cycle G-code is emitted.
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
