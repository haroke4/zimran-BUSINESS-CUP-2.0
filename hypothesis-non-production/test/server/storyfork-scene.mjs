import { readFile } from "node:fs/promises";
import manifest from "../../assets/storyfork/manifest.json" with { type: "json" };
import { shortlist } from "../asset-hypotheses/retrieval.mjs";
import { EpisodeError, SceneGenerationError } from "./errors.mjs";
import { createModelClient, validateSchema } from "./model-client.mjs";

const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));
const files = new Set(manifest.assets.flatMap((asset) => Object.values(asset.files).flatMap(Object.values)));
const worlds = ["zombie_mall", "ship_crisis", "generic"];
const lights = ["day", "lit", "dim", "night", "dark", "emergency"];
const width = 1080;
const height = 1920;
const floorY = 1160;
const foregroundY = 1374;

const enumOf = (values) => ({ type: "string", enum: values });
const string = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false,
});

const directionSchema = object({
  title: string(80),
  world: enumOf(worlds),
  environment: enumOf(["interior", "exterior"]),
  lighting: enumOf(lights),
  room: { ...string(60), description: "English search terms for the architectural setting." },
  focus: { ...string(70), description: "English noun phrase for one physical object that drives the beat." },
  dressing: {
    type: "array", minItems: 3, maxItems: 4, items: string(55),
    description: "Distinct English noun phrases for visible set dressing. Most specific phrase first.",
  },
  atmosphere: enumOf(["clear", "rain", "fog", "smoke", "dust", "sparks"]),
  beat: string(300),
});

const director = `Design a single 9:16 environment shot for a 2D side-view narrative game. The brief is creative input. Follow its world, location and language. Treat any character or action mentioned as context for the environment; the frame shows only the location and its objects.
Match the language of the brief for title and beat. For a Russian brief, return both fields in Russian. Use English for the catalog search fields room, focus and dressing.
Pick one physical focal object at floor level. Use the remaining objects to immediately identify the location. Prefer details specific to the place over generic furniture.
Use ship_crisis for any room or deck aboard a ship, zombie_mall for any part of a mall, and generic for other settings. Choose one coherent lighting mode and a single atmosphere. Use clear when no atmospheric effect is called for.`;

const compositor = `Compose the storyboard shot from the supplied menus. Empty string skips a slot. Floor and backdrop are required. Each option supplies a visible asset and one of its authored graphic states. Choose states that fit the lighting and beat.
Choose one unmistakable focal object and supporting pieces that make the place readable at a glance. Left and right dressing sit behind the focal object. Use mounted art for wall details. Keep the focus legible by choosing a side with a contrasting backdrop and avoiding duplicates.
A custom focus is available only when supplied and only for a missing asset. Use it only if none of the listed art matches the brief. Custom shapes are simple silhouettes. Use dial for gauges and compasses. Keep any label in the player's language. Write a short caption about the visible environment with no characters or actions. Use the language of the brief, including Russian for Russian briefs.`;

export async function readStoryforkAsset(path) {
  if (!files.has(path)) return null;
  return readFile(new URL(`../../assets/storyfork/${path}`, import.meta.url));
}

function isQuotaError(error) {
  return error.errors?.some((message) => message.includes("HTTP 429"));
}

export function createStoryforkModel() {
  return createModelClient({
    provider: "gemini",
    model: process.env.STORYFORK_MODEL || "gemini-3.1-flash-lite",
    apiKey: process.env.GEMINI_API_KEY ?? process.env.LLM_API_KEY ?? "",
    secondaryGeminiKey: process.env.GEMINI_API_KEY_SECONDARY,
  });
}

