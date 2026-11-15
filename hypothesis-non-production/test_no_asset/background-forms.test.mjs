import assert from "node:assert/strict";
import test from "node:test";
import { backgroundFormLayers, lookoutMarks, treeMarks } from "./background-forms.mjs";
import { compileLayer } from "./geometry.mjs";
import { generateScene } from "./scene.mjs";

const tree = { x: 30, baseY: 72, height: 58, crownWidth: 25, trunkPercent: 24, variant: 17,
  bark: "#70503a", foliage: "#386553", shade: "#294f44", depth: "middle" };
const tower = { x: 100, baseY: 72, height: 46, width: 24,
  timber: "#795a43", roof: "#504334", shade: "#4e3c2d" };
const coordinates = mark => mark.split(/\s+/).slice(2).join(" ").match(/-?\d+(?:\.\d+)?/g).map(Number);

test("a conifer has a separately colored slender trunk exposed below its irregular crown", () => {
  const marks = treeMarks(tree);
  const trunk = coordinates(marks[0]), crown = coordinates(marks[1]);
  const xs = values => values.filter((_, index) => index % 2 === 0);
  const ys = values => values.filter((_, index) => index % 2 === 1);
  assert.equal(Math.max(...ys(trunk)), tree.baseY);
  assert.ok(Math.max(...ys(crown)) < tree.baseY - tree.height * 0.15);
  assert.ok(Math.max(...xs(trunk)) - Math.min(...xs(trunk)) < tree.crownWidth * 0.15);
  assert.ok(crown.length > 40, "branch shoulders occupy the whole crown instead of a single triangle");
  assert.match(marks[0], /#70503a/);
  assert.match(marks[1], /#386553/);
  assert.notDeepEqual(treeMarks({ ...tree, variant: 3 }), marks);
  assert.deepEqual(treeMarks(tree), marks, "rewinding/exporting preserves the same tree");
});

test("all tower parts compile, including a connected deck, supported roof and many ladder rungs", () => {
  let invalid = 0;
  const marks = lookoutMarks(tower);
  const svg = compileLayer({ gradients: [], marks }, 0, "0 0 160 90", { onInvalidMark: () => invalid++ });
  assert.equal(invalid, 0);
  assert.equal((svg.match(/<(?:path|rect)\b/g) ?? []).length, marks.length);
  assert.ok((svg.match(/<rect\b/g) ?? []).length >= 12, "platform, rails and ladder rungs survive compilation");
  assert.ok(marks.some(mark => mark.startsWith("r #795a43 88 42.1 24 ")), "deck spans and joins the support tops");
  assert.throws(() => treeMarks({ ...tree, trunkPercent: 0 }), /exposed trunk/);
  assert.throws(() => lookoutMarks({ ...tower, width: -2 }), /invalid size/);
  assert.throws(() => treeMarks({ ...tree, bark: "url(external)" }), /hex colors/);
});

test("generated forms are included in scene geometry and ordered behind landmarks and lighting", async () => {
  const forms = backgroundFormLayers({ trees: [tree], lookouts: [tower] });
  assert.equal(forms.forest.length, 1);
  assert.equal(forms.structures.length, 1);
  const plan = { title: "Forest", groundY: 72, design: "A forest with a lookout",
    visualBrief: { setting: "Forest", lighting: "Day", landmarks: [{ label: "Lookout", x: 100, silhouette: "Wooden tower" }] },
    marks: [{ id: "start", label: "Start", x: 8 }, { id: "end", label: "End", x: 145 }], props: [] };
  const plane = (name, mark) => ({ name, material: name, mark, gradients: [] });
  const artwork = { baseColor: "#b4cdd2", trees: [tree], lookouts: [tower],
    planes: { upper: plane("Sky", "r #b4cdd2 0 0 160 90"), middle: plane("Distance", "r #829f92 0 30 160 42"),
      ground: plane("Ground", "r #6a7b50 0 72 160 18") },
    layers: [{ name: "Rock", role: "scenery", gradients: [], marks: ["r #65756b 140 69 3 3"] },
      { name: "Sun", role: "light", gradients: [], marks: ["e #fff4c5@0.2 100 72 20 3"] }] };
  const detail = Object.fromEntries(["upper", "middle", "ground"].map(key => [key,
    { tile: { x: 0, y: 0, width: 160, height: 90, motif: [] }, accents: [] }]));
  const model = { async generate(prompt, input, schema, options) {
    const value = { panorama_layout: plan, panorama_art: artwork, panorama_detail: detail,
      panorama_sound: { ambience: "forest", surface: "grass", ambienceGain: 0.4, stepsGain: 0.7 } }[options.label];
    options.validateResult(value);
    return { value, model: "fixture", provider: "fixture", ms: 0 };
  } };
  const scene = await generateScene(model, "Forest and lookout", undefined);
  const names = scene.layers.map(({ name }) => name);
  assert.ok(names.indexOf("middle trees") < names.indexOf("Rock"));
  assert.ok(names.indexOf("Raised lookout structures") < names.indexOf("Sun"));
  assert.match(scene.layers.find(({ name }) => name === "middle trees").svg, /#70503a/);
  assert.ok(scene.layers.find(({ name }) => name === "Raised lookout structures").svg.includes("#795a43"));
});
