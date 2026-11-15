import { readFile, writeFile } from "node:fs/promises";
import { parseArgs, parseEnv } from "node:util";
import { createModelClient } from "../test/server/model-client.mjs";
import { batteryChoices, episodeCases, episodeSlots, sceneCases } from "./cases.mjs";

const { values } = parseArgs({
  options: {
    prompt: { type: "string", default: "scene-v1" },
    providers: { type: "string", default: "groq,nvidia,gemini" },
    cases: { type: "string" },
    output: { type: "string" },
    "max-tokens": { type: "string", default: "5200" },
    "full-gemini-schema": { type: "boolean", default: false },
    "omit-inline-schema": { type: "boolean", default: false },
  },
});

const here = (file) => new URL(file, import.meta.url);
const environment = {};
for (const file of ["../../.env", "../.env", "../test_no_asset/.env", "../test/.env"]) {
  try {
    for (const [key, value] of Object.entries(parseEnv(await readFile(here(file), "utf8")))) {
      if (value) environment[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Could not read environment file ${file}`, { cause: error });
  }
}
Object.assign(environment, process.env);
const geminiKey = environment.GEMINI_API_KEY
  || (environment.LLM_PROVIDER === "gemini" ? environment.LLM_API_KEY : undefined)
  || environment.GEMINI_API_KEY_SECONDARY;
const routes = {
  groq: {
    config: { baseUrl: "https://api.groq.com/openai/v1", apiKey: environment.GROQ_API_KEY,
      model: environment.GROQ_MODEL || "openai/gpt-oss-120b" },
    options: { reasoningEffort: "low" },
  },
  nvidia: {
    config: { baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: environment.NVIDIA_API_KEY,
      model: environment.NVIDIA_MODEL || "nvidia/nemotron-3.5-super-vl-120b-a12b" },
    options: { chatTemplateKwargs: { enable_thinking: false } },
  },
  gemini: {
    config: { provider: "gemini", apiKey: geminiKey,
      secondaryGeminiKey: environment.GEMINI_API_KEY_SECONDARY,
      model: environment.GEMINI_MODEL || "gemini-3.5-flash-lite" },
    options: { thinkingLevel: "low" },
  },
};
const secrets = [...new Set(Object.entries(environment)
  .filter(([key, value]) => /API_KEY/.test(key) && value.length >= 8)
  .map(([, value]) => value))];
function redact(message) {
  const filtered = message.replace(/\borg_[a-z0-9]+\b/gi, "[ORGANIZATION]");
  return secrets.reduce((safe, secret) => safe.replaceAll(secret, "[REDACTED]"), filtered);
}

const string = { type: "string" };
const integer = { type: "integer" };
const array = (items, limits = {}) => ({ type: "array", items, ...limits });
const object = (properties) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
const enumString = (entries) => ({ ...string, enum: entries });

function episodeSlotSchema(input) {
  const option = object({ label: string, immediateResult: string });
  const slots = Object.fromEntries(Object.entries(episodeSlots).map(([id, slot]) => [
    id,
    object({
      anchor: string,
      turn: string,
      ...(slot.radio === "audible" && { radioLine: string }),
      ...(id !== "block_02" && { first: option, second: option }),
    }),
  ]));
  return object({
    title: string,
    dramaticQuestion: string,
    answer: string,
    cast: castSchema(input),
    slots: object(slots),
  });
}

function castSchema(input) {
  return array(object({
    character: enumString(Object.keys(input.actors)),
    want: string,
    knowsAtStart: string,
    speechPattern: string,
  }), { minItems: 2, maxItems: 2 });
}

function episodeSchema(input, stateVariants) {
  const location = enumString(Object.keys(input.locations));
  const choices = array(object({
    label: string, value: string, immediateResult: string,
  }), { minItems: 2, maxItems: 2 });
  const block = stateVariants ? object({
    number: integer,
    location,
    flag: string,
    variants: array(object({
      when: enumString(["all", "battery_taken", "battery_left"]),
      radio: enumString(["silent", "audible"]),
      anchor: string,
      turn: string,
      choices,
    }), { minItems: 1, maxItems: 2 }),
  }) : object({ number: integer, location, anchor: string, turn: string, flag: string, choices });
  return object({
    title: string,
    dramaticQuestion: string,
    answer: string,
    cast: castSchema(input),
    blocks: array(block, { minItems: input.blockCount, maxItems: input.blockCount }),
    callbacks: array(object({
      fromBlock: integer, atBlock: integer, afterFirstChoice: string, afterSecondChoice: string,
    }), { minItems: 2, maxItems: 3 }),
  });
}

function compileEpisode({ slots, ...story }) {
  const blocks = new Map();
  for (const [id, { number, location, when, radio }] of Object.entries(episodeSlots)) {
    if (!blocks.has(number)) {
      blocks.set(number, {
        number, location, flag: number === 2 ? "battery_disposition" : `choice_${number}`, variants: [],
      });
    }
    const { anchor, turn, radioLine, first, second } = slots[id];
    const choices = number === 2 ? batteryChoices : [
      { ...first, value: "first" },
      { ...second, value: "second" },
    ];
    blocks.get(number).variants.push({ when, radio, anchor, turn, ...(radioLine && { radioLine }), choices });
  }
  return {
    ...story,
    blocks: [...blocks.values()],
    callbacks: [{
      fromBlock: 2, atBlock: 5,
      afterFirstChoice: slots.block_05_taken.anchor,
      afterSecondChoice: slots.block_05_left.anchor,
    }],
  };
}

function sceneSchema(input) {
  return object({
    title: string,
    beats: array(object({
      at: integer,
      cue: enumString(Object.keys(input.cues)),
      screen: string,
      dialogue: array(object({ speaker: enumString(input.allowedSpeakers), line: string }), { maxItems: 2 }),
      change: string,
    }), { minItems: 3, maxItems: 5 }),
    choices: array(object({
      action: enumString(Object.keys(input.choices)), label: string, nextOpening: string, lastingEffect: string,
    }), { minItems: 2, maxItems: 2 }),
  });
}

function checkEpisode({ blocks, callbacks, cast }, input, stateVariants) {
  const distinct = (a, b) => a.trim() && b.trim() && a.trim() !== b.trim();
  const decision = blocks.find(({ flag }) => flag === "battery_disposition");
  return {
    allBlockNumbersInOrder: blocks.every((block, index) => block.number === index + 1),
    uniqueFlags: blocks.every(({ flag }) => /^[a-z][a-z0-9_]*$/.test(flag)) &&
      new Set(blocks.map(({ flag }) => flag)).size === input.blockCount,
    distinctChoicesAndResults: blocks.flatMap((block) => block.variants ?? [block]).every(({ choices: [a, b] }) =>
      Boolean(distinct(a.label, b.label) && distinct(a.value, b.value) &&
        distinct(a.immediateResult, b.immediateResult))),
    delayedCallbacks: callbacks.every(({ fromBlock, atBlock, afterFirstChoice, afterSecondChoice }) =>
      fromBlock >= 1 && atBlock >= fromBlock + 2 && atBlock <= input.blockCount &&
      Boolean(distinct(afterFirstChoice, afterSecondChoice))),
    distinctCast: new Set(cast.map(({ character }) => character)).size === cast.length,
    ...(stateVariants && {
      batteryChoiceWithinFirstFour: Boolean(decision && decision.number <= 4 &&
        decision.variants[0]?.choices.map(({ value }) => value).join(",") === "take,leave"),
      everyBatteryPathHasExactlyOneVariant: Boolean(decision && blocks.every(({ number, variants }) => {
        const conditions = variants.map(({ when }) => when).sort().join(",");
        return conditions === "all" || (number > decision.number && conditions === "battery_left,battery_taken");
      })),
      audibleRadioRequiresBattery: blocks.every(({ number, variants }) => variants.every(({ radio, when }) =>
        radio === "silent" || (decision && number > decision.number && when === "battery_taken"))),
      batteryHasExplicitDelayedPayoff: Boolean(decision && callbacks.some(({ fromBlock, atBlock }) =>
        fromBlock === decision.number && atBlock >= fromBlock + 2 &&
        blocks.find(({ number }) => number === atBlock)?.variants.length === 2)),
      callbackSourcesAreShared: callbacks.every(({ fromBlock }) =>
        blocks.find(({ number }) => number === fromBlock)?.variants[0]?.when === "all"),
    }),
  };
}

function checkScene(scene, input) {
  const { beats, choices } = scene;
  const times = beats.map(({ at }) => at);
  const wordCount = (text) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  const lines = beats.flatMap(({ dialogue }) => dialogue.map(({ line }) => line));
  const largestGap = Math.max(...times.slice(1).map((time, index) => time - times[index]),
    input.revealChoicesAt - times.at(-1));
  return {
    openingShowsPriorChoice: beats[0].cue === input.requiredOpeningCue && times[0] >= 0 && times[0] <= 3,
    timelineOrderedBeforeChoice: times.every((time, index) => time >= 0 &&
      time < input.revealChoicesAt && (index === 0 || time > times[index - 1])),
    lateEvent: times.at(-1) >= 20,
    distinctCues: new Set(beats.map(({ cue }) => cue)).size === beats.length,
    largestGapSeconds: largestGap,
    dialogueWords: lines.reduce((total, line) => total + wordCount(line), 0),
    dialogueLines: lines.length,
    longestLineWords: Math.max(0, ...lines.map(wordCount)),
    longestLabelWords: Math.max(...choices.map(({ label }) => wordCount(label))),
    twoDifferentActions: choices[0].action !== choices[1].action,
  };
}

function resolveTravel({ beats }, { travel, revealChoicesAt }) {
  if (!travel) return;
  let mark = travel.startMark;
  let arrivalAt = 0;
  const legs = [];
  for (const { at, cue } of beats) {
    if (at < arrivalAt) throw new Error(`${cue} starts before arrival at ${mark} (second ${arrivalAt})`);
    const route = travel.routes[cue];
    if (!route) {
      if (travel.cueMarks[cue] !== mark) throw new Error(`${cue} is unavailable at ${mark}`);
      continue;
    }
    if (route.from !== mark) throw new Error(`${cue} must start at ${route.from}, not ${mark}`);
    mark = route.to;
    arrivalAt = at + route.seconds;
    legs.push({ cue, from: route.from, to: mark, departureAt: at, arrivalAt });
  }
  if (mark !== travel.choiceMark || arrivalAt > revealChoicesAt) {
    throw new Error(`The player must reach ${travel.choiceMark} before the choice reveal`);
  }
  return legs;
}

function fetchWithRelaxedArrayBounds(url, request) {
  const body = JSON.parse(request.body);
  const generation = body.generationConfig;
  generation.responseJsonSchema = JSON.parse(JSON.stringify(generation.responseJsonSchema,
    (key, value) => key === "minItems" || key === "maxItems" ? undefined : value));
  return fetch(url, { ...request, body: JSON.stringify(body) });
}

if (!/^(scene|episode)-v[1-9]\d*$/.test(values.prompt)) throw new Error("Use a scene-vN or episode-vN prompt name");
const episode = values.prompt.startsWith("episode-");
const scaffolded = /^episode-v[45]$/.test(values.prompt);
const stateVariants = episode && values.prompt !== "episode-v1";
const fixtures = episode ? episodeCases : sceneCases;
const travelPrompt = values.prompt === "scene-v4";
const promptFiles = travelPrompt ? ["scene-v3", values.prompt] : [values.prompt];
const prompt = (await Promise.all(promptFiles.map(name => readFile(here(`prompts/${name}.md`), "utf8")))).join("\n");
const defaultCases = travelPrompt ? "long_corridor,quiet" : episode ? "crossing" : "powered,dead";
const selectedCases = (values.cases ?? defaultCases).split(",");
const providers = values.providers.split(",");
for (const name of selectedCases) {
  if (!Object.hasOwn(fixtures, name)) throw new Error(`Unknown fixture: ${name}`);
}
for (const name of providers) {
  if (!Object.hasOwn(routes, name)) throw new Error(`Unknown provider: ${name}`);
}
const startedAt = new Date().toISOString();
const temperature = 0.55;
const maxTokens = Number(values["max-tokens"]);
if (!Number.isInteger(maxTokens) || maxTokens < 1) throw new Error("max-tokens must be a positive integer");
const results = (await Promise.all(providers.map(async (provider) => {
  const { config, options } = routes[provider];
  const relaxedSchema = provider === "gemini" && stateVariants && !values["full-gemini-schema"];
  const client = config.apiKey && createModelClient({
    ...config, maxAttempts: 1, timeoutMs: 60_000, logger: {},
    ...(relaxedSchema && { fetchImpl: fetchWithRelaxedArrayBounds }),
  });
  const runs = [];
  for (const fixture of selectedCases) {
    const base = { provider, model: config.model, fixture, ...(relaxedSchema && { relaxedArrayBounds: true }) };
    const input = fixtures[fixture];
    const schema = scaffolded ? episodeSlotSchema(input)
      : episode ? episodeSchema(input, stateVariants) : sceneSchema(input);
    const began = performance.now();
    try {
      if (!client) throw new Error("Provider API key is missing");
      const result = await client.generate(prompt, {
        ...input,
        ...(scaffolded && { episodeSlots, batteryChoices }),
        ...(!values["omit-inline-schema"] && { outputSchema: schema }),
      }, schema, {
        ...options, temperature, maxTokens,
        schemaName: episode ? "framebreak_master_episode" : "framebreak_master_scene",
      });
      const value = scaffolded ? compileEpisode(result.value) : result.value;
      const checks = episode ? checkEpisode(value, input, stateVariants) : checkScene(value, input);
      const travel = resolveTravel(value, input);
      runs.push({
        ...base, ms: result.ms, checks, [episode ? "episode" : "scene"]: value,
        ...(travel && { travel }),
        ...(scaffolded && { modelOutput: result.value }),
      });
      console.log(`${provider} ${fixture}: JSON OK (${result.ms} ms)`);
    } catch (error) {
      runs.push({
        ...base, ms: Math.round(performance.now() - began), status: error.status ?? null,
        error: redact(error.cause?.message ?? error.message),
        ...(error.raw && { invalidOutput: redact(error.raw) }),
      });
      console.log(`${provider} ${fixture}: ${error.status ?? "error"} ${redact(error.cause?.message ?? error.message)}`);
    }
  }
  return runs;
}))).flat();
const output = values.output ?? `hypothesis-non-production/actual_implementation/results/${values.prompt}.json`;
await writeFile(output, redact(JSON.stringify({
  startedAt, prompt: values.prompt, temperature, maxTokens,
  ...(values["omit-inline-schema"] && { inlineSchema: false }),
  results,
}, null, 2)) + "\n");
if (results.some(({ error }) => error)) process.exitCode = 1;
