import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { cityBriefs, compileAction, compositionContext, loadLocation, validateLayout } from "./scene.mjs";

const modelUrl = process.env.FRAMEBREAK_MODEL_URL ?? "http://127.0.0.1:18327/v1";
const rounds = Number(process.argv[2] ?? 2);
const storyChoices = ["Take the battery", "Leave it here"];
const structure = (properties) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
const choices = (...items) => ({ type: "string", enum: items });
const text = { type: "string" };

const schema = structure({
  beat: text,
  pace: choices("normal", "urgent"),
  emphasis: choices("place", "action", "reveal"),
  takeLabel: text,
  leaveLabel: text,
});

const saved = JSON.parse(readFileSync(new URL("./assets/model-layouts.json", import.meta.url), "utf8"));
const conditions = [
  ["wet", "A courier needs to contact their crew before a patrol arrives."],
  ["dry", "A mechanic checks the cache after hearing unfamiliar footsteps."],
  ["trail", "A ranger wants to understand why an abandoned radio still receives transmissions."],
];

async function ask(system, input, output, seed) {
  const start = performance.now();
  const response = await fetch(`${modelUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "local-model",
      temperature: 0.15,
      seed,
      max_tokens: 350,
      response_format: { type: "json_schema", json_schema: { name: "framebreak", strict: true, schema: output } },
      messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(input) }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const result = await response.json();
  const answer = result.choices[0];
  if (answer.finish_reason !== "stop") throw new Error(`Incomplete response: ${answer.finish_reason}`);
  return { value: JSON.parse(answer.message.content), usage: result.usage, ms: performance.now() - start };
}

function modelSlots(context) {
  const fromLayer = (layer) => context.candidates.flatMap((asset) => asset.layer === layer ? [asset.id] : []);
  const skyline = fromLayer("skyline");
  const props = fromLayer("prop").filter((id) => id !== "street_cabinet");
  return {
    skyline,
    props,
    name: context.brief.id,
    wet: context.brief.wet,
    sky: fromLayer("sky")[0],
    ground: fromLayer("ground")[0],
    surface: fromLayer("surface")[0],
  };
}

function assemble(kit, plan) {
  return {
    id: kit.name,
    placements: [
      ["sky", kit.sky, 0],
      ["ground", kit.ground, 0],
      ["main-silhouette", plan.center, 2],
      ...(plan.edge === "empty" ? [] : [["side-silhouette", plan.edge, 0]]),
      ["cache", "street_cabinet", Number(plan.cabinet)],
      ...(plan.detail === "empty" ? [] : [["detail", plan.detail, 5]]),
      ...(kit.wet ? [["puddle", kit.surface, Number(plan.puddle)]] : []),
    ],
  };
}

function deterministicLayout(kit, seed) {
  const center = kit.skyline[seed % kit.skyline.length];
  const edge = kit.skyline[(seed + 1) % kit.skyline.length];
  return assemble(kit, {
    center, edge, cabinet: 2 + seed % 3,
    detail: kit.props[seed % kit.props.length] ?? "empty",
    puddle: seed % 4,
  });
}

function present(result, expected) {
  const labels = [result.takeLabel, result.leaveLabel];
  const cleaned = labels.map((label, index) => {
    const verb = index === 0 ? "take" : "leave";
    return label.length <= 44 && label.toLowerCase().startsWith(verb) ? label : storyChoices[index];
  });
  assert.equal(result.beat.length > 0, true, "writer produced an empty beat");
  assert.equal(expected.length, 2);
  return cleaned.filter((label, index) => label !== labels[index]).length;
}

const system = "Write a short FRAMEBREAK beat and two short action labels. Mara opens a cabinet and discovers a radio battery. The choices are take the battery or leave it. Prefer short labels starting with Take and Leave. Set pace for the urgency of this beat and choose the camera emphasis.";
const compositor = "Stage the supplied story with the supplied catalog. Choose a central skyline and optionally a second skyline detail. Keep the street cabinet in its reserved positions. Pick walk or run to fit the story.";
const variants = ["twoCalls", "seeded", "return"];
const output = [];

await ask("Return a one-word JSON label.", {}, structure({ label: text }), 1);
for (let round = 0; round < rounds; round += 1) {
  for (const [index, [key, premise]] of conditions.entries()) {
    const context = compositionContext(cityBriefs[key]);
    const kit = modelSlots(context);
    for (const variant of [...variants.slice(round % variants.length), ...variants.slice(0, round % variants.length)]) {
      const start = performance.now();
      const input = { premise, preferences: { tone: "suspense", place: context.brief.hint }, chosenAction: "open the cabinet" };
      if (variant === "return") input.savedPlace = cityBriefs[key].id;
      const writer = await ask(system, input, schema, 11 + round + index);
      let usage = [writer.usage];
      let layout;
      let clip = writer.value.pace === "urgent" ? "run" : "walk";
      if (variant === "twoCalls") {
        const shot = await ask(compositor, { ...kit, cards: context.candidates, story: writer.value }, structure({
          center: choices(...kit.skyline),
          edge: choices("empty", ...kit.skyline),
          detail: choices("empty", ...kit.props),
          cabinet: choices("2", "3", "4"),
          ...(kit.wet && { puddle: choices("0", "1", "2", "3") }),
          clip: choices("walk", "run"),
        }), 27 + round + index);
        usage.push(shot.usage);
        clip = shot.value.clip;
        layout = assemble(kit, shot.value);
      } else {
        layout = variant === "seeded" ? deterministicLayout(kit, round * conditions.length + index) : saved[key].layout;
      }
      validateLayout(layout, context);
      const location = loadLocation(layout, context);
      const action = compileAction(location, {}, { clip, instance: "cache", action: "open" });
      const labelFallbacks = present(writer.value, storyChoices);
      const inputs = usage.reduce((sum, row) => sum + row.prompt_tokens, 0);
      const outputs = usage.reduce((sum, row) => sum + row.completion_tokens, 0);
      output.push({
        variant, key, round, ms: Math.round(performance.now() - start), inputs, outputs, labelFallbacks,
        distinctSkyline: new Set(location.objects.filter(({ asset }) => asset.layer === "skyline").map(({ asset }) => asset.id)).size,
        actionMs: action.complete,
      });
    }
  }
}
const quantile = (values, percentile) => values.sort((a, b) => a - b)[Math.ceil(values.length * percentile) - 1];
const mean = (values) => values.reduce((sum, number) => sum + number, 0) / values.length;
console.table(variants.map((variant) => {
  const run = output.filter((row) => row.variant === variant);
  const inputs = mean(run.map((row) => row.inputs));
  const outputs = mean(run.map((row) => row.outputs));
  return {
    variant,
    valid: run.length,
    medianMs: quantile(run.map((row) => row.ms), 0.5),
    maxMs: Math.max(...run.map((row) => row.ms)),
    inputTokens: Math.round(inputs),
    outputTokens: Math.round(outputs),
    modeledUSDAt3_5Rates: ((inputs * 0.30 + outputs * 2.50) / 1e6).toFixed(5),
    labelFallbacks: run.reduce((sum, row) => sum + row.labelFallbacks, 0),
    wetDistinctSkyline: mean(run.filter((row) => row.key === "wet").map((row) => row.distinctSkyline)),
  };
}));
if (process.env.FRAMEBREAK_VERBOSE === "1") console.table(output);
console.log("Local Qwen tokenizer and timing; provider costs are projections. Same three small scene fixtures; no art-quality or live-episode experiment.");
