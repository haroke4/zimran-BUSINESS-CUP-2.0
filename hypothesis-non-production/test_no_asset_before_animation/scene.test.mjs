import assert from "node:assert/strict";
import test from "node:test";
import { compileLayer } from "./geometry.mjs";
import { cameraLeft, isResolvedTravel, positionAt } from "./panorama.mjs";
import { generateScene } from "./scene.mjs";

const travel = [
  { cue: "walk_to_window", from: "stairs", to: "window", departureAt: 0, arrivalAt: 6 },
  { cue: "walk_to_gate", from: "window", to: "gate", departureAt: 14, arrivalAt: 21 },
];
const beats = [{ at: 7, cue: "window_blackout", screen: "Лампа гаснет." }];
const design = {
  title: "Служебный проход",
  groundY: 70,
  design: "Stairs on the left, a window in the centre and a gate on the right, joined by the same roof and floor.",
  marks: [
    { id: "stairs", label: "Лестница", x: 22 },
    { id: "window", label: "Окно", x: 225 },
    { id: "gate", label: "Решётка", x: 454 },
  ],
};
const artwork = { baseColor: "#151528", planes: {
  upper: { name: "Ceiling", material: "Reinforced concrete", mark: "r #242233 0 0 480 10", gradients: [] },
  middle: { name: "Walls", material: "Metal cladding", mark: "r #40384a 0 7 480 59", gradients: [] },
  ground: { name: "Floor", material: "Floor tiles", mark: "p #292439 M0 66H480V90H0Z", gradients: [] },
}, layers: [
  { name: "Corridor", role: "scenery", gradients: [], marks: [
    "r #4c4056 0 7 480 59", "r #493a3c 11 56 8 10", "r #493a3c 20 53 9 13", "r #493a3c 30 49 9 17",
    "r #282943 200 26 50 20", "r #8d8d9f 202 28 46 16",
    "r #4d3640 440 25 28 40", "r #18171c 444 27 20 36",
    "r #b2816e 446 27 2 38", "r #b2816e 455 27 2 38", "r #b2816e 463 27 2 38",
    "p #282938 M100 20L150 26V66H100Z", "s #655875 0.4 M0 73H480", "r #111928 0 65 480 1",
    "r #c18666 220 30 10 1",
  ] },
  { name: "Light", role: "light", gradients: [], marks: ["e #aa6747@0.2 225 70 28 4"] },
] };
const finish = Object.fromEntries(["upper", "middle", "ground"].map(plane => [plane, {
  tile: { x: 0, y: 66, width: 24, height: 10, motif: [
    "p #655875 M0 66H24", "s #655875 0.4 M12 66V76", "e #9e7887 4 68 1 0.5",
  ] },
  accents: ["s #bb986c 0.4 M120 78H135"],
}]));

test("a generated panorama preserves the master route and a separate 16:9 camera", async () => {
  const calls = [];
  const model = {
    async generate(prompt, input, schema, options) {
      calls.push(input);
      const value = [design, artwork, finish][calls.length - 1];
      options.validateResult(value);
      return { value, model: "example", provider: "example", ms: 0 };
    },
  };
  const scene = await generateScene(model, "Длинный служебный коридор", undefined, { screens: 3, travel, beats });
  assert.equal(calls[0].worldWidth, 480);
  assert.deepEqual(calls[0].requiredMarkIds, ["stairs", "window", "gate"]);
  assert.deepEqual(calls[1].plan, design);
  assert.deepEqual(calls[2].artwork.planes, artwork.planes);
  assert.deepEqual(scene.viewport, { width: 1600, height: 900 });
  assert.deepEqual([scene.width, scene.height], [4800, 900]);
  assert.match(scene.layers[3].svg, /x="463"/);
  assert.match(scene.layers[2].svg, /<pattern id="layer-2-surface-0-pattern" patternUnits="userSpaceOnUse"/);
  assert.match(scene.layers[2].svg, /<clipPath id="layer-2-surface-0-clip"><path d="M0 66H480V90H0Z"/);
  assert.match(scene.layers[2].svg, /viewBox="0 66 24 10"/);
  assert.match(scene.layers[2].svg, /d="M0 66H24" fill="none" stroke="#655875"/);
  assert.doesNotMatch(scene.layers[1].svg, /<pattern\b/);
  assert.match(scene.layers[3].svg, /fill="#4c4056" opacity="1"\/><rect[^>]+ fill="url\(#layer-3-mark-0-pattern\)"/);
  assert.doesNotMatch(scene.layers.map(({ svg }) => svg).join(""), /<image\b|data:image/i);
  assert.match(scene.layers[0].svg, /viewBox="0 0 480 90"/);
  assert.deepEqual(scene.staging.route.map(({ startX, endX, departureAt, arrivalAt }) => (
    [startX, endX, departureAt, arrivalAt]
  )), [[22, 225, 0, 6], [225, 454, 14, 21]]);
  assert.deepEqual(scene.beats, beats);
});

test("camera and actor stay within bounds, respect a stop, and can move back left", () => {
  const route = [
    { startX: 22, endX: 454, departureAt: 0, arrivalAt: 6 },
    { startX: 454, endX: 22, departureAt: 14, arrivalAt: 21 },
  ];
  assert.equal(cameraLeft(160, 150), 0);
  assert.equal(cameraLeft(480, 22), 0);
  assert.equal(cameraLeft(480, 454), 320);
  assert.deepEqual(positionAt(route, 10), { x: 454, facing: 1, walking: false });
  assert.deepEqual(positionAt(route, 17.5), { x: 238, facing: -1, walking: true });
  assert.equal(cameraLeft(480, positionAt(route, 17.5).x), 158);
  assert.equal(positionAt(route, 25).x, 22);
  assert.ok(isResolvedTravel(travel));
  assert.equal(isResolvedTravel([travel[0], { ...travel[1], departureAt: 5 }]), false);
});

test("the vector compiler rejects arbitrary XML, external paints and undeclared gradients", () => {
  for (const mark of [
    'p #112233 M0 0Z"/><script>',
    'r url(https://example.com/paint) 0 0 160 90',
    'r $unknown 0 0 160 90',
  ]) {
    assert.throws(() => compileLayer({ gradients: [], marks: [mark] }, 0, "0 0 160 90"));
  }
});
