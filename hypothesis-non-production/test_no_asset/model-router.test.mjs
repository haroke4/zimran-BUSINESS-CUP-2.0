import assert from "node:assert/strict";
import test from "node:test";
import { createSceneModel } from "./model-router.mjs";

const env = { NVIDIA_API_KEY: "nvidia-test", GROQ_API_KEY: "groq-test", GEMINI_API_KEY: "gemini-test" };
const schema = {
  type: "object", properties: { stage: { type: "string" } }, required: ["stage"], additionalProperties: false,
};

test("OpenRouter sends only explicitly free variants and falls back within those variants", async () => {
  const calls = [];
  const free = ["inclusionai/ling-3.2-flash:free", "baidu/ernie-5.5-flash-preview:free"];
  const model = createSceneModel({
    ...env, OPENROUTER_API_KEY: "openrouter-test", OPENROUTER_MODELS: [free[0], "openrouter/auto", free[1]].join(","),
  }, {
    logger: {},
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(init.headers.Authorization, "Bearer openrouter-test");
      assert.equal(body.provider.require_parameters, true);
      calls.push(body.model);
      if (body.model === free[0]) return new Response("Rate limit", { status: 429 });
      return Response.json({ choices: [{ message: { content: '{"stage":"ok"}' } }] });
    },
  });
  const result = await model.generate("Plan", {}, schema, { label: "test" });
  assert.deepEqual(calls, free);
  assert.equal(result.model, free[1]);
});

test("429 moves to another provider and honors each provider's Retry-After across stages", async () => {
  let clock = 10_000;
  const calls = [];
  const model = createSceneModel(env, {
    logger: {}, now: () => clock,
    fetchImpl: async (url, init) => {
      const hostname = new URL(url).hostname;
      calls.push(hostname);
      if (hostname === "integrate.api.nvidia.com" && clock < 15_000) {
        return new Response("Rate limit", { status: 429, headers: { "Retry-After": "5" } });
      }
      if (hostname === "api.groq.com") {
        return new Response("Rate limit", { status: 429, headers: { "Retry-After": "12" } });
      }
      if (hostname === "generativelanguage.googleapis.com") {
        assert.equal(init.headers["x-goog-api-key"], env.GEMINI_API_KEY);
        return Response.json({ candidates: [{ content: { parts: [{ text: '{"stage":"ok"}' }] } }] });
      }
      assert.equal(init.headers.Authorization, `Bearer ${env.NVIDIA_API_KEY}`);
      return Response.json({ choices: [{ message: { content: '{"stage":"ok"}' } }] });
    },
  });

  const generate = () => model.generate("Plan", {}, schema, { label: "test", jsonMode: true });
  assert.equal((await generate()).provider, "Gemini");
  assert.equal((await generate()).provider, "Gemini");
  clock = 15_000;
  assert.equal((await generate()).provider, "NVIDIA NIM");
  assert.deepEqual(calls, [
    "integrate.api.nvidia.com", "api.groq.com", "generativelanguage.googleapis.com",
    "generativelanguage.googleapis.com", "integrate.api.nvidia.com",
  ]);
});

test("an invalid drawing uses the next provider, and quota exhaustion reports the earliest retry", async () => {
  let calls = 0;
  const model = createSceneModel(env, {
    logger: {}, now: () => 1000,
    fetchImpl: async (url) => {
      calls += 1;
      if (new URL(url).hostname === "integrate.api.nvidia.com" && calls === 1) {
        return Response.json({ choices: [{ message: { content: '{"stage":"invalid"}' } }] });
      }
      return new Response("Rate limit", { status: 429, headers: { "Retry-After": "7" } });
    },
  });
  const generate = () => model.generate("Draw", {}, schema, {
    label: "test",
    validateResult: ({ stage }) => { if (stage !== "ok") throw new Error("Invalid drawing"); },
  });
  await assert.rejects(generate, { status: 502 });
  await assert.rejects(generate, { status: 429, retryAfterMs: 7000 });
  assert.equal(calls, 4);
});
