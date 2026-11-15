import { clips } from "/stickman/animations.js?v=16";
import { createFigure, skeletonFor } from "/stickman/render.js";
import { blendPose, resolvePose, smoothstep } from "/stickman/rig.js?v=12";
import { skins } from "/stickman/skins.js";
import { commandEnd, compileObjectTimeline, objectContact, objectTransform, reachTime } from "./object-timeline.mjs";
import { cameraFrame, pixelsPerUnit, positionAt } from "./panorama.mjs";
import { SceneSound } from "./sound-engine.mjs";
import { compileDialogue, makeDialogueDemo } from "./dialogue.mjs";

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
let figure = createFigure(skin);
let metrics = skeletonFor(skin);
let scene;
let frameId;
let playbackDuration;
let requestActive = false;
let master;
let objectTimeline;
let dialogueTrack = compileDialogue();
const companions = new Map();
const dialogueDemo = document.querySelector("#dialogue-demo");
const zoom = document.querySelector("#zoom");
const sound = new SceneSound();
let playbackRequest = 0;
let startingPlayback = false;
const objectNodes = new Map();

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
const figureScale = 142.2 / 180;

function actorPose(time, x, walking, interaction, poses) {
  const clip = walking ? clips.walk : clips.idle;
  const idle = resolvePose(clip.pose((time / clip.duration) % 1, metrics), metrics);
  if (!interaction) return idle;
  const { object } = objectNodes.get(interaction.target);
  const motion = poses.get(object.id);
  const elapsed = time - interaction.at;
  const reach = smoothstep(elapsed / reachTime);
  const release = smoothstep((commandEnd(interaction) - time) / 0.35);
  const pose = resolvePose(clips.reach.pose(Math.min(1, elapsed / clips.reach.duration), metrics), metrics);
  const grasp = blendPose(idle, pose, reach * release);
  const contact = objectContact(object, motion);
  const ratio = pixelsPerUnit / figureScale;
  grasp.handR = {
    x: (contact.x - x) * object.side * ratio - metrics.handRadius,
    y: (contact.y - scene.staging.groundY) * ratio,
  };
  // The hand releases as the moving handle leaves the actor's reach.
  grasp.handWeightR = reach * release * (1 - smoothstep((Math.hypot(
    grasp.handR.x - metrics.shoulderHalf, grasp.handR.y + metrics.hipHeight + metrics.torsoLength * 0.88,
  ) - metrics.armLength * 0.8) / (metrics.armLength * 0.35)));
  return grasp;
}

function showFrame(time) {
  sound.update(time);
  const { x, walking, facing } = positionAt(scene.staging.route, time);
  const ground = scene.staging.groundY * pixelsPerUnit;
  const dialogue = dialogueTrack.frame(time);
  const frame = cameraFrame(scene.width / pixelsPerUnit, x, scene.staging.groundY, {
    zoom: Number(zoom.value), focusXs: dialogue.active ? dialogueTrack.actors.slice(1).map(({ x }) => x) : [],
  });
  stage.setAttribute("viewBox", [frame.x, frame.y, frame.width, frame.height].map(value => (value * pixelsPerUnit).toFixed(2)).join(" "));
  actor.setAttribute("transform", `translate(${x * pixelsPerUnit} ${ground})`);
  figure.svg.setAttribute("x", "-71.1");
  figure.svg.setAttribute("y", "-154.84");
  const { poses, interaction } = objectTimeline.frame(time);
  for (const [id, pose] of poses) {
    const { opacity, state } = pose;
    const { group, moving, object } = objectNodes.get(id);
    group.dataset.state = state;
    moving.setAttribute("opacity", opacity);
    moving.setAttribute("transform", objectTransform(object, pose));
  }
  actor.dataset.interaction = interaction?.target ?? "";
  const partner = dialogueTrack.actors.find(({ id }) => id !== dialogueTrack.primaryId);
  const side = interaction ? objectNodes.get(interaction.target).object.side
    : dialogue.active && !walking && partner ? Math.sign(partner.x - x) || facing : facing;
  const speaking = dialogue.line?.speaker === dialogueTrack.primaryId;
  const talkWeight = dialogue.line ? smoothstep(Math.min(
    (time - dialogue.line.at) / 0.22, (dialogue.line.at + dialogue.line.duration - time) / 0.22,
  )) : 0;
  const basePose = actorPose(time, x, walking, interaction, poses);
  const mainPose = speaking && !walking && !interaction
    ? blendPose(basePose, resolvePose(clips.talk.pose((time / clips.talk.duration) % 1, metrics), metrics), talkWeight)
    : basePose;
  figure.update(mainPose, time, { facing: side });
  actor.dataset.speaking = String(speaking);
  for (const [id, companion] of companions) {
    const talking = dialogue.line?.speaker === id;
    const idle = resolvePose(clips.idle.pose((time / clips.idle.duration) % 1, companion.metrics), companion.metrics);
    const pose = talking ? blendPose(idle,
      resolvePose(clips.talk.pose((time / clips.talk.duration) % 1, companion.metrics), companion.metrics), talkWeight) : idle;
    companion.figure.update(pose, time, { facing: Math.sign(x - companion.actor.x) || -side });
    companion.group.dataset.speaking = String(talking);
  }
  const speech = document.querySelector("#dialogue-line");
  if (speech.hidden !== !dialogue.line) speech.hidden = !dialogue.line;
  const speakerLabel = document.querySelector("#speaker");
  const words = document.querySelector("#spoken-text");
  if (speakerLabel.textContent !== (dialogue.speaker?.name ?? "")) speakerLabel.textContent = dialogue.speaker?.name ?? "";
  if (words.textContent !== (dialogue.line?.text ?? "")) words.textContent = dialogue.line?.text ?? "";
  document.querySelector("#speech-progress").value = dialogue.progress;
  for (const button of document.querySelectorAll("#dialogue-transcript button")) {
    button.setAttribute("aria-current", String(dialogue.line?.at === Number(button.dataset.at)));
  }

  timeline.value = String(time);
  timeDisplay.value = `${time.toFixed(1)} с`;
  const event = scene.beats?.findLast(({ at }) => at <= time);
  const line = event?.screen ?? scene.beat?.screen ?? "";
  if (caption.textContent !== line) caption.textContent = line;
  caption.hidden = !line;
}

