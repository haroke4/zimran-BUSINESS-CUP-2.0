export const TAU = Math.PI * 2;
export const NOMINAL_HEIGHT = 150;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Turns a skin's proportions into measurable bone lengths.
 * Every clip uses these numbers, so the same animation retargets to
 * a short stocky engineer and a tall thin android without extra work.
 */
export function buildSkeleton(skin = {}) {
  const proportions = skin.proportions ?? {};
  const height = NOMINAL_HEIGHT * (proportions.height ?? 1);
  const legs = proportions.legs ?? 1;
  const torso = proportions.torso ?? 1;
  const arms = proportions.arms ?? 1;
  const width = proportions.width ?? 1;
  const head = proportions.head ?? 1;

  const legLength = height * 0.48 * legs;
  const torsoLength = height * 0.315 * torso;
  const headRadius = height * 0.093 * head;
  const neckLength = height * 0.022;
  const armLength = height * 0.355 * arms;
  const limbWidth = height * 0.036 * width;

  return {
    height,
    legLength,
    hipHeight: legLength * 0.965,
    upperLeg: legLength * 0.5,
    lowerLeg: legLength * 0.5,
    torsoLength,
    neckLength,
    headRadius,
    armLength,
    upperArm: armLength * 0.53,
    lowerArm: armLength * 0.47,
    shoulderHalf: height * 0.06 * width,
    hipHalf: height * 0.035 * width,
    limbWidth,
    armWidth: limbWidth * 0.88,
    torsoWidth: height * 0.11 * width,
    footLength: height * 0.108,
    ankleHeight: height * 0.018,
    handRadius: limbWidth * 0.62,
  };
}

export function defaultPose(metrics) {
  return {
    rootX: 0,
    bob: 0,
    lift: 0,
    lean: 0,
    torso: 0.03,
    head: 0,
    footL: { x: -metrics.height * 0.022, y: 0, angle: 0.02 },
    footR: { x: metrics.height * 0.032, y: 0, angle: 0.02 },
    armL: { shoulder: -0.08, elbow: 0.22 },
    armR: { shoulder: 0.1, elbow: 0.18 },
    handL: null,
    handR: null,
  };
}

/** Fills a clip's partial pose with the neutral stance. */
export function resolvePose(partial = {}, metrics) {
  const base = defaultPose(metrics);
  return {
    rootX: partial.rootX ?? base.rootX,
    bob: partial.bob ?? base.bob,
    lift: partial.lift ?? base.lift,
    lean: partial.lean ?? base.lean,
    torso: partial.torso ?? base.torso,
    head: partial.head ?? base.head,
    footL: { ...base.footL, ...(partial.footL ?? {}) },
    footR: { ...base.footR, ...(partial.footR ?? {}) },
    armL: { ...base.armL, ...(partial.armL ?? {}) },
    armR: { ...base.armR, ...(partial.armR ?? {}) },
    handL: partial.handL === undefined ? base.handL : partial.handL,
    handR: partial.handR === undefined ? base.handR : partial.handR,
  };
}

function blendHandle(a, b, t) {
  if (a && b) {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  }
  return t < 0.5 ? a : b;
}

/** Blends two fully resolved poses. Used for crossfades between clips. */
export function blendPose(a, b, t) {
  return {
    rootX: lerp(a.rootX, b.rootX, t),
    bob: lerp(a.bob, b.bob, t),
    lift: lerp(a.lift, b.lift, t),
    lean: lerp(a.lean, b.lean, t),
    torso: lerp(a.torso, b.torso, t),
    head: lerp(a.head, b.head, t),
    footL: {
      x: lerp(a.footL.x, b.footL.x, t),
      y: lerp(a.footL.y, b.footL.y, t),
      angle: lerp(a.footL.angle, b.footL.angle, t),
    },
    footR: {
      x: lerp(a.footR.x, b.footR.x, t),
      y: lerp(a.footR.y, b.footR.y, t),
      angle: lerp(a.footR.angle, b.footR.angle, t),
    },
    armL: {
      shoulder: lerp(a.armL.shoulder, b.armL.shoulder, t),
      elbow: lerp(a.armL.elbow, b.armL.elbow, t),
    },
    armR: {
      shoulder: lerp(a.armR.shoulder, b.armR.shoulder, t),
      elbow: lerp(a.armR.elbow, b.armR.elbow, t),
    },
    handL: blendHandle(a.handL, b.handL, t),
    handR: blendHandle(a.handR, b.handR, t),
  };
}

