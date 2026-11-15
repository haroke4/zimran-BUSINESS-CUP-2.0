import Phaser from "phaser";
import { catalog, clips } from "./catalog.mjs";
import {
  anchor, cityBriefs, entryX, floorY, loadLocation, sanitizeSavedStates,
} from "./scene.mjs";

const assetUrls = import.meta.glob("./assets/*.svg", { eager: true, query: "?url&no-inline", import: "default" });
const briefs = {
  "rainy-crossing": { ...cityBriefs.wet, requiresSkyline: true },
  "quiet-block": { ...cityBriefs.dry, requiresSkyline: true },
  "pine-trail": { ...cityBriefs.trail, requiresSkyline: true },
};
const SCENE_COUNT = 10;
const DURATION = 30_000;
const CHOICE_AT = 27_000;
const EPISODE_KEY = "framebreak.live.episode";
const PENDING_KEY = "framebreak.live.pending";
const PLAYBACK_KEY = "framebreak.live.playback";

const $ = (id) => document.getElementById(id);
const intro = $("intro");
const player = $("player");
const startButton = $("start");
const premiseInput = $("premise");
const introStatus = $("intro-status");
const resumeNote = $("resume-note");
const sceneMeta = $("scene-meta");
const modelMeta = $("model-meta");
const sceneStatus = $("scene-status");
const sceneKicker = $("scene-kicker");
const sceneTitle = $("scene-title");
const caption = $("caption");
const consequence = $("consequence");
const recovery = $("recovery");
const progressBar = $("progress");
const choices = $("choices");
const waiting = $("waiting");
const generation = $("generation");
const generationText = $("generation-text");
const errorPanel = $("error");
const errorTitle = $("error-title");
const errorMessage = $("error-message");
const errorValidation = $("error-validation");
const retryChoice = $("retry-choice");
const dismissError = $("dismiss-error");
const completion = $("completion");
const completionTitle = $("completion-title");
const completionSummary = $("completion-summary");
const facts = $("facts");
const stateJson = $("state-json");
const perfToggle = $("perf-toggle");
const perfPre = $("perf");
const stageElement = $("stage");

const state = {
  episode: null,
  currentScene: null,
  pending: null,
  generation: false,
  errorVisible: false,
  starting: false,
  choicesVisible: false,
  lastCaption: "",
  lastTickUi: 0,
  lastPlaybackSave: 0,
  sceneMounts: 0,
  modelRequests: [],
  frameTimes: [],
  bootId: crypto.randomUUID(),
};

function readJson(storage, key) {
  try {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode or a full quota; the server remains canonical
  }
}

function remove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

function readEpisodeId() {
  const raw = localStorage.getItem(EPISODE_KEY);
  if (!raw) return null;
  if (!raw.startsWith("\"")) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readPending() {
  return readJson(localStorage, PENDING_KEY);
}

function writePending(pending) {
  writeJson(localStorage, PENDING_KEY, pending);
}

function clearPending() {
  remove(localStorage, PENDING_KEY);
}

function clearPlayback() {
  remove(localStorage, PLAYBACK_KEY);
}

function writePlayback(elapsed) {
  if (!state.episode || !state.currentScene) return;
  writeJson(localStorage, PLAYBACK_KEY, {
    episodeId: state.episode.id,
    revision: state.episode.revision,
    scene: state.currentScene.number,
    elapsedMs: Math.max(0, Math.min(elapsed, DURATION)),
  });
}

function resumeElapsed(scene) {
  const playback = readJson(localStorage, PLAYBACK_KEY);
  if (!playback || !state.episode || playback.episodeId !== state.episode.id) return 0;
  if (playback.revision !== state.episode.revision || playback.scene !== scene.number) return 0;
  return Math.max(0, Math.min(playback.elapsedMs ?? 0, DURATION));
}

async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(150_000),
    });
  } catch (error) {
    throw Object.assign(new Error("The local API is not reachable. Start it with: npm run server"), {
      code: "api_unreachable",
      retryable: true,
      cause: error,
    });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error ?? { code: `http_${response.status}`, message: `HTTP ${response.status}` };
    throw Object.assign(new Error(detail.message), detail, { status: response.status });
  }
  return payload;
}

function setIntroStatus(text) {
  introStatus.textContent = text;
}

