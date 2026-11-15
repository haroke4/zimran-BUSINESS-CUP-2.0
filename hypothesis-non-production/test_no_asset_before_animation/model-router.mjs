import { createModelClient, ModelError } from "../test/server/model-client.mjs";

const quotaWindow = 60_000;
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
  const geminiModel = environment.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
  const configured = [
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
  ].filter(({ apiKey }) => apiKey).map(({ name, options, ...config }) => ({
    name, options, model: config.model,
    client: createModelClient({ ...config, fetchImpl, maxAttempts: 1, timeoutMs: 45_000, logger: {} }),
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
