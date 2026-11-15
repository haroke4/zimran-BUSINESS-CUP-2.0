import { readFileSync } from "node:fs";
import { cityBriefs, layoutFixtures } from "../asset-hypotheses/scene.mjs";

export const SCENE_COUNT = 10;
export const SCENE_DURATION_MS = 30_000;
export const CHOICE_AT_MS = 27_000;

export const locations = {
  "rainy-crossing": {
    preset: "wet",
    brief: {
      ...cityBriefs.wet,
      requiresSkyline: true,
      hint: "A wet city at dusk, a tower across from row houses, a metal cache beside the puddles",
    },
  },
  "quiet-block": {
    preset: "dry",
    brief: {
      ...cityBriefs.dry,
      requiresSkyline: true,
      hint: "A dry residential block after dusk, low houses and a neon direction sign",
    },
  },
  "pine-trail": {
    preset: "trail",
    brief: {
      ...cityBriefs.trail,
      requiresSkyline: true,
      hint: "A lonely dirt trail with pines and roadside boulders, no houses or puddles",
    },
  },
};

const savedLayouts = JSON.parse(
  readFileSync(new URL("../asset-hypotheses/assets/model-layouts.json", import.meta.url), "utf8"),
);

export const fallbackLayouts = {
  "rainy-crossing": layoutFixtures.wet,
  "quiet-block": layoutFixtures.dry,
  "pine-trail": savedLayouts.trail.layout,
};

export const FACT_TYPES = {
  "crossing.scanned": { type: "boolean" },
  approach: { enum: ["cautious", "bold"] },
  "battery.taken": { type: "boolean" },
  "battery.owner": { enum: ["mara", "cache"] },
  "cache.opened": { type: "boolean" },
  route: { enum: ["sign", "alley"] },
  "trail.marked": { type: "boolean" },
  "cache.searched": { type: "boolean" },
  "radio.call": { type: "boolean" },
  "radio.powered": { type: "boolean" },
  "signal.answered": { type: "boolean" },
  "relay.route": { enum: ["boulder", "circle"] },
  "block.entered": { type: "boolean" },
  "finale.answer": { type: "boolean" },
  "finale.radio": { type: "boolean" },
};

function effect(path, value) {
  return { op: "set", path, value };
}

function choice(id, label, effects) {
  return { id, label, effects };
}

export const scenePlan = [
  {
    number: 1,
    location: "rainy-crossing",
    title: "The Rain Cache",
    intent: "Mara reaches a flooded crossing after curfew and finds a closed metal cabinet beside the puddles. Her radio is silent. Establish the place, the weather and the closed cache.",
    preference: "She is careful, but curious about the light under the cabinet door.",
    choices: [
      choice("scan_crossing", "Scan the crossing", [effect("crossing.scanned", true), effect("approach", "cautious")]),
      choice("call_out", "Call into the dark", [effect("crossing.scanned", false), effect("approach", "bold")]),
    ],
  },
  {
    number: 2,
    location: "rainy-crossing",
    title: "What the Cache Holds",
    intent: "Mara opens the cabinet. A charged radio battery sits inside. The storm gets worse. End on the decision to take the battery or leave it.",
    preference: "The battery is the only useful thing she has seen all night.",
    entry: {
      facts: { "cache.opened": true },
      props: { "rainy-crossing": { cache: "open" } },
    },
    choices: [
      choice("take_battery", "Take the battery", [effect("battery.taken", true), effect("battery.owner", "mara")]),
      choice("leave_battery", "Leave it in the cache", [effect("battery.taken", false), effect("battery.owner", "cache")]),
    ],
  },
  {
    number: 3,
    location: "quiet-block",
    title: "The Neon Sign",
    intent: "Mara leaves the crossing and reaches a dry residential block. A neon direction sign marks a route toward an old relay station. She can follow the sign or cut through the alley.",
    preference: "She wants a route that keeps her out of the rain.",
    requiredVisuals: ["direction_sign"],
    choices: [
      choice("follow_sign", "Follow the sign", [effect("route", "sign")]),
      choice("take_alley", "Cut through the alley", [effect("route", "alley")]),
    ],
  },
  {
    number: 4,
    location: "pine-trail",
    title: "Trail Behind the Block",
    intent: "The route narrows to a dirt trail through pines. A boulder marks the turn. Mara can leave a marker for her return or hurry on before the light goes.",
    preference: "She does not trust the dark, but she is running out of time.",
    choices: [
      choice("mark_trail", "Mark the trail", [effect("trail.marked", true)]),
      choice("hurry_on", "Hurry on", [effect("trail.marked", false)]),
    ],
  },
  {
    number: 5,
    location: "rainy-crossing",
    title: "Return to the Cache",
    intent: "Mara circles back to the crossing. The cabinet is still open. If the battery was left, it is still inside; if it was taken, the shelf is empty. She searches the cache for anything else useful.",
    preference: "She remembers exactly what she left behind.",
    choices: [
      choice("search_cache", "Search the cache", [effect("cache.searched", true)]),
      choice("leave_cache", "Leave it alone", [effect("cache.searched", false)]),
    ],
  },
  {
    number: 6,
    location: "quiet-block",
    title: "Radio Static",
    intent: "At the quiet block, Mara tries the radio. The battery decision from the cache decides whether it has power. Show the consequence plainly, then let her call out or stay quiet.",
    preference: "She needs to know if anyone is still listening.",
    choices: [
      choice("radio_call", "Call out", [effect("radio.call", true)]),
      choice("stay_quiet", "Stay quiet", [effect("radio.call", false)]),
    ],
  },
  {
    number: 7,
    location: "rainy-crossing",
    title: "The Signal",
    intent: "The signal resolves into a voice or into silence. This is the payoff of the cache decision. Mara can answer the signal or ignore it.",
    preference: "She has come too far to pretend she heard nothing.",
    choices: [
      choice("answer_signal", "Answer the signal", [effect("signal.answered", true)]),
      choice("ignore_signal", "Ignore it", [effect("signal.answered", false)]),
    ],
  },
  {
    number: 8,
    location: "pine-trail",
    title: "The Relay",
    intent: "The trail reaches a relay marker. A boulder blocks the direct line. Mara can climb over it or circle around through the pines.",
    preference: "She is tired, and the shortcut is not obviously safe.",
    choices: [
      choice("climb_boulder", "Climb over", [effect("relay.route", "boulder")]),
      choice("circle_around", "Circle through the pines", [effect("relay.route", "circle")]),
    ],
  },
  {
    number: 9,
    location: "quiet-block",
    title: "The Empty Block",
    intent: "Mara returns to the quiet block. The sign is dark. The radio consequence is still present. She can enter one of the houses or wait outside for the signal to return.",
    preference: "The block feels emptier than it did on the way out.",
    choices: [
      choice("enter_house", "Step inside", [effect("block.entered", true)]),
      choice("wait_outside", "Wait outside", [effect("block.entered", false)]),
    ],
  },
  {
    number: 10,
    location: "rainy-crossing",
    title: "Airlock 04",
    intent: "Back at the crossing, the open cache hums like an airlock. The radio still has power, or it does not. End the episode on the final choice: open the airlock or walk away.",
    preference: "She has one choice left that cannot be undone.",
    choices: [
      choice("open_airlock", "Open the airlock", [effect("finale.answer", true)]),
      choice("walk_away", "Walk away", [effect("finale.answer", false)]),
    ],
  },
];

