import city from "./assets/city.json" with { type: "json" };

import countryside from "./assets/countryside.json" with { type: "json" };

export const catalog = [...city, ...countryside];

export const slots = {
  sky: [[0, 0]],
  ground: [[0, 398]],
  skyline: [[93, 398], [276, 398], [471, 398], [675, 398], [864, 398]],
  surface: [[142, 468], [373, 483], [617, 452], [824, 474]],
  prop: [[88, 436], [243, 437], [423, 437], [595, 437], [782, 437], [885, 437]],
};

export const clips = {
  walk: { mode: "ground", speed: 170, cycle: 520 },
  run: { mode: "ground", speed: 275, cycle: 340 },
  jump: { mode: "air", ms: 680 },
  fly: { mode: "air", ms: 950 },
  cry: { mode: "pose", ms: 1050 },
  die: { mode: "terminal", ms: 950 },
};

export function indexCatalog(records) {
  const index = new Map();
  const svgFilename = /^[a-z0-9_-]+\.svg$/i;
  for (const asset of records) {
    if (!asset || typeof asset !== "object" || typeof asset.id !== "string"
        || !/^[a-z][a-z0-9_]*$/.test(asset.id) || index.has(asset.id)
        || !Object.hasOwn(slots, asset.layer) || typeof asset.file !== "string" || !svgFilename.test(asset.file)
        || typeof asset.category !== "string" || !asset.category
        || typeof asset.description !== "string" || !asset.description
        || !Array.isArray(asset.tags) || asset.tags.some((tag) => typeof tag !== "string")
        || (asset.capabilities !== undefined && (!Array.isArray(asset.capabilities)
          || asset.capabilities.some((capability) => typeof capability !== "string")))
        || !Array.isArray(asset.size) || asset.size.length !== 2
        || asset.size.some((value) => !Number.isSafeInteger(value) || value < 1)) {
      throw new Error(`Invalid or duplicate asset: ${asset?.id}`);
    }
    if (asset.capabilities?.includes("openable")) {
      const validPoint = (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
      if (asset.layer !== "prop" || typeof asset.overlay !== "string" || !svgFilename.test(asset.overlay)
          || !asset.states || typeof asset.states !== "object" || Array.isArray(asset.states)
          || typeof asset.defaultState !== "string" || !Object.hasOwn(asset.states, asset.defaultState)
          || !validPoint(asset.anchors?.approach) || !validPoint(asset.anchors?.handle)
          || !Array.isArray(asset.transitions) || !asset.transitions.length) {
        throw new Error(`Missing prop states, transitions or anchors: ${asset.id}`);
      }
      if (Object.values(asset.states).some((scale) => !Number.isFinite(scale) || scale < 0 || scale > 1)) {
        throw new Error(`Invalid door scale: ${asset.id}`);
      }
      const keys = new Set();
      for (const edge of asset.transitions) {
        if (!edge || typeof edge !== "object") throw new Error(`Invalid prop transition: ${asset.id}`);
        const key = `${edge.from}:${edge.action}`;
        if (keys.has(key) || typeof edge.action !== "string" || !edge.action
            || typeof edge.from !== "string" || !Object.hasOwn(asset.states, edge.from)
            || typeof edge.to !== "string" || !Object.hasOwn(asset.states, edge.to)
            || edge.from === edge.to || !Number.isSafeInteger(edge.ms) || edge.ms <= 0) {
          throw new Error(`Invalid prop transition: ${asset.id}/${key}`);
        }
        keys.add(key);
      }
    } else if (asset.overlay !== undefined) {
      throw new Error(`Door overlay needs an openable prop: ${asset.id}`);
    }
    index.set(asset.id, asset);
  }
  return index;
}

export const assets = indexCatalog(catalog);