function showIntro(message = "") {
  intro.hidden = false;
  player.hidden = true;
  resumeNote.hidden = !readEpisodeId();
  if (message) setIntroStatus(message);
  startButton.disabled = false;
}

function shortModel(health) {
  if (health?.model?.model?.includes("gemini")) return `Gemini · ${health.model.model}`;
  const meta = health?.model?.meta;
  if (meta?.n_params) {
    const billions = (meta.n_params / 1e9).toFixed(1);
    return `Local model · ${billions}B ${meta.ftype ?? ""}`.trim();
  }
  return health?.model?.ok ? "Model · online" : "Model · offline";
}

async function checkHealth() {
  try {
    const health = await api("/health");
    modelMeta.textContent = shortModel(health);
    setIntroStatus(health.model?.ok ? `Model online · ${shortModel(health)}` : "Model offline");
    return health;
  } catch (error) {
    modelMeta.textContent = "Gemini · offline";
    setIntroStatus(error.message);
    return { ok: false, error };
  }
}

function drawHero(graphics, { clip, phase, x, y, hand }) {
  const stride = clip === "run" ? 14 : 8;
  const walking = clips[clip]?.mode === "ground";
  const cycle = walking ? Math.sin(phase) : 0;
  const deadTilt = clip === "die" ? phase * 1.48 : 0;
  const lift = ["jump", "fly"].includes(clip) ? Math.sin(phase * Math.PI) * (clip === "fly" ? 115 : 62) : 0;
  const crying = clip === "cry" ? Math.sin(phase * 30) * 2 : 0;
  const headY = -59 + Math.abs(cycle) * 3 + crying;
  const wrist = hand ?? [x + 20 - cycle * stride, y - 21];
  graphics.clear().setPosition(x, y - lift).setRotation(deadTilt);
  graphics.lineStyle(5, 0xf2d3b8);
  graphics.lineBetween(0, headY + 9, 0, -25);
  graphics.lineBetween(0, -26, -8 - cycle * stride, -13);
  graphics.lineBetween(-8 - cycle * stride, -13, -12 - cycle * stride, 0);
  graphics.lineBetween(0, -26, 7 + cycle * stride, -13);
  graphics.lineBetween(7 + cycle * stride, -13, 12 + cycle * stride, 0);
  graphics.lineStyle(4, 0xffaa83).lineBetween(0, -39, wrist[0] - x, wrist[1] - y);
  graphics.fillStyle(0xf9dbbc).fillCircle(1, headY, 11);
  graphics.fillStyle(0x312947).fillCircle(6, headY - 1, 2);
  if (clip === "cry") graphics.fillStyle(0x9fbae3).fillCircle(8, headY + 7 + crying, 2);
}

const stageHooks = {
  onTick: null,
  onComplete: null,
  onError: null,
  onRecovery: null,
};
let resolveStageReady;
const stageReady = new Promise((resolve) => {
  resolveStageReady = resolve;
});
let stageApi = null;

class LiveEpisodeScene extends Phaser.Scene {
  preload() {
    for (const asset of catalog) {
      this.load.svg(asset.id, assetUrls[`./assets/${asset.file}`]);
      if (asset.overlay) this.load.svg(`${asset.id}:overlay`, assetUrls[`./assets/${asset.overlay}`]);
    }
    this.load.on("loaderror", (file) => {
      stageHooks.onError?.(new Error(`Art failed to load: ${file?.key ?? "unknown"}`));
    });
  }

  create() {
    this.hero = this.add.graphics().setDepth(50);
    this.objects = [];
    this.props = new Map();
    this.sceneData = null;
    stageApi = {
      setScene: (scene, elapsed = 0) => this.applyScene(scene, elapsed),
      setPaused: (paused) => {
        this.paused = paused;
      },
      snapshot: () => this.snapshot(),
    };
    this.game.canvas.setAttribute("aria-label", "Street assembled from layered art and props");
    resolveStageReady?.();
    if (this.pendingScene) {
      const pending = this.pendingScene;
      this.pendingScene = null;
      this.applyScene(pending.scene, pending.elapsed);
    }
  }

  clearLocation() {
    for (const object of this.objects) object.destroy();
    this.objects = [];
    this.props.clear();
    this.cabinet = null;
    this.hero.clear();
  }

