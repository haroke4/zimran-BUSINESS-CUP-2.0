import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { sceneCases } from "../actual_implementation/cases.mjs";
import { createSceneModel, SceneModelError } from "./model-router.mjs";
import { isResolvedTravel } from "./panorama.mjs";
import { generateScene } from "./scene.mjs";

const model = createSceneModel();
const port = Number(process.env.NO_ASSET_PORT ?? 8794);
const files = new Map([
  ["/", ["index.html", "text/html"]],
  ["/preview.mjs", ["preview.mjs", "text/javascript"]],
  ["/panorama.mjs", ["panorama.mjs", "text/javascript"]],
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
    return json(response, 200, {
      brief: `${location} ${facts} Ночная смена, сине-серый металл и тёплые аварийные лампы над влажным полом.`,
      travel: example.travel,
      beats: example.scene.beats.map(({ at, cue, screen }) => ({ at, cue, screen })),
    });
  }
  if (request.method === "GET" && path === "/api/saved") {
    const scene = JSON.parse(await readFile(new URL("saved-scene.json", import.meta.url), "utf8"));
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
  const { beat, travel, beats } = input ?? {};
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
  if (travel !== undefined && !isResolvedTravel(travel)) {
    return json(response, 400, { error: "Маршрут должен быть непрерывным, с точками и временем каждого перехода." });
  }
  if (beats !== undefined && (!Array.isArray(beats) || beats.length > 12 || !beats.every((event, index) => (
    isBeat(event) && Number.isFinite(event.at) && event.at >= 0 && event.at <= 180
    && (index === 0 || beats[index - 1].at < event.at)
  )))) {
    return json(response, 400, { error: "События должны идти по времени и содержать at, cue и screen." });
  }
  if (!model.available.length) {
    return json(response, 503, { error: "Проверьте ключи NVIDIA NIM, GroqCloud или Gemini в test_no_asset/.env." });
  }
  try {
    const storyBeat = beat && { cue: beat.cue.trim(), screen: beat.screen.trim() };
    const route = travel?.map(({ cue, from, to, departureAt, arrivalAt }) => ({ cue, from, to, departureAt, arrivalAt }));
    const events = beats?.map(({ at, cue, screen }) => ({ at, cue, screen }));
    const scene = await generateScene(model, brief.trim(), storyBeat, { screens, travel: route, beats: events });
    json(response, 200, { scene });
  } catch (error) {
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
  console.log(`StoryFork до анимации объектов · http://127.0.0.1:${port}/`);
  console.log(model.available.join(" → "));
});
