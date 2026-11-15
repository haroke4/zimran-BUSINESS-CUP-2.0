import assert from "node:assert/strict";
import test from "node:test";
import { createVertexModelClient } from "./vertex-model.mjs";
import { createSceneModel } from "./model-router.mjs";

const config = { project: "test-project", location: "global", model: "gemini-3.5-flash" };
const schema = { type: "object", properties: { stage: { type: "string" } }, required: ["stage"] };

test("Vertex takes priority over inherited API keys", () => {
  const model = createSceneModel({
    LLM_PROVIDER: "vertex", GOOGLE_CLOUD_PROJECT: config.project,
    OPENROUTER_API_KEY: "unused", GEMINI_API_KEY: "unused", NVIDIA_API_KEY: "unused",
  });
  assert.deepEqual(model.available, [`Google Cloud Gemini/${config.model}`]);
});

test("Vertex passes structured output settings and validates the result", async () => {
  let received;
  const client = createVertexModelClient(config, { models: {
    generateContent: async (request) => { received = request; return { text: '{"stage":"ok"}' }; },
  } });
  const result = await client.generate("Plan the scene", { brief: "Forest" }, schema, {
    maxTokens: 3400, temperature: 0.35,
    validateResult: (value) => assert.equal(value.stage, "ok"),
  });
  assert.equal(received.model, config.model);
  assert.deepEqual(JSON.parse(received.contents), { brief: "Forest" });
  assert.equal(received.config.systemInstruction, "Plan the scene");
  assert.equal(received.config.maxOutputTokens, 3400);
  assert.equal(received.config.temperature, 0.35);
  assert.deepEqual(received.config.responseJsonSchema, schema);
  assert.equal(result.value.stage, "ok");
  await assert.rejects(() => client.generate("Plan", {}, schema, {
    validateResult: () => { throw new Error("Invalid scene"); },
  }), (error) => error.cause.message === "Invalid scene");
});

test("Vertex preserves quota errors and rejects invalid model output", async () => {
  const client = createVertexModelClient(config, { models: {
    generateContent: async () => { throw Object.assign(new Error("Quota exceeded"), { status: 429 }); },
  } });
  await assert.rejects(() => client.generate("Plan", {}, schema), { status: 429 });
  const invalid = createVertexModelClient(config, { models: {
    generateContent: async () => ({ text: '{"stage":42}' }),
  } });
  await assert.rejects(() => invalid.generate("Plan", {}, schema), (error) => error.cause.message.includes("$.stage must be a string"));
});

test("Vertex simplifies nested transport limits while retaining full local validation", async () => {
  const bounded = {
    type: "object", required: ["trees"], additionalProperties: false,
    description: "Tree placements with strict application limits",
    properties: { trees: {
      type: "array", minItems: 1, maxItems: 2, description: "One or two trees",
      items: {
        type: "object", required: ["kind", "label", "maximum"], additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["fir", "pine"] },
          label: { type: "string", minLength: 1, maxLength: 4, description: "Short label" },
          maximum: { type: "integer", minimum: 0, maximum: 10 },
        },
      },
    } },
  };
  const original = structuredClone(bounded);
  let response = { trees: [{ kind: "fir", label: "Fir", maximum: 5 }] };
  let sent;
  const client = createVertexModelClient(config, { models: {
    generateContent: async request => {
      sent = request.config.responseJsonSchema;
      return { text: JSON.stringify(response) };
    },
  } });
  await client.generate("Place trees", {}, bounded);
  assert.equal(sent.description, bounded.description);
  assert.equal(sent.properties.trees.description, "One or two trees");
  assert.equal(sent.properties.trees.minItems, 1);
  assert.equal(sent.properties.trees.maxItems, undefined);
  assert.deepEqual(sent.properties.trees.items.properties.maximum, { type: "integer" });
  assert.deepEqual(sent.properties.trees.items.properties.label, { type: "string", description: "Short label" });
  assert.deepEqual(sent.properties.trees.items.required, ["kind", "label", "maximum"]);
  assert.deepEqual(sent.properties.trees.items.properties.kind.enum, ["fir", "pine"]);
  assert.equal(sent.properties.trees.items.additionalProperties, false);
  assert.deepEqual(bounded, original);

  for (const [value, message] of [
    [{ trees: Array.from({ length: 3 }, () => ({ kind: "fir", label: "Fir", maximum: 5 })) }, /at most 2 items/],
    [{ trees: [{ kind: "fir", label: "Fir", maximum: 11 }] }, /above 10/],
    [{ trees: [{ kind: "fir", label: "Fir", maximum: -1 }] }, /below 0/],
    [{ trees: [{ kind: "fir", label: "", maximum: 5 }] }, /too short/],
    [{ trees: [{ kind: "fir", label: "Too long", maximum: 5 }] }, /too long/],
  ]) {
    response = value;
    await assert.rejects(client.generate("Place trees", {}, bounded), error => message.test(error.cause.message));
  }
});
