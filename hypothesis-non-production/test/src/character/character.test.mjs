import test from "node:test";
import assert from "node:assert/strict";

import {
  CharacterActor, CharacterAnimator, buildSkeleton, characters, clipList, clips,
  defaultPose, getCharacter, resolvePalette, resolvePose, solveSkeleton,
} from "./index.js";

const ids = characters.map((character) => character.id);

test("the cast has unique ids and resolved palettes", () => {
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, ids.length);
  for (const character of characters) {
    const palette = resolvePalette(character);
    assert.ok(palette.suit > 0);
    assert.ok(palette.accent > 0);
    assert.notEqual(palette.suit, palette.accent);
  }
  assert.equal(getCharacter("roxy").role, "Старший инженер");
  assert.throws(() => getCharacter("nobody"), /Unknown character/);
});

test("skeletons vary by skin but stay physically sane", () => {
  for (const character of characters) {
    const skeleton = buildSkeleton(character);
    assert.ok(skeleton.height > 100);
    assert.ok(skeleton.legLength > 0);
    assert.ok(skeleton.torsoLength > 0);
    assert.ok(skeleton.headRadius > 0);
    assert.ok(skeleton.armLength > 0);
    assert.equal(skeleton.upperLeg + skeleton.lowerLeg, skeleton.legLength);
  }
  const tall = buildSkeleton(getCharacter("warden"));
  const small = buildSkeleton(getCharacter("milo"));
  const stocky = buildSkeleton(getCharacter("roxy"));
  assert.ok(tall.height > small.height);
  assert.ok(stocky.torsoWidth > small.torsoWidth * 0.9);
});

test("the default stance solves with both feet on the floor", () => {
  for (const character of characters) {
    const skeleton = buildSkeleton(character);
    const pose = resolvePose({}, skeleton);
    const solved = solveSkeleton(skeleton, pose);
    const { points } = solved;
    assert.ok(points.head.y < points.pelvis.y);
    assert.ok(points.head.y < points.chest.y);
    assert.ok(Math.abs(points.ankleL.y + skeleton.ankleHeight) < 2.5);
    assert.ok(Math.abs(points.ankleR.y + skeleton.ankleHeight) < 2.5);
    assert.ok(points.kneeL.x > points.hipL.x, "knees bend forward");
    for (const point of Object.values(points)) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    }
  }
});

test("every clip retargets to every character without NaNs", () => {
  for (const { id } of clipList) {
    assert.ok(clips[id], `missing clip ${id}`);
    for (const character of characters) {
      const skeleton = buildSkeleton(character);
      for (const t of [0, 0.2, 0.45, 0.7, 1]) {
        const pose = resolvePose(clips[id].pose(t, skeleton), skeleton);
        const solved = solveSkeleton(skeleton, pose);
        for (const point of Object.values(solved.points)) {
          assert.ok(Number.isFinite(point.x), `${id}/${character.id} produced NaN x`);
          assert.ok(Number.isFinite(point.y), `${id}/${character.id} produced NaN y`);
        }
        for (const bone of solved.bones) {
          const length = Math.hypot(bone.b.x - bone.a.x, bone.b.y - bone.a.y);
          assert.ok(Number.isFinite(length));
        }
      }
    }
  }
});

test("walk plants a foot and run leans harder", () => {
  const skeleton = buildSkeleton(getCharacter("vale"));
  const walkContact = resolvePose(clips.walk.pose(0, skeleton), skeleton);
  assert.ok(walkContact.footL.y <= 0.01, "contact foot stays on the ground");
  const run = resolvePose(clips.run.pose(0.2, skeleton), skeleton);
  assert.ok(run.torso > 0.2, "running torso leans forward");
  const walk = resolvePose(clips.walk.pose(0.2, skeleton), skeleton);
  assert.ok(run.torso > walk.torso);
});

test("jump leaves the ground and fall ends horizontal", () => {
  const skeleton = buildSkeleton(getCharacter("milo"));
  const jump = resolvePose(clips.jump.pose(0.5, skeleton), skeleton);
  assert.ok(jump.lift > skeleton.height * 0.25);
  const fall = resolvePose(clips.fall.pose(1, skeleton), skeleton);
  assert.ok(fall.lean < -1.3);
  const solved = solveSkeleton(skeleton, fall);
  assert.ok(solved.points.head.y > -skeleton.height * 0.35, "fallen head is near the floor");
});

test("animator crossfades and clamps one-shot clips", () => {
  const skeleton = buildSkeleton(getCharacter("kit"));
  const animator = new CharacterAnimator(skeleton, "idle");
  animator.play("wave", { fade: 0.2 });
  assert.equal(animator.current, "wave");
  const start = animator.pose();
  assert.ok(Number.isFinite(start.armR.shoulder));
  animator.update(0.1);
  assert.equal(animator.fade > 0, true);
  animator.update(0.2);
  assert.equal(animator.previousPose, null);
  animator.play("fall", { fade: 0 });
  for (let i = 0; i < 60; i++) animator.update(0.1);
  assert.equal(animator.ended, true);
  assert.equal(animator.time, clips.fall.duration);
  assert.ok(animator.pose().lean < -1.3);
});

test("actor flips scale and facing without touching the skeleton", () => {
  const actor = new CharacterActor(getCharacter("or7"), { clip: "walk", facing: -1, scale: 0.8 });
  actor.update(0.16);
  assert.equal(actor.animator.current, "walk");
  assert.equal(actor.facing, -1);
  assert.equal(actor.scale, 0.8);
  assert.ok(actor.pose.footR.x !== actor.pose.footL.x);
});

test("defaultPose is a fresh object every call", () => {
  const skeleton = buildSkeleton(characters[0]);
  const a = defaultPose(skeleton);
  const b = defaultPose(skeleton);
  a.footL.x = 999;
  assert.notEqual(b.footL.x, 999);
});
