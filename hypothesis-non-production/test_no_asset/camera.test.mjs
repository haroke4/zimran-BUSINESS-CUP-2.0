import assert from "node:assert/strict";
import test from "node:test";
import { cameraFrame, pixelsPerUnit, viewport } from "./panorama.mjs";

test("closer framing keeps the full actor and floor visible along every walk baseline", () => {
  for (const groundY of [59, 70, 79]) {
    for (const actorX of [6, 80, 240, 474]) {
      const frame = cameraFrame(480, actorX, groundY);
      assert.ok(frame.x >= 0 && frame.x + frame.width <= 480);
      assert.ok(frame.y >= 0 && frame.y + frame.height <= viewport.height);
      assert.ok(groundY - 16 >= frame.y + 3, "head has room above it");
      assert.ok(groundY <= frame.y + frame.height - 4, "feet have visible floor below");
      assert.ok(actorX >= frame.x && actorX <= frame.x + frame.width);
      assert.ok(Math.abs(frame.width / frame.height - 16 / 9) < 1e-10);
      assert.ok(Math.abs(16 / frame.height - 0.32) < 1e-10, "actor occupies about a third of frame height");
    }
  }
  assert.equal(pixelsPerUnit, 10, "camera zoom does not change world or interaction scale");
});

test("camera follows continuous movement, clamps at boundaries and repeats exactly on seeking", () => {
  const a = cameraFrame(480, 240, 72);
  const b = cameraFrame(480, 240.01, 72);
  assert.ok(Math.abs(b.x - a.x - 0.01) < 1e-10);
  assert.equal(cameraFrame(480, 6, 72).x, 0);
  const last = cameraFrame(480, 474, 72);
  assert.equal(last.x + last.width, 480);
  assert.deepEqual(cameraFrame(480, 240, 72), a);
});

test("a conversation can widen to fit two nearby actors and overview remains available", () => {
  const close = cameraFrame(480, 180, 72);
  const pair = cameraFrame(480, 180, 72, { focusXs: [260] });
  assert.ok(pair.width > close.width);
  assert.ok(180 - pair.x >= 12 && pair.x + pair.width - 260 >= 12);
  const overview = cameraFrame(480, 180, 72, { zoom: 1 });
  assert.equal(overview.width, 160);
  assert.equal(overview.height, 90);
  assert.equal(overview.y, 0);
});
