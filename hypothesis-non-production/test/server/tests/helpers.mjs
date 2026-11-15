import { MemoryStore } from "../store.mjs";

export function genericWriter(input) {
  return {
    title: `Scene ${input.scene.number}`,
    aim: "Mara moves through the location and makes a decision.",
    narration: "Mara stands beside the cabinet and listens to the night. The air stays quiet. She waits for the next sound.",
    choicePrompt: "What does Mara do next?",
    searchHint: "wet city street cabinet",
    visualRefs: input.frame?.ids ?? [],
  };
}

export function signWriter() {
  return {
    title: "The Neon Arrow",
    aim: "A bright sign marks the way through the block.",
    narration: "The neon arrow above the cabinet points toward the tower. Mara follows its glow.",
    choicePrompt: "Does Mara trust the arrow?",
    searchHint: "neon sign city",
    visualRefs: ["sign", "cabinet", "tower"],
  };
}

export function genericComposer(input) {
  const byLayer = (layer) => input.candidates.filter((asset) => asset.layer === layer);
  const skyline = byLayer("skyline");
  const props = byLayer("prop").filter((asset) => !asset.capabilities?.includes("openable"));
  const propIds = props.map((asset) => asset.id);
  const sign = input.brief.lowRise && propIds.includes("direction_sign")
    ? "direction_sign"
    : propIds.find((id) => id !== "direction_sign") ?? "empty";
  return {
    approach: "walk",
    choreography: { arrival: "walk", reaction: "walk", reactionTarget: "center", departure: "run", departureTarget: "right" },
    skylineCenter: skyline[0].id,
    skyline: { 0: skyline[1]?.id ?? "empty", 1: "empty", 3: "empty", 4: "empty" },
    cabinetSlot: 2,
    ...(input.brief.wet && { puddleSlot: 3 }),
    props: { 0: sign, 1: "empty", 5: "empty" },
  };
}

export function createFakeModel({
  writer = genericWriter,
  composer = genericComposer,
  writerFailures = 0,
  composerFailures = 0,
  delayMs = 0,
} = {}) {
  const calls = { writer: 0, composer: 0 };
  return {
    calls,
    async generate(system, input, _schema, options = {}) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const isComposer = system.includes("stage an animated");
      if (isComposer) {
        calls.composer += 1;
        if (composerFailures > 0 && calls.composer <= composerFailures) {
          throw new Error("composer failed");
        }
        const composed = await composer(input, options);
        const value = _schema.properties?.arrival ? composed.choreography : composed;
        return { value, attempts: 1, raw: JSON.stringify(value), usage: {}, ms: 1, model: "fake" };
      }
      calls.writer += 1;
      if (writerFailures > 0 && calls.writer <= writerFailures) {
        throw new Error("writer failed");
      }
      const value = await writer(input, options);
      return { value, attempts: 1, raw: JSON.stringify(value), usage: {}, ms: 1, model: "fake" };
    },
    async health() {
      return { ok: true, baseUrl: "fake", model: "fake" };
    },
  };
}

export function makeEngineOptions(overrides = {}) {
  return {
    store: new MemoryStore(),
    logger: { info() {}, warn() {}, error() {} },
    ...overrides,
  };
}

export function requestId(label) {
  return `req-${label}-0001`.slice(0, 100);
}

export function choiceFor(scene, index) {
  const entry = scene.choices[index];
  return {
    id: entry.id,
    effects: entry.effects,
  };
}

export async function runEpisode(engine, { branch = "take", scenes = 10 } = {}) {
  let response = await engine.createEpisode();
  const transcript = [{
    scene: 1,
    revision: response.revision,
    title: response.current.title,
    consequence: response.current.consequence?.id ?? null,
    facts: response.progress.facts,
  }];
  for (let index = 1; index < scenes; index += 1) {
    const scene = response.current;
    const pick = scene.number === 2 ? (branch === "take" ? 0 : 1) : 0;
    const choice = choiceFor(scene, pick);
    const result = await engine.submitChoice(response.id, {
      revision: response.revision,
      requestId: requestId(`${branch}-${scene.number}`),
      choice,
    });
    response = result.episode;
    transcript.push({
      scene: response.current?.number ?? response.progress.scene,
      revision: response.revision,
      title: response.current?.title,
      consequence: response.current?.consequence?.id ?? null,
      facts: response.progress.facts,
    });
  }
  return { episode: response, transcript };
}
