import { assets, catalog, clips, slots } from "./catalog.mjs";
import { assetCard, shortlist } from "./retrieval.mjs";

export const floorY = 425;
export const entryX = 44;
export const sceneMs = 6100;

export const writerPrompt = `You write one short FRAMEBREAK scene. Use the player's preference
and the exact current world state. Request only the available stage categories and supported
actions. End with two distinct visible choices. Output story prose and an asset search hint
for each required category. A wet scene requires a surface. A dry scene leaves it out.
A radio battery is visible when the cabinet opens. The actor can take it or leave it.
Use realistic surface descriptions as search hints. The narrator can mention only the
opening cabinet and the revealed battery as physical events during this scene.
Return the specified JSON.`;

export const compositorPrompt = `You stage an animated scene with pieces from a shortlist.
Build an original 2D location with up to five skyline pieces, surface details and props.
Use the listed asset IDs for free numbered slots in the matching layer.
Use at least one skyline piece and exactly one openable cabinet in the prop layer.
For a wet scene include a puddle. For a dry scene omit surfaces.
Pick walk or run to match the urgency in the story. Return JSON only.
The player aligns interactions to the chosen prop's anchors and plays the authored clips.`;

export const cityBriefs = {
  wet: { id: "rainy-crossing", hint: "A wet city at dusk, tower across from row houses", style: "urban", wet: true },
  dry: { id: "quiet-block", hint: "A dry residential block after dusk, low houses and a sign", style: "urban", wet: false, lowRise: true },
  trail: { id: "pine-trail", hint: "A lonely dirt trail with pines and roadside boulders, no houses or puddles", style: "rural", wet: false },
};

export function compositionContext(brief) {
  const eligible = catalog.filter((asset) => !asset.style || asset.style === brief.style);
  const needs = [
    { category: "sky", tags: ["dusk"] },
    { category: "ground" },
    { category: brief.style === "rural" ? "landscape" : "building", hint: brief.hint, excludeTags: brief.lowRise ? ["tall"] : undefined },
    { category: "prop", requires: ["openable"] },
    { category: "detail", hint: brief.hint },
    ...(brief.wet ? [{ category: "surface", tags: ["wet"] }] : []),
  ];
  const choices = needs.flatMap((need) => shortlist(eligible, need));
  return {
    brief,
    slotCounts: Object.fromEntries(Object.entries(slots).map(([layer, points]) => [layer, points.length])),
    candidates: choices.map((asset) => ({ ...assetCard(asset), layer: asset.layer })),
  };
}

export const layoutFixtures = {
  wet: {
    id: "rainy-crossing",
    placements: [
      ["sky", "dusk_sky", 0], ["ground", "street", 0],
      ["homes-west", "row_houses", 0], ["west-tower", "tall_tower", 1],
      ["homes-east", "row_houses", 3], ["east-tower", "tall_tower", 4],
      ["reflection-west", "rain_puddle", 0], ["reflection-east", "rain_puddle", 2],
      ["cache", "street_cabinet", 2], ["lamp", "street_lamp", 3],
    ],
  },
  dry: {
    id: "quiet-block",
    placements: [
      ["sky", "dusk_sky", 0], ["ground", "street", 0],
      ["homes-west", "row_houses", 1], ["homes-center", "row_houses", 2],
      ["homes-east", "row_houses", 4], ["sign", "direction_sign", 1],
      ["cache", "street_cabinet", 4], ["lamp", "street_lamp", 5],
    ],
  },
};

export function validateLayout(layout, context) {
  return checkLayout(layout, context, new Set(context.candidates.map(({ id }) => id)));
}

