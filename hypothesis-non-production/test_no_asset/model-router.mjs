import { createModelClient, ModelError } from "../test/server/model-client.mjs";
import { createVertexModelClient } from "./vertex-model.mjs";

const quotaWindow = 60_000;
const defaultFreeModels = [
  "inclusionai/ling-3.2-flash:free",
  "baidu/ernie-5.5-flash-preview:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "particle-ai/particle-1:free",
];

export class SceneModelError extends Error {
  constructor(stage, retryAfterMs, cause) {
    super(`Scene generation failed at ${stage}`, { cause });
    this.status = retryAfterMs === undefined ? 502 : 429;
    this.retryAfterMs = retryAfterMs;
  }
}

export function createSceneModel(environment = process.env, { fetchImpl, now = Date.now, logger = console } = {}) {
  const geminiKey = environment.GEMINI_API_KEY?.trim()
    || ((environment.LLM_PROVIDER === "gemini" || (!environment.LLM_PROVIDER && !environment.LLM_BASE_URL))
      ? environment.LLM_API_KEY?.trim() : undefined)
    || environment.GEMINI_API_KEY_SECONDARY?.trim();
  const geminiModel = environment.GEMINI_MODEL?.trim()
    || (environment.LLM_PROVIDER === "vertex" ? "gemini-3.5-flash" : "gemini-3.5-flash-lite");
  const openRouterKey = environment.OPENROUTER_API_KEY?.trim();
  const freeModels = environment.OPENROUTER_MODELS?.split(",").map(id => id.trim()).filter(Boolean) ?? defaultFreeModels;
  const openRouter = [...new Set(freeModels)]
    .filter(id => /^[\w.-]+\/[\w.-]+:free$/.test(id))
    .map(model => ({
      name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: openRouterKey, model,
      options: { openRouter: true, openRouterReasoning: model.startsWith("baidu/ernie-") },
    }));
  const configured = (environment.LLM_PROVIDER === "vertex" ? [{
    name: "Google Cloud Gemini", model: geminiModel,
    client: createVertexModelClient({
      project: environment.GOOGLE_CLOUD_PROJECT?.trim(),
      location: environment.GOOGLE_CLOUD_LOCATION?.trim() || "global",
      model: geminiModel,
    }),
    options: {},
  }] : openRouterKey ? openRouter : [
    {
      name: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: environment.NVIDIA_API_KEY?.trim(),
      model: environment.NVIDIA_MODEL?.trim() || "nvidia/nemotron-3.5-super-vl-120b-a12b",
      options: { reasoningEffort: undefined, chatTemplateKwargs: { enable_thinking: false } },
    },
    {
      name: "GroqCloud", baseUrl: "https://api.groq.com/openai/v1",
      apiKey: environment.GROQ_API_KEY?.trim(),
      model: environment.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
      options: { reasoningEffort: "low" },
    },
    {
      name: "Gemini", provider: "gemini", apiKey: geminiKey,
      model: geminiModel,
      options: { thinkingLevel: geminiModel.startsWith("gemini-3") ? "low" : undefined },
    },
  ]).filter(({ apiKey, client }) => apiKey || client).map(({ name, options, ...config }) => ({
    name, options, model: config.model,
    client: config.client ?? createModelClient({ ...config, fetchImpl, maxAttempts: 1, timeoutMs: options.openRouter ? 105_000 : 45_000, logger: {} }),
    retryAt: 0,
  }));

  async function generate(system, input, schema, options) {
    let lastError;
    for (const route of configured) {
      if (now() < route.retryAt) continue;
      try {
        const result = await route.client.generate(system, input, schema, { ...options, ...route.options });
        return { ...result, provider: route.name };
      } catch (error) {
        if (!(error instanceof ModelError)) throw error;
        lastError = error;
        if (error.status === 429) {
          route.retryAt = Math.max(route.retryAt, now() + Math.max(1_000, error.retryAfterMs ?? quotaWindow));
        }
        logger.warn?.(`[${options.label}] ${route.name}/${route.model}: ${error.cause?.message ?? error.message}`);
      }
    }
    const current = now();
    const allLimited = configured.length > 0 && configured.every(({ retryAt }) => retryAt > current);
    const retry = allLimited ? Math.min(...configured.map(({ retryAt }) => retryAt)) - current : undefined;
    throw new SceneModelError(options.label, retry, lastError);
  }

  return { generate, available: configured.map(({ name, model }) => `${name}/${model}`) };
}
