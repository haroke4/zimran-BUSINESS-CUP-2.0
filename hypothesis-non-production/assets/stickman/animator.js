import { clips } from "./animations.js?v=16";
import { blendPose, resolvePose, smoothstep } from "./rig.js?v=12";

// Adjacent levels only: lying → sitting → kneeling → standing.
const levels = ["lie", "sit", "kneel", "stand"];
const bridgeClip = { lie: "lie", sit: "sit", kneel: "kneel", stand: "idle" };

export class StickmanAnimator {
  constructor(metrics, clipId = "idle") {
    this.metrics = metrics;
    this.clipId = clipId;
    this.time = 0;
    this.steps = [];
    this.elapsed = 0;
    this.ended = false;
    this.current = this.sample(clipId, 0);
  }

  sample(id, time) {
    const clip = clips[id];
    return resolvePose(clip.pose(Math.min(1, time / clip.duration), this.metrics), this.metrics);
  }

  get pose() {
    return this.current;
  }

  get transitioning() {
    return this.steps.length > 0;
  }

  play(id) {
    if (!clips[id]) throw new Error(`Unknown clip: ${id}`);
    const pending = this.steps[0];
    const pendingDuration = pending ? Math.max(0.15, pending.duration - this.elapsed) : 0;
    const source = this.steps.length
      ? this.steps[0].posture
      : clips[this.clipId].posture
        ?? (this.time >= clips[this.clipId].duration * 0.5
          ? clips[this.clipId].endPosture : null) ?? "stand";
    const target = clips[id].posture ?? "stand";
    const from = levels.indexOf(source);
    const to = levels.indexOf(target);
    const direction = Math.sign(to - from);
    this.steps = [];
    // Finish the current support pose before rerouting a mid-transition request.
    if (pending) this.steps.push({ ...pending, duration: pendingDuration });
    else if (clips[this.clipId].endPosture && source !== "stand") {
      this.steps.push({ pose: this.sample(bridgeClip[source], 0), posture: source, duration: 0.55 });
    }
    for (let level = from + direction; direction && level !== to; level += direction) {
      const posture = levels[level];
      this.steps.push({
        pose: this.sample(bridgeClip[posture], 0),
        posture,
        duration: posture === "sit" ? 0.65 : 0.55,
      });
    }
    this.steps.push({
      pose: this.sample(id, 0),
      posture: target,
      duration: source === target ? 0.2 : target === "lie" || source === "lie" ? 0.8 : 0.6,
    });
    this.origin = this.current;
    this.elapsed = 0;
    this.clipId = id;
    this.time = 0;
    this.ended = false;
  }

  seek(time) {
    this.steps = [];
    const clip = clips[this.clipId];
    this.time = Math.max(0, Math.min(clip.duration, time));
    this.ended = !clip.loop && this.time >= clip.duration;
    this.current = this.sample(this.clipId, this.time);
  }

  update(dt) {
    let remaining = Math.max(0, dt);
    while (this.steps.length) {
      const step = this.steps[0];
      const consumed = Math.min(remaining, step.duration - this.elapsed);
      this.elapsed += consumed;
      remaining -= consumed;
      this.current = blendPose(this.origin, step.pose, smoothstep(this.elapsed / step.duration));
      if (this.elapsed < step.duration) return;
      this.origin = step.pose;
      this.steps.shift();
      this.elapsed = 0;
    }
    const clip = clips[this.clipId];
    this.time += remaining;
    if (clip.loop) this.time %= clip.duration;
    else this.time = Math.min(this.time, clip.duration);
    this.ended = !clip.loop && this.time >= clip.duration;
    this.current = this.sample(this.clipId, this.time);
  }
}