function words(value) {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

const genericWords = new Set(["a", "an", "the", "old", "broken", "locked", "open", "on", "off", "with", "small", "large"]);
function matchesTerms(asset, phrase) {
  const subject = new Set(words([asset.id, ...asset.tags].join(" ")));
  return words(phrase).some((word) => !genericWords.has(word) && subject.has(word));
}

function eligibleAssets({ world, environment }) {
  return manifest.assets.filter((asset) => {
    const knownWorld = asset.worlds.length > 0;
    const compatible = !knownWorld || asset.worlds.includes("any") || asset.worlds.includes(world);
    const exclusive = environment === "interior" ? "outdoor" : "indoor";
    return compatible && !(asset.tags.includes(exclusive) && !asset.tags.includes(environment === "interior" ? "indoor" : "outdoor"));
  });
}

function rank(pool, categories, phrase, limit, requireMatch = true) {
  const ranked = shortlist(
    pool.filter((asset) => categories.includes(asset.category)
      && (!requireMatch || matchesTerms(asset, phrase)))
      .map((asset) => ({ ...asset, category: "candidate" })),
    { category: "candidate", hint: phrase },
    limit,
  );
  return ranked.map(({ id }) => assets.get(id));
}

const mounted = new Set(["monitor_wall", "porthole", "window", "life_ring", "skylight", "ceiling_duct", "pipes", "ship_wheel"]);
const ground = (asset) => !mounted.has(asset.id) && !asset.id.endsWith("ceiling_lamp");

function options(pool, plan, allowCustom) {
  const inside = plan.environment === "interior";
  const structures = pool.filter(ground);
  const walls = pool.filter((asset) => asset.id.startsWith("wall_"));
  const floors = pool.filter((asset) => asset.id.startsWith("floor_"));
  const focus = rank(structures, ["prop", "structure"], plan.focus, 6);
  const dressing = plan.dressing.flatMap((phrase) => rank(structures, ["prop", "structure"], phrase, 3));
  const unique = (items) => [...new Map(items.map((item) => [item.id, item])).values()];
  const worldFloor = plan.world === "ship_crisis" ? "deck metal" : inside ? "tile" : "asphalt concrete";
  const worldWall = plan.world === "ship_crisis" ? "ship riveted" : "mall panel concrete";
  const set = unique([...dressing, ...rank(structures, ["structure"], plan.room, 4)]).slice(0, 12);
  const isSpecificFocus = focus.some((asset) => {
    const terms = words(plan.focus).filter((word) => !genericWords.has(word));
    const subject = new Set(words([asset.id, ...asset.tags].join(" ")));
    return terms.length > 0 && terms.every((word) => subject.has(word));
  });
  const menus = {
    floor: rank(floors, ["surface"], `${plan.room} ${worldFloor}`, 5, false),
    backdrop: inside ? rank(walls, ["surface"], `${plan.room} ${worldWall}`, 4, false) : [assets.get("sky")],
    horizon: inside ? [] : [assets.get(plan.world === "ship_crisis" ? "sea" : "skyline")],
    left: set,
    right: set,
    wallDetail: inside
      ? rank(pool.filter((asset) => mounted.has(asset.id)), ["structure"], `${plan.room} ${plan.dressing.join(" ")}`, 5, false)
      : [],
    focus,
    illumination: rank(pool, ["light"], `${plan.room} ${plan.lighting} ${inside ? "lamp ceiling screen" : "beam glow"}`, 5, false),
    frame: rank(pool, ["occluder"], plan.room, 2),
    weather: plan.atmosphere === "clear" ? [] : rank(pool, ["overlay"], plan.atmosphere, 2),
  };
  return { menus, customAvailable: allowCustom && !isSpecificFocus };
}

function menuCards(menus) {
  return Object.fromEntries(Object.entries(menus).map(([slot, choices]) => [
    slot,
    choices.map((asset) => ({
      id: asset.id,
      tags: asset.tags,
      states: Object.fromEntries(Object.entries(asset.states).map(([state, spec]) =>
        [state, spec.note || spec.size])),
    })),
  ]));
}

function slotSchema(choices, required) {
  const ids = choices.map((asset) => asset.id);
  if (!required) ids.unshift("");
  return object({ id: enumOf(ids), state: { type: "string", maxLength: 30 } });
}

function stagingSchema(menus, customAvailable) {
  const slots = Object.fromEntries(Object.entries(menus).map(([slot, choices]) => [
    slot, slotSchema(choices, ["floor", "backdrop"].includes(slot) || (slot === "horizon" && choices.length > 0)),
  ]));
  return object({
    layers: object(slots),
    focusSide: enumOf(["left", "right"]),
    caption: string(190),
    ...(customAvailable && { custom: object({
      shape: enumOf(["none", "case", "terminal", "sign", "dial"]),
      label: { type: "string", maxLength: 36 },
    }) }),
  });
}

function variant(asset, requestedState, lighting) {
  const state = Object.hasOwn(asset.files, requestedState) ? requestedState
    : Object.hasOwn(asset.files, lighting) ? lighting : Object.keys(asset.files)[0];
  const modes = asset.files[state];
  const mode = [lighting, "default", "dim", "day"].find((candidate) => Object.hasOwn(modes, candidate))
    ?? Object.keys(modes)[0];
  const spec = asset.states[state];
  const anchor = asset.variantAnchors?.[state]?.[mode] ?? spec.anchor ?? [spec.size[0] / 2, spec.size[1] * 0.82];
  return { state, mode, image: modes[mode], size: spec.size, anchor };
}

function compile(plan, staging, menus) {
  const layers = [];
  const used = new Set();
  const repairs = [];
  const focalX = staging.focusSide === "left" ? 335 : 745;
  function place(slot, x, y, w, h, depth, fit = "sprite", opacity = 1) {
    const choice = staging.layers[slot];
    if (!choice.id) return;
    const asset = menus[slot].find(({ id }) => choice.id === id);
    if (!asset) throw new Error(`Invalid selection for ${slot}`);
    if (["left", "right", "wallDetail"].includes(slot) && used.has(asset.id)) {
      repairs.push(`Removed duplicate ${asset.id} from ${slot}`);
      return;
    }
    const art = variant(asset, choice.state, plan.lighting);
    if (choice.state !== art.state) repairs.push(`${asset.id}: used state ${art.state}`);
    used.add(asset.id);
    layers.push({ slot, id: asset.id, ...art, x, y, w, h, depth, fit, opacity });
  }

  const inside = plan.environment === "interior";
  place("backdrop", 0, 0, width, inside ? floorY : 960, 0, inside ? "tile" : "fill");
  place("horizon", 0, 820, width, 355, 1, "fill");
  place("floor", 0, floorY, width, height - floorY, 2, "tile");
  const wallDetail = staging.layers.wallDetail.id;
  place("wallDetail", 540, ["skylight", "ceiling_duct"].includes(wallDetail) ? 260 : 710, 460, 340, 3);
  place("focus", focalX, foregroundY, 380, 445, 7);
  place("left", 245, floorY + 48, 340, 450, 4);
  place("right", 835, floorY + 48, 340, 450, 4);
  const light = staging.layers.illumination.id;
  const isCeiling = light === "lamp_ceiling";
  const isBeacon = light === "emergency_light";
  place("illumination", isCeiling ? 535 : isBeacon ? width - focalX : focalX,
    isCeiling ? 335 : isBeacon ? 775 : 970, isBeacon ? 580 : 940, 980, 8, "sprite", 0.8);
  place("frame", 0, 0, width, height, 11, "fill");
  place("weather", 0, 0, width, height, 12, "fill", 0.52);

  const focus = layers.find((layer) => layer.slot === "focus");
  const custom = !focus && staging.custom && staging.custom.shape !== "none" && staging.custom.label.trim()
    ? { ...staging.custom, x: focalX, y: foregroundY }
    : null;
  return {
    packVersion: manifest.version,
    width, height, title: plan.title, world: plan.world, lighting: plan.lighting, room: plan.room,
    caption: staging.caption,
    layers: layers.sort((a, b) => a.depth - b.depth),
    custom,
    diagnostics: { repairs, unmatchedFocus: focus || custom ? null : plan.focus },
  };
}

export function createStoryforkGenerator(model) {
  return async function generateScene(input, onProgress = () => {}) {
    const inputSchema = object({ brief: string(1200), allowCustom: { type: "boolean" } }, ["brief"]);
    const errors = validateSchema(input, inputSchema);
    if (errors.length || !input.brief.trim()) {
      throw new EpisodeError("invalid_brief", "Enter a scene brief of 1–1200 characters.");
    }

    let phase = "direction";
    try {
      const direction = await model.generate(director, { brief: input.brief.trim() }, directionSchema, {
        label: "storyfork-direction", schemaName: "storyfork_direction", maxTokens: 2400, thinkingLevel: "low",
      });
      const plan = direction.value;
      onProgress({ phase: "composition", title: plan.title });
      phase = "composition";
      const { menus, customAvailable } = options(eligibleAssets(plan), plan, input.allowCustom);
      const staging = await model.generate(compositor, {
        brief: input.brief.trim(), plan, menus: menuCards(menus),
        customAvailable, coordinates: { floorY, foregroundY, sideDressing: [245, 835], focus: [335, 745] },
      }, stagingSchema(menus, customAvailable), {
        label: "storyfork-composition", schemaName: "storyfork_composition", maxTokens: 3000, thinkingLevel: "low",
      });
      const scene = compile(plan, staging.value, menus);
      return {
        ...scene,
        diagnostics: {
          ...scene.diagnostics,
          model: staging.model, directionModel: direction.model, directionMs: direction.ms, compositionMs: staging.ms,
          attempts: direction.attempts + staging.attempts,
          focusQuery: plan.focus, shortlist: menus.focus.map(({ id }) => id),
        },
      };
    } catch (cause) {
      let message = "Gemini не смогла собрать кадр. Попробуйте ещё раз.";
      if (cause.errors?.some((error) => error.includes("HTTP 402"))) {
        message = isQuotaError(cause)
          ? "Gemini вернула лимит (429) на одном ключе и исчерпанные кредиты (402) на другом."
          : "Gemini вернула ошибку биллинга (402). Проверьте кредиты проекта.";
      } else if (isQuotaError(cause)) {
        message = "Gemini вернула ошибку лимита (429). Повторите запрос позже.";
      }
      throw new SceneGenerationError(phase, message, {
        cause, attempts: cause.attempts, validation: cause.errors,
      });
    }
  };
}
