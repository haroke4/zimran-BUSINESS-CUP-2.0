const rules = [
  {
    key: "direction_sign",
    ids: ["direction_sign"],
    label: "neon direction sign",
    aliases: ["sign", "neon sign", "street sign", "direction sign", "neon arrow"],
    patterns: [
      /\bdirection\s+sign\b/i,
      /\bstreet\s+sign\b/i,
      /\bneon\s+sign\b/i,
      /\barrow\s+sign\b/i,
      /\bneon\s+arrow\b/i,
      /\bsign\b(?!\s+(?:of|that|for|to)\b)/i,
    ],
  },
  {
    key: "street_lamp",
    ids: ["street_lamp"],
    label: "street lamp",
    aliases: ["lamp", "street lamp", "streetlight", "street light", "lamppost", "amber light"],
    patterns: [/\bstreet\s*lamp\b/i, /\bstreet\s*light\b/i, /\bstreetlight\b/i, /\blamppost\b/i, /\blamp\b/i, /\bamber\s+light\b/i],
  },
  {
    key: "street_cabinet",
    ids: ["street_cabinet"],
    label: "metal cabinet",
    aliases: ["cabinet", "metal cabinet", "locker", "cache"],
    patterns: [/\bstreet\s+cabinet\b/i, /\bmetal\s+cabinet\b/i, /\bcabinet\b/i, /\blocker\b/i, /\bcache\b/i],
  },
  {
    key: "rain_puddle",
    ids: ["rain_puddle"],
    label: "rain puddle",
    aliases: ["puddle", "rain puddle", "reflection", "wet pavement"],
    patterns: [/\brain\s+puddle\b/i, /\bpuddle\b/i, /\breflection\b/i, /\bwet\s+pavement\b/i],
  },
  {
    key: "tall_tower",
    ids: ["tall_tower"],
    label: "tall tower",
    aliases: ["tower", "high-rise", "skyscraper"],
    patterns: [/\btall\s+tower\b/i, /\btower\b/i, /\bhigh-rise\b/i, /\bskyscraper\b/i],
  },
  {
    key: "row_houses",
    ids: ["row_houses"],
    label: "row houses",
    aliases: ["houses", "row houses", "low houses"],
    patterns: [/\brow\s+houses\b/i, /\browhouses\b/i, /\blow\s+houses\b/i, /\bhouses\b/i],
  },
  {
    key: "pine_grove",
    ids: ["pine_grove"],
    label: "pine grove",
    aliases: ["pines", "pine grove", "pine trees", "forest"],
    patterns: [/\bpine\s+grove\b/i, /\bpines\b/i, /\bpine\s+trees\b/i, /\bforest\b/i],
  },
  {
    key: "roadside_boulder",
    ids: ["roadside_boulder"],
    label: "roadside boulder",
    aliases: ["boulder", "roadside boulder"],
    patterns: [/\broadside\s+boulder\b/i, /\bboulder\b/i],
  },
  {
    key: "street",
    ids: ["street"],
    label: "street",
    aliases: ["street", "pavement", "sidewalk"],
    patterns: [/\bstreet\b/i, /\bpavement\b/i, /\bsidewalk\b/i],
  },
  {
    key: "dirt_trail",
    ids: ["dirt_trail"],
    label: "dirt trail",
    aliases: ["trail", "dirt trail"],
    patterns: [/\bdirt\s+trail\b/i, /\btrail\b/i],
  },
  {
    key: "dusk_sky",
    ids: ["dusk_sky"],
    label: "dusk sky",
    aliases: ["sky", "dusk", "twilight"],
    patterns: [/\bdusk\s+sky\b/i, /\btwilight\b/i, /\bsky\b/i],
  },
];

const contentRules = [
  {
    key: "battery",
    label: "radio battery",
    aliases: ["battery", "radio battery"],
    patterns: [/\bradio\s+battery\b/i, /\bbattery\b/i],
    allowed: (placedIds, facts) => placedIds.has("street_cabinet") || facts?.["battery.taken"] === true,
  },
];

function global(pattern) {
  return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}

function excerpt(text, index, length) {
  const start = Math.max(0, index - 26);
  const end = Math.min(text.length, index + length + 26);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

function matchingRule(reference) {
  const normalized = reference.trim().toLowerCase();
  return rules.find((rule) => rule.key === normalized || rule.ids.includes(normalized)
    || rule.aliases.includes(normalized))
    ?? contentRules.find((rule) => rule.key === normalized || rule.aliases.includes(normalized));
}

export function collectPlacedVisuals(layout, facts = {}) {
  const placedIds = new Set(layout.placements.map(([, assetId]) => assetId));
  const visuals = [];
  for (const rule of rules) {
    const present = rule.ids.find((id) => placedIds.has(id));
    if (!present) continue;
    visuals.push({
      id: present,
      kind: "asset",
      label: rule.label,
      aliases: rule.aliases,
    });
  }
  for (const rule of contentRules) {
    if (!rule.allowed(placedIds, facts)) continue;
    visuals.push({
      id: rule.key,
      kind: "content",
      label: rule.label,
      aliases: rule.aliases,
      note: facts?.["battery.taken"] === true ? "carried by Mara" : "inside the cabinet",
    });
  }
  return visuals;
}

export function validateNarrativeGrounding({ texts, layout, facts = {}, declaredRefs = [] }) {
  const text = texts.filter((value) => typeof value === "string").join("\n");
  const placedIds = new Set(layout.placements.map(([, assetId]) => assetId));
  const references = [];
  const errors = [];
  const seen = new Set();

  for (const rule of rules) {
    const grounded = rule.ids.some((id) => placedIds.has(id));
    for (const pattern of rule.patterns) {
      for (const match of text.matchAll(global(pattern))) {
        references.push({
          key: rule.key,
          ids: rule.ids,
          match: match[0],
          excerpt: excerpt(text, match.index ?? 0, match[0].length),
          grounded,
        });
        if (!grounded && !seen.has(rule.key)) {
          seen.add(rule.key);
          errors.push(`The narrative mentions “${match[0]}”, but the frame has no ${rule.ids.join(" or ")}.`);
        }
      }
    }
  }

  for (const rule of contentRules) {
    const grounded = rule.allowed(placedIds, facts);
    for (const pattern of rule.patterns) {
      for (const match of text.matchAll(global(pattern))) {
        references.push({
          key: rule.key,
          kind: "content",
          match: match[0],
          excerpt: excerpt(text, match.index ?? 0, match[0].length),
          grounded,
        });
        if (!grounded && !seen.has(rule.key)) {
          seen.add(rule.key);
          errors.push(`The narrative mentions “${match[0]}”, but no cabinet is in the frame.`);
        }
      }
    }
  }

  const warnings = [];
  const declared = [];
  for (const value of declaredRefs) {
    if (typeof value !== "string" || !value.trim()) continue;
    const rule = matchingRule(value);
    if (!rule) {
      warnings.push(`Declared visual “${value}” is outside the visual contract.`);
      continue;
    }
    const grounded = rule.ids
      ? rule.ids.some((id) => placedIds.has(id))
      : rule.allowed(placedIds, facts);
    declared.push({ value, key: rule.key, grounded });
    if (!grounded) warnings.push(`Declared visual “${value}” is not placed in the frame.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    references,
    declared,
    placed: collectPlacedVisuals(layout, facts),
  };
}