const choiceIds = new Set();
const effectPaths = new Set();
for (const beat of scenePlan) {
  if (!locations[beat.location]) throw new Error(`Unknown location in scene ${beat.number}`);
  if (beat.choices.length !== 2) throw new Error(`Scene ${beat.number} needs two choices`);
  for (const entry of beat.choices) {
    if (choiceIds.has(entry.id)) throw new Error(`Duplicate choice id: ${entry.id}`);
    choiceIds.add(entry.id);
    for (const item of entry.effects) {
      if (item.op !== "set" || !Object.hasOwn(FACT_TYPES, item.path)) {
        throw new Error(`Invalid effect in ${entry.id}: ${item.path}`);
      }
      const rule = FACT_TYPES[item.path];
      if (rule.type === "boolean" && typeof item.value !== "boolean") throw new Error(`Invalid boolean effect: ${item.path}`);
      if (rule.enum && !rule.enum.includes(item.value)) throw new Error(`Invalid enum effect: ${item.path}`);
      effectPaths.add(item.path);
    }
  }
}
if (scenePlan.length !== SCENE_COUNT) throw new Error("Scene plan does not match SCENE_COUNT");

export function applyEffects(facts, effects) {
  const next = { ...facts };
  for (const item of effects) {
    if (item.op !== "set" || !Object.hasOwn(FACT_TYPES, item.path)) throw new Error(`Unsupported effect: ${item.path}`);
    const rule = FACT_TYPES[item.path];
    if (rule.type === "boolean" && typeof item.value !== "boolean") throw new Error(`Invalid boolean effect: ${item.path}`);
    if (rule.enum && !rule.enum.includes(item.value)) throw new Error(`Invalid enum effect: ${item.path}`);
    next[item.path] = item.value;
  }
  return next;
}

export function entryFor(beat, facts) {
  const patch = { ...(beat.entry?.facts ?? {}) };
  if ([6, 7, 10].includes(beat.number)) {
    patch["radio.powered"] = facts["battery.taken"] === true;
    if (beat.number === 10) patch["finale.radio"] = facts["battery.taken"] === true;
  }
  return { facts: patch, props: beat.entry?.props ?? {} };
}

export function consequenceFor(sceneNumber, facts) {
  const taken = facts["battery.taken"] === true;
  if (sceneNumber === 6) {
    return taken
      ? {
        id: "radio_powered",
        kind: "payoff",
        title: "The battery answers",
        text: "The battery from the cache powers the radio. A voice cuts through the static.",
        required: ["radio", "voice", "signal", "battery"],
      }
      : {
        id: "radio_dead",
        kind: "payoff",
        title: "Dead air",
        text: "The radio stays dark. The battery is still at the crossing, behind Mara.",
        required: ["radio", "dark", "silent", "dead", "battery"],
      };
  }
  if (sceneNumber === 7) {
    return taken
      ? {
        id: "signal_located",
        kind: "payoff",
        title: "A bearing",
        text: "The voice gives a bearing. The signal is close.",
        required: ["radio", "voice", "signal", "bearing", "close"],
      }
      : {
        id: "signal_lost",
        kind: "payoff",
        title: "No bearing",
        text: "No signal answers. The lamps and the sky are the only guide.",
        required: ["signal", "silent", "dark", "lamp", "sky"],
      };
  }
  if (sceneNumber === 10) {
    return taken
      ? {
        id: "airlock_answers",
        kind: "finale",
        title: "The cache answers",
        text: "The radio still has power. The cache answers like an airlock.",
        required: ["radio", "power", "answer", "airlock", "cache"],
      }
      : {
        id: "airlock_silent",
        kind: "finale",
        title: "No answer",
        text: "The radio has no power. The cache stays shut.",
        required: ["radio", "silent", "shut", "closed", "power"],
      };
  }
  return null;
}

export function consequenceMentioned(consequence, texts) {
  if (!consequence) return true;
  const text = texts.join(" ").toLowerCase();
  return consequence.required.some((word) => text.includes(word.toLowerCase()));
}
