import assert from "node:assert/strict";
import { clips } from "./animations.js";
import { skins } from "./skins.js";
import { buildSkeleton, resolvePose, solveSkeleton } from "./rig.js";
import { StickmanAnimator } from "./animator.js";

let samples = 0;
for (const skin of skins) {
  const metrics = buildSkeleton(skin);
  for (const [id, clip] of Object.entries(clips)) {
    let previous;
    let first;
    const frames = Math.ceil(clip.duration * 120);
    for (let frame = 0; frame <= frames; frame++) {
      const pose = resolvePose(clip.pose(frame / frames, metrics), metrics);
      const { points } = solveSkeleton(metrics, pose);
      first ??= points;
      for (const [joint, point] of Object.entries(points)) {
        const context = `${skin.id}/${id}/${joint} frame ${frame}`;
        assert(Number.isFinite(point.x) && Number.isFinite(point.y), context);
        if (previous) {
          assert(Math.hypot(point.x - previous[joint].x, point.y - previous[joint].y)
            < metrics.height * 0.1, `Discontinuity: ${context}`);
        }
        if (clip.group === "Emotions" && joint.startsWith("hand")) {
          assert(point.y + metrics.handRadius <= 1, `Hand below floor: ${context}`);
        }
        if (clip.group === "Emotions" && clip.loop && frame === frames) {
          assert(Math.hypot(point.x - first[joint].x, point.y - first[joint].y)
            < 0.01, `Loop seam: ${context}`);
        }
      }
      previous = points;
      samples++;
    }
  }
}
console.log(`OK: ${Object.keys(clips).length} clips × ${skins.length} skins, ${samples} poses`);

let transitions = 0;
for (const skin of skins) {
  const metrics = buildSkeleton(skin);
  for (const source of ["idle", "sit", "lie", "kneel", "fall"]) {
    for (const target of Object.keys(clips)) {
      const animator = new StickmanAnimator(metrics, source);
      if (source === "fall") animator.seek(clips.fall.duration);
      const start = structuredClone(animator.pose);
      animator.play(target);
      assert.deepEqual(animator.pose, start, "play must not teleport");
      const waypoints = animator.steps.map((step) => step.posture);
      if (source === "lie" && target === "walk") {
        assert.deepEqual(waypoints, ["sit", "kneel", "stand"]);
      }
      let previous = solveSkeleton(metrics, animator.pose).points;
      while (animator.transitioning) {
        assert.equal(animator.time, 0, "target clip must wait for transition");
        animator.update(1 / 120);
        const { points } = solveSkeleton(metrics, animator.pose);
        for (const [name, point] of Object.entries(points)) {
          assert(Number.isFinite(point.x) && Number.isFinite(point.y));
          assert(Math.hypot(point.x - previous[name].x, point.y - previous[name].y)
            < metrics.height * 0.08, `${skin.id}: snap ${source} → ${target} (${name})`);
          if (["handL", "handR", "elbowL", "elbowR", "kneeL", "kneeR"].includes(name)) {
            const radius = name.startsWith("hand") ? metrics.handRadius : metrics.limbWidth * 0.5;
            assert(point.y + radius < 2, `${skin.id}: below ground ${source} → ${target} (${name})`);
          }
        }
        previous = points;
      }
      assert.equal(animator.clipId, target);
      transitions++;
    }
  }
  const interrupted = new StickmanAnimator(metrics, "lie");
  interrupted.play("walk");
  for (const id of ["sit", "lie", "kneel", "run", "idle"]) {
    interrupted.update(0.17);
    const pose = structuredClone(interrupted.pose);
    interrupted.play(id);
    assert.deepEqual(interrupted.pose, pose, "interruption must preserve displayed pose");
  }
  interrupted.update(10);
  assert(!interrupted.transitioning);
  assert.equal(interrupted.clipId, "idle");
}
console.log(`OK: ${transitions} transitions + interrupted sequences`);
