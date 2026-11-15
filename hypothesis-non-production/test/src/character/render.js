import {
  buildSkeleton, clamp, solveSkeleton,
} from "./rig.js";
import { resolvePalette, shade } from "./palette.js";

const skeletonCache = new WeakMap();
const gearCache = new WeakMap();

export function skeletonFor(skin) {
  if (!skeletonCache.has(skin)) skeletonCache.set(skin, buildSkeleton(skin));
  return skeletonCache.get(skin);
}

function gearOf(skin) {
  if (!gearCache.has(skin)) gearCache.set(skin, new Set(skin.gear ?? []));
  return gearCache.get(skin);
}

function stroke(g, a, b, width, color, alpha = 1) {
  if (width <= 0.1) return;
  g.lineStyle(width, color, alpha);
  g.lineBetween(a.x, a.y, b.x, b.y);
  g.fillStyle(color, alpha);
  g.fillCircle(a.x, a.y, width / 2);
  g.fillCircle(b.x, b.y, width / 2);
}

function dot(g, point, radius, color, alpha = 1) {
  g.fillStyle(color, alpha);
  g.fillCircle(point.x, point.y, radius);
}

function poly(g, points, color, alpha = 1) {
  g.fillStyle(color, alpha);
  g.fillPoints(points, true);
}

function offsetPoint(center, dx, dy, angle = 0) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function orientedBox(center, side, up, width, height, bevel = 0.2) {
  const hw = width / 2;
  const hh = height / 2;
  const bx = Math.min(bevel, hw * 0.45);
  const by = Math.min(bevel, hh * 0.45);
  const locals = [
    [-hw + bx, -hh], [hw - bx, -hh], [hw, -hh + by], [hw, hh - by],
    [hw - bx, hh], [-hw + bx, hh], [-hw, hh - by], [-hw, -hh + by],
  ];
  return locals.map(([x, y]) => ({
    x: center.x + side.x * x + up.x * y,
    y: center.y + side.y * x + up.y * y,
  }));
}

function dome(g, center, rx, ry, tilt, color, alpha = 1) {
  const points = [];
  for (let i = 0; i <= 18; i++) {
    const angle = Math.PI + (Math.PI * i) / 18;
    points.push(offsetPoint(center, Math.cos(angle) * rx, Math.sin(angle) * ry, tilt));
  }
  poly(g, points, color, alpha);
}

