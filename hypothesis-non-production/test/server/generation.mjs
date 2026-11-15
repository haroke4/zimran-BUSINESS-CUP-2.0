import { compositionContext, loadLocation, validateLayout } from "../asset-hypotheses/scene.mjs";
import { locations } from "./story-plan.mjs";
import { ModelError } from "./model-client.mjs";
import { SceneGenerationError } from "./errors.mjs";
import {
  collectPlacedVisuals, validateNarrativeGrounding,
} from "./visual-grounding.mjs";
import { consequenceMentioned } from "./story-plan.mjs";

const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = { type: "string" };
const enumeration = (...values) => ({
  type: typeof values[0] === "number" ? "integer" : "string",
  enum: values,
});

export const writerSchema = object({
  title: { ...string, minLength: 2, maxLength: 80 },
  aim: { ...string, minLength: 20, maxLength: 500 },
  narration: { ...string, minLength: 40, maxLength: 900 },
  choicePrompt: { ...string, minLength: 10, maxLength: 220 },
  searchHint: { ...string, minLength: 5, maxLength: 300 },
  visualRefs: { type: "array", items: string, maxItems: 10 },
});

export const writerPrompt = `You write one dynamic 30-second FRAMEBREAK scene. Return JSON only.
Begin with Mara in motion toward an immediate goal. Put a visible obstacle or discovery in her path,
show a reaction, then land on a consequential choice. Write concrete present-tense screen action,
not summary or backstory. The frame contains only the objects in frame.visuals. Mention only those objects.
If the consequence describes a powered or dead radio, show that consequence.
narration is 2-4 present-tense sentences about Mara's movement and reactions.
choicePrompt is one short sentence that leads into the two choices.
visualRefs lists only frame objects you actually named. If a player premise is supplied,
use it as the creative direction while preserving the provided scene intent and physical frame.
searchHint is a short phrase for finding art for this location.`;

export const compositorPrompt = `You stage an animated FRAMEBREAK scene with pieces from a shortlist.
Use listed asset IDs only. The sky and ground are fixed by code. Place the location, then direct Mara
through three visible beats that the player will execute: an immediate approach, a reaction after the
discovery, and a late decisive exit toward the choice. Pick walk for caution and run for urgency.
Do not invent props, actions, positions or timings. Place exactly one openable cabinet in slot 2, 3 or 4.
For a wet scene choose a puddle slot. For a dry scene omit surfaces. Return JSON only.`;

export const stagingPrompt = `You stage an animated FRAMEBREAK scene after its location is mounted.
Return JSON only. Direct Mara through three physical beats that Phaser can play.
Arrival reaches the cabinet immediately. Reaction must pull Mara to a different visible mark after the discovery.
Departure must be a distinct late movement toward the choice. Choose run only when the story has urgency.
Use only the legal clips and target marks in the input. Do not invent an object, timing, action, or camera move.`;

function fixedSchema(context) {
  const idsFor = (layer) => context.candidates.filter((asset) => asset.layer === layer).map((asset) => asset.id);
  const skylineIds = idsFor("skyline");
  const propIds = context.candidates.filter((asset) => asset.layer === "prop").map((asset) => asset.id);
  const cabinet = context.candidates.find((asset) => asset.capabilities?.includes("openable"));
  const surface = context.candidates.find((asset) => asset.layer === "surface");
  if (!idsFor("sky").length || !idsFor("ground").length || !skylineIds.length || !cabinet) {
    throw new SceneGenerationError("technical", "Retrieval did not yield a complete asset set for this location", {
      validation: {
        technical: { ok: false, phase: "retrieval", errors: ["sky, ground, skyline and cabinet candidates are required"] },
        narrative: { ok: null, errors: [] },
      },
    });
  }
  if (context.brief.wet && !surface) {
    throw new SceneGenerationError("technical", "A wet location has no surface candidate", {
      validation: {
        technical: { ok: false, phase: "retrieval", errors: ["wet scene requires a surface candidate"] },
        narrative: { ok: null, errors: [] },
      },
    });
  }
  const slotMap = (slots, values) => object(Object.fromEntries(slots.map((slot) => [slot, enumeration("empty", ...values)])));
  const schema = object({
    approach: enumeration("walk", "run"),
    skylineCenter: enumeration(...skylineIds),
    skyline: slotMap(["0", "1", "3", "4"], skylineIds),
    cabinetSlot: enumeration(2, 3, 4),
    ...(context.brief.wet && { puddleSlot: enumeration(0, 1, 2, 3) }),
    props: slotMap(["0", "1", "5"], propIds.filter((id) => id !== cabinet.id)),
  });
  return {
    schema,
    idsFor,
    skylineIds,
    propIds,
    cabinetId: cabinet.id,
    surfaceId: surface?.id,
  };
}