  applyScene(scene, elapsed = 0) {
    this.clearLocation();
    this.sceneData = scene;
    this.elapsed = Math.max(0, Math.min(elapsed, scene.staging?.durationMs ?? DURATION));
    this.paused = false;
    this.completed = false;
    this.facts = scene.facts ?? {};
    this.interaction = scene.staging?.interaction?.[0] ?? null;
    this.approach = scene.staging?.clip ?? "walk";

    const brief = briefs[scene.location.id];
    if (!brief) {
      stageHooks.onError?.(new Error(`Unknown live location: ${scene.location.id}`));
      return;
    }
    const sanitized = sanitizeSavedStates(scene.location.layout, scene.location.states ?? {});
    if (sanitized.recovered.length) {
      stageHooks.onRecovery?.(sanitized.recovered[0]);
    }
    let location;
    try {
      location = loadLocation(scene.location.layout, { brief }, sanitized.states);
    } catch (error) {
      try {
        location = loadLocation(scene.location.layout, { brief }, {});
        stageHooks.onRecovery?.({ instance: "scene", removed: "saved props", fallback: "defaults" });
      } catch (retryError) {
        stageHooks.onError?.(new Error(`The scene layout could not be mounted: ${retryError.message}`));
        return;
      }
    }
    this.location = location;
    this.states = {};
    for (const object of location.objects) this.states[object.instance] = object.state;

    const depths = { sky: 0, skyline: 10, ground: 20, surface: 30, prop: 40 };
    this.objects = location.objects.flatMap(({ asset, x, y, state, instance }) => {
      const image = this.add.image(x, y, asset.id).setDepth(depths[asset.layer]);
      if (asset.layer === "sky" || asset.layer === "ground") image.setOrigin(0, 0);
      else if (asset.layer === "surface") image.setOrigin(0.5, 0.5);
      else image.setOrigin(0.5, 1);
      if (!asset.overlay) return [image];
      const door = this.add.image(x - 31, y - 94, `${asset.id}:overlay`).setOrigin(0, 0).setDepth(42);
      const contents = this.add.graphics().setDepth(41);
      contents.fillStyle(0xf4b38d).fillRoundedRect(x + 8, y - 56, 13, 25, 3);
      contents.fillStyle(0xffd6aa).fillRect(x + 11, y - 59, 7, 4);
      contents.fillStyle(0x5a3949).fillRect(x + 10, y - 50, 9, 3);
      contents.setVisible(false);
      this.props.set(instance, { door, contents, asset });
      this.cabinet = location.objects.find((object) => object.instance === instance);
      return [image, contents, door];
    });

    this.beats = Array.isArray(scene.staging?.beats) && scene.staging.beats.length
      ? scene.staging.beats
      : [{ startMs: 0, durationMs: this.approach === "run" ? 4_000 : 6_000, clip: this.approach, target: "cache" }];
    this.render(0);
    this.emitTick(0);
  }

  snapshot() {
    return {
      elapsed: this.elapsed ?? 0,
      duration: this.sceneData?.staging?.durationMs ?? DURATION,
      completed: Boolean(this.completed),
      paused: Boolean(this.paused),
      scene: this.sceneData?.number ?? null,
      revision: this.sceneData?.revision ?? null,
      fps: Math.round(this.game.loop.actualFps ?? 0),
    };
  }

  emitTick(delta) {
    stageHooks.onTick?.({
      ...this.snapshot(),
      delta,
      elapsed: this.elapsed ?? 0,
    });
  }

  update(_time, rawDelta) {
    if (!this.sceneData || this.paused) return;
    const delta = Math.min(rawDelta, 100);
    this.elapsed = Math.min(this.elapsed + delta, this.sceneData.staging?.durationMs ?? DURATION);
    this.render(delta);
    this.emitTick(rawDelta);
    if (this.elapsed >= (this.sceneData.staging?.durationMs ?? DURATION) && !this.completed) {
      this.completed = true;
      stageHooks.onComplete?.(this.snapshot());
    }
  }

