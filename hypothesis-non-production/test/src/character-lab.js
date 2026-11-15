import Phaser from "phaser";
import "./character-lab.css";
import {
  CharacterActor, characters, clipGroupById, clipGroups, clipList, clips,
  colorToCss, getCharacter, resolvePalette,
} from "./character/index.js";

const STAGE_WIDTH = 1120;
const STAGE_HEIGHT = 630;
const GROUND_Y = 474;
const CHARACTER_X = [104, 286, 468, 650, 832, 1014];

const rosterElement = document.querySelector("#roster");
const clipsElement = document.querySelector("#clips");
const selectionLabel = document.querySelector("#selection-label");
const clipLabel = document.querySelector("#clip-label");
const hint = document.querySelector("#hint");
const debugInput = document.querySelector("#debug");
const syncInput = document.querySelector("#sync");
const speedInput = document.querySelector("#speed");
const speedValue = document.querySelector("#speed-value");
const flipButton = document.querySelector("#flip");
const cycleButton = document.querySelector("#cycle");

const state = {
  selected: 0,
  clip: "idle",
  sync: true,
  debug: false,
  speed: 1,
  facing: 1,
};

let labScene = null;
let clipIndex = clipList.findIndex((clip) => clip.id === state.clip);

function buildRoster() {
  for (const [index, skin] of characters.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-card";
    button.dataset.character = skin.id;
    button.style.setProperty("--accent", colorToCss(resolvePalette(skin).accent));
    button.innerHTML = `
      <span class="character-index">0${index + 1}</span>
      <span class="character-copy">
        <strong>${skin.name}</strong>
        <em>${skin.role}</em>
        <small>${skin.tagline}</small>
      </span>
    `;
    button.addEventListener("click", () => select(index));
    rosterElement.append(button);
  }
}

function buildClips() {
  for (const group of clipGroups) {
    const section = document.createElement("section");
    section.className = "clip-group";
    const label = document.createElement("span");
    label.className = "clip-group-label";
    label.textContent = group;
    section.append(label);

    const row = document.createElement("div");
    row.className = "clip-row";
    for (const clip of clipList.filter((entry) => clipGroupById[entry.id] === group)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "clip-button";
      button.dataset.clip = clip.id;
      button.innerHTML = `<span>${clip.label}</span><small>${clip.loop ? "цикл" : "один раз"} · ${clip.duration.toFixed(1)} с</small>`;
      button.addEventListener("click", () => applyClip(clip.id));
      row.append(button);
    }
    section.append(row);
    clipsElement.append(section);
  }
}

function select(index) {
  state.selected = index;
  for (const card of rosterElement.querySelectorAll(".character-card")) {
    card.classList.toggle("is-selected", card.dataset.character === characters[index].id);
  }
  updateLabels();
  if (!state.sync) refreshActors(true);
  labScene?.updateStageSelection();
}

function applyClip(id) {
  if (!clips[id]) return;
  clipIndex = clipList.findIndex((clip) => clip.id === id);
  state.clip = id;
  for (const button of clipsElement.querySelectorAll(".clip-button")) {
    button.classList.toggle("is-active", button.dataset.clip === id);
  }
  updateLabels();
  refreshActors(true);
}

function updateLabels() {
  const skin = characters[state.selected];
  const clip = clips[state.clip];
  selectionLabel.textContent = `${skin.name} — ${skin.role}`;
  clipLabel.textContent = `${clip.label.toLowerCase()} · ${clip.duration.toFixed(1)} с · ${clip.loop ? "цикл" : "один раз"}`;
  hint.textContent = `${skin.tagline}  ·  1–6 — персонаж, ← → — клип, F — повернуть, D — скелет`;
}

function refreshActors(restart = true) {
  if (!labScene) return;
  for (const entry of labScene.entries) {
    const active = state.sync || entry.index === state.selected;
    const clip = active ? state.clip : "idle";
    entry.actor.facing = state.facing;
    entry.actor.play(clip, { fade: 0.24, restart });
  }
}

function cycleClip(direction) {
  clipIndex = (clipIndex + direction + clipList.length) % clipList.length;
  applyClip(clipList[clipIndex].id);
}

