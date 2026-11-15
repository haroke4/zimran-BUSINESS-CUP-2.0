import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assets } from "../asset-hypotheses/catalog.mjs";
import { entryX, floorY, loadLocation, sanitizeSavedStates } from "../asset-hypotheses/scene.mjs";
import { EpisodeError } from "./errors.mjs";
import { composeLocation, stageScene, writeScene } from "./generation.mjs";
import {
  CHOICE_AT_MS, SCENE_COUNT, SCENE_DURATION_MS, applyEffects,
  consequenceFor, entryFor, locations, scenePlan,
} from "./story-plan.mjs";

const now = () => new Date().toISOString();

function emptyProgress() {
  return {
    scene: 0,
    revision: 0,
    facts: {},
    choices: [],
    visitedLayouts: {},
    props: {},
    history: [],
    recoveries: [],
  };
}

function addRecovery(progress, recovery) {
  progress.recoveries.push({ at: now(), ...recovery });
  if (progress.recoveries.length > 30) progress.recoveries.splice(0, progress.recoveries.length - 30);
}

function openableDefaults(layout) {
  const states = {};
  for (const [instance, assetId] of layout.placements) {
    const asset = assets.get(assetId);
    if (asset?.states) states[instance] = asset.defaultState;
  }
  return states;
}

function initializePropStates(layout, states) {
  const next = { ...states };
  for (const [instance, assetId] of layout.placements) {
    const asset = assets.get(assetId);
    if (asset?.states && !Object.hasOwn(next, instance)) next[instance] = asset.defaultState;
  }
  return next;
}

function recentChoices(progress) {
  return progress.choices.slice(-3).map(({ scene, choiceId, label, effects }) => ({
    scene, choiceId, label, effects,
  }));
}

function finalOutcome(episode, canonical) {
  const consequence = consequenceFor(SCENE_COUNT, episode.progress.facts);
  return {
    choiceId: canonical.id,
    label: canonical.label,
    text: consequence?.text ?? (canonical.id === "open_airlock"
      ? "Mara opens the cache. The story ends in the dark."
      : "Mara walks away. The cache stays closed behind her."),
  };
}

function publicEpisode(episode, { resumed = false } = {}) {
  const pending = episode.pending ? {
    requestId: episode.pending.requestId,
    choiceId: episode.pending.choiceId,
    fromRevision: episode.pending.fromRevision,
    startedAt: episode.pending.startedAt,
  } : null;
  return {
    id: episode.id,
    revision: episode.revision,
    status: episode.status,
    createdAt: episode.createdAt,
    updatedAt: episode.updatedAt,
    resumed,
    pending,
    recovery: episode.progress.recoveries.at(-1) ?? null,
    lastFailure: episode.lastFailure ?? null,
    progress: {
      scene: episode.progress.scene,
      revision: episode.progress.revision,
      facts: episode.progress.facts,
      choices: episode.progress.choices,
      visitedLayouts: episode.progress.visitedLayouts,
      props: episode.progress.props,
      history: episode.progress.history,
      recoveries: episode.progress.recoveries,
      recentChoices: recentChoices(episode.progress),
    },
    current: episode.current,
  };
}

