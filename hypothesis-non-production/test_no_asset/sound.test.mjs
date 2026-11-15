import assert from "node:assert/strict";
import test from "node:test";
import { fallbackSoundPlan, footfallsBetween, generateSoundPlan, validateSoundPlan } from "./sound-plan.mjs";

test("sound planning uses the scene context and rejects unsupported presets", async () => {
  const input = { brief: "A rainy street", visualBrief: { setting: "City, stone pavement" } };
  const value = { ambience: "rain", surface: "concrete", ambienceGain: 0.4, stepsGain: 0.6 };
  const result = await generateSoundPlan({ async generate(prompt, context, schema, options) {
    assert.equal(context, input);
    assert.equal(options.label, "panorama_sound");
    options.validateResult(value);
    return { value, provider: "example", model: "example", ms: 1 };
  } }, input);
  assert.deepEqual(result.sound, { version: 1, ...value });
  for (const invalid of [{ ...value, surface: "unknown" }, { ...value, stepsGain: Infinity }, { ...value, ambienceGain: -1 }]) {
    assert.throws(() => validateSoundPlan(invalid));
  }
});

test("provider failures and malformed plans retain usable local sound", async () => {
  for (const generate of [async () => { throw new Error("offline"); }, async () => ({ value: {} })]) {
    const result = await generateSoundPlan({ generate }, { brief: "Лесная тропа" });
    assert.equal(result.sound.ambience, "forest");
    assert.equal(result.sound.surface, "grass");
    assert.equal(result.metadata.provider, "local");
  }
  assert.equal(fallbackSoundPlan("Центр города после дождя").ambience, "city");
  assert.equal(fallbackSoundPlan("Снег на деревянном полу").surface, "snow");
});

test("footfalls follow animation phase, exclude rests and work in either direction", () => {
  const route = [
    { departureAt: 0, arrivalAt: 1, startX: 0, endX: 10 },
    { departureAt: 2, arrivalAt: 3, startX: 10, endX: 0 },
    { departureAt: 3, arrivalAt: 4, startX: 0, endX: 0 },
  ];
  const all = footfallsBetween(route, 0, 4);
  assert.deepEqual(all.map(({ index }) => index), [0, 1, 2, 5, 6]);
  const first = footfallsBetween(route, 0, 0.46);
  const second = footfallsBetween(route, 0.46, 4);
  assert.deepEqual([...first, ...second], all);
  assert.deepEqual(footfallsBetween(route, 1, 2), []);
  assert.deepEqual(footfallsBetween(route, 3, 4), []);
});
