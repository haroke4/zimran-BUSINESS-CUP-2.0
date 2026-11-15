import assert from "node:assert/strict";
import test from "node:test";
import { createStoryEngine } from "../engine.mjs";
import { SceneGenerationError } from "../errors.mjs";
import { createModelClient } from "../model-client.mjs";
import { MemoryStore } from "../store.mjs";
import {
  choiceFor, createFakeModel, genericComposer, genericWriter, makeEngineOptions,
  requestId, runEpisode, signWriter,
} from "./helpers.mjs";

function engineWith(model) {
  const options = makeEngineOptions({ model });
  return { engine: createStoryEngine(options), store: options.store, model };
}

test("the second-scene battery choice persists and changes the scene 6, 7 and 10 consequences", async () => {
  const takeModel = createFakeModel();
  const take = engineWith(takeModel);
  const takeRun = await runEpisode(take.engine, { branch: "take" });
  assert.equal(takeRun.episode.current.number, 10);
  assert.equal(takeRun.episode.revision, 10);
  assert.equal(takeRun.episode.progress.facts["battery.taken"], true);
  assert.equal(takeRun.episode.progress.facts["battery.owner"], "mara");
  assert.equal(takeRun.episode.progress.choices[1].choiceId, "take_battery");
  assert.equal(takeRun.transcript.find((entry) => entry.scene === 6).consequence, "radio_powered");
  assert.equal(takeRun.transcript.find((entry) => entry.scene === 7).consequence, "signal_located");
  assert.equal(takeRun.episode.current.consequence.id, "airlock_answers");
  assert.equal(takeRun.episode.progress.visitedLayouts["rainy-crossing"].firstScene, 1);
  assert.equal(takeRun.episode.progress.visitedLayouts["rainy-crossing"].lastScene, 10);
  assert.equal(takeRun.episode.progress.props["rainy-crossing"].cache, "open");
  assert.equal(takeModel.calls.composer, 13, "location composition plus one staging call per scene");
  assert.equal(takeModel.calls.writer, 10);

  const finalPick = takeRun.episode.current.choices[0];
  const finished = await take.engine.submitChoice(takeRun.episode.id, {
    revision: takeRun.episode.revision,
    requestId: requestId("take-final"),
    choice: { id: finalPick.id, effects: finalPick.effects },
  });
  assert.equal(finished.complete, true);
  assert.equal(finished.episode.status, "complete");
  assert.equal(finished.episode.revision, 10);
  assert.match(finished.episode.current.outcome.text, /power/);
  assert.equal(finished.episode.progress.choices.length, 10);

  const leaveModel = createFakeModel();
  const leave = engineWith(leaveModel);
  const leaveRun = await runEpisode(leave.engine, { branch: "leave" });
  assert.equal(leaveRun.episode.progress.facts["battery.taken"], false);
  assert.equal(leaveRun.episode.progress.facts["battery.owner"], "cache");
  assert.equal(leaveRun.episode.progress.choices[1].choiceId, "leave_battery");
  assert.equal(leaveRun.transcript.find((entry) => entry.scene === 6).consequence, "radio_dead");
  assert.equal(leaveRun.transcript.find((entry) => entry.scene === 7).consequence, "signal_lost");
  assert.equal(leaveRun.episode.current.consequence.id, "airlock_silent");
  assert.notEqual(
    leaveRun.episode.current.consequence.id,
    takeRun.episode.current.consequence.id,
  );
  assert.notEqual(
    leaveRun.transcript.find((entry) => entry.scene === 6).consequence,
    takeRun.transcript.find((entry) => entry.scene === 6).consequence,
  );
});

test("repeated and concurrent retries advance the revision exactly once", async () => {
  const model = createFakeModel({ delayMs: 5 });
  const { engine } = engineWith(model);
  const initial = await engine.createEpisode();
  const choice = choiceFor(initial.current, 0);
  const body = {
    revision: initial.revision,
    requestId: requestId("retry-once"),
    choice: { id: choice.id, effects: choice.effects },
  };
  const [first, second] = await Promise.all([
    engine.submitChoice(initial.id, body),
    engine.submitChoice(initial.id, body),
  ]);
  assert.equal(first.episode.revision, 2);
  assert.equal(second.episode.revision, 2);
  assert.equal(model.calls.writer, 2, "initial scene plus one next scene");
  assert.ok(first.replayed === false || second.replayed === false);
  assert.ok(first.replayed === true || second.replayed === true);

  const repeated = await engine.submitChoice(initial.id, body);
  assert.equal(repeated.replayed, true);
  assert.equal(repeated.episode.revision, 2);
  assert.equal(model.calls.writer, 2);

  await assert.rejects(
    engine.submitChoice(initial.id, { ...body, requestId: requestId("stale") }),
    (error) => error.code === "stale_revision" && error.currentRevision === 2,
  );

  const resumed = await engine.getEpisode(initial.id);
  assert.equal(resumed.revision, 2);
  assert.equal(resumed.resumed, true);
  assert.equal(model.calls.writer, 2, "resume must not generate a scene");
});