function checkLayout(layout, context, allowed) {
  if (!layout?.id || !Array.isArray(layout.placements) || layout.placements.length > 16) {
    throw new Error("Expected a location ID and up to 16 placements");
  }
  if (layout.id !== context.brief.id) throw new Error("Location ID differs from the brief");

  const instances = new Set();
  const occupied = new Set();
  const counts = { sky: 0, ground: 0, skyline: 0, surface: 0, prop: 0 };
  let cabinets = 0;
  for (const row of layout.placements) {
    if (!Array.isArray(row) || row.length !== 3) throw new Error("Invalid placement");
    const [instance, assetId, slot] = row;
    const asset = assets.get(assetId);
    if (!/^[\w-]{1,30}$/.test(instance ?? "") || typeof instance !== "string" || instances.has(instance)) {
      throw new Error("Duplicate or invalid instance ID");
    }
    if (!asset || !allowed.has(assetId)) throw new Error(`Asset not shortlisted: ${assetId}`);
    if (!Number.isInteger(slot) || !slots[asset.layer][slot]) throw new Error(`Invalid slot: ${asset.layer}/${slot}`);
    const slotId = `${asset.layer}/${slot}`;
    if (occupied.has(slotId)) throw new Error(`Occupied slot: ${slotId}`);
    instances.add(instance);
    occupied.add(slotId);
    counts[asset.layer] += 1;
    if (asset.capabilities?.includes("openable")) cabinets += 1;
  }
  if (counts.sky !== 1 || counts.ground !== 1 || (context.brief.requiresSkyline === true && counts.skyline < 1) || cabinets !== 1) {
    throw new Error("Missing required sky, ground, skyline or cabinet");
  }
  if (Boolean(counts.surface) !== context.brief.wet) throw new Error("Surface does not match the brief");
  return layout;
}

export function loadLocation(layout, context, savedStates = {}) {
  checkLayout(layout, context, new Set(assets.keys()));
  const objects = layout.placements.map(([instance, id, slot]) => {
    const asset = assets.get(id);
    const [x, y] = slots[asset.layer][slot];
    return { instance, asset, x, y, state: Object.hasOwn(savedStates, instance) ? savedStates[instance] : asset.defaultState };
  });
  for (const { asset, state } of objects) {
    if (asset.states && !Object.hasOwn(asset.states, state)) throw new Error("Unknown saved state");
  }
  return { id: layout.id, objects };
}

export function sanitizeSavedStates(layout, savedStates = {}) {
  const states = {};
  const recovered = [];
  const instances = new Set();
  for (const [instance, id] of layout.placements) {
    instances.add(instance);
    const asset = assets.get(id);
    if (!asset || !Object.hasOwn(savedStates, instance)) continue;
    const value = savedStates[instance];
    if (asset.states && !Object.hasOwn(asset.states, value)) {
      recovered.push({ instance, removed: value, fallback: asset.defaultState });
    } else if (asset.states) {
      states[instance] = value;
    }
  }
  return { states, recovered, dropped: Object.keys(savedStates).filter((key) => !instances.has(key)) };
}

export function anchor(object, name) {
  const local = object.asset.anchors?.[name];
  if (!local) throw new Error(`Missing anchor: ${name}`);
  return [object.x + local[0], object.y + local[1]];
}

export function compileAction(location, props, request, actorX = entryX) {
  const { clip, instance, action } = request;
  const movement = clips[clip];
  if (!Object.hasOwn(clips, clip) || movement.mode !== "ground") {
    throw new Error("An interaction requires a ground approach");
  }
  const prop = location.objects.find((object) => object.instance === instance);
  const state = Object.hasOwn(props, instance) ? props[instance] : prop?.state;
  const transition = prop?.asset.transitions?.find((edge) => edge.from === state && edge.action === action);
  if (!transition) throw new Error(`Unavailable action: ${instance} ${action} from ${state}`);

  const [x, y] = anchor(prop, "approach");
  const handle = anchor(prop, "handle");
  const start = 300;
  const arrive = Math.round(start + Math.abs(x - actorX) / movement.speed * 1000);
  const contact = arrive + 330;
  const complete = contact + transition.ms;
  if (y < floorY - 8 || y > floorY + 8 || complete > sceneMs) throw new Error("Interaction cannot fit this stage");
  return { instance, x, y, actorX, handle, clip, start, arrive, contact, complete, transition };
}

export function compileSolo(clip, start = 300) {
  if (!Object.hasOwn(clips, clip) || clips[clip].mode === "ground") throw new Error("Unsupported solo clip");
  return { clip, start, complete: start + clips[clip].ms };
}

export function commitActions(props, sequence, elapsed) {
  if (!sequence.transition || elapsed < sequence.complete) return props;
  return { ...props, [sequence.instance]: sequence.transition.to };
}