function pause() {
  playbackRequest++;
  startingPlayback = false;
  sound.stop();
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

function renderObject(object, index, foreground) {
  const group = svgElement("g", { "data-object": object.id, "aria-label": object.label });
  const plane = svgElement("svg", {
    width: scene.width, height: scene.height,
    viewBox: `0 0 ${scene.width / pixelsPerUnit} ${scene.height / pixelsPerUnit}`,
  });
  const moving = svgElement("g", { "data-moving": "" });
  const wrapper = svgElement("g", {});
  const fixed = parser.parseFromString(object.fixedSvg, "image/svg+xml").documentElement;
  if (object.opening) {
    const id = `opening-${index}`;
    const frameClipId = `frame-edge-${index}`;
    const clip = svgElement("clipPath", { id });
    clip.append(svgElement("rect", object.opening));
    const { x, y, width, height } = object.opening;
    const frameClip = svgElement("clipPath", { id: frameClipId });
    frameClip.append(svgElement("path", {
      d: `M0 0H${scene.width / pixelsPerUnit}V${scene.height / pixelsPerUnit}H0Z M${x} ${y}h${width}v${height}h${-width}Z`,
      "clip-rule": "evenodd",
    }));
    plane.append(clip, frameClip, svgElement("rect", { ...object.opening, fill: object.recessColor ?? "#1a2230" }));
    fixed.setAttribute("clip-path", `url(#${frameClipId})`);
    wrapper.setAttribute("clip-path", `url(#${id})`);
  }
  moving.append(parser.parseFromString(object.movingSvg, "image/svg+xml").documentElement);
  wrapper.append(moving);
  plane.append(fixed, wrapper);
  group.append(plane);
  stage.insertBefore(group, foreground);
  objectNodes.set(object.id, { object, group, moving });
  addLayerToggle(object.label, group);
}

function render(next) {
  pause();
  scene = next;
  dialogueTrack = compileDialogue(scene.dialogue);
  const primarySkin = skins.find(({ id }) => id === dialogueTrack.actors[0]?.skin) ?? skin;
  figure = createFigure(primarySkin);
  metrics = skeletonFor(primarySkin);
  figure.svg.setAttribute("width", "142.2");
  figure.svg.setAttribute("height", "162.74");
  actor.replaceChildren(shadow, figure.svg);
  if (dialogueTrack.actors.length) actor.append(actorLabel(dialogueTrack.actors[0].name));
  companions.clear();
  stage.setAttribute("aria-label", scene.title);
  stage.replaceChildren();
  layers.replaceChildren();
  objectNodes.clear();
  objectTimeline = compileObjectTimeline(scene.objects, scene.commands);
  for (const { name, role, x, y, width, height, svg } of scene.layers) {
    const group = svgElement("g", { "data-layer": role });
    const image = parser.parseFromString(svg, "image/svg+xml").documentElement;
    for (const [attr, value] of Object.entries({ x, y, width, height })) image.setAttribute(attr, value);
    group.append(image);
    stage.append(group);

    addLayerToggle(name, group);
  }
  const foreground = stage.querySelector('[data-layer="foreground"]');
  scene.objects?.forEach((object, index) => renderObject(object, index, foreground));
  stage.insertBefore(actor, foreground);
  for (const participant of dialogueTrack.actors.slice(1)) {
    const selected = skins.find(({ id }) => id === participant.skin) ?? skins.find(({ id }) => id === "morgan");
    const partnerFigure = createFigure(selected);
    partnerFigure.svg.setAttribute("width", "142.2");
    partnerFigure.svg.setAttribute("height", "162.74");
    partnerFigure.svg.setAttribute("x", "-71.1");
    partnerFigure.svg.setAttribute("y", "-154.84");
    const group = svgElement("g", { "data-preview-actor": participant.id, "aria-label": participant.name,
      transform: `translate(${participant.x * pixelsPerUnit} ${scene.staging.groundY * pixelsPerUnit})` });
    group.append(shadow.cloneNode(), partnerFigure.svg, actorLabel(participant.name));
    stage.insertBefore(group, foreground);
    companions.set(participant.id, { actor: participant, group, figure: partnerFigure, metrics: skeletonFor(selected) });
  }
  renderTranscript();
  playbackDuration = Math.max(
    dialogueTrack.duration, scene.staging.route.at(-1).arrivalAt, scene.beats?.at(-1)?.at ?? 0, ...(scene.commands ?? []).map(commandEnd),
  ) + 1.5;
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
  document.querySelector("#sound-controls").hidden = false;
  document.querySelector("#sound-description").textContent = scene.sound
    ? `Звуковой фон: ${scene.sound.ambience} · Шаги: ${scene.sound.surface}` : "Звук: автоматический фон и шаги";
}

play.addEventListener("click", async () => {
  if (frameId !== undefined || startingPlayback) return pause();
  startingPlayback = true;
  const request = ++playbackRequest;
  const offset = Number(timeline.value) >= playbackDuration ? 0 : Number(timeline.value);
  try {
    await sound.unlock();
    document.querySelector("#sound-status").textContent = "";
  } catch (error) {
    document.querySelector("#sound-status").textContent = `${error.message} Просмотр без звука.`;
  }
  if (request !== playbackRequest) return;
  startingPlayback = false;
  sound.start(scene, offset, playbackDuration, clips.walk.duration / 2);
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

document.querySelector("#mute").addEventListener("click", event => {
  sound.setMuted(!sound.muted);
  event.currentTarget.setAttribute("aria-pressed", String(sound.muted));
  event.currentTarget.textContent = sound.muted ? "Включить звук" : "Выключить звук";
});
document.querySelector("#volume").addEventListener("input", event => sound.setVolume(event.target.value));
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
window.addEventListener("pagehide", () => pause());

timeline.addEventListener("input", () => {
  pause();
  showFrame(Number(timeline.value));
});

async function generate(getInput) {
  if (requestActive) return;
  requestActive = true;
  pause();
  const width = Number(screens.value);
  submit.disabled = true;
  example.disabled = true;
  dialogueDemo.disabled = true;
  status.textContent = "Модель планирует маршрут, рисует панораму, добавляет детали и звук…";
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
    dialogueDemo.disabled = false;
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


function actorLabel(name) {
  const group = svgElement("g", { "data-actor-label": "" });
  const dot = svgElement("circle", { cx: 0, cy: -181, r: 5, fill: "#a2e2d0" });
  const label = svgElement("text", { x: 0, y: -196, "text-anchor": "middle", "font-size": 17,
    "font-family": "system-ui, sans-serif", "font-weight": 650, fill: "#fff", stroke: "#16211e", "stroke-width": 4,
    "paint-order": "stroke" });
  label.textContent = name;
  group.append(dot, label);
  return group;
}

function renderTranscript() {
  const transcript = document.querySelector("#dialogue-transcript");
  transcript.replaceChildren();
  document.querySelector("#dialogue-controls").hidden = !scene.dialogue;
  for (const line of [...(scene.dialogue?.lines ?? [])].sort((a, b) => a.at - b.at)) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.at = String(line.at);
    const speaker = dialogueTrack.actors.find(({ id }) => id === line.speaker);
    const name = document.createElement("strong");
    name.textContent = speaker.name;
    const text = document.createElement("span");
    text.textContent = line.text;
    button.append(name, text);
    button.addEventListener("click", () => { pause(); showFrame(line.at); });
    transcript.append(button);
  }
}

zoom.addEventListener("input", () => {
  document.querySelector("#zoom-value").value = `${Number(zoom.value).toFixed(1)}×`;
  if (scene) showFrame(Number(timeline.value));
});
dialogueDemo.addEventListener("click", async () => {
  if (requestActive) return;
  dialogueDemo.disabled = true;
  try {
    let base = scene;
    if (!base) {
      status.textContent = "Открываю сцену с двумя персонажами…";
      const response = await fetch("/api/dialogue-example");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось открыть пример диалога.");
      base = result.scene;
    }
    render({ ...base, dialogue: makeDialogueDemo(base) });
    const firstLine = scene.dialogue.lines[0].at;
    showFrame(Math.max(0, firstLine - 0.5));
    status.textContent = "Мара и лесник. Нажмите «Пройти сцену» или выберите реплику ниже.";
  } catch (error) { status.textContent = error.message; }
  finally { dialogueDemo.disabled = false; }
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
  drawing.querySelectorAll("[data-preview-actor]").forEach(node => node.remove());
  drawing.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
  drawing.setAttribute("width", scene.width);
  drawing.setAttribute("height", scene.height);
  download(new XMLSerializer().serializeToString(drawing), "image/svg+xml", "storyfork-panorama.svg");
});
document.querySelector("#download").addEventListener("click", () => {
  download(JSON.stringify(scene, null, 2), "application/json", "storyfork-generated-scene.json");
});