function solveTwoBone(from, target, upper, lower, bend) {
  let dx = target.x - from.x;
  let dy = target.y - from.y;
  let distance = Math.hypot(dx, dy);
  if (distance < 0.0001) {
    dx = 0;
    dy = 1;
    distance = 1;
  }
  const ux = dx / distance;
  const uy = dy / distance;
  const reach = clamp(distance, Math.abs(upper - lower) + 0.01, upper + lower - 0.01);
  const end = { x: from.x + ux * reach, y: from.y + uy * reach };
  const cos = clamp((reach * reach + upper * upper - lower * lower) / (2 * reach * upper), -1, 1);
  const offset = Math.acos(cos);
  const base = Math.atan2(uy, ux);
  const angle = base + bend * offset;
  return {
    joint: { x: from.x + Math.cos(angle) * upper, y: from.y + Math.sin(angle) * upper },
    end,
  };
}

function armChain(shoulder, arm, metrics, target, bend) {
  let elbow;
  let wrist;
  if (target) {
    const ik = solveTwoBone(shoulder, target, metrics.upperArm, metrics.lowerArm, bend);
    elbow = ik.joint;
    wrist = ik.end;
  } else {
    const upperAngle = arm.shoulder;
    elbow = {
      x: shoulder.x + Math.sin(upperAngle) * metrics.upperArm,
      y: shoulder.y + Math.cos(upperAngle) * metrics.upperArm,
    };
    const lowerAngle = upperAngle + arm.elbow;
    wrist = {
      x: elbow.x + Math.sin(lowerAngle) * metrics.lowerArm,
      y: elbow.y + Math.cos(lowerAngle) * metrics.lowerArm,
    };
  }
  const dx = wrist.x - elbow.x;
  const dy = wrist.y - elbow.y;
  const length = Math.hypot(dx, dy) || 1;
  const hand = {
    x: wrist.x + (dx / length) * metrics.handRadius * 1.2,
    y: wrist.y + (dy / length) * metrics.handRadius * 1.2,
  };
  return { elbow, wrist, hand };
}

/**
 * Solves the whole body into points. Angles are radians, y grows down,
 * ground is y = 0 and the character faces +x.
 */