test("tampered typed effects are rejected before generation", async () => {
  const model = createFakeModel();
  const { engine } = engineWith(model);
  const initial = await engine.createEpisode();
  const choice = choiceFor(initial.current, 0);
  await assert.rejects(
    engine.submitChoice(initial.id, {
      revision: initial.revision,
      requestId: requestId("tampered"),
      choice: { id: choice.id, effects: [{ op: "set", path: "battery.taken", value: true }] },
    }),
    (error) => error.code === "effect_mismatch",
  );
  assert.equal(model.calls.writer, 1);
  assert.equal((await engine.getEpisode(initial.id)).revision, 1);
});

test("malformed writer JSON is retried inside the model client and then staged", async () => {
  let writerCalls = 0;
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    const name = body.response_format.json_schema.name;
    const input = JSON.parse(body.messages[1].content);
    if (name === "framebreak_layout" || name === "framebreak_staging") {
      return {
        ok: true,
        async json() {
          const value = genericComposer(input);
          if (name === "framebreak_staging") {
            return { choices: [{ message: { content: JSON.stringify(value.choreography) } }], usage: {} };
          }
          delete value.choreography;
          return { choices: [{ message: { content: JSON.stringify(value) } }], usage: {} };
        },
      };
    }
    writerCalls += 1;
    const content = writerCalls === 1 ? "not json at all" : JSON.stringify(genericWriter(input));
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content } }], usage: {} };
      },
    };
  };
  const model = createModelClient({
    baseUrl: "http://local.test/v1",
    model: "local-model",
    fetchImpl,
    retryDelayMs: 1,
    logger: { warn() {} },
  });
  const { engine } = engineWith(model);
  const episode = await engine.createEpisode();
  assert.equal(writerCalls, 2);
  assert.equal(episode.current.validation.technical.writer.attempts, 2);
  assert.equal(episode.current.validation.narrative.ok, true);
  assert.equal(episode.current.number, 1);
});

test("an ungrounded sign mention is retried with the frame contract and then passes", async () => {
  let calls = 0;
  const model = createFakeModel({
    writer(input) {
      calls += 1;
      return calls === 1 ? signWriter() : genericWriter(input);
    },
  });
  const { engine } = engineWith(model);
  const episode = await engine.createEpisode();
  assert.equal(calls, 2);
  assert.equal(episode.current.validation.narrative.ok, true);
  assert.equal(episode.current.validation.narrative.attempts, 2);
  assert.equal(episode.current.validation.technical.ok, true);
});

test("a persistent ungrounded sign mention fails narrative validation without advancing", async () => {
  const model = createFakeModel({ writer: signWriter });
  const options = makeEngineOptions({ model });
  const failingEngine = createStoryEngine(options);
  await assert.rejects(
    failingEngine.createEpisode(),
    (error) => {
      assert.ok(error instanceof SceneGenerationError);
      assert.equal(error.phase, "narrative");
      assert.equal(error.validation.technical.ok, true);
      assert.equal(error.validation.narrative.ok, false);
      assert.ok(error.validation.narrative.errors.some((message) => message.includes("direction_sign")));
      return true;
    },
  );
  assert.equal(model.calls.writer, 2);
  assert.equal(await options.store.list().then((items) => items.length), 0);
});

test("a broken compositor does not substitute a handcrafted location", async () => {
  const model = createFakeModel({
    composer(input) {
      const value = genericComposer(input);
      delete value.puddleSlot;
      return value;
    },
  });
  const { engine } = engineWith(model);
  await assert.rejects(
    engine.createEpisode(),
    (error) => error instanceof SceneGenerationError && error.phase === "technical",
  );
});

test("model choreography keeps visible motion continuous before the choice", async () => {
  const model = createFakeModel({
    composer(input) {
      return {
        ...genericComposer(input),
        choreography: { arrival: "run", reaction: "walk", reactionTarget: "left", departure: "run", departureTarget: "right" },
      };
    },
  });
  const { engine } = engineWith(model);
  const episode = await engine.createEpisode();
  assert.deepEqual(episode.current.staging.beats, [
    { startMs: 0, durationMs: 6_500, clip: "run", target: "cache" },
    { startMs: 6_500, durationMs: 8_000, clip: "walk", target: "left" },
    { startMs: 14_500, durationMs: 12_500, clip: "run", target: "right" },
  ]);
  assert.equal(episode.current.staging.beats.at(-1).startMs < 20_000, true);
});

test("unknown saved cabinet state recovers visibly and keeps the scene mounted", async () => {
  const model = createFakeModel();
  const { engine, store } = engineWith(model);
  const initial = await engine.createEpisode();
  const calls = { ...model.calls };
  const raw = await store.read(initial.id);
  raw.progress.props["rainy-crossing"].cache = "burning";
  raw.current.location.states.cache = "burning";
  await store.write(raw);

  const resumed = await engine.getEpisode(initial.id);
  assert.equal(resumed.current.location.states.cache, "closed");
  assert.equal(resumed.progress.props["rainy-crossing"].cache, "closed");
  assert.equal(resumed.revision, 1);
  assert.match(resumed.recovery.message, /burning/);
  assert.equal(model.calls.writer, calls.writer);
  assert.equal(model.calls.composer, calls.composer);
});

test("a writer failure leaves the current revision and returns technical validation details", async () => {
  const model = createFakeModel({ writerFailures: 10 });
  const { engine } = engineWith(model);
  await assert.rejects(
    engine.createEpisode(),
    (error) => {
      assert.equal(error.phase, "writer");
      assert.equal(error.validation.technical.ok, false);
      assert.equal(error.validation.narrative.ok, null);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});
