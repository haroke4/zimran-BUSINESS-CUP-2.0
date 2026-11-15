import assert from "node:assert/strict";
import test from "node:test";
import { cityBriefs, layoutFixtures, loadLocation, sanitizeSavedStates } from "../../asset-hypotheses/scene.mjs";

test("unknown saved cabinet state is removed and the cabinet falls back to its default", () => {
  const layout = layoutFixtures.wet;
  const result = sanitizeSavedStates(layout, { cache: "burning", batteryChoice: "taken" });
  assert.deepEqual(result.recovered, [{ instance: "cache", removed: "burning", fallback: "closed" }]);
  assert.equal(result.states.cache, undefined);
  assert.ok(result.dropped.includes("batteryChoice"));
});

test("valid saved cabinet state is preserved", () => {
  const result = sanitizeSavedStates(layoutFixtures.wet, { cache: "open" });
  assert.deepEqual(result.recovered, []);
  assert.equal(result.states.cache, "open");
});

test("loadLocation still rejects unknown state so recovery stays explicit", () => {
  assert.throws(
    () => loadLocation(layoutFixtures.wet, { brief: cityBriefs.wet }, { cache: "burning" }),
    /Unknown saved state/,
  );
});
