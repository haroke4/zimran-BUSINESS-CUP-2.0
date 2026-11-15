import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { sceneCases } from "../actual_implementation/cases.mjs";
import { createSceneModel, SceneModelError } from "./model-router.mjs";
import { ObjectScriptError } from "./object-staging.mjs";
import { isResolvedTravel } from "./panorama.mjs";
import { generateScene } from "./scene.mjs";
import { validateDialogue } from "./dialogue.mjs";

const model = createSceneModel();
const port = Number(process.env.NO_ASSET_PORT ?? 8790);
const files = new Map([
  ["/", ["index.html", "text/html"]],
  ["/preview.mjs", ["preview.mjs", "text/javascript"]],
  ["/panorama.mjs", ["panorama.mjs", "text/javascript"]],
  ["/dialogue.mjs", ["dialogue.mjs", "text/javascript"]],
  ["/object-timeline.mjs", ["object-timeline.mjs", "text/javascript"]],
  ["/sound-engine.mjs", ["sound-engine.mjs", "text/javascript"]],
  ["/sound-plan.mjs", ["sound-plan.mjs", "text/javascript"]],
  ["/style.css", ["style.css", "text/css"]],
]);
for (const file of ["animations.js", "render.js", "rig.js", "skins.js"]) {
  files.set(`/stickman/${file}`, [`../assets/stickman/${file}`, "text/javascript"]);
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function isBeat(beat) {
  return typeof beat?.cue === "string" && beat.cue.trim().length > 0 && beat.cue.trim().length <= 100
    && typeof beat.screen === "string" && beat.screen.trim().length > 0 && beat.screen.trim().length <= 600;
}

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (request.method === "GET" && files.has(path)) {
    const [file, type] = files.get(path);
    response.setHeader("Content-Type", `${type}; charset=utf-8`);
    response.end(await readFile(new URL(file, import.meta.url)));
    return;
  }
  if (request.method === "GET" && path === "/api/example") {
    const file = await readFile(new URL("../actual_implementation/results/scene-v4.json", import.meta.url), "utf8");
    const example = JSON.parse(file).results.find(({ fixture }) => fixture === "long_corridor");
    const { location, facts } = sceneCases.long_corridor;
    const beats = example.scene.beats.map(({ at, cue, screen }) => ({ at, cue, screen }));
    const blackoutAt = beats.find(({ cue }) => cue === "window_blackout").at;
    return json(response, 200, {
      brief: `${location} ${facts} Ночная смена, сине-серый металл и тёплые аварийные лампы над влажным полом. Лампа у смотрового окна мерцает и гаснет. В этой ветке Мара поднимает решётку.`,
      travel: example.travel,
      beats: [...beats, { at: 27, cue: "lift_gate", screen: "Мара берётся за ручку и поднимает решётку." }],
      objectScript: {
        objects: [
          { id: "window_light", kind: "light", label: "Лампа у окна", anchor: "window", initial: "on" },
          { id: "gate", kind: "gate", label: "Решётка", anchor: "gate", initial: "closed" },
        ],
        commands: [
          { op: "loop", target: "window_light", state: "off", at: 4.5, duration: 0.13, period: 1.1 },
          { op: "change", target: "window_light", state: "off", at: blackoutAt, duration: 0.2 },
          { op: "interact", target: "gate", state: "open", at: 27, duration: 1 },
        ],
      },
    });
  }
  if (request.method === "GET" && path === "/api/dialogue-example") {
    const scene = JSON.parse(await readFile(new URL("./fixtures/dialogue-scene.json", import.meta.url), "utf8"));
    return json(response, 200, { scene });
  }
  if (request.method !== "POST" || path !== "/api/scenes") {
    return json(response, 404, { error: "Страница не найдена." });
  }
  if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
    return json(response, 415, { error: "Ожидается application/json." });
  }

  const chunks = [];
  let size = 0;
  let input;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 16_384) return json(response, 413, { error: "Запрос слишком большой." });
      chunks.push(chunk);
    }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json(response, 400, { error: "Не удалось прочитать запрос." });
  }
  const brief = input?.brief;
  const { beat, travel, beats, objectScript, dialogue } = input ?? {};
  const screens = input?.screens ?? 1;
  if (typeof brief !== "string" || !brief.trim() || brief.trim().length > 1200) {
    return json(response, 400, { error: "Опишите сцену в пределах 1200 символов." });
  }
  if (beat !== undefined && !isBeat(beat)) {
    return json(response, 400, { error: "Для события нужны короткий cue и описание screen." });
  }
  if (!Number.isInteger(screens) || screens < 1 || screens > 8) {
    return json(response, 400, { error: "Укажите ширину от 1 до 8 экранов." });
  }
  if (dialogue !== undefined) {
    try { validateDialogue(dialogue, { worldWidth: screens * 160 }); }
    catch (error) { return json(response, 400, { error: error.message }); }
  }
  if (travel !== undefined && !isResolvedTravel(travel)) {
    return json(response, 400, { error: "Маршрут должен быть непрерывным, с точками и временем каждого перехода." });
  }
  if (beats !== undefined && (!Array.isArray(beats) || beats.length > 12 || !beats.every((event, index) => (
    isBeat(event) && Number.isFinite(event.at) && event.at >= 0 && event.at <= 180
    && (index === 0 || beats[index - 1].at < event.at)
  )))) {
    return json(response, 400, { error: "События должны идти по времени и содержать at, cue и screen." });
  }
  if (objectScript !== undefined && (!objectScript || typeof objectScript !== "object" || Array.isArray(objectScript))) {
    return json(response, 400, { error: "Передайте объекты и команды в objectScript." });
  }

  if (!model.available.length) {
    return json(response, 503, { error: "Проверьте ключи и список моделей в test_no_asset/.env. Для OpenRouter укажите модели с суффиксом :free." });
  }
  try {
    const storyBeat = beat && { cue: beat.cue.trim(), screen: beat.screen.trim() };
    const route = travel?.map(({ cue, from, to, departureAt, arrivalAt }) => ({ cue, from, to, departureAt, arrivalAt }));
    const events = beats?.map(({ at, cue, screen }) => ({ at, cue, screen }));
    const scene = await generateScene(model, brief.trim(), storyBeat, { screens, travel: route, beats: events, objectScript });
    if (dialogue !== undefined) scene.dialogue = dialogue;
    json(response, 200, { scene });
  } catch (error) {
    if (error instanceof ObjectScriptError) {
      return json(response, 400, { error: error.message });
    }
    if (error instanceof SceneModelError && error.status === 429) {
      const seconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
      response.setHeader("Retry-After", String(seconds));
      return json(response, 429, { error: `Исчерпаны лимиты доступных моделей. Повторите через ${seconds} с.` });
    }
    console.error(error.message);
    json(response, 502, { error: "Подключённые модели не смогли собрать этот этап сцены. Попробуйте ещё раз." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`StoryFork без каталога · http://127.0.0.1:${port}/`);
  console.log(model.available.join(" → "));
});