function unit(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function drawShadow(ctx) {
  const { g, metrics, pose } = ctx;
  const lift = Math.max(0, pose.lift);
  const shrink = clamp(1 - lift / (metrics.height * 0.9), 0.35, 1);
  g.fillStyle(0x05070a, 0.3 * shrink);
  g.fillEllipse(0, 0, metrics.height * 0.5 * shrink, metrics.height * 0.065 * shrink);
  g.fillStyle(0x05070a, 0.32 * shrink);
  g.fillEllipse(0, 0, metrics.height * 0.26 * shrink, metrics.height * 0.04 * shrink);
}

function drawArm(ctx, side, far) {
  const { g, points, metrics, palette, kind } = ctx;
  const shoulder = points[`shoulder${side}`];
  const elbow = points[`elbow${side}`];
  const wrist = points[`wrist${side}`];
  const hand = points[`hand${side}`];
  const tint = far ? -0.22 : 0;
  const android = kind === "android";
  const sleeve = android ? palette.metal : palette.suit;
  const handColor = ctx.gear.has("gloves") ? palette.glove : palette.skin;
  const width = metrics.armWidth;

  stroke(g, shoulder, elbow, width, shade(sleeve, tint));
  stroke(g, elbow, wrist, width * 0.9, shade(sleeve, tint));

  if (android) {
    g.lineStyle(1.2, palette.accent, far ? 0.2 : 0.45);
    g.strokeCircle(elbow.x, elbow.y, width * 0.58);
  }

  dot(g, wrist, width * 0.5, shade(android ? palette.metalDark : palette.suitDark, tint));
  stroke(g, wrist, hand, width * 0.72, shade(handColor, tint));
  dot(g, hand, metrics.handRadius, shade(handColor, tint));
}

function drawLeg(ctx, side, far) {
  const { g, points, metrics, palette, kind, skin } = ctx;
  const hip = points[`hip${side}`];
  const knee = points[`knee${side}`];
  const ankle = points[`ankle${side}`];
  const heel = points[`heel${side}`];
  const toe = points[`foot${side}`];
  const tint = far ? -0.2 : 0;
  const android = kind === "android";
  const pants = android ? palette.metalDark : palette.pants;
  const bootColor = skin.footwear === "sneaker" ? palette.boot : palette.boot;
  const width = metrics.limbWidth;

  stroke(g, hip, knee, width * 1.04, shade(pants, tint));
  stroke(g, knee, ankle, width * 0.9, shade(pants, tint));
  if (android) {
    g.lineStyle(1, palette.accent, far ? 0.16 : 0.36);
    g.strokeCircle(knee.x, knee.y, width * 0.55);
  }

  dot(g, ankle, width * 0.5, shade(android ? palette.metal : palette.suitDark, tint));
  stroke(g, heel, toe, width * 0.98, shade(bootColor, tint));

  if (skin.footwear === "sneaker") {
    const sole = shade(palette.accent, -0.05);
    stroke(
      g,
      { x: heel.x, y: heel.y + width * 0.42 },
      { x: toe.x, y: toe.y + width * 0.42 },
      width * 0.18,
      sole,
      far ? 0.4 : 0.9,
    );
  } else if (android || skin.footwear === "metal") {
    stroke(
      g,
      { x: heel.x, y: heel.y - width * 0.1 },
      { x: toe.x, y: toe.y - width * 0.1 },
      width * 0.16,
      palette.accent,
      far ? 0.24 : 0.55,
    );
  }
}

function drawCoatBack(ctx) {
  const { g, points, metrics, palette, pose, time } = ctx;
  const { pelvis, chest } = points;
  const up = unit(pelvis, chest);
  const side = { x: -up.y, y: up.x };
  const length = (ctx.skin.outfit?.length ?? 0.4) * metrics.height;
  const hem = {
    x: pelvis.x - up.x * length,
    y: pelvis.y - up.y * length,
  };
  const sway = Math.sin(time * 2.1 + pose.torso * 3) * metrics.height * 0.008;
  const pointsList = [
    { x: chest.x + side.x * metrics.torsoWidth * 0.58, y: chest.y + side.y * metrics.torsoWidth * 0.58 },
    { x: hem.x + side.x * (metrics.torsoWidth * 0.8 + sway), y: hem.y + side.y * (metrics.torsoWidth * 0.8 + sway) },
    { x: hem.x - side.x * (metrics.torsoWidth * 0.9 - sway), y: hem.y - side.y * (metrics.torsoWidth * 0.9 - sway) },
    { x: chest.x - side.x * metrics.torsoWidth * 0.62, y: chest.y - side.y * metrics.torsoWidth * 0.62 },
  ];
  poly(g, pointsList, palette.coat);
  stroke(
    g,
    { x: hem.x - side.x * metrics.torsoWidth * 0.86, y: hem.y - side.y * metrics.torsoWidth * 0.86 },
    { x: hem.x + side.x * metrics.torsoWidth * 0.76, y: hem.y + side.y * metrics.torsoWidth * 0.76 },
    metrics.limbWidth * 0.28,
    palette.accent,
    0.34,
  );
}

function drawBackpack(ctx) {
  const { g, points, metrics, palette } = ctx;
  const { chest } = points;
  const up = unit(points.pelvis, points.chest);
  const side = { x: -up.y, y: up.x };
  const center = {
    x: chest.x - side.x * metrics.torsoWidth * 0.52 - up.x * metrics.torsoLength * 0.08,
    y: chest.y - side.y * metrics.torsoWidth * 0.52 - up.y * metrics.torsoLength * 0.08,
  };
  const box = orientedBox(
    center, side, up,
    metrics.torsoWidth * 1.05,
    metrics.torsoLength * 0.8,
    metrics.torsoWidth * 0.2,
  );
  poly(g, box, palette.pack);
  const flap = orientedBox(
    { x: center.x + up.x * metrics.torsoLength * 0.2, y: center.y + up.y * metrics.torsoLength * 0.2 },
    side, up, metrics.torsoWidth * 0.9, metrics.torsoLength * 0.24, metrics.torsoWidth * 0.12,
  );
  poly(g, flap, shade(palette.pack, -0.2));
  dot(
    g,
    { x: center.x + side.x * metrics.torsoWidth * 0.35, y: center.y + side.y * metrics.torsoWidth * 0.35 },
    metrics.torsoWidth * 0.07,
    palette.accent,
  );
}

function drawMessengerBag(ctx) {
  const { g, points, metrics, palette } = ctx;
  const up = unit(points.pelvis, points.chest);
  const side = { x: -up.y, y: up.x };
  const center = {
    x: points.pelvis.x - side.x * metrics.torsoWidth * 0.6 - up.x * metrics.height * 0.07,
    y: points.pelvis.y - side.y * metrics.torsoWidth * 0.6 - up.y * metrics.height * 0.07,
  };
  const box = orientedBox(
    center, side, up, metrics.torsoWidth * 0.62, metrics.torsoLength * 0.56, metrics.torsoWidth * 0.12,
  );
  poly(g, box, palette.accentDark);
  const flap = orientedBox(
    { x: center.x - up.x * metrics.torsoLength * 0.08, y: center.y - up.y * metrics.torsoLength * 0.08 },
    side, up, metrics.torsoWidth * 0.58, metrics.torsoLength * 0.2, metrics.torsoWidth * 0.08,
  );
  poly(g, flap, shade(palette.accent, -0.12));
}

function drawScarfTail(ctx) {
  const { g, points, metrics, palette, time } = ctx;
  const up = unit(points.pelvis, points.chest);
  const side = { x: -up.y, y: up.x };
  const neck = points.neck;
  const sway = Math.sin(time * 3.4) * metrics.height * 0.014;
  const pointsList = [
    { x: neck.x - side.x * metrics.torsoWidth * 0.28, y: neck.y - up.y * metrics.torsoWidth * 0.2 },
    { x: neck.x - side.x * (metrics.torsoWidth * 0.5), y: neck.y - up.y * metrics.torsoWidth * 0.2 },
    { x: neck.x - side.x * (metrics.torsoWidth * 0.58) - up.x * metrics.torsoLength * 0.85 + sway, y: neck.y - side.y * metrics.torsoWidth * 0.58 - up.y * metrics.torsoLength * 0.85 },
    { x: neck.x - side.x * (metrics.torsoWidth * 0.16) - up.x * metrics.torsoLength * 0.95, y: neck.y - side.y * metrics.torsoWidth * 0.16 - up.y * metrics.torsoLength * 0.95 },
  ];
  poly(g, pointsList, palette.accent);
}

function drawHoodMantle(ctx) {
  const { g, points, metrics, palette } = ctx;
  const neck = points.neck;
  g.fillStyle(palette.hood, 1);
  g.fillEllipse(neck.x, neck.y + metrics.torsoLength * 0.16, metrics.torsoWidth * 1.7, metrics.torsoWidth * 1.05);
}

function drawTorso(ctx) {
  const { g, points, metrics, palette, kind } = ctx;
  const { pelvis, chest } = points;
  const up = unit(pelvis, chest);
  const side = { x: -up.y, y: up.x };
  const android = kind === "android";
  const width = metrics.torsoWidth * (kind === "puffer" ? 1.14 : 1);

  stroke(g, pelvis, chest, width, android ? palette.metalDark : palette.suit);
  stroke(
    g,
    { x: pelvis.x - side.x * width * 0.26, y: pelvis.y - side.y * width * 0.26 },
    { x: chest.x - side.x * width * 0.26, y: chest.y - side.y * width * 0.26 },
    width * 0.2,
    android ? palette.metal : palette.suitDark,
    0.85,
  );

  if (kind === "armor") {
    const plate = orientedBox(
      { x: chest.x - up.x * metrics.torsoLength * 0.22, y: chest.y - up.y * metrics.torsoLength * 0.22 },
      side, up, width * 1.18, metrics.torsoLength * 0.55, width * 0.18,
    );
    poly(g, plate, palette.metal);
    dot(g, points.shoulderL, width * 0.4, palette.metalDark);
    dot(g, points.shoulderR, width * 0.4, palette.metalDark);
    stroke(g, pelvis, { x: pelvis.x + side.x * width * 0.5, y: pelvis.y + side.y * width * 0.5 }, width * 0.2, palette.belt);
  }

  if (kind === "puffer") {
    for (const ratio of [0.3, 0.58, 0.84]) {
      const center = {
        x: pelvis.x + up.x * metrics.torsoLength * ratio,
        y: pelvis.y + up.y * metrics.torsoLength * ratio,
      };
      stroke(
        g,
        { x: center.x - side.x * width * 0.42, y: center.y - side.y * width * 0.42 },
        { x: center.x + side.x * width * 0.42, y: center.y + side.y * width * 0.42 },
        width * 0.16,
        palette.suitDark,
        0.85,
      );
    }
  }

  if (kind === "coat" || kind === "overalls") {
    const belt = { x: pelvis.x - up.x * 2, y: pelvis.y - up.y * 2 };
    stroke(
      g,
      { x: belt.x - side.x * width * 0.52, y: belt.y - side.y * width * 0.52 },
      { x: belt.x + side.x * width * 0.52, y: belt.y + side.y * width * 0.52 },
      width * 0.18,
      palette.belt,
    );
    dot(
      g,
      { x: belt.x + side.x * width * 0.08, y: belt.y + side.y * width * 0.08 },
      width * 0.08,
      palette.accent,
    );
  }

  if (android) {
    const plate = orientedBox(
      { x: chest.x - up.x * metrics.torsoLength * 0.2, y: chest.y - up.y * metrics.torsoLength * 0.2 },
      side, up, width * 0.9, metrics.torsoLength * 0.48, width * 0.16,
    );
    poly(g, plate, palette.metalDark);
  }
}

function drawCoatFront(ctx) {
  const { g, points, metrics, palette, time } = ctx;
  const { pelvis, chest } = points;
  const up = unit(pelvis, chest);
  const side = { x: -up.y, y: up.x };
  const length = (ctx.skin.outfit?.length ?? 0.4) * metrics.height;
  const hem = { x: pelvis.x - up.x * length * 0.94, y: pelvis.y - up.y * length * 0.94 };
  const sway = Math.sin(time * 2.1 + 1.2) * metrics.height * 0.006;
  const panel = [
    { x: chest.x - up.x * metrics.torsoLength * 0.12 + side.x * metrics.torsoWidth * 0.16, y: chest.y - up.y * metrics.torsoLength * 0.12 + side.y * metrics.torsoWidth * 0.16 },
    { x: chest.x - up.x * metrics.torsoLength * 0.02 + side.x * metrics.torsoWidth * 0.52, y: chest.y - up.y * metrics.torsoLength * 0.02 + side.y * metrics.torsoWidth * 0.52 },
    { x: hem.x + side.x * (metrics.torsoWidth * 0.62 + sway), y: hem.y + side.y * (metrics.torsoWidth * 0.62 + sway) },
    { x: hem.x + side.x * (metrics.torsoWidth * 0.1 + sway), y: hem.y + side.y * (metrics.torsoWidth * 0.1 + sway) },
  ];
  poly(g, panel, shade(palette.coat, 0.06));
  stroke(
    g,
    { x: chest.x + side.x * metrics.torsoWidth * 0.16, y: chest.y + side.y * metrics.torsoWidth * 0.16 },
    { x: pelvis.x + side.x * metrics.torsoWidth * 0.48, y: pelvis.y + side.y * metrics.torsoWidth * 0.48 },
    metrics.limbWidth * 0.3,
    shade(palette.coat, -0.2),
  );

  if (ctx.skin.outfit?.collar) {
    const collar = [
      { x: points.neck.x + side.x * metrics.torsoWidth * 0.1, y: points.neck.y + side.y * metrics.torsoWidth * 0.1 },
      { x: points.neck.x + side.x * metrics.torsoWidth * 0.66, y: points.neck.y + side.y * metrics.torsoWidth * 0.66 },
      { x: chest.x - up.x * metrics.torsoLength * 0.18 + side.x * metrics.torsoWidth * 0.58, y: chest.y - up.y * metrics.torsoLength * 0.18 + side.y * metrics.torsoWidth * 0.58 },
    ];
    poly(g, collar, palette.coatDark);
  }
}

function drawOverallsFront(ctx) {
  const { g, points, metrics, palette } = ctx;
  const { pelvis, chest } = points;
  const up = unit(pelvis, chest);
  const side = { x: -up.y, y: up.x };
  const center = {
    x: pelvis.x + up.x * metrics.torsoLength * 0.5,
    y: pelvis.y + up.y * metrics.torsoLength * 0.5,
  };
  const bib = orientedBox(center, side, up, metrics.torsoWidth * 0.66, metrics.torsoLength * 0.62, metrics.torsoWidth * 0.1);
  poly(g, bib, palette.suitDark);
  const bibHill = orientedBox(
    { x: center.x + up.x * metrics.torsoLength * 0.26, y: center.y + up.y * metrics.torsoLength * 0.26 },
    side, up, metrics.torsoWidth * 0.5, metrics.torsoLength * 0.16, metrics.torsoWidth * 0.06,
  );
  poly(g, bibHill, shade(palette.suit, 0.08));

  for (const sign of [-1, 1]) {
    const top = {
      x: points.shoulderCenter.x + side.x * metrics.shoulderHalf * sign - up.x * 1,
      y: points.shoulderCenter.y + side.y * metrics.shoulderHalf * sign - up.y * 1,
    };
    const bottom = {
      x: center.x + side.x * metrics.torsoWidth * 0.22 * sign - up.x * metrics.torsoLength * 0.16,
      y: center.y + side.y * metrics.torsoWidth * 0.22 * sign - up.y * metrics.torsoLength * 0.16,
    };
    stroke(g, top, bottom, metrics.torsoWidth * 0.1, shade(palette.suit, -0.08));
  }
  dot(
    g,
    { x: center.x + side.x * metrics.torsoWidth * 0.2, y: center.y + side.y * metrics.torsoWidth * 0.2 },
    metrics.torsoWidth * 0.06,
    palette.accent,
  );
}

function drawHoodieFront(ctx) {
  const { g, points, metrics, palette, time } = ctx;
  const { pelvis, chest } = points;
  const up = unit(pelvis, chest);
  const side = { x: -up.y, y: up.x };
  const pocketY = {
    x: pelvis.x + up.x * metrics.torsoLength * 0.3,
    y: pelvis.y + up.y * metrics.torsoLength * 0.3,
  };
  stroke(
    g,
    { x: pocketY.x - side.x * metrics.torsoWidth * 0.36, y: pocketY.y - side.y * metrics.torsoWidth * 0.36 },
    { x: pocketY.x + side.x * metrics.torsoWidth * 0.4, y: pocketY.y + side.y * metrics.torsoWidth * 0.4 },
    metrics.torsoWidth * 0.09,
    palette.suitDark,
  );
  const sway = Math.sin(time * 2.4) * metrics.height * 0.004;
  for (const sign of [-1, 1]) {
    const start = {
      x: points.neck.x + side.x * metrics.torsoWidth * 0.28 * sign,
      y: points.neck.y + side.y * metrics.torsoWidth * 0.28 * sign,
    };
    const end = {
      x: start.x - up.x * metrics.torsoLength * 0.36 + side.x * sway * sign,
      y: start.y - up.y * metrics.torsoLength * 0.36,
    };
    stroke(g, start, end, metrics.limbWidth * 0.16, palette.accent, 0.85);
    dot(g, end, metrics.limbWidth * 0.16, palette.accentDark);
  }
}

function drawPufferFront(ctx) {
  const { g, points, metrics, palette } = ctx;
  const { pelvis, chest } = points;
  const up = unit(pelvis, chest);
  const side = { x: -up.y, y: up.x };
  stroke(
    g,
    { x: chest.x + side.x * metrics.torsoWidth * 0.06, y: chest.y + side.y * metrics.torsoWidth * 0.06 },
    { x: pelvis.x + side.x * metrics.torsoWidth * 0.58, y: pelvis.y + side.y * metrics.torsoWidth * 0.58 },
    metrics.limbWidth * 0.13,
    palette.suitDark,
    0.8,
  );
  const collar = {
    x: points.neck.x + up.x * metrics.torsoLength * 0.02,
    y: points.neck.y + up.y * metrics.torsoLength * 0.02,
  };
  g.fillStyle(palette.suitDark, 1);
  g.fillEllipse(collar.x, collar.y, metrics.torsoWidth * 1.1, metrics.torsoWidth * 0.55);
}

function drawArmorFront(ctx) {
  const { g, points, metrics, palette } = ctx;
  const { pelvis, chest } = points;
  const up = unit(pelvis, chest);
  const side = { x: -up.y, y: up.x };
  stroke(
    g,
    { x: pelvis.x - up.x * metrics.height * 0.02 - side.x * metrics.torsoWidth * 0.5, y: pelvis.y - up.y * metrics.height * 0.02 - side.y * metrics.torsoWidth * 0.5 },
    { x: pelvis.x - up.x * metrics.height * 0.02 + side.x * metrics.torsoWidth * 0.54, y: pelvis.y - up.y * metrics.height * 0.02 + side.y * metrics.torsoWidth * 0.54 },
    metrics.torsoWidth * 0.17,
    palette.belt,
  );
  stroke(
    g,
    { x: chest.x - up.x * metrics.torsoLength * 0.1 + side.x * metrics.torsoWidth * 0.2, y: chest.y - up.y * metrics.torsoLength * 0.1 + side.y * metrics.torsoWidth * 0.2 },
    { x: pelvis.x + side.x * metrics.torsoWidth * 0.6, y: pelvis.y + side.y * metrics.torsoWidth * 0.6 },
    metrics.limbWidth * 0.3,
    palette.metalDark,
  );
}

function drawNeck(ctx) {
  const { g, points, metrics, palette, kind } = ctx;
  const color = kind === "android" || kind === "armor" ? palette.metalDark : palette.skin;
  stroke(g, points.chest, points.neck, metrics.limbWidth * 0.78, color);
  dot(g, points.neck, metrics.limbWidth * 0.4, color);
}

function drawFaceRound(ctx, R, tilt) {
  const { g, points, palette, skin, time } = ctx;
  const head = points.head;
  const headSpec = skin.head ?? {};
  const eye = offsetPoint(head, R * 0.38, -R * 0.08, tilt);
  const blinkCycle = 4.4;
  const blinkPhase = ((time + (skin.blinkOffset ?? 0)) % blinkCycle);
  const blinking = blinkPhase > blinkCycle - 0.16;

  if (headSpec.beard) {
    g.fillStyle(palette.hair, 1);
    g.fillCircle(offsetPoint(head, 0.02 * R, 0.2 * R, tilt).x, offsetPoint(head, 0.02 * R, 0.2 * R, tilt).y, R * 0.92);
    g.fillStyle(palette.skin, 1);
    g.fillCircle(offsetPoint(head, 0.08 * R, -0.04 * R, tilt).x, offsetPoint(head, 0.08 * R, -0.04 * R, tilt).y, R * 0.8);
  }

  dot(g, offsetPoint(head, -R * 0.82, R * 0.06, tilt), R * 0.16, palette.skinShade);

  if (headSpec.eyes === "wide") {
    dot(g, eye, R * 0.145, 0xf7f2e8);
    dot(g, offsetPoint(head, R * 0.41, -R * 0.07, tilt), R * 0.078, palette.eye);
    dot(g, offsetPoint(head, R * 0.45, -R * 0.1, tilt), R * 0.024, 0xffffff);
  } else if (blinking) {
    stroke(
      g,
      offsetPoint(head, R * 0.28, -R * 0.07, tilt),
      offsetPoint(head, R * 0.48, -R * 0.07, tilt),
      R * 0.05,
      palette.eye,
    );
  } else {
    dot(g, eye, R * 0.1, palette.eye);
    dot(g, offsetPoint(head, R * 0.42, -R * 0.11, tilt), R * 0.032, 0xf7f2e8);
  }

  const brow = headSpec.brow ?? "straight";
  const browStart = offsetPoint(head, R * 0.2, brow === "up" ? -R * 0.35 : -R * 0.34, tilt);
  const browEnd = offsetPoint(head, R * 0.55, brow === "stern" ? -R * 0.26 : brow === "up" ? -R * 0.39 : -R * 0.33, tilt);
  stroke(g, browStart, browEnd, R * 0.07, palette.brow);

  dot(g, offsetPoint(head, R * 0.91, R * 0.03, tilt), R * 0.085, palette.skinShade);

  const mouth = headSpec.mouth ?? "neutral";
  if (mouth === "smile") {
    stroke(g, offsetPoint(head, R * 0.34, R * 0.27, tilt), offsetPoint(head, R * 0.5, R * 0.34, tilt), R * 0.055, palette.eye);
    stroke(g, offsetPoint(head, R * 0.5, R * 0.34, tilt), offsetPoint(head, R * 0.66, R * 0.27, tilt), R * 0.055, palette.eye);
  } else if (mouth === "smirk") {
    stroke(g, offsetPoint(head, R * 0.36, R * 0.31, tilt), offsetPoint(head, R * 0.58, R * 0.28, tilt), R * 0.05, palette.eye);
    stroke(g, offsetPoint(head, R * 0.58, R * 0.28, tilt), offsetPoint(head, R * 0.66, R * 0.22, tilt), R * 0.045, palette.eye);
  } else {
    stroke(g, offsetPoint(head, R * 0.38, R * 0.29, tilt), offsetPoint(head, R * 0.62, R * 0.29, tilt), R * 0.05, palette.eye);
  }

  if (headSpec.freckles) {
    for (const [fx, fy] of [[0.3, 0.14], [0.41, 0.18], [0.33, 0.23]]) {
      dot(g, offsetPoint(head, R * fx, R * fy, tilt), R * 0.035, palette.skinShade);
    }
  }

  if (headSpec.hat === "beanie") {
    const domeCenter = offsetPoint(head, 0, -R * 0.42, tilt);
    dome(g, domeCenter, R * 1.06, R * 0.84, tilt, palette.hat);
    stroke(
      g,
      offsetPoint(head, -R * 0.98, -R * 0.34, tilt),
      offsetPoint(head, R * 0.94, -R * 0.38, tilt),
      R * 0.28,
      shade(palette.hat, -0.16),
    );
    dot(g, offsetPoint(head, -R * 0.12, -R * 1.38, tilt), R * 0.18, palette.accent);
  } else if (headSpec.hat === "cap") {
    const domeCenter = offsetPoint(head, 0, -R * 0.38, tilt);
    dome(g, domeCenter, R * 1.08, R * 0.76, tilt, palette.hat);
    stroke(
      g,
      offsetPoint(head, -R * 0.95, -R * 0.3, tilt),
      offsetPoint(head, R * 0.96, -R * 0.33, tilt),
      R * 0.15,
      palette.accent,
    );
    stroke(
      g,
      offsetPoint(head, R * 0.36, -R * 0.36, tilt),
      offsetPoint(head, R * 1.34, -R * 0.43, tilt),
      R * 0.16,
      shade(palette.hat, -0.22),
    );
    dot(g, offsetPoint(head, R * 0.02, -R * 1.1, tilt), R * 0.07, palette.accentDark);
  }

  if (headSpec.goggles) {
    stroke(
      g,
      offsetPoint(head, -R * 0.98, -R * 0.58, tilt),
      offsetPoint(head, R * 0.7, -R * 0.62, tilt),
      R * 0.13,
      palette.belt,
    );
    for (const [gx, gy, gr] of [[0.18, -0.58, 0.23], [0.6, -0.55, 0.2]]) {
      const center = offsetPoint(head, R * gx, R * gy, tilt);
      dot(g, center, R * gr, palette.metalDark);
      dot(g, center, R * (gr - 0.06), palette.accent);
      dot(g, offsetPoint(center, -R * 0.04, -R * 0.04), R * 0.05, 0xfff4d8);
    }
  }

  if (ctx.gear.has("headphones")) {
    stroke(g, offsetPoint(head, -R * 1.0, -R * 0.1, tilt), offsetPoint(head, -R * 0.7, -R * 0.9, tilt), R * 0.11, palette.accentDark);
    stroke(g, offsetPoint(head, -R * 0.7, -R * 0.9, tilt), offsetPoint(head, R * 0.16, -R * 1.06, tilt), R * 0.11, palette.accentDark);
    stroke(g, offsetPoint(head, R * 0.16, -R * 1.06, tilt), offsetPoint(head, R * 0.66, -R * 0.66, tilt), R * 0.11, palette.accentDark);
    const cup = offsetPoint(head, -R * 0.9, R * 0.06, tilt);
    dot(g, cup, R * 0.34, palette.accentDark);
    dot(g, cup, R * 0.2, palette.accent);
    dot(g, cup, R * 0.07, 0x102028);
  }
}

function drawHeadRound(ctx) {
  const { g, points, metrics, palette, skin } = ctx;
  const head = points.head;
  const R = metrics.headRadius;
  const tilt = ctx.solved.tilt;
  const headSpec = skin.head ?? {};
  drawNeck(ctx);

  if (headSpec.hood) {
    g.fillStyle(palette.hood, 1);
    g.fillCircle(head.x, head.y, R * 1.52);
    g.fillStyle(shade(palette.hood, -0.22), 1);
    g.fillCircle(head.x - Math.sin(tilt) * R * 0.04, head.y + Math.cos(tilt) * R * 0.04, R * 1.24);
  }

  if (headSpec.hair !== "none") {
    const hairCenter = offsetPoint(head, -R * 0.08, -R * 0.13, tilt);
    dot(g, hairCenter, R * 1.03, palette.hair);
    if (headSpec.hair === "bun") {
      const bun = offsetPoint(head, -R * 0.82, -R * 0.55, tilt);
      dot(g, bun, R * 0.44, palette.hair);
      dot(g, offsetPoint(bun, R * 0.1, -R * 0.1, tilt), R * 0.16, palette.hairShade);
    } else if (headSpec.hair === "messy") {
      for (const [hx, hy, hr] of [[-0.5, -0.86, 0.24], [-0.08, -1.02, 0.26], [0.36, -0.9, 0.22], [0.7, -0.62, 0.17]]) {
        dot(g, offsetPoint(head, R * hx, R * hy, tilt), R * hr, palette.hair);
      }
    }
  }

  const faceCenter = offsetPoint(head, R * 0.06, R * 0.04, tilt);
  dot(g, faceCenter, R * 0.95, palette.skin);
  drawFaceRound(ctx, R, tilt);
}

function drawHeadAndroid(ctx) {
  const { g, points, metrics, palette, time } = ctx;
  const head = points.head;
  const R = metrics.headRadius;
  const tilt = ctx.solved.tilt;
  const side = { x: Math.cos(tilt), y: Math.sin(tilt) };
  const up = { x: Math.sin(tilt), y: -Math.cos(tilt) };
  drawNeck(ctx);

  const shell = orientedBox(head, side, up, R * 1.7, R * 1.95, R * 0.34);
  poly(g, shell, palette.metalDark);
  const plate = orientedBox(head, side, up, R * 1.42, R * 1.62, R * 0.24);
  poly(g, plate, palette.metal);

  const visor = {
    x: head.x + up.x * R * 0.08 + side.x * R * 0.1,
    y: head.y + up.y * R * 0.08 + side.y * R * 0.1,
  };
  stroke(
    g,
    { x: visor.x - side.x * R * 0.42, y: visor.y - side.y * R * 0.42 },
    { x: visor.x + side.x * R * 0.56, y: visor.y + side.y * R * 0.56 },
    R * 0.4,
    0x101a22,
  );
  const pulse = 0.55 + 0.3 * Math.sin(time * 3.1);
  stroke(
    g,
    { x: visor.x - side.x * R * 0.3, y: visor.y - side.y * R * 0.3 },
    { x: visor.x + side.x * R * 0.44, y: visor.y + side.y * R * 0.44 },
    R * 0.12,
    palette.glow,
    pulse,
  );
  dot(
    g,
    { x: visor.x + side.x * R * 0.54, y: visor.y + side.y * R * 0.54 },
    R * 0.06,
    0xffffff,
    0.9,
  );

  const antennaBase = {
    x: head.x + up.x * R * 0.9 - side.x * R * 0.32,
    y: head.y + up.y * R * 0.9 - side.y * R * 0.32,
  };
  const antennaTip = {
    x: antennaBase.x + up.x * R * 0.72 - side.x * R * 0.12,
    y: antennaBase.y + up.y * R * 0.72 - side.y * R * 0.12,
  };
  stroke(g, antennaBase, antennaTip, R * 0.09, palette.metalDark);
  dot(g, antennaTip, R * 0.12, palette.glow, pulse);

  stroke(
    g,
    { x: head.x - side.x * R * 0.3 - up.x * R * 0.7, y: head.y - side.y * R * 0.3 - up.y * R * 0.7 },
    { x: head.x + side.x * R * 0.5 - up.x * R * 0.72, y: head.y + side.y * R * 0.5 - up.y * R * 0.72 },
    R * 0.05,
    palette.accent,
    0.4,
  );
}

function drawHeadHelmet(ctx) {
  const { g, points, metrics, palette, time } = ctx;
  const head = points.head;
  const R = metrics.headRadius;
  const tilt = ctx.solved.tilt;
  const side = { x: Math.cos(tilt), y: Math.sin(tilt) };
  const up = { x: Math.sin(tilt), y: -Math.cos(tilt) };
  drawNeck(ctx);

  dot(g, head, R * 1.12, palette.metalDark);
  const jaw = orientedBox(
    { x: head.x - up.x * R * 0.5, y: head.y - up.y * R * 0.5 },
    side, up, R * 1.35, R * 1.0, R * 0.3,
  );
  poly(g, jaw, palette.metal);

  const pulse = 0.6 + 0.28 * Math.sin(time * 2.6);
  const visorCenter = {
    x: head.x + side.x * R * 0.34 + up.x * R * 0.02,
    y: head.y + side.y * R * 0.34 + up.y * R * 0.02,
  };
  stroke(
    g,
    { x: visorCenter.x - side.x * R * 0.58, y: visorCenter.y - side.y * R * 0.58 },
    { x: visorCenter.x + side.x * R * 0.56, y: visorCenter.y + side.y * R * 0.56 },
    R * 0.44,
    0x0a0b0e,
  );
  stroke(
    g,
    { x: visorCenter.x - side.x * R * 0.46, y: visorCenter.y - side.y * R * 0.46 },
    { x: visorCenter.x + side.x * R * 0.44, y: visorCenter.y + side.y * R * 0.44 },
    R * 0.13,
    palette.glow,
    pulse,
  );
  dot(g, { x: visorCenter.x + side.x * R * 0.5, y: visorCenter.y + side.y * R * 0.5 }, R * 0.06, 0xffe3d8, 0.85);

  stroke(
    g,
    { x: head.x - up.x * R * 0.1 - side.x * R * 1.0, y: head.y - up.y * R * 0.1 - side.y * R * 1.0 },
    { x: head.x + up.x * R * 0.95 - side.x * R * 0.1, y: head.y + up.y * R * 0.95 - side.y * R * 0.1 },
    R * 0.11,
    palette.metal,
    0.7,
  );
  for (const dy of [-0.28, -0.02]) {
    stroke(
      g,
      { x: head.x - side.x * R * 1.0 + up.x * R * dy, y: head.y - side.y * R * 1.0 + up.y * R * dy },
      { x: head.x - side.x * R * 0.66 + up.x * R * dy, y: head.y - side.y * R * 0.66 + up.y * R * dy },
      R * 0.055,
      palette.metalDark,
    );
  }
}

function drawHead(ctx) {
  const shape = ctx.skin.head?.shape ?? "round";
  if (shape === "android") {
    drawHeadAndroid(ctx);
  } else if (shape === "helmet") {
    drawHeadHelmet(ctx);
  } else {
    drawHeadRound(ctx);
  }
}

function drawBadge(ctx) {
  const { g, points, metrics, palette } = ctx;
  const { chest } = points;
  const up = unit(points.pelvis, points.chest);
  const side = { x: -up.y, y: up.x };
  const center = {
    x: chest.x - up.x * metrics.torsoLength * 0.26 + side.x * metrics.torsoWidth * 0.28,
    y: chest.y - up.y * metrics.torsoLength * 0.26 + side.y * metrics.torsoWidth * 0.28,
  };
  const box = orientedBox(center, side, up, metrics.torsoWidth * 0.18, metrics.torsoWidth * 0.24, metrics.torsoWidth * 0.04);
  poly(g, box, palette.accent);
  dot(g, center, metrics.torsoWidth * 0.035, palette.accentDark);
}

function drawToolbelt(ctx) {
  const { g, points, metrics, palette } = ctx;
  const up = unit(points.pelvis, points.chest);
  const side = { x: -up.y, y: up.x };
  const center = {
    x: points.pelvis.x - up.x * metrics.height * 0.025,
    y: points.pelvis.y - up.y * metrics.height * 0.025,
  };
  stroke(
    g,
    { x: center.x - side.x * metrics.torsoWidth * 0.58, y: center.y - side.y * metrics.torsoWidth * 0.58 },
    { x: center.x + side.x * metrics.torsoWidth * 0.58, y: center.y + side.y * metrics.torsoWidth * 0.58 },
    metrics.torsoWidth * 0.2,
    palette.belt,
  );
  for (const sign of [-1, 1]) {
    const pouch = {
      x: center.x + side.x * metrics.torsoWidth * 0.38 * sign - up.x * metrics.height * 0.035,
      y: center.y + side.y * metrics.torsoWidth * 0.38 * sign - up.y * metrics.height * 0.035,
    };
    const box = orientedBox(pouch, side, up, metrics.torsoWidth * 0.24, metrics.height * 0.055, metrics.torsoWidth * 0.05);
    poly(g, box, shade(palette.belt, 0.1));
    dot(g, pouch, metrics.torsoWidth * 0.04, palette.accent);
  }
  const wrench = {
    x: center.x + side.x * metrics.torsoWidth * 0.55,
    y: center.y + side.y * metrics.torsoWidth * 0.55 - up.y * metrics.height * 0.03,
  };
  const wrenchEnd = {
    x: wrench.x - up.x * metrics.height * 0.1,
    y: wrench.y - up.y * metrics.height * 0.1,
  };
  stroke(g, wrench, wrenchEnd, metrics.limbWidth * 0.3, palette.metal);
  g.lineStyle(metrics.limbWidth * 0.22, palette.metal);
  g.strokeCircle(wrenchEnd.x, wrenchEnd.y, metrics.limbWidth * 0.42);
}

function drawMessengerStrap(ctx) {
  const { g, points, metrics, palette } = ctx;
  const up = unit(points.pelvis, points.chest);
  const side = { x: -up.y, y: up.x };
  const shoulder = {
    x: points.shoulderCenter.x + side.x * metrics.torsoWidth * 0.24 + up.x * metrics.torsoLength * 0.06,
    y: points.shoulderCenter.y + side.y * metrics.torsoWidth * 0.24 + up.y * metrics.torsoLength * 0.06,
  };
  const hip = {
    x: points.pelvis.x - side.x * metrics.torsoWidth * 0.3 - up.x * metrics.height * 0.02,
    y: points.pelvis.y - side.y * metrics.torsoWidth * 0.3 - up.y * metrics.height * 0.02,
  };
  stroke(g, shoulder, hip, metrics.torsoWidth * 0.14, palette.accentDark);
}

function drawBackpackStraps(ctx) {
  const { g, points, metrics, palette } = ctx;
  const up = unit(points.pelvis, points.chest);
  const side = { x: -up.y, y: up.x };
  const shoulder = {
    x: points.shoulderCenter.x + side.x * metrics.shoulderHalf * 0.6,
    y: points.shoulderCenter.y + side.y * metrics.shoulderHalf * 0.6,
  };
  const chestLow = {
    x: points.chest.x - up.x * metrics.torsoLength * 0.3 + side.x * metrics.torsoWidth * 0.3,
    y: points.chest.y - up.y * metrics.torsoLength * 0.3 + side.y * metrics.torsoWidth * 0.3,
  };
  stroke(g, shoulder, chestLow, metrics.torsoWidth * 0.12, shade(palette.pack, -0.15));
}

function drawScarfKnot(ctx) {
  const { g, points, metrics, palette, time } = ctx;
  const up = unit(points.pelvis, points.chest);
  const side = { x: -up.y, y: up.x };
  const neck = points.neck;
  stroke(
    g,
    { x: neck.x - side.x * metrics.torsoWidth * 0.5, y: neck.y - side.y * metrics.torsoWidth * 0.5 },
    { x: neck.x + side.x * metrics.torsoWidth * 0.48, y: neck.y + side.y * metrics.torsoWidth * 0.48 },
    metrics.torsoWidth * 0.26,
    palette.accent,
  );
  const knot = {
    x: neck.x + side.x * metrics.torsoWidth * 0.32,
    y: neck.y + side.y * metrics.torsoWidth * 0.32 - up.y * metrics.torsoWidth * 0.08,
  };
  dot(g, knot, metrics.torsoWidth * 0.12, shade(palette.accent, 0.12));
  const sway = Math.sin(time * 3.2) * metrics.height * 0.012;
  const tail = [
    { x: knot.x - side.x * metrics.torsoWidth * 0.1, y: knot.y },
    { x: knot.x + side.x * metrics.torsoWidth * 0.1, y: knot.y },
    { x: knot.x + side.x * metrics.torsoWidth * 0.16 + sway - up.x * metrics.torsoLength * 0.34, y: knot.y - up.y * metrics.torsoLength * 0.34 },
    { x: knot.x - side.x * metrics.torsoWidth * 0.08 + sway - up.x * metrics.torsoLength * 0.3, y: knot.y - up.y * metrics.torsoLength * 0.3 },
  ];
  poly(g, tail, shade(palette.accent, -0.06));
}

function drawChestCore(ctx, small = false) {
  const { g, points, metrics, palette, time } = ctx;
  const up = unit(points.pelvis, points.chest);
  const side = { x: -up.y, y: up.x };
  const center = {
    x: points.chest.x - up.x * metrics.torsoLength * 0.24 + side.x * metrics.torsoWidth * 0.24,
    y: points.chest.y - up.y * metrics.torsoLength * 0.24 + side.y * metrics.torsoWidth * 0.24,
  };
  const pulse = 0.55 + 0.3 * Math.sin(time * 2.8);
  const radius = small ? metrics.torsoWidth * 0.09 : metrics.torsoWidth * 0.2;
  g.fillStyle(palette.accentDark, 1);
  g.fillCircle(center.x, center.y, radius * 1.45);
  g.fillStyle(palette.glow, pulse);
  g.fillCircle(center.x, center.y, radius);
  g.fillStyle(0xffffff, pulse);
  g.fillCircle(center.x, center.y, radius * 0.4);
}

function drawGearFront(ctx) {
  const { gear } = ctx;
  const front = [];

  if (gear.has("backpack")) front.push(() => drawBackpackStraps(ctx));
  if (gear.has("messengerbag")) front.push(() => drawMessengerStrap(ctx));
  if (gear.has("scarf")) front.push(() => drawScarfKnot(ctx));
  if (gear.has("badge")) front.push(() => drawBadge(ctx));
  if (gear.has("toolbelt")) front.push(() => drawToolbelt(ctx));
  if (gear.has("chestcore")) front.push(() => drawChestCore(ctx));
  if (gear.has("chestlight")) front.push(() => drawChestCore(ctx, true));

  for (const draw of front) draw();
}

function drawDebug(ctx) {
  const { g, solved, metrics } = ctx;
  const color = 0x6ff0ff;
  for (const bone of solved.bones) {
    g.lineStyle(1.15, color, 0.8);
    g.lineBetween(bone.a.x, bone.a.y, bone.b.x, bone.b.y);
  }
  for (const point of Object.values(solved.points)) {
    g.fillStyle(color, 0.9);
    g.fillCircle(point.x, point.y, 1.8);
  }
  g.lineStyle(1, 0xffb36d, 0.5);
  g.lineBetween(-metrics.height * 0.45, 0, metrics.height * 0.45, 0);
}

/**
 * Draws one character with a shared skeleton.
 * `g` is a Phaser.Graphics-like object with the usual fill/line methods.
 */
export function drawCharacter(g, skin, pose, options = {}) {
  const metrics = skeletonFor(skin);
  const palette = resolvePalette(skin);
  const solved = solveSkeleton(metrics, pose);
  const ctx = {
    g,
    skin,
    palette,
    metrics,
    solved,
    pose,
    points: solved.points,
    gear: gearOf(skin),
    kind: skin.outfit?.kind ?? "plain",
    time: options.time ?? 0,
  };

  g.clear();
  g.setPosition(options.x ?? 0, options.y ?? 0);
  const scale = options.scale ?? 1;
  g.setScale((options.facing ?? 1) * scale, scale);
  g.setAlpha(options.alpha ?? 1);

  drawShadow(ctx);
  drawArm(ctx, "L", true);
  drawLeg(ctx, "L", true);
  if (ctx.kind === "coat" || ctx.kind === "armor") drawCoatBack(ctx);
  if (ctx.gear.has("backpack")) drawBackpack(ctx);
  if (ctx.gear.has("messengerbag")) drawMessengerBag(ctx);
  if (ctx.gear.has("scarf")) drawScarfTail(ctx);
  if (skin.head?.hood) drawHoodMantle(ctx);

  drawTorso(ctx);
  drawLeg(ctx, "R", false);

  if (ctx.kind === "coat") drawCoatFront(ctx);
  if (ctx.kind === "overalls") drawOverallsFront(ctx);
  if (ctx.kind === "hoodie") drawHoodieFront(ctx);
  if (ctx.kind === "puffer") drawPufferFront(ctx);
  if (ctx.kind === "armor") drawArmorFront(ctx);

  drawHead(ctx);
  drawArm(ctx, "R", false);
  drawGearFront(ctx);

  if (options.debug) drawDebug(ctx);
  return solved;
}
