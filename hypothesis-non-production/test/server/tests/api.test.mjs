import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../app.mjs";
import { createStoryEngine } from "../engine.mjs";
import { MemoryStore } from "../store.mjs";
import { createFakeModel, requestId } from "./helpers.mjs";

async function start(options = {}) {
  const model = options.model ?? createFakeModel();
  const store = options.store ?? new MemoryStore();
  const engine = createStoryEngine({
    model,
    store,
    logger: { info() {}, warn() {}, error() {} },
  });
  const server = createApiServer({
    engine,
    model,
    logger: { info() {}, warn() {}, error() {} },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    server,
    store,
    model,
    engine,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("API exposes health, creates an episode, and enforces revision plus request idempotency", async (t) => {
  const app = await start();
  t.after(() => app.close());

  const health = await fetch(`${app.base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).model.ok, true);

  const created = await fetch(`${app.base}/api/episodes`, { method: "POST" });
  assert.equal(created.status, 201);
  const initial = (await created.json()).episode;
  assert.equal(initial.revision, 1);
  assert.equal(initial.current.number, 1);
  assert.equal(initial.progress.visitedLayouts["rainy-crossing"].firstScene, 1);

  const choice = initial.current.choices[0];
  const body = {
    revision: initial.revision,
    requestId: requestId("api-once"),
    choice: { id: choice.id, effects: choice.effects },
  };
  const first = await fetch(`${app.base}/api/episodes/${initial.id}/choices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(first.status, 200);
  const advanced = await first.json();
  assert.equal(advanced.episode.revision, 2);
  assert.equal(advanced.replayed, false);

  const repeated = await fetch(`${app.base}/api/episodes/${initial.id}/choices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(repeated.status, 200);
  const replay = await repeated.json();
  assert.equal(replay.episode.revision, 2);
  assert.equal(replay.replayed, true);

  const stale = await fetch(`${app.base}/api/episodes/${initial.id}/choices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, requestId: requestId("api-stale") }),
  });
  assert.equal(stale.status, 409);
  const staleBody = await stale.json();
  assert.equal(staleBody.error.code, "stale_revision");
  assert.equal(staleBody.error.currentRevision, 2);

  const resumed = await fetch(`${app.base}/api/episodes/${initial.id}`);
  assert.equal(resumed.status, 200);
  const resumedBody = await resumed.json();
  assert.equal(resumedBody.episode.revision, 2);
  assert.equal(resumedBody.resumed, true);
  assert.equal(resumedBody.episode.progress.choices[0].requestId, body.requestId);
});

test("API returns technical and narrative validation details on a grounded failure", async (t) => {
  const model = createFakeModel({ writerFailures: 10 });
  const app = await start({ model });
  t.after(() => app.close());
  const response = await fetch(`${app.base}/api/episodes`, { method: "POST" });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.code, "scene_generation_failed");
  assert.equal(body.error.phase, "writer");
  assert.equal(body.error.validation.technical.ok, false);
  assert.equal(body.error.validation.narrative.ok, null);
  assert.equal(body.error.retryable, true);
});