function flip() {
  state.facing *= -1;
  for (const entry of labScene?.entries ?? []) entry.actor.facing = state.facing;
  flipButton.textContent = state.facing === 1 ? "Повернуть →" : "← Повернуть";
}

function drawBackdrop(graphics) {
  graphics.fillStyle(0x0b0e14).fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  graphics.fillGradientStyle(0x131a25, 0x131a25, 0x0a0d13, 0x0a0d13, 1);
  graphics.fillRect(0, 0, STAGE_WIDTH, GROUND_Y);

  graphics.fillStyle(0xffb36d, 0.05);
  graphics.fillEllipse(STAGE_WIDTH / 2, GROUND_Y - 90, 980, 330);
  graphics.fillStyle(0xffb36d, 0.04);
  graphics.fillEllipse(STAGE_WIDTH / 2, GROUND_Y - 60, 660, 240);

  for (const x of [86, 236, 386, 536, 686, 836, 986, 1096]) {
    graphics.lineStyle(1, 0x2a3442, 0.38);
    graphics.lineBetween(x, 0, x, GROUND_Y);
  }
  for (const y of [132, 264, 396]) {
    graphics.lineStyle(1, 0x24303e, 0.28);
    graphics.lineBetween(0, y, STAGE_WIDTH, y);
  }

  graphics.fillStyle(0xffb36d, 0.14).fillRect(0, 246, STAGE_WIDTH, 1);
  graphics.fillStyle(0xffb36d, 0.5).fillRect(58, 0, 2, 246);
  graphics.fillStyle(0xffb36d, 0.5).fillRect(STAGE_WIDTH - 60, 0, 2, 246);

  graphics.fillStyle(0x10151d);
  graphics.fillRect(0, GROUND_Y, STAGE_WIDTH, STAGE_HEIGHT - GROUND_Y);

  const vanish = { x: STAGE_WIDTH / 2, y: GROUND_Y - 36 };
  for (const x of [-520, -260, 0, 260, 520, 780, 1040, 1300, 1560, 1820]) {
    graphics.lineStyle(1, 0x5d6d80, 0.16);
    graphics.lineBetween(vanish.x, vanish.y, x, STAGE_HEIGHT);
  }
  for (const [y, alpha] of [[GROUND_Y + 22, 0.2], [GROUND_Y + 54, 0.15], [GROUND_Y + 102, 0.1], [GROUND_Y + 158, 0.07]]) {
    graphics.lineStyle(1, 0x6b7c90, alpha);
    graphics.lineBetween(0, y, STAGE_WIDTH, y);
  }
  graphics.lineStyle(1, 0xffb36d, 0.22);
  graphics.lineBetween(0, GROUND_Y, STAGE_WIDTH, GROUND_Y);
}

function drawStageText(scene) {
  scene.add.text(46, 30, "CHARACTER BAY", {
    fontFamily: '"Geist", "Inter", system-ui, sans-serif',
    fontSize: "11px",
    color: "#7d8492",
    letterSpacing: 6,
    resolution: 2,
  }).setDepth(3);

  scene.add.text(STAGE_WIDTH - 48, 26, "RIG / SKIN 04", {
    fontFamily: '"Geist", "Inter", system-ui, sans-serif',
    fontSize: "11px",
    color: "#7d8492",
    letterSpacing: 4,
    resolution: 2,
  }).setOrigin(1, 0).setDepth(3);

  scene.add.text(STAGE_WIDTH - 44, 52, "04", {
    fontFamily: '"Geist", "Inter", system-ui, sans-serif',
    fontSize: "150px",
    fontStyle: "700",
    color: "#ffffff",
    resolution: 2,
  }).setOrigin(1, 0).setAlpha(0.03).setDepth(1);

  scene.add.text(46, 52, "ONE SKELETON · SIX SKINS · TWELVE CLIPS", {
    fontFamily: '"Geist Mono", "SFMono-Regular", ui-monospace, monospace',
    fontSize: "10px",
    color: "#5f6876",
    letterSpacing: 1.6,
    resolution: 2,
  }).setDepth(3);
}