function layoutFromCompose(value, context, fixed) {
  const toPlacements = (layer, map) => Object.entries(map)
    .filter(([, assetId]) => assetId !== "empty")
    .map(([slot, assetId]) => [`${layer}-${slot}`, assetId, Number(slot)]);
  return {
    id: context.brief.id,
    placements: [
      ["sky", fixed.idsFor("sky")[0], 0],
      ["ground", fixed.idsFor("ground")[0], 0],
      ["skyline-2", value.skylineCenter, 2],
      ...toPlacements("skyline", value.skyline),
      ...(context.brief.wet ? [["puddle", fixed.surfaceId, value.puddleSlot]] : []),
      ["cache", fixed.cabinetId, value.cabinetSlot],
      ...toPlacements("prop", value.props),
    ],
  };
}

export async function composeLocation({ model, beat, hint, logger = console } = {}) {
  const base = locations[beat.location];
  const context = compositionContext({
    ...base.brief,
    hint: `${base.brief.hint}. ${hint ?? beat.intent}`,
  });
  const fixed = fixedSchema(context);
  const errors = [];
  let previous;
  let attempts = 0;
  let lastUsage;
  let lastMs = 0;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    attempts = attempt;
    try {
      const result = await model.generate(compositorPrompt, {
        brief: context.brief,
        story: { title: beat.title, intent: beat.intent },
        candidates: context.candidates,
        requestedStructure: beat.location === "quiet-block"
          ? "Use the direction_sign when it is shortlisted, and keep the center building low."
          : beat.location === "pine-trail"
            ? "Frame the trail with pine groves and a roadside boulder."
            : "Use a tower across from row houses.",
        ...(errors.length && { previous, fix: errors.at(-1) }),
      }, fixed.schema, {
        schemaName: "framebreak_layout",
        label: `compositor:${beat.location}`,
        maxTokens: 420,
      });
      lastUsage = result.usage;
      lastMs += result.ms;
      const layout = layoutFromCompose(result.value, context, fixed);
      validateLayout(layout, context);
      const placedIds = new Set(layout.placements.map(([, assetId]) => assetId));
      const missing = (beat.requiredVisuals ?? []).filter((id) => !placedIds.has(id));
      if (missing.length) throw new Error(`Required visuals were not placed: ${missing.join(", ")}`);
      return {
        layout,
        approach: result.value.approach,
        context,
        retrieval: {
          used: true,
          candidates: context.candidates.length,
          byLayer: Object.fromEntries(["sky", "ground", "skyline", "surface", "prop"].map((layer) => [
            layer, context.candidates.filter((asset) => asset.layer === layer).length,
          ])),
        },
        technical: {
          ok: true,
          attempts: attempt + result.attempts - 1,
          model: { ok: true, attempts: result.attempts, ms: result.ms, usage: result.usage },
          layout: { ok: true, source: "model" },
          schema: { ok: true, attempts: result.attempts },
        },
      };
    } catch (error) {
      errors.push(error.message);
      logger.warn?.(`[compositor:${beat.location}] attempt ${attempt}: ${error.message}`);
      if (error instanceof SceneGenerationError) throw error;
      previous = error.raw ?? previous;
      if (error instanceof ModelError) lastMs += error.attempts * 0;
    }
  }

  throw new SceneGenerationError("technical", "The compositor did not return a playable layout", {
    attempts,
    validation: {
      technical: { ok: false, phase: "compositor", errors },
      narrative: { ok: null, errors: [] },
    },
  });
}

const choreographySchema = object({
  arrival: enumeration("walk", "run"),
  reaction: enumeration("walk", "run"),
  reactionTarget: enumeration("left", "center", "right"),
  departure: enumeration("walk", "run"),
  departureTarget: enumeration("left", "right"),
});

export async function stageScene({ model, beat, layout, facts, choices } = {}) {
  const context = compositionContext(locations[beat.location].brief);
  const result = await model.generate(stagingPrompt, {
    scene: { number: beat.number, title: beat.title, intent: beat.intent },
    placedAssets: layout.placements.map(([, assetId]) => assetId),
    facts,
    choices: choices.map(({ id, label }) => ({ id, label })),
    legalClips: ["walk", "run"],
    reactionMarks: ["left", "center", "right"],
    departureMarks: ["left", "right"],
    candidates: context.candidates,
    brief: context.brief,
  }, choreographySchema, {
    schemaName: "framebreak_staging",
    label: `staging:${beat.number}`,
    maxTokens: 180,
  });
  const choreography = result.value;
  if (choreography.reactionTarget === choreography.departureTarget) {
    throw new SceneGenerationError("technical", "The scene director repeated the final target", {
      validation: { technical: { ok: false, phase: "staging", errors: ["reaction and departure must use different marks"] }, narrative: { ok: null, errors: [] } },
    });
  }
  return choreography;
}

