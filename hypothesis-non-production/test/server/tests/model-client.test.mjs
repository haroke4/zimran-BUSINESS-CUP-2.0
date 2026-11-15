import assert from "node:assert/strict";
import test from "node:test";
import { createModelClient, ModelError, parseModelJson, resolveModelConfig } from "../model-client.mjs";

const schema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

test("one LLM configuration interface resolves Gemini and OpenAI-compatible models", () => {
  assert.deepEqual(resolveModelConfig({
    LLM_PROVIDER: "gemini",
    LLM_MODEL: "gemini-3.5-flash",
    LLM_API_KEY: "key",
  }), {
    provider: "gemini", model: "gemini-3.5-flash", baseUrl: undefined, apiKey: "key",
  });
  assert.deepEqual(resolveModelConfig({
    LLM_PROVIDER: "openai",
    LLM_MODEL: "qwen-local",
    LLM_BASE_URL: "http://127.0.0.1:18327/v1",
  }), {
    provider: "openai", model: "qwen-local", baseUrl: "http://127.0.0.1:18327/v1", apiKey: undefined,
  });
});

function fakeFetch(responses) {
  const calls = [];
  return {
    calls,
    async fetch(url, options) {
      calls.push({ url, body: JSON.parse(options.body) });
      const content = responses[Math.min(calls.length - 1, responses.length - 1)];
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content } }], usage: { total_tokens: 1 } };
        },
      };
    },
  };
}

test("malformed model JSON triggers a bounded retry and then succeeds", async () => {
  const fake = fakeFetch(["this is not json", "```json\n{\"ok\":true}\n```"]);
  const client = createModelClient({
    baseUrl: "http://local.test/v1",
    model: "local-model",
    fetchImpl: fake.fetch,
    retryDelayMs: 1,
    logger: { warn() {} },
  });
  const result = await client.generate("system", { input: 1 }, schema, { label: "test" });
  assert.equal(result.value.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(fake.calls.length, 2);
});

test("schema-invalid JSON also retries and then reports the bounded attempt count", async () => {
  const fake = fakeFetch([JSON.stringify({ ok: "yes" }), JSON.stringify({ ok: 1 })]);
  const client = createModelClient({
    baseUrl: "http://local.test/v1",
    model: "local-model",
    fetchImpl: fake.fetch,
    retryDelayMs: 1,
    logger: { warn() {} },
  });
  await assert.rejects(
    client.generate("system", {}, schema, { label: "test" }),
    (error) => error instanceof ModelError && error.attempts === 2 && error.errors.length === 2,
  );
  assert.equal(fake.calls.length, 2);
});

test("JSON parser accepts fenced output and rejects prose without an object", () => {
  assert.deepEqual(parseModelJson("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.throws(() => parseModelJson("sorry, no object"), /no JSON object/);
});

test("Gemini native transport sends the schema and API key header", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, headers: options.headers });
    return {
      ok: true,
      async json() {
        return { candidates: [{ content: { parts: [{ text: '{"ok": true}' }] } }] };
      }
    };
  };
  const client = createModelClient({
    baseUrl: undefined,
    model: "gemini-1.5-flash",
    apiKey: "test-key",
    fetchImpl: fakeFetch,
    logger: { warn() {} },
  });
  const result = await client.generate("system", { input: 1 }, schema, { label: "test" });
  assert.equal(result.value.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers["x-goog-api-key"], "test-key");
});

test("Gemini switches keys only on 429 and starts the next request with the alternate key", async () => {
  const keys = [];
  const statuses = [429, 200, 503, 200, 429, 200];
  const client = createModelClient({
    provider: "gemini",
    model: "gemini-test",
    apiKey: "primary-test-key",
    secondaryGeminiKey: "secondary-test-key",
    retryDelayMs: 0,
    async fetchImpl(_url, { headers }) {
      keys.push(headers["x-goog-api-key"]);
      const status = statuses.shift();
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }, { status });
    },
    logger: { warn() {} },
  });
  for (let call = 0; call < 3; call += 1) {
    const result = await client.generate("system", {}, schema);
    assert.deepEqual(result.value, { ok: true });
    assert.equal(result.attempts, 2);
  }
  assert.deepEqual(keys, [
    "primary-test-key", "secondary-test-key",
    "secondary-test-key", "secondary-test-key",
    "secondary-test-key", "primary-test-key",
  ]);
});