class CharacterLabScene extends Phaser.Scene {
  create() {
    this.clockSeconds = 0;
    drawBackdrop(this.add.graphics().setDepth(0));
    drawStageText(this);
    this.spot = this.add.graphics().setDepth(2);

    this.entries = characters.map((skin, index) => {
      const x = CHARACTER_X[index];
      const actor = new CharacterActor(skin, { clip: "idle" });
      const graphics = this.add.graphics().setDepth(10 + index);
      const label = this.add.text(x, GROUND_Y + 14, skin.name.toUpperCase(), {
        fontFamily: '"Geist", "Inter", system-ui, sans-serif',
        fontSize: "13px",
        fontStyle: "600",
        color: "#8a8f99",
        letterSpacing: 2,
        resolution: 2,
      }).setOrigin(0.5, 0).setDepth(30);
      const role = this.add.text(x, GROUND_Y + 34, skin.role, {
        fontFamily: '"Geist", "Inter", system-ui, sans-serif',
        fontSize: "11px",
        color: "#5f6672",
        resolution: 2,
      }).setOrigin(0.5, 0).setDepth(30);

      const zone = this.add.zone(x, GROUND_Y - 82, 168, 196)
        .setOrigin(0.5, 0.5)
        .setInteractive({ useHandCursor: true });
      zone.on("pointerdown", () => select(index));

      return {
        index, skin, actor, graphics, label, role, x,
      };
    });

    labScene = this;
    this.updateStageSelection();
    refreshActors(true);
  }

  updateStageSelection() {
    for (const entry of this.entries) {
      const selected = entry.index === state.selected;
      entry.label.setColor(selected ? "#fff2df" : "#8a8f99");
      entry.role.setColor(selected ? "#d8b894" : "#5f6672");
      entry.label.setAlpha(selected ? 1 : 0.82);
      entry.role.setAlpha(selected ? 1 : 0.82);
    }
  }

  drawSpot() {
    const entry = this.entries[state.selected];
    if (!entry) return;
    const accent = resolvePalette(entry.skin).accent;
    this.spot.clear();
    this.spot.fillStyle(accent, 0.055);
    this.spot.fillEllipse(entry.x, GROUND_Y - 58, 190, 214);
    this.spot.fillStyle(accent, 0.08);
    this.spot.fillEllipse(entry.x, GROUND_Y, 206, 28);
    this.spot.lineStyle(2, accent, 0.55);
    this.spot.lineBetween(entry.x - 28, GROUND_Y + 1, entry.x + 28, GROUND_Y + 1);
  }

  update(_time, delta) {
    const dt = Math.min(delta, 50) / 1000;
    this.clockSeconds += dt;
    this.drawSpot();

    for (const entry of this.entries) {
      entry.actor.facing = state.facing;
      entry.actor.update(dt * state.speed);
      entry.actor.draw(entry.graphics, {
        x: entry.x,
        y: GROUND_Y,
        alpha: entry.index === state.selected ? 1 : 0.72,
        debug: state.debug,
        time: this.clockSeconds,
      });
    }
  }
}

function bindControls() {
  debugInput.addEventListener("change", () => {
    state.debug = debugInput.checked;
  });
  syncInput.addEventListener("change", () => {
    state.sync = syncInput.checked;
    refreshActors(true);
  });
  speedInput.addEventListener("input", () => {
    state.speed = Number(speedInput.value);
    speedValue.textContent = `${state.speed.toFixed(1)}×`;
  });
  flipButton.addEventListener("click", flip);
  cycleButton.addEventListener("click", () => cycleClip(1));

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (/^[1-6]$/.test(event.key)) {
      select(Number(event.key) - 1);
      event.preventDefault();
    } else if (event.key === "ArrowRight") {
      cycleClip(1);
      event.preventDefault();
    } else if (event.key === "ArrowLeft") {
      cycleClip(-1);
      event.preventDefault();
    } else if (event.key.toLowerCase() === "f") {
      flip();
    } else if (event.key.toLowerCase() === "d") {
      state.debug = !state.debug;
      debugInput.checked = state.debug;
    }
  });
}

buildRoster();
buildClips();
bindControls();
select(0);
applyClip("idle");

window.__characterLab = {
  state,
  characters,
  clipList,
  select,
  applyClip,
  getCharacter,
};

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "stage",
  width: STAGE_WIDTH,
  height: STAGE_HEIGHT,
  backgroundColor: "#0b0e14",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: CharacterLabScene,
});
