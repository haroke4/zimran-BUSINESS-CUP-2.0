import { buildSkeleton, solveSkeleton } from "./rig.js?v=12";

export const STAGE_VIEWBOX = "-90 -196 180 206";

const NS = "http://www.w3.org/2000/svg";

export const basePalette = {
  skin: 0xe3b28c,
  hair: 0x2b2730,
  shirt: 0x33404f,
  pants: 0x252d38,
  shoe: 0x1a1f27,
  accent: 0xffb36d,
  bag: 0x3f5163,
  belt: 0x2a211c,
  eye: 0x181820,
  hood: 0x2f3a52,
};

export function shade(color, amount) {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const mix = (channel) => Math.round(channel + (target - channel) * t);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

export function colorToCss(color) {
  return `#${(color >>> 0).toString(16).padStart(6, "0")}`;
}

const paletteCache = new WeakMap();

export function resolvePalette(skin) {
  if (paletteCache.has(skin)) return paletteCache.get(skin);
  const palette = { ...basePalette, ...(skin.palette ?? {}) };
  palette.skinShade = skin.palette?.skinShade ?? shade(palette.skin, -0.16);
  palette.hairShade = skin.palette?.hairShade ?? shade(palette.hair, -0.28);
  palette.shirtDark = skin.palette?.shirtDark ?? shade(palette.shirt, -0.26);
  palette.accentDark = skin.palette?.accentDark ?? shade(palette.accent, -0.3);
  palette.bagDark = skin.palette?.bagDark ?? shade(palette.bag, -0.24);
  paletteCache.set(skin, palette);
  return palette;
}

const skeletonCache = new WeakMap();

export function skeletonFor(skin) {
  if (!skeletonCache.has(skin)) skeletonCache.set(skin, buildSkeleton(skin));
  return skeletonCache.get(skin);
}

const n = (value) => Math.round(value * 100) / 100;

function circlePath(center, radius) {
  const r = n(radius);
  return `M${n(center.x - r)} ${n(center.y)}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
}

function ellipsePath(center, rx, ry) {
  return `M${n(center.x - rx)} ${n(center.y)}a${n(rx)} ${n(ry)} 0 1 0 ${n(rx * 2)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-rx * 2)} 0`;
}

function polyPath(points) {
  return `M${points.map((point) => `${n(point.x)} ${n(point.y)}`).join("L")}Z`;
}

function offsetPoint(center, dx, dy, angle = 0) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function unit(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
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
  return polyPath(locals.map(([x, y]) => ({
    x: center.x + side.x * x + up.x * y,
    y: center.y + side.y * x + up.y * y,
  })));
}

export function drawCommands(skin, solved, time, { debug = false } = {}) {
  const { points: p, metrics: m, pose } = solved;
  const palette = resolvePalette(skin);
  const gear = new Set(skin.gear ?? []);
  const kind = skin.outfit?.kind ?? "plain";
  const headSpec = skin.head ?? {};
  const tilt = solved.tilt;
  const R = m.headRadius;
  const commands = [];

  const ink = (a, b, width, color, alpha = 1) => {
    commands.push({
      d: `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`,
      stroke: color,
      width: n(width),
      alpha,
    });
  };
  const dot = (point, radius, color, alpha = 1) => {
    commands.push({ d: circlePath(point, radius), fill: color, alpha });
  };
  const shape = (d, color, alpha = 1) => {
    commands.push({ d, fill: color, alpha });
  };
  const curve = (a, c, b, width, color, alpha = 1) => {
    commands.push({
      d: `M${n(a.x)} ${n(a.y)}Q${n(c.x)} ${n(c.y)} ${n(b.x)} ${n(b.y)}`,
      stroke: color,
      width: n(width),
      alpha,
    });
  };
  const curve3 = (a, c1, c2, b, width, color, alpha = 1) => {
    commands.push({
      d: `M${n(a.x)} ${n(a.y)}C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(b.x)} ${n(b.y)}`,
      stroke: color,
      width: n(width),
      alpha,
    });
  };

  const shrink = Math.max(0.35, Math.min(1, 1 - Math.max(0, pose.lift) / (m.height * 0.85)));
  shape(ellipsePath({ x: 0, y: 0 }, m.height * 0.4 * shrink, m.height * 0.036 * shrink), 0x05070a, 0.35);

  const drawArm = (side, far) => {
    const tint = far ? -0.2 : 0;
    const sleeve = shade(palette.shirt, tint);
    const handColor = shade(palette.skin, tint);
    ink(p[`shoulder${side}`], p[`elbow${side}`], m.armWidth, sleeve);
    ink(p[`elbow${side}`], p[`wrist${side}`], m.armWidth * 0.9, sleeve);
    ink(p[`wrist${side}`], p[`hand${side}`], m.armWidth * 0.72, handColor);
    dot(p[`hand${side}`], m.limbWidth * 0.54, handColor);
  };

  const drawLeg = (side, far) => {
    const tint = far ? -0.18 : 0;
    const pants = shade(palette.pants, tint);
    const shoe = shade(palette.shoe, tint);
    ink(p[`hip${side}`], p[`knee${side}`], m.limbWidth * 1.05, pants);
    ink(p[`knee${side}`], p[`ankle${side}`], m.limbWidth * 0.92, pants);
    ink(p[`heel${side}`], p[`foot${side}`], m.limbWidth * 0.82, shoe);
    ink(
      { x: p[`heel${side}`].x, y: p[`heel${side}`].y + m.limbWidth * 0.24 },
      { x: p[`foot${side}`].x, y: p[`foot${side}`].y + m.limbWidth * 0.24 },
      m.limbWidth * 0.2,
      shade(shoe, -0.55),
      far ? 0.5 : 1,
    );
  };

  drawArm("L", true);
  drawLeg("L", true);

  const up = unit(p.pelvis, p.chest);
  const side = { x: -up.y, y: up.x };

  if (gear.has("messengerbag")) {
    const center = {
      x: p.pelvis.x - side.x * m.torsoWidth * 0.52 - up.x * m.height * 0.055,
      y: p.pelvis.y - side.y * m.torsoWidth * 0.52 - up.y * m.height * 0.055,
    };
    const bagBottom = Math.abs(side.y) * m.torsoWidth * 0.29
      + Math.abs(up.y) * m.torsoLength * 0.29;
    center.y = Math.min(center.y, -bagBottom);
    shape(
      orientedBox(center, side, up, m.torsoWidth * 0.58, m.torsoLength * 0.58, m.torsoWidth * 0.1),
      palette.bag,
    );
    shape(
      orientedBox(
        { x: center.x + up.x * m.torsoLength * 0.11, y: center.y + up.y * m.torsoLength * 0.11 },
        side, up, m.torsoWidth * 0.48, m.torsoLength * 0.16, m.torsoWidth * 0.06,
      ),
      palette.bagDark,
    );
    dot(
      { x: center.x + side.x * m.torsoWidth * 0.12, y: center.y + side.y * m.torsoWidth * 0.12 },
      m.torsoWidth * 0.05,
      palette.accent,
    );
  }

  const torsoBottom = {
    x: p.pelvis.x + up.x * m.torsoWidth * 0.5,
    y: p.pelvis.y + up.y * m.torsoWidth * 0.5,
  };
  ink(torsoBottom, p.chest, m.torsoWidth, palette.shirt);

  drawLeg("R", false);

  const pelvisCenter = {
    x: p.pelvis.x + up.x * m.height * 0.02,
    y: p.pelvis.y + up.y * m.height * 0.02,
  };
  if (kind === "plain") {
    const collar = {
      x: p.neck.x - up.x * m.torsoLength * 0.09,
      y: p.neck.y - up.y * m.torsoLength * 0.09,
    };
    ink(
      { x: collar.x - side.x * m.torsoWidth * 0.25, y: collar.y - side.y * m.torsoWidth * 0.25 },
      { x: collar.x + side.x * m.torsoWidth * 0.25, y: collar.y + side.y * m.torsoWidth * 0.25 },
      m.torsoWidth * 0.1,
      palette.accent,
    );
  }
  shape(
    orientedBox(
      pelvisCenter,
      side,
      up,
      m.torsoWidth * 1.0,
      m.height * 0.115,
      m.torsoWidth * 0.18,
    ),
    palette.pants,
  );
  if (kind === "overalls") {
    const center = {
      x: p.pelvis.x + up.x * m.torsoLength * 0.44,
      y: p.pelvis.y + up.y * m.torsoLength * 0.44,
    };
    shape(
      orientedBox(center, side, up, m.torsoWidth * 0.64, m.torsoLength * 0.66, m.torsoWidth * 0.08),
      palette.pants,
    );
    for (const sign of [-1, 1]) {
      const top = {
        x: p.shoulderCenter.x + side.x * m.torsoWidth * 0.24 * sign + up.x * m.torsoLength * 0.12,
        y: p.shoulderCenter.y + side.y * m.torsoWidth * 0.24 * sign + up.y * m.torsoLength * 0.12,
      };
      const bottom = {
        x: center.x + side.x * m.torsoWidth * 0.2 * sign + up.x * m.torsoLength * 0.3,
        y: center.y + side.y * m.torsoWidth * 0.2 * sign + up.y * m.torsoLength * 0.3,
      };
      ink(top, bottom, m.torsoWidth * 0.11, palette.pants);
    }
    dot(
      { x: center.x + side.x * m.torsoWidth * 0.16 + up.x * m.torsoLength * 0.2, y: center.y + side.y * m.torsoWidth * 0.16 + up.y * m.torsoLength * 0.2 },
      m.torsoWidth * 0.055,
      palette.accent,
    );
  }

  if (kind === "hoodie") {
    const pocket = {
      x: p.pelvis.x + up.x * m.torsoLength * 0.3,
      y: p.pelvis.y + up.y * m.torsoLength * 0.3,
    };
    ink(
      { x: pocket.x - side.x * m.torsoWidth * 0.33, y: pocket.y - side.y * m.torsoWidth * 0.33 },
      { x: pocket.x + side.x * m.torsoWidth * 0.36, y: pocket.y + side.y * m.torsoWidth * 0.36 },
      m.torsoWidth * 0.1,
      palette.shirtDark,
    );
    const collarA = {
      x: p.neck.x - side.x * m.torsoWidth * 0.34,
      y: p.neck.y - side.y * m.torsoWidth * 0.34,
    };
    const collarB = {
      x: p.neck.x + side.x * m.torsoWidth * 0.3 + up.x * m.torsoLength * 0.03,
      y: p.neck.y + side.y * m.torsoWidth * 0.3 + up.y * m.torsoLength * 0.03,
    };
    ink(collarA, collarB, m.torsoWidth * 0.16, palette.shirtDark);
    const start = {
      x: p.neck.x + side.x * m.torsoWidth * 0.16,
      y: p.neck.y + side.y * m.torsoWidth * 0.16,
    };
    const end = {
      x: start.x - up.x * m.torsoLength * 0.34 + side.x * m.torsoWidth * 0.03,
      y: start.y - up.y * m.torsoLength * 0.34 + side.y * m.torsoWidth * 0.03,
    };
    ink(start, end, m.limbWidth * 0.16, palette.accent, 0.9);
    dot(end, m.limbWidth * 0.16, palette.accentDark);
  }

  if (gear.has("messengerbag")) {
    const shoulder = {
      x: p.shoulderCenter.x + side.x * m.torsoWidth * 0.08 - up.x * m.torsoLength * 0.02,
      y: p.shoulderCenter.y + side.y * m.torsoWidth * 0.08 - up.y * m.torsoLength * 0.02,
    };
    const hip = {
      x: p.pelvis.x - side.x * m.torsoWidth * 0.34 - up.x * m.height * 0.02,
      y: p.pelvis.y - side.y * m.torsoWidth * 0.34 - up.y * m.height * 0.02,
    };
    ink(shoulder, hip, m.torsoWidth * 0.12, palette.accentDark);
  }

  if (gear.has("toolbelt")) {
    const beltCenter = {
      x: p.pelvis.x - up.x * m.height * 0.015,
      y: p.pelvis.y - up.y * m.height * 0.015,
    };
    ink(
      { x: beltCenter.x - side.x * m.torsoWidth * 0.54, y: beltCenter.y - side.y * m.torsoWidth * 0.54 },
      { x: beltCenter.x + side.x * m.torsoWidth * 0.54, y: beltCenter.y + side.y * m.torsoWidth * 0.54 },
      m.torsoWidth * 0.18,
      palette.belt,
    );
    dot(
      { x: beltCenter.x + side.x * m.torsoWidth * 0.1, y: beltCenter.y + side.y * m.torsoWidth * 0.1 },
      m.torsoWidth * 0.05,
      palette.accent,
    );
    const pouch = {
      x: beltCenter.x + side.x * m.torsoWidth * 0.34 - up.x * m.height * 0.045,
      y: beltCenter.y + side.y * m.torsoWidth * 0.34 - up.y * m.height * 0.045,
    };
    shape(
      orientedBox(pouch, side, up, m.torsoWidth * 0.2, m.height * 0.062, m.torsoWidth * 0.04),
      shade(palette.belt, 0.14),
    );
    dot(
      { x: pouch.x + side.x * m.torsoWidth * 0.04, y: pouch.y + side.y * m.torsoWidth * 0.04 },
      m.torsoWidth * 0.035,
      palette.accent,
    );
  }

  ink(p.chest, p.neck, m.limbWidth * 0.72, palette.skin);

  if (headSpec.hood) {
    dot(p.head, R * 1.2, palette.hood);
    dot(offsetPoint(p.head, 0, R * 0.045, tilt), R * 1.02, shade(palette.hood, -0.24));
  }

  if (["short", "messy", "bun", "swept", "bob", "topknot", "fringe", "crop", "curls", "ponytail", "wave"].includes(headSpec.hair)) {
    if (headSpec.hair === "ponytail") {
      const tail = [[-0.87, -0.63], [-1.4, -0.55], [-1.55, 0.12], [-1.26, 0.72], [-1.01, 0.4], [-1.06, -0.13]];
      shape(polyPath(tail.map(([x, y]) => offsetPoint(p.head, R * x, R * y, tilt))), palette.hair);
      dot(offsetPoint(p.head, -R * 1.02, -R * 0.41, tilt), R * 0.14, palette.accent);
    }
    if (headSpec.hair === "bob") {
      shape(
        polyPath([[-0.94, -0.6], [-1.08, 0.62], [-0.46, 0.8], [0.58, 0.38], [0.72, -0.65]]
          .map(([x, y]) => offsetPoint(p.head, R * x, R * y, tilt))),
        palette.hair,
      );
    }
    dot(offsetPoint(p.head, -R * 0.08, -R * 0.13, tilt), R * 1.03, palette.hair);
    if (headSpec.hair === "curls") {
      for (const [hx, hy, hr] of [[-0.98, -0.28, 0.31], [-0.94, -0.73, 0.34], [-0.55, -1.04, 0.36], [-0.08, -1.13, 0.35], [0.39, -0.99, 0.32], [0.7, -0.69, 0.27]]) {
        dot(offsetPoint(p.head, R * hx, R * hy, tilt), R * hr, palette.hair);
      }
    }
    if (headSpec.hair === "wave") {
      const lock = [[-0.8, -0.74], [-0.54, -1.26], [0.12, -1.32], [0.7, -0.93], [0.3, -0.72]];
      shape(polyPath(lock.map(([x, y]) => offsetPoint(p.head, R * x, R * y, tilt))), palette.hair);
    }
    if (headSpec.hair === "messy") {
      for (const [hx, hy, hr] of [[-0.48, -0.96, 0.22], [-0.02, -1.1, 0.24], [0.36, -0.96, 0.18]]) {
        dot(offsetPoint(p.head, R * hx, R * hy, tilt), R * hr, palette.hair);
      }
    }
    if (headSpec.hair === "bun") {
      const bun = offsetPoint(p.head, -R * 0.82, -R * 0.55, tilt);
      dot(bun, R * 0.44, palette.hair);
      dot(offsetPoint(bun, R * 0.1, -R * 0.1, tilt), R * 0.16, palette.hairShade);
    }
    if (headSpec.hair === "topknot") {
      const bun = offsetPoint(p.head, -R * 0.28, -R * 1.05, tilt);
      dot(bun, R * 0.35, palette.hair);
      ink(
        offsetPoint(bun, -R * 0.18, R * 0.2, tilt),
        offsetPoint(bun, R * 0.23, R * 0.2, tilt),
        R * 0.1,
        palette.accent,
      );
    }
  }

  const faceCenter = offsetPoint(p.head, R * 0.06, R * 0.04, tilt);
  dot(faceCenter, R * 0.95, palette.skin);

  // Front locks sit above the face; every point follows the head's tilt.
  if (["short", "messy", "swept", "bob", "topknot", "fringe", "crop", "curls", "ponytail", "wave"].includes(headSpec.hair)) {
    const hairlines = {
      short: [[-0.88, -0.38], [-0.72, -0.92], [0.22, -1], [0.67, -0.65], [0.1, -0.61], [-0.55, -0.57], [-0.7, 0.06]],
      messy: [[-0.9, -0.3], [-0.7, -0.96], [0.24, -1.05], [0.8, -0.68], [0.38, -0.43], [0.04, -0.65], [-0.3, -0.38], [-0.7, -0.48]],
      swept: [[-0.94, -0.24], [-0.87, -0.9], [0.18, -1.17], [0.86, -0.82], [0.53, -0.55], [-0.2, -0.59], [-0.72, -0.12]],
      bob: [[-1, 0.31], [-0.91, -0.83], [-0.18, -1], [0.67, -0.74], [0.74, -0.4], [0.18, -0.52], [-0.55, -0.53], [-0.66, 0.45]],
      topknot: [[-0.92, -0.2], [-0.78, -0.9], [0.15, -1], [0.65, -0.68], [-0.12, -0.68], [-0.64, -0.48], [-0.73, 0.12]],
      fringe: [[-0.93, -0.2], [-0.75, -0.92], [0.12, -1.1], [0.79, -0.75], [0.55, -0.27], [0.16, -0.5], [-0.03, -0.22], [-0.43, -0.54], [-0.7, -0.3]],
      crop: [[-0.9, -0.3], [-0.7, -0.86], [0.15, -0.96], [0.64, -0.66], [0.18, -0.7], [-0.55, -0.65], [-0.77, -0.15]],
      curls: [[-1, -0.12], [-0.94, -0.83], [-0.35, -1.04], [0.42, -0.92], [0.76, -0.63], [0.52, -0.44], [0.26, -0.57], [0.02, -0.43], [-0.3, -0.59], [-0.66, -0.4], [-0.75, 0.08]],
      ponytail: [[-0.94, -0.2], [-0.79, -0.9], [0.15, -1], [0.67, -0.65], [0.15, -0.62], [-0.56, -0.55], [-0.72, 0.1]],
      wave: [[-0.94, -0.2], [-0.78, -0.97], [-0.19, -1.16], [0.65, -0.92], [0.76, -0.63], [0.32, -0.46], [-0.1, -0.68], [-0.62, -0.5], [-0.74, 0.03]],
    };
    shape(
      polyPath(hairlines[headSpec.hair].map(([x, y]) => offsetPoint(p.head, R * x, R * y, tilt))),
      palette.hair,
    );
  }

  if (headSpec.beard) {
    const local = (x, y) => {
      const point = offsetPoint(p.head, R * x, R * y, tilt);
      return `${n(point.x)} ${n(point.y)}`;
    };
    // The lower edge is the face's own circle, not a separate polygonal jaw.
    const edgeX = 0.06 + 0.95 * Math.cos(0.18);
    const edgeY = 0.04 + 0.95 * Math.sin(0.18);
    shape(
      `M${local(-0.89, 0.04)}`
      + `Q${local(-0.73, 0.02)} ${local(-0.64, 0.23)}`
      + `Q${local(-0.32, 0.48)} ${local(0.15, 0.25)}`
      + `Q${local(0.53, 0.19)} ${local(edgeX, edgeY)}`
      + `A${n(R * 0.95)} ${n(R * 0.95)} 0 0 1 ${local(-0.89, 0.04)}Z`,
      palette.hair,
    );
  }

  if (!headSpec.hood) {
    dot(offsetPoint(p.head, -R * 0.84, R * 0.0, tilt), R * 0.14, palette.skinShade);
  }

  dot(offsetPoint(p.head, R * 0.9, R * 0.04, tilt), R * 0.09, palette.skin);

  const blinking = ((time + (skin.blinkOffset ?? 0)) % 4.4) > 4.24;
  if (blinking) {
    ink(
      offsetPoint(p.head, R * 0.34, -R * 0.04, tilt),
      offsetPoint(p.head, R * 0.56, -R * 0.04, tilt),
      R * 0.075,
      palette.eye,
    );
  } else {
    dot(offsetPoint(p.head, R * 0.46, -R * 0.04, tilt), R * 0.115, palette.eye);
    dot(offsetPoint(p.head, R * 0.51, -R * 0.09, tilt), R * 0.032, 0xf7f2e8);
  }

  const brow = headSpec.brow ?? "straight";
  ink(
    offsetPoint(p.head, R * 0.24, -R * 0.33, tilt),
    offsetPoint(p.head, R * 0.57, brow === "up" ? -R * 0.38 : brow === "stern" ? -R * 0.23 : -R * 0.32, tilt),
    R * 0.075,
    palette.hairShade,
  );

  const mouth = headSpec.mouth ?? "neutral";
  const mouthColor = headSpec.beard ? palette.skin : palette.eye;
  if (mouth === "smile") {
    curve(
      offsetPoint(p.head, R * 0.34, R * 0.28, tilt),
      offsetPoint(p.head, R * 0.48, R * 0.37, tilt),
      offsetPoint(p.head, R * 0.62, R * 0.28, tilt),
      R * 0.052,
      mouthColor,
    );
  } else if (mouth === "smirk") {
    ink(offsetPoint(p.head, R * 0.36, R * 0.33, tilt), offsetPoint(p.head, R * 0.54, R * 0.32, tilt), R * 0.05, mouthColor);
    ink(offsetPoint(p.head, R * 0.54, R * 0.32, tilt), offsetPoint(p.head, R * 0.62, R * 0.26, tilt), R * 0.045, mouthColor);
  } else {
    curve(
      offsetPoint(p.head, R * 0.36, R * 0.33, tilt),
      offsetPoint(p.head, R * 0.48, R * 0.36, tilt),
      offsetPoint(p.head, R * 0.6, R * 0.33, tilt),
      R * 0.05,
      mouthColor,
    );
  }

  if (headSpec.freckles) {
    for (const [fx, fy] of [[0.34, 0.14], [0.44, 0.18], [0.37, 0.23]]) {
      dot(offsetPoint(p.head, R * fx, R * fy, tilt), R * 0.026, palette.skinShade);
    }
  }

  if (headSpec.glasses) {
    ink(
      offsetPoint(p.head, -R * 0.79, -R * 0.15, tilt),
      offsetPoint(p.head, R * 0.2, -R * 0.08, tilt),
      R * 0.065,
      palette.accentDark,
    );
    commands.push({
      d: circlePath(offsetPoint(p.head, R * 0.46, -R * 0.04, tilt), R * 0.26),
      stroke: palette.accentDark,
      width: R * 0.065,
    });
    ink(
      offsetPoint(p.head, R * 0.72, -R * 0.04, tilt),
      offsetPoint(p.head, R * 0.91, R * 0.01, tilt),
      R * 0.065,
      palette.accentDark,
    );
  }

  if (headSpec.goggles) {
    ink(
      offsetPoint(p.head, -R * 0.98, -R * 0.58, tilt),
      offsetPoint(p.head, R * 0.7, -R * 0.62, tilt),
      R * 0.13,
      palette.belt,
    );
    for (const [gx, gy, gr] of [[0.18, -0.58, 0.23], [0.6, -0.55, 0.2]]) {
      const lens = offsetPoint(p.head, R * gx, R * gy, tilt);
      dot(lens, R * gr, 0x2b2318);
      dot(lens, R * (gr - 0.06), palette.accent);
      dot(offsetPoint(lens, -R * 0.04, -R * 0.04, tilt), R * 0.05, 0xfff4d8, 0.85);
    }
  }

  if (headSpec.headphones) {
    const band = palette.accentDark;
    curve3(
      offsetPoint(p.head, -R * 1.04, R * 0.02, tilt),
      offsetPoint(p.head, -R * 1.15, -R * 1.35, tilt),
      offsetPoint(p.head, R * 0.95, -R * 1.35, tilt),
      offsetPoint(p.head, R * 1.02, -R * 0.56, tilt),
      R * 0.1,
      band,
    );
    const cup = offsetPoint(p.head, -R * 1.04, R * 0.04, tilt);
    dot(cup, R * 0.24, band);
    dot(cup, R * 0.12, palette.accent);
    dot(cup, R * 0.05, 0x102028);
  }

  drawArm("R", false);

  if (debug) {
    for (const bone of solved.bones) {
      ink(bone.a, bone.b, 1.15, 0x6ff0ff, 0.8);
    }
    for (const point of Object.values(p)) {
      dot(point, 1.8, 0x6ff0ff, 0.9);
    }
    ink({ x: -m.height * 0.42, y: 0 }, { x: m.height * 0.42, y: 0 }, 1, 0xffb36d, 0.45);
  }

  return commands;
}

function pathElement() {
  const element = document.createElementNS(NS, "path");
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");
  return element;
}

export class StickmanFigure {
  constructor(skin) {
    this.skin = skin;
    this.svg = document.createElementNS(NS, "svg");
    this.svg.setAttribute("viewBox", STAGE_VIEWBOX);
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("shape-rendering", "geometricPrecision");
    this.svg.setAttribute("aria-label", `${skin.name}, ${skin.role}`);
    this.group = document.createElementNS(NS, "g");
    this.svg.append(this.group);
    this.pool = [];
  }

  update(pose, time, { facing = 1, debug = false } = {}) {
    const solved = solveSkeleton(skeletonFor(this.skin), pose);
    const commands = drawCommands(this.skin, solved, time, { debug });
    this.group.setAttribute("transform", facing === -1 ? "scale(-1 1)" : "");

    for (let i = 0; i < commands.length; i++) {
      let element = this.pool[i];
      if (!element) {
        element = pathElement();
        this.pool.push(element);
        this.group.append(element);
      }
      const command = commands[i];
      element.setAttribute("d", command.d);
      element.setAttribute("fill", command.fill === undefined ? "none" : colorToCss(command.fill));
      element.setAttribute("stroke", command.stroke === undefined ? "none" : colorToCss(command.stroke));
      element.setAttribute("stroke-width", command.width ?? 0);
      element.setAttribute("opacity", command.alpha ?? 1);
      element.style.display = "";
    }

    for (let i = commands.length; i < this.pool.length; i++) {
      this.pool[i].style.display = "none";
    }

    return solved;
  }
}

export function createFigure(skin) {
  return new StickmanFigure(skin);
}
