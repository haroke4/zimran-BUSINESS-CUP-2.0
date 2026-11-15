import { buildSkeleton, blendPose, resolvePose, smoothstep } from "./rig.js";
import { clips } from "./clips.js";
import { drawCharacter } from "./render.js";

export class CharacterAnimator {
  constructor(skeleton, initialClip = "idle") {
    if (!clips[initialClip]) throw new Error(`Unknown clip: ${initialClip}`);
    this.skeleton = skeleton;
    this.current = initialClip;
    this.time = 0;
    this.speed = 1;
    this.previousPose = null;
    this.fade = 0;
    this.fadeDuration = 0;
    this.ended = false;
  }

  get clip() {
    return clips[this.current];
  }

  play(id, { fade = 0.24, restart = false } = {}) {
    if (!clips[id]) throw new Error(`Unknown clip: ${id}`);
    if (id === this.current && !restart) return;
    this.previousPose = this.pose();
    this.fade = 0;
    this.fadeDuration = Math.max(0, fade);
    this.current = id;
    this.time = 0;
    this.ended = false;
  }

  update(dt) {
    const delta = Math.max(0, Math.min(dt, 0.1)) * this.speed;
    const clip = this.clip;
    this.time += delta;
    if (clip.loop) {
      this.time %= clip.duration;
    } else if (this.time >= clip.duration) {
      this.time = clip.duration;
      this.ended = true;
    }
    if (this.fade < this.fadeDuration) {
      this.fade = Math.min(this.fadeDuration, this.fade + delta);
      if (this.fade >= this.fadeDuration) this.previousPose = null;
    }
  }

  pose() {
    const clip = this.clip;
    const t = clip.loop
      ? (this.time % clip.duration) / clip.duration
      : Math.min(this.time, clip.duration) / clip.duration;
    let pose = resolvePose(clip.pose(t, this.skeleton), this.skeleton);
    if (this.previousPose && this.fade < this.fadeDuration) {
      const weight = smoothstep(this.fade / this.fadeDuration);
      pose = blendPose(this.previousPose, pose, weight);
    }
    return pose;
  }
}

export class CharacterActor {
  constructor(skin, { clip = "idle", speed = 1, facing = 1, scale = 1 } = {}) {
    this.skin = skin;
    this.skeleton = buildSkeleton(skin);
    this.animator = new CharacterAnimator(this.skeleton, clip);
    this.animator.speed = speed;
    this.facing = facing;
    this.scale = scale;
  }

  play(id, options) {
    this.animator.play(id, options);
  }

  update(dt) {
    this.animator.update(dt);
  }

  get pose() {
    return this.animator.pose();
  }

  draw(g, { x, y, alpha = 1, debug = false, time = 0 } = {}) {
    return drawCharacter(g, this.skin, this.pose, {
      x,
      y,
      facing: this.facing,
      scale: this.scale,
      alpha,
      debug,
      time,
    });
  }
}
