import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { skins } from "./skins.js";
import { clips, clipGroups } from "./animations.js";
import { resolvePose, solveSkeleton } from "./rig.js";
import { drawCommands, resolvePalette, skeletonFor } from "./render.js";

assert.equal(skins.length, 20);
assert.equal(new Set(skins.map((skin) => skin.id)).size, skins.length);
assert.equal(new Set(skins.map((skin) => skin.name)).size, skins.length);

for (const file of ["index.html", "skins.js", "animations.js", "README.md"]) {
  assert(!/\p{Script=Cyrillic}/u.test(readFileSync(new URL(file, import.meta.url), "utf8")),
    `${file}: viewer content must be in English`);
}
assert.deepEqual(clipGroups, ["Loops", "Actions", "Emotions", "Postures"]);
for (const clip of Object.values(clips)) {
  assert(clipGroups.includes(clip.group), `Unknown group: ${clip.group}`);
  assert(/[A-Za-z]/.test(clip.label), "Clip labels must be in English");
}

const supportedHair = new Set(["none", "short", "messy", "bun", "swept", "bob", "topknot", "fringe", "crop", "curls", "ponytail", "wave"]);
let drawings = 0;
for (const skin of skins) {
  assert(skin.casting.length >= 4, `${skin.id}: reusable casting`);
  assert(supportedHair.has(skin.head.hair), `${skin.id}: supported hair`);
  for (const color of Object.values(resolvePalette(skin))) {
    assert(Number.isInteger(color) && color >= 0 && color <= 0xffffff);
  }
  const metrics = skeletonFor(skin);
  for (const [id, clip] of Object.entries(clips)) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const solved = solveSkeleton(metrics, resolvePose(clip.pose(t, metrics), metrics));
      for (const time of [0, 4.3 - skin.blinkOffset]) {
        for (const command of drawCommands(skin, solved, time)) {
          assert(!/NaN|Infinity|undefined/.test(command.d), `${skin.id}/${id}: invalid SVG`);
          for (const field of ["fill", "stroke", "width", "alpha"]) {
            if (command[field] !== undefined) assert(Number.isFinite(command[field]));
          }
          if (command.width !== undefined) assert(command.width > 0);
        }
        drawings++;
      }
    }
  }
}
console.log(`OK: ${skins.length} unique cast members, ${drawings} SVG drawings including blinks`);

for (const skin of skins.filter((entry) => entry.head.beard)) {
  const metrics = skeletonFor(skin);
  for (const head of [-0.6, 0, 0.6]) {
    const solved = solveSkeleton(metrics, resolvePose({ head }, metrics));
    const beard = drawCommands(skin, solved, 0).find((command) => command.d.includes("A"));
    assert(beard, `${skin.id}: beard must have a rounded jaw`);
    const arc = beard.d.match(/A([\d.]+) ([\d.]+) 0 0 1 ([-\d.]+) ([-\d.]+)Z$/);
    assert(arc, `${skin.id}: beard must follow the face circle`);
    const radius = metrics.headRadius * 0.95;
    assert(Math.abs(Number(arc[1]) - radius) < 0.01);
    assert.equal(arc[1], arc[2]);
    const center = {
      x: solved.points.head.x + metrics.headRadius * (0.06 * Math.cos(solved.tilt) - 0.04 * Math.sin(solved.tilt)),
      y: solved.points.head.y + metrics.headRadius * (0.06 * Math.sin(solved.tilt) + 0.04 * Math.cos(solved.tilt)),
    };
    const curves = [...beard.d.matchAll(/Q([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)/g)];
    const lastCurve = curves.at(-1);
    for (const [x, y] of [[Number(lastCurve[3]), Number(lastCurve[4])], [Number(arc[3]), Number(arc[4])]]) {
      assert(Math.abs(Math.hypot(x - center.x, y - center.y) - radius) < 0.02,
        `${skin.id}: beard edge detached from face at head angle ${head}`);
    }
  }
}
console.log("OK: rounded beards stay on the face contour when the head tilts");