  render(delta) {
    if (!this.sceneData) return;
    const elapsed = this.elapsed ?? 0;
    const targetX = (target) => {
      if (target === "cache" && this.cabinet) return anchor(this.cabinet, "approach")[0];
      if (target === "right") return 860;
      if (target === "center") return 480;
      return entryX;
    };
    let x = entryX;
    let activeBeat = null;
    for (const beat of this.beats) {
      const start = beat.startMs ?? 0;
      const duration = Math.max(1, beat.durationMs ?? 1);
      if (elapsed < start) break;
      const origin = x;
      const destination = targetX(beat.target);
      const progress = Phaser.Math.Clamp((elapsed - start) / duration, 0, 1);
      x = Phaser.Math.Linear(origin, destination, Phaser.Math.Easing.Sine.InOut(progress));
      if (progress < 1) {
        activeBeat = beat;
        break;
      }
    }
    const walking = Boolean(activeBeat);
    const clip = activeBeat?.clip ?? "idle";
    const phase = walking
      ? ((elapsed - activeBeat.startMs) / (clips[clip]?.cycle ?? 520)) * Math.PI * 2
      : elapsed * 0.003;
    let hand;
    if (this.interaction && this.cabinet) {
      const start = this.interaction.startMs;
      if (elapsed >= start - 350 && elapsed <= start + 300) {
        const mix = Phaser.Math.Clamp((elapsed - (start - 350)) / 650, 0, 1);
        const [hx, hy] = anchor(this.cabinet, "handle");
        hand = [Phaser.Math.Linear(x + 20, hx, mix), Phaser.Math.Linear(floorY - 21, hy, mix)];
      }
    }
    drawHero(this.hero, { clip, phase, x, y: floorY, hand });

    for (const [instance, entry] of this.props) {
      const { door, contents, asset } = entry;
      let open;
      let scale;
      if (this.interaction?.instance === instance) {
        const { from, to, startMs, durationMs } = this.interaction;
        const step = Phaser.Math.Clamp((elapsed - startMs) / durationMs, 0, 1);
        const easedDoor = Phaser.Math.Easing.Sine.InOut(step);
        scale = Phaser.Math.Linear(asset.states[from], asset.states[to], easedDoor);
        open = step >= 1 ? to === "open" : from === "open";
      } else {
        const current = this.states[instance] ?? asset.defaultState;
        scale = asset.states[current];
        open = current === "open";
      }
      door.setScale(scale, 1);
      contents.setVisible(open && this.facts["battery.taken"] !== true);
    }
    if (delta > 0) state.frameTimes.push(delta);
    if (state.frameTimes.length > 180) state.frameTimes.shift();
  }
}

function frameStats() {
  if (!state.frameTimes.length) return { frames: 0, avgMs: null, p95Ms: null, fps: null };
  const sorted = [...state.frameTimes].sort((left, right) => left - right);
  const avg = state.frameTimes.reduce((sum, value) => sum + value, 0) / state.frameTimes.length;
  return {
    frames: state.frameTimes.length,
    avgMs: Number(avg.toFixed(2)),
    p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
    fps: Number((1000 / avg).toFixed(1)),
  };
}

function snapshot() {
  return {
    bootId: state.bootId,
    episodeId: state.episode?.id ?? null,
    revision: state.episode?.revision ?? null,
    scene: state.currentScene?.number ?? null,
    status: state.episode?.status ?? null,
    playback: state.currentScene ? {
      elapsedMs: Math.round(stageApi?.snapshot().elapsed ?? 0),
      durationMs: state.currentScene.staging?.durationMs ?? DURATION,
      complete: stageElement.dataset.playbackComplete === "true",
    } : null,
    generation: state.generation,
    error: state.errorVisible,
    frameStats: frameStats(),
    sceneMounts: state.sceneMounts,
    modelRequests: state.modelRequests.slice(-20),
    renderer: state.game?.renderer?.type === Phaser.WEBGL ? "webgl" : "canvas",
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: navigator.deviceMemory ?? null,
    userAgent: navigator.userAgent,
    navigationEntries: performance.getEntriesByType("navigation").length,
  };
}

window.__framebreak = {
  bootId: state.bootId,
  snapshot,
  get episode() {
    return state.episode;
  },
};
window.__framebreakPerf = { snapshot };

function renderRecovery(episode) {
  const item = episode?.recovery;
  if (!item?.message) {
    recovery.hidden = true;
    return;
  }
  recovery.hidden = false;
  recovery.textContent = `Recovered: ${item.message}`;
}

