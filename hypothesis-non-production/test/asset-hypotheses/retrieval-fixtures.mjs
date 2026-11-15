function item(id, category, tags, description, capabilities = []) {
  return { id, category, tags, description, capabilities };
}

const labelledAssets = [
  item("tower_office", "building", ["city", "tower", "glass"], "Tall office block with tinted windows"),
  item("house_suburban", "building", ["detached", "low-rise", "suburban"], "Two-storey house with a garden"),
  item("warehouse_brick", "building", ["industrial", "brick", "warehouse"], "Brick loading building with shutter doors"),
  item("station_abandoned", "building", ["brutalist", "concrete", "abandoned"], "Disused concrete station with sealed entrances"),
  item("puddle_rain", "ground_detail", ["puddle", "wet", "reflective"], "Shallow street water with a glint of light"),
  item("oil_stain", "ground_detail", ["industrial", "spill", "dark"], "Black oil slick beside a loading bay"),
  item("cabinet_metal", "prop", ["industrial", "cabinet", "metal"], "Steel filing storage with a hinged door", ["open", "close"]),
  item("cabinet_painted", "prop", ["cabinet", "metal", "painted"], "Painted prop with the door permanently shut"),
  item("cabinet_wood", "prop", ["cabinet", "wood", "vintage"], "Wood storage with a hinged door", ["open", "close"]),
  item("door_shutter", "prop", ["industrial", "door", "shutter"], "Ribbed security shutter", ["open", "close", "lock"]),
  item("alley_wall", "backdrop", ["alley", "brick", "urban"], "Narrow brick walls with recessed service doors"),
  item("sky_midnight", "backdrop", ["night", "sky", "stars"], "Dark indigo skyline washed with moonlight"),
  item("hero_robot", "character", ["robot", "android", "utility"], "Compact maintenance android", ["walk", "run", "press"]),
  item("rat_sewer", "character", ["rat", "rodent", "animal"], "Small sewer rat", ["walk", "run", "hide"]),
  item("drone_scout", "character", ["drone", "scout", "robot"], "Four-rotor survey quadcopter", ["fly", "land"]),
];

const fillers = [
  ["building", ["coastal", "stone"], "Stone building with a pitched roof"],
  ["building", ["downtown", "concrete"], "Concrete office block with balconies"],
  ["ground_detail", ["asphalt", "cracks"], "Cracked road marking beside the curb"],
  ["ground_detail", ["soil", "dirt"], "Patch of rough exposed ground"],
  ["backdrop", ["rural", "day"], "Countryside beyond the railway embankment"],
  ["backdrop", ["sunset", "clouds"], "Orange sky with thick clouds on the horizon"],
  ["prop", ["metal", "industrial"], "Angled metal crate with a hinged lid", ["open", "close"]],
  ["prop", ["glass", "urban"], "Decorative display panel"],
  ["character", ["human", "civilian"], "Person in unmarked street clothes", ["walk", "run"]],
];

export function syntheticCatalog(size) {
  const catalog = labelledAssets.slice();

  for (let index = 0; catalog.length < size; index += 1) {
    const [category, tags, description, capabilities] = fillers[index % fillers.length];
    const room = 1 + (Math.floor(index / fillers.length) % 5);
    const id = `variant_${String(index).padStart(5, "0")}`;
    catalog.push(item(id, category, tags, `${description}, style ${room}`, capabilities));
  }

  return catalog;
}

export const queries = [
  { name: "urban office", category: "building", tags: ["city", "tower"], expected: ["tower_office"] },
  { name: "separate house", category: "building", hint: "freestanding low building", expected: ["house_suburban"] },
  { name: "city height", category: "building", hint: "metropolitan skyscraper", expected: ["tower_office"] },
  { name: "workshop", category: "building", hint: "brick factory building", expected: ["warehouse_brick"] },
  { name: "shallow water", category: "ground_detail", hint: "standing water on asphalt", expected: ["puddle_rain"] },
  { name: "wet ground", category: "ground_detail", tags: ["puddle", "reflective"], expected: ["puddle_rain"] },
  { name: "waste spill", category: "ground_detail", hint: "industrial oil spill", expected: ["oil_stain"] },
  { name: "function first", category: "prop", hint: "painted metal cabinet", requires: ["open"], expected: ["cabinet_metal", "cabinet_wood"] },
  { name: "cupboard", category: "prop", hint: "swing a cupboard open", requires: ["open", "close"], expected: ["cabinet_metal", "cabinet_wood"] },
  { name: "closable shutter", category: "prop", tags: ["shutter"], requires: ["close", "lock"], expected: ["door_shutter"] },
  { name: "exclude rusty-room look", category: "prop", hint: "wood cabinet", requires: ["open"], excludeTags: ["industrial"], expected: ["cabinet_wood"] },
  { name: "service lane", category: "backdrop", hint: "service lane brick walls", expected: ["alley_wall"] },
  { name: "time of day", category: "backdrop", hint: "after dark sky", expected: ["sky_midnight"] },
  { name: "robot walk", category: "character", tags: ["robot"], requires: ["walk"], expected: ["hero_robot"] },
  { name: "flies", category: "character", hint: "robot", requires: ["fly"], expected: ["drone_scout"] },
  { name: "subjective mood", category: "building", hint: "a structure that seems to hold its breath", expected: ["station_abandoned"] },
  { name: "unsupported action", category: "prop", hint: "levitating cabinet", requires: ["fly"], expected: [] },
  { name: "missing category", category: "vehicle", hint: "cargo van", expected: [] },
];
