import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalog, indexCatalog } from "./catalog.mjs";
import {
  anchor, cityBriefs, commitActions, compileAction, compileSolo,
  compositionContext, layoutFixtures, loadLocation, validateLayout,
} from "./scene.mjs";

const generated = JSON.parse(readFileSync(new URL("./assets/model-layouts.json", import.meta.url), "utf8"));
const layoutsToCheck = [
  ...Object.entries(layoutFixtures),
  ...Object.entries(generated).map(([preset, { layout }]) => [preset, layout]),
];
for (const [preset, layout] of layoutsToCheck) {
  const context = compositionContext(cityBriefs[preset]);
  const location = loadLocation(layout, context);
  const open = compileAction(location, {}, { clip: "walk", instance: "cache", action: "open" });
  assert.deepEqual(commitActions({}, open, open.complete - 1), {});
  const saved = JSON.parse(JSON.stringify({ layout, states: commitActions({}, open, open.complete) }));
  const revisit = loadLocation(saved.layout, context, saved.states);
  const omittedId = layout.placements[2][1];
  const changedRetrieval = { ...context, candidates: context.candidates.filter(({ id }) => id !== omittedId) };
  assert.throws(() => validateLayout(layout, changedRetrieval), /not shortlisted/);
  assert.deepEqual(loadLocation(saved.layout, changedRetrieval, saved.states), revisit);
  const cache = revisit.objects.find(({ instance }) => instance === "cache");
  assert.equal(cache.state, "open");
  assert.deepEqual(anchor(cache, "handle"), open.handle);
  assert.throws(() => compileAction(revisit, {}, { clip: "walk", instance: "cache", action: "open" }), /Unavailable/);
  const close = compileAction(revisit, {}, { clip: "run", instance: "cache", action: "close" });
  assert.ok(close.arrive < open.arrive);
  assert.deepEqual(commitActions(saved.states, close, close.complete), { cache: "closed" });

  const [, assetId, slot] = layout.placements.at(-1);
  const duplicate = { ...layout, placements: [...layout.placements, ["dup", assetId, slot]] };
  const unknown = { ...layout, placements: [...layout.placements, ["unknown", "cdn:fake", 0]] };
  const invalidSlot = { ...layout, placements: [...layout.placements, ["outside", assetId, 90]] };
  assert.throws(() => validateLayout(duplicate, context), /Occupied slot/);
  assert.throws(() => validateLayout(unknown, context), /not shortlisted/);
  assert.throws(() => loadLocation(unknown, context), /not shortlisted/);
  assert.throws(() => validateLayout(invalidSlot, context), /Invalid slot/);
  assert.throws(() => loadLocation(layout, context, { cache: "burning" }), /Unknown saved state/);
}

const dryContext = compositionContext(cityBriefs.dry);
const noSkyline = { ...layoutFixtures.dry, placements: layoutFixtures.dry.placements.filter(([, id]) => catalog.find((asset) => asset.id === id).layer !== "skyline") };
assert.doesNotThrow(() => validateLayout(noSkyline, dryContext));
assert.throws(() => validateLayout(noSkyline, { ...dryContext, brief: { ...dryContext.brief, requiresSkyline: true } }), /skyline/);
assert.doesNotThrow(() => validateLayout(layoutFixtures.dry, { ...dryContext, brief: { ...dryContext.brief, requiresSkyline: true } }));

for (const animation of ["jump", "fly", "cry", "die"]) {
  assert.ok(compileSolo(animation).complete > 300);
}

const cabinet = catalog.find(({ id }) => id === "street_cabinet");
assert.equal(indexCatalog([...catalog, { ...cabinet, id: "clinic_cabinet" }]).size, catalog.length + 1);
assert.throws(() => indexCatalog([...catalog, cabinet]), /duplicate asset/);
assert.throws(() => indexCatalog([null]), /Invalid or duplicate asset/);
assert.throws(() => indexCatalog([{ ...cabinet, id: { toString: () => "cabinet" } }]), /Invalid or duplicate asset/);
for (const change of [
  { file: "../cabinet.svg" }, { layer: "toString" }, { size: [1, 0] },
  { tags: [1] }, { capabilities: [1] }, { overlay: "../door.svg" },
  { states: { closed: 2 }, defaultState: "closed" }, { transitions: [null] },
  { transitions: [cabinet.transitions[0], cabinet.transitions[0]] },
]) assert.throws(() => indexCatalog([{ ...cabinet, ...change }]));
assert.throws(() => indexCatalog([{ ...cabinet, anchors: {} }]), /anchors/);
assert.throws(() => indexCatalog([{
  ...cabinet,
  transitions: [{ ...cabinet.transitions[0], to: "unknown" }],
}]), /Invalid prop transition/);

console.log("Scene checks passed: authored and model layouts, open/close, revisit, timing, slot and state validation, manifest onboarding.");