function updateMeta() {
  const episode = state.episode;
  const scene = state.currentScene;
  if (!episode || !scene) return;
  sceneMeta.textContent = episode.status === "complete"
    ? `Scene ${scene.number}/${SCENE_COUNT} · complete · revision ${episode.revision}`
    : `Scene ${scene.number}/${SCENE_COUNT} · revision ${episode.revision}`;
  player.dataset.episodeId = episode.id;
  player.dataset.scene = String(scene.number);
  player.dataset.revision = String(episode.revision);
  player.dataset.status = episode.status;
}

function updateFacts() {
  const episode = state.episode;
  if (!episode) return;
  facts.replaceChildren();
  const entries = Object.entries(episode.progress.facts);
  if (!entries.length) {
    const empty = document.createElement("span");
    empty.className = "fact";
    empty.textContent = "no committed facts";
    facts.append(empty);
  } else {
    for (const [key, value] of entries) {
      const chip = document.createElement("span");
      chip.className = "fact";
      chip.textContent = `${key}: ${JSON.stringify(value)}`;
      facts.append(chip);
    }
  }
  const summary = {
    revision: episode.revision,
    scene: episode.progress.scene,
    status: episode.status,
    facts: episode.progress.facts,
    choices: episode.progress.choices,
    props: episode.progress.props,
    visitedLayouts: Object.fromEntries(Object.entries(episode.progress.visitedLayouts).map(([id, visited]) => [
      id,
      {
        preset: visited.preset,
        firstScene: visited.firstScene,
        lastScene: visited.lastScene,
        source: visited.source,
        placements: visited.layout.placements,
      },
    ])),
    recoveries: episode.progress.recoveries,
  };
  stateJson.textContent = JSON.stringify(summary, null, 2);
}

function applyTimeline(elapsed) {
  const scene = state.currentScene;
  if (!scene) return;
  let current = scene.timeline?.[0];
  for (const entry of scene.timeline ?? []) {
    if (entry.atMs <= elapsed) current = entry;
  }
  if (current && current.text !== state.lastCaption) {
    state.lastCaption = current.text;
    caption.textContent = current.text;
  }
  if (scene.consequence && elapsed >= 18_000) {
    consequence.hidden = false;
    consequence.textContent = `${scene.consequence.title}: ${scene.consequence.text}`;
  } else {
    consequence.hidden = true;
  }
}

function renderChoices(scene) {
  choices.replaceChildren();
  for (const [index, choice] of scene.choices.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.choiceId = choice.id;
    button.dataset.effects = JSON.stringify(choice.effects);
    button.className = index === 0 ? "primary" : "";
    button.textContent = choice.label;
    button.disabled = true;
    button.addEventListener("click", () => choose(choice));
    choices.append(button);
  }
  choices.hidden = true;
  state.choicesVisible = false;
}

function updateChoiceAvailability(tick) {
  const scene = state.currentScene;
  if (!scene) return;
  const elapsed = tick?.elapsed ?? 0;
  const duration = scene.staging?.durationMs ?? DURATION;
  const visible = elapsed >= (scene.staging?.choiceAtMs ?? CHOICE_AT);
  state.choicesVisible = visible;
  choices.hidden = !visible;
  if (!visible) {
    waiting.hidden = false;
    waiting.textContent = `The scene is playing. Choices open in ${Math.ceil((scene.staging?.choiceAtMs ?? CHOICE_AT) / 1000)} seconds.`;
    return;
  }
  waiting.hidden = false;
  const ready = elapsed >= duration && !state.generation && !state.errorVisible && state.episode?.status !== "complete";
  for (const button of choices.querySelectorAll("button")) button.disabled = !ready;
  if (state.episode?.status === "complete") {
    waiting.textContent = "Episode complete.";
  } else if (state.generation) {
    waiting.textContent = "Generation in progress.";
  } else if (state.errorVisible) {
    waiting.textContent = "Generation failed. Retry or dismiss the error.";
  } else if (!ready) {
    waiting.textContent = "Choice unlocks when the 30-second scene ends.";
  } else {
    waiting.textContent = "Choose one. Only one request will advance the revision.";
  }
}

