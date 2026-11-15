import { fallbackSoundPlan, footfallsBetween, validateSoundPlan } from "./sound-plan.mjs";

// Native Web Audio adaptation of the supplied engine's filtered noise ambience
// and heel/body/sole footsteps. One shared noise buffer; no samples or runtime dependencies.
const surfaces = {
  concrete: [2200, 350, 0.09, 0.34], tile: [3500, 500, 0.08, 0.3],
  metal: [3000, 450, 0.08, 0.3], wood: [1800, 280, 0.1, 0.34],
  grass: [4000, 250, 0.12, 0.16], gravel: [5000, 400, 0.14, 0.24],
  carpet: [1200, 200, 0.09, 0.18], snow: [2800, 240, 0.16, 0.2],
};
const beds = {
  room: ["lowpass", 480, 0.035], industrial: ["lowpass", 250, 0.12],
  city: ["lowpass", 900, 0.1], forest: ["bandpass", 1200, 0.07],
  night: ["bandpass", 2600, 0.025], wind: ["bandpass", 500, 0.13],
  rain: ["highpass", 700, 0.13], water: ["lowpass", 1700, 0.17],
};

export class SceneSound {
  constructor() {
    this.volume = 0.65;
    this.muted = false;
    this.sources = new Set();
  }

  async unlock() {
    if (!this.context) {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) throw new Error("Браузер не поддерживает звук.");
      this.context = new Context();
      const c = this.context;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const limiter = c.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.ratio.value = 8;
      this.master.connect(limiter).connect(c.destination);
      this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    await this.context.resume();
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, Number(value) || 0));
    this.applyVolume();
  }

  setMuted(value) {
    this.muted = Boolean(value);
    this.applyVolume();
  }

  applyVolume() {
    if (this.context) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.015);
  }

  track(source, nodes) {
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      nodes.forEach(node => node.disconnect());
    };
    return source;
  }

  noiseVoice(at, duration, frequency, gain, { type = "lowpass", highpass = 0, loop = false, bus = this.bus } = {}) {
    const c = this.context;
    const source = c.createBufferSource();
    source.buffer = this.noise;
    source.loop = loop;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    const envelope = c.createGain();
    source.connect(filter);
    const nodes = [filter, envelope];
    if (highpass) {
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = highpass;
      filter.connect(hp).connect(envelope);
      nodes.push(hp);
    } else filter.connect(envelope);
    envelope.connect(bus);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(gain, at + (loop ? 0.3 : 0.008));
    if (!loop) envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    this.track(source, nodes);
    source.start(at, Math.random() * Math.max(0, this.noise.duration - duration - 0.05));
    if (!loop) source.stop(at + duration + 0.02);
    return filter;
  }

  tone(at, duration, frequency, gain, endFrequency = frequency, bus = this.bus) {
    const c = this.context;
    const source = c.createOscillator();
    source.frequency.setValueAtTime(frequency, at);
    source.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
    const envelope = c.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(gain, at + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(envelope).connect(bus);
    this.track(source, [envelope]);
    source.start(at);
    source.stop(at + duration + 0.02);
  }

  start(scene, offset, duration, interval = 0.46) {
    this.stop();
    if (!this.context || this.context.state !== "running") return;
    this.plan = scene.sound ?? fallbackSoundPlan(scene.visualBrief?.setting ?? scene.title);
    try { validateSoundPlan(this.plan); } catch { this.plan = fallbackSoundPlan(scene.title); }
    this.route = scene.staging.route;
    this.interval = interval;
    this.duration = duration;
    this.origin = this.context.currentTime - offset;
    this.until = offset;
    this.nextDetail = offset + 1;
    this.bus = this.context.createGain();
    this.bus.connect(this.master);
    this.playing = true;
    const at = this.context.currentTime;
    const [type, frequency, level] = beds[this.plan.ambience];
    const filter = this.noiseVoice(at, 0, frequency, level * this.plan.ambienceGain, { type, loop: true });
    // Slow filter movement avoids a static white-noise bed.
    const lfo = this.context.createOscillator();
    lfo.frequency.value = 0.11;
    const depth = this.context.createGain();
    depth.gain.value = frequency * 0.22;
    lfo.connect(depth).connect(filter.frequency);
    this.track(lfo, [depth]);
    lfo.start(at);
    if (["room", "industrial", "city"].includes(this.plan.ambience)) {
      this.hum = this.context.createOscillator();
      this.hum.frequency.value = this.plan.ambience === "industrial" ? 60 : 50;
      const gain = this.context.createGain();
      gain.gain.value = 0.025 * this.plan.ambienceGain;
      this.hum.connect(gain).connect(this.bus);
      this.track(this.hum, [gain]);
      this.hum.start(at);
    }
    this.update(offset);
  }

  step(at, index) {
    const [high, body, duration, level] = surfaces[this.plan.surface];
    const gain = level * this.plan.stepsGain * (0.85 + Math.random() * 0.25);
    // Heel, body, then the quieter sole. Alternate each foot's timbre slightly.
    this.noiseVoice(at, duration, high, gain * 0.6, { highpass: 220 });
    this.noiseVoice(at, duration, body * (index % 2 ? 1.07 : 0.94), gain, { type: "bandpass" });
    this.noiseVoice(at + 0.075, duration, high, gain * 0.25, { highpass: 500 });
    this.tone(at, 0.1, 85, gain * 0.1, 60);
    if (this.plan.surface === "metal") this.tone(at, 0.22, 650, gain * 0.055, 610);
  }

  update(time) {
    if (!this.playing) return;
    // Short lookahead: schedule against the audio clock, never replay missed steps.
    const from = Math.max(this.until, time, this.context.currentTime - this.origin);
    const to = Math.min(time + 0.12, this.duration);
    for (const { at, index } of footfallsBetween(this.route, from, to, this.interval)) {
      this.step(this.origin + at, index);
    }
    this.until = Math.max(this.until, to);
    if (time >= this.nextDetail) {
      const at = this.context.currentTime + 0.02;
      const gain = this.plan.ambienceGain;
      if (this.plan.ambience === "forest") {
        const pitch = 1800 + Math.random() * 1000;
        this.tone(at, 0.15, pitch, 0.025 * gain, pitch * 1.35);
        this.tone(at + 0.2, 0.12, pitch * 1.2, 0.018 * gain, pitch);
      } else if (this.plan.ambience === "night") {
        for (let i = 0; i < 3; i++) this.tone(at + i * 0.12, 0.06, 4200, 0.012 * gain);
      } else if (this.plan.ambience === "water") {
        this.noiseVoice(at, 1.5, 1000, 0.08 * gain);
      }
      this.nextDetail = time + 3 + Math.random() * 5;
    }
  }

  stop() {
    this.playing = false;
    if (!this.context) return;
    const now = this.context.currentTime;
    const bus = this.bus;
    if (bus) {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setTargetAtTime(0, now, 0.005);
      setTimeout(() => bus.disconnect(), 60);
    }
    for (const source of this.sources) source.stop(now + 0.03);
    this.sources.clear();
    this.bus = undefined;
  }
}
