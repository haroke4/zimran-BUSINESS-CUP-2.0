import assert from "node:assert/strict";
import test from "node:test";
import { createStoryforkGenerator, readStoryforkAsset } from "../storyfork-scene.mjs";
import { validateSchema } from "../model-client.mjs";

const direction = {
  title: "На палубе",
  world: "ship_crisis",
  environment: "exterior",
  lighting: "night",
  room: "cargo ship storm deck",
  focus: "signal lamp",
  dressing: ["cargo container", "life ring", "metal railing"],
  atmosphere: "rain",
  beat: "На палубе видна сигнальная лампа.",
};

function mockModel(plan, selectLayers) {
  return {
    async generate(_prompt, input, schema, { label }) {
      let value = plan;
      if (label === "storyfork-composition") {
        const slots = schema.properties.layers.properties;
        const layers = Object.fromEntries(Object.entries(slots).map(([slot, spec]) => [
          slot, { id: spec.properties.id.enum[0], state: "" },
        ]));
        const selection = selectLayers(input, layers);
        value = { layers, focusSide: "right", caption: plan.beat, ...selection };
      }
      assert.deepEqual(validateSchema(value, schema), []);
      return { value, attempts: 1, model: "test-gemini", ms: 10 };
    },
  };
}

test("StoryFork assembles a ship scene with existing night and weather art", async () => {
  const model = mockModel(direction, (input, layers) => {
    assert.equal(input.customAvailable, false);
    assert(input.menus.focus.some(({ id }) => id === "ship_signal_lamp"));
    assert(!input.menus.focus.some(({ id }) => id.startsWith("mall_")));
    layers.focus = { id: "ship_signal_lamp", state: "off" };
    layers.weather = { id: "rain_a", state: "default" };
  });
  const progress = [];
  const scene = await createStoryforkGenerator(model)({ brief: direction.beat, allowCustom: true }, (event) => progress.push(event));
  const focus = scene.layers.find(({ slot }) => slot === "focus");
  assert.equal(focus.mode, "night");
  assert(focus.image.endsWith("__off__night.svg"));
  assert(scene.layers.some(({ id }) => id === "sea"));
  assert(scene.layers.some(({ id }) => id === "rain_a"));
  assert.equal(focus.x, 745);
  assert.equal(scene.actor, undefined);
  assert.equal(scene.custom, null);
  assert.equal(scene.diagnostics.attempts, 2);
  assert.deepEqual(progress.map(({ phase }) => phase), ["composition"]);
  assert.match((await readStoryforkAsset(focus.image)).toString(), /<svg\b/);
  assert.equal(await readStoryforkAsset("../stickman/skins.js"), null);
});

test("an unmatched object can become a bounded custom prop only when enabled", async () => {
  const plan = { ...direction, focus: "crystal compass" };
  const model = mockModel(plan, ({ customAvailable, menus }) => {
    assert.deepEqual(menus.focus, []);
    if (customAvailable) return { custom: { shape: "case", label: "Компас" } };
  });
  const generate = createStoryforkGenerator(model);
  const custom = await generate({ brief: "Хрустальный компас", allowCustom: true });
  assert.equal(custom.custom.shape, "case");
  assert.equal(custom.diagnostics.unmatchedFocus, null);
  const skipped = await generate({ brief: "Хрустальный компас", allowCustom: false });
  assert.equal(skipped.custom, null);
  assert.equal(skipped.diagnostics.unmatchedFocus, "crystal compass");
  await assert.rejects(generate({ brief: " " }), { code: "invalid_brief" });
});