async function mountScene(scene, { resume = true, paused = false } = {}) {
  state.currentScene = scene;
  state.lastCaption = "";
  state.lastTickUi = 0;
  state.sceneMounts += 1;
  const elapsed = resume ? resumeElapsed(scene) : 0;
  await stageReady;
  stageApi.setScene(scene, elapsed);
  stageApi.setPaused(paused);
  state.errorVisible = false;
  errorPanel.hidden = true;
  generation.hidden = true;
  if (state.episode?.status !== "complete") completion.hidden = true;
  sceneKicker.textContent = `Scene ${scene.number} of ${SCENE_COUNT} · 30 seconds`;
  sceneTitle.textContent = scene.title;
  progressBar.style.transform = `scaleX(${elapsed / (scene.staging?.durationMs ?? DURATION)})`;
  renderChoices(scene);
  applyTimeline(elapsed);
  updateMeta();
  updateFacts();
  updateChoiceAvailability({ elapsed, duration: scene.staging?.durationMs ?? DURATION });
  if (elapsed >= (scene.staging?.durationMs ?? DURATION)) {
    stageElement.dataset.playbackComplete = "true";
    if (!paused) sceneStatus.textContent = "Choose to continue";
  } else {
    stageElement.dataset.playbackComplete = "false";
    sceneStatus.textContent = paused ? "Complete" : "Playing";
  }
  if (elapsed > 0) {
    sceneStatus.textContent = `Resumed at ${Math.floor(elapsed / 1000)}s`;
  }
  document.title = `${scene.title} · FRAMEBREAK`;
}

function showGeneration(text) {
  generation.hidden = false;
  generationText.textContent = text;
  waiting.hidden = true;
  for (const button of choices.querySelectorAll("button")) button.disabled = true;
}

function hideGeneration() {
  generation.hidden = true;
}

function validationBlock(label, value) {
  const article = document.createElement("article");
  const heading = document.createElement("h3");
  heading.textContent = label;
  article.append(heading);
  if (!value) {
    const empty = document.createElement("p");
    empty.textContent = "No validation payload.";
    article.append(empty);
    return article;
  }
  const status = document.createElement("p");
  status.textContent = value.ok === true ? "Passed" : value.ok === false ? "Failed" : "Not run";
  article.append(status);
  const errors = [
    ...(value.errors ?? []),
    ...(value.model?.errors ?? []),
    ...(value.layout?.ok === false ? ["Layout validation failed."] : []),
  ];
  if (value.phase) errors.push(`Phase: ${value.phase}`);
  if (value.model?.attempts) errors.push(`Model attempts: ${value.model.attempts}`);
  if (value.attempts) errors.push(`Attempts: ${value.attempts}`);
  if (value.layout?.source) errors.push(`Layout: ${value.layout.source}`);
  if (errors.length) {
    const list = document.createElement("ul");
    for (const error of errors) {
      const item = document.createElement("li");
      item.textContent = String(error);
      list.append(item);
    }
    article.append(list);
  }
  return article;
}

function showError(error) {
  state.errorVisible = true;
  state.generation = false;
  hideGeneration();
  errorPanel.hidden = false;
  errorTitle.textContent = error.title
    ?? (error.code === "stale_revision" ? "The revision moved"
      : error.code === "episode_complete" ? "Episode complete"
        : error.code === "generation_in_progress" ? "Generation already running"
          : error.code === "api_unreachable" ? "Local API unavailable"
            : error.phase === "narrative" ? "Narrative grounding failed"
              : error.phase === "technical" ? "Scene layout failed validation"
                : "The next scene could not be generated");
  errorMessage.textContent = error.message ?? "Unknown failure.";
  errorValidation.replaceChildren(
    validationBlock("Technical validation", error.validation?.technical),
    validationBlock("Narrative validation", error.validation?.narrative),
  );
  const canRetry = Boolean(state.pending) && error.retryable !== false;
  retryChoice.hidden = !canRetry;
  sceneStatus.textContent = "Needs retry";
  player.dataset.status = "error";
  updateChoiceAvailability({ elapsed: state.currentScene?.staging?.durationMs ?? DURATION });
}

async function refreshEpisode({ announce } = {}) {
  if (!state.episode) return;
  try {
    const payload = await api(`/episodes/${state.episode.id}`);
    await mountEpisode(payload.episode);
    if (announce) setIntroStatus(announce);
    return payload.episode;
  } catch (error) {
    showError(error);
    return null;
  }
}

