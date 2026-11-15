import assert from "node:assert/strict";
import test from "node:test";
import { paintObjects, planObjectCommands, stageObjects, validateObjectScript } from "./object-staging.mjs";
import { compileObjectTimeline, objectContact, objectTransform } from "./object-timeline.mjs";

const objects = [
  { id: "lamp", kind: "light", label: "Lamp", initial: "on", anchor: "end" },
  { id: "door", kind: "door", label: "Door", initial: "closed", anchor: "end" },
];
const positions = new Map([["start", { x: 20 }], ["end", { x: 110 }]]);
const route = [{ from: "start", to: "end", startX: 20, endX: 110, departureAt: 0, arrivalAt: 5 }];

test("a change stops the loop, and a door moves only after the actor reaches for it", () => {
  const commands = [
    { op: "loop", target: "lamp", state: "off", at: 0.5, duration: 0.1, period: 1 },
    { op: "change", target: "lamp", state: "off", at: 4, duration: 0.2 },
    { op: "interact", target: "door", state: "open", at: 5, duration: 1 },
  ];
  const timeline = compileObjectTimeline(stageObjects(objects, commands, positions, route, 72, 160), commands);
  assert.equal(timeline.frame(0.75).poses.get("lamp").opacity, 0);
  assert.equal(timeline.frame(1.25).poses.get("lamp").opacity, 1);
  assert.equal(timeline.frame(5.2).poses.get("lamp").opacity, 0);
  assert.equal(timeline.frame(5.2).interaction.target, "door");
  assert.equal(timeline.frame(5.2).poses.get("door").scaleX, 1);
  assert.ok(timeline.frame(5.75).poses.get("door").scaleX < 1);
  assert.ok(Math.abs(timeline.frame(7).poses.get("door").scaleX - 0.13) < 1e-8);
  assert.equal(timeline.frame(7).interaction, undefined);
  assert.equal(timeline.frame(3).poses.get("door").state, "closed");
  assert.equal(timeline.frame(1.25).poses.get("lamp").opacity, 1);
});

test("an interaction is rejected if the character is still travelling", () => {
  const command = { op: "interact", target: "door", state: "open", at: 4, duration: 1 };
  assert.throws(() => stageObjects(objects, [command], positions, route, 72, 160), /должен успеть остановиться/);
});

test("a boom barrier rotates upward in either walking direction without an opaque doorway", () => {
  for (const side of [-1, 1]) {
    const startX = side > 0 ? 20 : 140;
    const endX = 80;
    const path = [{ from: "start", to: "end", startX, endX, departureAt: 0, arrivalAt: 5 }];
    const marks = new Map([["start", { x: startX }], ["end", { x: endX }]]);
    const props = [{ id: "boom", kind: "barrier", label: "Wooden boom barrier", initial: "closed", anchor: "end" }];
    const commands = [{ op: "interact", target: "boom", state: "open", at: 5, duration: 1 }];
    validateObjectScript(props, commands, ["start", "end"]);
    const [barrier] = stageObjects(props, commands, marks, path, 72, 160);
    const timeline = compileObjectTimeline([barrier], commands);
    const closed = timeline.frame(0).poses.get("boom");
    const halfway = timeline.frame(5.85).poses.get("boom");
    const opened = timeline.frame(7).poses.get("boom");
    assert.equal(barrier.opening, undefined);
    assert.equal(barrier.boom.height, 1.3);
    assert.equal(closed.angle, 0);
    assert.ok(Math.abs(halfway.angle - -41 * side) < 1e-8);
    assert.equal(opened.angle, -82 * side);
    assert.equal(objectContact(barrier, closed).y, barrier.contact.y);
    assert.ok(objectContact(barrier, opened).y < barrier.contact.y);
    assert.match(objectTransform(barrier, opened), /^rotate\(/);
    assert.equal(timeline.frame(0).poses.get("boom").angle, 0);
    const [painted] = paintObjects([barrier], { boom: {
      gradients: [], recessColor: "#1c3229",
      fixed: ["r #73634b 81 61 2 11"], moving: ["r #b4a07a 70 60 40 12"],
    } }, 160);
    assert.equal(painted.recessColor, undefined);
    assert.match(painted.movingSvg, /clipPath id="object-boom-0"/);
  }
});

test("a cloud cue fades natural sunlight without creating a door opening", () => {
  const { objects: props, commands } = planObjectCommands([
    { id: "sun", kind: "sunlight", label: "Sunbeam at the tower", anchor: "end", initial: "on",
      behavior: "on_cue", cue: "cloud" },
  ], positions, route, [{ cue: "cloud", at: 7 }]);
  validateObjectScript(props, commands, ["start", "end"]);
  const [sun] = stageObjects(props, commands, positions, route, 72, 160);
  assert.equal(sun.opening, undefined);
  const timeline = compileObjectTimeline([sun], commands);
  assert.equal(timeline.frame(0).poses.get("sun").opacity, 1);
  assert.equal(timeline.frame(8).poses.get("sun").opacity, 0);
  assert.equal(timeline.frame(0).poses.get("sun").opacity, 1);
});
