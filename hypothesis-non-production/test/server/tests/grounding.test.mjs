import assert from "node:assert/strict";
import test from "node:test";
import { layoutFixtures } from "../../asset-hypotheses/scene.mjs";
import { collectPlacedVisuals, validateNarrativeGrounding } from "../visual-grounding.mjs";

const streetLayout = layoutFixtures.wet;

test("a fluent mention of a sign fails when the frame has no sign", () => {
  const result = validateNarrativeGrounding({
    texts: ["The neon arrow above the cache points toward the tower. Mara follows it."],
    layout: streetLayout,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("direction_sign")));
  assert.ok(result.references.some((reference) => reference.key === "direction_sign" && !reference.grounded));
  assert.ok(result.references.some((reference) => reference.key === "street_cabinet" && reference.grounded));
});

test("the same fluent sign reference passes when the sign is actually placed", () => {
  const withSign = {
    ...streetLayout,
    placements: [...streetLayout.placements, ["sign", "direction_sign", 5]],
  };
  const result = validateNarrativeGrounding({
    texts: ["The neon arrow above the cache points toward the tower. Mara follows it."],
    layout: withSign,
  });
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("signal and idiomatic sign-of phrasing do not create false visual references", () => {
  const result = validateNarrativeGrounding({
    texts: ["The signal is a sign of trouble. The radio clicks, but the signal points nowhere."],
    layout: streetLayout,
  });
  assert.equal(result.ok, true);
  assert.ok(!result.references.some((reference) => reference.key === "direction_sign"));
});

test("declared references cannot hide an ungrounded prose mention", () => {
  const result = validateNarrativeGrounding({
    texts: ["A neon arrow points down the block."],
    layout: streetLayout,
    declaredRefs: ["sign", "cabinet"],
  });
  assert.equal(result.ok, false);
  assert.ok(result.declared.some((entry) => entry.key === "direction_sign" && entry.grounded === false));
  assert.ok(result.warnings.some((warning) => warning.includes("not placed")));
});

test("the writer receives only visuals that are actually placed", () => {
  const visuals = collectPlacedVisuals(streetLayout, {});
  assert.ok(visuals.some((visual) => visual.id === "street_cabinet"));
  assert.ok(visuals.some((visual) => visual.id === "tall_tower"));
  assert.ok(!visuals.some((visual) => visual.id === "direction_sign"));
  assert.ok(visuals.some((visual) => visual.id === "battery" && visual.kind === "content"));
});