async function submitPending() {
  const pending = state.pending;
  if (!pending || state.generation || !state.episode) return;
  if (pending.revision !== state.episode.revision) {
    clearPending();
    state.pending = null;
    await refreshEpisode();
    return;
  }
  state.generation = true;
  state.errorVisible = false;
  errorPanel.hidden = true;
  showGeneration("Writer → retrieval → compositor…");
  sceneStatus.textContent = "Writing next scene…";
  stageApi?.setPaused(true);
  const started = performance.now();
  try {
    const result = await api(`/episodes/${state.episode.id}/choices`, {
      method: "POST",
      body: {
        revision: pending.revision,
        requestId: pending.requestId,
        choice: { id: pending.choiceId, effects: pending.effects },
      },
    });
    state.modelRequests.push({
      label: "choice",
      revision: pending.revision,
      scene: state.episode.current?.number,
      ms: Math.round(performance.now() - started),
      status: 200,
    });
    state.pending = null;
    clearPending();
    clearPlayback();
    state.generation = false;
    state.episode = result.episode;
    hideGeneration();
    renderRecovery(result.episode);
    updateMeta();
    updateFacts();
    if (result.complete || result.episode.status === "complete") {
      await mountScene(result.episode.current, { resume: false, paused: true });
      renderComplete(result.episode);
    } else {
      await mountScene(result.episode.current, { resume: false });
    }
  } catch (error) {
    state.generation = false;
    state.modelRequests.push({
      label: "choice",
      revision: pending.revision,
      ms: Math.round(performance.now() - started),
      status: error.status ?? 0,
      code: error.code,
    });
    hideGeneration();
    const stale = ["stale_revision", "episode_complete"].includes(error.code);
    const terminal = stale || ["invalid_choice", "effect_mismatch", "invalid_revision", "invalid_request_id"].includes(error.code);
    if (stale) {
      clearPending();
      state.pending = null;
      await refreshEpisode();
    } else if (terminal) {
      clearPending();
      state.pending = null;
    }
    showError(error);
  }
}

