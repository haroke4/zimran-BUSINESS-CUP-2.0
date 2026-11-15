import { GoogleGenAI } from "@google/genai";
import { ModelError, parseModelJson, validateSchema } from "../test/server/model-client.mjs";

const localConstraints = new Set([
  "maxItems", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
]);

function transportSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (localConstraints.has(key)) continue;
    if (["properties", "patternProperties", "$defs", "definitions"].includes(key)) {
      // Property names are data here: a field called "maximum" must survive.
      result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, transportSchema(child)]));
    } else if (["items", "additionalProperties", "not"].includes(key)) {
      result[key] = Array.isArray(value) ? value.map(transportSchema) : transportSchema(value);
    } else if (["anyOf", "allOf", "oneOf", "prefixItems"].includes(key)) {
      result[key] = value.map(transportSchema);
    } else {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

export function createVertexModelClient({ project, location, model }, ai = new GoogleGenAI({
  vertexai: true, project, location, httpOptions: { timeout: 105_000, retryOptions: { attempts: 1 } },
})) {
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT is required for Vertex AI");

  async function generate(system, input, schema, {
    temperature = 0.15, maxTokens = 700, validateResult,
  } = {}) {
    const started = performance.now();
    let raw = "";
    try {
      const response = await ai.models.generateContent({
        model,
        contents: JSON.stringify(input),
        config: {
          systemInstruction: system,
          temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: "application/json",
          // Large bounded nested arrays can exceed Vertex's schema complexity
          // limit. Keep structure/minimum counts in the decoder; enforce all
          // application limits against the original schema below.
          responseJsonSchema: transportSchema(schema),
          ...(model.startsWith("gemini-3") && { thinkingConfig: { thinkingLevel: "low" } }),
        },
      });
      raw = response.text ?? "";
      const value = parseModelJson(raw);
      const errors = validateSchema(value, schema);
      if (errors.length) throw new Error(`Model JSON does not match the schema: ${errors.slice(0, 4).join("; ")}`);
      validateResult?.(value);
      return { value, raw, model, attempts: 1, ms: Math.round(performance.now() - started) };
    } catch (cause) {
      throw new ModelError("Vertex AI did not return valid JSON", {
        attempts: 1, raw, cause, status: cause.status, errors: [cause.message],
      });
    }
  }

  return { generate };
}
