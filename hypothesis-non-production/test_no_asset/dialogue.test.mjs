import assert from "node:assert/strict";
import test from "node:test";
import { compileDialogue, makeDialogueDemo, validateDialogue } from "./dialogue.mjs";

const dialogue = {
  actors: [{ id: "mara", name: "Мара" }, { id: "ranger", name: "Лесник", x: 80 }],
  lines: [{ speaker: "ranger", text: "Я здесь.", at: 5, duration: 2 }, { speaker: "mara", text: "Кто это?", at: 2, duration: 2 }],
};

test("dialogue resolves turns and gaps deterministically when seeking backwards", () => {
  const track = compileDialogue(dialogue);
  assert.equal(track.frame(1).active, false);
  assert.equal(track.frame(2).speaker.id, "mara");
  assert.equal(track.frame(3).progress, 0.5);
  assert.equal(track.frame(4).line, undefined);
  assert.equal(track.frame(4).active, true);
  assert.equal(track.frame(5).speaker.id, "ranger");
  assert.equal(track.frame(7).line, undefined);
  assert.equal(track.frame(7).active, false);
  assert.equal(track.frame(2).speaker.id, "mara");
  assert.equal(dialogue.lines[0].speaker, "ranger");
});

test("dialogue rejects unknown speakers, overlapping turns and off-world partners", () => {
  assert.throws(() => validateDialogue({ ...dialogue, lines: [{ speaker: "unknown", text: "Hi", at: 0, duration: 2 }] }));
  assert.throws(() => validateDialogue({ ...dialogue, lines: [...dialogue.lines, { speaker: "mara", text: "Hi", at: 3, duration: 3 }] }));
  assert.throws(() => validateDialogue(dialogue, { worldWidth: 70 }));
  assert.throws(() => validateDialogue({ ...dialogue, actors: [dialogue.actors[0], dialogue.actors[0]] }));
});

test("demo keeps the partner in bounds and begins only after travel and interaction finish", () => {
  const scene = { width: 1600, staging: { route: [{ startX: 20, endX: 153, arrivalAt: 6 }] },
    commands: [{ op: "interact", at: 6, duration: 1 }] };
  const demo = makeDialogueDemo(scene);
  validateDialogue(demo, { worldWidth: 160 });
  assert.equal(demo.actors[1].x, 136);
  assert.ok(demo.lines[0].at > 7.65);
  assert.ok(compileDialogue(demo).duration > 20);
  assert.equal(compileDialogue().frame(2).active, false);
});
