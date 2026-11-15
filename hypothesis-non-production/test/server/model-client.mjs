import { setTimeout as delay } from "node:timers/promises";

export class ModelError extends Error {
  constructor(message, { attempts = 0, raw = "", cause, errors = [], status, retryAfterMs } = {}) {
    super(message, { cause });
    this.name = "ModelError";
    this.attempts = attempts;
    this.raw = raw;
    this.errors = errors;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function schemaErrors(value, schema, path, errors) {
  if (!schema) return errors;
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
    return errors;
  }
  const type = schema.type;
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path} must be an object`);
      return errors;
    }
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) schemaErrors(value[key], child, `${path}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array`);
      return errors;
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} must have at most ${schema.maxItems} items`);
    value.forEach((item, index) => schemaErrors(item, schema.items, `${path}[${index}]`, errors));
  } else if (type === "string") {
    if (typeof value !== "string") errors.push(`${path} must be a string`);
    else {
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is too short`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is too long`);
    }
  } else if (type === "integer") {
    if (!Number.isSafeInteger(value)) errors.push(`${path} must be an integer`);
    else {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} is above ${schema.maximum}`);
    }
  } else if (type === "number") {
    if (!Number.isFinite(value)) errors.push(`${path} must be a number`);
  } else if (type === "boolean") {
    if (typeof value !== "boolean") errors.push(`${path} must be a boolean`);
  }
  return errors;
}

export function validateSchema(value, schema) {
  return schemaErrors(value, schema, "$", []);
}

export function parseModelJson(raw) {
  if (typeof raw !== "string") throw new Error("Model response content is not text");
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model response contains no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

function responseFormat(schema, name) {
  return {
    type: "json_schema",
    json_schema: { name, strict: true, schema },
  };
}

function retryAfterMs(response) {
  const value = response?.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, time - Date.now()) : undefined;
}

export function resolveModelConfig(environment = process.env) {
  const baseUrl = environment.LLM_BASE_URL ?? environment.FRAMEBREAK_MODEL_URL;
  const provider = environment.LLM_PROVIDER ?? (baseUrl ? "openai" : "gemini");
  const model = environment.LLM_MODEL ?? environment.FRAMEBREAK_MODEL
    ?? (provider === "gemini" ? "gemini-3.1-flash-lite" : "local-model");
  const apiKey = environment.LLM_API_KEY ?? environment.GEMINI_API_KEY;
  return { provider, model, baseUrl, apiKey };
}

export function createModelClient({
  provider,
  baseUrl,
  model,
  apiKey,
  secondaryGeminiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 45_000,
  maxAttempts = 2,
  retryDelayMs = 500,
  maxRateLimitDelayMs = 0,
  logger = console,
} = {}) {
  const defaults = resolveModelConfig();
  const config = {
    ...defaults,
    provider: provider ?? (baseUrl !== undefined ? "openai" : defaults.provider),
    ...(baseUrl !== undefined && { baseUrl }),
    ...(model !== undefined && { model }),
    ...(apiKey !== undefined && { apiKey }),
  };
  if (!Object.hasOwn({ gemini: true, openai: true }, config.provider)) {
    throw new Error(`Unsupported LLM_PROVIDER: ${config.provider}`);
  }
  if (config.provider === "openai" && !config.baseUrl) {
    throw new Error("LLM_BASE_URL is required for the openai provider");
  }
  const geminiKeys = [...new Set([config.apiKey, secondaryGeminiKey].filter(Boolean))];
  let preferredGeminiKey = 0;

  async function generate(system, input, schema, {
    schemaName = "framebreak_response",
    temperature = 0.15,
    maxTokens = 700,
    label = "model",
    thinkingLevel,
    reasoningEffort,
    chatTemplateKwargs,
    jsonMode = false,
    openRouter = false,
    openRouterReasoning = false,
    validateResult,
  } = {}) {
    let lastRaw = "";
    let lastError;
    let lastErrors = [];
    let lastStatus;
    let lastRetryAfter;
    const started = performance.now();
    let geminiKey = preferredGeminiKey;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        if (config.provider === "gemini") {
          if (!geminiKeys.length) throw new Error("A Gemini API key is required");
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`;
          const body = {
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: JSON.stringify(input) + "\nRespond with ONLY valid JSON object matching this schema: " + JSON.stringify(schema) }] }],
            generationConfig: {
              temperature: attempt === 1 ? temperature : 0,
              maxOutputTokens: maxTokens,
              responseMimeType: "application/json",
              responseJsonSchema: schema,
              ...(thinkingLevel && { thinkingConfig: { thinkingLevel } }),
            },
          };
          response = await fetchImpl(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKeys[geminiKey] },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
          const payload = await response.json();
          lastRaw = payload.candidates?.[0]?.content?.parts
            ?.filter((part) => !part.thought).map((part) => part.text ?? "").join("");
        } else {
          const body = {
            model: config.model,
            temperature: attempt === 1 ? temperature : 0,
            ...(reasoningEffort
              ? { max_completion_tokens: maxTokens, reasoning_effort: reasoningEffort }
              : { max_tokens: maxTokens }),
            ...(chatTemplateKwargs && { chat_template_kwargs: chatTemplateKwargs }),
            ...(openRouter && {
              provider: { require_parameters: true },
              reasoning: openRouterReasoning ? { effort: "low", exclude: true } : { enabled: false },
              plugins: [{ id: "response-healing" }],
            }),
            response_format: jsonMode ? { type: "json_object" } : responseFormat(schema, schemaName),
            messages: [
              { role: "system", content: system },
              { role: "user", content: openRouter
                ? `${JSON.stringify(input)}\nReturn a JSON object exactly matching this schema. Use only the listed property names: ${JSON.stringify(schema)}`
                : JSON.stringify(input) },
            ],
          };
          response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!response.ok) throw new Error(`Model returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
          const payload = await response.json();
          if (payload.error?.message) throw new Error(String(payload.error.message).slice(0, 300));
          lastRaw = payload.choices?.[0]?.message?.content;
        }

        if (typeof lastRaw !== "string" || !lastRaw.trim()) throw new Error("Model returned empty content");
        const value = parseModelJson(lastRaw);
        const errors = validateSchema(value, schema);
        if (errors.length) throw new Error(`Model JSON does not match the schema: ${errors.slice(0, 4).join("; ")}`);
        validateResult?.(value);
        if (config.provider === "gemini") preferredGeminiKey = geminiKey;
        return { value, attempts: attempt, raw: lastRaw, ms: Math.round(performance.now() - started), model: config.model };
      } catch (error) {
        lastError = error;
        lastStatus = response?.ok === false ? response.status : undefined;
        lastRetryAfter = lastStatus === 429 ? retryAfterMs(response) : undefined;
        lastErrors.push(error.message);
        logger.warn?.(`[model:${label}] attempt ${attempt}/${maxAttempts} failed: ${error.message}`);
        if (response?.status === 429 && config.provider === "gemini" && geminiKeys.length > 1) {
          geminiKey = (geminiKey + 1) % geminiKeys.length;
          continue;
        }
        if (attempt < maxAttempts) {
          const wait = lastRetryAfter > 0 && lastRetryAfter <= maxRateLimitDelayMs
            ? Math.max(lastRetryAfter, retryDelayMs * attempt)
            : retryDelayMs * attempt;
          await delay(wait);
        }
      }
    }
    throw new ModelError(`Model did not return valid JSON after ${maxAttempts} attempts`, {
      attempts: maxAttempts, raw: lastRaw, cause: lastError, errors: lastErrors, status: lastStatus, retryAfterMs: lastRetryAfter,
    });
  }

  async function health() {
    try {
        if (config.provider === "gemini") {
            if (!geminiKeys.length) return { ok: false, provider: config.provider, model: config.model, error: "No Gemini API key is configured" };
            const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}`, {
              headers: { "x-goog-api-key": geminiKeys[preferredGeminiKey] },
              signal: AbortSignal.timeout(3_000),
            });
            return { ok: response.ok, status: response.status, provider: config.provider, model: config.model };
        }
        const response = await fetchImpl(`${config.baseUrl}/models`, {
          headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
          signal: AbortSignal.timeout(3_000),
        });
        return { ok: response.ok, status: response.status, provider: config.provider, model: config.model, baseUrl: config.baseUrl };
    } catch (error) {
        return { ok: false, provider: config.provider, model: config.model, baseUrl: config.baseUrl, error: error.message };
    }
  }

  return { generate, health, config };
}
