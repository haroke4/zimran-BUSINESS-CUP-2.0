import "./style.css";
import sample from "./sample.json";

const presets = {
  mall: "Ночной фудкорт эвакуированного торгового центра. На переднем плане разбитый торговый автомат. На заднем плане столики и опрокинутые стулья, аварийный свет.",
  ship: "Открытая палуба грузового судна ночью в шторм. На переднем плане сигнальная лампа. Вокруг контейнеры, дождь и бушующее море.",
  custom: "Каюта капитана со старинным хрустальным компасом в футляре на переднем плане. Тёплая лампа, деревянный пол, стол и штурвал на стене.",
};
const select = (selector) => document.querySelector(selector);
const stage = select("#stage");
const brief = select("#brief");
const status = select("#status");
let scene;

function svg(tag, attrs) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  return element;
}

function drawLayer(layer, defs) {
  const { x, y, w, h, image, slot, opacity, size, anchor, fit } = layer;
  const href = `/api/storyfork/art/${image}`;
  if (fit === "tile") {
    const id = `storyfork-${slot}`;
    const tileWidth = slot === "floor" ? 384 : 512;
    const tileHeight = tileWidth * size[1] / size[0];
    const pattern = svg("pattern", { id, x, y, width: tileWidth, height: tileHeight, patternUnits: "userSpaceOnUse" });
    pattern.append(svg("image", { href, width: tileWidth, height: tileHeight }));
    defs.append(pattern);
    return svg("rect", { x, y, width: w, height: h, fill: `url(#${id})`, opacity });
  }
  if (fit === "fill") return svg("image", { href, x, y, width: w, height: h, opacity, preserveAspectRatio: "none" });
  const scale = Math.min(w / size[0], h / size[1]);
  return svg("image", {
    href, x: x - anchor[0] * scale, y: y - anchor[1] * scale,
    width: size[0] * scale, height: size[1] * scale, opacity,
  });
}

function shadow(x, y, rx) {
  return svg("ellipse", { cx: x, cy: y, rx, ry: 22, opacity: 0.35, fill: "#090c14" });
}

function drawCustom({ x, y, shape, label }) {
  const group = svg("g", { transform: `translate(${x} ${y})` });
  const colors = { fill: "#324356", stroke: "#101923", "stroke-width": 8 };
  if (shape === "dial") {
    group.append(
      svg("rect", { x: -98, y: -116, width: 196, height: 113, rx: 17, ...colors }),
      svg("ellipse", { cx: 0, cy: -65, rx: 70, ry: 45, fill: "#ddd8c6", stroke: "#936d4a", "stroke-width": 8 }),
      svg("path", { d: "M -48 -40 L 40 -89 L 7 -68 Z", fill: "#b34f49" }),
      svg("path", { d: "M 40 -89 L -48 -40 L -7 -61 Z", fill: "#405c6e" }),
      svg("circle", { cx: 0, cy: -65, r: 6, fill: "#292e39" }),
    );
    return group;
  }
  if (shape === "sign") {
    group.append(svg("rect", { x: -10, y: -185, width: 20, height: 183, ...colors }));
  }
  const tall = shape !== "case";
  const top = tall ? -216 : -112;
  const bodyHeight = shape === "terminal" ? 205 : 102;
  group.append(svg("rect", { x: -117, y: top, width: 234, height: bodyHeight, rx: 12, ...colors }));
  group.append(svg("rect", { x: -100, y: top + 15, width: 200, height: 60, rx: 7, fill: "#192632" }));
  const text = svg("text", {
    x: 0, y: top + 53, "text-anchor": "middle", fill: "#91e6d2",
    "font-size": Math.min(22, 305 / label.length), "font-weight": 700,
  });
  text.textContent = label;
  group.append(text);
  return group;
}

function render(next, { saved = false } = {}) {
  scene = next;
  const defs = svg("defs", {});
  const vignette = svg("radialGradient", { id: "shot-light", cx: "50%", cy: "64%", r: "67%" });
  vignette.append(svg("stop", { offset: "34%", "stop-color": "#0b1122", "stop-opacity": 0 }));
  vignette.append(svg("stop", { offset: "100%", "stop-color": "#070913", "stop-opacity": 0.66 }));
  defs.append(vignette);
  stage.replaceChildren(defs);
  stage.setAttribute("aria-label", next.title);
  for (const layer of scene.layers.filter(({ depth }) => depth < 11)) {
    if (layer.slot === "focus") stage.append(shadow(layer.x, layer.y + 6, 115));
    stage.append(drawLayer(layer, defs));
  }
  if (next.custom) stage.append(shadow(next.custom.x, next.custom.y + 6, 121), drawCustom(next.custom));
  for (const layer of scene.layers.filter(({ depth }) => depth >= 11)) stage.append(drawLayer(layer, defs));
  stage.append(svg("rect", { width: scene.width, height: scene.height, fill: "url(#shot-light)" }));
  select("#title").textContent = next.title;
  select("#caption").textContent = next.caption;
  const { model, directionModel, directionMs, compositionMs, unmatchedFocus, focusQuery, shortlist } = next.diagnostics;
  select("#diagnostics").textContent = [
    saved && "Сохранённый пример",
    directionModel && directionModel !== model ? `${directionModel} → ${model}` : model,
    `${((directionMs + compositionMs) / 1000).toFixed(1)} с`,
    next.custom && "Предмет дорисован по шаблону",
    unmatchedFocus && `Ассет не найден: ${unmatchedFocus}`,
  ].filter(Boolean).join(" · ");
  const details = [
    ...next.layers.map(({ slot, id, state, mode }) => `${slot} · ${id} · ${state} / ${mode}`),
    `Поиск главного объекта · ${focusQuery} → ${shortlist.join(", ") || "пусто"}`,
    ...next.diagnostics.repairs,
  ];
  select("#layers").replaceChildren(...details.map((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
  select("#result").hidden = false;
}

async function generate(event) {
  event.preventDefault();
  const button = select("#generate");
  button.disabled = true;
  status.textContent = "Gemini планирует локацию…";
  try {
    const response = await fetch("/api/storyfork/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify({ brief: brief.value.trim(), allowCustom: select("#custom").checked }),
    });
    if (!response.ok) throw new Error((await response.json()).error?.message ?? "Запрос не прошёл");
    let remaining = "";
    let result;
    for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
      const lines = (remaining + text).split("\n");
      remaining = lines.pop();
      for (const line of lines) {
        const event = JSON.parse(line);
        if (event.error) throw new Error(event.error.message);
        if (event.progress) status.textContent = `Gemini подбирает слои для «${event.progress.title}»…`;
        if (event.scene) result = event.scene;
      }
    }
    if (!result) throw new Error("Сервер не вернул сцену");
    render(result);
    status.textContent = "Сцена готова.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

brief.value = presets.mall;
select("form").addEventListener("submit", generate);
for (const button of document.querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () => { brief.value = presets[button.dataset.preset]; brief.focus(); });
}
select("#download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "storyfork-scene.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
render(sample, { saved: true });
