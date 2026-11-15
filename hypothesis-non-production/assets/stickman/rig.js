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

export function buildSkeleton(skin = {}) {
  const proportions = skin.proportions ?? {};
  const height = NOMINAL_HEIGHT * (proportions.height ?? 1);
  const legs = proportions.legs ?? 1;
  const torso = proportions.torso ?? 1;
  const arms = proportions.arms ?? 1;
  const width = proportions.width ?? 1;
  const head = proportions.head ?? 1;

  const legLength = height * 0.47 * legs;
  const torsoLength = height * 0.3 * torso;
  const headRadius = height * 0.095 * head;
  const neckLength = height * 0.018;
  const armLength = height * 0.345 * arms;
  const limbWidth = height * 0.052 * width;

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
    shoulderHalf: height * 0.05 * width,
    hipHalf: height * 0.03 * width,
    limbWidth,
    armWidth: limbWidth * 0.86,
    torsoWidth: height * 0.125 * width,
    footLength: height * 0.08,
    ankleHeight: height * 0.018,
    handRadius: limbWidth * 0.56,
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
    shoulderLift: 0,
    footL: { x: -metrics.height * 0.08, y: 0, angle: 0 },
    footR: { x: metrics.height * 0.09, y: 0, angle: 0 },
    armL: { shoulder: -0.07, elbow: 0.18 },
    armR: { shoulder: 0.09, elbow: 0.16 },
    armBendL: 1,
    armBendR: 1,
    handL: null,
    handR: null,
    handWeightL: 0,
    handWeightR: 0,
  };
}

export function resolvePose(partial = {}, metrics) {
  const base = defaultPose(metrics);
  return {
    rootX: partial.rootX ?? base.rootX,
    bob: partial.bob ?? base.bob,
    lift: partial.lift ?? base.lift,
    lean: partial.lean ?? base.lean,
    torso: partial.torso ?? base.torso,
    head: partial.head ?? base.head,
    shoulderLift: partial.shoulderLift ?? base.shoulderLift,
    footL: { ...base.footL, ...(partial.footL ?? {}) },
    footR: { ...base.footR, ...(partial.footR ?? {}) },
    armL: { ...base.armL, ...(partial.armL ?? {}) },
    armR: { ...base.armR, ...(partial.armR ?? {}) },
    armBendL: partial.armBendL ?? base.armBendL,
    armBendR: partial.armBendR ?? base.armBendR,
    handL: partial.handL === undefined ? base.handL : partial.handL,
    handR: partial.handR === undefined ? base.handR : partial.handR,
    handWeightL: partial.handWeightL ?? (partial.handL ? 1 : base.handWeightL),
    handWeightR: partial.handWeightR ?? (partial.handR ? 1 : base.handWeightR),
  };
}

function blendHandle(a, b, t) {
  if (a && b) return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  return a ?? b;
}

export function blendPose(a, b, t) {
  return {
    rootX: lerp(a.rootX, b.rootX, t),
    bob: lerp(a.bob, b.bob, t),
    lift: lerp(a.lift, b.lift, t),
    lean: lerp(a.lean, b.lean, t),
    torso: lerp(a.torso, b.torso, t),
    head: lerp(a.head, b.head, t),
    shoulderLift: lerp(a.shoulderLift, b.shoulderLift, t),
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
    armBendL: lerp(a.armBendL, b.armBendL, t),
    armBendR: lerp(a.armBendR, b.armBendR, t),
    handL: blendHandle(a.handL, b.handL, t),
    handR: blendHandle(a.handR, b.handR, t),
    handWeightL: lerp(a.handWeightL, b.handWeightL, t),
    handWeightR: lerp(a.handWeightR, b.handWeightR, t),
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

function armChain(shoulder, arm, metrics, target, bend, weight = 1) {
  const upperAngle = arm.shoulder;
  const fkElbow = {
    x: shoulder.x + Math.sin(upperAngle) * metrics.upperArm,
    y: shoulder.y + Math.cos(upperAngle) * metrics.upperArm,
  };
  const lowerAngle = upperAngle + arm.elbow;
  const fkWrist = {
    x: fkElbow.x + Math.sin(lowerAngle) * metrics.lowerArm,
    y: fkElbow.y + Math.cos(lowerAngle) * metrics.lowerArm,
  };

  let elbow = fkElbow;
  let wrist = fkWrist;
  if (target && weight > 0.0001) {
    const ik = solveTwoBone(shoulder, target, metrics.upperArm, metrics.lowerArm, bend);
    const mix = clamp(weight, 0, 1);
    elbow = {
      x: lerp(fkElbow.x, ik.joint.x, mix),
      y: lerp(fkElbow.y, ik.joint.y, mix),
    };
    wrist = {
      x: lerp(fkWrist.x, ik.end.x, mix),
      y: lerp(fkWrist.y, ik.end.y, mix),
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
  const shoulderCenter = {
    x: pelvis.x + torsoUp.x * (metrics.torsoLength * 0.88 + metrics.height * 0.03 * pose.shoulderLift),
    y: pelvis.y + torsoUp.y * (metrics.torsoLength * 0.88 + metrics.height * 0.03 * pose.shoulderLift),
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

  const ankleL = { x: pose.footL.x + pose.rootX, y: -metrics.ankleHeight - pose.footL.y };
  const ankleR = { x: pose.footR.x + pose.rootX, y: -metrics.ankleHeight - pose.footR.y };
  const legL = solveTwoBone(hipL, ankleL, metrics.upperLeg, metrics.lowerLeg, -1);
  const legR = solveTwoBone(hipR, ankleR, metrics.upperLeg, metrics.lowerLeg, -1);

  const footL = {
    x: legL.end.x + Math.cos(pose.footL.angle) * metrics.footLength,
    y: legL.end.y + Math.sin(pose.footL.angle) * metrics.footLength,
  };
  const heelL = {
    x: legL.end.x - Math.cos(pose.footL.angle) * metrics.footLength * 0.24,
    y: legL.end.y - Math.sin(pose.footL.angle) * metrics.footLength * 0.24,
  };
  const footR = {
    x: legR.end.x + Math.cos(pose.footR.angle) * metrics.footLength,
    y: legR.end.y + Math.sin(pose.footR.angle) * metrics.footLength,
  };
  const heelR = {
    x: legR.end.x - Math.cos(pose.footR.angle) * metrics.footLength * 0.24,
    y: legR.end.y - Math.sin(pose.footR.angle) * metrics.footLength * 0.24,
  };

  const armL = armChain(shoulderL, pose.armL, metrics, pose.handL, pose.armBendL, pose.handWeightL);
  const armR = armChain(shoulderR, pose.armR, metrics, pose.handR, pose.armBendR, pose.handWeightR);

  const points = {
    pelvis, chest, neck, head,
    shoulderCenter, shoulderL, shoulderR, hipL, hipR,
    kneeL: legL.joint, ankleL: legL.end, heelL, footL,
    kneeR: legR.joint, ankleR: legR.end, heelR, footR,
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

  return { metrics, pose, points, bones, tilt: headTilt + pose.lean };
}