export function solveSkeleton(metrics, pose) {
  const torsoUp = { x: Math.sin(pose.torso), y: -Math.cos(pose.torso) };
  const torsoSide = { x: Math.cos(pose.torso), y: Math.sin(pose.torso) };
  const headTilt = pose.torso + pose.head;
  const headUp = { x: Math.sin(headTilt), y: -Math.cos(headTilt) };

  const pelvis = { x: pose.rootX, y: -metrics.hipHeight - pose.bob };
  const chest = {
    x: pelvis.x + torsoUp.x * metrics.torsoLength,
    y: pelvis.y + torsoUp.y * metrics.torsoLength,
  };
  const neck = {
    x: chest.x + torsoUp.x * metrics.neckLength,
    y: chest.y + torsoUp.y * metrics.neckLength,
  };
  const head = {
    x: neck.x + headUp.x * metrics.headRadius * 0.95,
    y: neck.y + headUp.y * metrics.headRadius * 0.95,
  };
  const headTop = {
    x: head.x + headUp.x * metrics.headRadius,
    y: head.y + headUp.y * metrics.headRadius,
  };
  const shoulderCenter = {
    x: pelvis.x + torsoUp.x * metrics.torsoLength * 0.9,
    y: pelvis.y + torsoUp.y * metrics.torsoLength * 0.9,
  };
  const shoulderL = {
    x: shoulderCenter.x - torsoSide.x * metrics.shoulderHalf,
    y: shoulderCenter.y - torsoSide.y * metrics.shoulderHalf,
  };
  const shoulderR = {
    x: shoulderCenter.x + torsoSide.x * metrics.shoulderHalf,
    y: shoulderCenter.y + torsoSide.y * metrics.shoulderHalf,
  };
  const hipL = { x: pelvis.x - metrics.hipHalf, y: pelvis.y };
  const hipR = { x: pelvis.x + metrics.hipHalf, y: pelvis.y };

  const ankleL = {
    x: pose.footL.x + pose.rootX,
    y: -metrics.ankleHeight - pose.footL.y,
  };
  const ankleR = {
    x: pose.footR.x + pose.rootX,
    y: -metrics.ankleHeight - pose.footR.y,
  };
  const legL = solveTwoBone(hipL, ankleL, metrics.upperLeg, metrics.lowerLeg, -1);
  const legR = solveTwoBone(hipR, ankleR, metrics.upperLeg, metrics.lowerLeg, -1);
  const kneeL = legL.joint;
  const kneeR = legR.joint;
  const footL = {
    x: legL.end.x + Math.cos(pose.footL.angle) * metrics.footLength,
    y: legL.end.y + Math.sin(pose.footL.angle) * metrics.footLength,
  };
  const heelL = {
    x: legL.end.x - Math.cos(pose.footL.angle) * metrics.footLength * 0.22,
    y: legL.end.y - Math.sin(pose.footL.angle) * metrics.footLength * 0.22,
  };
  const footR = {
    x: legR.end.x + Math.cos(pose.footR.angle) * metrics.footLength,
    y: legR.end.y + Math.sin(pose.footR.angle) * metrics.footLength,
  };
  const heelR = {
    x: legR.end.x - Math.cos(pose.footR.angle) * metrics.footLength * 0.22,
    y: legR.end.y - Math.sin(pose.footR.angle) * metrics.footLength * 0.22,
  };

  const armL = armChain(shoulderL, pose.armL, metrics, pose.handL, 1);
  const armR = armChain(shoulderR, pose.armR, metrics, pose.handR, 1);

  const points = {
    pelvis, chest, neck, head, headTop, shoulderCenter,
    shoulderL, shoulderR, hipL, hipR,
    kneeL, ankleL: legL.end, heelL, footL,
    kneeR, ankleR: legR.end, heelR, footR,
    elbowL: armL.elbow, wristL: armL.wrist, handL: armL.hand,
    elbowR: armR.elbow, wristR: armR.wrist, handR: armR.hand,
  };

  const cosLean = Math.cos(pose.lean);
  const sinLean = Math.sin(pose.lean);
  for (const point of Object.values(points)) {
    const x = point.x * cosLean - point.y * sinLean;
    const y = point.x * sinLean + point.y * cosLean - pose.lift;
    point.x = x;
    point.y = y;
  }

  const bones = [
    ["spine", "pelvis", "chest"],
    ["neck", "chest", "neck"],
    ["head", "neck", "head"],
    ["thighL", "hipL", "kneeL"],
    ["shinL", "kneeL", "ankleL"],
    ["footL", "heelL", "footL"],
    ["thighR", "hipR", "kneeR"],
    ["shinR", "kneeR", "ankleR"],
    ["footR", "heelR", "footR"],
    ["upperArmL", "shoulderL", "elbowL"],
    ["forearmL", "elbowL", "wristL"],
    ["upperArmR", "shoulderR", "elbowR"],
    ["forearmR", "elbowR", "wristR"],
  ].map(([name, from, to]) => ({ name, a: points[from], b: points[to] }));

  return {
    metrics,
    pose,
    points,
    bones,
    tilt: headTilt + pose.lean,
  };
}