async function choose(choice) {
  if (!state.episode || state.generation || state.errorVisible) return;
  if (state.episode.status === "complete") return;
  if (stageElement.dataset.playbackComplete !== "true") return;
  const pending = {
    episodeId: state.episode.id,
    revision: state.episode.revision,
    scene: state.currentScene.number,
    choiceId: choice.id,
    label: choice.label,
    effects: choice.effects,
    requestId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  state.pending = pending;
  writePending(pending);
  await submitPending();
}

function renderComplete(episode) {
  completion.hidden = false;
  const outcome = episode.current?.outcome;
  completionTitle.textContent = outcome?.label ? `You chose: ${outcome.label}` : "Episode complete";
  const battery = episode.progress.facts["battery.taken"] === true ? "taken from the cache" : "left in the cache";
  completionSummary.textContent = `${outcome?.text ?? "The story ends at the crossing."} The battery was ${battery}. Revision ${episode.revision}, ${episode.progress.choices.length} committed choices, ${Object.keys(episode.progress.visitedLayouts).length} visited layouts.`;
  choices.hidden = true;
  waiting.hidden = true;
  generation.hidden = true;
  errorPanel.hidden = true;
  state.errorVisible = false;
  sceneStatus.textContent = "Complete";
  progressBar.style.transform = "scaleX(1)";
  stageElement.dataset.playbackComplete = "true";
  player.dataset.status = "complete";
  updateMeta();
  updateFacts();
}

async function mountEpisode(episode) {
  state.episode = episode;
  intro.hidden = true;
  player.hidden = false;
  renderRecovery(episode);
  updateMeta();
  updateFacts();
  if (episode.status === "complete") {
    await mountScene(episode.current, { resume: false, paused: true });
    renderComplete(episode);
    return;
  }
  await mountScene(episode.current, { resume: true });
  const pending = readPending();
  if (!pending || pending.episodeId !== episode.id) return;
  if (episode.pending?.requestId === pending.requestId) {
    state.pending = pending;
    await submitPending();
    return;
  }
  if (episode.lastFailure && pending.revision === episode.revision) {
    state.pending = pending;
    showError(episode.lastFailure);
    return;
  }
  clearPending();
}

async function startNewEpisode() {
  if (state.starting) return;
  state.starting = true;
  startButton.disabled = true;
  showIntro("Writing scene 1 with Gemini…");
  try {
    const payload = await api("/episodes", {
      method: "POST",
      body: { premise: premiseInput?.value ?? "" },
    });
    localStorage.setItem(EPISODE_KEY, payload.episode.id);
    clearPending();
    clearPlayback();
    await mountEpisode(payload.episode);
  } catch (error) {
    showIntro(`Could not start: ${error.message}`);
  } finally {
    state.starting = false;
    startButton.disabled = false;
  }
}

async function resumeSavedEpisode() {
  const id = readEpisodeId();
  if (!id) {
    showIntro();
    return;
  }
  setIntroStatus("Loading saved episode…");
  try {
    const payload = await api(`/episodes/${id}`);
    await mountEpisode(payload.episode);
  } catch (error) {
    if (error.code === "not_found") {
      remove(localStorage, EPISODE_KEY);
      clearPending();
      clearPlayback();
      showIntro("The saved episode is no longer on the local server.");
    } else {
      showIntro(`Could not resume: ${error.message}`);
    }
  }
}

stageHooks.onTick = (tick) => {
  if (!state.currentScene || state.errorVisible || state.generation) return;
  const now = performance.now();
  if (now - state.lastTickUi < 80 && tick.elapsed < tick.duration) return;
  state.lastTickUi = now;
  const duration = state.currentScene.staging?.durationMs ?? DURATION;
  progressBar.style.transform = `scaleX(${tick.elapsed / duration})`;
  applyTimeline(tick.elapsed);
  updateChoiceAvailability(tick);
  if (tick.elapsed < duration) {
    sceneStatus.textContent = `Playing · ${Math.ceil((duration - tick.elapsed) / 1000)}s left`;
    stageElement.dataset.playbackComplete = "false";
  } else {
    sceneStatus.textContent = "Choose to continue";
    stageElement.dataset.playbackComplete = "true";
  }
  if (now - state.lastPlaybackSave > 1000) {
    state.lastPlaybackSave = now;
    writePlayback(tick.elapsed);
  }
};

stageHooks.onComplete = () => {
  if (state.errorVisible || state.generation) return;
  stageElement.dataset.playbackComplete = "true";
  sceneStatus.textContent = "Choose to continue";
  writePlayback(DURATION);
  updateChoiceAvailability({ elapsed: DURATION, duration: DURATION });
};

stageHooks.onError = (error) => {
  showError(Object.assign(error, { code: "client_stage_error", retryable: false }));
};

stageHooks.onRecovery = (item) => {
  recovery.hidden = false;
  recovery.textContent = `Recovered: ${item.instance} state “${String(item.removed)}” was invalid; using ${item.fallback}.`;
};

startButton.addEventListener("click", startNewEpisode);
$("resume").addEventListener("click", resumeSavedEpisode);
$("restart").addEventListener("click", startNewEpisode);
$("new-episode").addEventListener("click", () => {
  if (state.starting) return;
  if (window.confirm("Start a new episode? The current progress stays on the local server.")) startNewEpisode();
});
retryChoice.addEventListener("click", submitPending);
dismissError.addEventListener("click", () => {
  state.errorVisible = false;
  errorPanel.hidden = true;
  state.pending = null;
  clearPending();
  updateChoiceAvailability({ elapsed: state.currentScene?.staging?.durationMs ?? DURATION });
  sceneStatus.textContent = "Choose again";
});
$("replay").addEventListener("click", startNewEpisode);
perfToggle.addEventListener("click", () => {
  perfPre.hidden = !perfPre.hidden;
  if (!perfPre.hidden) perfPre.textContent = JSON.stringify(snapshot(), null, 2);
});

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 960,
  height: 540,
  parent: "stage",
  backgroundColor: "#111322",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: LiveEpisodeScene,
  fps: { target: 60 },
});
state.game = game;

if (new URLSearchParams(location.search).get("perf") === "1") {
  perfPre.hidden = false;
  perfPre.textContent = JSON.stringify(snapshot(), null, 2);
}

(async () => {
  await checkHealth();
  const saved = readEpisodeId();
  if (saved) {
    await resumeSavedEpisode();
  } else {
    showIntro();
  }
})();
