import { writeFile } from "node:fs/promises";
import {
  cityBriefs, compileAction, compositionContext, compositorPrompt,
  loadLocation, validateLayout, writerPrompt,
} from "./scene.mjs";

const baseUrl = process.env.FRAMEBREAK_MODEL_URL ?? "http://127.0.0.1:18327/v1";
const outputFile = process.argv[2];
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const enumeration = (...values) => ({ type: typeof values[0] === "number" ? "integer" : "string", enum: values });
const string = { type: "string" };
const writerSchema = object({
  aim: string,
  searchHint: string,
  reveal: enumeration("battery"),
  action: enumeration("open"),
  choices: object({ take: string, leave: string }),
});

async function generate(system, input, schema) {
  const start = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "local-model", temperature: 0.15, seed: 17,
      max_tokens: 650, response_format: { type: "json_schema", json_schema: { name: "response", strict: true, schema } },
      messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(input) }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Model returned ${response.status}: ${await response.text()}`);
  const result = await response.json();
  return {
    value: JSON.parse(result.choices[0].message.content),
    ms: Math.round(performance.now() - start),
    usage: result.usage,
  };
}

const results = {};
for (const [key, brief] of Object.entries(cityBriefs)) {
  const inputs = {
    playerPreference: brief.hint,
    selectedChoice: "Inspect the cache",
    worldState: { cacheState: "closed", hero: "Mara", heroGoal: "Recover the radio battery" },
    rules: "The cabinet opens in this scene. Finish with two distinct button labels for take and leave.",
  };
  const writer = await generate(writerPrompt, inputs, writerSchema);
  const context = compositionContext({ ...brief, hint: `${brief.hint}. ${writer.value.searchHint}` });
  const idsFor = (layer) => context.candidates.filter((asset) => asset.layer === layer).map(({ id }) => id);
  const fixed = [["sky", idsFor("sky")[0], 0], ["ground", idsFor("ground")[0], 0]];
  const slotMap = (slots, ...assetIds) =>
    object(Object.fromEntries(slots.map((slot) => [slot, enumeration("empty", ...assetIds)])));
  const composerInput = {
    brief: context.brief,
    story: writer.value,
    fixed,
    candidates: context.candidates.filter(({ layer }) => layer !== "sky" && layer !== "ground"),
    requestedStructure: brief.wet
      ? "Use at least one tall_tower and one row_houses. Choose a puddle slot."
      : brief.style === "rural" ? "Frame the trail with pine groves and a roadside boulder." : "Use row_houses and the direction_sign.",
    placementRules: "The cabinet occupies its own prop slot. The center building fills skyline slot 2. Put optional props in their listed slots. Use empty when a slot is unused.",
  };
  const cabinetId = context.candidates.find(({ capabilities }) => capabilities?.includes("openable")).id;
  const layoutSchema = object({
    approach: enumeration("walk", "run"),
    skylineCenter: enumeration(...idsFor("skyline")),
    skyline: slotMap(["0", "1", "3", "4"], ...idsFor("skyline")),
    cabinetSlot: enumeration(2, 3, 4),
    ...(brief.wet && { puddleSlot: enumeration(0, 1, 2, 3) }),
    props: slotMap(["0", "1", "5"], ...idsFor("prop").filter((id) => id !== cabinetId)),
  });
  let compose;
  let layout;
  let sequence;
  let reason;
  const attempts = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    compose = await generate(compositorPrompt + " Sky and ground are filled by code. Return the slot map. Use empty to leave a slot vacant.", { ...composerInput, ...(reason && { fix: reason, previous: compose.value }) }, layoutSchema);
    attempts.push(compose.ms);
    const toPlacements = (layer, map) => Object.entries(map)
      .filter(([, assetId]) => assetId !== "empty")
      .map(([slot, assetId]) => [`${layer}-${slot}`, assetId, Number(slot)]);
    const { skylineCenter, skyline, cabinetSlot, puddleSlot, props } = compose.value;
    layout = {
      id: brief.id,
      placements: [
        ...fixed, ["skyline-2", skylineCenter, 2], ...toPlacements("skyline", skyline),
        ...(brief.wet ? [["puddle", idsFor("surface")[0], puddleSlot]] : []),
        ["cache", cabinetId, cabinetSlot], ...toPlacements("prop", props),
      ],
    };
    try {
      validateLayout(layout, context);
      const location = loadLocation(layout, context);
      const cabinet = location.objects.find(({ asset }) => asset.capabilities?.includes("openable"));
      sequence = compileAction(location, {}, { instance: cabinet.instance, clip: compose.value.approach, action: writer.value.action });
      break;
    } catch (error) {
      reason = error.message;
      console.log(`${key} composer attempt ${attempt + 1}: ${reason}`);
    }
  }
  if (!sequence) throw new Error(`Model did not produce a playable ${key} layout: ${reason}`);
  results[key] = { layout, story: writer.value, clip: sequence.clip };
  console.log(JSON.stringify({
    key, writerMs: writer.ms, composerMs: attempts, writerTokens: writer.usage,
    composerFinalTokens: compose.usage, shortlistBytes: Buffer.byteLength(JSON.stringify(context.candidates)),
    placements: layout.placements, approach: sequence.clip, contactMs: sequence.contact,
  }));
}
if (outputFile) await writeFile(outputFile, JSON.stringify(results, null, 2) + "\n");
