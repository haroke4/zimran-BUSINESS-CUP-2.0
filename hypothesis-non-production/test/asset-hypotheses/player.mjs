import Phaser from "phaser";
import { catalog, clips } from "./catalog.mjs";
import generated from "./assets/model-layouts.json";
import {
  cityBriefs, commitActions, compileAction, compileSolo,
  entryX, floorY, loadLocation, sanitizeSavedStates,
} from "./scene.mjs";

const assetUrls = import.meta.glob("./assets/*.svg", { eager: true, query: "?url&no-inline", import: "default" });
const locationSelect = document.querySelector("#location");
const interact = document.querySelector("#interact");
const take = document.querySelector("#take");
const leave = document.querySelector("#leave");
const clipSelect = document.querySelector("#clip");
const perform = document.querySelector("#perform");
const status = document.querySelector("#status");
const storageKey = "framebreak-asset-lab-v1";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readStates() {
  try {
    return asRecord(JSON.parse(sessionStorage.getItem(storageKey) ?? "{}"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return {};
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

class AssetLab extends Phaser.Scene {
  preload() {
    for (const asset of catalog) {
      this.load.svg(asset.id, assetUrls[`./assets/${asset.file}`]);
      if (asset.overlay) this.load.svg(`${asset.id}:overlay`, assetUrls[`./assets/${asset.overlay}`]);
    }
  }

  create() {
    this.stateByLocation = readStates();
    this.hero = this.add.graphics().setDepth(50);
    this.mount(locationSelect.value);
    locationSelect.addEventListener("change", () => this.mount(locationSelect.value));
    interact.addEventListener("click", () => this.startInteraction());
    take.addEventListener("click", () => this.chooseBattery("taken"));
    leave.addEventListener("click", () => this.chooseBattery("left"));
    perform.addEventListener("click", () => this.startClip(clipSelect.value));
    this.game.canvas.setAttribute("aria-label", "Street assembled from layered art and props");
  }

  mount(preset) {
    this.objects?.forEach((item) => item.destroy());
    this.objects = [];
    this.props = new Map();
    this.cabinet = null;
    this.sequence = null;
    this.notice = "";
    const context = { brief: cityBriefs[preset] };
    this.generated = generated[preset];
    const { layout } = this.generated;
    const saved = asRecord(this.stateByLocation[layout.id]);
    const { states, recovered } = sanitizeSavedStates(layout, saved);
    if (Object.hasOwn(saved, "batteryChoice")) states.batteryChoice = saved.batteryChoice;
    if (recovered.length) {
      const { instance, removed, fallback } = recovered[0];
      this.notice = `Saved state for ${instance} was “${String(removed)}”; reset to ${fallback}.`;
      this.stateByLocation[layout.id] = states;
      sessionStorage.setItem(storageKey, JSON.stringify(this.stateByLocation));
    }
    this.states = states;

    try {
      this.location = loadLocation(layout, context, this.states);
    } catch (error) {
      drawHero(this.hero, { clip: "idle", phase: 0, x: entryX, y: floorY });
      status.textContent = `Scene failed to load: ${error.message}. Choose another location or reload.`;
      for (const control of [interact, perform, clipSelect, locationSelect, take, leave]) control.disabled = true;
      return;
    }

    this.heroX = entryX;
    this.heroY = floorY;
    this.elapsed = 0;
    const depths = { sky: 0, skyline: 10, ground: 20, surface: 30, prop: 40 };
    this.objects = this.location.objects.flatMap(({ asset, x, y, state, instance }) => {
      const image = this.add.image(x, y, asset.id).setDepth(depths[asset.layer]);
      if (asset.layer === "sky" || asset.layer === "ground") image.setOrigin(0, 0);
      else if (asset.layer === "surface") image.setOrigin(0.5, 0.5);
      else image.setOrigin(0.5, 1);
      if (!asset.overlay) return [image];
      const door = this.add.image(x - 31, y - 94, `${asset.id}:overlay`).setOrigin(0, 0).setDepth(42);
      door.setScale(asset.states[state], 1);
      const contents = this.add.graphics().setDepth(41);
      contents.fillStyle(0xf4b38d).fillRoundedRect(x + 8, y - 56, 13, 25, 3);
      contents.fillStyle(0xffd6aa).fillRect(x + 11, y - 59, 7, 4);
      contents.fillStyle(0x5a3949).fillRect(x + 10, y - 50, 9, 3);
      contents.setVisible(this.states.batteryChoice !== "taken");
      this.props.set(instance, { door, contents, asset });
      this.cabinet = instance;
      return [image, contents, door];
    });
    drawHero(this.hero, { clip: "idle", phase: 0, x: entryX, y: floorY });
    clipSelect.value = this.generated.clip;
    this.present(this.generated.story.aim);
  }

  currentCabinetState() {
    if (!this.cabinet) return "unknown";
    return this.states[this.cabinet] ?? this.props.get(this.cabinet).asset.defaultState;
  }

  present(message) {
    const state = this.currentCabinetState();
    const playing = Boolean(this.sequence);
    const choosing = !playing && state === "open" && !["taken", "left"].includes(this.states.batteryChoice);
    if (!playing && !choosing && this.states.batteryChoice === "taken") message += " · Battery picked up";
    if (!playing && !choosing && this.states.batteryChoice === "left") message += " · Battery stayed here";
    if (this.notice) message += ` · ${this.notice}`;
    status.textContent = `${message} · Cabinet: ${state}`;
    interact.textContent = state === "open" ? "Close cabinet" : "Open cabinet";
    for (const control of [interact, perform, clipSelect, locationSelect]) control.disabled = playing || choosing;
    take.hidden = leave.hidden = !choosing;
    take.disabled = leave.disabled = !choosing;
  }

  chooseBattery(choice) {
    if (this.sequence || this.currentCabinetState() !== "open" || ["taken", "left"].includes(this.states.batteryChoice)) return;
    this.states = { ...this.states, batteryChoice: choice };
    this.props.get(this.cabinet).contents.setVisible(choice !== "taken");
    this.stateByLocation[this.location.id] = this.states;
    sessionStorage.setItem(storageKey, JSON.stringify(this.stateByLocation));
    this.present("Choice made");
  }

  startInteraction() {
    const action = this.currentCabinetState() === "open" ? "close" : "open";
    const clip = this.generated.clip;
    this.sequence = compileAction(this.location, this.states, { clip, instance: this.cabinet, action }, this.heroX);
    this.elapsed = 0;
    this.present("Playing interaction…");
  }

  startClip(clip) {
    const direction = this.heroX > 480 ? -1 : 1;
    this.sequence = clips[clip].mode === "ground"
      ? { clip, start: 250, complete: 1750, x: this.heroX + direction * 1.5 * clips[clip].speed }
      : compileSolo(clip);
    this.elapsed = 0;
    this.present(`Playing ${clip}…`);
  }

  update(_time, delta) {
    if (!this.sequence) return;
    const sequence = this.sequence;
    const { clip, start, complete, transition } = sequence;
    this.elapsed = Math.min(this.elapsed + delta, complete + 300);
    const t = this.elapsed;
    const duration = (sequence.arrive ?? complete) - start;
    const progress = Phaser.Math.Clamp((t - start) / duration, 0, 1);
    const moving = progress > 0 && progress < 1;
    const x = Phaser.Math.Linear(this.heroX, sequence.x ?? this.heroX, progress);
    const y = Phaser.Math.Linear(this.heroY, sequence.y ?? this.heroY, progress);
    const phase = clips[clip].mode === "ground"
      ? (t - start) / clips[clip].cycle * Math.PI * 2
      : progress;
    const hand = transition && t >= sequence.arrive
      ? [Phaser.Math.Linear(x + 20, sequence.handle[0], Phaser.Math.Clamp((t - sequence.arrive) / (sequence.contact - sequence.arrive), 0, 1)),
        Phaser.Math.Linear(y - 21, sequence.handle[1], Phaser.Math.Clamp((t - sequence.arrive) / (sequence.contact - sequence.arrive), 0, 1))]
      : undefined;
    drawHero(this.hero, { clip: moving || clip === "die" ? clip : "idle", phase, x, y, hand });

    if (transition && t >= sequence.contact) {
      const { door, asset } = this.props.get(sequence.instance);
      const step = Phaser.Math.Clamp((t - sequence.contact) / transition.ms, 0, 1);
      door.setScale(Phaser.Math.Linear(asset.states[transition.from], asset.states[transition.to], step), 1);
    }

    if (t >= complete + 300) {
      this.states = commitActions(this.states, sequence, t);
      this.stateByLocation[this.location.id] = this.states;
      sessionStorage.setItem(storageKey, JSON.stringify(this.stateByLocation));
      this.sequence = null;
      this.heroX = x;
      this.heroY = y;
      this.present(transition?.to === "open" ? "Radio battery revealed" : "Finished");
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO, width: 960, height: 540, parent: "stage",
  backgroundColor: "#111322", scene: AssetLab, fps: { target: 60 },
});
