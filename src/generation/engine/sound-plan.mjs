export const ambienceIds = ["room", "industrial", "city", "forest", "night", "wind", "rain", "water"];
export const surfaceIds = ["concrete", "tile", "metal", "wood", "grass", "gravel", "carpet", "snow"];

const choice = values => ({ type: "string", enum: values });
const level = { type: "number", minimum: 0, maximum: 1 };
export const soundSchema = {
  type: "object", additionalProperties: false,
  required: ["ambience", "surface", "ambienceGain", "stepsGain"],
  properties: {
    ambience: choice(ambienceIds), surface: choice(surfaceIds), ambienceGain: level, stepsGain: level,
  },
};

export function validateSoundPlan(plan) {
  if (!ambienceIds.includes(plan?.ambience) || !surfaceIds.includes(plan?.surface)
    || ![plan.ambienceGain, plan.stepsGain].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error("Unknown ambience, surface or invalid sound level");
  }
}

// Also supports scenes saved before sound planning was introduced.
export function fallbackSoundPlan(brief = "") {
  const text = brief.toLowerCase();
  const first = rules => rules.find(([, pattern]) => pattern.test(text))?.[0];
  const ambience = first([
    ["rain", /raining|rainfall|дождь|дождлив|ливень/],
    ["water", /ocean|sea\b|river|waterfall|море|моря|океан|рек[аиу]|водопад/],
    ["forest", /forest|woods|лес|сосны|хвой|дерев/],
    ["wind", /wind|rooftop|ветер|ветрен|крыш/],
    ["city", /city|street|town|город|улиц/],
    ["industrial", /industrial|metal|factory|corridor|металл|завод|коридор/],
    ["night", /night|ночь|ночн/],
  ]) ?? "room";
  const surface = first([
    ["snow", /snow|снег/], ["carpet", /carpet|ковр|ковёр/], ["metal", /metal floor|металлическ\S* пол/],
    ["wood", /wooden floor|boardwalk|timber floor|деревянн\S* пол|дощат/],
    ["tile", /tile|плит/], ["gravel", /gravel|грав|щеб/], ["grass", /grass|forest|trail|трав|лес|троп/],
  ]) ?? "concrete";
  return { ambience, surface, ambienceGain: 0.45, stepsGain: 0.7 };
}

export async function generateSoundPlan(model, input) {
  const started = performance.now();
  try {
    const result = await model.generate(
      `Plan procedural location audio. Choose ambience for the environment and weather, and surface for the floor the actor actually walks on. No music or voices. rain means active rainfall, not merely wet pavement after rain. forest includes wind and sparse birds; night includes insects; industrial includes ventilation hum. Keep ambience restrained so footsteps remain audible. Return only the requested JSON.`,
      input, soundSchema, { label: "panorama_sound", maxTokens: 700, validateResult: validateSoundPlan },
    );
    validateSoundPlan(result.value);
    return { sound: { version: 1, ...result.value }, metadata: {
      stage: "Звук", provider: result.provider, model: result.model, ms: result.ms,
    } };
  } catch {
    // Sound is optional enrichment: a provider failure must not lose the artwork.
    return { sound: { version: 1, ...fallbackSoundPlan(`${input.brief} ${input.visualBrief?.setting ?? ""}`) },
      metadata: { stage: "Звук", provider: "local", model: "procedural-fallback", ms: Math.round(performance.now() - started) } };
  }
}

// Walk animation has two contacts per cycle. Use global scene time just as the pose does.
export function footfallsBetween(route, from, to, interval = 0.46) {
  const result = [];
  for (const leg of route) {
    if (leg.startX === leg.endX) continue;
    const start = Math.max(from, leg.departureAt);
    const end = Math.min(to, leg.arrivalAt);
    for (let i = Math.max(0, Math.ceil((start - 1e-9) / interval)); i * interval < end - 1e-9; i++) {
      result.push({ at: i * interval, index: i });
    }
  }
  return result;
}