export function createStoryEngine({
  model,
  store,
  logger = console,
  allowFallback = true,
  writeSceneImpl = writeScene,
  composeLocationImpl = composeLocation,
} = {}) {
  if (!model || !store) throw new Error("A model client and a store are required");

  async function resolveLocation(episode, beat, sceneNumber, selectedChoice) {
    const progress = episode.progress;
    let visited = progress.visitedLayouts[beat.location];
    let states = progress.props[beat.location] ?? {};
    let notice = null;
    let retrieval = null;
    let technical = null;
    let layout;
    let source;
    let approach = "walk";
    let choreography = { arrival: "walk", reaction: "walk", reactionTarget: "center", departure: "run", departureTarget: "right" };

    if (visited?.layout) {
      const sanitized = sanitizeSavedStates(visited.layout, states);
      for (const item of sanitized.recovered) {
        addRecovery(progress, {
          type: "unknown_prop_state",
          location: beat.location,
          instance: item.instance,
          removed: item.removed,
          fallback: item.fallback,
          message: `Saved state for ${item.instance} was “${String(item.removed)}”; reset to ${item.fallback}.`,
        });
      }
      if (sanitized.dropped.length) {
        addRecovery(progress, {
          type: "dropped_prop_state",
          location: beat.location,
          instances: sanitized.dropped,
          message: `Dropped saved state for unknown props: ${sanitized.dropped.join(", ")}.`,
        });
      }
      states = initializePropStates(visited.layout, sanitized.states);
      progress.props[beat.location] = states;
      layout = visited.layout;
      approach = visited.approach ?? "walk";
      source = visited.source ?? "saved";
      technical = {
        ok: true,
        attempts: 0,
        layout: { ok: true, source: "saved" },
        model: null,
        schema: { ok: true },
      };
      retrieval = { used: false, reason: "saved_layout", candidates: 0 };
      try {
        loadLocation(layout, { brief: locations[beat.location].brief }, states);
      } catch (error) {
        addRecovery(progress, {
          type: "invalid_saved_layout",
          location: beat.location,
          message: `Saved layout for ${beat.location} was invalid (${error.message}); it was rebuilt.`,
        });
        visited = null;
        delete progress.visitedLayouts[beat.location];
        delete progress.props[beat.location];
        states = {};
      }
    }

    if (!visited?.layout) {
      const hint = selectedChoice?.label ? `${beat.intent} Previous choice: ${selectedChoice.label}.` : beat.intent;
      const composed = await composeLocationImpl({ model, beat, hint, logger });
      layout = composed.layout;
      approach = composed.approach ?? "walk";
      source = composed.technical.layout.source;
      technical = composed.technical;
      retrieval = composed.retrieval;
      notice = composed.notice ?? null;
      states = openableDefaults(layout);
      progress.props[beat.location] = states;
      progress.visitedLayouts[beat.location] = {
        layout,
        preset: locations[beat.location].preset,
        firstScene: sceneNumber,
        lastScene: sceneNumber,
        source,
        approach,
      };
      if (notice) {
        addRecovery(progress, {
          type: "compositor_fallback",
          location: beat.location,
          message: notice,
        });
      }
    } else {
      progress.visitedLayouts[beat.location].lastScene = sceneNumber;
      progress.visitedLayouts[beat.location].approach = approach;
    }

    const beforeEntryStates = { ...states };
    const entry = entryFor(beat, progress.facts);
    for (const [path, value] of Object.entries(entry.facts)) {
      if (!Object.hasOwn(progress.facts, path)) {
        progress.facts = applyEffects(progress.facts, [{ op: "set", path, value }]);
      } else if (progress.facts[path] !== value) {
        progress.facts = applyEffects(progress.facts, [{ op: "set", path, value }]);
      }
    }
    for (const [locationId, patches] of Object.entries(entry.props)) {
      if (locationId !== beat.location) continue;
      for (const [instance, state] of Object.entries(patches)) {
        const placement = layout.placements.find(([name]) => name === instance);
        const asset = placement && assets.get(placement[1]);
        if (!asset?.states || !Object.hasOwn(asset.states, state)) {
          throw new EpisodeError("invalid_saved_state", `Scene entry requests an unknown state for ${instance}`, {
            status: 500,
            details: { instance, state },
          });
        }
        states[instance] = state;
      }
      progress.props[beat.location] = states;
    }

    let location;
    try {
      location = loadLocation(layout, { brief: locations[beat.location].brief }, states);
    } catch (error) {
      const sanitized = sanitizeSavedStates(layout, states);
      for (const item of sanitized.recovered) {
        addRecovery(progress, {
          type: "unknown_prop_state",
          location: beat.location,
          instance: item.instance,
          removed: item.removed,
          fallback: item.fallback,
          message: `Saved state for ${item.instance} was “${String(item.removed)}”; reset to ${item.fallback}.`,
        });
      }
      states = initializePropStates(layout, sanitized.states);
      progress.props[beat.location] = states;
      try {
        location = loadLocation(layout, { brief: locations[beat.location].brief }, states);
      } catch (retryError) {
        throw new EpisodeError("invalid_saved_layout", `Location ${beat.location} could not be loaded: ${retryError.message}`, {
          status: 500,
          details: { location: beat.location },
        });
      }
    }

    return {
      layout, location, states, beforeEntryStates, source, approach, choreography, technical, retrieval, notice,
    };
  }

  async function buildScene(episode, { selectedChoice, sceneNumber }) {
    const beat = scenePlan[sceneNumber - 1];
    if (!beat) throw new Error(`No scene plan for ${sceneNumber}`);
    episode.progress.scene = sceneNumber;
    episode.progress.revision = episode.revision;

    const locationResult = await resolveLocation(episode, beat, sceneNumber, selectedChoice);
    const consequence = consequenceFor(sceneNumber, episode.progress.facts);
    const choreography = await stageScene({
      model,
      beat,
      layout: locationResult.layout,
      facts: episode.progress.facts,
      choices: beat.choices,
    });
    const writer = await writeSceneImpl({
      model,
      beat,
      progress: episode.progress,
      layout: locationResult.layout,
      choreography,
      consequence,
      selectedChoice,
      premise: episode.premise,
      logger,
    });

    const sentences = writer.value.narration
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .slice(0, 3);
    const timeline = [
      { atMs: 0, kind: "aim", text: writer.value.aim },
      ...sentences.map((text, index) => ({
        atMs: [2_500, 8_500, 14_500][index],
        kind: "prose",
        text,
      })),
      ...(consequence ? [{ atMs: 18_000, kind: "consequence", text: consequence.text, consequenceId: consequence.id }] : []),
      { atMs: 22_000, kind: "prompt", text: writer.value.choicePrompt },
      { atMs: CHOICE_AT_MS, kind: "choice", text: "Choose." },
    ];

    const entryPatches = beat.entry?.props?.[beat.location] ?? {};
    const interaction = Object.entries(entryPatches).map(([instance, to]) => {
      const placement = locationResult.layout.placements.find(([name]) => name === instance);
      const asset = placement && assets.get(placement[1]);
      const from = locationResult.beforeEntryStates[instance] ?? asset?.defaultState ?? "closed";
      return asset?.capabilities?.includes("openable") && from !== to
        ? { instance, action: to === "open" ? "open" : "close", from, to, startMs: 6_500, durationMs: 560 }
        : null;
    }).filter(Boolean);

    const scene = {
      number: sceneNumber,
      revision: episode.revision,
      facts: { ...episode.progress.facts },
      title: writer.value.title,
      aim: writer.value.aim,
      narration: writer.value.narration,
      choicePrompt: writer.value.choicePrompt,
      searchHint: writer.value.searchHint,
      location: {
        id: beat.location,
        preset: locations[beat.location].preset,
        layout: locationResult.layout,
        states: locationResult.states,
        source: locationResult.source,
        visuals: writer.visuals,
      },
      consequence,
      choices: beat.choices,
      staging: {
        durationMs: SCENE_DURATION_MS,
        choiceAtMs: CHOICE_AT_MS,
        actorStart: entryX,
        floorY,
        clip: locationResult.approach,
        beats: [
          // Keep the stage alive throughout the scene. The old schedule had
          // 5.5s of motion followed by 5.5s of stillness, twice.
          { startMs: 0, durationMs: 6_500, clip: choreography.arrival, target: "cache" },
          { startMs: 6_500, durationMs: 8_000, clip: choreography.reaction, target: choreography.reactionTarget },
          { startMs: 14_500, durationMs: 12_500, clip: choreography.departure, target: choreography.departureTarget },
        ],
        interaction,
      },
      timeline,
      validation: {
        technical: {
          ok: locationResult.technical.ok !== false && writer.technical.ok !== false,
          layout: locationResult.technical.layout,
          model: locationResult.technical.model,
          schema: writer.technical.schema,
          writer: writer.technical.writer,
          retrieval: locationResult.retrieval,
          effects: { ok: true },
        },
        narrative: writer.narrative,
      },
      source: {
        writer: "model",
        composer: locationResult.source,
        layout: locationResult.technical.layout,
      },
      notice: locationResult.notice ?? episode.progress.recoveries.at(-1)?.message ?? null,
      generatedAt: now(),
    };

    episode.progress.history.push({
      number: sceneNumber,
      title: scene.title,
      narration: scene.narration,
      choiceId: selectedChoice?.id ?? null,
      choiceLabel: selectedChoice?.label ?? null,
    });
    return scene;
  }

  async function createEpisode({ premise = "" } = {}) {
    const id = randomUUID();
    const episode = {
      version: 1,
      id,
      createdAt: now(),
      updatedAt: now(),
      revision: 1,
      status: "active",
      progress: { ...emptyProgress(), scene: 1, revision: 1 },
      current: null,
      lastChoice: null,
      pending: null,
      lastFailure: null,
      premise: String(premise).trim().slice(0, 1_000),
    };
    const scene = await buildScene(episode, { selectedChoice: null, sceneNumber: 1 });
    episode.current = scene;
    episode.updatedAt = now();
    await store.write(episode);
    return publicEpisode(episode, { resumed: false });
  }

  async function rehydrate(episode) {
    let changed = false;
    for (const [locationId, visited] of Object.entries(episode.progress.visitedLayouts)) {
      if (!visited?.layout) continue;
      const sanitized = sanitizeSavedStates(visited.layout, episode.progress.props[locationId] ?? {});
      for (const item of sanitized.recovered) {
        addRecovery(episode.progress, {
          type: "unknown_prop_state",
          location: locationId,
          instance: item.instance,
          removed: item.removed,
          fallback: item.fallback,
          message: `Saved state for ${item.instance} was “${String(item.removed)}”; reset to ${item.fallback}.`,
        });
        changed = true;
      }
      if (sanitized.dropped.length) {
        addRecovery(episode.progress, {
          type: "dropped_prop_state",
          location: locationId,
          instances: sanitized.dropped,
          message: `Dropped saved state for unknown props: ${sanitized.dropped.join(", ")}.`,
        });
        changed = true;
      }
      const states = initializePropStates(visited.layout, sanitized.states);
      if (JSON.stringify(states) !== JSON.stringify(episode.progress.props[locationId] ?? {})) {
        episode.progress.props[locationId] = states;
        changed = true;
      }
      if (episode.current?.location?.id === locationId) {
        episode.current.location.states = states;
      }
    }
    if (episode.progress.revision !== episode.revision) {
      episode.progress.revision = episode.revision;
      changed = true;
    }
    if (changed) episode.updatedAt = now();
    return changed;
  }

  async function getEpisode(id) {
    const episode = await store.read(id);
    if (!episode) throw new EpisodeError("not_found", "Episode not found", { status: 404 });
    if (await rehydrate(episode)) {
      await store.withLock(id, async () => {
        const fresh = await store.read(id);
        if (fresh) {
          await rehydrate(fresh);
          await store.write(fresh);
        }
      });
    }
    return publicEpisode(episode, { resumed: true });
  }

  async function submitChoice(id, body = {}) {
    const requestId = String(body.requestId ?? "");
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(requestId)) {
      throw new EpisodeError("invalid_request_id", "requestId must be 8-100 safe characters", { status: 422 });
    }
    const revision = Number(body.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new EpisodeError("invalid_revision", "revision must be a positive integer", { status: 422 });
    }
    const provided = body.choice;
    if (!provided || typeof provided !== "object" || typeof provided.id !== "string") {
      throw new EpisodeError("invalid_choice", "choice must contain an id and typed effects", { status: 422 });
    }

    return store.withLock(id, async () => {
      const episode = await store.read(id);
      if (!episode) throw new EpisodeError("not_found", "Episode not found", { status: 404 });
      await rehydrate(episode);

      if (episode.lastChoice?.requestId === requestId) {
        return {
          episode: publicEpisode(episode, { resumed: false }),
          replayed: true,
          selectedChoice: episode.lastChoice.choice,
          complete: episode.status === "complete",
        };
      }
      if (episode.status === "complete") {
        throw new EpisodeError("episode_complete", "This episode is already complete", { status: 409 });
      }
      if (episode.pending && episode.pending.requestId !== requestId) {
        throw new EpisodeError("generation_in_progress", "Another choice is being generated", {
          status: 409,
          retryable: true,
          details: { requestId: episode.pending.requestId, fromRevision: episode.pending.fromRevision },
        });
      }
      if (revision !== episode.revision) {
        throw new EpisodeError("stale_revision", "The episode has moved to another revision", {
          status: 409,
          currentRevision: episode.revision,
          currentScene: episode.current ? { number: episode.current.number, title: episode.current.title } : null,
        });
      }
      if (episode.lastChoice?.fromRevision === revision) {
        throw new EpisodeError("choice_already_applied", "A choice was already committed for this revision", {
          status: 409,
          currentRevision: episode.revision,
        });
      }
      const canonical = episode.current?.choices?.find((entry) => entry.id === provided.id);
      if (!canonical) {
        throw new EpisodeError("invalid_choice", `Choice ${provided.id} does not belong to this scene`, { status: 422 });
      }
      if (provided.effects !== undefined && !isDeepStrictEqual(provided.effects, canonical.effects)) {
        throw new EpisodeError("effect_mismatch", "Choice effects do not match the typed contract", {
          status: 422,
          details: { expected: canonical.effects },
        });
      }

      episode.pending = {
        requestId,
        choiceId: canonical.id,
        fromRevision: revision,
        startedAt: now(),
      };
      episode.lastFailure = null;
      await store.write(episode);

      try {
        if (episode.current.number === SCENE_COUNT) {
          episode.progress.facts = applyEffects(episode.progress.facts, canonical.effects);
          episode.progress.choices.push({
            scene: episode.current.number,
            choiceId: canonical.id,
            label: canonical.label,
            effects: canonical.effects,
            requestId,
            at: now(),
          });
          const last = episode.progress.history.at(-1);
          if (last?.number === SCENE_COUNT) {
            last.choiceId = canonical.id;
            last.choiceLabel = canonical.label;
          }
          episode.current.outcome = finalOutcome(episode, canonical);
          episode.status = "complete";
          episode.lastChoice = {
            requestId,
            choiceId: canonical.id,
            choice: canonical,
            fromRevision: revision,
            toRevision: revision,
            at: now(),
          };
          episode.pending = null;
          episode.updatedAt = now();
          await store.write(episode);
          return {
            episode: publicEpisode(episode, { resumed: false }),
            replayed: false,
            selectedChoice: canonical,
            complete: true,
          };
        }

        const draft = structuredClone(episode);
        draft.progress.facts = applyEffects(draft.progress.facts, canonical.effects);
        draft.progress.choices.push({
          scene: episode.current.number,
          choiceId: canonical.id,
          label: canonical.label,
          effects: canonical.effects,
          requestId,
          at: now(),
        });
        draft.progress.scene = episode.current.number + 1;
        draft.revision = episode.revision + 1;
        draft.progress.revision = draft.revision;
        draft.current = null;
        const scene = await buildScene(draft, {
          selectedChoice: canonical,
          sceneNumber: draft.progress.scene,
        });
        draft.current = scene;
        draft.lastChoice = {
          requestId,
          choiceId: canonical.id,
          choice: canonical,
          fromRevision: revision,
          toRevision: draft.revision,
          at: now(),
        };
        draft.pending = null;
        draft.updatedAt = now();
        await store.write(draft);
        return {
          episode: publicEpisode(draft, { resumed: false }),
          replayed: false,
          selectedChoice: canonical,
          complete: false,
        };
      } catch (error) {
        const fresh = await store.read(id);
        if (fresh) {
          fresh.pending = null;
          fresh.lastFailure = {
            at: now(),
            code: error.code ?? "generation_failed",
            message: error.message,
            validation: error.validation ?? null,
            retryable: error.retryable ?? true,
          };
          fresh.updatedAt = now();
          await store.write(fresh);
        }
        throw error;
      }
    });
  }

  async function exportEpisode(id) {
    const episode = await store.read(id);
    if (!episode) throw new EpisodeError("not_found", "Episode not found", { status: 404 });
    return episode;
  }

  return {
    createEpisode,
    getEpisode,
    submitChoice,
    exportEpisode,
  };
}