export async function writeScene({
  model, beat, progress, layout, choreography, consequence, selectedChoice, premise = "", logger = console,
} = {}) {
  const visuals = collectPlacedVisuals(layout, progress.facts);
  const frameText = visuals.map((visual) => `${visual.label} [${visual.aliases.join(", ")}]`).join("; ");
  const baseInput = {
    scene: { number: beat.number, title: beat.title, intent: beat.intent },
    durationSeconds: 30,
    playerPreference: beat.preference,
    playerPremise: premise || null,
    location: {
      id: beat.location,
      hint: locations[beat.location].brief.hint,
      visuals,
    },
    facts: progress.facts,
    consequence: consequence ? { title: consequence.title, text: consequence.text } : null,
    selectedChoice: selectedChoice ? {
      id: selectedChoice.id,
      label: selectedChoice.label,
      effects: selectedChoice.effects,
    } : null,
    choices: beat.choices.map((entry) => ({
      id: entry.id,
      label: entry.label,
      effects: entry.effects,
    })),
    staging: choreography,
    recentScenes: progress.history.slice(-3).map(({ number, title, narration }) => ({ number, title, narration })),
    frame: { text: frameText, ids: visuals.map((visual) => visual.id) },
    rules: "The frame list is exhaustive. A sign only exists when neon direction sign is in the frame.",
  };

  let technical = null;
  let narrativeErrors = [];
  let attempts = 0;
  let lastMs = 0;
  let lastUsage;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    attempts = attempt;
    try {
      const result = await model.generate(writerPrompt, {
        ...baseInput,
        ...(narrativeErrors.length && {
          fix: `${narrativeErrors.join(" ")} Rewrite the scene. Mention only: ${frameText}.`,
        }),
      }, writerSchema, {
        schemaName: "framebreak_scene",
        label: `writer:${beat.number}`,
        maxTokens: 520,
      });
      lastMs += result.ms;
      lastUsage = result.usage;
      technical = {
        ok: true,
        schema: { ok: true, attempts: result.attempts },
        writer: { attempts: result.attempts, ms: result.ms, usage: result.usage },
      };
      const value = result.value;
      const fieldErrors = [];
      if (value.title.trim().length < 2) fieldErrors.push("title is empty");
      if (value.aim.trim().length < 20) fieldErrors.push("aim is too short");
      if (value.narration.trim().length < 40) fieldErrors.push("narration is too short");
      if (value.choicePrompt.trim().length < 10) fieldErrors.push("choicePrompt is too short");
      if (fieldErrors.length) {
        throw new SceneGenerationError("technical", "Writer JSON passed the type schema but failed scene field checks", {
          validation: {
            technical: { ok: false, phase: "writer_fields", errors: fieldErrors, attempts: result.attempts },
            narrative: { ok: null, errors: [] },
          },
        });
      }

      const narrative = validateNarrativeGrounding({
        texts: [value.title, value.aim, value.narration, value.choicePrompt, ...beat.choices.map((entry) => entry.label)],
        layout,
        facts: progress.facts,
        declaredRefs: value.visualRefs,
      });
      const payoffMentioned = consequenceMentioned(consequence, [value.title, value.aim, value.narration, value.choicePrompt]);
      if (narrative.ok) {
        return {
          value,
          visuals,
          technical: {
            ...technical,
            effects: { ok: true },
          },
          narrative: {
            ...narrative,
            attempts,
            payoffMentioned,
            ...(consequence && !payoffMentioned && {
              warnings: [...narrative.warnings, "The narration does not name the deterministic payoff."],
            }),
          },
        };
      }
      narrativeErrors = narrative.errors;
      logger.warn?.(`[writer:${beat.number}] narrative grounding failed: ${narrativeErrors.join(" ")}`);
    } catch (error) {
      if (error instanceof SceneGenerationError) throw error;
      const message = error instanceof ModelError
        ? `${error.message}: ${error.errors.join("; ")}`
        : error.message;
      logger.warn?.(`[writer:${beat.number}] attempt ${attempt}: ${message}`);
      if (attempt === 2) {
        throw new SceneGenerationError("writer", "The writer did not return a valid scene", {
          attempts: error.attempts ?? attempts,
          cause: error,
          validation: {
            technical: {
              ok: false,
              phase: "model_json",
              errors: [message],
              attempts: error.attempts ?? attempts,
            },
            narrative: { ok: null, errors: [] },
          },
        });
      }
    }
  }

  throw new SceneGenerationError("narrative", "The scene narrative references objects that are not in the frame", {
    attempts,
    validation: {
      technical: technical ?? { ok: true, schema: { ok: true } },
      narrative: { ok: false, errors: narrativeErrors, attempts },
    },
  });
}
