import { clips } from "/stickman/animations.js?v=16";
import { createFigure, skeletonFor } from "/stickman/render.js";
import { resolvePose } from "/stickman/rig.js?v=12";
import { skins } from "/stickman/skins.js";
import { cameraLeft, pixelsPerUnit, positionAt } from "./panorama.mjs";

const form = document.querySelector("form");
const brief = document.querySelector("#brief");
const screens = document.querySelector("#screens");
const example = document.querySelector("#master-example");
const status = document.querySelector("#status");
const stage = document.querySelector("#stage");
const submit = form.querySelector('button[type="submit"]');
const layers = document.querySelector("#layers");
const play = document.querySelector("#play");
const timeline = document.querySelector("#timeline");
const timeDisplay = document.querySelector("#time");
const caption = document.querySelector("#caption");
const parser = new DOMParser();
const svgNamespace = "http://www.w3.org/2000/svg";
const skin = skins.find(({ id }) => id === "kit");
const figure = createFigure(skin);
const metrics = skeletonFor(skin);
let scene;
let frameId;
let playbackDuration;
let requestActive = false;
let master;

function svgElement(name, attributes) {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

const actor = svgElement("g", { "data-preview-actor": "", "aria-hidden": "true" });
const shadow = svgElement("ellipse", { rx: 24, ry: 5, fill: "#000", opacity: 0.25 });
actor.append(shadow, figure.svg);
figure.svg.setAttribute("width", "142.2");
figure.svg.setAttribute("height", "162.74");
function showFrame(time) {
  const { x, walking, facing } = positionAt(scene.staging.route, time);
  const ground = scene.staging.groundY * pixelsPerUnit;
  const left = cameraLeft(scene.width / pixelsPerUnit, x) * pixelsPerUnit;
  const { width, height } = scene.viewport;
  stage.setAttribute("viewBox", `${left.toFixed(2)} 0 ${width} ${height}`);
  actor.setAttribute("transform", `translate(${x * pixelsPerUnit} ${ground})`);
  figure.svg.setAttribute("x", "-71.1");
  figure.svg.setAttribute("y", "-154.84");
  const clip = walking ? clips.walk : clips.idle;
  const pose = resolvePose(clip.pose((time / clip.duration) % 1, metrics), metrics);
  figure.update(pose, time, { facing });

  timeline.value = String(time);
  timeDisplay.value = `${time.toFixed(1)} с`;
  const event = scene.beats?.findLast(({ at }) => at <= time);
  const line = event?.screen ?? scene.beat?.screen ?? "";
  if (caption.textContent !== line) caption.textContent = line;
  caption.hidden = !line;
}

function pause() {
  if (frameId !== undefined) cancelAnimationFrame(frameId);
  frameId = undefined;
  play.textContent = Number(timeline.value) >= playbackDuration ? "Повторить проход" : "Пройти сцену";
}

function addLayerToggle(name, group) {
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = true;
  toggle.addEventListener("change", () => {
    if (toggle.checked) group.removeAttribute("display");
    else group.setAttribute("display", "none");
  });
  const row = document.createElement("label");
  row.append(toggle, name);
  layers.append(row);
}

function render(next) {
  pause();
  scene = next;
  stage.setAttribute("aria-label", scene.title);
  stage.replaceChildren();
  layers.replaceChildren();
  for (const { name, role, x, y, width, height, svg } of scene.layers) {
    const group = svgElement("g", { "data-layer": role });
    const image = parser.parseFromString(svg, "image/svg+xml").documentElement;
    for (const [attr, value] of Object.entries({ x, y, width, height })) image.setAttribute(attr, value);
    group.append(image);
    stage.append(group);

    addLayerToggle(name, group);
  }
  stage.insertBefore(actor, stage.querySelector('[data-layer="foreground"]'));
  playbackDuration = Math.max(scene.staging.route.at(-1).arrivalAt, scene.beats?.at(-1)?.at ?? 0) + 1.5;
  timeline.max = String(playbackDuration);
  showFrame(0);
  play.textContent = "Пройти сцену";
  document.querySelector("#playback").hidden = false;
  document.querySelector("#title").textContent = scene.title;
  const modelInfo = document.querySelector("#model");
  const used = [...new Set(scene.models.map(({ provider, model }) => provider ?? model))];
  modelInfo.textContent = `${scene.width} × ${scene.height} · ${used.join(" → ")} · ${(scene.ms / 1000).toFixed(1)} с`;
  modelInfo.title = scene.models.map(({ stage, model }) => `${stage} — ${model}`).join("\n");
  document.querySelector("#result").hidden = false;
}

play.addEventListener("click", () => {
  if (frameId !== undefined) return pause();
  const offset = Number(timeline.value) >= playbackDuration ? 0 : Number(timeline.value);
  const started = performance.now();
  function tick(now) {
    const elapsed = Math.min(playbackDuration, offset + (now - started) / 1000);
    showFrame(elapsed);
    if (elapsed >= playbackDuration) pause();
    else frameId = requestAnimationFrame(tick);
  }
  play.textContent = "Пауза";
  frameId = requestAnimationFrame(tick);
});

timeline.addEventListener("input", () => {
  pause();
  showFrame(Number(timeline.value));
});

async function generate(getInput) {
  if (requestActive) return;
  requestActive = true;
  const width = Number(screens.value);
  submit.disabled = true;
  example.disabled = true;
  status.textContent = "Модель планирует маршрут, рисует панораму и добавляет детали…";
  try {
    const input = await getInput();
    const response = await fetch("/api/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, screens: width }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    render(result.scene);
    status.textContent = "Сцена готова.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    requestActive = false;
    submit.disabled = false;
    example.disabled = false;
  }
}

brief.addEventListener("input", () => { master = undefined; });
form.addEventListener("submit", event => {
  event.preventDefault();
  return generate(() => master ?? { brief: brief.value });
});
example.addEventListener("click", () => {
  if (!screens.reportValidity()) return;
  return generate(async () => {
    const response = await fetch("/api/example");
    if (!response.ok) throw new Error("Не удалось загрузить пример из сценария.");
    master = await response.json();
    brief.value = master.brief;
    return master;
  });
});

function download(content, type, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

document.querySelector("#download-svg").addEventListener("click", () => {
  const drawing = stage.cloneNode(true);
  drawing.removeAttribute("id");
  drawing.querySelector("[data-preview-actor]")?.remove();
  drawing.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
  drawing.setAttribute("width", scene.width);
  drawing.setAttribute("height", scene.height);
  download(new XMLSerializer().serializeToString(drawing), "image/svg+xml", "storyfork-panorama.svg");
});
document.querySelector("#download").addEventListener("click", () => {
  download(JSON.stringify(scene, null, 2), "application/json", "storyfork-generated-scene.json");
});

if (new URLSearchParams(window.location.search).has("saved")) {
  const responses = await Promise.all([fetch("/api/saved"), fetch("/api/example")]);
  if (responses.every(response => response.ok)) {
    const [{ scene: savedScene }, savedBrief] = await Promise.all(responses.map(response => response.json()));
    master = savedBrief;
    brief.value = savedBrief.brief;
    screens.value = String(savedScene.width / savedScene.viewport.width);
    render(savedScene);
    status.textContent = "Сохранённый проход до анимации объектов.";
  } else {
    status.textContent = "Не удалось загрузить сохранённый проход.";
  }
}
